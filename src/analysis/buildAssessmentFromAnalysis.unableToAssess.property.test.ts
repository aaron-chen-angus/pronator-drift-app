// Feature: pronator-drift-analysis, Property 23: Insufficient valid frames force unable_to_assess

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
 * **Validates: Requirements 1.5, 15.4**
 *
 * Property 23: Insufficient valid frames force unable_to_assess
 *
 * `buildAssessmentFromAnalysis` forces `overallClassification === 'unable_to_assess'`
 * when EITHER `result.noValidAssessedArmFrames` is true (Req 1.5) OR
 * `result.quality.metrics.validFramePercentage < config.get('minValidFramePercentage')`
 * (Req 15.4).
 *
 * Conversely, when `noValidAssessedArmFrames` is false AND `validFramePercentage >=
 * minValidFramePercentage` AND the quality rating is good/acceptable, the classification
 * is NOT forced to `unable_to_assess` by these rules — it takes the normal `classify()`
 * result (which, for good/acceptable quality, is not `unable_to_assess`).
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

/** A quality assessment with a controllable valid-frame percentage and rating. */
function makeQuality(
  validFramePercentage: number,
  overall: QualityAssessment['overall']
): QualityAssessment {
  return {
    overall,
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

function makeResult(params: {
  assessedArm: 'left' | 'right';
  validFramePercentage: number;
  qualityOverall: QualityAssessment['overall'];
  noValidAssessedArmFrames: boolean;
}): AssessmentAnalysisResult {
  const { assessedArm, validFramePercentage, qualityOverall, noValidAssessedArmFrames } =
    params;
  return {
    baseline: makeBaseline(),
    assessedArm,
    driftFrames: [],
    maxDrift: { left: 0.1, right: 0.1 },
    driftOnset: { left: null, right: null },
    indicators: makeIndicators(assessedArm),
    quality: makeQuality(validFramePercentage, qualityOverall),
    deliveredFrameCount: 120,
    droppedFrameCount: 5,
    effectiveFrameRate: 25,
    recording: {
      status: 'skipped',
      blob: null,
      objectUrl: null,
      mimeType: null,
    },
    startedAtMs: 1_000_000,
    durationSeconds: 30,
    noValidAssessedArmFrames,
  };
}

describe('Property 23: Insufficient valid frames force unable_to_assess', () => {
  it('forces unable_to_assess when noValidAssessedArmFrames OR validFramePercentage < min', () => {
    const config = new ConfigStore();
    const min = config.get('minValidFramePercentage');

    fc.assert(
      fc.property(
        fc.constantFrom<'left' | 'right'>('left', 'right'),
        fc.boolean(), // noValidAssessedArmFrames
        finite(0, 100), // validFramePercentage
        fc.constantFrom<QualityAssessment['overall']>('good', 'acceptable', 'low'),
        (assessedArm, noValidAssessedArmFrames, validFramePercentage, qualityOverall) => {
          const result = makeResult({
            assessedArm,
            validFramePercentage,
            qualityOverall,
            noValidAssessedArmFrames,
          });

          const assessment = buildAssessmentFromAnalysis(result, config);

          if (noValidAssessedArmFrames || validFramePercentage < min) {
            // Req 1.5 / Req 15.4: these conditions force unable_to_assess.
            expect(assessment.overallClassification).toBe('unable_to_assess');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('does NOT force unable_to_assess when frames are sufficient and quality is good/acceptable', () => {
    const config = new ConfigStore();
    const min = config.get('minValidFramePercentage');

    fc.assert(
      fc.property(
        fc.constantFrom<'left' | 'right'>('left', 'right'),
        finite(min, 100), // validFramePercentage >= min
        fc.constantFrom<'good' | 'acceptable'>('good', 'acceptable'),
        (assessedArm, validFramePercentage, qualityOverall) => {
          const result = makeResult({
            assessedArm,
            validFramePercentage,
            qualityOverall,
            noValidAssessedArmFrames: false,
          });

          const assessment = buildAssessmentFromAnalysis(result, config);

          // With sufficient valid frames, false noValidAssessedArmFrames, and
          // good/acceptable quality, the two forcing rules do not apply, so the
          // classification takes the normal classify() result (not unable_to_assess).
          expect(assessment.overallClassification).not.toBe('unable_to_assess');
        }
      ),
      { numRuns: 100 }
    );
  });
});
