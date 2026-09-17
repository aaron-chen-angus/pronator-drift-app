// Feature: pronator-drift-analysis, Property 26: Pose-only path measures non-hand indicators and marks hand indicators not measurable
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ConfigStore } from '../config/ConfigStore';
import { MicroMovementAnalyzer } from './MicroMovementAnalyzer';
import type {
  ArmBaseline,
  Baseline,
  CVFrameResult,
  Handedness,
  Landmark,
  NormalizedLandmark,
  Vec3,
} from '../types';

// ─── Landmark index reference (from design.md) ───────────────────────────────
// Pose: shoulders 11/12, elbows 13/14, wrists 15/16, hips 23/24.
// Hand: 21 points (0..20). Handedness label 'Left'/'Right' matches assessed arm.

const POSE_INDICES = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24 },
} as const;

const HAND_LANDMARK_COUNT = 21;
const POSE_LANDMARK_COUNT = 33;

// The default minPoseConfidence gate in ConfigStore. Frames are only confident
// (and thus contribute to indicator series) when the mean shoulder/elbow/wrist
// visibility is at or above this value.
const MIN_POSE_CONFIDENCE = 0.5;

// ─── Baseline helpers ────────────────────────────────────────────────────────

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

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** A finite coordinate value in a reasonable range. */
const coord = (): fc.Arbitrary<number> =>
  fc.double({ min: -2, max: 2, noNaN: true, noDefaultInfinity: true });

/**
 * A confident visibility value: at or above the pose-confidence gate so the
 * shoulder/elbow/wrist landmarks yield a confident frame (poseConfidence >=
 * minPoseConfidence). Kept strictly within (gate, 1] to avoid boundary jitter.
 */
const confidentVisibility = (): fc.Arbitrary<number> =>
  fc.double({ min: MIN_POSE_CONFIDENCE + 0.05, max: 1, noNaN: true, noDefaultInfinity: true });

function normalizedLandmark(vis: fc.Arbitrary<number>): fc.Arbitrary<NormalizedLandmark> {
  return fc.record({ x: coord(), y: coord(), z: coord(), visibility: vis });
}

/**
 * A confident 33-entry pose landmark array. The assessed-arm shoulder/elbow/wrist
 * carry confident visibility so the frame is a confident, pose-bearing frame.
 */
function confidentPoseArray(assessedArm: 'left' | 'right'): fc.Arbitrary<NormalizedLandmark[]> {
  return fc
    .array(normalizedLandmark(confidentVisibility()), {
      minLength: POSE_LANDMARK_COUNT,
      maxLength: POSE_LANDMARK_COUNT,
    })
    .map((arr) => {
      const idx = POSE_INDICES[assessedArm];
      // Ensure the three landmarks whose mean drives poseConfidence are confident.
      for (const i of [idx.shoulder, idx.elbow, idx.wrist]) {
        arr[i] = { ...arr[i], visibility: 0.9 };
      }
      return arr;
    });
}

function worldArray(): fc.Arbitrary<Landmark[]> {
  return fc.array(normalizedLandmark(confidentVisibility()), {
    minLength: POSE_LANDMARK_COUNT,
    maxLength: POSE_LANDMARK_COUNT,
  });
}

/** A 21-entry hand landmark array (used only for the with-hands variant). */
function handArray(): fc.Arbitrary<NormalizedLandmark[]> {
  return fc.array(normalizedLandmark(confidentVisibility()), {
    minLength: HAND_LANDMARK_COUNT,
    maxLength: HAND_LANDMARK_COUNT,
  });
}

/**
 * A per-frame plan: the pose (and optional world) landmarks and a monotonically
 * increasing timestamp. A run needs several frames so the confident, pose-based
 * indicators (including tremor/frequency/stability) have a non-empty series.
 */
interface FramePlan {
  pose: NormalizedLandmark[];
  world: Landmark[] | null;
}

function framePlans(assessedArm: 'left' | 'right'): fc.Arbitrary<FramePlan[]> {
  return fc.array(
    fc.record({
      pose: confidentPoseArray(assessedArm),
      world: fc.option(worldArray(), { nil: null }),
    }),
    { minLength: 5, maxLength: 20 }
  );
}

// ─── Frame builders ──────────────────────────────────────────────────────────

/** Build a pose-only CVFrameResult (no hand landmarks) from a plan. */
function poseOnlyFrame(plan: FramePlan, timestamp: number): CVFrameResult {
  return {
    timestamp,
    poseLandmarks: [plan.pose],
    poseWorldLandmarks: plan.world ? [plan.world] : null,
    handLandmarks: null,
    handedness: null,
    processingTimeMs: 16,
  };
}

