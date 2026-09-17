// Feature: pronator-drift-analysis, Property 9: Pronation threshold flag
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

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** A finite coordinate value in a reasonable range. */
const coord = (): fc.Arbitrary<number> =>
  fc.double({ min: -2, max: 2, noNaN: true, noDefaultInfinity: true });

/**
 * A visibility confidence high enough to clear the `minPoseConfidence` gate
 * (default 0.5). Assessed-arm pose landmarks use this so generated frames are
 * treated as confident and contribute to the palm-rotation series.
 */
const confidentVisibility = (): fc.Arbitrary<number> =>
  fc.double({ min: 0.5, max: 1, noNaN: true, noDefaultInfinity: true });

/** A confident normalized pose/hand landmark (visibility >= 0.5). */
const confidentLandmark = (): fc.Arbitrary<NormalizedLandmark> =>
  fc.record({
    x: coord(),
    y: coord(),
    z: coord(),
    visibility: confidentVisibility(),
  });

/**
 * Build a 33-entry pose landmark array whose assessed-arm shoulder/elbow/wrist
 * are confident so the frame passes the `isConfidentFrame` gate.
 */
function poseArray(assessedArm: 'left' | 'right'): fc.Arbitrary<NormalizedLandmark[]> {
  return fc
    .array(confidentLandmark(), {
      minLength: POSE_LANDMARK_COUNT,
      maxLength: POSE_LANDMARK_COUNT,
    })
    .map((arr) => {
      const idx = POSE_INDICES[assessedArm];
      // Ensure the three pose landmarks required for a confident frame exist and
      // are visible (already guaranteed by confidentLandmark, but assert intent).
      for (const li of [idx.shoulder, idx.elbow, idx.wrist, idx.hip]) {
        if (arr[li].visibility < 0.5) arr[li] = { ...arr[li], visibility: 0.9 };
      }
      return arr;
    });
}

/** Generate a 21-entry hand landmark array (drives the palm-orientation angle). */
function handArray(): fc.Arbitrary<NormalizedLandmark[]> {
  return fc.array(confidentLandmark(), {
    minLength: HAND_LANDMARK_COUNT,
    maxLength: HAND_LANDMARK_COUNT,
  });
}

// ─── Minimal Baseline helper ─────────────────────────────────────────────────

function makeArmBaseline(palmOrientationAngle: number): ArmBaseline {
  const zero: Vec3 = { x: 0, y: 0, z: 0 };
  return {
    shoulderPos: { ...zero },
    elbowPos: { ...zero },
    wristPos: { ...zero },
    normalizedWristHeight: 0,
    elbowExtensionAngle: 180,
    palmOrientationAngle,
    armLength: 0.2,
  };
}

function makeBaseline(palmOrientationAngle: number): Baseline {
  return {
    leftArm: makeArmBaseline(palmOrientationAngle),
    rightArm: makeArmBaseline(palmOrientationAngle),
    torsoAngle: 0,
    shoulderWidth: 0.2,
    captureFrameCount: 5,
    captureStartTime: 0,
    captureEndTime: 1000,
  };
}

/**
 * Build a single CV frame for the assessed arm from generated pose + optional
 * hand landmarks.
 */
function makeFrame(
  assessedArm: 'left' | 'right',
  timestamp: number,
  pose: NormalizedLandmark[],
  hand: NormalizedLandmark[] | null
): CVFrameResult {
  const matchLabel: 'Left' | 'Right' = assessedArm === 'left' ? 'Left' : 'Right';
  const hands: NormalizedLandmark[][] = [];
  const handedness: Handedness[] = [];
  if (hand) {
    hands.push(hand);
    handedness.push({ label: matchLabel, score: 0.95 });
  }
  return {
    timestamp,
    poseLandmarks: [pose],
    poseWorldLandmarks: null,
    handLandmarks: hands.length > 0 ? hands : null,
    handedness: handedness.length > 0 ? handedness : null,
    processingTimeMs: 16,
  };
}

// ─── Property 9: Pronation threshold flag ────────────────────────────────────

