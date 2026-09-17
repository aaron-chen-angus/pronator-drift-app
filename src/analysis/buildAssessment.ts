/**
 * buildAssessment — constructs a valid PronatorDriftAssessment object.
 *
 * NOTE: This is a prototype result builder. It produces a well-formed,
 * "no significant drift" assessment so the workflow completes end-to-end and
 * the results screen renders. Real per-frame drift analysis (DriftAnalyzer)
 * should populate these fields once the assessment recording loop is wired in.
 */

import type {
  PronatorDriftAssessment,
  ArmAssessment,
  QualityAssessment,
} from '../types/index';

function detectDeviceType(): 'mobile' | 'tablet' | 'desktop' {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet/.test(ua)) return 'tablet';
  if (/mobile|iphone|android/.test(ua)) return 'mobile';
  return 'desktop';
}

function emptyArm(): ArmAssessment {
  return {
    baselineWristHeight: 0,
    maximumDownwardDriftNormalised: 0,
    driftDurationMilliseconds: 0,
    driftOnsetSeconds: null,
    maximumElbowFlexionChangeDegrees: 0,
    estimatedPalmRotationChangeDegrees: null,
    possiblePronation: false,
    sustainedDownwardDrift: false,
    confidence: 0.5,
  };
}

function neutralQuality(): QualityAssessment {
  return {
    overall: 'acceptable',
    metrics: {
      validFramePercentage: 100,
      avgPoseConfidence: 0.7,
      avgLeftHandConfidence: 0,
      avgRightHandConfidence: 0,
      cameraStability: 1,
      subjectVisibilityRate: 1,
      lightingAdequacyRate: 1,
      excessiveTorsoMovement: false,
      handsRemainedVisible: true,
      startingPoseValid: true,
      fullDurationCompleted: true,
    },
    primaryFailureReason: null,
    reasons: [],
  };
}

export function buildAssessment(startedAt: number, durationSeconds = 30): PronatorDriftAssessment {
  const now = Date.now();
  return {
    assessmentId:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `assessment-${now}`,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(now).toISOString(),
    durationSeconds,
    deviceType: detectDeviceType(),
    orientation: 'portrait',
    modelVersions: {
      poseModel: 'pose_landmarker_lite/float16/1',
      handModel: 'hand_landmarker/float16/1',
      classifier: 'prototype',
    },
    quality: neutralQuality(),
    leftArm: emptyArm(),
    rightArm: emptyArm(),
    overallClassification: 'no_significant_drift',
  };
}
