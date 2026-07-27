import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ConfigStore } from '../config/ConfigStore';
import { DriftAnalyzerImpl } from './DriftAnalyzer';
import type { CVFrameResult, NormalizedLandmark } from '../types';

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
 */
function makeDefaultPoseLandmarks(overrides?: {
  leftWristY?: number;
  rightWristY?: number;
  leftWristX?: number;
  rightWristX?: number;
  leftShoulderX?: number;
  leftShoulderY?: number;
  rightShoulderX?: number;
  rightShoulderY?: number;
  leftElbowX?: number;
  leftElbowY?: number;
  rightElbowX?: number;
  rightElbowY?: number;
  visibility?: number;
}): NormalizedLandmark[] {
  const vis = overrides?.visibility ?? 0.9;
  const landmarks: NormalizedLandmark[] = Array.from({ length: 33 }, () =>
    makeLandmark(0.5, 0.5, 0, vis)
  );

  // Shoulders
  landmarks[11] = makeLandmark(overrides?.leftShoulderX ?? 0.6, overrides?.leftShoulderY ?? 0.4, 0, vis);
  landmarks[12] = makeLandmark(overrides?.rightShoulderX ?? 0.4, overrides?.rightShoulderY ?? 0.4, 0, vis);

  // Elbows
  landmarks[13] = makeLandmark(overrides?.leftElbowX ?? 0.7, overrides?.leftElbowY ?? 0.4, 0, vis);
  landmarks[14] = makeLandmark(overrides?.rightElbowX ?? 0.3, overrides?.rightElbowY ?? 0.4, 0, vis);

  // Wrists
  landmarks[15] = makeLandmark(overrides?.leftWristX ?? 0.8, overrides?.leftWristY ?? 0.4, 0, vis);
  landmarks[16] = makeLandmark(overrides?.rightWristX ?? 0.2, overrides?.rightWristY ?? 0.4, 0, vis);

  // Hips
  landmarks[23] = makeLandmark(0.55, 0.7, 0, vis);
  landmarks[24] = makeLandmark(0.45, 0.7, 0, vis);

  return landmarks;
}

/**
 * Create a minimal CVFrameResult with pose landmarks.
 */
