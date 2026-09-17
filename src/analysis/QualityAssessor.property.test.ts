import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ConfigStore } from '../config/ConfigStore';
import { evaluateQuality } from './QualityAssessor';
import type { DriftFrame, Baseline, QualityRating } from '../types';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Valid quality ratings. */
const VALID_RATINGS: QualityRating[] = ['good', 'acceptable', 'low', 'unable_to_assess'];

/**
 * Creates a minimal valid baseline for testing.
 */
function makeBaseline(): Baseline {
  return {
    leftArm: {
      shoulderPos: { x: 0.6, y: 0.4, z: 0 },
      elbowPos: { x: 0.7, y: 0.4, z: 0 },
      wristPos: { x: 0.8, y: 0.4, z: 0 },
      normalizedWristHeight: 0.5,
      elbowExtensionAngle: 170,
      palmOrientationAngle: 10,
      armLength: 0.2,
    },
    rightArm: {
      shoulderPos: { x: 0.4, y: 0.4, z: 0 },
      elbowPos: { x: 0.3, y: 0.4, z: 0 },
      wristPos: { x: 0.2, y: 0.4, z: 0 },
      normalizedWristHeight: 0.5,
      elbowExtensionAngle: 170,
      palmOrientationAngle: 10,
      armLength: 0.2,
    },
    torsoAngle: 0,
    shoulderWidth: 0.2,
    captureFrameCount: 10,
    captureStartTime: 1000,
    captureEndTime: 3500,
  };
}

/**
 * Creates a DriftFrame with configurable parameters.
 */
function makeDriftFrame(overrides?: Partial<DriftFrame>): DriftFrame {
  return {
    timestamp: 0,
    leftWristDrift: 0,
    rightWristDrift: 0,
    leftElbowDrift: 0,
    rightElbowDrift: 0,
    leftPronation: null,
    rightPronation: null,
    leftConfidence: 0.9,
    rightConfidence: 0.9,
    torsoCompensation: 0,
    cameraMovement: 0,
    frameValid: true,
    ...overrides,
  };
}

/**
 * Arbitrary for generating DriftFrame arrays with controlled valid frame percentage.
 */
function driftFramesWithValidPct(
  totalFrames: number,
  validPct: number
): DriftFrame[] {
  const validCount = Math.round((validPct / 100) * totalFrames);
  const invalidCount = totalFrames - validCount;
  const frames: DriftFrame[] = [];

  for (let i = 0; i < validCount; i++) {
    frames.push(
      makeDriftFrame({
        timestamp: i * 100,
        frameValid: true,
        leftConfidence: 0.9,
        rightConfidence: 0.9,
        cameraMovement: 0.001,
        torsoCompensation: 0.01,
      })
    );
  }

  for (let i = 0; i < invalidCount; i++) {
    frames.push(
      makeDriftFrame({
        timestamp: (validCount + i) * 100,
        frameValid: false,
        leftConfidence: 0.2,
        rightConfidence: 0.2,
        cameraMovement: 0.05,
        torsoCompensation: 0.01,
      })
    );
  }

  return frames;
}

// ─── Property Tests ──────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 13.1, 13.2**
 *
 * Property 20: Quality Assessment Rating Consistency
 *
 * For any set of quality metrics, the quality assessor shall produce exactly one
 * rating from {good, acceptable, low, unable_to_assess}. If valid frame percentage
 * is below the minimum threshold, the rating shall not be "good".
 */
