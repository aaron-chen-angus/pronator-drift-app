// Feature: pronator-drift-analysis, Property 1: Capture fidelity
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

/** A visibility confidence in [0, 1]. */
const visibility = (): fc.Arbitrary<number> =>
  fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });

const normalizedLandmark = (): fc.Arbitrary<NormalizedLandmark> =>
  fc.record({
    x: coord(),
    y: coord(),
    z: coord(),
    visibility: visibility(),
  });

const worldLandmark = (): fc.Arbitrary<Landmark> =>
  fc.record({
    x: coord(),
    y: coord(),
    z: coord(),
    visibility: visibility(),
  });

/** Generate a full 33-entry pose landmark array with distinct random values. */
function poseArray(): fc.Arbitrary<NormalizedLandmark[]> {
  return fc.array(normalizedLandmark(), {
    minLength: POSE_LANDMARK_COUNT,
    maxLength: POSE_LANDMARK_COUNT,
  });
}

function worldArray(): fc.Arbitrary<Landmark[]> {
  return fc.array(worldLandmark(), {
    minLength: POSE_LANDMARK_COUNT,
    maxLength: POSE_LANDMARK_COUNT,
  });
}

/** Generate a 21-entry hand landmark array. */
function handArray(): fc.Arbitrary<NormalizedLandmark[]> {
  return fc.array(normalizedLandmark(), {
    minLength: HAND_LANDMARK_COUNT,
    maxLength: HAND_LANDMARK_COUNT,
  });
}

// ─── Minimal Baseline helper ─────────────────────────────────────────────────

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

function expectLandmarkEqual(
  actual: { x: number; y: number; z: number; visibility: number } | null,
  expected: NormalizedLandmark | Landmark
): void {
  expect(actual).not.toBeNull();
  expect(actual!.x).toBe(expected.x);
  expect(actual!.y).toBe(expected.y);
  expect(actual!.z).toBe(expected.z);
  expect(actual!.visibility).toBe(expected.visibility);
}

// ─── Property 1: Capture fidelity ────────────────────────────────────────────

/**
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**
 *
 * Property 1: Capture fidelity
 *
 * For any CVFrameResult that contains assessed-arm pose landmarks (optionally
 * world landmarks and optionally a hand whose handedness label matches the
 * assessed arm), the captured frame faithfully reproduces the assessed-arm
 * shoulder/elbow/wrist/hip positions, world positions when present, all 21 hand
 * landmarks of the correctly-associated hand, the timestamp, and per-landmark
 * visibility.
 */
describe('Property 1: Capture fidelity', () => {
  it('reproduces assessed-arm pose/world/hand landmarks, timestamp, and visibility', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'left' | 'right'>('left', 'right'),
        fc.integer({ min: 0, max: 1_000_000 }),
        poseArray(),
        fc.option(worldArray(), { nil: null }),
        // Optional hand for the assessed arm; when present its handedness label
        // matches the assessed arm and it carries a full 21-point hand.
        fc.option(handArray(), { nil: null }),
        // Optional distractor hand of the opposite handedness that must NOT be
        // associated with the assessed arm.
        fc.option(handArray(), { nil: null }),
        // Randomize which slot the matching hand occupies among the hands array.
        fc.boolean(),
        (assessedArm, timestamp, pose, world, matchingHand, otherHand, matchFirst) => {
          const idx = POSE_INDICES[assessedArm];
          const matchLabel: 'Left' | 'Right' = assessedArm === 'left' ? 'Left' : 'Right';
          const otherLabel: 'Left' | 'Right' = assessedArm === 'left' ? 'Right' : 'Left';

          // Assemble the hands + handedness arrays.
          const hands: NormalizedLandmark[][] = [];
          const handedness: Handedness[] = [];
          if (matchingHand && otherHand) {
            if (matchFirst) {
              hands.push(matchingHand, otherHand);
              handedness.push(
                { label: matchLabel, score: 0.95 },
                { label: otherLabel, score: 0.9 }
              );
            } else {
              hands.push(otherHand, matchingHand);
              handedness.push(
                { label: otherLabel, score: 0.9 },
                { label: matchLabel, score: 0.95 }
              );
            }
          } else if (matchingHand) {
            hands.push(matchingHand);
            handedness.push({ label: matchLabel, score: 0.95 });
          } else if (otherHand) {
            hands.push(otherHand);
            handedness.push({ label: otherLabel, score: 0.9 });
          }

          const frame: CVFrameResult = {
            timestamp,
            poseLandmarks: [pose],
            poseWorldLandmarks: world ? [world] : null,
            handLandmarks: hands.length > 0 ? hands : null,
            handedness: handedness.length > 0 ? handedness : null,
            processingTimeMs: 16,
          };

          const config = new ConfigStore();
          const analyzer = new MicroMovementAnalyzer(config);
          analyzer.start(makeBaseline(), assessedArm);
          analyzer.addFrame(frame);

          const captured = analyzer.getCapturedFrames();
          expect(captured).toHaveLength(1);
          const cf = captured[0];

          // Timestamp fidelity (Req 2.5).
          expect(cf.timestamp).toBe(timestamp);
          expect(cf.hasPose).toBe(true);

          // Assessed-arm shoulder/elbow/wrist/hip positions + visibility (Req 2.1, 2.5).
          expectLandmarkEqual(cf.shoulder, pose[idx.shoulder]);
          expectLandmarkEqual(cf.elbow, pose[idx.elbow]);
          expectLandmarkEqual(cf.wrist, pose[idx.wrist]);
          expectLandmarkEqual(cf.hip, pose[idx.hip]);

          // World positions reproduced when present, null otherwise (Req 2.2).
          if (world) {
            expectLandmarkEqual(cf.worldShoulder, world[idx.shoulder]);
            expectLandmarkEqual(cf.worldElbow, world[idx.elbow]);
            expectLandmarkEqual(cf.worldWrist, world[idx.wrist]);
          } else {
            expect(cf.worldShoulder).toBeNull();
            expect(cf.worldElbow).toBeNull();
            expect(cf.worldWrist).toBeNull();
          }

          // Hand association by handedness label (Req 2.3, 2.4).
          if (matchingHand) {
            expect(cf.handLandmarks).not.toBeNull();
            expect(cf.handLandmarks).toHaveLength(HAND_LANDMARK_COUNT);
            for (let i = 0; i < HAND_LANDMARK_COUNT; i++) {
              expectLandmarkEqual(cf.handLandmarks![i], matchingHand[i]);
            }
          } else {
            // No hand whose label matches the assessed arm -> not associated.
            expect(cf.handLandmarks).toBeNull();
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
