// Feature: pronator-drift-analysis, Property 4: Reported aggregate equals the extremum of its per-frame series
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ConfigStore } from '../config/ConfigStore';
import { MicroMovementAnalyzer } from './MicroMovementAnalyzer';
import type {
  ArmBaseline,
  Baseline,
  CVFrameResult,
  Handedness,
  NormalizedLandmark,
  Vec3,
} from '../types';

// ─── Landmark index reference (from design.md) ───────────────────────────────
// Pose: shoulders 11/12, elbows 13/14, wrists 15/16, hips 23/24.
// Hand: 21 points (0..20). Palm angle uses hand landmarks 0/5/9.
// Handedness label 'Left'/'Right' matches the assessed arm.

const POSE_INDICES = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24 },
} as const;

const HAND_LANDMARK_COUNT = 21;
const POSE_LANDMARK_COUNT = 33;

// Assessed-arm pose visibility must clear the `minPoseConfidence` gate (default
// 0.5) so finalize() treats the frame as confident and includes it in the
// summarized per-frame series.
const CONFIDENT_VISIBILITY = 0.9;

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** A finite coordinate value in a reasonable range. */
const coord = (): fc.Arbitrary<number> =>
  fc.double({ min: -2, max: 2, noNaN: true, noDefaultInfinity: true });

/** A confident normalized landmark (used for pose + hand points). */
const landmark = (): fc.Arbitrary<NormalizedLandmark> =>
  fc.record({
    x: coord(),
    y: coord(),
    z: coord(),
    visibility: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
  });

/** Generate a 21-entry hand landmark array (drives computePalmAngle via 0/5/9). */
function handArray(): fc.Arbitrary<NormalizedLandmark[]> {
  return fc.array(landmark(), {
    minLength: HAND_LANDMARK_COUNT,
    maxLength: HAND_LANDMARK_COUNT,
  });
}

// ─── Pose / frame construction helpers ───────────────────────────────────────

/**
 * Build a full 33-entry pose landmark array in which the assessed-arm
 * shoulder/elbow/wrist/hip carry confident visibility so the analyzer treats the
 * frame as pose-bearing and confident (passes isConfidentFrame). The arm/hip
 * positions are generated so that elbow drift, elbow-flexion, and arm-to-torso
 * angles vary frame to frame.
 */
function makeConfidentPose(
  assessedArm: 'left' | 'right',
  positions: {
    shoulder: { x: number; y: number };
    elbow: { x: number; y: number };
    wrist: { x: number; y: number };
    hip: { x: number; y: number };
  }
): NormalizedLandmark[] {
  const idx = POSE_INDICES[assessedArm];
  const pose: NormalizedLandmark[] = [];
  for (let i = 0; i < POSE_LANDMARK_COUNT; i++) {
    pose.push({ x: 0, y: 0, z: 0, visibility: 0 });
  }
  pose[idx.shoulder] = {
    x: positions.shoulder.x,
    y: positions.shoulder.y,
    z: 0,
    visibility: CONFIDENT_VISIBILITY,
  };
  pose[idx.elbow] = {
    x: positions.elbow.x,
    y: positions.elbow.y,
    z: 0,
    visibility: CONFIDENT_VISIBILITY,
  };
  pose[idx.wrist] = {
    x: positions.wrist.x,
    y: positions.wrist.y,
    z: 0,
    visibility: CONFIDENT_VISIBILITY,
  };
  pose[idx.hip] = {
    x: positions.hip.x,
    y: positions.hip.y,
    z: 0,
    visibility: CONFIDENT_VISIBILITY,
  };
  return pose;
}

/** Arbitrary for the four assessed-arm pose positions of a single frame. */
const posePositions = (): fc.Arbitrary<{
  shoulder: { x: number; y: number };
  elbow: { x: number; y: number };
  wrist: { x: number; y: number };
  hip: { x: number; y: number };
}> =>
  fc.record({
    shoulder: fc.record({ x: coord(), y: coord() }),
    elbow: fc.record({ x: coord(), y: coord() }),
    wrist: fc.record({ x: coord(), y: coord() }),
    hip: fc.record({ x: coord(), y: coord() }),
  });

/**
 * A single frame spec: pose positions plus an optional hand for the assessed arm.
 * Including a hand for some (but not necessarily all) frames exercises the
 * palm-rotation series alongside the pose-only series.
 */
const frameSpec = (): fc.Arbitrary<{
  positions: ReturnType<typeof posePositions> extends fc.Arbitrary<infer T> ? T : never;
  hand: NormalizedLandmark[] | null;
}> =>
  fc.record({
    positions: posePositions(),
    hand: fc.option(handArray(), { nil: null }),
  });

function makeFrame(
  timestamp: number,
  assessedArm: 'left' | 'right',
  positions: Parameters<typeof makeConfidentPose>[1],
  hand: NormalizedLandmark[] | null
): CVFrameResult {
  const label: 'Left' | 'Right' = assessedArm === 'left' ? 'Left' : 'Right';
  const hands: NormalizedLandmark[][] = [];
  const handedness: Handedness[] = [];
  if (hand) {
    hands.push(hand);
    handedness.push({ label, score: 0.95 });
  }
  return {
    timestamp,
    poseLandmarks: [makeConfidentPose(assessedArm, positions)],
    poseWorldLandmarks: null,
    handLandmarks: hands.length > 0 ? hands : null,
    handedness: handedness.length > 0 ? handedness : null,
    processingTimeMs: 16,
  };
}

