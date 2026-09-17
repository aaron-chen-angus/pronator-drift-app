/**
 * buildAssessmentFromAnalysis — real result builder.
 *
 * Replaces the placeholder `buildAssessment()`. It assembles a populated,
 * extended `PronatorDriftAssessment` from an `AssessmentAnalysisResult`
 * (produced by `AssessmentLoop.finalize()`), running the existing `classify()`
 * precedence over per-arm flags + quality, and attaching derived indicators,
 * norm comparisons, the assessed arm, and frame-accounting metadata.
 *
 * Requirements: 1.4, 1.5, 15.3, 15.4, 17.3
 *
 * INPUT TYPE:
 * The `AssessmentAnalysisResult` shape is produced by `AssessmentLoop.finalize()`
 * (Task 10.1) and imported from `src/analysis/AssessmentLoop.ts`. It is re-exported
 * here for convenience of downstream consumers.
 */

import type {
  ArmAssessment,
  IndicatorKey,
  MicroMovementIndicators,
  NormComparison,
  PronatorDriftAssessment,
} from '../types/index';
import type { ConfigStore } from '../config/ConfigStore';
import type { AssessmentAnalysisResult } from './AssessmentLoop';
import { classify } from './Classifier';
import { compareToNorm } from './NormComparator';

export type { AssessmentAnalysisResult } from './AssessmentLoop';

/** Indicator keys that have a representable scalar value for norm comparison. */
const NORM_COMPARISON_KEYS: IndicatorKey[] = [
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

function detectDeviceType(): 'mobile' | 'tablet' | 'desktop' {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet/.test(ua)) return 'tablet';
  if (/mobile|iphone|android/.test(ua)) return 'mobile';
  return 'desktop';
}

function generateAssessmentId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `assessment-${Date.now()}`;
}

/**
 * Extracts a representable scalar value for an indicator key from the derived
 * indicators, preferring the aggregate scalar findings where they exist and
 * falling back to the time-series summary maximum otherwise.
 */
function indicatorScalarValue(
  key: IndicatorKey,
  indicators: MicroMovementIndicators,
  maxDrift: { left: number; right: number }
): number | null {
  switch (key) {
    // wristDrift is a placeholder on the indicators; source it from DriftAnalyzer.
    case 'wristDrift':
      return maxDrift[indicators.assessedArm];
    case 'palmRotationChange':
      return indicators.totalPalmRotationChangeDegrees;
    case 'elbowFlexionChange':
      return indicators.maxElbowFlexionChangeDegrees;
    case 'armToTorsoChange':
      return indicators.maxArmToTorsoChangeDegrees;
    default: {
      // Fall back to the per-indicator time-series summary maximum.
      const series = indicators[key];
      return series ? series.summary.max : null;
    }
  }
}

function isIndicatorMeasurable(
  key: IndicatorKey,
  indicators: MicroMovementIndicators
): boolean {
  // wristDrift derives from pose-based DriftAnalyzer output and is always measurable.
  if (key === 'wristDrift') return true;
  const series = indicators[key];
  return series ? series.measurable : false;
}

/**
 * Builds the per-arm `ArmAssessment` for the assessed arm from the derived
 * indicators and the drift-analyzer aggregates.
 */
function buildAssessedArm(
  result: AssessmentAnalysisResult
): ArmAssessment {
  const { assessedArm, indicators, maxDrift, driftOnset, baseline } = result;
  const armBaseline =
    assessedArm === 'left' ? baseline.leftArm : baseline.rightArm;

  return {
    baselineWristHeight: armBaseline.normalizedWristHeight,
    // wristDrift indicator is a placeholder — use the DriftAnalyzer max drift.
    maximumDownwardDriftNormalised: maxDrift[assessedArm],
    driftDurationMilliseconds: indicators.sustainedDriftDurationMs,
    driftOnsetSeconds: driftOnset[assessedArm],
    maximumElbowFlexionChangeDegrees: indicators.maxElbowFlexionChangeDegrees,
    estimatedPalmRotationChangeDegrees: indicators.totalPalmRotationChangeDegrees,
    possiblePronation: indicators.possiblePronation,
    sustainedDownwardDrift: indicators.sustainedDrift,
    confidence: indicators.wristDrift.measurable
      ? Math.min(1, result.quality.metrics.avgPoseConfidence)
      : 0,
  };
}

