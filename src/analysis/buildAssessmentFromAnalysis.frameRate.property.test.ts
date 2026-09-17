// Feature: pronator-drift-analysis, Property 22: Valid-frame percentage and effective frame rate match their definitions

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  buildAssessmentFromAnalysis,
  type AssessmentAnalysisResult,
} from './buildAssessmentFromAnalysis';
import { ConfigStore } from '../config/ConfigStore';
import type {
  ArmBaseline,
  Baseline,
  IndicatorKey,
  IndicatorSample,
  MicroMovementIndicators,
  QualityAssessment,
  SummaryStatistic,
  TimeSeriesIndicator,
} from '../types';

/**
 * **Validates: Requirements 15.3, 17.3**
 *
 * Property 22: Valid-frame percentage and effective frame rate match their definitions
 *
 * In the assessment produced by `buildAssessmentFromAnalysis`:
 *   - `analysisMeta.effectiveFrameRate` equals `result.effectiveFrameRate` (Req 17.3)
 *   - `analysisMeta.frameRateBelowMinimum` equals
 *     `result.effectiveFrameRate < config.get('minAnalysisFrameRate')` (Req 17.3)
 *   - the quality's `validFramePercentage` is carried through unchanged, i.e.
 *     `assessment.quality.metrics.validFramePercentage ===
 *      result.quality.metrics.validFramePercentage` (Req 15.3)
 */

// ─── Generators / builders ──────────────────────────────────────────────────

const finite = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

function makeSummary(): SummaryStatistic {
  return { mean: 0, max: 0, standardDeviation: 0, validFrameCount: 1 };
}

function makeSeries(
  key: IndicatorKey,
  measurable: boolean,
  poseOnly: boolean,
  unit: string
): TimeSeriesIndicator {
  const samples: IndicatorSample[] = [{ timestamp: 0, value: 0 }];
  return { key, measurable, poseOnly, samples, summary: makeSummary(), unit };
}

function makeArmBaseline(wristHeight: number): ArmBaseline {
  return {
    shoulderPos: { x: 0, y: 0, z: 0 },
    elbowPos: { x: 0, y: 0, z: 0 },
    wristPos: { x: 0, y: 0, z: 0 },
    normalizedWristHeight: wristHeight,
    elbowExtensionAngle: 175,
    palmOrientationAngle: 0,
    armLength: 0.3,
  };
}

function makeBaseline(): Baseline {
  return {
    leftArm: makeArmBaseline(0.4),
    rightArm: makeArmBaseline(0.4),
    torsoAngle: 0,
    shoulderWidth: 0.2,
    captureFrameCount: 30,
    captureStartTime: 0,
    captureEndTime: 1000,
  };
}

/** A quality assessment with a controllable valid-frame percentage. */
function makeQuality(validFramePercentage: number): QualityAssessment {
  return {
    overall: 'good',
    metrics: {
      validFramePercentage,
      avgPoseConfidence: 0.9,
      avgLeftHandConfidence: 0.9,
      avgRightHandConfidence: 0.9,
      cameraStability: 0.95,
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

function makeIndicators(assessedArm: 'left' | 'right'): MicroMovementIndicators {
  return {
    assessedArm,
    wristDrift: makeSeries('wristDrift', true, true, 'normalized'),
    elbowDrift: makeSeries('elbowDrift', true, true, 'normalized'),
    elbowFlexionChange: makeSeries('elbowFlexionChange', true, true, 'degrees'),
    armToTorsoChange: makeSeries('armToTorsoChange', true, true, 'degrees'),
    palmRotationChange: makeSeries('palmRotationChange', true, false, 'degrees'),
    wristTremorAmplitude: makeSeries('wristTremorAmplitude', true, true, 'normalized'),
    fingertipTremorAmplitude: makeSeries('fingertipTremorAmplitude', true, false, 'normalized'),
    wristTremorDominantFrequency: makeSeries('wristTremorDominantFrequency', true, true, 'hertz'),
    stability: makeSeries('stability', true, true, 'normalized'),
    fingerCurlChange: makeSeries('fingerCurlChange', true, false, 'normalized'),
    fingerSpreadChange: makeSeries('fingerSpreadChange', true, false, 'normalized'),

    maxElbowFlexionChangeDegrees: 0,
    maxArmToTorsoChangeDegrees: 0,
    totalPalmRotationChangeDegrees: 0,
    possiblePronation: false,
    supinationToPronationTrend: false,
    sustainedDrift: false,
    sustainedDriftDurationMs: 0,
    dominantFrequencyBandwidthLimited: false,
    usedPoseOnlyPath: false,
  };
}

describe('Property 22: Valid-frame percentage and effective frame rate match their definitions', () => {
  it('carries through effectiveFrameRate, frameRateBelowMinimum, and validFramePercentage per their definitions', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'left' | 'right'>('left', 'right'),
        // effectiveFrameRate varied across 0..60 to exercise both sides of the
        // configured minimum (default 10).
        finite(0, 60),
        // validFramePercentage across the full 0..100 range.
        finite(0, 100),
        (assessedArm, effectiveFrameRate, validFramePercentage) => {
          const config = new ConfigStore();

          const result: AssessmentAnalysisResult = {
            baseline: makeBaseline(),
            assessedArm,
            driftFrames: [],
            maxDrift: { left: 0, right: 0 },
            driftOnset: { left: null, right: null },
            indicators: makeIndicators(assessedArm),
            quality: makeQuality(validFramePercentage),
            deliveredFrameCount: 120,
            droppedFrameCount: 5,
            effectiveFrameRate,
            recording: {
              status: 'skipped',
              blob: null,
              objectUrl: null,
              mimeType: null,
            },
            startedAtMs: 1_000_000,
            durationSeconds: 30,
            noValidAssessedArmFrames: false,
          };

          const assessment = buildAssessmentFromAnalysis(result, config);

          // Req 17.3: effective frame rate carried through unchanged.
          expect(assessment.analysisMeta!.effectiveFrameRate).toBe(
            result.effectiveFrameRate
          );

          // Req 17.3: frameRateBelowMinimum matches its definition.
          expect(assessment.analysisMeta!.frameRateBelowMinimum).toBe(
            result.effectiveFrameRate < config.get('minAnalysisFrameRate')
          );

          // Req 15.3: valid-frame percentage carried through unchanged.
          expect(assessment.quality.metrics.validFramePercentage).toBe(
            result.quality.metrics.validFramePercentage
          );
        }
      ),
      { numRuns: 200 }
    );
  });
});
