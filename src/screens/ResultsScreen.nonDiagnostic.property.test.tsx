// Feature: pronator-drift-analysis, Property 20: Non-diagnostic language is preserved across all outcomes
import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { render, cleanup } from '@testing-library/react';
import { ResultsScreen } from './ResultsScreen';
import type {
  PronatorDriftAssessment,
  OverallClassification,
  QualityRating,
  ArmAssessment,
  QualityAssessment,
  QualityMetrics,
  MicroMovementIndicators,
  TimeSeriesIndicator,
  NormComparison,
  NormOutcome,
  IndicatorKey,
  NormativeRange,
} from '../types/index';

/**
 * **Validates: Requirements 13.6, 14.2**
 *
 * Property 20: Non-diagnostic language is preserved across all outcomes.
 *
 * Across ALL classification outcomes and indicator / norm-comparison states,
 * the rendered ResultsScreen never contains diagnostic wording that names or
 * asserts a medical condition (Req 14.2), AND always contains the
 * screening-not-diagnosis framing plus the medical disclaimer (Req 13.6 / 14.1).
 */

// ─── Domain enumerations (drawn from the type union, all 7 values) ────────────
const ALL_CLASSIFICATIONS: OverallClassification[] = [
  'no_significant_drift',
  'possible_left_pronator_drift',
  'possible_right_pronator_drift',
  'possible_bilateral_drift',
  'drift_without_clear_pronation',
  'possible_pronation_without_drift',
  'unable_to_assess',
];

const ALL_QUALITY_RATINGS: QualityRating[] = [
  'good',
  'acceptable',
  'low',
  'unable_to_assess',
];

const ALL_NORM_OUTCOMES: NormOutcome[] = [
  'within',
  'outside',
  'no_reference',
  'not_measured',
];

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

/**
 * Conservative forbidden-term list: disease / condition NAMES and affirmative
 * diagnostic verbs that would assert a diagnosis. Deliberately excludes words
 * the component legitimately renders (e.g. "possible", "pronation", "drift",
 * "observed", "detected", and "diagnosis" — which appears only in the negated
 * disclaimer "not a medical diagnosis" / "does not constitute a medical
 * diagnosis"). Matched with word boundaries, case-insensitively.
 */
const FORBIDDEN_DIAGNOSTIC_TERMS: RegExp[] = [
  /\bstroke\b/i,
  /\bdiagnosed with\b/i,
  /\byou have\b/i,
  /\bconfirms\b/i,
  /\bconfirmed\b/i,
  /\bdisease\b/i,
  /\blesion\b/i,
  /\bpathology\b/i,
  /\bneurological (?:condition|disorder|disease)\b/i,
  /\bdefinite\b/i,
  /\bproven\b/i,
];

// ─── Builders for a fully-populated assessment ────────────────────────────────
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

function makeQualityAssessment(rating: QualityRating): QualityAssessment {
  const degraded = rating === 'low' || rating === 'unable_to_assess';
  return {
    overall: rating,
    metrics: makeQualityMetrics(),
    primaryFailureReason: degraded ? 'Insufficient tracking confidence' : null,
    reasons: degraded ? ['Insufficient tracking confidence'] : [],
  };
}

function makeIndicator(
  key: IndicatorKey,
  measurable: boolean,
  poseOnly: boolean
): TimeSeriesIndicator {
  return {
    key,
    measurable,
    poseOnly,
    samples: measurable
      ? [
          { timestamp: 0, value: 0.01 },
          { timestamp: 500, value: 0.03 },
          { timestamp: 1000, value: 0.02 },
        ]
      : [],
    summary: measurable
      ? { mean: 0.02, max: 0.03, standardDeviation: 0.01, validFrameCount: 3 }
      : { mean: null, max: null, standardDeviation: null, validFrameCount: 0 },
    unit: 'norm',
  };
}

function makeIndicators(
  measurable: boolean,
  poseOnly: boolean,
  usedPoseOnlyPath: boolean
): MicroMovementIndicators {
  const build = (k: IndicatorKey) => makeIndicator(k, measurable, poseOnly);
  return {
    assessedArm: 'left',
    wristDrift: build('wristDrift'),
    elbowDrift: build('elbowDrift'),
    elbowFlexionChange: build('elbowFlexionChange'),
    armToTorsoChange: build('armToTorsoChange'),
    palmRotationChange: build('palmRotationChange'),
    wristTremorAmplitude: build('wristTremorAmplitude'),
    fingertipTremorAmplitude: build('fingertipTremorAmplitude'),
    wristTremorDominantFrequency: build('wristTremorDominantFrequency'),
    stability: build('stability'),
    fingerCurlChange: build('fingerCurlChange'),
    fingerSpreadChange: build('fingerSpreadChange'),
    maxElbowFlexionChangeDegrees: 3.0,
    maxArmToTorsoChangeDegrees: 2.0,
    totalPalmRotationChangeDegrees: measurable ? 10.0 : null,
    possiblePronation: false,
    supinationToPronationTrend: false,
    sustainedDrift: false,
    sustainedDriftDurationMs: 0,
    dominantFrequencyBandwidthLimited: false,
    usedPoseOnlyPath,
  };
}

