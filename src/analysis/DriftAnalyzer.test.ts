/**
 * Unit tests for DriftAnalyzer calibration logic.
 *
 * Tests cover:
 * - startCalibration resets state
 * - addCalibrationFrame accumulates valid/invalid frames
 * - finalizeCalibration computes correct baselines
 * - Confidence rejection (>50% invalid frames)
 * - Stability check (wrist variation > 5% arm length)
 * - Per-arm baseline independence
 * - Normalized wrist height computation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigStore } from '../config/ConfigStore';
import {
  DriftAnalyzerImpl,
  distance2D,
  angleDegrees,
  landmarkToVec3,
  estimatePalmOrientationAngle,
  computeArmConfidence,
  extractArmMeasurement,
} from './DriftAnalyzer';
import type { CVFrameResult, NormalizedLandmark } from '../types';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Create a landmark with given position and visibility. */
function makeLandmark(
  x: number,
  y: number,
  z: number = 0,
  visibility: number = 0.9
): NormalizedLandmark {
  return { x, y, z, visibility };
}

/**
 * Create a complete set of 33 pose landmarks with arms at shoulder height.
 * Landmarks 11/12 = shoulders, 13/14 = elbows, 15/16 = wrists.
 */
function makeDefaultPoseLandmarks(overrides?: {
  leftWristY?: number;
  rightWristY?: number;
  leftWristX?: number;
  rightWristX?: number;
  visibility?: number;
}): NormalizedLandmark[] {
  const vis = overrides?.visibility ?? 0.9;
  const landmarks: NormalizedLandmark[] = Array.from({ length: 33 }, () =>
    makeLandmark(0.5, 0.5, 0, vis)
  );

  // Shoulders at shoulder height, symmetric
  landmarks[11] = makeLandmark(0.6, 0.4, 0, vis); // left shoulder
  landmarks[12] = makeLandmark(0.4, 0.4, 0, vis); // right shoulder

  // Elbows extended forward (horizontally between shoulder and wrist)
  landmarks[13] = makeLandmark(0.7, 0.4, 0, vis); // left elbow
  landmarks[14] = makeLandmark(0.3, 0.4, 0, vis); // right elbow

  // Wrists at shoulder height (default — arms straight out)
  landmarks[15] = makeLandmark(
    overrides?.leftWristX ?? 0.8,
    overrides?.leftWristY ?? 0.4,
    0,
    vis
  ); // left wrist
  landmarks[16] = makeLandmark(
    overrides?.rightWristX ?? 0.2,
    overrides?.rightWristY ?? 0.4,
    0,
    vis
  ); // right wrist

  // Hips for reference
  landmarks[23] = makeLandmark(0.55, 0.7, 0, vis); // left hip
  landmarks[24] = makeLandmark(0.45, 0.7, 0, vis); // right hip

  return landmarks;
}

/**
 * Create a minimal CVFrameResult with pose landmarks.
 */
function makeFrame(
  timestamp: number,
  poseLandmarks: NormalizedLandmark[] | null = null,
  handLandmarks: NormalizedLandmark[][] | null = null,
  handedness: { label: 'Left' | 'Right'; score: number }[] | null = null
): CVFrameResult {
  return {
    timestamp,
    poseLandmarks: poseLandmarks ? [poseLandmarks] : null,
    poseWorldLandmarks: null,
    handLandmarks,
    handedness,
    processingTimeMs: 16,
  };
}

/**
 * Create a set of hand landmarks (21 points) for palm orientation estimation.
 */
