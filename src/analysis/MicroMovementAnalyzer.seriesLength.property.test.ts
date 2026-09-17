// Feature: pronator-drift-analysis, Property 3: Valid-frame series length
//
// **Validates: Requirements 3.6, 4.5**
//
// Property 3: Valid-frame series length
//
// For any sequence of assessment frames delivered to the pipeline, the drift time
// series length SHALL equal the number of delivered frames, and each per-indicator
// series length SHALL equal the number of frames possessing that indicator's
// required landmarks.
//
// This property is validated in two parts:
//
// (a) DriftAnalyzer.getDriftTimeSeries():
//     DriftAnalyzerImpl records exactly one DriftFrame per addAssessmentFrame call
//     (including invalid / missing-pose frames — those become invalid DriftFrames).
//     Therefore getDriftTimeSeries().length === number of delivered assessment
//     frames (Req 3.6).
//
// (b) MicroMovementAnalyzer per-indicator series length:
//     Each per-frame position/rotation series is built behind the analyzer's
//     confidence gate `isConfidentFrame` = (hasPose && poseConfidence >=
//     minPoseConfidence). Because `hasPose` requires the assessed-arm shoulder +
//     elbow + wrist, a confident frame always has those three landmarks. Thus:
//       - elbowFlexionChange.samples.length === number of confident frames
//         (shoulder+elbow+wrist are exactly the confident-frame requirement),
//       - armToTorsoChange.samples.length === number of confident frames that
//         additionally have the hip landmark,
//       - palmRotationChange.samples.length === number of confident frames that
//         additionally have assessed-arm hand landmarks.
//     We construct a mixed window (frames with/without pose, low/high visibility,
//     with/without hip, with/without a matching hand) and assert each indicator's
//     samples.length equals the independently-counted expected number (Req 4.5).

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ConfigStore } from '../config/ConfigStore';
import { MicroMovementAnalyzer } from './MicroMovementAnalyzer';
import { DriftAnalyzerImpl } from './DriftAnalyzer';
import type {
  ArmBaseline,
  Baseline,
  CVFrameResult,
  Handedness,
  NormalizedLandmark,
} from '../types';

// ─── MediaPipe Pose Landmark Indices (matching MicroMovementAnalyzer) ─────────

const POSE_INDICES = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24 },
} as const;

const HAND_LANDMARK_COUNT = 21;

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Create a normalized landmark with given position and visibility. */
function makeLandmark(
  x: number,
  y: number,
  z: number = 0,
  visibility: number = 0.9
): NormalizedLandmark {
  return { x, y, z, visibility };
}

/** Build a minimal ArmBaseline for constructing a valid Baseline. */
function makeArmBaseline(): ArmBaseline {
  return {
    shoulderPos: { x: 0.6, y: 0.4, z: 0 },
    elbowPos: { x: 0.7, y: 0.4, z: 0 },
    wristPos: { x: 0.8, y: 0.4, z: 0 },
    normalizedWristHeight: 0.5,
    elbowExtensionAngle: 180,
    palmOrientationAngle: 0,
    armLength: 0.2,
  };
}

/** Build a minimal valid Baseline for start(). */
function makeBaseline(): Baseline {
  return {
    leftArm: makeArmBaseline(),
    rightArm: makeArmBaseline(),
    torsoAngle: 0,
    shoulderWidth: 0.2,
    captureFrameCount: 10,
    captureStartTime: 0,
    captureEndTime: 1000,
  };
}

/** Build 21 hand landmarks. */
function makeHandLandmarks(): NormalizedLandmark[] {
  return Array.from({ length: HAND_LANDMARK_COUNT }, (_, i) =>
    makeLandmark(0.5 + i * 0.001, 0.5 + i * 0.001, 0, 0.9)
  );
}

/**
 * Specification for a single generated frame in the mixed window.
 */
interface FrameSpec {
  /** Whether the frame includes the assessed-arm shoulder/elbow/wrist landmarks. */
  hasPose: boolean;
  /** Whether the frame includes the assessed-arm hip landmark (only used when hasPose). */
  hasHip: boolean;
  /** Whether the frame includes a hand matching the assessed-arm handedness. */
  hasHand: boolean;
  /** Landmark visibility for the assessed-arm shoulder/elbow/wrist. */
  visibility: number;
}

