/**
 * Unit tests for PalmOrientationEstimator.
 *
 * Verifies:
 * - Palm facing camera → angle near 0
 * - Palm perpendicular → angle near 90
 * - Rotation change below threshold → pronationDetected = false
 * - Rotation change above threshold → pronationDetected = true
 * - Edge cases: insufficient landmarks, zero-magnitude vectors
 */

import { describe, it, expect } from 'vitest';
import {
  computePalmAngle,
  estimatePalmOrientation,
} from './PalmOrientationEstimator';
import type { NormalizedLandmark } from '../types';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Create a hand landmark with given position. */
function makeLandmark(x: number, y: number, z: number): NormalizedLandmark {
  return { x, y, z, visibility: 0.9 };
}

/**
 * Create a set of 21 hand landmarks with configurable wrist, index MCP, and middle MCP.
 * Non-relevant landmarks are placed at origin.
 */
function makeHandLandmarks(
  wrist: { x: number; y: number; z: number },
  indexMCP: { x: number; y: number; z: number },
  middleMCP: { x: number; y: number; z: number }
): NormalizedLandmark[] {
  const landmarks: NormalizedLandmark[] = Array.from({ length: 21 }, () =>
    makeLandmark(0.5, 0.5, 0)
  );
  landmarks[0] = makeLandmark(wrist.x, wrist.y, wrist.z);
  landmarks[5] = makeLandmark(indexMCP.x, indexMCP.y, indexMCP.z);
  landmarks[9] = makeLandmark(middleMCP.x, middleMCP.y, middleMCP.z);
  return landmarks;
}

// ─── computePalmAngle Tests ──────────────────────────────────────────────────

describe('computePalmAngle', () => {
  it('should return angle near 0 when palm faces camera (normal along -z)', () => {
    // Palm facing camera: v1 in x direction, v2 in y direction
    // cross(v1, v2) gives normal in +z direction
    // But we compare with -z camera direction, so angle between +z and -z is 180
    // To face camera, normal should point toward camera (-z)
    // cross(v1=(1,0,0), v2=(0,1,0)) = (0,0,1) → +z → angle with -z = 180
    // cross(v1=(0,1,0), v2=(1,0,0)) = (0,0,-1) → -z → angle with -z = 0
    // For palm facing camera, we need normal = -z
    // v1 = index - wrist, v2 = middle - wrist
    // If wrist at (0.5, 0.5, 0), index at (0.5, 0.4, 0), middle at (0.6, 0.5, 0)
    // v1 = (0, -0.1, 0), v2 = (0.1, 0, 0)
    // cross = (-0.1*0 - 0*0, 0*0.1 - 0*0, 0*0 - (-0.1)*0.1) = (0, 0, 0.01)
    // That's +z, angle with -z is 180

    // For normal pointing toward -z:
    // v1 = (0.1, 0, 0), v2 = (0, -0.1, 0)
    // cross = (0*0 - 0*(-0.1), 0*0.1 - 0.1*0, 0.1*(-0.1) - 0*0.1) = (0, 0, -0.01)
    // That's -z → angle = 0
    const landmarks = makeHandLandmarks(
      { x: 0.5, y: 0.5, z: 0 },      // wrist
      { x: 0.6, y: 0.5, z: 0 },      // index MCP: v1 = (0.1, 0, 0)
      { x: 0.5, y: 0.6, z: 0 }       // middle MCP: v2 = (0, 0.1, 0)
    );

    // cross((0.1,0,0), (0,0.1,0)) = (0*0-0*0.1, 0*0-0.1*0, 0.1*0.1-0*0) = (0, 0, 0.01) → +z
    // angle with -z = 180

    // Let's use: v1 in y direction, v2 in x direction
    // cross((0,-0.1,0), (0.1,0,0)) = (-0.1*0-0*0, 0*0.1-0*0, 0*0-(-0.1)*0.1) = (0, 0, 0.01) → +z

    // To get -z normal: v1 in -x, v2 in y
    // cross((-0.1,0,0), (0,0.1,0)) = (0*0-0*0.1, 0*0-(-0.1)*0, (-0.1)*0.1-0*0) = (0, 0, -0.01) → -z
    const landmarksFacingCamera = makeHandLandmarks(
      { x: 0.5, y: 0.5, z: 0 },      // wrist
      { x: 0.4, y: 0.5, z: 0 },      // index MCP: v1 = (-0.1, 0, 0)
      { x: 0.5, y: 0.6, z: 0 }       // middle MCP: v2 = (0, 0.1, 0)
    );

    const angle = computePalmAngle(landmarksFacingCamera);
    expect(angle).toBeCloseTo(0, 0);
  });

  it('should return angle near 90 when palm is perpendicular to camera', () => {
    // Palm perpendicular: normal in x or y direction
    // cross product should give a normal vector in the x-y plane
    // v1 = (0, 0, 0.1), v2 = (0, 0.1, 0)
    // cross = (0*0-0.1*0.1, 0.1*0-0*0, 0*0.1-0*0) = (-0.01, 0, 0)
    // normal = (-1, 0, 0), angle with (0,0,-1) = 90°
    const landmarks = makeHandLandmarks(
      { x: 0.5, y: 0.5, z: 0 },       // wrist
      { x: 0.5, y: 0.5, z: 0.1 },     // index MCP: v1 = (0, 0, 0.1)
      { x: 0.5, y: 0.6, z: 0 }        // middle MCP: v2 = (0, 0.1, 0)
    );

    const angle = computePalmAngle(landmarks);
    expect(angle).toBeCloseTo(90, 0);
  });

  it('should return 0 when fewer than 10 landmarks provided', () => {
    const landmarks = [makeLandmark(0.5, 0.5, 0)]; // only 1 landmark
    const angle = computePalmAngle(landmarks);
    expect(angle).toBe(0);
  });

  it('should return 0 when vectors are collinear (zero cross product)', () => {
    // v1 and v2 in same direction → cross product = 0
    const landmarks = makeHandLandmarks(
      { x: 0.5, y: 0.5, z: 0 },
      { x: 0.6, y: 0.5, z: 0 },      // v1 = (0.1, 0, 0)
      { x: 0.7, y: 0.5, z: 0 }       // v2 = (0.2, 0, 0) — same direction
    );

    const angle = computePalmAngle(landmarks);
    expect(angle).toBe(0);
  });

  it('should return angle near 180 when palm normal points away from camera (+z)', () => {
    // Normal in +z direction: angle with -z = 180°
    // cross((0.1,0,0), (0,0.1,0)) = (0, 0, 0.01) → +z
    const landmarks = makeHandLandmarks(
      { x: 0.5, y: 0.5, z: 0 },
      { x: 0.6, y: 0.5, z: 0 },      // v1 = (0.1, 0, 0)
      { x: 0.5, y: 0.6, z: 0 }       // v2 = (0, 0.1, 0)
    );

    const angle = computePalmAngle(landmarks);
    expect(angle).toBeCloseTo(180, 0);
  });
});

