import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { render, screen, cleanup } from '@testing-library/react';
import { ResultsScreen } from './ResultsScreen';
import type {
  PronatorDriftAssessment,
  OverallClassification,
  QualityRating,
  ArmAssessment,
  QualityAssessment,
  QualityMetrics,
} from '../types/index';

/**
 * **Validates: Requirements 20.1, 20.2, 20.3, 20.4, 20.5**
 *
 * Property 24: Non-Diagnostic Language in Results
 *
 * For any classification result displayed to the user, the text shall use
 * qualifying terms ("possible", "observed", "detected") and shall never use
 * "confirmed", "definite", "proven", "diagnosis", or "diagnosed" to describe
 * the application's own findings.
 */

// All valid classification categories
const allClassifications: OverallClassification[] = [
  'no_significant_drift',
  'possible_left_pronator_drift',
  'possible_right_pronator_drift',
  'possible_bilateral_drift',
  'drift_without_clear_pronation',
  'possible_pronation_without_drift',
  'unable_to_assess',
];

// All valid quality ratings
const allQualityRatings: QualityRating[] = [
  'good',
  'acceptable',
  'low',
  'unable_to_assess',
];

// Forbidden definitive diagnostic terms
const FORBIDDEN_DIAGNOSTIC_TERMS = [
  'confirmed',
  'definite',
  'diagnosis',
  'proven',
  'conclusive',
  'diagnosed',
];

// Forbidden alarmist terms (uppercase)
const FORBIDDEN_ALARMIST_TERMS = ['DANGER', 'CRITICAL', 'WARNING'];

// Qualifying terms that should appear in classification text
const QUALIFYING_TERMS = ['possible', 'observed', 'detected'];

/** Arbitrary for a valid OverallClassification */
const classificationArb = fc.constantFrom(...allClassifications);

/** Arbitrary for a valid QualityRating */
const qualityRatingArb = fc.constantFrom(...allQualityRatings);

/** Generate a mock ArmAssessment */
function makeArmAssessment(): ArmAssessment {
  return {
    baselineWristHeight: 0.5,
    maximumDownwardDriftNormalised: 0.05,
    driftDurationMilliseconds: 1000,
    driftOnsetSeconds: 5.0,
    maximumElbowFlexionChangeDegrees: 3.0,
    estimatedPalmRotationChangeDegrees: 10.0,
    possiblePronation: false,
    sustainedDownwardDrift: false,
    confidence: 0.9,
  };
}

/** Generate a mock QualityMetrics */
function makeQualityMetrics(): QualityMetrics {
  return {
    validFramePercentage: 85,
    avgPoseConfidence: 0.8,
    avgLeftHandConfidence: 0.7,
    avgRightHandConfidence: 0.7,
    cameraStability: 0.9,
    subjectVisibilityRate: 0.95,
    lightingAdequacyRate: 0.9,
    excessiveTorsoMovement: false,
    handsRemainedVisible: true,
    startingPoseValid: true,
    fullDurationCompleted: true,
  };
}

/** Create a mock QualityAssessment for a given rating */
function makeQualityAssessment(rating: QualityRating): QualityAssessment {
  return {
    overall: rating,
    metrics: makeQualityMetrics(),
    primaryFailureReason:
      rating === 'low' || rating === 'unable_to_assess'
        ? 'Insufficient tracking confidence'
        : null,
    reasons:
      rating === 'low' || rating === 'unable_to_assess'
        ? ['Insufficient tracking confidence']
        : [],
  };
}

/** Create a full PronatorDriftAssessment for the given classification and quality */
function makeAssessment(
  classification: OverallClassification,
  qualityRating: QualityRating
): PronatorDriftAssessment {
  return {
    assessmentId: 'test-uuid-1234',
    startedAt: '2024-01-01T00:00:00.000Z',
    completedAt: '2024-01-01T00:00:30.000Z',
    durationSeconds: 30,
    deviceType: 'desktop',
    orientation: 'portrait',
    modelVersions: {
      poseModel: 'pose_landmarker_full',
      handModel: 'hand_landmarker',
    },
    quality: makeQualityAssessment(qualityRating),
    leftArm: makeArmAssessment(),
    rightArm: makeArmAssessment(),
    overallClassification: classification,
  };
}

describe('Property 24: Non-Diagnostic Language in Results', () => {
  it('for any valid classification, the display text uses qualifying language (contains "possible", "observed", or "detected")', () => {
    // Classifications that should display observation text (excluding unable_to_assess which has a special message)
    const displayableClassifications = allClassifications.filter(
      (c) => c !== 'unable_to_assess'
    );

    fc.assert(
      fc.property(
        fc.constantFrom(...displayableClassifications),
        (classification) => {
          cleanup();
          const dispatch = vi.fn();
          const assessment = makeAssessment(classification, 'good');
          render(<ResultsScreen dispatch={dispatch} assessment={assessment} />);

          const observationSection = screen.getByLabelText('Observation');
          const text = observationSection.textContent!.toLowerCase();

          const hasQualifyingTerm = QUALIFYING_TERMS.some((term) =>
            text.includes(term)
          );
          expect(hasQualifyingTerm).toBe(true);

          cleanup();
        }
      ),
      { numRuns: 50 }
    );
  });

  it('the display text does NOT contain definitive diagnostic terms like "confirmed", "definite", "diagnosis", "proven", "conclusive"', () => {
    fc.assert(
      fc.property(classificationArb, qualityRatingArb, (classification, qualityRating) => {
        cleanup();
        const dispatch = vi.fn();
        const assessment = makeAssessment(classification, qualityRating);
        render(<ResultsScreen dispatch={dispatch} assessment={assessment} />);

        // Get all text content from the observation section
        const observationSection = screen.getByLabelText('Observation');
        const observationText = observationSection.textContent!.toLowerCase();

        for (const term of FORBIDDEN_DIAGNOSTIC_TERMS) {
          expect(observationText).not.toContain(term.toLowerCase());
        }

        cleanup();
      }),
      { numRuns: 50 }
    );
  });

  it('for any quality rating, the quality display text does NOT use alarmist language (no "DANGER", "CRITICAL", "WARNING" in uppercase)', () => {
    fc.assert(
      fc.property(classificationArb, qualityRatingArb, (classification, qualityRating) => {
        cleanup();
        const dispatch = vi.fn();
        const assessment = makeAssessment(classification, qualityRating);
        render(<ResultsScreen dispatch={dispatch} assessment={assessment} />);

        const qualitySection = screen.getByLabelText('Assessment quality');
        const qualityText = qualitySection.textContent!;

        for (const term of FORBIDDEN_ALARMIST_TERMS) {
          expect(qualityText).not.toContain(term);
        }

        cleanup();
      }),
      { numRuns: 50 }
    );
  });

  it('the medical disclaimer is always present regardless of classification', () => {
    fc.assert(
      fc.property(classificationArb, qualityRatingArb, (classification, qualityRating) => {
        cleanup();
        const dispatch = vi.fn();
        const assessment = makeAssessment(classification, qualityRating);
        render(<ResultsScreen dispatch={dispatch} assessment={assessment} />);

        // The disclaimer should always be present
        const disclaimerText = screen.getByText(/does not constitute a medical diagnosis/i);
        expect(disclaimerText).toBeTruthy();

        cleanup();
      }),
      { numRuns: 50 }
    );
  });
});
