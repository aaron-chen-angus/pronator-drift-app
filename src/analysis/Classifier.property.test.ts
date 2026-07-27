import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ConfigStore } from '../config/ConfigStore';
import { classify, ClassificationInput } from './Classifier';
import type {
  ArmAssessment,
  OverallClassification,
  QualityAssessment,
  QualityRating,
} from '../types';

// ─── All valid classification categories ─────────────────────────────────────

const ALL_CLASSIFICATIONS: OverallClassification[] = [
  'no_significant_drift',
  'possible_left_pronator_drift',
  'possible_right_pronator_drift',
  'possible_bilateral_drift',
  'drift_without_clear_pronation',
  'possible_pronation_without_drift',
  'unable_to_assess',
];

// ─── Arbitrary Generators ────────────────────────────────────────────────────

/** Generate a valid ArmAssessment with controllable drift/pronation flags. */
function arbArmAssessment(overrides?: {
  sustainedDownwardDrift?: boolean;
  possiblePronation?: boolean;
}): fc.Arbitrary<ArmAssessment> {
  return fc.record({
    baselineWristHeight: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
    maximumDownwardDriftNormalised: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
    driftDurationMilliseconds: fc.nat({ max: 30000 }),
    driftOnsetSeconds: fc.option(fc.double({ min: 0, max: 30, noNaN: true, noDefaultInfinity: true }), { nil: null }),
    maximumElbowFlexionChangeDegrees: fc.double({ min: 0, max: 90, noNaN: true, noDefaultInfinity: true }),
    estimatedPalmRotationChangeDegrees: fc.option(fc.double({ min: 0, max: 180, noNaN: true, noDefaultInfinity: true }), { nil: null }),
    possiblePronation: overrides?.possiblePronation !== undefined
      ? fc.constant(overrides.possiblePronation)
      : fc.boolean(),
    sustainedDownwardDrift: overrides?.sustainedDownwardDrift !== undefined
      ? fc.constant(overrides.sustainedDownwardDrift)
      : fc.boolean(),
    confidence: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
  });
}

/** Generate a QualityAssessment with a specific overall rating. */
function arbQualityAssessment(rating?: QualityRating): fc.Arbitrary<QualityAssessment> {
  const ratingArb = rating
    ? fc.constant(rating)
    : fc.constantFrom<QualityRating>('good', 'acceptable', 'low', 'unable_to_assess');

  return ratingArb.chain((overall) =>
    fc.record({
      overall: fc.constant(overall),
      metrics: fc.record({
        validFramePercentage: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
        avgPoseConfidence: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        avgLeftHandConfidence: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        avgRightHandConfidence: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        cameraStability: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        subjectVisibilityRate: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        lightingAdequacyRate: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        excessiveTorsoMovement: fc.boolean(),
        handsRemainedVisible: fc.boolean(),
        startingPoseValid: fc.boolean(),
        fullDurationCompleted: fc.boolean(),
      }),
      primaryFailureReason: fc.option(fc.string(), { nil: null }),
      reasons: fc.array(fc.string(), { maxLength: 5 }),
    })
  );
}

/** Generate a full ClassificationInput with controllable parameters. */
function arbClassificationInput(overrides?: {
  leftDrift?: boolean;
  leftPronation?: boolean;
  rightDrift?: boolean;
  rightPronation?: boolean;
  qualityRating?: QualityRating;
}): fc.Arbitrary<ClassificationInput> {
  return fc.record({
    leftArm: arbArmAssessment({
      sustainedDownwardDrift: overrides?.leftDrift,
      possiblePronation: overrides?.leftPronation,
    }),
    rightArm: arbArmAssessment({
      sustainedDownwardDrift: overrides?.rightDrift,
      possiblePronation: overrides?.rightPronation,
    }),
    quality: arbQualityAssessment(overrides?.qualityRating),
  });
}

// ─── Property Tests ──────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 11.1**
 *
 * Property 17: Classification Produces Exactly One Result
 *
 * For any valid combination of drift metrics, pronation metrics, and quality
 * assessment, the classifier shall produce exactly one classification from the
 * seven defined categories. It shall never produce zero results or multiple
 * simultaneous classifications.
 */
