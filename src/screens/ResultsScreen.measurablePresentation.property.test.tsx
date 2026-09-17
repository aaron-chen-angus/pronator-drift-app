// Feature: pronator-drift-analysis, Property 21: Results present each measurable indicator with its value and variability

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { render, screen, cleanup } from '@testing-library/react';
import { ResultsScreen } from './ResultsScreen';
import type {
  PronatorDriftAssessment,
  ArmAssessment,
  QualityAssessment,
  QualityMetrics,
  QualityRating,
  IndicatorKey,
  IndicatorSample,
  SummaryStatistic,
  TimeSeriesIndicator,
  MicroMovementIndicators,
} from '../types/index';

/**
 * **Validates: Requirements 13.2**
 *
 * Property 21: Results present each measurable indicator with its value and
 * variability.
 *
 * In the rendered ResultsScreen, for a non-`unable_to_assess` assessment that
 * carries `indicators`, every MEASURABLE indicator
 * (`indicators[key].measurable === true`) is presented with its value
 * (`formatIndicatorValue(summary.max)`) and its variability summary statistic
 * (`formatVariability(summary.standardDeviation)`). Not-measurable indicators
 * are omitted from the measurable list and instead shown as "Not measured"
 * under the not-measured list.
 */

// ─── Constants mirrored from ResultsScreen presentation logic ────────────────

const INDICATOR_ORDER: IndicatorKey[] = [
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

/** Unit per indicator (mirrors builder output; only used for display checks). */
const INDICATOR_UNIT: Record<IndicatorKey, string> = {
  wristDrift: 'normalized',
  elbowDrift: 'normalized',
  elbowFlexionChange: 'degrees',
  armToTorsoChange: 'degrees',
  palmRotationChange: 'degrees',
  wristTremorAmplitude: 'normalized',
  fingertipTremorAmplitude: 'normalized',
  wristTremorDominantFrequency: 'hertz',
  stability: 'normalized',
  fingerCurlChange: 'normalized',
  fingerSpreadChange: 'normalized',
};

// ─── Formatting helpers (must match ResultsScreen.tsx exactly) ───────────────

/** Mirror of ResultsScreen.formatIndicatorValue. */
function expectedValueText(value: number | null, unit: string): string {
  if (value === null || Number.isNaN(value)) {
    return 'Not available';
  }
  const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
  return unit ? `${rounded} ${unit}` : rounded;
}

/** Mirror of ResultsScreen.formatVariability. */
function expectedVariabilityText(sd: number | null, unit: string): string {
  if (sd === null || Number.isNaN(sd)) {
    return 'Variability not available';
  }
  const rounded = Math.abs(sd) >= 100 ? sd.toFixed(0) : sd.toFixed(2);
  return `Variability (standard deviation): ${rounded}${unit ? ` ${unit}` : ''}`;
}

// ─── Arbitraries / builders ──────────────────────────────────────────────────

const finite = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

/**
 * A per-indicator spec: whether it is measurable, plus the max/std values used
 * to build a summary. When measurable, max and std are finite numbers so the
 * value and variability descriptors are defined.
 */
interface IndicatorSpec {
  measurable: boolean;
  max: number;
  std: number;
  poseOnly: boolean;
}

const indicatorSpecArb: fc.Arbitrary<IndicatorSpec> = fc.record({
  measurable: fc.boolean(),
  // Bound away from 100 to keep .toFixed(2) formatting deterministic and avoid
  // ambiguity around the abs>=100 rounding branch.
  max: finite(-99, 99),
  std: finite(0, 99),
  poseOnly: fc.boolean(),
});

function makeSummary(
  measurable: boolean,
  max: number,
  std: number
): SummaryStatistic {
  if (!measurable) {
    return { mean: null, max: null, standardDeviation: null, validFrameCount: 0 };
  }
  return { mean: max, max, standardDeviation: std, validFrameCount: 3 };
}

function makeSeries(key: IndicatorKey, spec: IndicatorSpec): TimeSeriesIndicator {
  const samples: IndicatorSample[] = spec.measurable
    ? [
        { timestamp: 0, value: spec.max },
        { timestamp: 100, value: spec.max },
      ]
    : [];
  return {
    key,
    measurable: spec.measurable,
    poseOnly: spec.poseOnly,
    samples,
    summary: makeSummary(spec.measurable, spec.max, spec.std),
    unit: INDICATOR_UNIT[key],
  };
}

function makeIndicators(
  specs: Record<IndicatorKey, IndicatorSpec>
): MicroMovementIndicators {
  const anyPoseOnly = INDICATOR_ORDER.some((k) => specs[k].measurable && specs[k].poseOnly);
  return {
    assessedArm: 'right',
    wristDrift: makeSeries('wristDrift', specs.wristDrift),
    elbowDrift: makeSeries('elbowDrift', specs.elbowDrift),
    elbowFlexionChange: makeSeries('elbowFlexionChange', specs.elbowFlexionChange),
    armToTorsoChange: makeSeries('armToTorsoChange', specs.armToTorsoChange),
    palmRotationChange: makeSeries('palmRotationChange', specs.palmRotationChange),
    wristTremorAmplitude: makeSeries('wristTremorAmplitude', specs.wristTremorAmplitude),
    fingertipTremorAmplitude: makeSeries(
      'fingertipTremorAmplitude',
      specs.fingertipTremorAmplitude
    ),
    wristTremorDominantFrequency: makeSeries(
      'wristTremorDominantFrequency',
      specs.wristTremorDominantFrequency
    ),
    stability: makeSeries('stability', specs.stability),
    fingerCurlChange: makeSeries('fingerCurlChange', specs.fingerCurlChange),
    fingerSpreadChange: makeSeries('fingerSpreadChange', specs.fingerSpreadChange),

    maxElbowFlexionChangeDegrees: 0,
    maxArmToTorsoChangeDegrees: 0,
    totalPalmRotationChangeDegrees: 0,
    possiblePronation: false,
    supinationToPronationTrend: false,
    sustainedDrift: false,
    sustainedDriftDurationMs: 0,
    dominantFrequencyBandwidthLimited: false,
    usedPoseOnlyPath: anyPoseOnly,
  };
}

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
    validFramePercentage: 90,
    avgPoseConfidence: 0.9,
    avgLeftHandConfidence: 0.8,
    avgRightHandConfidence: 0.8,
    cameraStability: 0.95,
    subjectVisibilityRate: 0.98,
    lightingAdequacyRate: 0.95,
    excessiveTorsoMovement: false,
    handsRemainedVisible: true,
    startingPoseValid: true,
    fullDurationCompleted: true,
  };
}