function makeRange(): NormativeRange {
  return {
    lowerBound: 0.0,
    upperBound: 0.05,
    unit: 'norm',
    citation: 'Prototype reference (pending validation)',
    prototype: true,
  };
}

function makeNormComparison(
  indicatorKey: IndicatorKey,
  outcome: NormOutcome
): NormComparison {
  const hasRange = outcome === 'within' || outcome === 'outside';
  return {
    indicatorKey,
    value: outcome === 'not_measured' ? null : 0.02,
    outcome,
    range: hasRange ? makeRange() : null,
    citation: hasRange ? 'Prototype reference (pending validation)' : null,
    prototype: true,
  };
}

function makeAssessment(params: {
  classification: OverallClassification;
  quality: QualityRating;
  includeIndicators: boolean;
  measurable: boolean;
  poseOnly: boolean;
  usedPoseOnlyPath: boolean;
  frameRateBelowMinimum: boolean;
  normOutcomes: NormOutcome[];
}): PronatorDriftAssessment {
  const {
    classification,
    quality,
    includeIndicators,
    measurable,
    poseOnly,
    usedPoseOnlyPath,
    frameRateBelowMinimum,
    normOutcomes,
  } = params;

  const normComparisons: NormComparison[] = normOutcomes.map((outcome, i) =>
    makeNormComparison(ALL_INDICATOR_KEYS[i % ALL_INDICATOR_KEYS.length], outcome)
  );

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
    quality: makeQualityAssessment(quality),
    leftArm: makeArmAssessment(),
    rightArm: makeArmAssessment(),
    overallClassification: classification,
    indicators: includeIndicators
      ? makeIndicators(measurable, poseOnly, usedPoseOnlyPath)
      : undefined,
    normComparisons: includeIndicators ? normComparisons : undefined,
    analysisMeta: { frameRateBelowMinimum },
  } as PronatorDriftAssessment;
}

describe('Property 20: Non-diagnostic language is preserved across all outcomes', () => {
  it('never renders diagnostic condition wording and always preserves screening framing + disclaimer', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_CLASSIFICATIONS),
        fc.constantFrom(...ALL_QUALITY_RATINGS),
        fc.boolean(), // includeIndicators
        fc.boolean(), // measurable
        fc.boolean(), // poseOnly
        fc.boolean(), // usedPoseOnlyPath
        fc.boolean(), // frameRateBelowMinimum
        fc.array(fc.constantFrom(...ALL_NORM_OUTCOMES), {
          minLength: 0,
          maxLength: ALL_INDICATOR_KEYS.length,
        }),
        (
          classification,
          quality,
          includeIndicators,
          measurable,
          poseOnly,
          usedPoseOnlyPath,
          frameRateBelowMinimum,
          normOutcomes
        ) => {
          cleanup();
          const dispatch = vi.fn();
          const assessment = makeAssessment({
            classification,
            quality,
            includeIndicators,
            measurable,
            poseOnly,
            usedPoseOnlyPath,
            frameRateBelowMinimum,
            normOutcomes,
          });

          const { container } = render(
            <ResultsScreen dispatch={dispatch} assessment={assessment} />
          );

          const rendered = container.textContent ?? '';

          // (Req 14.2) No diagnostic wording that names or asserts a condition.
          for (const forbidden of FORBIDDEN_DIAGNOSTIC_TERMS) {
            expect(
              forbidden.test(rendered),
              `Forbidden diagnostic term ${forbidden} appeared in rendered output for ` +
                `classification=${classification}, quality=${quality}`
            ).toBe(false);
          }

          // (Req 14.1 / 13.6) Screening-not-diagnosis framing is present.
          const screeningEl = container.querySelector(
            '[data-testid="screening-not-diagnosis"]'
          );
          expect(screeningEl).not.toBeNull();
          expect(screeningEl?.textContent ?? '').toMatch(
            /screening indication, not a medical diagnosis/i
          );

          // (Req 13.6) Medical disclaimer text is preserved.
          expect(rendered).toMatch(/does not constitute a medical diagnosis/i);

          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });
});
