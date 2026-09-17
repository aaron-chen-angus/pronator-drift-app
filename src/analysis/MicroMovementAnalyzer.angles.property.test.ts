// Feature: pronator-drift-analysis, Property 5: Angle computations are bounded
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ConfigStore } from '../config/ConfigStore';
import { MicroMovementAnalyzer } from './MicroMovementAnalyzer';
import { computePalmAngle } from './PalmOrientationEstimator';
import type {
  ArmBaseline,
  Baseline,
  CVFrameResult,
  NormalizedLandmark,
  Vec3,
} from '../types';

// ─── Landmark index reference (from design.md) ───────────────────────────────
// Pose: shoulders 11/12, elbows 13/14, wrists 15/16, hips 23/24.

const POSE_INDICES = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24 },
} as const;

const POSE_LANDMARK_COUNT = 33;
const HAND_LANDMARK_COUNT = 21;
const ANGLE_TOLERANCE_DEGREES = 1e-6;
const CONFIG_TOLERANCE_DEGREES = 0.5;

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** A finite coordinate value in a reasonable range. */
const coord = (): fc.Arbitrary<number> =>
  fc.double({ min: -2, max: 2, noNaN: true, noDefaultInfinity: true });

/** A high-confidence normalized landmark (visibility 1 so frames stay confident). */
const confidentLandmark = (): fc.Arbitrary<NormalizedLandmark> =>
  fc.record({ x: coord(), y: coord(), z: coord(), visibility: fc.constant(1) });

/** A full 33-entry pose landmark array of confident landmarks. */
function poseArray(): fc.Arbitrary<NormalizedLandmark[]> {
  return fc.array(confidentLandmark(), {
    minLength: POSE_LANDMARK_COUNT,
    maxLength: POSE_LANDMARK_COUNT,
  });
}

/** A full 21-entry hand landmark array of confident landmarks. */
function handArray(): fc.Arbitrary<NormalizedLandmark[]> {
  return fc.array(confidentLandmark(), {
    minLength: HAND_LANDMARK_COUNT,
    maxLength: HAND_LANDMARK_COUNT,
  });
}

// ─── Baseline helpers ────────────────────────────────────────────────────────

function makeArmBaseline(elbowExtensionAngle: number): ArmBaseline {
  const zero: Vec3 = { x: 0, y: 0, z: 0 };
  return {
    shoulderPos: { ...zero },
    elbowPos: { ...zero },
    wristPos: { ...zero },
    normalizedWristHeight: 0,
    // Setting the baseline elbow extension angle to 0 makes the reported
    // elbowFlexionChange equal the raw Elbow_Flexion_Angle, so the [0, 180]
    // bound can be asserted directly on the change samples.
    elbowExtensionAngle,
    palmOrientationAngle: 0,
    armLength: 0.2,
  };
}

function makeBaseline(elbowExtensionAngle = 0): Baseline {
  return {
    leftArm: makeArmBaseline(elbowExtensionAngle),
    rightArm: makeArmBaseline(elbowExtensionAngle),
    torsoAngle: 0,
    shoulderWidth: 0.2,
    captureFrameCount: 5,
    captureStartTime: 0,
    captureEndTime: 1000,
  };
}

/** Build a single-pose frame from a 33-entry pose array. */
function poseFrame(timestamp: number, pose: NormalizedLandmark[]): CVFrameResult {
  return {
    timestamp,
    poseLandmarks: [pose],
    poseWorldLandmarks: null,
    handLandmarks: null,
    handedness: null,
    processingTimeMs: 16,
  };
}

/** Build a single-hand frame associated with the assessed arm. */
function handFrame(
  timestamp: number,
  arm: 'left' | 'right',
  hand: NormalizedLandmark[]
): CVFrameResult {
  return {
    timestamp,
    poseLandmarks: null,
    poseWorldLandmarks: null,
    handLandmarks: [hand],
    handedness: [{ label: arm === 'left' ? 'Left' : 'Right', score: 0.95 }],
    processingTimeMs: 16,
  };
}

/** Set a normalized landmark's x/y (z=0, full visibility) at an index in a pose array. */
function setXY(pose: NormalizedLandmark[], index: number, x: number, y: number): void {
  pose[index] = { x, y, z: 0, visibility: 1 };
}

/** A hand array with a specified wrist(0)/index-MCP(5)/middle-MCP(9) triple. */
function handWith(
  wrist: Vec3,
  indexMcp: Vec3,
  middleMcp: Vec3
): NormalizedLandmark[] {
  const hand: NormalizedLandmark[] = [];
  for (let i = 0; i < HAND_LANDMARK_COUNT; i++) {
    hand.push({ x: 0, y: 0, z: 0, visibility: 1 });
  }
  hand[0] = { ...wrist, visibility: 1 };
  hand[5] = { ...indexMcp, visibility: 1 };
  hand[9] = { ...middleMcp, visibility: 1 };
  return hand;
}

