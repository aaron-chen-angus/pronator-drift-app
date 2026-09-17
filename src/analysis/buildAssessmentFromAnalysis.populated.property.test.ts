// Feature: pronator-drift-analysis, Property 25: Populated (non-placeholder) assessment reflects captured drift

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
 * **Validates: Requirements 1.4**
 *
 * Property 25: Populated (non-placeholder) assessment reflects captured drift
 *
 * For any valid `AssessmentAnalysisResult` (with a high enough valid-frame
 * percentage and a good/acceptable quality rating so that classification is not
 * forced to `unable_to_assess`), `buildAssessmentFromAnalysis` produces a
 * `PronatorDriftAssessment` whose fields reflect the captured analysis rather than
 * placeholder zeros/nulls. Specifically, for the assessed arm:
 *   - maximumDownwardDriftNormalised === result.maxDrift[assessedArm]
 *   - driftOnsetSeconds === result.driftOnset[assessedArm]
 *   - maximumElbowFlexionChangeDegrees === indicators.maxElbowFlexionChangeDegrees
 *   - estimatedPalmRotationChangeDegrees === indicators.totalPalmRotationChangeDegrees
 *   - sustainedDownwardDrift === indicators.sustainedDrift
 *   - driftDurationMilliseconds === indicators.sustainedDriftDurationMs
 * and the assessment carries `indicators`, `normComparisons`, `assessedArm`, and
 * `analysisMeta`.
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
  overall: 'good' | 'acceptable'
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

interface IndicatorAggregates {
  maxElbowFlexionChangeDegrees: number;
  maxArmToTorsoChangeDegrees: number;
  totalPalmRotationChangeDegrees: number;
  possiblePronation: boolean;
  sustainedDrift: boolean;
  sustainedDriftDurationMs: number;
}

function makeIndicators(
  assessedArm: 'left' | 'right',
  agg: IndicatorAggregates
): MicroMovementIndicators {
  return {
    assessedArm,
    // wristDrift must be measurable=true so the assessed-arm confidence is non-zero
    // and the pose-based path is exercised.
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

    maxElbowFlexionChangeDegrees: agg.maxElbowFlexionChangeDegrees,
    maxArmToTorsoChangeDegrees: agg.maxArmToTorsoChangeDegrees,
    totalPalmRotationChangeDegrees: agg.totalPalmRotationChangeDegrees,
    possiblePronation: agg.possiblePronation,
    supinationToPronationTrend: false,
    sustainedDrift: agg.sustainedDrift,
    sustainedDriftDurationMs: agg.sustainedDriftDurationMs,
    dominantFrequencyBandwidthLimited: false,
    usedPoseOnlyPath: false,
  };
}

describe('Property 25: Populated (non-placeholder) assessment reflects captured drift', () => {
  it('reflects the captured drift/indicator aggregates for the assessed arm and carries extended fields', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'left' | 'right'>('left', 'right'),
        // maxDrift for both arms.
        finite(0, 1),
        finite(0, 1),
        // driftOnset for both arms (nullable).
        fc.option(finite(0, 30), { nil: null }),
        fc.option(finite(0, 30), { nil: null }),
        // Indicator aggregates.
        finite(0, 90), // maxElbowFlexionChangeDegrees
        finite(0, 90), // maxArmToTorsoChangeDegrees
        finite(-90, 90), // totalPalmRotationChangeDegrees
        fc.boolean(), // possiblePronation
        fc.boolean(), // sustainedDrift
        finite(0, 30000), // sustainedDriftDurationMs
        // Valid-frame percentage kept >= 95 so classify is not forced to unable_to_assess.
        finite(95, 100),
        fc.constantFrom<'good' | 'acceptable'>('good', 'acceptable'),
        (
          assessedArm,
          maxDriftLeft,
          maxDriftRight,
          driftOnsetLeft,
          driftOnsetRight,
          maxElbowFlexionChangeDegrees,
          maxArmToTorsoChangeDegrees,
          totalPalmRotationChangeDegrees,
          possiblePronation,
          sustainedDrift,
          sustainedDriftDurationMs,
          validFramePercentage,
          qualityOverall
        ) => {
          const config = new ConfigStore();

          const maxDrift = { left: maxDriftLeft, right: maxDriftRight };
          const driftOnset = { left: driftOnsetLeft, right: driftOnsetRight };
          const indicators = makeIndicators(assessedArm, {
            maxElbowFlexionChangeDegrees,
            maxArmToTorsoChangeDegrees,
            totalPalmRotationChangeDegrees,
            possiblePronation,
            sustainedDrift,
            sustainedDriftDurationMs,
          });

          const result: AssessmentAnalysisResult = {
            baseline: makeBaseline(),
            assessedArm,
            driftFrames: [],
            maxDrift,
            driftOnset,
            indicators,
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
            noValidAssessedArmFrames: false,
          };

          const assessment = buildAssessmentFromAnalysis(result, config);

          const assessedArmResult =
            assessedArm === 'left' ? assessment.leftArm : assessment.rightArm;

          // Assessed-arm fields reflect the captured analysis (not placeholder zeros).
          expect(assessedArmResult.maximumDownwardDriftNormalised).toBe(
            maxDrift[assessedArm]
          );
          expect(assessedArmResult.driftOnsetSeconds).toBe(driftOnset[assessedArm]);
          expect(assessedArmResult.maximumElbowFlexionChangeDegrees).toBe(
            maxElbowFlexionChangeDegrees
          );
          expect(assessedArmResult.estimatedPalmRotationChangeDegrees).toBe(
            totalPalmRotationChangeDegrees
          );
          expect(assessedArmResult.sustainedDownwardDrift).toBe(sustainedDrift);
          expect(assessedArmResult.driftDurationMilliseconds).toBe(
            sustainedDriftDurationMs
          );

          // Extended fields are carried through.
          expect(assessment.indicators).toBe(indicators);
          expect(assessment.assessedArm).toBe(assessedArm);
          expect(Array.isArray(assessment.normComparisons)).toBe(true);
          expect(assessment.normComparisons!.length).toBeGreaterThan(0);
          expect(assessment.analysisMeta).toBeDefined();
          expect(assessment.analysisMeta!.deliveredFrameCount).toBe(120);
          expect(assessment.analysisMeta!.droppedFrameCount).toBe(5);
          expect(assessment.analysisMeta!.effectiveFrameRate).toBe(25);
          expect(assessment.analysisMeta!.recordingStatus).toBe('skipped');

          // The result is populated, not the placeholder "unable_to_assess".
          expect(assessment.overallClassification).not.toBe('unable_to_assess');
        }
      ),
      { numRuns: 200 }
    );
  });
});
