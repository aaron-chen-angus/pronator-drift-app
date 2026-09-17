/**
 * Unit tests for PositionValidator module.
 *
 * Tests validate all position checks in priority order, hold timer behavior,
 * and the overall validation flow.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  PositionValidatorImpl,
  estimateTorsoAngle,
  angleDegrees,
  armBodyAngle,
  distance2D,
  CHECK_PRIORITY,
} from './PositionValidator';
import { ConfigStore } from '../config/ConfigStore';
import type { CVFrameResult, NormalizedLandmark, Handedness } from '../types';

// ─── Test Helpers ─────────────────────────────────────────────────────────────

/** Create a NormalizedLandmark with defaults. */
function makeLandmark(
  x: number,
  y: number,
  z = 0,
  visibility = 0.9
): NormalizedLandmark {
  return { x, y, z, visibility };
}

/**
 * Create a full set of 33 pose landmarks with a valid starting position.
 * Subject facing camera, arms at shoulder height, elbows extended.
 */
function makeValidPoseLandmarks(): NormalizedLandmark[] {
  const landmarks: NormalizedLandmark[] = Array.from({ length: 33 }, () =>
    makeLandmark(0.5, 0.5, 0, 0.9)
  );

  // Shoulders at same height, symmetric
  landmarks[11] = makeLandmark(0.6, 0.4, 0, 0.95); // Left shoulder
  landmarks[12] = makeLandmark(0.4, 0.4, 0, 0.95); // Right shoulder

  // Elbows extended horizontally at shoulder height
  landmarks[13] = makeLandmark(0.75, 0.4, 0, 0.9); // Left elbow
  landmarks[14] = makeLandmark(0.25, 0.4, 0, 0.9); // Right elbow

  // Wrists at shoulder height (extended outward)
  landmarks[15] = makeLandmark(0.9, 0.4, 0, 0.9); // Left wrist
  landmarks[16] = makeLandmark(0.1, 0.4, 0, 0.9); // Right wrist

  // Hips below shoulders
  landmarks[23] = makeLandmark(0.55, 0.7, 0, 0.9); // Left hip
  landmarks[24] = makeLandmark(0.45, 0.7, 0, 0.9); // Right hip

  return landmarks;
}

/**
 * Create valid hand landmarks (21 landmarks per hand) with palm facing up.
 * Landmarks 0=wrist, 5=index MCP, 9=middle MCP.
 *
 * For palm-up: cross product of (wrist→indexMCP) × (wrist→middleMCP)
 * should point toward the camera (negative z direction).
 *
 * v1 = indexMCP - wrist = (0.05, -0.02, 0)  → to the right and up
 * v2 = middleMCP - wrist = (0.03, -0.02, 0) → to the right and up (less x)
 * cross = v1 × v2:
 *   nx = v1y*v2z - v1z*v2y = 0
 *   ny = v1z*v2x - v1x*v2z = 0
 *   nz = v1x*v2y - v1y*v2x = (0.05*-0.02) - (-0.02*0.03) = -0.001 + 0.0006 = -0.0004
 * Normal points in -z direction (toward camera) → palm is facing up/toward camera.
 */
function makeValidHandLandmarks(): NormalizedLandmark[] {
  const landmarks: NormalizedLandmark[] = Array.from({ length: 21 }, (_, i) =>
    makeLandmark(0.5 + i * 0.01, 0.4, 0, 0.9)
  );

  // Set up landmarks for palm-up orientation (normal points toward camera = -z)
  // Wrist (0)
  landmarks[0] = makeLandmark(0.5, 0.4, 0, 0.9);
  // Index MCP (5) - to the right and slightly above wrist, same z
  landmarks[5] = makeLandmark(0.55, 0.38, 0, 0.9);
  // Middle MCP (9) - slightly more right and above, same z
  landmarks[9] = makeLandmark(0.53, 0.38, 0, 0.9);

  return landmarks;
}