function makeHandLandmarks(palmUp: boolean = true): NormalizedLandmark[] {
  const landmarks: NormalizedLandmark[] = [];
  for (let i = 0; i < 21; i++) {
    landmarks.push(makeLandmark(0.5, 0.5, 0, 0.9));
  }
  // Landmark 0: wrist
  landmarks[0] = makeLandmark(0.5, 0.5, 0, 0.9);
  // Landmark 5: index MCP
  landmarks[5] = makeLandmark(0.52, 0.48, palmUp ? -0.02 : 0.02, 0.9);
  // Landmark 9: middle MCP
  landmarks[9] = makeLandmark(0.50, 0.47, palmUp ? -0.02 : 0.02, 0.9);
  return landmarks;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DriftAnalyzer - Geometry Helpers', () => {
  it('distance2D computes correct Euclidean distance', () => {
    const a = makeLandmark(0, 0);
    const b = makeLandmark(3, 4);
    expect(distance2D(a, b)).toBeCloseTo(5.0);
  });

  it('distance2D returns 0 for same point', () => {
    const a = makeLandmark(0.5, 0.5);
    expect(distance2D(a, a)).toBeCloseTo(0);
  });

  it('angleDegrees computes 90 degrees for perpendicular vectors', () => {
    const a = makeLandmark(1, 0);
    const b = makeLandmark(0, 0); // vertex
    const c = makeLandmark(0, 1);
    expect(angleDegrees(a, b, c)).toBeCloseTo(90);
  });

  it('angleDegrees computes 180 degrees for collinear points', () => {
    const a = makeLandmark(0, 0);
    const b = makeLandmark(0.5, 0); // vertex
    const c = makeLandmark(1, 0);
    expect(angleDegrees(a, b, c)).toBeCloseTo(180);
  });

  it('landmarkToVec3 extracts x, y, z', () => {
    const lm = makeLandmark(0.3, 0.7, -0.1);
    const vec = landmarkToVec3(lm);
    expect(vec).toEqual({ x: 0.3, y: 0.7, z: -0.1 });
  });

  it('computeArmConfidence averages shoulder, elbow, wrist visibility', () => {
    const landmarks = makeDefaultPoseLandmarks({ visibility: 0.8 });
    // Left arm: landmarks 11, 13, 15 all have visibility 0.8
    expect(computeArmConfidence(landmarks, 'left')).toBeCloseTo(0.8);
    expect(computeArmConfidence(landmarks, 'right')).toBeCloseTo(0.8);
  });

  it('extractArmMeasurement computes armLength as shoulder-to-wrist distance', () => {
    const landmarks = makeDefaultPoseLandmarks();
    // Left shoulder at (0.6, 0.4), left wrist at (0.8, 0.4)
    const measurement = extractArmMeasurement(landmarks, 'left', null);
    expect(measurement.armLength).toBeCloseTo(0.2); // horizontal distance
  });

  it('extractArmMeasurement computes normalizedWristHeight', () => {
    const landmarks = makeDefaultPoseLandmarks({ leftWristY: 0.45 });
    // Left shoulder at y=0.4, left wrist at y=0.45
    // armLength = distance from (0.6,0.4) to (0.8,0.45)
    const measurement = extractArmMeasurement(landmarks, 'left', null);
    // normalizedWristHeight = (0.45 - 0.4) / armLength
    const expectedArmLength = Math.sqrt(0.2 * 0.2 + 0.05 * 0.05);
    expect(measurement.normalizedWristHeight).toBeCloseTo(0.05 / expectedArmLength);
  });
});