// ─── Property 5: Angle computations are bounded ──────────────────────────────

/**
 * **Validates: Requirements 4.1, 4.2, 5.1**
 *
 * Property 5: Angle computations are bounded
 *
 * For any set of landmarks, every computed angle (Elbow_Flexion_Angle,
 * Arm_To_Torso_Angle, Palm_Orientation_Angle) lies within [0, 180] degrees, and
 * known geometric configurations (straight arm ≈ 180°, right angle ≈ 90°) are
 * recovered within tolerance.
 */
describe('Property 5: Angle computations are bounded', () => {
  it('computePalmAngle is bounded to [0, 180] for any hand landmarks', () => {
    fc.assert(
      fc.property(handArray(), (hand) => {
        const angle = computePalmAngle(hand);
        expect(Number.isFinite(angle)).toBe(true);
        expect(angle).toBeGreaterThanOrEqual(0 - ANGLE_TOLERANCE_DEGREES);
        expect(angle).toBeLessThanOrEqual(180 + ANGLE_TOLERANCE_DEGREES);
      }),
      { numRuns: 200 }
    );
  });

  it('Elbow_Flexion_Angle (via elbowFlexionChange) is bounded to [0, 180] for any pose', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'left' | 'right'>('left', 'right'),
        poseArray(),
        (assessedArm, pose) => {
          const config = new ConfigStore();
          const analyzer = new MicroMovementAnalyzer(config);
          // Baseline elbow extension angle 0 => reported change == raw angle.
          analyzer.start(makeBaseline(0), assessedArm);
          analyzer.addFrame(poseFrame(1000, pose));
          const indicators = analyzer.finalize();

          const samples = indicators.elbowFlexionChange.samples;
          // A confident pose frame yields exactly one sample = the raw angle.
          for (const s of samples) {
            expect(Number.isFinite(s.value)).toBe(true);
            expect(s.value).toBeGreaterThanOrEqual(0 - ANGLE_TOLERANCE_DEGREES);
            expect(s.value).toBeLessThanOrEqual(180 + ANGLE_TOLERANCE_DEGREES);
          }
          // The reported aggregate max change (|change| over frames) is also bounded.
          expect(indicators.maxElbowFlexionChangeDegrees).toBeGreaterThanOrEqual(0);
          expect(indicators.maxElbowFlexionChangeDegrees).toBeLessThanOrEqual(
            180 + ANGLE_TOLERANCE_DEGREES
          );
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Arm_To_Torso_Angle (reconstructed from armToTorsoChange) is bounded to [0, 180] for any pose', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'left' | 'right'>('left', 'right'),
        // Two poses: the first establishes the arm-to-torso baseline reference,
        // the second is the frame under test. We reconstruct the raw angle of the
        // second frame as (change + firstFrameAngle) and assert it lies in [0,180].
        poseArray(),
        poseArray(),
        (assessedArm, poseA, poseB) => {
          const idx = POSE_INDICES[assessedArm];

          // Compute the raw arm-to-torso angle of the FIRST pose (the analyzer's
          // internal baseline) directly, using the same shoulder-vertex geometry.
          const s = poseA[idx.shoulder];
          const e = poseA[idx.elbow];
          const h = poseA[idx.hip];
          const baX = e.x - s.x;
          const baY = e.y - s.y;
          const bcX = h.x - s.x;
          const bcY = h.y - s.y;
          const magBA = Math.sqrt(baX * baX + baY * baY);
          const magBC = Math.sqrt(bcX * bcX + bcY * bcY);
          // Skip degenerate first-frame geometry (angle undefined -> no baseline).
          fc.pre(magBA > 1e-9 && magBC > 1e-9);
          const cos = Math.max(-1, Math.min(1, (baX * bcX + baY * bcY) / (magBA * magBC)));
          const firstAngle = (Math.acos(cos) * 180) / Math.PI;

          const config = new ConfigStore();
          const analyzer = new MicroMovementAnalyzer(config);
          analyzer.start(makeBaseline(0), assessedArm);
          analyzer.addFrame(poseFrame(1000, poseA));
          analyzer.addFrame(poseFrame(1033, poseB));
          const indicators = analyzer.finalize();

          const samples = indicators.armToTorsoChange.samples;
          for (const sample of samples) {
            const reconstructed = sample.value + firstAngle;
            expect(reconstructed).toBeGreaterThanOrEqual(0 - 1e-4);
            expect(reconstructed).toBeLessThanOrEqual(180 + 1e-4);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('recovers known palm configurations within tolerance (0°, 90°, 180°)', () => {
    const z: Vec3 = { x: 0, y: 0, z: 0 };
    // cross(v1=(0,1,0), v2=(1,0,0)) = (0,0,-1) -> facing camera -> 0°.
    expect(computePalmAngle(handWith(z, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }))).toBeCloseTo(
      0,
      4
    );
    // cross(v1=(0,1,0), v2=(0,0,1)) = (1,0,0) -> perpendicular -> 90°.
    expect(computePalmAngle(handWith(z, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }))).toBeCloseTo(
      90,
      4
    );
    // cross(v1=(1,0,0), v2=(0,1,0)) = (0,0,1) -> facing away -> 180°.
    expect(computePalmAngle(handWith(z, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }))).toBeCloseTo(
      180,
      4
    );
  });

  it('recovers a straight-arm elbow angle (~180°) within tolerance', () => {
    const arm: 'left' | 'right' = 'left';
    const idx = POSE_INDICES[arm];
    const pose: NormalizedLandmark[] = Array.from({ length: POSE_LANDMARK_COUNT }, () => ({
      x: 0,
      y: 0,
      z: 0,
      visibility: 1,
    }));
    // Collinear shoulder-elbow-wrist => 180° at the elbow.
    setXY(pose, idx.shoulder, 0, 0);
    setXY(pose, idx.elbow, 0, 1);
    setXY(pose, idx.wrist, 0, 2);

    const config = new ConfigStore();
    const analyzer = new MicroMovementAnalyzer(config);
    analyzer.start(makeBaseline(0), arm);
    analyzer.addFrame(poseFrame(1000, pose));
    const indicators = analyzer.finalize();

    expect(indicators.elbowFlexionChange.samples).toHaveLength(1);
    expect(indicators.elbowFlexionChange.samples[0].value).toBeCloseTo(180, 3);
  });

  it('recovers a right-angle elbow angle (~90°) within tolerance', () => {
    const arm: 'left' | 'right' = 'right';
    const idx = POSE_INDICES[arm];
    const pose: NormalizedLandmark[] = Array.from({ length: POSE_LANDMARK_COUNT }, () => ({
      x: 0,
      y: 0,
      z: 0,
      visibility: 1,
    }));
    // shoulder->elbow along +y, elbow->wrist along +x => 90° at the elbow.
    setXY(pose, idx.shoulder, 0, 0);
    setXY(pose, idx.elbow, 0, 1);
    setXY(pose, idx.wrist, 1, 1);

    const config = new ConfigStore();
    const analyzer = new MicroMovementAnalyzer(config);
    analyzer.start(makeBaseline(0), arm);
    analyzer.addFrame(poseFrame(1000, pose));
    const indicators = analyzer.finalize();

    expect(indicators.elbowFlexionChange.samples).toHaveLength(1);
    expect(indicators.elbowFlexionChange.samples[0].value).toBeCloseTo(90, 3);
  });

  it('recovers a right-angle arm-to-torso configuration (~90°) within tolerance', () => {
    const arm: 'left' | 'right' = 'left';
    const idx = POSE_INDICES[arm];

    // First frame: known 90° arm-to-torso (baseline reference). elbow along +x
    // from shoulder, hip along +y from shoulder => angle at shoulder = 90°.
    const baseP: NormalizedLandmark[] = Array.from({ length: POSE_LANDMARK_COUNT }, () => ({
      x: 0,
      y: 0,
      z: 0,
      visibility: 1,
    }));
    setXY(baseP, idx.shoulder, 0, 0);
    setXY(baseP, idx.elbow, 1, 0);
    setXY(baseP, idx.wrist, 1, 1); // wrist present so hasPose is true
    setXY(baseP, idx.hip, 0, 1);

    // Second frame: straight arm-to-torso (~180°): elbow +x, hip -x from shoulder.
    const testP: NormalizedLandmark[] = Array.from({ length: POSE_LANDMARK_COUNT }, () => ({
      x: 0,
      y: 0,
      z: 0,
      visibility: 1,
    }));
    setXY(testP, idx.shoulder, 0, 0);
    setXY(testP, idx.elbow, 1, 0);
    setXY(testP, idx.wrist, 2, 0);
    setXY(testP, idx.hip, -1, 0);

    const config = new ConfigStore();
    const analyzer = new MicroMovementAnalyzer(config);
    analyzer.start(makeBaseline(0), arm);
    analyzer.addFrame(poseFrame(1000, baseP));
    analyzer.addFrame(poseFrame(1033, testP));
    const indicators = analyzer.finalize();

    const samples = indicators.armToTorsoChange.samples;
    expect(samples.length).toBeGreaterThanOrEqual(2);
    // First sample is the baseline itself => change 0 (raw 90°).
    expect(samples[0].value).toBeCloseTo(0, 3);
    // Reconstructed raw angle of the first frame is ~90°.
    const firstRaw = 90;
    expect(samples[0].value + firstRaw).toBeCloseTo(90, CONFIG_TOLERANCE_DEGREES);
    // Second frame raw angle ~180° => change ~ +90 relative to the 90° baseline.
    expect(samples[1].value + firstRaw).toBeCloseTo(180, CONFIG_TOLERANCE_DEGREES);
  });
});