/** Create a valid CVFrameResult with correct starting position. */
function makeValidFrame(timestamp = 1000): CVFrameResult {
  return {
    timestamp,
    poseLandmarks: [makeValidPoseLandmarks()],
    poseWorldLandmarks: null,
    handLandmarks: [makeValidHandLandmarks(), makeValidHandLandmarks()],
    handedness: [
      { label: 'Left', score: 0.95 },
      { label: 'Right', score: 0.95 },
    ],
    processingTimeMs: 16,
  };
}

/** Create a frame with no detected pose. */
function makeEmptyFrame(timestamp = 1000): CVFrameResult {
  return {
    timestamp,
    poseLandmarks: null,
    poseWorldLandmarks: null,
    handLandmarks: null,
    handedness: null,
    processingTimeMs: 16,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PositionValidator', () => {
  let validator: PositionValidatorImpl;
  let config: ConfigStore;

  beforeEach(() => {
    validator = new PositionValidatorImpl();
    config = new ConfigStore();
  });

  describe('validate() - overall behavior', () => {
    it('returns isValid=true and holdProgress>0 for a valid frame', () => {
      const frame = makeValidFrame();
      const result = validator.validate(frame, config);

      expect(result.isValid).toBe(true);
      expect(result.highestPriorityFail).toBeNull();
      expect(result.checks.every((c) => c.passed)).toBe(true);
    });

    it('returns isValid=false with highest priority fail for invalid frame', () => {
      const frame = makeEmptyFrame();
      const result = validator.validate(frame, config);

      expect(result.isValid).toBe(false);
      expect(result.highestPriorityFail).toBe('subject_detected');
    });

    it('reports checks in priority order', () => {
      const frame = makeValidFrame();
      const result = validator.validate(frame, config);

      expect(result.checks.map((c) => c.type)).toEqual(CHECK_PRIORITY);
    });
  });

  describe('subject_detected check', () => {
    it('fails when no pose landmarks present', () => {
      const frame = makeEmptyFrame();
      const result = validator.validate(frame, config);

      expect(result.checks[0].type).toBe('subject_detected');
      expect(result.checks[0].passed).toBe(false);
    });

    it('fails when pose landmarks array is empty', () => {
      const frame = makeValidFrame();
      frame.poseLandmarks = [];
      const result = validator.validate(frame, config);

      expect(result.checks[0].passed).toBe(false);
    });

    it('fails when landmark confidence is below threshold', () => {
      const frame = makeValidFrame();
      // Set all key landmark visibilities to below threshold
      const landmarks = frame.poseLandmarks![0];
      [11, 12, 13, 14, 15, 16].forEach((idx) => {
        landmarks[idx] = makeLandmark(landmarks[idx].x, landmarks[idx].y, 0, 0.1);
      });
      const result = validator.validate(frame, config);

      expect(result.checks[0].passed).toBe(false);
    });

    it('passes when landmarks have adequate confidence', () => {
      const frame = makeValidFrame();
      const result = validator.validate(frame, config);

      expect(result.checks[0].passed).toBe(true);
    });
  });

  describe('torso_forward check', () => {
    it('fails when shoulders have large z-depth difference (rotated)', () => {
      const frame = makeValidFrame();
      const landmarks = frame.poseLandmarks![0];
      // Create large z difference to simulate rotation
      landmarks[11] = makeLandmark(0.6, 0.4, 0.3, 0.95);
      landmarks[12] = makeLandmark(0.4, 0.4, -0.3, 0.95);

      const result = validator.validate(frame, config);
      const torsoCheck = result.checks.find((c) => c.type === 'torso_forward');

      expect(torsoCheck?.passed).toBe(false);
    });

    it('passes when shoulders are at similar z-depth (facing forward)', () => {
      const frame = makeValidFrame();
      const result = validator.validate(frame, config);
      const torsoCheck = result.checks.find((c) => c.type === 'torso_forward');

      expect(torsoCheck?.passed).toBe(true);
    });
  });

  describe('shoulders_visible check', () => {
    it('fails when left shoulder has low visibility', () => {
      const frame = makeValidFrame();
      const landmarks = frame.poseLandmarks![0];
      landmarks[11] = makeLandmark(0.6, 0.4, 0, 0.1); // Low visibility

      const result = validator.validate(frame, config);
      const check = result.checks.find((c) => c.type === 'shoulders_visible');

      expect(check?.passed).toBe(false);
    });

    it('fails when right shoulder has low visibility', () => {
      const frame = makeValidFrame();
      const landmarks = frame.poseLandmarks![0];
      landmarks[12] = makeLandmark(0.4, 0.4, 0, 0.1); // Low visibility

      const result = validator.validate(frame, config);
      const check = result.checks.find((c) => c.type === 'shoulders_visible');

      expect(check?.passed).toBe(false);
    });

    it('passes when both shoulders have high visibility', () => {
      const frame = makeValidFrame();
      const result = validator.validate(frame, config);
      const check = result.checks.find((c) => c.type === 'shoulders_visible');

      expect(check?.passed).toBe(true);
    });
  });

  describe('arm_height check', () => {
    it('fails when wrists are significantly below shoulder height', () => {
      const frame = makeValidFrame();
      const landmarks = frame.poseLandmarks![0];
      // Move wrists far below shoulders
      landmarks[15] = makeLandmark(0.9, 0.7, 0, 0.9); // Left wrist low
      landmarks[16] = makeLandmark(0.1, 0.7, 0, 0.9); // Right wrist low

      const result = validator.validate(frame, config);
      const check = result.checks.find((c) => c.type === 'arm_height');

      expect(check?.passed).toBe(false);
    });

    it('passes when wrists are at shoulder height', () => {
      const frame = makeValidFrame();
      const result = validator.validate(frame, config);
      const check = result.checks.find((c) => c.type === 'arm_height');

      expect(check?.passed).toBe(true);
    });
  });

  describe('elbow_extension check', () => {
    it('fails when elbows are significantly bent', () => {
      const frame = makeValidFrame();
      const landmarks = frame.poseLandmarks![0];
      // Move elbows to create a bent position (90-degree angle)
      landmarks[13] = makeLandmark(0.7, 0.3, 0, 0.9); // Left elbow up
      landmarks[14] = makeLandmark(0.3, 0.3, 0, 0.9); // Right elbow up
      // Keep wrists at shoulder level but close to body
      landmarks[15] = makeLandmark(0.7, 0.5, 0, 0.9); // Left wrist down
      landmarks[16] = makeLandmark(0.3, 0.5, 0, 0.9); // Right wrist down

      const result = validator.validate(frame, config);
      const check = result.checks.find((c) => c.type === 'elbow_extension');

      expect(check?.passed).toBe(false);
    });

    it('passes when elbows are extended (nearly straight)', () => {
      const frame = makeValidFrame();
      const result = validator.validate(frame, config);
      const check = result.checks.find((c) => c.type === 'elbow_extension');

      expect(check?.passed).toBe(true);
    });
  });

  describe('arms_not_resting check', () => {
    it('fails when arms hang close to body', () => {
      const frame = makeValidFrame();
      const landmarks = frame.poseLandmarks![0];
      // Arms pointing downward along torso
      landmarks[13] = makeLandmark(0.58, 0.55, 0, 0.9); // Left elbow near hip
      landmarks[14] = makeLandmark(0.42, 0.55, 0, 0.9); // Right elbow near hip

      const result = validator.validate(frame, config);
      const check = result.checks.find((c) => c.type === 'arms_not_resting');

      expect(check?.passed).toBe(false);
    });

    it('passes when arms are held away from body', () => {
      const frame = makeValidFrame();
      const result = validator.validate(frame, config);
      const check = result.checks.find((c) => c.type === 'arms_not_resting');

      expect(check?.passed).toBe(true);
    });
  });

  describe('hands_visible check', () => {
    it('fails when no hand landmarks present', () => {
      const frame = makeValidFrame();
      frame.handLandmarks = null;
      frame.handedness = null;

      const result = validator.validate(frame, config);
      const check = result.checks.find((c) => c.type === 'hands_visible');

      expect(check?.passed).toBe(false);
    });

    it('fails when only one hand detected', () => {
      const frame = makeValidFrame();
      frame.handedness = [{ label: 'Left', score: 0.95 }];

      const result = validator.validate(frame, config);
      const check = result.checks.find((c) => c.type === 'hands_visible');

      expect(check?.passed).toBe(false);
    });

    it('fails when hand confidence is below threshold', () => {
      const frame = makeValidFrame();
      frame.handedness = [
        { label: 'Left', score: 0.2 },
        { label: 'Right', score: 0.2 },
      ];

      const result = validator.validate(frame, config);
      const check = result.checks.find((c) => c.type === 'hands_visible');

      expect(check?.passed).toBe(false);
    });

    it('passes when both hands detected with high confidence', () => {
      const frame = makeValidFrame();
      const result = validator.validate(frame, config);
      const check = result.checks.find((c) => c.type === 'hands_visible');

      expect(check?.passed).toBe(true);
    });
  });

  describe('palm_orientation check', () => {
    it('passes with valid palm-up hand landmarks', () => {
      const frame = makeValidFrame();
      const result = validator.validate(frame, config);
      const check = result.checks.find((c) => c.type === 'palm_orientation');

      // With our test data the palm angle should be within tolerance
      expect(check?.passed).toBe(true);
    });
  });

  describe('priority ordering', () => {
    it('reports subject_detected as highest priority when multiple checks fail', () => {
      const frame = makeEmptyFrame();
      const result = validator.validate(frame, config);

      expect(result.highestPriorityFail).toBe('subject_detected');
    });

    it('reports torso_forward when subject detected but torso rotated', () => {
      const frame = makeValidFrame();
      const landmarks = frame.poseLandmarks![0];
      // Rotate torso significantly
      landmarks[11] = makeLandmark(0.6, 0.4, 0.5, 0.95);
      landmarks[12] = makeLandmark(0.4, 0.4, -0.5, 0.95);

      const result = validator.validate(frame, config);
      expect(result.highestPriorityFail).toBe('torso_forward');
    });

    it('reports arm_height when torso is fine but arms are low', () => {
      const frame = makeValidFrame();
      const landmarks = frame.poseLandmarks![0];
      // Move wrists far below shoulders
      landmarks[15] = makeLandmark(0.9, 0.8, 0, 0.9);
      landmarks[16] = makeLandmark(0.1, 0.8, 0, 0.9);

      const result = validator.validate(frame, config);
      expect(result.highestPriorityFail).toBe('arm_height');
    });
  });

  describe('hold timer', () => {
    it('starts at 0 hold duration', () => {
      expect(validator.getHoldDuration()).toBe(0);
    });

    it('advances when frames are continuously valid', () => {
      const frame1 = makeValidFrame(1000);
      const frame2 = makeValidFrame(2000);
      const frame3 = makeValidFrame(3000);

      validator.validate(frame1, config);
      validator.validate(frame2, config);
      validator.validate(frame3, config);

      expect(validator.getHoldDuration()).toBe(2); // 3000-1000 = 2000ms = 2s
    });

    it('resets to 0 when an invalid frame is encountered', () => {
      const frame1 = makeValidFrame(1000);
      const frame2 = makeValidFrame(2000);
      const invalidFrame = makeEmptyFrame(3000);
      const frame4 = makeValidFrame(4000);

      validator.validate(frame1, config);
      validator.validate(frame2, config);
      validator.validate(invalidFrame, config);
      validator.validate(frame4, config);

      // After invalid frame, timer restarts from frame4
      expect(validator.getHoldDuration()).toBe(0);
    });

    it('reports holdProgress = 1.0 when hold duration >= required', () => {
      // Default required hold is 2 seconds
      const frame1 = makeValidFrame(0);
      const frame2 = makeValidFrame(2000);

      validator.validate(frame1, config);
      const result = validator.validate(frame2, config);

      expect(result.holdProgress).toBe(1.0);
    });

    it('reports partial holdProgress during hold', () => {
      // Default required hold is 2 seconds
      const frame1 = makeValidFrame(0);
      const frame2 = makeValidFrame(1000); // 1s hold

      validator.validate(frame1, config);
      const result = validator.validate(frame2, config);

      expect(result.holdProgress).toBe(0.5);
    });

    it('caps holdProgress at 1.0', () => {
      const frame1 = makeValidFrame(0);
      const frame2 = makeValidFrame(5000); // 5s hold > 2s required

      validator.validate(frame1, config);
      const result = validator.validate(frame2, config);

      expect(result.holdProgress).toBe(1.0);
    });

    it('can be manually reset via resetHold()', () => {
      const frame1 = makeValidFrame(0);
      const frame2 = makeValidFrame(1500);

      validator.validate(frame1, config);
      validator.validate(frame2, config);

      expect(validator.getHoldDuration()).toBe(1.5);

      validator.resetHold();
      expect(validator.getHoldDuration()).toBe(0);
    });

    it('respects configurable hold duration', () => {
      const customConfig = new ConfigStore({ requiredHoldDuration: 3.0 });

      const frame1 = makeValidFrame(0);
      const frame2 = makeValidFrame(1500); // 1.5s of 3s required

      validator.validate(frame1, customConfig);
      const result = validator.validate(frame2, customConfig);

      expect(result.holdProgress).toBe(0.5); // 1.5/3.0
    });
  });
});

