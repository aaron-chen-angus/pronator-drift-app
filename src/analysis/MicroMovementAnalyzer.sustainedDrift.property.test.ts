// Feature: pronator-drift-analysis, Property 8: Sustained drift reflects continuous run length
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ConfigStore } from '../config/ConfigStore';
import { MicroMovementAnalyzer } from './MicroMovementAnalyzer';
import type {
  ArmBaseline,
  Baseline,
  CVFrameResult,
  NormalizedLandmark,
  Vec3,
} from '../types';

// ─── Landmark index reference (from design.md) ───────────────────────────────
// Pose: shoulders 11/12, elbows 13/14, wrists 15/16, hips 23/24.
// The assessed-arm shoulder/elbow/wrist must be present and confident
// (visibility >= minPoseConfidence, default 0.5) for a frame to contribute to
// the elbow-drift series.

const POSE_INDICES = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24 },
} as const;

const POSE_LANDMARK_COUNT = 33;

// ─── Known baseline geometry ─────────────────────────────────────────────────
// Fix baseline elbow y and arm length so the elbow-drift computation is exactly
// predictable: drift = max(0, (elbow.y - BASELINE_ELBOW_Y) / ARM_LENGTH).
const BASELINE_ELBOW_Y = 0.5;
const ARM_LENGTH = 0.2;

// Fixed shoulder / wrist positions; only elbow.y varies frame to frame.
const FIXED_SHOULDER = { x: 0.4, y: 0.3 };
const FIXED_WRIST = { x: 0.6, y: 0.7 };
const FIXED_ELBOW_X = 0.5;

// ─── Baseline helpers ────────────────────────────────────────────────────────

