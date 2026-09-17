// Feature: pronator-drift-analysis, Property 10: Monotonic rotation implies a supination-to-pronation trend
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
// Hand: 21 points (0..20); computePalmAngle uses 0 (wrist), 5 (index MCP), 9 (middle MCP).

const POSE_INDICES = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24 },
} as const;

const HAND_LANDMARK_COUNT = 21;
const POSE_LANDMARK_COUNT = 33;

// The analyzer only summarizes "confident" frames: hasPose && poseConfidence >= minPoseConfidence.
// The default minPoseConfidence is 0.5, so pose visibility must be comfortably above it.
const HIGH_VISIBILITY = 0.95;

// ─── Baseline helpers ─────────────────────────────────────────────────────────

function makeArmBaseline(): ArmBaseline {
  const zero: Vec3 = { x: 0, y: 0, z: 0 };
  return {
    shoulderPos: { ...zero },
    elbowPos: { ...zero },
    wristPos: { ...zero },
    normalizedWristHeight: 0,
    elbowExtensionAngle: 180,
    palmOrientationAngle: 0,
    armLength: 0.2,
  };
}

function makeBaseline(): Baseline {
  return {
    leftArm: makeArmBaseline(),
    rightArm: makeArmBaseline(),
    torsoAngle: 0,
    shoulderWidth: 0.2,
    captureFrameCount: 5,
    captureStartTime: 0,
    captureEndTime: 1000,
  };
}

// ─── Frame construction helpers ───────────────────────────────────────────────

/** A pose landmark with high visibility so the frame passes the confidence gate. */
function poseLm(x: number, y: number, z: number): NormalizedLandmark {
  return { x, y, z, visibility: HIGH_VISIBILITY };
}

/**
 * Build a full 33-entry pose landmark array where the assessed-arm
 * shoulder/elbow/wrist/hip carry high-visibility, non-degenerate geometry so the
 * frame is captured with `hasPose === true` and passes `isConfidentFrame`.
 */
function buildPose(assessedArm: 'left' | 'right'): NormalizedLandmark[] {
  const idx = POSE_INDICES[assessedArm];
  const pose: NormalizedLandmark[] = [];
  for (let i = 0; i < POSE_LANDMARK_COUNT; i++) {
    pose.push(poseLm(0, 0, 0));
  }
  // Distinct, non-collinear positions so joint geometry is well-defined.
  pose[idx.shoulder] = poseLm(0.5, 0.3, 0);
  pose[idx.elbow] = poseLm(0.6, 0.5, 0);
  pose[idx.wrist] = poseLm(0.7, 0.7, 0);
  pose[idx.hip] = poseLm(0.5, 0.8, 0);
  return pose;
}

/**
 * Build a 21-point hand whose palm-orientation angle is controlled by `theta`
 * (in degrees). Using computePalmAngle with landmarks 0/5/9:
 *   wrist(0)      = (0, 0, 0)
 *   indexMCP(5)   = v1 = (1, 0, 0)
 *   middleMCP(9)  = v2 = (0, cosθ, sinθ)
 * cross(v1, v2) = (0, -sinθ, cosθ) -> nz = cosθ, mag = 1
 * palmAngle = acos(-nz) = acos(-cosθ) = 180° - θ  (θ in [0,180]).
 *
 * So the palm angle is a deterministic function of θ. Decreasing θ increases the
 * palm angle monotonically, which we use to build monotonic scenarios.
 */
function buildHand(thetaDeg: number): NormalizedLandmark[] {
  const hand: NormalizedLandmark[] = [];
  for (let i = 0; i < HAND_LANDMARK_COUNT; i++) {
    hand.push({ x: 0, y: 0, z: 0, visibility: HIGH_VISIBILITY });
  }
  const theta = (thetaDeg * Math.PI) / 180;
  hand[0] = { x: 0, y: 0, z: 0, visibility: HIGH_VISIBILITY };
  hand[5] = { x: 1, y: 0, z: 0, visibility: HIGH_VISIBILITY };
  hand[9] = { x: 0, y: Math.cos(theta), z: Math.sin(theta), visibility: HIGH_VISIBILITY };
  return hand;
}

