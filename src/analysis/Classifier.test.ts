/**
 * Unit tests for the Classifier module.
 *
 * Tests each of the 7 classification categories using synthetic ClassificationInput data,
 * and tests camera movement detection via QualityAssessor with synthetic DriftFrames.
 *
 * Validates: Requirements 25.1, 25.3
 */

import { describe, it, expect } from 'vitest';
import { classify, type ClassificationInput } from './Classifier';
import { evaluateQuality } from './QualityAssessor';
import { ConfigStore } from '../config/ConfigStore';
import type {
  ArmAssessment,
  QualityAssessment,
  QualityMetrics,
  DriftFrame,
  Baseline,
  ArmBaseline,
} from '../types';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Creates a default ArmAssessment with no drift and no pronation. */
function makeArmAssessment(overrides: Partial<ArmAssessment> = {}): ArmAssessment {
  return {
    baselineWristHeight: 0.5,
    maximumDownwardDriftNormalised: 0.0,
    driftDurationMilliseconds: 0,
    driftOnsetSeconds: null,
    maximumElbowFlexionChangeDegrees: 0,
    estimatedPalmRotationChangeDegrees: null,
    possiblePronation: false,
    sustainedDownwardDrift: false,
    confidence: 0.9,
    ...overrides,
  };
}

/** Creates a QualityAssessment with the given rating. */
function makeQualityAssessment(
  overall: 'good' | 'acceptable' | 'low' | 'unable_to_assess' = 'good'
): QualityAssessment {
  return {
    overall,
    metrics: {
      validFramePercentage: overall === 'good' ? 95 : overall === 'acceptable' ? 80 : 50,
      avgPoseConfidence: 0.8,
      avgLeftHandConfidence: 0.7,
      avgRightHandConfidence: 0.7,
      cameraStability: 0.95,
      subjectVisibilityRate: 0.98,
      lightingAdequacyRate: 0.95,
      excessiveTorsoMovement: false,
      handsRemainedVisible: true,
      startingPoseValid: true,
      fullDurationCompleted: true,
    },
    primaryFailureReason: overall === 'good' || overall === 'acceptable' ? null : 'Test reason',
    reasons: overall === 'good' || overall === 'acceptable' ? [] : ['Test reason'],
  };
}

/** Creates a ClassificationInput from the given overrides. */
function makeInput(overrides: {
  leftArm?: Partial<ArmAssessment>;
  rightArm?: Partial<ArmAssessment>;
  quality?: 'good' | 'acceptable' | 'low' | 'unable_to_assess';
} = {}): ClassificationInput {
  return {
    leftArm: makeArmAssessment(overrides.leftArm),
    rightArm: makeArmAssessment(overrides.rightArm),
    quality: makeQualityAssessment(overrides.quality ?? 'good'),
  };
}

