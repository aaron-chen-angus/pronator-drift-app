/**
 * PalmOrientationEstimator module — estimates palm orientation from hand landmarks
 * and determines whether pronation exceeds a configurable threshold.
 *
 * Uses MediaPipe Hand Landmarker landmarks 0 (wrist), 5 (index MCP), and 9 (middle MCP)
 * to compute a palm normal via cross-product, then measures the angle between the palm
 * normal and the camera direction vector (0, 0, -1).
 *
 * Validates: Requirements 8.5
 */

import type { NormalizedLandmark } from '../types';

// ─── Result Interface ────────────────────────────────────────────────────────

export interface PalmOrientationResult {
  /** Palm angle in degrees from the camera-facing direction (0 = facing camera, 90 = perpendicular) */
  palmAngle: number;
  /** Change in palm angle from baseline */
  rotationChange: number;
  /** Whether the rotation exceeds the minimum pronation threshold */
  pronationDetected: boolean;
}

// ─── Core Estimation Logic ───────────────────────────────────────────────────

/**
 * Compute the palm orientation angle from hand landmarks.
 *
 * Uses the cross-product of two vectors originating at the wrist:
 * - v1 = wrist → index MCP (landmark 5)
 * - v2 = wrist → middle MCP (landmark 9)
 *
 * The resulting cross product gives the palm normal. The angle between
 * this normal and the camera direction (0, 0, -1) represents how much
 * the palm faces the camera (0° = directly facing, 90° = perpendicular).
 *
 * @param handLandmarks Array of at least 10 hand landmarks from MediaPipe Hand Landmarker
 * @returns Angle in degrees from camera-facing direction, or 0 if landmarks are insufficient
 */
export function computePalmAngle(handLandmarks: NormalizedLandmark[]): number {
  if (handLandmarks.length < 10) return 0;

  const wrist = handLandmarks[0];
  const indexMCP = handLandmarks[5];
  const middleMCP = handLandmarks[9];

  // Vector from wrist to index MCP
  const v1x = indexMCP.x - wrist.x;
  const v1y = indexMCP.y - wrist.y;
  const v1z = indexMCP.z - wrist.z;

  // Vector from wrist to middle MCP
  const v2x = middleMCP.x - wrist.x;
  const v2y = middleMCP.y - wrist.y;
  const v2z = middleMCP.z - wrist.z;

  // Cross product: palmNormal = cross(v1, v2)
  const nx = v1y * v2z - v1z * v2y;
  const ny = v1z * v2x - v1x * v2z;
  const nz = v1x * v2y - v1y * v2x;

  const mag = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (mag === 0) return 0;

  // Angle between palm normal and camera direction vector (0, 0, -1)
  // dot(normal, (0,0,-1)) = -nz
  const dotWithCameraDir = -nz / mag;
  const clampedDot = Math.max(-1, Math.min(1, dotWithCameraDir));

  return (Math.acos(clampedDot) * 180) / Math.PI;
}

/**
 * Estimate palm orientation and determine whether pronation is detected.
 *
 * Computes the current palm angle from hand landmarks, calculates the
 * rotation change relative to a baseline palm angle, and reports pronation
 * only when the absolute rotation change exceeds the configured minimum
 * pronation change threshold.
 *
 * @param handLandmarks Array of hand landmarks from MediaPipe Hand Landmarker
 * @param baselinePalmAngle The palm angle recorded during calibration (degrees)
 * @param minPronationChange Minimum rotation change threshold to report pronation (degrees)
 * @returns PalmOrientationResult with angle, change, and detection flag
 */
export function estimatePalmOrientation(
  handLandmarks: NormalizedLandmark[],
  baselinePalmAngle: number,
  minPronationChange: number
): PalmOrientationResult {
  const palmAngle = computePalmAngle(handLandmarks);
  const rotationChange = palmAngle - baselinePalmAngle;
  const pronationDetected = Math.abs(rotationChange) >= minPronationChange;

  return {
    palmAngle,
    rotationChange,
    pronationDetected,
  };
}
