// Feature: pronator-drift-analysis, Property 6: Rotation change is the offset from baseline
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ConfigStore } from '../config/ConfigStore';
import { MicroMovementAnalyzer } from './MicroMovementAnalyzer';
import { computePalmAngle } from './PalmOrientationEstimator';
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
// Hand: 21 points (0..20). Palm angle uses hand landmarks 0/5/9.
// Handedness label 'Left'/'Right' matches the assessed arm.

const POSE_INDICES = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24 },
} as const;

const HAND_LANDMARK_COUNT = 21;
const POSE_LANDMARK_COUNT = 33;

// The frames must be "confident" so finalize() includes them in the summarized
// palm-rotation series. isConfidentFrame requires the assessed-arm shoulder/
// elbow/wrist mean visibility >= minPoseConfidence (default 0.5). We set
// assessed-arm pose visibility to ~0.9 to comfortably pass the gate.
const CONFIDENT_VISIBILITY = 0.9;

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** A finite coordinate value in a reasonable range. */
const coord = (): fc.Arbitrary<number> =>
  fc.double({ min: -2, max: 2, noNaN: true, noDefaultInfinity: true });

const normalizedLandmark = (): fc.Arbitrary<NormalizedLandmark> =>
  fc.record({
    x: coord(),
    y: coord(),
    z: coord(),
    visibility: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
  });

/** A hand landmark whose coordinates drive the palm-angle computation. */
const handLandmark = (): fc.Arbitrary<NormalizedLandmark> =>
  fc.record({
    x: coord(),
    y: coord(),
    z: coord(),
    visibility: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
  });

/** Generate a 21-entry hand landmark array (drives computePalmAngle via 0/5/9). */
function handArray(): fc.Arbitrary<NormalizedLandmark[]> {
  return fc.array(handLandmark(), {
    minLength: HAND_LANDMARK_COUNT,
    maxLength: HAND_LANDMARK_COUNT,
  });
}

// ─── Pose / frame construction helpers ───────────────────────────────────────

/**
 * Build a full 33-entry pose landmark array in which the assessed-arm
 * shoulder/elbow/wrist/hip carry confident visibility, so the analyzer treats
 * the frame as pose-bearing and confident (passes isConfidentFrame).
 */
function makeConfidentPose(assessedArm: 'left' | 'right'): NormalizedLandmark[] {
  const idx = POSE_INDICES[assessedArm];
  const pose: NormalizedLandmark[] = [];
  for (let i = 0; i < POSE_LANDMARK_COUNT; i++) {
    pose.push({ x: 0, y: 0, z: 0, visibility: 0 });
  }
  // Distinct positions so the arm geometry is non-degenerate; only visibility
  // matters for the confidence gate, but distinct positions keep the frame valid.
  pose[idx.shoulder] = { x: 0.5, y: 0.3, z: 0, visibility: CONFIDENT_VISIBILITY };
  pose[idx.elbow] = { x: 0.5, y: 0.5, z: 0, visibility: CONFIDENT_VISIBILITY };
  pose[idx.wrist] = { x: 0.5, y: 0.7, z: 0, visibility: CONFIDENT_VISIBILITY };
  pose[idx.hip] = { x: 0.5, y: 0.9, z: 0, visibility: CONFIDENT_VISIBILITY };
  return pose;
}

function makeFrame(
  timestamp: number,
  assessedArm: 'left' | 'right',
  hand: NormalizedLandmark[]
): CVFrameResult {
  const label: 'Left' | 'Right' = assessedArm === 'left' ? 'Left' : 'Right';
  const handedness: Handedness[] = [{ label, score: 0.95 }];
  return {
    timestamp,
    poseLandmarks: [makeConfidentPose(assessedArm)],
    poseWorldLandmarks: null,
    handLandmarks: [hand],
    handedness,
    processingTimeMs: 16,
  };
}

// ─── Baseline helpers (assessed-arm palmOrientationAngle is the offset base) ──

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

/** Baseline where the assessed arm carries the chosen palm-orientation angle. */
function makeBaseline(
  assessedArm: 'left' | 'right',
  baselinePalmAngle: number
): Baseline {
  const assessed = makeArmBaseline(baselinePalmAngle);
  const other = makeArmBaseline(0);
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

// ─── Property 6: Rotation change is the offset from baseline ─────────────────

/**
 * **Validates: Requirements 5.2**
 *
 * Property 6: Rotation change is the offset from baseline
 *
 * For any hand frame and baseline palm angle, the reported rotation change
 * equals the computed palm-orientation angle minus the baseline palm-orientation
 * angle. We drive this through the public API: construct a Baseline with a chosen
 * palmOrientationAngle for the assessed arm, add confident frames each carrying a
 * hand for the assessed arm, call finalize(), and assert each palmRotationChange
 * sample value equals computePalmAngle(thatFrameHand) - baselinePalmAngle.
 */
describe('Property 6: Rotation change is the offset from baseline', () => {
  it('reports each palm-rotation sample as (palmAngle - baselinePalmAngle)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'left' | 'right'>('left', 'right'),
        // Baseline palm-orientation angle for the assessed arm (degrees).
        fc.double({ min: 0, max: 180, noNaN: true, noDefaultInfinity: true }),
        // A sequence of hands, one per frame; at least one frame.
        fc.array(handArray(), { minLength: 1, maxLength: 12 }),
        (assessedArm, baselinePalmAngle, hands) => {
          const config = new ConfigStore();
          const analyzer = new MicroMovementAnalyzer(config);
          analyzer.start(makeBaseline(assessedArm, baselinePalmAngle), assessedArm);

          hands.forEach((hand, i) => {
            // 33ms spacing (~30 fps); relative timestamps start at 0.
            analyzer.addFrame(makeFrame(i * 33, assessedArm, hand));
          });

          const indicators = analyzer.finalize();
          const series = indicators.palmRotationChange;

          // Every confident hand frame contributes exactly one sample, so the
          // series length equals the number of frames delivered.
          expect(series.measurable).toBe(true);
          expect(series.samples).toHaveLength(hands.length);

          // Each sample value is the offset from baseline (Req 5.2).
          series.samples.forEach((sample, i) => {
            const expected = computePalmAngle(hands[i]) - baselinePalmAngle;
            expect(sample.value).toBeCloseTo(expected, 10);
          });
        }
      ),
      { numRuns: 200 }
    );
  });
});