function makeArmBaseline(): ArmBaseline {
  const zero: Vec3 = { x: 0, y: 0, z: 0 };
  return {
    shoulderPos: { ...FIXED_SHOULDER, z: 0 },
    // Only elbowPos.y and armLength matter for the elbow-drift computation.
    elbowPos: { x: FIXED_ELBOW_X, y: BASELINE_ELBOW_Y, z: 0 },
    wristPos: { ...FIXED_WRIST, z: 0 },
    normalizedWristHeight: 0,
    elbowExtensionAngle: 180,
    palmOrientationAngle: 0,
    armLength: ARM_LENGTH,
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

// ─── Frame construction ──────────────────────────────────────────────────────

/** A confident normalized landmark at a fixed position. */
function lm(x: number, y: number): NormalizedLandmark {
  return { x, y, z: 0, visibility: 0.9 };
}

/**
 * Build a confident assessed-arm CV frame at the given timestamp whose elbow y
 * is BASELINE_ELBOW_Y + offset. Shoulder, wrist, and hip are fixed & confident so
 * the frame passes the confident-frame gate and hasPose is true.
 */
function makeFrame(
  assessedArm: 'left' | 'right',
  timestamp: number,
  elbowOffset: number
): CVFrameResult {
  const idx = POSE_INDICES[assessedArm];
  const pose: NormalizedLandmark[] = new Array(POSE_LANDMARK_COUNT)
    .fill(null)
    .map(() => lm(0.5, 0.5));
  pose[idx.shoulder] = lm(FIXED_SHOULDER.x, FIXED_SHOULDER.y);
  pose[idx.elbow] = lm(FIXED_ELBOW_X, BASELINE_ELBOW_Y + elbowOffset);
  pose[idx.wrist] = lm(FIXED_WRIST.x, FIXED_WRIST.y);
  pose[idx.hip] = lm(0.45, 0.9);

  return {
    timestamp,
    poseLandmarks: [pose],
    poseWorldLandmarks: null,
    handLandmarks: null,
    handedness: null,
    processingTimeMs: 16,
  };
}

// ─── Independent reference computation ───────────────────────────────────────
// Mirror the analyzer's elbow-drift + sustained-drift logic exactly, computed
// from the same inputs, so the test is a genuine independent oracle.

interface FrameSpec {
  ts: number; // absolute timestamp (ms)
  offset: number; // elbow y offset from baseline
}

function referenceSustained(
  specs: FrameSpec[],
  minDriftThreshold: number,
  minDriftDurationMs: number
): { sustainedDrift: boolean; sustainedDriftDurationMs: number } {
  if (specs.length === 0) {
    return { sustainedDrift: false, sustainedDriftDurationMs: 0 };
  }
  const start = specs[0].ts;
  // Per-frame drift over relative timestamps, matching buildElbowDriftSeries.
  const samples = specs.map((s) => ({
    timestamp: s.ts - start,
    value: ARM_LENGTH > 0 ? Math.max(0, s.offset / ARM_LENGTH) : 0,
  }));

  let sustainedDrift = false;
  let sustainedDriftDurationMs = 0;
  let runStartTs: number | null = null;
  let runEndTs: number | null = null;

  const closeRun = () => {
    if (runStartTs !== null && runEndTs !== null) {
      const runDuration = runEndTs - runStartTs;
      if (runDuration >= minDriftDurationMs) {
        sustainedDrift = true;
        if (runDuration > sustainedDriftDurationMs) {
          sustainedDriftDurationMs = runDuration;
        }
      }
    }
    runStartTs = null;
    runEndTs = null;
  };

  for (const sample of samples) {
    if (sample.value > minDriftThreshold) {
      if (runStartTs === null) runStartTs = sample.timestamp;
      runEndTs = sample.timestamp;
    } else {
      closeRun();
    }
  }
  closeRun();

  return { sustainedDrift, sustainedDriftDurationMs };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * An elbow offset that is clearly above OR below the drift threshold, avoiding
 * the exact boundary so the biconditional is robust to floating-point noise.
 * With default minDriftThreshold=0.03 and ARM_LENGTH=0.2, drift = offset/0.2,
 * so above-threshold requires offset > 0.006.
 */
const offsetArb = (): fc.Arbitrary<number> =>
  fc.oneof(
    // Below threshold (including negative/zero -> clamped to 0 drift).
    fc.double({ min: -0.05, max: 0.005, noNaN: true, noDefaultInfinity: true }),
    // Above threshold with comfortable margin.
    fc.double({ min: 0.008, max: 0.1, noNaN: true, noDefaultInfinity: true })
  );

// ─── Property 8: Sustained drift reflects continuous run length ──────────────

/**
 * **Validates: Requirements 3.5**
 *
 * Property 8: Sustained drift reflects continuous run length
 *
 * For any drift series, Sustained_Drift is reported as detected with a reported
 * duration >= minDriftDuration if and only if the series contains a continuous
 * above-threshold run lasting at least minDriftDuration; otherwise not detected.
 *
 * The elbow drift per confident frame equals max(0, (elbow.y - baselineElbowY)/
 * armLength). We control it by placing the assessed-arm elbow at
 * baselineElbowY + offset and assert `finalize()` matches an independently
 * computed continuous-run reference over the same inputs.
 */
describe('Property 8: Sustained drift reflects continuous run length', () => {
  it('detects sustained drift iff a continuous above-threshold run reaches minDriftDuration', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'left' | 'right'>('left', 'right'),
        // A sequence of frames, each with a chosen elbow offset. Frames are spaced
        // a fixed 100ms apart so run durations are exact multiples of 100ms and
        // can straddle the default 2000ms minimum.
        fc.array(offsetArb(), { minLength: 1, maxLength: 40 }),
        (assessedArm, offsets) => {
          const config = new ConfigStore();
          const minDriftThreshold = config.get('minDriftThreshold');
          const minDriftDurationMs = config.get('minDriftDuration') * 1000;

          const specs: FrameSpec[] = offsets.map((offset, i) => ({
            ts: 100_000 + i * 100, // 100ms apart, arbitrary start offset
            offset,
          }));

          const analyzer = new MicroMovementAnalyzer(config);
          analyzer.start(makeBaseline(), assessedArm);
          for (const spec of specs) {
            analyzer.addFrame(makeFrame(assessedArm, spec.ts, spec.offset));
          }

          const indicators = analyzer.finalize();

          const expected = referenceSustained(
            specs,
            minDriftThreshold,
            minDriftDurationMs
          );

          expect(indicators.sustainedDrift).toBe(expected.sustainedDrift);
          expect(indicators.sustainedDriftDurationMs).toBe(
            expected.sustainedDriftDurationMs
          );

          // The biconditional: detected exactly when the longest run reaches the
          // configured minimum duration.
          expect(indicators.sustainedDrift).toBe(
            indicators.sustainedDriftDurationMs >= minDriftDurationMs
          );
        }
      ),
      { numRuns: 200 }
    );
  });

  it('reports no sustained drift when every frame is below threshold', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'left' | 'right'>('left', 'right'),
        fc.array(
          fc.double({ min: -0.05, max: 0.005, noNaN: true, noDefaultInfinity: true }),
          { minLength: 1, maxLength: 40 }
        ),
        (assessedArm, offsets) => {
          const config = new ConfigStore();
          const analyzer = new MicroMovementAnalyzer(config);
          analyzer.start(makeBaseline(), assessedArm);
          offsets.forEach((offset, i) => {
            analyzer.addFrame(makeFrame(assessedArm, 200_000 + i * 100, offset));
          });

          const indicators = analyzer.finalize();
          expect(indicators.sustainedDrift).toBe(false);
          expect(indicators.sustainedDriftDurationMs).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('detects sustained drift for a long continuous above-threshold run', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'left' | 'right'>('left', 'right'),
        // >= 21 frames at 100ms apart => run duration >= 2000ms (default minimum).
        fc.integer({ min: 21, max: 60 }),
        fc.double({ min: 0.008, max: 0.1, noNaN: true, noDefaultInfinity: true }),
        (assessedArm, count, offset) => {
          const config = new ConfigStore();
          const minDriftDurationMs = config.get('minDriftDuration') * 1000;

          const analyzer = new MicroMovementAnalyzer(config);
          analyzer.start(makeBaseline(), assessedArm);
          for (let i = 0; i < count; i++) {
            analyzer.addFrame(makeFrame(assessedArm, 300_000 + i * 100, offset));
          }

          const indicators = analyzer.finalize();
          const expectedDuration = (count - 1) * 100;
          expect(indicators.sustainedDrift).toBe(true);
          expect(indicators.sustainedDriftDurationMs).toBe(expectedDuration);
          expect(expectedDuration).toBeGreaterThanOrEqual(minDriftDurationMs);
        }
      ),
      { numRuns: 100 }
    );
  });
});