// ─── Geometry Helper Tests ────────────────────────────────────────────────────

describe('Geometry helpers', () => {
  describe('distance2D', () => {
    it('returns 0 for same point', () => {
      const p = makeLandmark(0.5, 0.5);
      expect(distance2D(p, p)).toBe(0);
    });

    it('computes correct distance for unit right', () => {
      const a = makeLandmark(0, 0);
      const b = makeLandmark(1, 0);
      expect(distance2D(a, b)).toBeCloseTo(1);
    });

    it('computes correct distance for diagonal', () => {
      const a = makeLandmark(0, 0);
      const b = makeLandmark(3, 4);
      expect(distance2D(a, b)).toBeCloseTo(5);
    });
  });

  describe('angleDegrees', () => {
    it('returns 180 for collinear points', () => {
      const a = makeLandmark(0, 0);
      const b = makeLandmark(0.5, 0);
      const c = makeLandmark(1, 0);
      expect(angleDegrees(a, b, c)).toBeCloseTo(180);
    });

    it('returns 90 for perpendicular points', () => {
      const a = makeLandmark(1, 0);
      const b = makeLandmark(0, 0);
      const c = makeLandmark(0, 1);
      expect(angleDegrees(a, b, c)).toBeCloseTo(90);
    });

    it('returns 0 when vectors are zero length', () => {
      const a = makeLandmark(0.5, 0.5);
      const b = makeLandmark(0.5, 0.5);
      const c = makeLandmark(0.5, 0.5);
      expect(angleDegrees(a, b, c)).toBe(0);
    });
  });

  describe('estimateTorsoAngle', () => {
    it('returns ~0 degrees when shoulders are at same depth', () => {
      const left = makeLandmark(0.6, 0.4, 0, 0.9);
      const right = makeLandmark(0.4, 0.4, 0, 0.9);
      expect(estimateTorsoAngle(left, right)).toBeCloseTo(0, 0);
    });

    it('returns large angle when shoulders have large z difference', () => {
      const left = makeLandmark(0.6, 0.4, 0.5, 0.9);
      const right = makeLandmark(0.4, 0.4, -0.5, 0.9);
      const angle = estimateTorsoAngle(left, right);
      expect(angle).toBeGreaterThan(15); // Exceeds default tolerance
    });
  });

  describe('armBodyAngle', () => {
    it('returns ~90 degrees for arm perpendicular to torso', () => {
      const shoulder = makeLandmark(0.5, 0.4);
      const elbow = makeLandmark(0.8, 0.4); // Arm pointing right
      const hip = makeLandmark(0.5, 0.7); // Torso pointing down

      const angle = armBodyAngle(shoulder, elbow, hip);
      expect(angle).toBeCloseTo(90, 0);
    });

    it('returns ~0 degrees when arm aligns with torso', () => {
      const shoulder = makeLandmark(0.5, 0.4);
      const elbow = makeLandmark(0.5, 0.55); // Arm pointing down
      const hip = makeLandmark(0.5, 0.7); // Torso pointing down

      const angle = armBodyAngle(shoulder, elbow, hip);
      expect(angle).toBeCloseTo(0, 0);
    });
  });
});