/** Creates a synthetic DriftFrame. */
function makeDriftFrame(overrides: Partial<DriftFrame> = {}): DriftFrame {
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

/** Creates a synthetic Baseline. */
function makeBaseline(): Baseline {
  const armBaseline: ArmBaseline = {
    shoulderPos: { x: 0.3, y: 0.3, z: 0 },
    elbowPos: { x: 0.35, y: 0.35, z: 0 },
    wristPos: { x: 0.4, y: 0.4, z: 0 },
    normalizedWristHeight: 0.0,
    elbowExtensionAngle: 170,
    palmOrientationAngle: 10,
    armLength: 0.2,
  };
  return {
    leftArm: { ...armBaseline },
    rightArm: { ...armBaseline, shoulderPos: { x: 0.7, y: 0.3, z: 0 } },
    torsoAngle: 0,
    shoulderWidth: 0.4,
    captureFrameCount: 30,
    captureStartTime: 0,
    captureEndTime: 2500,
  };
}

// ─── Classification Category Tests ──────────────────────────────────────────

describe('Classifier', () => {
  const config = new ConfigStore();

  describe('Classification Categories', () => {
    it('classifies as "no_significant_drift" when neither drift nor pronation is detected', () => {
      const input = makeInput();
      const result = classify(input, config);
      expect(result).toBe('no_significant_drift');
    });

    it('classifies as "possible_left_pronator_drift" when left arm has sustained drift AND pronation', () => {
      const input = makeInput({
        leftArm: {
          sustainedDownwardDrift: true,
          possiblePronation: true,
          maximumDownwardDriftNormalised: 0.08,
          driftDurationMilliseconds: 5000,
          estimatedPalmRotationChangeDegrees: 25,
        },
      });
      const result = classify(input, config);
      expect(result).toBe('possible_left_pronator_drift');
    });

    it('classifies as "possible_right_pronator_drift" when right arm has sustained drift AND pronation', () => {
      const input = makeInput({
        rightArm: {
          sustainedDownwardDrift: true,
          possiblePronation: true,
          maximumDownwardDriftNormalised: 0.07,
          driftDurationMilliseconds: 4000,
          estimatedPalmRotationChangeDegrees: 20,
        },
      });
      const result = classify(input, config);
      expect(result).toBe('possible_right_pronator_drift');
    });

    it('classifies as "possible_bilateral_drift" when both arms have sustained drift', () => {
      const input = makeInput({
        leftArm: {
          sustainedDownwardDrift: true,
          possiblePronation: false,
          maximumDownwardDriftNormalised: 0.05,
          driftDurationMilliseconds: 3000,
        },
        rightArm: {
          sustainedDownwardDrift: true,
          possiblePronation: false,
          maximumDownwardDriftNormalised: 0.06,
          driftDurationMilliseconds: 4000,
        },
      });
      const result = classify(input, config);
      expect(result).toBe('possible_bilateral_drift');
    });

    it('classifies as "drift_without_clear_pronation" when drift is detected without pronation', () => {
      const input = makeInput({
        leftArm: {
          sustainedDownwardDrift: true,
          possiblePronation: false,
          maximumDownwardDriftNormalised: 0.06,
          driftDurationMilliseconds: 3500,
        },
      });
      const result = classify(input, config);
      expect(result).toBe('drift_without_clear_pronation');
    });

    it('classifies as "possible_pronation_without_drift" when pronation is detected without drift', () => {
      const input = makeInput({
        rightArm: {
          sustainedDownwardDrift: false,
          possiblePronation: true,
          maximumDownwardDriftNormalised: 0.01,
          estimatedPalmRotationChangeDegrees: 30,
        },
      });
      const result = classify(input, config);
      expect(result).toBe('possible_pronation_without_drift');
    });

    it('classifies as "unable_to_assess" when quality is "low"', () => {
      const input = makeInput({
        leftArm: {
          sustainedDownwardDrift: true,
          possiblePronation: true,
          maximumDownwardDriftNormalised: 0.1,
        },
        quality: 'low',
      });
      const result = classify(input, config);
      expect(result).toBe('unable_to_assess');
    });

    it('classifies as "unable_to_assess" when quality is "unable_to_assess"', () => {
      const input = makeInput({
        rightArm: {
          sustainedDownwardDrift: true,
          possiblePronation: true,
        },
        quality: 'unable_to_assess',
      });
      const result = classify(input, config);
      expect(result).toBe('unable_to_assess');
    });
  });

  describe('Precedence', () => {
    it('quality override takes precedence over pronator drift detection', () => {
      const input = makeInput({
        leftArm: { sustainedDownwardDrift: true, possiblePronation: true },
        rightArm: { sustainedDownwardDrift: true, possiblePronation: true },
        quality: 'low',
      });
      const result = classify(input, config);
      expect(result).toBe('unable_to_assess');
    });

    it('left pronator drift takes precedence over bilateral drift when both applicable', () => {
      // Left arm has drift + pronation, right arm has drift only
      const input = makeInput({
        leftArm: { sustainedDownwardDrift: true, possiblePronation: true },
        rightArm: { sustainedDownwardDrift: true, possiblePronation: false },
      });
      const result = classify(input, config);
      expect(result).toBe('possible_left_pronator_drift');
    });

    it('bilateral drift takes precedence over drift without pronation', () => {
      const input = makeInput({
        leftArm: { sustainedDownwardDrift: true, possiblePronation: false },
        rightArm: { sustainedDownwardDrift: true, possiblePronation: false },
      });
      const result = classify(input, config);
      expect(result).toBe('possible_bilateral_drift');
    });
  });
});

// ─── Camera Movement Detection Tests ─────────────────────────────────────────

describe('QualityAssessor - Camera Movement Detection', () => {
  const config = new ConfigStore();

  it('detects high camera movement and reduces quality/camera stability metric', () => {
    // Create DriftFrames with high camera movement values
    const highMovementFrames: DriftFrame[] = Array.from({ length: 30 }, (_, i) =>
      makeDriftFrame({
        timestamp: i * 100,
        cameraMovement: 0.15, // Very high camera movement
        frameValid: false,    // Camera-affected frames are invalid
        leftConfidence: 0.9,
        rightConfidence: 0.9,
      })
    );

    const baseline = makeBaseline();
    const result = evaluateQuality(highMovementFrames, baseline, config);

    // Camera stability should be low when average camera movement is high
    expect(result.metrics.cameraStability).toBeLessThan(0.5);
    // Valid frame percentage should be 0% since all frames are invalid
    expect(result.metrics.validFramePercentage).toBe(0);
    // Overall rating should reflect poor quality
    expect(result.overall).toBe('unable_to_assess');
  });

  it('produces good quality when camera movement is negligible', () => {
    // Stable frames with no camera movement
    const stableFrames: DriftFrame[] = Array.from({ length: 30 }, (_, i) =>
      makeDriftFrame({
        timestamp: i * 100,
        cameraMovement: 0.001, // Negligible movement
        frameValid: true,
        leftConfidence: 0.9,
        rightConfidence: 0.9,
      })
    );

    const baseline = makeBaseline();
    const result = evaluateQuality(stableFrames, baseline, config);

    // Camera stability should be high
    expect(result.metrics.cameraStability).toBeGreaterThan(0.9);
    // Valid frame percentage should be 100%
    expect(result.metrics.validFramePercentage).toBe(100);
    // Rating should be good
    expect(result.overall).toBe('good');
  });

  it('flags camera instability as a quality failure reason', () => {
    // Mix of stable and camera-movement frames
    const mixedFrames: DriftFrame[] = Array.from({ length: 30 }, (_, i) =>
      makeDriftFrame({
        timestamp: i * 100,
        cameraMovement: i < 20 ? 0.1 : 0.001, // First 20 frames have high movement
        frameValid: i >= 20, // Only last 10 are valid
        leftConfidence: 0.9,
        rightConfidence: 0.9,
      })
    );

    const baseline = makeBaseline();
    const result = evaluateQuality(mixedFrames, baseline, config);

    // Should report camera instability since camera stability will be low
    expect(result.metrics.cameraStability).toBeLessThan(0.7);
    // Quality should be degraded since valid frames < 70%
    expect(result.overall).not.toBe('good');
  });
});
