/**
 * QualityAssessor — evaluates assessment reliability from tracking metrics.
 *
 * Produces exactly one quality rating per assessment: good, acceptable, low, or unable_to_assess.
 * All thresholds are prototype values requiring clinical validation.
 */

import type { DriftFrame, Baseline, QualityMetrics, QualityRating, QualityAssessment } from '../types';
import type { ConfigStore } from '../config/ConfigStore';

/**
 * Thresholds for quality rating boundaries.
 * These are internal defaults; they could be moved to ConfigStore if needed.
 */
const QUALITY_THRESHOLDS = {
  /** Minimum valid frame % to be rated "good" */
  goodMinValidFramePct: 90,
  /** Minimum valid frame % to be rated "acceptable" */
  acceptableMinValidFramePct: 70,
  /** Minimum average pose confidence for "good" */
  goodMinPoseConfidence: 0.7,
  /** Minimum average pose confidence for "acceptable" */
  acceptableMinPoseConfidence: 0.5,
  /** Minimum average hand confidence for "good" */
  goodMinHandConfidence: 0.6,
  /** Minimum average hand confidence for "acceptable" */
  acceptableMinHandConfidence: 0.4,
  /** Minimum camera stability for "good" */
  goodMinCameraStability: 0.9,
  /** Minimum camera stability for "acceptable" */
  acceptableMinCameraStability: 0.7,
  /** Minimum subject visibility rate for "good" */
  goodMinSubjectVisibility: 0.95,
  /** Minimum subject visibility rate for "acceptable" */
  acceptableMinSubjectVisibility: 0.8,
  /** Minimum lighting adequacy rate for "good" */
  goodMinLightingAdequacy: 0.9,
  /** Minimum lighting adequacy rate for "acceptable" */
  acceptableMinLightingAdequacy: 0.7,
};

/**
 * Evaluates quality metrics from drift frames and baseline data.
 */
export function computeQualityMetrics(
  driftFrames: DriftFrame[],
  _baseline: Baseline
): QualityMetrics {
  if (driftFrames.length === 0) {
    return {
      validFramePercentage: 0,
      avgPoseConfidence: 0,
      avgLeftHandConfidence: 0,
      avgRightHandConfidence: 0,
      cameraStability: 0,
      subjectVisibilityRate: 0,
      lightingAdequacyRate: 0,
      excessiveTorsoMovement: false,
      handsRemainedVisible: true,
      startingPoseValid: true,
      fullDurationCompleted: false,
    };
  }

  const totalFrames = driftFrames.length;
  const validFrames = driftFrames.filter((f) => f.frameValid);
  const validFramePercentage = (validFrames.length / totalFrames) * 100;

  // Average pose confidence (using the average of left and right confidence per frame)
  const avgPoseConfidence =
    driftFrames.reduce((sum, f) => sum + (f.leftConfidence + f.rightConfidence) / 2, 0) /
    totalFrames;

  // Average hand confidence (using left/right confidence as proxy when hand data available)
  const avgLeftHandConfidence =
    driftFrames.reduce((sum, f) => sum + f.leftConfidence, 0) / totalFrames;
  const avgRightHandConfidence =
    driftFrames.reduce((sum, f) => sum + f.rightConfidence, 0) / totalFrames;

  // Camera stability: 1.0 - mean camera movement (clamped to [0, 1])
  const avgCameraMovement =
    driftFrames.reduce((sum, f) => sum + f.cameraMovement, 0) / totalFrames;
  const cameraStability = Math.max(0, Math.min(1, 1 - avgCameraMovement * 10));

  // Subject visibility: fraction of frames where at least one arm has good confidence
  const visibleFrames = driftFrames.filter(
    (f) => f.leftConfidence > 0.3 || f.rightConfidence > 0.3
  );
  const subjectVisibilityRate = visibleFrames.length / totalFrames;

  // Lighting: estimate from confidence and frame validity
  // Frames with very low confidence likely indicate poor lighting
  const adequateLightingFrames = driftFrames.filter(
    (f) => (f.leftConfidence + f.rightConfidence) / 2 > 0.3
  );
  const lightingAdequacyRate = adequateLightingFrames.length / totalFrames;

  // Excessive torso movement: check if max torso compensation exceeds threshold
  const maxTorsoComp = Math.max(...driftFrames.map((f) => Math.abs(f.torsoCompensation)));
  const excessiveTorsoMovement = maxTorsoComp > 0.1;

  // Hands remained visible: check if there are extended periods of low hand confidence
  const lowHandFrames = driftFrames.filter(
    (f) => f.leftConfidence < 0.3 && f.rightConfidence < 0.3
  );
  const handsRemainedVisible = lowHandFrames.length / totalFrames < 0.2;

  // Starting pose validity: first few frames should be valid
  const firstFrames = driftFrames.slice(0, Math.min(5, driftFrames.length));
  const startingPoseValid = firstFrames.every((f) => f.frameValid);

  // Full duration: check if we have enough frames for a 30s assessment at minimum frame rate
  const fullDurationCompleted = totalFrames >= 10; // Simplified: at least 10 frames

  return {
    validFramePercentage,
    avgPoseConfidence,
    avgLeftHandConfidence,
    avgRightHandConfidence,
    cameraStability,
    subjectVisibilityRate,
    lightingAdequacyRate,
    excessiveTorsoMovement,
    handsRemainedVisible,
    startingPoseValid,
    fullDurationCompleted,
  };
}