/**
 * Build a 33-landmark pose set for a frame. When `spec.hasPose` is false, the
 * assessed-arm shoulder/elbow/wrist are removed (holes) so the analyzer marks the
 * frame excluded (hasPose=false). When true, they are present at `spec.visibility`.
 * The hip is included only when `spec.hasHip`.
 */
function makePoseSet(assessedArm: 'left' | 'right', spec: FrameSpec): NormalizedLandmark[] {
  const idx = POSE_INDICES[assessedArm];
  // Neutral filler for all non-assessed landmarks at high visibility.
  const set: NormalizedLandmark[] = Array.from({ length: 33 }, () =>
    makeLandmark(0.5, 0.5, 0, 0.9)
  );

  if (spec.hasPose) {
    set[idx.shoulder] = makeLandmark(0.6, 0.4, 0, spec.visibility);
    set[idx.elbow] = makeLandmark(0.7, 0.45, 0, spec.visibility);
    set[idx.wrist] = makeLandmark(0.8, 0.5, 0, spec.visibility);
    if (spec.hasHip) {
      set[idx.hip] = makeLandmark(0.55, 0.7, 0, 0.9);
    } else {
      const withHoles = set.slice();
      delete (withHoles as (NormalizedLandmark | undefined)[])[idx.hip];
      return withHoles as NormalizedLandmark[];
    }
    return set;
  }

  // No assessed-arm pose: remove shoulder/elbow/wrist (and hip) so hasPose=false.
  const withHoles = set.slice();
  delete (withHoles as (NormalizedLandmark | undefined)[])[idx.shoulder];
  delete (withHoles as (NormalizedLandmark | undefined)[])[idx.elbow];
  delete (withHoles as (NormalizedLandmark | undefined)[])[idx.wrist];
  delete (withHoles as (NormalizedLandmark | undefined)[])[idx.hip];
  return withHoles as NormalizedLandmark[];
}

/** Build a CVFrameResult from a FrameSpec for the given assessed arm. */
function makeFrame(
  assessedArm: 'left' | 'right',
  timestamp: number,
  spec: FrameSpec
): CVFrameResult {
  const poseSet = makePoseSet(assessedArm, spec);

  let handLandmarks: NormalizedLandmark[][] | null = null;
  let handedness: Handedness[] | null = null;
  if (spec.hasHand) {
    const label = assessedArm === 'left' ? 'Left' : 'Right';
    handLandmarks = [makeHandLandmarks()];
    handedness = [{ label, score: 0.95 }];
  }

  return {
    timestamp,
    poseLandmarks: [poseSet],
    poseWorldLandmarks: null,
    handLandmarks,
    handedness,
    processingTimeMs: 16,
  };
}

/**
 * Build a CVFrameResult for the DriftAnalyzer part (a). DriftAnalyzer records one
 * DriftFrame per call regardless of validity, but distinguishes a missing-pose
 * frame by a null `poseLandmarks` (it does not tolerate a pose set with holes at
 * the arm indices). So for the delivered-frame-count property we represent a
 * frame lacking assessed-arm pose as `poseLandmarks: null` (an invalid DriftFrame)
 * and a frame with pose as a complete 33-landmark set. Both still count as one
 * delivered frame (Req 3.6).
 */
function makeDriftFrame(
  assessedArm: 'left' | 'right',
  timestamp: number,
  spec: FrameSpec
): CVFrameResult {
  let poseLandmarks: NormalizedLandmark[][] | null = null;
  if (spec.hasPose) {
    // A complete 33-landmark set with the assessed arm present.
    poseLandmarks = [makePoseSet(assessedArm, { ...spec, hasHip: true })];
  }
  return {
    timestamp,
    poseLandmarks,
    poseWorldLandmarks: null,
    handLandmarks: null,
    handedness: null,
    processingTimeMs: 16,
  };
}