/** Build a with-hands CVFrameResult: same pose plus a matching-handedness hand. */
function withHandsFrame(
  plan: FramePlan,
  timestamp: number,
  assessedArm: 'left' | 'right',
  hand: NormalizedLandmark[]
): CVFrameResult {
  const label: 'Left' | 'Right' = assessedArm === 'left' ? 'Left' : 'Right';
  const handedness: Handedness[] = [{ label, score: 0.95 }];
  return {
    timestamp,
    poseLandmarks: [plan.pose],
    poseWorldLandmarks: plan.world ? [plan.world] : null,
    handLandmarks: [hand],
    handedness,
    processingTimeMs: 16,
  };
}

// ─── Property 26: Pose-only path measurability ───────────────────────────────

/**
 * **Validates: Requirements 5.6, 7.4, 9.6, 15.1**
 *
 * Property 26: Pose-only path measures non-hand indicators and marks hand
 * indicators not measurable.
 *
 * When hand landmarks are unavailable for the assessed arm across the entire
 * assessment (pose-only path), finalize() computes all non-hand indicators
 * (measurable where valid pose frames exist) and marks the hand-dependent
 * indicators (palmRotationChange, fingertipTremorAmplitude, fingerCurlChange,
 * fingerSpreadChange) as not measurable; usedPoseOnlyPath is true. Conversely,
 * when matching-handedness hands ARE available on the same pose frames, the hand
 * indicators become measurable and usedPoseOnlyPath is false.
 */
describe('Property 26: Pose-only path measures non-hand indicators and marks hand indicators not measurable', () => {
  it('pose-only path: non-hand indicators measurable, hand indicators not measurable, usedPoseOnlyPath true', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'left' | 'right'>('left', 'right'),
        fc.integer({ min: 0, max: 500_000 }),
        (assessedArm, startTs) => {
          // Generate plans against the actual assessed arm so the confident pose
          // landmarks land on that arm's shoulder/elbow/wrist indices.
          const plans = fc.sample(framePlans(assessedArm), 1)[0];

          const config = new ConfigStore();
          const analyzer = new MicroMovementAnalyzer(config);
          analyzer.start(makeBaseline(), assessedArm);

          plans.forEach((plan, i) => {
            analyzer.addFrame(poseOnlyFrame(plan, startTs + i * 33));
          });

          const indicators = analyzer.finalize();

          // Pose-only path is used because no hand landmarks were ever available.
          expect(indicators.usedPoseOnlyPath).toBe(true);

          // Hand-dependent indicators are not measurable (Req 5.6, 7.4).
          expect(indicators.palmRotationChange.measurable).toBe(false);
          expect(indicators.totalPalmRotationChangeDegrees).toBeNull();
          expect(indicators.possiblePronation).toBe(false);
          expect(indicators.fingertipTremorAmplitude.measurable).toBe(false);
          expect(indicators.fingerCurlChange.measurable).toBe(false);
          expect(indicators.fingerSpreadChange.measurable).toBe(false);

          // Non-hand (pose-based) indicators are measurable where confident frames
          // exist (Req 15.1). All frames were generated as confident, pose-bearing.
          expect(indicators.elbowFlexionChange.measurable).toBe(true);
          expect(indicators.armToTorsoChange.measurable).toBe(true);
          expect(indicators.elbowDrift.measurable).toBe(true);
          expect(indicators.wristTremorAmplitude.measurable).toBe(true);
          expect(indicators.stability.measurable).toBe(true);
          expect(indicators.wristTremorDominantFrequency.measurable).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('with-hands path: hand indicators become measurable and usedPoseOnlyPath false', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'left' | 'right'>('left', 'right'),
        fc.integer({ min: 0, max: 500_000 }),
        fc.boolean(),
        (assessedArm, startTs, _seed) => {
          const plans = fc.sample(framePlans(assessedArm), 1)[0];
          const hands = fc.sample(handArray(), plans.length);

          const config = new ConfigStore();
          const analyzer = new MicroMovementAnalyzer(config);
          analyzer.start(makeBaseline(), assessedArm);

          plans.forEach((plan, i) => {
            analyzer.addFrame(withHandsFrame(plan, startTs + i * 33, assessedArm, hands[i]));
          });

          const indicators = analyzer.finalize();

          // Hands were available for the assessed arm on every frame.
          expect(indicators.usedPoseOnlyPath).toBe(false);

          // Hand-dependent indicators are now measurable.
          expect(indicators.palmRotationChange.measurable).toBe(true);
          expect(indicators.fingertipTremorAmplitude.measurable).toBe(true);
          expect(indicators.fingerCurlChange.measurable).toBe(true);
          expect(indicators.fingerSpreadChange.measurable).toBe(true);

          // Pose-based indicators remain measurable.
          expect(indicators.elbowFlexionChange.measurable).toBe(true);
          expect(indicators.armToTorsoChange.measurable).toBe(true);
          expect(indicators.elbowDrift.measurable).toBe(true);
          expect(indicators.wristTremorAmplitude.measurable).toBe(true);
          expect(indicators.stability.measurable).toBe(true);
          expect(indicators.wristTremorDominantFrequency.measurable).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