describe('Property 20: Quality Assessment Rating Consistency', () => {
  it('always produces exactly one rating from the valid set', () => {
    fc.assert(
      fc.property(
        // Generate total frame count
        fc.integer({ min: 10, max: 300 }),
        // Generate valid frame percentage 0-100
        fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
        // Generate confidence levels
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        // Generate camera movement
        fc.double({ min: 0, max: 0.1, noNaN: true, noDefaultInfinity: true }),
        (totalFrames, validPct, leftConf, rightConf, camMovement) => {
          const validCount = Math.round((validPct / 100) * totalFrames);
          const invalidCount = totalFrames - validCount;

          const frames: DriftFrame[] = [];
          for (let i = 0; i < validCount; i++) {
            frames.push(
              makeDriftFrame({
                timestamp: i * 100,
                frameValid: true,
                leftConfidence: leftConf,
                rightConfidence: rightConf,
                cameraMovement: camMovement,
                torsoCompensation: 0.01,
              })
            );
          }
          for (let i = 0; i < invalidCount; i++) {
            frames.push(
              makeDriftFrame({
                timestamp: (validCount + i) * 100,
                frameValid: false,
                leftConfidence: 0.1,
                rightConfidence: 0.1,
                cameraMovement: camMovement + 0.05,
                torsoCompensation: 0.01,
              })
            );
          }

          const config = new ConfigStore();
          const baseline = makeBaseline();
          const result = evaluateQuality(frames, baseline, config);

          // Must produce exactly one rating
          expect(VALID_RATINGS).toContain(result.overall);
          // result.overall is a single string value
          expect(typeof result.overall).toBe('string');
        }
      ),
      { numRuns: 500 }
    );
  });

  it('valid frame % below config threshold cannot produce "good" rating', () => {
    fc.assert(
      fc.property(
        // Total frame count (needs enough to be meaningful)
        fc.integer({ min: 10, max: 300 }),
        // minValidFramePercentage config value
        fc.double({ min: 50, max: 95, noNaN: true, noDefaultInfinity: true }),
        // Generate a validPct that is BELOW the configured threshold
        fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
        (totalFrames, minValidPct, rawValidPct) => {
          // Ensure validPct is strictly below the configured threshold
          const validPct = Math.min(rawValidPct, minValidPct - 1);
          if (validPct < 0) return; // Skip degenerate case

          const frames = driftFramesWithValidPct(totalFrames, validPct);
          const config = new ConfigStore({ minValidFramePercentage: minValidPct });
          const baseline = makeBaseline();
          const result = evaluateQuality(frames, baseline, config);

          // When valid frame % is below the configured minimum threshold,
          // the rating must NOT be "good"
          expect(result.overall).not.toBe('good');
        }
      ),
      { numRuns: 500 }
    );
  });

  it('produces primaryFailureReason only when rating is low or unable_to_assess', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 100 }),
        fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (totalFrames, validPct, confidence) => {
          const frames = driftFramesWithValidPct(totalFrames, validPct);
          // Adjust confidence on all frames
          for (const f of frames) {
            if (f.frameValid) {
              f.leftConfidence = confidence;
              f.rightConfidence = confidence;
            }
          }

          const config = new ConfigStore();
          const baseline = makeBaseline();
          const result = evaluateQuality(frames, baseline, config);

          if (result.overall === 'good' || result.overall === 'acceptable') {
            // No primary failure reason for good/acceptable ratings
            expect(result.primaryFailureReason).toBeNull();
          } else {
            // Must have a primary failure reason for low/unable_to_assess
            expect(result.primaryFailureReason).not.toBeNull();
            expect(typeof result.primaryFailureReason).toBe('string');
            expect(result.primaryFailureReason!.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  it('metrics are always included in the assessment result', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 100 }),
        fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
        (totalFrames, validPct) => {
          const frames = driftFramesWithValidPct(totalFrames, validPct);
          const config = new ConfigStore();
          const baseline = makeBaseline();
          const result = evaluateQuality(frames, baseline, config);

          // Metrics must always be present
          expect(result.metrics).toBeDefined();
          expect(typeof result.metrics.validFramePercentage).toBe('number');
          expect(typeof result.metrics.avgPoseConfidence).toBe('number');
          expect(typeof result.metrics.cameraStability).toBe('number');
          expect(typeof result.metrics.subjectVisibilityRate).toBe('number');
          // Valid frame percentage should be in [0, 100]
          expect(result.metrics.validFramePercentage).toBeGreaterThanOrEqual(0);
          expect(result.metrics.validFramePercentage).toBeLessThanOrEqual(100);
        }
      ),
      { numRuns: 300 }
    );
  });
});

/**
 * **Validates: Requirements 14.4**
 *
 * Property 22: Excessive Frame Exclusion Forces Unable-to-Assess
 *
 * For any assessment where the percentage of excluded frames exceeds
 * `100 - minValidFramePercentage`, the classification must be "unable_to_assess".
 */