describe('Property 17: Classification Produces Exactly One Result', () => {
  it('always returns exactly one of the seven valid classification categories', () => {
    const config = new ConfigStore();

    fc.assert(
      fc.property(
        arbClassificationInput(),
        (input) => {
          const result = classify(input, config);

          // Must be exactly one of the valid categories
          expect(ALL_CLASSIFICATIONS).toContain(result);

          // Must be a string (not undefined, null, or array)
          expect(typeof result).toBe('string');
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('never returns undefined or null', () => {
    const config = new ConfigStore();

    fc.assert(
      fc.property(
        arbClassificationInput(),
        (input) => {
          const result = classify(input, config);
          expect(result).not.toBeUndefined();
          expect(result).not.toBeNull();
        }
      ),
      { numRuns: 500 }
    );
  });
});

/**
 * **Validates: Requirements 11.2, 11.3, 11.4, 11.8**
 *
 * Property 18: Classification Logic Correctness
 *
 * For any set of drift and pronation metrics with acceptable quality:
 * - If both sustained drift AND pronation for one arm → "possible_{side}_pronator_drift"
 * - If both arms have sustained drift (regardless of pronation) → "possible_bilateral_drift"
 * - If drift AND pronation < threshold → "drift_without_clear_pronation"
 * - If pronation AND drift < threshold → "possible_pronation_without_drift"
 * - If neither drift nor pronation → "no_significant_drift"
 */
describe('Property 18: Classification Logic Correctness', () => {
  const config = new ConfigStore();

  it('left arm with both drift AND pronation produces possible_left_pronator_drift', () => {
    fc.assert(
      fc.property(
        arbClassificationInput({
          leftDrift: true,
          leftPronation: true,
          rightDrift: false,
          rightPronation: false,
          qualityRating: 'good',
        }),
        (input) => {
          const result = classify(input, config);
          expect(result).toBe('possible_left_pronator_drift');
        }
      ),
      { numRuns: 500 }
    );
  });

  it('right arm with both drift AND pronation (no left drift+pronation) produces possible_right_pronator_drift', () => {
    fc.assert(
      fc.property(
        arbClassificationInput({
          leftDrift: false,
          leftPronation: false,
          rightDrift: true,
          rightPronation: true,
          qualityRating: 'acceptable',
        }),
        (input) => {
          const result = classify(input, config);
          expect(result).toBe('possible_right_pronator_drift');
        }
      ),
      { numRuns: 500 }
    );
  });

  it('both arms with sustained drift (no pronation) produces possible_bilateral_drift', () => {
    fc.assert(
      fc.property(
        arbClassificationInput({
          leftDrift: true,
          leftPronation: false,
          rightDrift: true,
          rightPronation: false,
          qualityRating: 'good',
        }),
        (input) => {
          const result = classify(input, config);
          expect(result).toBe('possible_bilateral_drift');
        }
      ),
      { numRuns: 500 }
    );
  });

  it('one arm with drift only (no pronation) produces drift_without_clear_pronation', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          // Left drift only, no pronation on either side
          arbClassificationInput({
            leftDrift: true,
            leftPronation: false,
            rightDrift: false,
            rightPronation: false,
            qualityRating: 'good',
          }),
          // Right drift only, no pronation on either side
          arbClassificationInput({
            leftDrift: false,
            leftPronation: false,
            rightDrift: true,
            rightPronation: false,
            qualityRating: 'acceptable',
          })
        ),
        (input) => {
          const result = classify(input, config);
          expect(result).toBe('drift_without_clear_pronation');
        }
      ),
      { numRuns: 500 }
    );
  });

  it('pronation without drift produces possible_pronation_without_drift', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          arbClassificationInput({
            leftDrift: false,
            leftPronation: true,
            rightDrift: false,
            rightPronation: false,
            qualityRating: 'good',
          }),
          arbClassificationInput({
            leftDrift: false,
            leftPronation: false,
            rightDrift: false,
            rightPronation: true,
            qualityRating: 'acceptable',
          }),
          arbClassificationInput({
            leftDrift: false,
            leftPronation: true,
            rightDrift: false,
            rightPronation: true,
            qualityRating: 'good',
          })
        ),
        (input) => {
          const result = classify(input, config);
          expect(result).toBe('possible_pronation_without_drift');
        }
      ),
      { numRuns: 500 }
    );
  });

  it('neither drift nor pronation produces no_significant_drift', () => {
    fc.assert(
      fc.property(
        arbClassificationInput({
          leftDrift: false,
          leftPronation: false,
          rightDrift: false,
          rightPronation: false,
          qualityRating: 'good',
        }),
        (input) => {
          const result = classify(input, config);
          expect(result).toBe('no_significant_drift');
        }
      ),
      { numRuns: 500 }
    );
  });
});