function makeQuality(rating: QualityRating): QualityAssessment {
  return {
    overall: rating,
    metrics: makeQualityMetrics(),
    primaryFailureReason: null,
    reasons: [],
  };
}

function makeAssessment(
  indicators: MicroMovementIndicators,
  rating: QualityRating
): PronatorDriftAssessment {
  return {
    assessmentId: 'test-uuid-13-6',
    startedAt: '2024-01-01T00:00:00.000Z',
    completedAt: '2024-01-01T00:00:30.000Z',
    durationSeconds: 30,
    deviceType: 'desktop',
    orientation: 'portrait',
    modelVersions: {
      poseModel: 'pose_landmarker_full',
      handModel: 'hand_landmarker',
    },
    quality: makeQuality(rating),
    leftArm: makeArmAssessment(),
    rightArm: makeArmAssessment(),
    overallClassification: 'no_significant_drift',
    indicators,
  };
}

describe('Property 21: Results present each measurable indicator with its value and variability', () => {
  it('renders every measurable indicator with its value + variability, and omits not-measurable ones from the measurable list', () => {
    fc.assert(
      fc.property(
        // One spec per indicator, and a rating that keeps the indicators
        // section visible (good/acceptable => not unable_to_assess).
        fc.record({
          wristDrift: indicatorSpecArb,
          elbowDrift: indicatorSpecArb,
          elbowFlexionChange: indicatorSpecArb,
          armToTorsoChange: indicatorSpecArb,
          palmRotationChange: indicatorSpecArb,
          wristTremorAmplitude: indicatorSpecArb,
          fingertipTremorAmplitude: indicatorSpecArb,
          wristTremorDominantFrequency: indicatorSpecArb,
          stability: indicatorSpecArb,
          fingerCurlChange: indicatorSpecArb,
          fingerSpreadChange: indicatorSpecArb,
        }),
        fc.constantFrom<QualityRating>('good', 'acceptable'),
        (specs, rating) => {
          cleanup();
          const dispatch = vi.fn();
          const indicators = makeIndicators(specs as Record<IndicatorKey, IndicatorSpec>);
          const assessment = makeAssessment(indicators, rating);
          render(<ResultsScreen dispatch={dispatch} assessment={assessment} />);

          for (const key of INDICATOR_ORDER) {
            const spec = (specs as Record<IndicatorKey, IndicatorSpec>)[key];
            const series = indicators[key] as TimeSeriesIndicator;

            if (spec.measurable) {
              // Measurable => present in the measurable list with value + variability.
              const item = screen.queryByTestId(`indicator-${key}`);
              expect(item, `measurable indicator ${key} should be rendered`).not.toBeNull();

              const text = item!.textContent ?? '';
              // Value descriptor from formatIndicatorValue(summary.max).
              expect(
                text,
                `measurable indicator ${key} should show its value`
              ).toContain(expectedValueText(series.summary.max, series.unit));
              // Variability descriptor from formatVariability(summary.standardDeviation).
              expect(
                text,
                `measurable indicator ${key} should show its variability`
              ).toContain(
                expectedVariabilityText(series.summary.standardDeviation, series.unit)
              );
              expect(
                text.toLowerCase(),
                `measurable indicator ${key} should describe variability`
              ).toContain('variability');

              // It must NOT appear in the not-measured list.
              expect(
                screen.queryByTestId(`indicator-not-measured-${key}`),
                `measurable indicator ${key} should not be in the not-measured list`
              ).toBeNull();
            } else {
              // Not measurable => absent from the measurable list, present as "Not measured".
              expect(
                screen.queryByTestId(`indicator-${key}`),
                `not-measurable indicator ${key} should be omitted from the measurable list`
              ).toBeNull();

              const notMeasured = screen.queryByTestId(`indicator-not-measured-${key}`);
              expect(
                notMeasured,
                `not-measurable indicator ${key} should be shown as not measured`
              ).not.toBeNull();
              expect(notMeasured!.textContent ?? '').toContain('Not measured');
            }
          }

          cleanup();
        }
      ),
      { numRuns: 120 }
    );
  });
});
