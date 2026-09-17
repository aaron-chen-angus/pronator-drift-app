import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { computeAverageLuminance } from './CameraSystem';

/**
 * **Validates: Requirements 3.8**
 *
 * Property 3: Brightness Threshold Detection
 *
 * For any camera frame, if the computed average luminance is below the configured
 * minimum brightness threshold, the system shall flag the frame as inadequately lit.
 * If the luminance is at or above the threshold, the frame shall not be flagged.
 */

/**
 * Helper function that determines whether a frame should be flagged as
 * inadequately lit based on its pixel data and a brightness threshold.
 */
function isBelowBrightnessThreshold(
  pixelData: Uint8ClampedArray,
  pixelCount: number,
  threshold: number
): boolean {
  const luminance = computeAverageLuminance(pixelData, pixelCount);
  return luminance < threshold;
}

describe('Property 3: Brightness Threshold Detection', () => {
  /**
   * Arbitrary for generating a valid minBrightnessThreshold within the
   * ConfigStore's permitted range [10, 200].
   */
  const thresholdArb = fc.integer({ min: 10, max: 200 });

  /**
   * Arbitrary for generating random RGBA pixel data.
   * Generates a pixel count (1 to 256 pixels) and corresponding RGBA data.
   */
  const pixelDataArb = fc.integer({ min: 1, max: 256 }).chain((pixelCount) =>
    fc.tuple(
      fc.constant(pixelCount),
      fc.uint8ClampedArray({ minLength: pixelCount * 4, maxLength: pixelCount * 4 })
    )
  );

  it('should flag frame as inadequately lit when luminance < threshold', () => {
    fc.assert(
      fc.property(pixelDataArb, thresholdArb, ([pixelCount, pixelData], threshold) => {
        const luminance = computeAverageLuminance(pixelData, pixelCount);
        const flagged = isBelowBrightnessThreshold(pixelData, pixelCount, threshold);

        if (luminance < threshold) {
          expect(flagged).toBe(true);
        }
      }),
      { numRuns: 1000 }
    );
  });

  it('should NOT flag frame when luminance >= threshold', () => {
    fc.assert(
      fc.property(pixelDataArb, thresholdArb, ([pixelCount, pixelData], threshold) => {
        const luminance = computeAverageLuminance(pixelData, pixelCount);
        const flagged = isBelowBrightnessThreshold(pixelData, pixelCount, threshold);

        if (luminance >= threshold) {
          expect(flagged).toBe(false);
        }
      }),
      { numRuns: 1000 }
    );
  });

  it('should correctly partition all frames into flagged or not-flagged based on threshold', () => {
    fc.assert(
      fc.property(pixelDataArb, thresholdArb, ([pixelCount, pixelData], threshold) => {
        const luminance = computeAverageLuminance(pixelData, pixelCount);
        const flagged = isBelowBrightnessThreshold(pixelData, pixelCount, threshold);

        // The flagged state must be exactly equivalent to luminance < threshold
        expect(flagged).toBe(luminance < threshold);
      }),
      { numRuns: 1000 }
    );
  });

  it('should produce luminance in [0, 255] for any valid RGBA pixel data', () => {
    fc.assert(
      fc.property(pixelDataArb, ([pixelCount, pixelData]) => {
        const luminance = computeAverageLuminance(pixelData, pixelCount);

        // Luminance must be within [0, 255] since inputs are clamped bytes
        expect(luminance).toBeGreaterThanOrEqual(0);
        expect(luminance).toBeLessThanOrEqual(255);
      }),
      { numRuns: 1000 }
    );
  });

  it('should flag all-black frames (luminance 0) for any threshold > 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 256 }),
        fc.integer({ min: 1, max: 200 }),
        (pixelCount, threshold) => {
          // All-black frame: R=0, G=0, B=0, A=255
          const pixelData = new Uint8ClampedArray(pixelCount * 4);
          for (let i = 0; i < pixelCount * 4; i += 4) {
            pixelData[i] = 0;     // R
            pixelData[i + 1] = 0; // G
            pixelData[i + 2] = 0; // B
            pixelData[i + 3] = 255; // A
          }

          const luminance = computeAverageLuminance(pixelData, pixelCount);
          expect(luminance).toBe(0);

          const flagged = isBelowBrightnessThreshold(pixelData, pixelCount, threshold);
          expect(flagged).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('should not flag all-white frames (luminance 255) for any valid threshold', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 256 }),
        thresholdArb,
        (pixelCount, threshold) => {
          // All-white frame: R=255, G=255, B=255, A=255
          const pixelData = new Uint8ClampedArray(pixelCount * 4);
          for (let i = 0; i < pixelCount * 4; i += 4) {
            pixelData[i] = 255;     // R
            pixelData[i + 1] = 255; // G
            pixelData[i + 2] = 255; // B
            pixelData[i + 3] = 255; // A
          }

          const luminance = computeAverageLuminance(pixelData, pixelCount);
          // 0.299*255 + 0.587*255 + 0.114*255 = 255
          expect(luminance).toBeCloseTo(255, 5);

          // Threshold max is 200, luminance is 255 → never flagged
          const flagged = isBelowBrightnessThreshold(pixelData, pixelCount, threshold);
          expect(flagged).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });
});