/**
 * **Validates: Requirements 5.4**
 *
 * Property 9: Pronation threshold flag
 *
 * For any total palm rotation change, possible pronation SHALL be reported as
 * detected if and only if the absolute total rotation change is greater than or
 * equal to `minPronationChange`.
 *
 * Because directly forcing a specific palm angle requires geometry, this test
 * generates arbitrary hand-bearing frames, runs `finalize()`, reads the ACTUAL
 * `totalPalmRotationChangeDegrees` the analyzer computed, and asserts the
 * biconditional against `possiblePronation`.
 */
describe('Property 9: Pronation threshold flag', () => {
  it('reports possible pronation iff |total palm rotation change| >= minPronationChange', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'left' | 'right'>('left', 'right'),
        // Baseline palm-orientation angle (offset subtracted from each frame).
        fc.double({ min: 0, max: 180, noNaN: true, noDefaultInfinity: true }),
        // Vary the configured threshold across its permitted range [5, 90].
        fc.double({ min: 5, max: 90, noNaN: true, noDefaultInfinity: true }),
        // One or more hand-bearing frames drive the palm-rotation series.
        fc.array(
          fc.record({
            ts: fc.integer({ min: 0, max: 60_000 }),
            hand: handArray(),
          }),
          { minLength: 1, maxLength: 8 }
        ),
        fc.array(poseArray('left'), { minLength: 1, maxLength: 8 }),
        fc.array(poseArray('right'), { minLength: 1, maxLength: 8 }),
        (assessedArm, baselineAngle, minPronationChange, frameSpecs, leftPoses, rightPoses) => {
          const poses = assessedArm === 'left' ? leftPoses : rightPoses;

          const config = new ConfigStore({ minPronationChange });
          const effectiveThreshold = config.get('minPronationChange');

          const analyzer = new MicroMovementAnalyzer(config);
          analyzer.start(makeBaseline(baselineAngle), assessedArm);

          let tsBase = 0;
          frameSpecs.forEach((spec, i) => {
            const pose = poses[i % poses.length];
            tsBase += 33 + (spec.ts % 34); // monotonically increasing timestamps
            analyzer.addFrame(makeFrame(assessedArm, tsBase, pose, spec.hand));
          });

          const indicators = analyzer.finalize();
          const total = indicators.totalPalmRotationChangeDegrees;
          const flag = indicators.possiblePronation;

          // The core biconditional (Req 5.4): the flag holds exactly when a total
          // was measured and its magnitude meets/exceeds the effective threshold.
          const expected = total !== null && Math.abs(total) >= effectiveThreshold;
          expect(flag).toBe(expected);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('reports palm rotation not measurable and pronation false when no hand frames exist', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'left' | 'right'>('left', 'right'),
        fc.double({ min: 0, max: 180, noNaN: true, noDefaultInfinity: true }),
        fc.array(poseArray('left'), { minLength: 1, maxLength: 6 }),
        fc.array(poseArray('right'), { minLength: 1, maxLength: 6 }),
        (assessedArm, baselineAngle, leftPoses, rightPoses) => {
          const poses = assessedArm === 'left' ? leftPoses : rightPoses;

          const config = new ConfigStore();
          const analyzer = new MicroMovementAnalyzer(config);
          analyzer.start(makeBaseline(baselineAngle), assessedArm);

          let ts = 0;
          for (const pose of poses) {
            ts += 33;
            // No hand landmarks in any frame.
            analyzer.addFrame(makeFrame(assessedArm, ts, pose, null));
          }

          const indicators = analyzer.finalize();
          // No hand frames => not measurable (Req 5.6) and pronation not detected.
          expect(indicators.totalPalmRotationChangeDegrees).toBeNull();
          expect(indicators.possiblePronation).toBe(false);
          // The biconditional holds trivially: null total => false flag.
          expect(indicators.possiblePronation).toBe(
            indicators.totalPalmRotationChangeDegrees !== null &&
              Math.abs(indicators.totalPalmRotationChangeDegrees) >=
                config.get('minPronationChange')
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