/**
 * A frame is "confident" (contributes to the pose-based summarized series) exactly
 * when it has the assessed-arm pose landmarks AND the average shoulder/elbow/wrist
 * visibility meets minPoseConfidence — mirroring MicroMovementAnalyzer's
 * `isConfidentFrame` gate. Since all three are set to the same `visibility`, the
 * average equals `visibility`.
 */
function isConfident(spec: FrameSpec, minPoseConfidence: number): boolean {
  return spec.hasPose && spec.visibility >= minPoseConfidence;
}

// ─── Generators ──────────────────────────────────────────────────────────────

const frameSpecArb: fc.Arbitrary<FrameSpec> = fc.record({
  hasPose: fc.boolean(),
  hasHip: fc.boolean(),
  hasHand: fc.boolean(),
  // Straddle the default minPoseConfidence (0.5) so both confident and
  // low-confidence pose frames are generated.
  visibility: fc.double({ min: 0.1, max: 1.0, noNaN: true, noDefaultInfinity: true }),
});

const assessedArmArb: fc.Arbitrary<'left' | 'right'> = fc.constantFrom('left', 'right');

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 3: Valid-frame series length', () => {
  it('(a) DriftAnalyzer.getDriftTimeSeries().length equals the number of delivered assessment frames', () => {
    fc.assert(
      fc.property(
        assessedArmArb,
        fc.array(frameSpecArb, { minLength: 1, maxLength: 60 }),
        (assessedArm, specs) => {
          const config = new ConfigStore();
          const analyzer = new DriftAnalyzerImpl(config);
          analyzer.startAssessment(makeBaseline());

          specs.forEach((spec, i) => {
            // Delivers valid pose frames and invalid/missing-pose frames alike;
            // DriftAnalyzer records one DriftFrame per call regardless (Req 3.6).
            analyzer.addAssessmentFrame(makeDriftFrame(assessedArm, 1000 + i * 33, spec));
          });

          const series = analyzer.getDriftTimeSeries();
          expect(series.length).toBe(specs.length);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('(b) each per-indicator series length equals the number of frames possessing that indicator\'s required landmarks (and passing the confidence gate)', () => {
    fc.assert(
      fc.property(
        assessedArmArb,
        fc.array(frameSpecArb, { minLength: 1, maxLength: 60 }),
        (assessedArm, specs) => {
          const config = new ConfigStore();
          const minPoseConfidence = config.get('minPoseConfidence');
          const analyzer = new MicroMovementAnalyzer(config);
          analyzer.start(makeBaseline(), assessedArm);

          specs.forEach((spec, i) => {
            analyzer.addFrame(makeFrame(assessedArm, 1000 + i * 33, spec));
          });

          const indicators = analyzer.finalize();

          // Independently count expected series lengths from the specs.
          // A confident frame has shoulder+elbow+wrist (that is exactly the
          // requirement for elbowFlexionChange).
          const confident = specs.filter((s) => isConfident(s, minPoseConfidence));
          const expectedElbowFlexion = confident.length;
          // Arm-to-torso additionally requires the hip landmark.
          const expectedArmToTorso = confident.filter((s) => s.hasHip).length;
          // Palm rotation additionally requires assessed-arm hand landmarks.
          const expectedPalmRotation = confident.filter((s) => s.hasHand).length;

          expect(indicators.elbowFlexionChange.samples.length).toBe(expectedElbowFlexion);
          expect(indicators.armToTorsoChange.samples.length).toBe(expectedArmToTorso);
          expect(indicators.palmRotationChange.samples.length).toBe(expectedPalmRotation);

          // The summary's validFrameCount tracks the same series length (Req 4.5 /
          // Req 8.4 consistency): each indicator's summary uses exactly its samples.
          expect(indicators.elbowFlexionChange.summary.validFrameCount).toBe(
            expectedElbowFlexion
          );
          expect(indicators.armToTorsoChange.summary.validFrameCount).toBe(
            expectedArmToTorso
          );
          expect(indicators.palmRotationChange.summary.validFrameCount).toBe(
            expectedPalmRotation
          );
        }
      ),
      { numRuns: 200 }
    );
  });
});
