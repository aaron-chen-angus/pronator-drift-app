// Feature: pronator-drift-analysis, Property 7: Drift onset is the first threshold crossing
/**
 * Property test for Property 7 — Drift onset is the first threshold crossing.
 *
 * **Validates: Requirements 3.3, 3.4**
 *
 * Property: For any smoothed drift series, the reported Drift_Onset equals the
 * timestamp of the first valid frame whose smoothed drift exceeds
 * `minDriftThreshold`, and is reported as not detected (null) when no valid
 * frame exceeds the threshold.
 *
 * Drift onset is produced by DriftAnalyzer. The analyzer stores, in each
 * DriftFrame of getDriftTimeSeries(), the *smoothed* per-arm drift value
 * (leftWristDrift / rightWristDrift) together with a frameValid flag, and it
 * sets the onset to the timestamp of the first valid frame whose smoothed drift
 * strictly exceeds minDriftThreshold. This test drives the analyzer with
 * constructed frames and asserts getDriftOnset() equals the first crossing
 * recomputed directly from the analyzer's own exposed smoothed time series and
 * the configured threshold — and is null when no such crossing exists.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ConfigStore } from '../config/ConfigStore';
import { DriftAnalyzerImpl } from './DriftAnalyzer';
import type { CVFrameResult, NormalizedLandmark, Baseline, DriftFrame } from '../types';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Create a landmark with given position and visibility. */
function makeLandmark(
  x: number,
  y: number,
  z: number = 0,
  visibility: number = 0.9
): NormalizedLandmark {
  return { x, y, z, visibility };
}

/**
 * Create a complete set of 33 pose landmarks with configurable arm positions.
 * Mirrors the conventions used by the existing DriftAnalyzer tests.
 */
function makePoseLandmarks(overrides?: {
  leftShoulderY?: number;
  rightShoulderY?: number;
  leftWristY?: number;
  rightWristY?: number;
  visibility?: number;
}): NormalizedLandmark[] {
  const vis = overrides?.visibility ?? 0.9;
  const landmarks: NormalizedLandmark[] = Array.from({ length: 33 }, () =>
    makeLandmark(0.5, 0.5, 0, vis)
  );

  // Shoulders
  landmarks[11] = makeLandmark(0.6, overrides?.leftShoulderY ?? 0.4, 0, vis);
  landmarks[12] = makeLandmark(0.4, overrides?.rightShoulderY ?? 0.4, 0, vis);

  // Elbows
  landmarks[13] = makeLandmark(0.7, 0.4, 0, vis);
  landmarks[14] = makeLandmark(0.3, 0.4, 0, vis);

  // Wrists
  landmarks[15] = makeLandmark(0.8, overrides?.leftWristY ?? 0.4, 0, vis);
  landmarks[16] = makeLandmark(0.2, overrides?.rightWristY ?? 0.4, 0, vis);

  // Hips
  landmarks[23] = makeLandmark(0.55, 0.7, 0, vis);
  landmarks[24] = makeLandmark(0.45, 0.7, 0, vis);

  return landmarks;
}

/** Create a minimal CVFrameResult. A null poseLandmarks marks a missing-pose frame. */
function makeFrame(
  timestamp: number,
  poseLandmarks: NormalizedLandmark[] | null
): CVFrameResult {
  return {
    timestamp,
    poseLandmarks: poseLandmarks ? [poseLandmarks] : null,
    poseWorldLandmarks: null,
    handLandmarks: null,
    handedness: null,
    processingTimeMs: 16,
  };
}

/**
 * Standard baseline matching the default landmark positions.
 * Shoulders/wrists at y=0.4, arm length = 0.2 (horizontal shoulder->wrist distance).
 */
function makeDefaultBaseline(): Baseline {
  return {
    leftArm: {
      shoulderPos: { x: 0.6, y: 0.4, z: 0 },
      elbowPos: { x: 0.7, y: 0.4, z: 0 },
      wristPos: { x: 0.8, y: 0.4, z: 0 },
      normalizedWristHeight: 0,
      elbowExtensionAngle: 180,
      palmOrientationAngle: 0,
      armLength: 0.2,
    },
    rightArm: {
      shoulderPos: { x: 0.4, y: 0.4, z: 0 },
      elbowPos: { x: 0.3, y: 0.4, z: 0 },
      wristPos: { x: 0.2, y: 0.4, z: 0 },
      normalizedWristHeight: 0,
      elbowExtensionAngle: 180,
      palmOrientationAngle: 0,
      armLength: 0.2,
    },
    torsoAngle: 0,
    shoulderWidth: 0.2,
    captureFrameCount: 10,
    captureStartTime: 0,
    captureEndTime: 2500,
  };
}

/**
 * Recompute the expected onset directly from the analyzer's own smoothed time
 * series: the timestamp of the first valid frame whose smoothed drift for the
 * given arm strictly exceeds the threshold, or null when none exists.
 */
