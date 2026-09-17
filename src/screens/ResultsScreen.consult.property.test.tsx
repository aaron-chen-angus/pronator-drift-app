// Feature: pronator-drift-analysis, Property 19: Consult recommendation appears exactly when an indicator is outside its range.
import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { render, screen, cleanup } from '@testing-library/react';
import { ResultsScreen } from './ResultsScreen';
import type {
  PronatorDriftAssessment,
  ArmAssessment,
  QualityAssessment,
  QualityMetrics,
  NormComparison,
  NormOutcome,
  IndicatorKey,
} from '../types/index';

/**
 * **Validates: Requirements 14.3**
 *
 * Property 19: Consult recommendation appears exactly when an indicator is
 * outside its range.
 *
 * In the rendered ResultsScreen, the consult recommendation
 * (data-testid="consult-recommendation") is present if and only if at least
 * one norm comparison in `assessment.normComparisons` has
 * `outcome === 'outside'`.
 *
 * The consult recommendation section in ResultsScreen.tsx renders based only on
 * `normComparisons.some((c) => c.outcome === 'outside')` and is NOT gated by
 * `!isUnableToAssess`. To isolate the property (and keep the indicators section
 * consistent), we keep quality at 'good' throughout.
 */

const ALL_INDICATOR_KEYS: IndicatorKey[] = [
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

// Outcomes other than 'outside' — used to build comparisons that must NOT
// trigger the consult recommendation.
const NON_OUTSIDE_OUTCOMES: NormOutcome[] = [
  'within',
  'no_reference',
  'not_measured',
];

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

function makeGoodQuality(): QualityAssessment {
  return {
    overall: 'good',
    metrics: makeQualityMetrics(),
    primaryFailureReason: null,
    reasons: [],
  };
}

/** Builds a NormComparison for a given key and outcome. */
function makeNormComparison(
  indicatorKey: IndicatorKey,
  outcome: NormOutcome
): NormComparison {
  const hasRange = outcome === 'within' || outcome === 'outside';
  return {
    indicatorKey,
    value: outcome === 'not_measured' ? null : 1.0,
    outcome,
    range: hasRange
      ? {
          lowerBound: 0,
          upperBound: 2,
          unit: 'normalized',
          citation: 'Prototype seed — pending clinical validation',
          prototype: true,
        }
      : null,
    citation: hasRange ? 'Prototype seed — pending clinical validation' : null,
    prototype: true,
  };
}

/** Builds a full assessment carrying the supplied norm comparisons. */
function makeAssessment(
  normComparisons: NormComparison[] | undefined
): PronatorDriftAssessment {
  return {
    assessmentId: 'test-uuid-consult',
    startedAt: '2024-01-01T00:00:00.000Z',
    completedAt: '2024-01-01T00:00:30.000Z',
    durationSeconds: 30,
    deviceType: 'desktop',
    orientation: 'portrait',
    modelVersions: {
      poseModel: 'pose_landmarker_full',
      handModel: 'hand_landmarker',
    },
    quality: makeGoodQuality(),
    leftArm: makeArmAssessment(),
    rightArm: makeArmAssessment(),
    overallClassification: 'no_significant_drift',
    normComparisons,
  };
}

/**
 * Arbitrary producing a list of norm comparisons over a subset of indicator
 * keys, each assigned an arbitrary outcome. This varies the array so some
 * comparisons may be 'outside' and some may not.
 */
const normComparisonsArb: fc.Arbitrary<NormComparison[]> = fc
  .uniqueArray(fc.constantFrom(...ALL_INDICATOR_KEYS), {
    minLength: 0,
    maxLength: ALL_INDICATOR_KEYS.length,
  })
  .chain((keys) =>
    fc.tuple(
      ...keys.map((key) =>
        fc
          .constantFrom<NormOutcome>('within', 'outside', 'no_reference', 'not_measured')
          .map((outcome) => makeNormComparison(key, outcome))
      )
    )
  );

describe('Property 19: Consult recommendation appears exactly when an indicator is outside its range', () => {
  it('renders the consult recommendation iff some comparison has outcome "outside"', () => {
    fc.assert(
      fc.property(normComparisonsArb, (normComparisons) => {
        cleanup();
        const assessment = makeAssessment(normComparisons);
        render(<ResultsScreen dispatch={vi.fn()} assessment={assessment} />);

        const expectedPresent = normComparisons.some(
          (c) => c.outcome === 'outside'
        );
        const actualPresent =
          screen.queryByTestId('consult-recommendation') !== null;

        expect(actualPresent).toBe(expectedPresent);

        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  it('renders the consult recommendation when at least one comparison is outside, regardless of other outcomes', () => {
    // Guarantee at least one 'outside' comparison alongside arbitrary others.
    const withOutsideArb = fc
      .uniqueArray(fc.constantFrom(...ALL_INDICATOR_KEYS), {
        minLength: 1,
        maxLength: ALL_INDICATOR_KEYS.length,
      })
      .chain((keys) =>
        fc
          .tuple(
            ...keys.map((key, idx) =>
              // Force the first key to be 'outside'; others are arbitrary.
              (idx === 0
                ? fc.constant<NormOutcome>('outside')
                : fc.constantFrom<NormOutcome>(
                    'within',
                    'outside',
                    'no_reference',
                    'not_measured'
                  )
              ).map((outcome) => makeNormComparison(key, outcome))
            )
          )
      );

    fc.assert(
      fc.property(withOutsideArb, (normComparisons) => {
        cleanup();
        const assessment = makeAssessment(normComparisons);
        render(<ResultsScreen dispatch={vi.fn()} assessment={assessment} />);

        expect(screen.queryByTestId('consult-recommendation')).not.toBeNull();

        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  it('does not render the consult recommendation when no comparison is outside', () => {
    // Build comparisons that never use the 'outside' outcome.
    const noOutsideArb = fc
      .uniqueArray(fc.constantFrom(...ALL_INDICATOR_KEYS), {
        minLength: 0,
        maxLength: ALL_INDICATOR_KEYS.length,
      })
      .chain((keys) =>
        fc.tuple(
          ...keys.map((key) =>
            fc
              .constantFrom<NormOutcome>(...NON_OUTSIDE_OUTCOMES)
              .map((outcome) => makeNormComparison(key, outcome))
          )
        )
      );

    fc.assert(
      fc.property(noOutsideArb, (normComparisons) => {
        cleanup();
        const assessment = makeAssessment(normComparisons);
        render(<ResultsScreen dispatch={vi.fn()} assessment={assessment} />);

        expect(screen.queryByTestId('consult-recommendation')).toBeNull();

        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  it('does not render the consult recommendation when normComparisons is empty or undefined', () => {
    // Empty array.
    cleanup();
    render(
      <ResultsScreen dispatch={vi.fn()} assessment={makeAssessment([])} />
    );
    expect(screen.queryByTestId('consult-recommendation')).toBeNull();

    // Undefined normComparisons (assessment built without the field).
    cleanup();
    render(
      <ResultsScreen dispatch={vi.fn()} assessment={makeAssessment(undefined)} />
    );
    expect(screen.queryByTestId('consult-recommendation')).toBeNull();
    cleanup();
  });
});