describe('DriftAnalyzer - Calibration', () => {
  let config: ConfigStore;
  let analyzer: DriftAnalyzerImpl;

  beforeEach(() => {
    config = new ConfigStore();
    analyzer = new DriftAnalyzerImpl(config);
  });

  describe('startCalibration', () => {
    it('resets calibration state', () => {
      // Add a frame before starting calibration
      analyzer.startCalibration();
      const frame = makeFrame(1000, makeDefaultPoseLandmarks());
      analyzer.addCalibrationFrame(frame);

      // Restart calibration — should clear previous frames
      analyzer.startCalibration();
      const result = analyzer.finalizeCalibration();
      // No frames added after restart, should fail
      expect(result.success).toBe(false);
    });
  });

  describe('addCalibrationFrame', () => {
    it('does nothing if calibration is not active', () => {
      // Don't call startCalibration
      const frame = makeFrame(1000, makeDefaultPoseLandmarks());
      analyzer.addCalibrationFrame(frame);
      // Starting and finalizing should show no frames
      analyzer.startCalibration();
      const result = analyzer.finalizeCalibration();
      expect(result.success).toBe(false);
    });

    it('marks frames without pose landmarks as invalid', () => {
      analyzer.startCalibration();
      analyzer.addCalibrationFrame(makeFrame(1000, null));
      analyzer.addCalibrationFrame(makeFrame(1100, null));
      const result = analyzer.finalizeCalibration();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('low_confidence');
      }
    });

    it('marks frames with low confidence as invalid', () => {
      analyzer.startCalibration();
      // Landmarks with very low visibility
      const lowConfLandmarks = makeDefaultPoseLandmarks({ visibility: 0.1 });
      analyzer.addCalibrationFrame(makeFrame(1000, lowConfLandmarks));
      analyzer.addCalibrationFrame(makeFrame(1100, lowConfLandmarks));
      const result = analyzer.finalizeCalibration();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('low_confidence');
      }
    });
  });

  describe('finalizeCalibration', () => {
    it('succeeds with consistent valid frames', () => {
      analyzer.startCalibration();
      // Add several consistent frames
      for (let i = 0; i < 10; i++) {
        analyzer.addCalibrationFrame(
          makeFrame(1000 + i * 100, makeDefaultPoseLandmarks())
        );
      }
      const result = analyzer.finalizeCalibration();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.baseline.leftArm).toBeDefined();
        expect(result.baseline.rightArm).toBeDefined();
        expect(result.baseline.captureFrameCount).toBe(10);
      }
    });

    it('computes baseline as mean of valid frames', () => {
      analyzer.startCalibration();

      // Frame 1: left wrist at y=0.400
      const lm1 = makeDefaultPoseLandmarks({ leftWristY: 0.400 });
      analyzer.addCalibrationFrame(makeFrame(1000, lm1));

      // Frame 2: left wrist at y=0.404 (range 0.004, well within 5% of arm length ~0.01)
      const lm2 = makeDefaultPoseLandmarks({ leftWristY: 0.404 });
      analyzer.addCalibrationFrame(makeFrame(1100, lm2));

      const result = analyzer.finalizeCalibration();
      expect(result.success).toBe(true);
      if (result.success) {
        // Average wrist y should be (0.400 + 0.404) / 2 = 0.402
        expect(result.baseline.leftArm.wristPos.y).toBeCloseTo(0.402);
      }
    });

    it('rejects calibration if >50% frames are invalid', () => {
      analyzer.startCalibration();

      // 6 invalid frames (low confidence)
      for (let i = 0; i < 6; i++) {
        analyzer.addCalibrationFrame(
          makeFrame(1000 + i * 100, makeDefaultPoseLandmarks({ visibility: 0.1 }))
        );
      }
      // 4 valid frames
      for (let i = 0; i < 4; i++) {
        analyzer.addCalibrationFrame(
          makeFrame(1600 + i * 100, makeDefaultPoseLandmarks())
        );
      }

      const result = analyzer.finalizeCalibration();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('low_confidence');
      }
    });

    it('accepts calibration if exactly 50% frames are invalid', () => {
      analyzer.startCalibration();

      // 5 invalid frames
      for (let i = 0; i < 5; i++) {
        analyzer.addCalibrationFrame(
          makeFrame(1000 + i * 100, makeDefaultPoseLandmarks({ visibility: 0.1 }))
        );
      }
      // 5 valid frames
      for (let i = 0; i < 5; i++) {
        analyzer.addCalibrationFrame(
          makeFrame(1500 + i * 100, makeDefaultPoseLandmarks())
        );
      }

      const result = analyzer.finalizeCalibration();
      expect(result.success).toBe(true);
    });

    it('rejects calibration when wrist is unstable (variation > 5% arm length)', () => {
      analyzer.startCalibration();

      // Left arm length is about 0.2 (shoulder at 0.6, wrist at 0.8 on x-axis)
      // 5% of 0.2 = 0.01
      // Make wrist y vary by more than 0.01 across frames
      for (let i = 0; i < 5; i++) {
        const wristY = 0.38 + i * 0.01; // varies from 0.38 to 0.42, range = 0.04
        analyzer.addCalibrationFrame(
          makeFrame(1000 + i * 100, makeDefaultPoseLandmarks({ leftWristY: wristY }))
        );
      }

      const result = analyzer.finalizeCalibration();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('unstable_position');
      }
    });

    it('accepts calibration when wrist variation is within tolerance', () => {
      analyzer.startCalibration();

      // Arm length ~ 0.2, so 5% = 0.01
      // Keep wrist variation under 0.01
      for (let i = 0; i < 5; i++) {
        const wristY = 0.40 + i * 0.001; // varies from 0.400 to 0.404, range = 0.004
        analyzer.addCalibrationFrame(
          makeFrame(1000 + i * 100, makeDefaultPoseLandmarks({ leftWristY: wristY }))
        );
      }

      const result = analyzer.finalizeCalibration();
      expect(result.success).toBe(true);
    });

    it('computes per-arm baselines independently', () => {
      analyzer.startCalibration();

      // Left wrist at y=0.45, right wrist at y=0.35
      const landmarks = makeDefaultPoseLandmarks({
        leftWristY: 0.45,
        rightWristY: 0.35,
      });
      for (let i = 0; i < 5; i++) {
        analyzer.addCalibrationFrame(makeFrame(1000 + i * 100, landmarks));
      }

      const result = analyzer.finalizeCalibration();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.baseline.leftArm.wristPos.y).toBeCloseTo(0.45);
        expect(result.baseline.rightArm.wristPos.y).toBeCloseTo(0.35);
        // They should NOT be equal
        expect(result.baseline.leftArm.wristPos.y).not.toBeCloseTo(
          result.baseline.rightArm.wristPos.y
        );
      }
    });

    it('includes shoulder width and torso angle in baseline', () => {
      analyzer.startCalibration();

      for (let i = 0; i < 5; i++) {
        analyzer.addCalibrationFrame(
          makeFrame(1000 + i * 100, makeDefaultPoseLandmarks())
        );
      }

      const result = analyzer.finalizeCalibration();
      expect(result.success).toBe(true);
      if (result.success) {
        // Shoulder width: distance between (0.6, 0.4) and (0.4, 0.4) = 0.2
        expect(result.baseline.shoulderWidth).toBeCloseTo(0.2);
        // Torso angle: both shoulders at same z, so angle ~ 0
        expect(result.baseline.torsoAngle).toBeCloseTo(0);
      }
    });

    it('captures correct timestamps in baseline', () => {
      analyzer.startCalibration();

      analyzer.addCalibrationFrame(makeFrame(5000, makeDefaultPoseLandmarks()));
      analyzer.addCalibrationFrame(makeFrame(5500, makeDefaultPoseLandmarks()));
      analyzer.addCalibrationFrame(makeFrame(6000, makeDefaultPoseLandmarks()));

      const result = analyzer.finalizeCalibration();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.baseline.captureStartTime).toBe(5000);
        expect(result.baseline.captureEndTime).toBe(6000);
      }
    });

    it('computes elbow extension angle correctly', () => {
      analyzer.startCalibration();

      // With default landmarks: shoulder(0.6,0.4), elbow(0.7,0.4), wrist(0.8,0.4)
      // All collinear -> angle at elbow = 180 degrees (full extension)
      for (let i = 0; i < 3; i++) {
        analyzer.addCalibrationFrame(
          makeFrame(1000 + i * 100, makeDefaultPoseLandmarks())
        );
      }

      const result = analyzer.finalizeCalibration();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.baseline.leftArm.elbowExtensionAngle).toBeCloseTo(180);
      }
    });

    it('includes palm orientation angle when hand landmarks are available', () => {
      analyzer.startCalibration();

      const poseLandmarks = makeDefaultPoseLandmarks();
      const leftHand = makeHandLandmarks(true);
      const rightHand = makeHandLandmarks(true);

      for (let i = 0; i < 3; i++) {
        analyzer.addCalibrationFrame(
          makeFrame(
            1000 + i * 100,
            poseLandmarks,
            [leftHand, rightHand],
            [
              { label: 'Left', score: 0.9 },
              { label: 'Right', score: 0.9 },
            ]
          )
        );
      }

      const result = analyzer.finalizeCalibration();
      expect(result.success).toBe(true);
      if (result.success) {
        // Palm orientation angle should be a number (specific value depends on geometry)
        expect(typeof result.baseline.leftArm.palmOrientationAngle).toBe('number');
        expect(typeof result.baseline.rightArm.palmOrientationAngle).toBe('number');
      }
    });

    it('uses 0 for palm orientation when hand landmarks unavailable', () => {
      analyzer.startCalibration();

      for (let i = 0; i < 3; i++) {
        analyzer.addCalibrationFrame(
          makeFrame(1000 + i * 100, makeDefaultPoseLandmarks())
        );
      }

      const result = analyzer.finalizeCalibration();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.baseline.leftArm.palmOrientationAngle).toBe(0);
        expect(result.baseline.rightArm.palmOrientationAngle).toBe(0);
      }
    });

    it('returns empty result when no frames were added', () => {
      analyzer.startCalibration();
      const result = analyzer.finalizeCalibration();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('low_confidence');
      }
    });
  });

  describe('configurable thresholds', () => {
    it('uses custom minPoseConfidence from config', () => {
      const strictConfig = new ConfigStore({ minPoseConfidence: 0.9 });
      const strictAnalyzer = new DriftAnalyzerImpl(strictConfig);

      strictAnalyzer.startCalibration();
      // Landmarks with visibility 0.8 — below the strict 0.9 threshold
      const landmarks = makeDefaultPoseLandmarks({ visibility: 0.8 });
      for (let i = 0; i < 5; i++) {
        strictAnalyzer.addCalibrationFrame(makeFrame(1000 + i * 100, landmarks));
      }

      const result = strictAnalyzer.finalizeCalibration();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('low_confidence');
      }
    });

    it('uses custom maxBaselineVariation from config', () => {
      // More lenient variation threshold (0.2 is the max allowed by ConfigStore range)
      const lenientConfig = new ConfigStore({ maxBaselineVariation: 0.2 });
      const lenientAnalyzer = new DriftAnalyzerImpl(lenientConfig);

      lenientAnalyzer.startCalibration();
      // Wrist variation of 0.04 range — would fail with default (0.05 * 0.2 = 0.01)
      // but passes with 0.2 ratio (0.2 * 0.2 = 0.04)
      for (let i = 0; i < 5; i++) {
        const wristY = 0.38 + i * 0.008; // range = 0.032, within 0.04 threshold
        lenientAnalyzer.addCalibrationFrame(
          makeFrame(1000 + i * 100, makeDefaultPoseLandmarks({ leftWristY: wristY }))
        );
      }

      const result = lenientAnalyzer.finalizeCalibration();
      expect(result.success).toBe(true);
    });
  });
});

describe('DriftAnalyzer - estimatePalmOrientationAngle', () => {
  it('returns 0 when hand landmarks have fewer than 10 points', () => {
    const shortLandmarks = [makeLandmark(0.5, 0.5)];
    expect(estimatePalmOrientationAngle(shortLandmarks)).toBe(0);
  });

  it('returns a finite angle for valid hand landmarks', () => {
    const handLandmarks = makeHandLandmarks(true);
    const angle = estimatePalmOrientationAngle(handLandmarks);
    expect(Number.isFinite(angle)).toBe(true);
    expect(angle).toBeGreaterThanOrEqual(0);
    expect(angle).toBeLessThanOrEqual(180);
  });
});