function makeFrame(
  timestamp: number,
  poseLandmarks: NormalizedLandmark[] | null = null
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

// ─── Property Tests ──────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 6.1**
 *
 * Property 7: Baseline is Mean of Valid Frames
 *
 * For any set of valid frames, baseline equals the arithmetic mean of each
 * dimension's values.
 */
describe('Property 7: Baseline is Mean of Valid Frames', () => {
  it('baseline wrist position equals arithmetic mean of generated frame wrist positions', () => {
    fc.assert(
      fc.property(
        // Generate between 3 and 20 frames with random but stable wrist Y positions
        fc.array(
          fc.double({ min: 0.38, max: 0.42, noNaN: true, noDefaultInfinity: true }),
          { minLength: 3, maxLength: 20 }
        ),
        fc.array(
          fc.double({ min: 0.38, max: 0.42, noNaN: true, noDefaultInfinity: true }),
          { minLength: 3, maxLength: 20 }
        ),
        (leftWristYValues, rightWristYValues) => {
          // Use the shorter length to make equal-length sequences
          const n = Math.min(leftWristYValues.length, rightWristYValues.length);
          const leftYs = leftWristYValues.slice(0, n);
          const rightYs = rightWristYValues.slice(0, n);

          // Use a lenient config so stability check doesn't reject
          const config = new ConfigStore({ maxBaselineVariation: 0.2 });
          const analyzer = new DriftAnalyzerImpl(config);

          analyzer.startCalibration();
          for (let i = 0; i < n; i++) {
            const landmarks = makeDefaultPoseLandmarks({
              leftWristY: leftYs[i],
              rightWristY: rightYs[i],
            });
            analyzer.addCalibrationFrame(makeFrame(1000 + i * 100, landmarks));
          }

          const result = analyzer.finalizeCalibration();
          expect(result.success).toBe(true);

          if (result.success) {
            // Expected mean of left wrist Y
            const expectedLeftMeanY = leftYs.reduce((a, b) => a + b, 0) / n;
            expect(result.baseline.leftArm.wristPos.y).toBeCloseTo(expectedLeftMeanY, 5);

            // Expected mean of right wrist Y
            const expectedRightMeanY = rightYs.reduce((a, b) => a + b, 0) / n;
            expect(result.baseline.rightArm.wristPos.y).toBeCloseTo(expectedRightMeanY, 5);

            // Also verify X positions are the mean (they are constant in this case)
            expect(result.baseline.leftArm.wristPos.x).toBeCloseTo(0.8, 5);
            expect(result.baseline.rightArm.wristPos.x).toBeCloseTo(0.2, 5);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('baseline arm length equals arithmetic mean of per-frame arm lengths', () => {
    fc.assert(
      fc.property(
        // Generate a base wrist X and small offsets to keep variation within stability threshold
        fc.double({ min: 0.78, max: 0.82, noNaN: true, noDefaultInfinity: true }),
        fc.array(
          fc.double({ min: -0.005, max: 0.005, noNaN: true, noDefaultInfinity: true }),
          { minLength: 3, maxLength: 15 }
        ),
        (baseWristX, offsets) => {
          // Use a very lenient max variation to avoid stability rejection
          const config = new ConfigStore({ maxBaselineVariation: 0.2 });
          const analyzer = new DriftAnalyzerImpl(config);

          const leftWristXValues = offsets.map((o) => baseWristX + o);

          analyzer.startCalibration();
          for (let i = 0; i < leftWristXValues.length; i++) {
            const landmarks = makeDefaultPoseLandmarks({
              leftWristX: leftWristXValues[i],
            });
            analyzer.addCalibrationFrame(makeFrame(1000 + i * 100, landmarks));
          }

          const result = analyzer.finalizeCalibration();
          expect(result.success).toBe(true);

          if (result.success) {
            // Arm length = distance from shoulder (0.6, 0.4) to wrist (wristX, 0.4)
            // Since y is the same, armLength = |wristX - 0.6|
            const expectedMeanArmLength =
              leftWristXValues.reduce((sum, wx) => sum + Math.abs(wx - 0.6), 0) /
              leftWristXValues.length;
            expect(result.baseline.leftArm.armLength).toBeCloseTo(expectedMeanArmLength, 5);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});

/**
 * **Validates: Requirements 6.2, 6.4**
 *
 * Property 8: Per-Arm Baseline Independence
 *
 * Modifying one arm's landmarks doesn't change the other arm's baseline.
 */
describe('Property 8: Per-Arm Baseline Independence', () => {
  it('changing left arm positions does not affect right arm baseline', () => {
    fc.assert(
      fc.property(
        // Generate two different left wrist Y positions for two calibration runs
        fc.double({ min: 0.38, max: 0.42, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.38, max: 0.42, noNaN: true, noDefaultInfinity: true }),
        // Fixed right wrist Y
        fc.double({ min: 0.38, max: 0.42, noNaN: true, noDefaultInfinity: true }),
        (leftWristY1, leftWristY2, rightWristY) => {
          const config = new ConfigStore({ maxBaselineVariation: 0.2 });

          // First calibration run
          const analyzer1 = new DriftAnalyzerImpl(config);
          analyzer1.startCalibration();
          for (let i = 0; i < 5; i++) {
            const landmarks = makeDefaultPoseLandmarks({
              leftWristY: leftWristY1,
              rightWristY: rightWristY,
            });
            analyzer1.addCalibrationFrame(makeFrame(1000 + i * 100, landmarks));
          }
          const result1 = analyzer1.finalizeCalibration();

          // Second calibration run with different left arm
          const analyzer2 = new DriftAnalyzerImpl(config);
          analyzer2.startCalibration();
          for (let i = 0; i < 5; i++) {
            const landmarks = makeDefaultPoseLandmarks({
              leftWristY: leftWristY2,
              rightWristY: rightWristY,
            });
            analyzer2.addCalibrationFrame(makeFrame(1000 + i * 100, landmarks));
          }
          const result2 = analyzer2.finalizeCalibration();

          expect(result1.success).toBe(true);
          expect(result2.success).toBe(true);

          if (result1.success && result2.success) {
            // Right arm baseline should be identical in both runs
            expect(result1.baseline.rightArm.wristPos.x).toBeCloseTo(
              result2.baseline.rightArm.wristPos.x, 10
            );
            expect(result1.baseline.rightArm.wristPos.y).toBeCloseTo(
              result2.baseline.rightArm.wristPos.y, 10
            );
            expect(result1.baseline.rightArm.wristPos.z).toBeCloseTo(
              result2.baseline.rightArm.wristPos.z, 10
            );
            expect(result1.baseline.rightArm.armLength).toBeCloseTo(
              result2.baseline.rightArm.armLength, 10
            );
            expect(result1.baseline.rightArm.normalizedWristHeight).toBeCloseTo(
              result2.baseline.rightArm.normalizedWristHeight, 10
            );
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('changing right arm positions does not affect left arm baseline', () => {
    fc.assert(
      fc.property(
        // Fixed left wrist Y
        fc.double({ min: 0.38, max: 0.42, noNaN: true, noDefaultInfinity: true }),
        // Two different right wrist Y positions
        fc.double({ min: 0.38, max: 0.42, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.38, max: 0.42, noNaN: true, noDefaultInfinity: true }),
        (leftWristY, rightWristY1, rightWristY2) => {
          const config = new ConfigStore({ maxBaselineVariation: 0.2 });

          // First calibration run
          const analyzer1 = new DriftAnalyzerImpl(config);
          analyzer1.startCalibration();
          for (let i = 0; i < 5; i++) {
            const landmarks = makeDefaultPoseLandmarks({
              leftWristY: leftWristY,
              rightWristY: rightWristY1,
            });
            analyzer1.addCalibrationFrame(makeFrame(1000 + i * 100, landmarks));
          }
          const result1 = analyzer1.finalizeCalibration();

          // Second calibration run with different right arm
          const analyzer2 = new DriftAnalyzerImpl(config);
          analyzer2.startCalibration();
          for (let i = 0; i < 5; i++) {
            const landmarks = makeDefaultPoseLandmarks({
              leftWristY: leftWristY,
              rightWristY: rightWristY2,
            });
            analyzer2.addCalibrationFrame(makeFrame(1000 + i * 100, landmarks));
          }
          const result2 = analyzer2.finalizeCalibration();

          expect(result1.success).toBe(true);
          expect(result2.success).toBe(true);

          if (result1.success && result2.success) {
            // Left arm baseline should be identical in both runs
            expect(result1.baseline.leftArm.wristPos.x).toBeCloseTo(
              result2.baseline.leftArm.wristPos.x, 10
            );
            expect(result1.baseline.leftArm.wristPos.y).toBeCloseTo(
              result2.baseline.leftArm.wristPos.y, 10
            );
            expect(result1.baseline.leftArm.wristPos.z).toBeCloseTo(
              result2.baseline.leftArm.wristPos.z, 10
            );
            expect(result1.baseline.leftArm.armLength).toBeCloseTo(
              result2.baseline.leftArm.armLength, 10
            );
            expect(result1.baseline.leftArm.normalizedWristHeight).toBeCloseTo(
              result2.baseline.leftArm.normalizedWristHeight, 10
            );
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});

/**
 * **Validates: Requirements 6.5, 6.6**
 *
 * Property 10: Calibration Quality Gate
 *
 * If confidence < threshold for >50% of frames OR wrist varies > maxBaselineVariation,
 * calibration fails.
 */
describe('Property 10: Calibration Quality Gate', () => {
  it('fails when >50% of frames have low confidence', () => {
    fc.assert(
      fc.property(
        // Total frames (at least 3)
        fc.integer({ min: 3, max: 30 }),
        // Fraction of invalid frames (>50%)
        fc.double({ min: 0.51, max: 0.99, noNaN: true, noDefaultInfinity: true }),
        (totalFrames, invalidFraction) => {
          const invalidCount = Math.ceil(totalFrames * invalidFraction);
          const validCount = totalFrames - invalidCount;

          // Ensure we actually have >50% invalid
          if (invalidCount <= totalFrames * 0.5) return;

          const config = new ConfigStore({ maxBaselineVariation: 0.2 });
          const analyzer = new DriftAnalyzerImpl(config);

          analyzer.startCalibration();

          // Add invalid frames (low visibility)
          for (let i = 0; i < invalidCount; i++) {
            const landmarks = makeDefaultPoseLandmarks({ visibility: 0.1 });
            analyzer.addCalibrationFrame(makeFrame(1000 + i * 100, landmarks));
          }

          // Add valid frames
          for (let i = 0; i < validCount; i++) {
            const landmarks = makeDefaultPoseLandmarks({ visibility: 0.9 });
            analyzer.addCalibrationFrame(
              makeFrame(1000 + (invalidCount + i) * 100, landmarks)
            );
          }

          const result = analyzer.finalizeCalibration();
          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.reason).toBe('low_confidence');
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('fails when wrist varies more than maxBaselineVariation threshold', () => {
    fc.assert(
      fc.property(
        // Number of frames
        fc.integer({ min: 3, max: 20 }),
        // maxBaselineVariation config value
        fc.double({ min: 0.01, max: 0.05, noNaN: true, noDefaultInfinity: true }),
        (numFrames, maxVariation) => {
          const config = new ConfigStore({ maxBaselineVariation: maxVariation });
          const analyzer = new DriftAnalyzerImpl(config);

          // Arm length is ~0.2 (from shoulder at 0.6 to wrist at 0.8 on x-axis)
          // The maximum allowed range = maxVariation * armLength = maxVariation * 0.2
          const armLength = 0.2;
          const maxAllowedRange = maxVariation * armLength;

          // Create wrist Y values that exceed the allowed range
          // Range = (max - min) of wrist Y values
          // We want range > maxAllowedRange
          const excessRange = maxAllowedRange + 0.02; // clearly exceeds
          const baseY = 0.4;

          analyzer.startCalibration();
          for (let i = 0; i < numFrames; i++) {
            // Spread wrist Y values over a range that exceeds the threshold
            const wristY = baseY + (i / (numFrames - 1)) * excessRange;
            const landmarks = makeDefaultPoseLandmarks({ leftWristY: wristY });
            analyzer.addCalibrationFrame(makeFrame(1000 + i * 100, landmarks));
          }

          const result = analyzer.finalizeCalibration();
          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.reason).toBe('unstable_position');
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('succeeds when confidence is sufficient AND wrists are stable', () => {
    fc.assert(
      fc.property(
        // Number of frames (enough for reliable calibration)
        fc.integer({ min: 5, max: 20 }),
        // Stable wrist Y value with very small variation
        fc.double({ min: 0.39, max: 0.41, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.39, max: 0.41, noNaN: true, noDefaultInfinity: true }),
        (numFrames, leftWristY, rightWristY) => {
          // Use default config (maxBaselineVariation = 0.05)
          const config = new ConfigStore();
          const analyzer = new DriftAnalyzerImpl(config);

          analyzer.startCalibration();
          for (let i = 0; i < numFrames; i++) {
            // All frames have high confidence and stable wrist positions
            const landmarks = makeDefaultPoseLandmarks({
              leftWristY,
              rightWristY,
              visibility: 0.9,
            });
            analyzer.addCalibrationFrame(makeFrame(1000 + i * 100, landmarks));
          }

          const result = analyzer.finalizeCalibration();
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.baseline.captureFrameCount).toBe(numFrames);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