/**
 * Builds a drift-only `ArmAssessment` for the non-assessed arm from the
 * DriftAnalyzer aggregates (micro-movement indicators are only computed for the
 * assessed arm).
 */
function buildNonAssessedArm(
  result: AssessmentAnalysisResult,
  arm: 'left' | 'right'
): ArmAssessment {
  const { maxDrift, driftOnset, baseline } = result;
  const armBaseline = arm === 'left' ? baseline.leftArm : baseline.rightArm;

  return {
    baselineWristHeight: armBaseline.normalizedWristHeight,
    maximumDownwardDriftNormalised: maxDrift[arm],
    driftDurationMilliseconds: 0,
    driftOnsetSeconds: driftOnset[arm],
    maximumElbowFlexionChangeDegrees: 0,
    estimatedPalmRotationChangeDegrees: null,
    possiblePronation: false,
    sustainedDownwardDrift: driftOnset[arm] !== null,
    confidence: 0,
  };
}

/**
 * Assembles a populated `PronatorDriftAssessment` from an
 * `AssessmentAnalysisResult`.
 */
export function buildAssessmentFromAnalysis(
  result: AssessmentAnalysisResult,
  config: ConfigStore
): PronatorDriftAssessment {
  const { assessedArm, indicators, quality } = result;

  // Per-arm assessments: the assessed arm gets full indicators; the other arm
  // is populated from DriftAnalyzer where available.
  const assessedArmAssessment = buildAssessedArm(result);
  const otherArm: 'left' | 'right' = assessedArm === 'left' ? 'right' : 'left';
  const otherArmAssessment = buildNonAssessedArm(result, otherArm);

  const leftArm = assessedArm === 'left' ? assessedArmAssessment : otherArmAssessment;
  const rightArm = assessedArm === 'right' ? assessedArmAssessment : otherArmAssessment;

  // Run the existing classification precedence over per-arm flags + quality.
  let overallClassification = classify({ leftArm, rightArm, quality }, config);

  // Force unable_to_assess when no valid assessed-arm frames existed (Req 1.5)
  // or the valid-frame percentage is below the configured minimum (Req 15.4).
  // classify() already returns unable_to_assess for low quality; override here
  // to guarantee the contract regardless of the quality rating.
  const validFramePercentage = quality.metrics.validFramePercentage;
  const minValidFramePercentage = config.get('minValidFramePercentage');
  if (
    result.noValidAssessedArmFrames ||
    validFramePercentage < minValidFramePercentage
  ) {
    overallClassification = 'unable_to_assess';
  }

  // Norm comparisons for each representable indicator scalar (Req 9.x wiring).
  const normComparisons: NormComparison[] = NORM_COMPARISON_KEYS.map((key) =>
    compareToNorm(
      key,
      indicatorScalarValue(key, indicators, result.maxDrift),
      isIndicatorMeasurable(key, indicators),
      config
    )
  );

  // Effective frame rate (valid frames / duration) per Req 17.3, taken from the
  // loop result which computed it during finalize.
  const effectiveFrameRate = result.effectiveFrameRate;
  const frameRateBelowMinimum =
    effectiveFrameRate < config.get('minAnalysisFrameRate');

  const startedAt = new Date(result.startedAtMs).toISOString();
  const completedAt = new Date(
    result.startedAtMs + result.durationSeconds * 1000
  ).toISOString();

  return {
    assessmentId: generateAssessmentId(),
    startedAt,
    completedAt,
    durationSeconds: result.durationSeconds,
    deviceType: detectDeviceType(),
    orientation: 'portrait',
    modelVersions: {
      poseModel: 'pose_landmarker_lite/float16/1',
      handModel: 'hand_landmarker/float16/1',
      classifier: 'prototype',
    },
    quality,
    leftArm,
    rightArm,
    overallClassification,
    // Extended fields.
    indicators,
    normComparisons,
    assessedArm,
    analysisMeta: {
      deliveredFrameCount: result.deliveredFrameCount,
      droppedFrameCount: result.droppedFrameCount,
      effectiveFrameRate,
      frameRateBelowMinimum,
      recordingStatus: result.recording.status,
    },
  };
}
