// Feature: pronator-drift-analysis, Property 17: Summary statistics match their mathematical definitions over valid frames
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ConfigStore } from '../config/ConfigStore';
import { MicroMovementAnalyzer } from './MicroMovementAnalyzer';
import type {
  ArmBaseline,
  Baseline,
  CVFrameResult,
  Handedness,
  IndicatorKey,
  NormalizedLandmark,
  TimeSeriesIndicator,
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

// Assessed-arm pose visibility must clear the `minPoseConfidence` gate (default
// 0.5) so finalize() treats the frame as confident and includes it in series.
const CONFIDENT_VISIBILITY = 0.9;

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const coord = (): fc.Arbitrary<number> =>
  fc.double({ min: -2, max: 2, noNaN: true, noDefaultInfinity: true });

const landmark = (): fc.Arbitrary<NormalizedLandmark> =>
  fc.record({
    x: coord(),
    y: coord(),
    z: coord(),
    visibility: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
  });

function handArray(): fc.Arbitrary<NormalizedLandmark[]> {
  return fc.array(landmark(), {
    minLength: HAND_LANDMARK_COUNT,
    maxLength: HAND_LANDMARK_COUNT,
  });
}

// ─── Pose / frame construction helpers ───────────────────────────────────────

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

const frameSpec = (): fc.Arbitrary<{
  positions: ReturnType<typeof posePositions> extends fc.Arbitrary<infer T> ? T : never;
  hand: NormalizedLandmark[] | null;
}> =>
  fc.record({
    positions: posePositions(),
    // Include a hand for many (but not all) frames so hand-dependent indicators
    // (palm rotation, tremor, finger metrics) become measurable and produce
    // multiple samples across a session.
    hand: fc.option(handArray(), { nil: null, freq: 4 }),
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

// ─── Mathematical-definition recomputation helpers ───────────────────────────

/** Arithmetic mean of the sample values. */
function meanOf(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Maximum of the sample values. */
function maxOf(values: number[]): number {
  return values.reduce((m, v) => (v > m ? v : m), values[0]);
}

/**
 * Population standard deviation (divisor N), matching the analyzer's
 * summarize(). Returns null when fewer than two samples.
 */
function populationStd(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = meanOf(values);
  const variance =
    values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / values.length;
  return Math.sqrt(variance);
}

/** All indicator keys whose summaries are checked. */
const INDICATOR_KEYS: IndicatorKey[] = [
  'wristDrift',
  'elbowDrift',
  'elbowFlexionChange',
  'armToTorsoChange',
  'palmRotationChange',
  'wristTremorAmplitude',
  'fingertipTremorAmplitude',
  'wristTremorDominantFrequency',
  'stability',
  'fingerCurlChange',
  'fingerSpreadChange',
];

// ─── Property 17: Summary statistics match their mathematical definitions ─────

/**
 * **Validates: Requirements 8.1, 8.3, 8.4**
 *
 * Property 17: Summary statistics match their mathematical definitions over
 * valid frames.
 *
 * For each measurable time-series indicator produced by finalize(), the summary
 * { mean, max, standardDeviation, validFrameCount } matches the mathematical
 * definitions computed directly over that indicator's samples:
 *   - mean = average of sample values
 *   - max = maximum of sample values
 *   - standardDeviation = population std (sqrt(mean of squared deviations)) when
 *     validFrameCount >= 2, else null
 *   - validFrameCount = samples.length
 */
describe('Property 17: Summary statistics match their mathematical definitions over valid frames', () => {
  it('recomputes mean/max/populationStd/validFrameCount and matches each indicator summary', () => {
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

          for (const key of INDICATOR_KEYS) {
            const indicator = indicators[key] as TimeSeriesIndicator;
            const summary = indicator.summary;
            const values = indicator.samples.map((s) => s.value);

            // validFrameCount === samples.length (Req 8.4)
            expect(summary.validFrameCount).toBe(values.length);

            if (values.length === 0) {
              // No valid frames: all aggregates null (Req 8.1, 8.3).
              expect(summary.mean).toBeNull();
              expect(summary.max).toBeNull();
              expect(summary.standardDeviation).toBeNull();
              continue;
            }

            // mean = average of sample values (Req 8.1)
            expect(summary.mean).not.toBeNull();
            expect(summary.mean as number).toBeCloseTo(meanOf(values), 8);

            // max = maximum of sample values (Req 8.1)
            expect(summary.max).not.toBeNull();
            expect(summary.max as number).toBeCloseTo(maxOf(values), 8);

            // standardDeviation = population std when >= 2 samples, else null (Req 8.3)
            const expectedStd = populationStd(values);
            if (expectedStd === null) {
              expect(values.length).toBeLessThan(2);
              expect(summary.standardDeviation).toBeNull();
            } else {
              expect(values.length).toBeGreaterThanOrEqual(2);
              expect(summary.standardDeviation).not.toBeNull();
              expect(summary.standardDeviation as number).toBeCloseTo(expectedStd, 8);
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