/** Assemble a CVFrameResult with assessed-arm pose and (optionally) a matching hand. */
function buildFrame(
  assessedArm: 'left' | 'right',
  timestamp: number,
  hand: NormalizedLandmark[] | null
): CVFrameResult {
  const matchLabel: 'Left' | 'Right' = assessedArm === 'left' ? 'Left' : 'Right';
  return {
    timestamp,
    poseLandmarks: [buildPose(assessedArm)],
    poseWorldLandmarks: null,
    handLandmarks: hand ? [hand] : null,
    handedness: hand ? [{ label: matchLabel, score: 0.95 }] : null,
    processingTimeMs: 16,
  };
}

// ─── Invariant helpers (mirror the analyzer's definition) ─────────────────────

function isNonDecreasing(values: number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[i - 1]) return false;
  }
  return true;
}

/**
 * The expected supination-to-pronation trend per the analyzer's contract
 * (buildPalmRotationSeries): trend is true iff there are at least two palm-rotation
 * samples, the sample values are non-decreasing, and the last value strictly
 * exceeds the first.
 */
function expectedTrend(sampleValues: number[]): boolean {
  return (
    sampleValues.length >= 2 &&
    isNonDecreasing(sampleValues) &&
    sampleValues[sampleValues.length - 1] > sampleValues[0]
  );
}