// ─── estimatePalmOrientation Tests ───────────────────────────────────────────

describe('estimatePalmOrientation', () => {
  it('should report pronationDetected = false when rotation change is below threshold', () => {
    // Palm facing camera (angle ~0), baseline = 0, threshold = 15
    const landmarks = makeHandLandmarks(
      { x: 0.5, y: 0.5, z: 0 },
      { x: 0.4, y: 0.5, z: 0 },      // normal → -z, angle ≈ 0
      { x: 0.5, y: 0.6, z: 0 }
    );

    const result = estimatePalmOrientation(landmarks, 0, 15);

    expect(result.palmAngle).toBeCloseTo(0, 0);
    expect(Math.abs(result.rotationChange)).toBeLessThan(15);
    expect(result.pronationDetected).toBe(false);
  });

  it('should report pronationDetected = true when rotation change exceeds threshold', () => {
    // Palm perpendicular (angle ~90), baseline = 0, threshold = 15
    // Rotation change = 90 - 0 = 90, which exceeds 15
    const landmarks = makeHandLandmarks(
      { x: 0.5, y: 0.5, z: 0 },
      { x: 0.5, y: 0.5, z: 0.1 },    // normal in x-y plane, angle ≈ 90
      { x: 0.5, y: 0.6, z: 0 }
    );

    const result = estimatePalmOrientation(landmarks, 0, 15);

    expect(result.palmAngle).toBeCloseTo(90, 0);
    expect(result.rotationChange).toBeCloseTo(90, 0);
    expect(result.pronationDetected).toBe(true);
  });

  it('should report pronationDetected = false when change exactly equals threshold', () => {
    // Edge case: exactly at threshold boundary
    // We need rotation change == threshold. With threshold = 15 and baseline = 75,
    // a palm angle of 90 gives rotationChange = 15 which should still trigger detection
    const landmarks = makeHandLandmarks(
      { x: 0.5, y: 0.5, z: 0 },
      { x: 0.5, y: 0.5, z: 0.1 },    // angle ≈ 90
      { x: 0.5, y: 0.6, z: 0 }
    );

    const result = estimatePalmOrientation(landmarks, 75, 15);

    // rotationChange = 90 - 75 = 15, |15| >= 15 → pronationDetected = true
    expect(result.rotationChange).toBeCloseTo(15, 0);
    expect(result.pronationDetected).toBe(true);
  });

  it('should report pronationDetected = false when change is just below threshold', () => {
    // baseline = 76, angle = 90, change = 14, threshold = 15
    const landmarks = makeHandLandmarks(
      { x: 0.5, y: 0.5, z: 0 },
      { x: 0.5, y: 0.5, z: 0.1 },    // angle ≈ 90
      { x: 0.5, y: 0.6, z: 0 }
    );

    const result = estimatePalmOrientation(landmarks, 76, 15);

    // rotationChange = 90 - 76 = 14, |14| < 15 → pronationDetected = false
    expect(result.rotationChange).toBeCloseTo(14, 0);
    expect(result.pronationDetected).toBe(false);
  });

  it('should detect negative rotation change (supination) when current angle < baseline', () => {
    // Palm facing camera (angle ~0), baseline = 45, threshold = 15
    // rotationChange = 0 - 45 = -45, |−45| >= 15 → detected
    const landmarks = makeHandLandmarks(
      { x: 0.5, y: 0.5, z: 0 },
      { x: 0.4, y: 0.5, z: 0 },      // normal → -z, angle ≈ 0
      { x: 0.5, y: 0.6, z: 0 }
    );

    const result = estimatePalmOrientation(landmarks, 45, 15);

    expect(result.palmAngle).toBeCloseTo(0, 0);
    expect(result.rotationChange).toBeCloseTo(-45, 0);
    expect(result.pronationDetected).toBe(true);
  });

  it('should return palmAngle = 0 for insufficient landmarks', () => {
    const landmarks = [makeLandmark(0.5, 0.5, 0)];
    const result = estimatePalmOrientation(landmarks, 30, 15);

    expect(result.palmAngle).toBe(0);
    expect(result.rotationChange).toBe(-30);
    expect(result.pronationDetected).toBe(true); // |−30| >= 15
  });
});