// ─── Baseline helpers ─────────────────────────────────────────────────────────

function makeArmBaseline(palmOrientationAngle: number, elbowExtensionAngle: number): ArmBaseline {
  const zero: Vec3 = { x: 0, y: 0, z: 0 };
  return {
    shoulderPos: { ...zero },
    elbowPos: { ...zero },
    wristPos: { ...zero },
    normalizedWristHeight: 0,
    elbowExtensionAngle,
    palmOrientationAngle,
    armLength: 0.2,
  };
}

function makeBaseline(
  assessedArm: 'left' | 'right',
  baselinePalmAngle: number,
  baselineElbowAngle: number
): Baseline {
  const assessed = makeArmBaseline(baselinePalmAngle, baselineElbowAngle);
  const other = makeArmBaseline(0, 180);
  return {
    leftArm: assessedArm === 'left' ? assessed : other,
    rightArm: assessedArm === 'right' ? assessed : other,
    torsoAngle: 0,
    shoulderWidth: 0.2,
    captureFrameCount: 5,
    captureStartTime: 0,
    captureEndTime: 1000,
  };
}

// ─── Extremum recomputation helpers ──────────────────────────────────────────

/** Max over samples of |value|; 0 when empty (matching analyzer aggregate default). */
function maxAbs(values: number[]): number {
  return values.length > 0 ? Math.max(...values.map((v) => Math.abs(v))) : 0;
}

/** Max over samples of value; 0 when empty. */
function maxValue(values: number[]): number {
  return values.length > 0 ? Math.max(...values) : 0;
}

/**
 * Extremum by absolute value with sign preserved (matches the analyzer's
 * definition of totalPalmRotationChangeDegrees); null when empty.
 */
function extremumBySignedAbs(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best), values[0]);
}

// ─── Property 4: Reported aggregate equals the extremum of its per-frame series ─

/**
 * **Validates: Requirements 3.1, 3.2, 4.3, 4.4, 5.3**
 *
 * Property 4: Reported aggregate equals the extremum of its per-frame series
 *
 * For each per-frame indicator series produced by finalize(), the reported
 * aggregate equals the corresponding extremum computed directly from that
 * indicator's returned per-frame samples:
 *   - maxElbowFlexionChangeDegrees === max over elbowFlexionChange.samples of |value|
 *   - maxArmToTorsoChangeDegrees === max over armToTorsoChange.samples of |value|
 *   - totalPalmRotationChangeDegrees === the palmRotationChange sample with the
 *     largest absolute value (sign preserved); null when no samples
 *   - elbowDrift.summary.max === max over elbowDrift.samples of value
 */
describe('Property 4: Reported aggregate equals the extremum of its per-frame series', () => {
  it('reports each aggregate as the extremum of its returned per-frame series', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'left' | 'right'>('left', 'right'),
        fc.double({ min: 0, max: 180, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 180, noNaN: true, noDefaultInfinity: true }),
        fc.array(frameSpec(), { minLength: 1, maxLength: 15 }),
        (assessedArm, baselinePalmAngle, baselineElbowAngle, specs) => {
          const config = new ConfigStore();
          const analyzer = new MicroMovementAnalyzer(config);
          analyzer.start(
            makeBaseline(assessedArm, baselinePalmAngle, baselineElbowAngle),
            assessedArm
          );

          specs.forEach((spec, i) => {
            analyzer.addFrame(makeFrame(i * 33, assessedArm, spec.positions, spec.hand));
          });

          const indicators = analyzer.finalize();

          // ── Elbow flexion change: max aggregate == max |sample| ──────────────
          const elbowFlexionValues = indicators.elbowFlexionChange.samples.map((s) => s.value);
          expect(indicators.maxElbowFlexionChangeDegrees).toBeCloseTo(
            maxAbs(elbowFlexionValues),
            10
          );

          // ── Arm-to-torso change: max aggregate == max |sample| ───────────────
          const armToTorsoValues = indicators.armToTorsoChange.samples.map((s) => s.value);
          expect(indicators.maxArmToTorsoChangeDegrees).toBeCloseTo(
            maxAbs(armToTorsoValues),
            10
          );

          // ── Palm rotation: total == signed extremum by abs value (or null) ───
          const palmValues = indicators.palmRotationChange.samples.map((s) => s.value);
          const expectedTotal = extremumBySignedAbs(palmValues);
          if (expectedTotal === null) {
            expect(indicators.totalPalmRotationChangeDegrees).toBeNull();
          } else {
            expect(indicators.totalPalmRotationChangeDegrees).not.toBeNull();
            expect(indicators.totalPalmRotationChangeDegrees as number).toBeCloseTo(
              expectedTotal,
              10
            );
          }

          // ── Elbow drift: summary.max == max sample value (non-negative) ──────
          const elbowDriftValues = indicators.elbowDrift.samples.map((s) => s.value);
          if (elbowDriftValues.length === 0) {
            expect(indicators.elbowDrift.summary.max).toBeNull();
          } else {
            expect(indicators.elbowDrift.summary.max).not.toBeNull();
            expect(indicators.elbowDrift.summary.max as number).toBeCloseTo(
              maxValue(elbowDriftValues),
              10
            );
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