function runAnalyzer(assessedArm: 'left' | 'right', frames: CVFrameResult[]) {
  const analyzer = new MicroMovementAnalyzer(new ConfigStore());
  analyzer.start(makeBaseline(), assessedArm);
  for (const frame of frames) analyzer.addFrame(frame);
  return analyzer.finalize();
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const assessedArmArb = fc.constantFrom<'left' | 'right'>('left', 'right');

/** A palm-controlling θ in a range that yields well-defined, varied palm angles. */
const thetaArb = (): fc.Arbitrary<number> =>
  fc.double({ min: 5, max: 175, noNaN: true, noDefaultInfinity: true });

// ─── Property 10 ──────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 5.5**
 *
 * Property 10: Monotonic rotation implies a supination-to-pronation trend
 *
 * For any palm-rotation series that increases monotonically toward pronation, the
 * supinationToPronationTrend indicator is reported as detected; for any non-monotone
 * or decreasing series it is NOT reported as a trend.
 *
 * Because directly controlling the exact per-frame palm angle from hand geometry is
 * indirect, the most reliable universal check reads the ACTUAL palm-rotation samples
 * the analyzer produced for generated frames and asserts the analyzer's invariant:
 *   trend === (samples.length >= 2 && isNonDecreasing(values) && last > first).
 * Deterministic monotonic / decreasing / non-monotone / no-hand scenarios are added
 * to exercise both true and false outcomes concretely.
 */
describe('Property 10: Monotonic rotation implies a supination-to-pronation trend', () => {
  it('trend equals the non-decreasing-with-net-increase invariant over the actual palm-rotation samples', () => {
    fc.assert(
      fc.property(
        assessedArmArb,
        // A sequence of hand orientations (θ values) producing an arbitrary
        // palm-rotation series; also allow some frames to lack a hand.
        fc.array(fc.option(thetaArb(), { nil: null }), { minLength: 0, maxLength: 40 }),
        (assessedArm, thetas) => {
          const frames = thetas.map((theta, i) =>
            buildFrame(assessedArm, i * 33, theta === null ? null : buildHand(theta))
          );

          const result = runAnalyzer(assessedArm, frames);
          const sampleValues = result.palmRotationChange.samples.map((s) => s.value);

          expect(result.supinationToPronationTrend).toBe(expectedTrend(sampleValues));
        }
      ),
      { numRuns: 200 }
    );
  });

  it('reports a trend for a strictly monotonic supination-to-pronation series', () => {
    fc.assert(
      fc.property(
        assessedArmArb,
        // At least two frames; a strictly decreasing θ sequence yields a strictly
        // increasing palm angle (palmAngle = 180 - θ), i.e. rotation toward pronation.
        fc.integer({ min: 2, max: 30 }),
        (assessedArm, count) => {
          const frames: CVFrameResult[] = [];
          for (let i = 0; i < count; i++) {
            // θ decreases by a fixed step -> palm angle strictly increases.
            const theta = 150 - i * 3;
            frames.push(buildFrame(assessedArm, i * 33, buildHand(theta)));
          }

          const result = runAnalyzer(assessedArm, frames);
          const sampleValues = result.palmRotationChange.samples.map((s) => s.value);

          // Sanity: the constructed series is strictly increasing, so the invariant
          // predicts a detected trend, and the analyzer agrees.
          expect(isNonDecreasing(sampleValues)).toBe(true);
          expect(sampleValues[sampleValues.length - 1]).toBeGreaterThan(sampleValues[0]);
          expect(result.supinationToPronationTrend).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('does not report a trend for a strictly decreasing series', () => {
    const assessedArm: 'left' | 'right' = 'right';
    const frames: CVFrameResult[] = [];
    for (let i = 0; i < 10; i++) {
      // θ increases -> palm angle strictly decreases (rotation away from pronation).
      const theta = 30 + i * 5;
      frames.push(buildFrame(assessedArm, i * 33, buildHand(theta)));
    }

    const result = runAnalyzer(assessedArm, frames);
    const sampleValues = result.palmRotationChange.samples.map((s) => s.value);

    expect(sampleValues.length).toBeGreaterThanOrEqual(2);
    // Series decreases, so it is neither non-decreasing nor net-increasing.
    expect(result.supinationToPronationTrend).toBe(false);
    expect(result.supinationToPronationTrend).toBe(expectedTrend(sampleValues));
  });

  it('does not report a trend for a non-monotone series', () => {
    const assessedArm: 'left' | 'right' = 'left';
    // θ goes down then up -> palm angle goes up then down (a peak), non-monotone.
    const thetaSeq = [150, 130, 110, 130, 150];
    const frames = thetaSeq.map((theta, i) =>
      buildFrame(assessedArm, i * 33, buildHand(theta))
    );

    const result = runAnalyzer(assessedArm, frames);
    const sampleValues = result.palmRotationChange.samples.map((s) => s.value);

    expect(sampleValues.length).toBeGreaterThanOrEqual(2);
    expect(isNonDecreasing(sampleValues)).toBe(false);
    expect(result.supinationToPronationTrend).toBe(false);
    expect(result.supinationToPronationTrend).toBe(expectedTrend(sampleValues));
  });

  it('does not report a trend when fewer than two hand frames are available', () => {
    fc.assert(
      fc.property(
        assessedArmArb,
        // Zero or one hand frame among otherwise hand-less (pose-only) frames.
        fc.integer({ min: 0, max: 1 }),
        fc.integer({ min: 0, max: 8 }),
        (assessedArm, handCount, poseOnlyCount) => {
          const frames: CVFrameResult[] = [];
          let ts = 0;
          for (let i = 0; i < handCount; i++) {
            frames.push(buildFrame(assessedArm, ts, buildHand(90)));
            ts += 33;
          }
          for (let i = 0; i < poseOnlyCount; i++) {
            frames.push(buildFrame(assessedArm, ts, null));
            ts += 33;
          }

          const result = runAnalyzer(assessedArm, frames);
          const sampleValues = result.palmRotationChange.samples.map((s) => s.value);

          // With <2 palm-rotation samples the trend must be false.
          expect(sampleValues.length).toBeLessThanOrEqual(1);
          expect(result.supinationToPronationTrend).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