describe('Property 22: Excessive Frame Exclusion Forces Unable-to-Assess', () => {
  it('forces unable_to_assess when valid frame % is below minValidFramePercentage', () => {
    fc.assert(
      fc.property(
        // Total frame count
        fc.integer({ min: 10, max: 300 }),
        // minValidFramePercentage config value (the threshold)
        fc.double({ min: 50, max: 95, noNaN: true, noDefaultInfinity: true }),
        // Fraction of valid frames (will be set below the threshold)
        fc.double({ min: 0, max: 0.95, noNaN: true, noDefaultInfinity: true }),
        (totalFrames, minValidPct, rawFraction) => {
          // Compute valid count ensuring the actual percentage is strictly below threshold.
          // Use floor to prevent rounding from pushing us above the threshold.
          const targetValidPct = rawFraction * (minValidPct - 1);
          const validCount = Math.floor((targetValidPct / 100) * totalFrames);
          const invalidCount = totalFrames - validCount;

          // Verify that actual valid % is indeed below minValidPct
          const actualPct = (validCount / totalFrames) * 100;
          if (actualPct >= minValidPct) return; // Skip edge case

          const frames: DriftFrame[] = [];
          for (let i = 0; i < validCount; i++) {
            frames.push(
              makeDriftFrame({
                timestamp: i * 100,
                frameValid: true,
                leftConfidence: 0.9,
                rightConfidence: 0.9,
                cameraMovement: 0.001,
              })
            );
          }
          for (let i = 0; i < invalidCount; i++) {
            frames.push(
              makeDriftFrame({
                timestamp: (validCount + i) * 100,
                frameValid: false,
                leftConfidence: 0.1,
                rightConfidence: 0.1,
                cameraMovement: 0.08,
              })
            );
          }

          const config = new ConfigStore({ minValidFramePercentage: minValidPct });
          const baseline = makeBaseline();
          const result = evaluateQuality(frames, baseline, config);

          // When excluded frames exceed the threshold, must be "unable_to_assess"
          expect(result.overall).toBe('unable_to_assess');
        }
      ),
      { numRuns: 500 }
    );
  });

  it('does not force unable_to_assess when valid frame % meets the threshold', () => {
    fc.assert(
      fc.property(
        // Total frame count
        fc.integer({ min: 20, max: 200 }),
        // minValidFramePercentage config value
        fc.double({ min: 40, max: 80, noNaN: true, noDefaultInfinity: true }),
        (totalFrames, minValidPct) => {
          // All frames are valid → well above threshold
          const frames: DriftFrame[] = [];
          for (let i = 0; i < totalFrames; i++) {
            frames.push(
              makeDriftFrame({
                timestamp: i * 100,
                frameValid: true,
                leftConfidence: 0.9,
                rightConfidence: 0.9,
                cameraMovement: 0.001,
                torsoCompensation: 0.005,
              })
            );
          }

          const config = new ConfigStore({ minValidFramePercentage: minValidPct });
          const baseline = makeBaseline();
          const result = evaluateQuality(frames, baseline, config);

          // Should NOT be unable_to_assess due to frame exclusion
          // (it could still be unable_to_assess for other reasons, but not frame exclusion)
          // Since all frames are valid, the valid frame % = 100%, well above threshold
          expect(result.overall).not.toBe('unable_to_assess');
        }
      ),
      { numRuns: 500 }
    );
  });

  it('reports frame exclusion as primary failure reason when unable_to_assess due to low valid frames', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 100 }),
        fc.double({ min: 50, max: 90, noNaN: true, noDefaultInfinity: true }),
        (totalFrames, minValidPct) => {
          // Create frames where most are invalid (well below threshold)
          const validCount = Math.round((minValidPct / 100) * totalFrames * 0.3); // ~30% of required
          const invalidCount = totalFrames - validCount;

          const frames: DriftFrame[] = [];
          for (let i = 0; i < validCount; i++) {
            frames.push(
              makeDriftFrame({
                timestamp: i * 100,
                frameValid: true,
                leftConfidence: 0.9,
                rightConfidence: 0.9,
              })
            );
          }
          for (let i = 0; i < invalidCount; i++) {
            frames.push(
              makeDriftFrame({
                timestamp: (validCount + i) * 100,
                frameValid: false,
                leftConfidence: 0.1,
                rightConfidence: 0.1,
                cameraMovement: 0.08,
              })
            );
          }

          const config = new ConfigStore({ minValidFramePercentage: minValidPct });
          const baseline = makeBaseline();
          const result = evaluateQuality(frames, baseline, config);

          expect(result.overall).toBe('unable_to_assess');
          expect(result.primaryFailureReason).not.toBeNull();
          // The primary reason should mention insufficient valid frames
          expect(result.primaryFailureReason).toContain('valid frames');
        }
      ),
      { numRuns: 300 }
    );
  });
});