function expectedOnset(
  series: DriftFrame[],
  arm: 'left' | 'right',
  threshold: number
): number | null {
  for (const f of series) {
    const smoothed = arm === 'left' ? f.leftWristDrift : f.rightWristDrift;
    if (f.frameValid && smoothed > threshold) {
      return f.timestamp;
    }
  }
  return null;
}

// A per-frame instruction: how far (in normalized image units) the wrist has
// dropped below baseline this frame. 0 => at baseline. We keep shoulders fixed
// so torso compensation stays 0 and camera movement stays below threshold.
type FrameStep = { leftDrop: number; rightDrop: number };

const stepArb: fc.Arbitrary<FrameStep> = fc.record({
  // Baseline wrist y = 0.4. A drop of d moves wrist to 0.4 + d.
  // Range chosen to straddle the default threshold (0.03 normalized == 0.006 units)
  // so that some frames cross and some do not.
  leftDrop: fc.double({ min: 0, max: 0.08, noNaN: true, noDefaultInfinity: true }),
  rightDrop: fc.double({ min: 0, max: 0.08, noNaN: true, noDefaultInfinity: true }),
});

// ─── Property Test ───────────────────────────────────────────────────────────

describe('Property 7: Drift onset is the first threshold crossing', () => {
  it('onset equals first valid smoothed crossing of minDriftThreshold, null when none', () => {
    fc.assert(
      fc.property(
        // A sequence of frames; occasional missing-pose frames (null) exercise
        // the invalid-frame path.
        fc.array(fc.option(stepArb, { nil: null, freq: 6 }), {
          minLength: 1,
          maxLength: 40,
        }),
        (steps) => {
          const config = new ConfigStore();
          const threshold = config.get('minDriftThreshold');
          const analyzer = new DriftAnalyzerImpl(config);
          const baseline = makeDefaultBaseline();

          analyzer.startAssessment(baseline);

          const startTs = 3000;
          steps.forEach((step, i) => {
            const ts = startTs + i * 100; // ~10 fps
            if (step === null) {
              // Missing pose landmarks -> analyzer records an invalid frame.
              analyzer.addAssessmentFrame(makeFrame(ts, null));
            } else {
              const landmarks = makePoseLandmarks({
                leftWristY: 0.4 + step.leftDrop,
                rightWristY: 0.4 + step.rightDrop,
              });
              analyzer.addAssessmentFrame(makeFrame(ts, landmarks));
            }
          });

          const series = analyzer.getDriftTimeSeries();
          const onset = analyzer.getDriftOnset();

          // Core invariant (Req 3.3 / 3.4): reported onset per arm equals the
          // first valid frame whose smoothed drift exceeds the threshold, and is
          // null when no valid frame crosses.
          expect(onset.left).toBe(expectedOnset(series, 'left', threshold));
          expect(onset.right).toBe(expectedOnset(series, 'right', threshold));

          // Req 3.4 explicit: when no crossing exists for an arm, onset is null.
          const anyLeftCrossing = series.some(
            (f) => f.frameValid && f.leftWristDrift > threshold
          );
          const anyRightCrossing = series.some(
            (f) => f.frameValid && f.rightWristDrift > threshold
          );
          if (!anyLeftCrossing) expect(onset.left).toBeNull();
          if (!anyRightCrossing) expect(onset.right).toBeNull();

          // When onset is non-null it must correspond to an actual frame
          // timestamp in the series.
          if (onset.left !== null) {
            expect(series.some((f) => f.timestamp === onset.left)).toBe(true);
          }
          if (onset.right !== null) {
            expect(series.some((f) => f.timestamp === onset.right)).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('reports onset as not detected (null) when drift never crosses threshold', () => {
    fc.assert(
      fc.property(
        // All wrist drops kept small enough that smoothed drift stays at/below
        // threshold: drop <= 0.005 units => normalized <= 0.025 < 0.03 default.
        fc.array(
          fc.double({ min: 0, max: 0.005, noNaN: true, noDefaultInfinity: true }),
          { minLength: 1, maxLength: 30 }
        ),
        (drops) => {
          const config = new ConfigStore();
          const analyzer = new DriftAnalyzerImpl(config);
          const baseline = makeDefaultBaseline();

          analyzer.startAssessment(baseline);
          drops.forEach((d, i) => {
            const landmarks = makePoseLandmarks({
              leftWristY: 0.4 + d,
              rightWristY: 0.4 + d,
            });
            analyzer.addAssessmentFrame(makeFrame(3000 + i * 100, landmarks));
          });

          const onset = analyzer.getDriftOnset();
          expect(onset.left).toBeNull();
          expect(onset.right).toBeNull();
        }
      ),
      { numRuns: 200 }
    );
  });
});