/**
 * Evaluates a quality assessment from drift frames, baseline, and config.
 *
 * Produces exactly one rating from: good, acceptable, low, unable_to_assess.
 * Reports the primary failure reason when quality is low or unable_to_assess.
 * Flags "unable to assess" when excluded frame % exceeds threshold.
 */
export function evaluateQuality(
  driftFrames: DriftFrame[],
  baseline: Baseline,
  config: ConfigStore
): QualityAssessment {
  const metrics = computeQualityMetrics(driftFrames, baseline);
  const reasons: string[] = [];

  const minValidFramePct = config.get('minValidFramePercentage');

  // Check for "unable to assess" conditions first
  // If excluded frame % exceeds threshold (i.e., valid frame % below minValidFramePercentage)
  if (metrics.validFramePercentage < minValidFramePct) {
    reasons.push('Insufficient valid frames for reliable assessment');
  }

  if (!metrics.fullDurationCompleted) {
    reasons.push('Assessment did not complete full duration');
  }

  if (metrics.subjectVisibilityRate < QUALITY_THRESHOLDS.acceptableMinSubjectVisibility) {
    reasons.push('Subject was not consistently visible');
  }

  if (metrics.cameraStability < QUALITY_THRESHOLDS.acceptableMinCameraStability) {
    reasons.push('Excessive camera movement detected');
  }

  if (metrics.excessiveTorsoMovement) {
    reasons.push('Excessive torso movement during assessment');
  }

  if (!metrics.handsRemainedVisible) {
    reasons.push('Hands were not consistently visible');
  }

  if (metrics.avgPoseConfidence < QUALITY_THRESHOLDS.acceptableMinPoseConfidence) {
    reasons.push('Low pose tracking confidence');
  }

  if (metrics.lightingAdequacyRate < QUALITY_THRESHOLDS.acceptableMinLightingAdequacy) {
    reasons.push('Inadequate lighting conditions');
  }

  if (!metrics.startingPoseValid) {
    reasons.push('Starting pose was not valid');
  }

  // Determine the overall rating
  const rating = determineRating(metrics, minValidFramePct, reasons);

  return {
    overall: rating,
    metrics,
    primaryFailureReason: rating === 'good' || rating === 'acceptable' ? null : reasons[0] || null,
    reasons,
  };
}

/**
 * Determines the quality rating based on metrics and failure reasons.
 *
 * Key rules:
 * - Valid frame % below config threshold cannot produce "good"
 * - Excessive frame exclusion forces "unable_to_assess"
 * - Exactly one rating is produced
 */
function determineRating(
  metrics: QualityMetrics,
  minValidFramePct: number,
  reasons: string[]
): QualityRating {
  // "unable_to_assess" when excluded frame % exceeds threshold
  // (i.e., valid frame % is below the configured minimum)
  if (metrics.validFramePercentage < minValidFramePct) {
    return 'unable_to_assess';
  }

  // "unable_to_assess" for severe issues
  if (!metrics.fullDurationCompleted) {
    return 'unable_to_assess';
  }

  if (
    metrics.subjectVisibilityRate < QUALITY_THRESHOLDS.acceptableMinSubjectVisibility &&
    metrics.avgPoseConfidence < QUALITY_THRESHOLDS.acceptableMinPoseConfidence
  ) {
    return 'unable_to_assess';
  }

  // "low" when there are multiple moderate issues
  if (reasons.length >= 3) {
    return 'low';
  }

  // "low" if camera stability or subject visibility is below acceptable but not catastrophic
  if (
    metrics.cameraStability < QUALITY_THRESHOLDS.acceptableMinCameraStability ||
    metrics.excessiveTorsoMovement
  ) {
    return 'low';
  }

  if (!metrics.handsRemainedVisible || !metrics.startingPoseValid) {
    return 'low';
  }

  // Cannot be "good" if valid frame % is below the "good" threshold
  if (metrics.validFramePercentage < QUALITY_THRESHOLDS.goodMinValidFramePct) {
    return 'acceptable';
  }

  // Check "good" rating conditions
  if (
    metrics.avgPoseConfidence >= QUALITY_THRESHOLDS.goodMinPoseConfidence &&
    metrics.cameraStability >= QUALITY_THRESHOLDS.goodMinCameraStability &&
    metrics.subjectVisibilityRate >= QUALITY_THRESHOLDS.goodMinSubjectVisibility &&
    metrics.lightingAdequacyRate >= QUALITY_THRESHOLDS.goodMinLightingAdequacy &&
    reasons.length === 0
  ) {
    return 'good';
  }

  // Default to "acceptable" when conditions are moderate
  return 'acceptable';
}

/**
 * QualityAssessor class implementing the QualityAssessor interface.
 */
export class QualityAssessorImpl {
  evaluate(
    driftFrames: DriftFrame[],
    baseline: Baseline,
    config: ConfigStore
  ): QualityAssessment {
    return evaluateQuality(driftFrames, baseline, config);
  }
}