/**
 * **Validates: Requirements 11.6, 11.7**
 *
 * Property 19: Quality Override and Precedence
 *
 * For any assessment where the quality rating is "low" or "unable_to_assess",
 * the classification shall be "unable_to_assess" regardless of detected drift
 * or pronation values. When multiple classification conditions are met, the
 * highest-precedence classification is returned.
 */
describe('Property 19: Quality Override and Precedence', () => {
  const config = new ConfigStore();

  it('quality "low" always produces unable_to_assess regardless of drift/pronation', () => {
    fc.assert(
      fc.property(
        arbClassificationInput({ qualityRating: 'low' }),
        (input) => {
          const result = classify(input, config);
          expect(result).toBe('unable_to_assess');
        }
      ),
      { numRuns: 500 }
    );
  });

  it('quality "unable_to_assess" always produces unable_to_assess regardless of drift/pronation', () => {
    fc.assert(
      fc.property(
        arbClassificationInput({ qualityRating: 'unable_to_assess' }),
        (input) => {
          const result = classify(input, config);
          expect(result).toBe('unable_to_assess');
        }
      ),
      { numRuns: 500 }
    );
  });

  it('quality "good" or "acceptable" does NOT force unable_to_assess when no issues', () => {
    fc.assert(
      fc.property(
        arbClassificationInput({
          leftDrift: false,
          leftPronation: false,
          rightDrift: false,
          rightPronation: false,
          qualityRating: 'good',
        }),
        (input) => {
          const result = classify(input, config);
          expect(result).not.toBe('unable_to_assess');
        }
      ),
      { numRuns: 500 }
    );
  });

  it('pronator drift takes precedence over bilateral drift when both conditions are met', () => {
    // If left arm has drift+pronation AND right arm also has drift,
    // left pronator drift (priority 2) should beat bilateral drift (priority 4)
    fc.assert(
      fc.property(
        arbClassificationInput({
          leftDrift: true,
          leftPronation: true,
          rightDrift: true,
          rightPronation: false,
          qualityRating: 'good',
        }),
        (input) => {
          const result = classify(input, config);
          expect(result).toBe('possible_left_pronator_drift');
        }
      ),
      { numRuns: 500 }
    );
  });

  it('left pronator drift takes precedence over right pronator drift when both sides qualify', () => {
    // Both arms have drift+pronation: left pronator drift (priority 2) wins over right (priority 3)
    fc.assert(
      fc.property(
        arbClassificationInput({
          leftDrift: true,
          leftPronation: true,
          rightDrift: true,
          rightPronation: true,
          qualityRating: 'acceptable',
        }),
        (input) => {
          const result = classify(input, config);
          expect(result).toBe('possible_left_pronator_drift');
        }
      ),
      { numRuns: 500 }
    );
  });

  it('quality override takes precedence over all other conditions', () => {
    // Even with both arms showing drift+pronation, low quality overrides everything
    fc.assert(
      fc.property(
        fc.oneof(fc.constant<QualityRating>('low'), fc.constant<QualityRating>('unable_to_assess')),
        arbArmAssessment({ sustainedDownwardDrift: true, possiblePronation: true }),
        arbArmAssessment({ sustainedDownwardDrift: true, possiblePronation: true }),
        (qualityRating, leftArm, rightArm) => {
          const input: ClassificationInput = {
            leftArm,
            rightArm,
            quality: {
              overall: qualityRating,
              metrics: {
                validFramePercentage: 50,
                avgPoseConfidence: 0.3,
                avgLeftHandConfidence: 0.3,
                avgRightHandConfidence: 0.3,
                cameraStability: 0.5,
                subjectVisibilityRate: 0.5,
                lightingAdequacyRate: 0.5,
                excessiveTorsoMovement: true,
                handsRemainedVisible: false,
                startingPoseValid: true,
                fullDurationCompleted: false,
              },
              primaryFailureReason: 'low confidence',
              reasons: ['low confidence'],
            },
          };

          const result = classify(input, config);
          expect(result).toBe('unable_to_assess');
        }
      ),
      { numRuns: 500 }
    );
  });
});
