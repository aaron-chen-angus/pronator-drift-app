/**
 * PositionValidator module — validates the subject's starting position
 * using both Pose Landmarker and Hand Landmarker results.
 *
 * Checks are evaluated in a fixed priority order and the single
 * highest-priority failing check is reported. A hold timer tracks
 * continuous validity duration and resets on any invalid frame.
 *
 * All threshold values are sourced from ConfigStore and are prototype
 * values requiring clinical validation.
 */

import type { ConfigStore } from '../config/ConfigStore';
import type {
  CVFrameResult,
  NormalizedLandmark,
  PositionCheck,
  PositionCheckType,
  PositionValidationResult,
} from '../types';

// ─── MediaPipe Pose Landmark Indices ─────────────────────────────────────────

const POSE_LANDMARKS = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
} as const;

// ─── Priority-ordered check types ────────────────────────────────────────────

const CHECK_PRIORITY: PositionCheckType[] = [
  'subject_detected',
  'torso_forward',
  'shoulders_visible',
  'arm_height',
  'elbow_extension',
  'arms_not_resting',
  'hands_visible',
  'palm_orientation',
];

// ─── User-facing correction messages ─────────────────────────────────────────

const CHECK_MESSAGES: Record<PositionCheckType, string> = {
  subject_detected: 'Please step into view of the camera.',
  torso_forward: 'Please face the camera directly.',
  shoulders_visible: 'Please ensure both shoulders are visible.',
  arm_height: 'Please raise both arms to shoulder height.',
  elbow_extension: 'Please straighten both elbows.',
  arms_not_resting: 'Please hold your arms away from your body.',
  hands_visible: 'Please ensure both hands are visible to the camera.',
  palm_orientation: 'Please turn both palms to face upward.',
};

// ─── Geometry Helpers ─────────────────────────────────────────────────────────

/** Compute Euclidean distance between two landmarks (2D normalized coords). */
function distance2D(a: NormalizedLandmark, b: NormalizedLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Compute angle (degrees) at vertex B in triangle A-B-C using normalized landmarks. */
function angleDegrees(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  c: NormalizedLandmark
): number {
  const baX = a.x - b.x;
  const baY = a.y - b.y;
  const bcX = c.x - b.x;
  const bcY = c.y - b.y;

  const dot = baX * bcX + baY * bcY;
  const magBA = Math.sqrt(baX * baX + baY * baY);
  const magBC = Math.sqrt(bcX * bcX + bcY * bcY);

  if (magBA === 0 || magBC === 0) return 0;

  const cosAngle = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
  return (Math.acos(cosAngle) * 180) / Math.PI;
}

/**
 * Estimate torso forward-facing angle (deviation from camera-facing).
 * Uses the z-depth difference between left and right shoulders to estimate rotation.
 * A fully forward-facing subject has shoulders at approximately equal z-depth.
 */
function estimateTorsoAngle(
  leftShoulder: NormalizedLandmark,
  rightShoulder: NormalizedLandmark
): number {
  // Shoulder width in x
  const shoulderWidthX = Math.abs(leftShoulder.x - rightShoulder.x);

  // Z difference indicates rotation
  const zDiff = Math.abs(leftShoulder.z - rightShoulder.z);

  if (shoulderWidthX === 0) return 90; // degenerate case

  // atan(zDiff / shoulderWidthX) gives rotation angle
  return (Math.atan2(zDiff, shoulderWidthX) * 180) / Math.PI;
}

/**
 * Compute angle between upper arm vector and torso midline vector.
 * Used to check arms_not_resting.
 */
function armBodyAngle(
  shoulder: NormalizedLandmark,
  elbow: NormalizedLandmark,
  hip: NormalizedLandmark
): number {
  // Upper arm vector: shoulder → elbow
  const armX = elbow.x - shoulder.x;
  const armY = elbow.y - shoulder.y;

  // Torso vector: shoulder → hip
  const torsoX = hip.x - shoulder.x;
  const torsoY = hip.y - shoulder.y;

  const dot = armX * torsoX + armY * torsoY;
  const magArm = Math.sqrt(armX * armX + armY * armY);
  const magTorso = Math.sqrt(torsoX * torsoX + torsoY * torsoY);

  if (magArm === 0 || magTorso === 0) return 0;

  const cosAngle = Math.max(-1, Math.min(1, dot / (magArm * magTorso)));
  return (Math.acos(cosAngle) * 180) / Math.PI;
}

/**
 * Estimate palm orientation angle from vertical using hand landmarks.
 * Uses landmarks 0 (wrist), 5 (index MCP), and 9 (middle MCP) to estimate
 * the palm normal direction. Returns deviation from upward-facing in degrees.
 */
function estimatePalmAngle(handLandmarks: NormalizedLandmark[]): number {
  if (handLandmarks.length < 10) return 90; // can't estimate

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

  // Cross product gives palm normal
  const nx = v1y * v2z - v1z * v2y;
  const ny = v1z * v2x - v1x * v2z;
  const nz = v1x * v2y - v1y * v2x;

  const mag = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (mag === 0) return 90;

  // Upward-facing palm: normal should point toward camera (negative z in MediaPipe)
  // We measure deviation from vertical (y-axis) for simplicity
  // Palm up means the normal points in -z direction (towards camera)
  // Angle between normal and -z axis (0,0,-1)
  const dotWithCameraDir = -nz / mag;
  const angle = (Math.acos(Math.max(-1, Math.min(1, dotWithCameraDir))) * 180) / Math.PI;

  return angle;
}

// ─── PositionValidator Implementation ────────────────────────────────────────

export interface PositionValidatorInterface {
  validate(frame: CVFrameResult, config: ConfigStore): PositionValidationResult;
  getHoldDuration(): number;
  resetHold(): void;
}

export class PositionValidatorImpl implements PositionValidatorInterface {
  private holdStartTime: number | null = null;
  private lastValidTimestamp: number | null = null;
  private currentHoldDuration: number = 0;

  /**
   * Validates the current frame against all position criteria in priority order.
   * Updates the hold timer based on continuous validity.
   */
  validate(frame: CVFrameResult, config: ConfigStore): PositionValidationResult {
    const checks: PositionCheck[] = [];
    const requiredHoldDuration = config.get('requiredHoldDuration');

    // Run all checks in priority order
    const checkFunctions: Array<() => PositionCheck> = [
      () => this.checkSubjectDetected(frame, config),
      () => this.checkTorsoForward(frame, config),
      () => this.checkShouldersVisible(frame, config),
      () => this.checkArmHeight(frame, config),
      () => this.checkElbowExtension(frame, config),
      () => this.checkArmsNotResting(frame, config),
      () => this.checkHandsVisible(frame, config),
      () => this.checkPalmOrientation(frame, config),
    ];

    let firstFailIndex = -1;

    for (let i = 0; i < checkFunctions.length; i++) {
      // Only run subsequent checks if prior ones passed
      // (we still need all results for the checks array)
      if (firstFailIndex === -1) {
        const check = checkFunctions[i]();
        checks.push(check);
        if (!check.passed) {
          firstFailIndex = i;
        }
      } else {
        // For lower-priority checks after a failure, mark as not evaluated
        // but still include them with passed=false for completeness
        checks.push({
          type: CHECK_PRIORITY[i],
          passed: false,
          message: CHECK_MESSAGES[CHECK_PRIORITY[i]],
        });
      }
    }

    const isValid = firstFailIndex === -1;
    const highestPriorityFail = isValid ? null : CHECK_PRIORITY[firstFailIndex];

    // Update hold timer
    this.updateHoldTimer(isValid, frame.timestamp);

    const holdProgress = Math.min(1.0, this.currentHoldDuration / requiredHoldDuration);

    return {
      isValid,
      checks,
      highestPriorityFail,
      holdProgress,
    };
  }

  /**
   * Returns the current hold duration in seconds.
   */
  getHoldDuration(): number {
    return this.currentHoldDuration;
  }

  /**
   * Resets the hold timer to zero.
   */
  resetHold(): void {
    this.holdStartTime = null;
    this.lastValidTimestamp = null;
    this.currentHoldDuration = 0;
  }

  // ─── Private Check Methods ───────────────────────────────────────────────

  private checkSubjectDetected(frame: CVFrameResult, config: ConfigStore): PositionCheck {
    const minConfidence = config.get('minPoseConfidence');
    const poseLandmarks = frame.poseLandmarks;

    if (!poseLandmarks || poseLandmarks.length === 0) {
      return {
        type: 'subject_detected',
        passed: false,
        message: CHECK_MESSAGES.subject_detected,
      };
    }

    // Check that at least one pose has adequate confidence
    // We use the first (and typically only) person's landmarks
    const landmarks = poseLandmarks[0];
    if (!landmarks || landmarks.length === 0) {
      return {
        type: 'subject_detected',
        passed: false,
        message: CHECK_MESSAGES.subject_detected,
      };
    }

    // Check confidence on key landmarks (shoulders, elbows, wrists)
    const keyIndices = [
      POSE_LANDMARKS.LEFT_SHOULDER,
      POSE_LANDMARKS.RIGHT_SHOULDER,
      POSE_LANDMARKS.LEFT_ELBOW,
      POSE_LANDMARKS.RIGHT_ELBOW,
      POSE_LANDMARKS.LEFT_WRIST,
      POSE_LANDMARKS.RIGHT_WRIST,
    ];

    const avgConfidence =
      keyIndices.reduce((sum, idx) => sum + (landmarks[idx]?.visibility ?? 0), 0) /
      keyIndices.length;

    return {
      type: 'subject_detected',
      passed: avgConfidence >= minConfidence,
      value: avgConfidence,
      threshold: minConfidence,
      message: CHECK_MESSAGES.subject_detected,
    };
  }

  private checkTorsoForward(frame: CVFrameResult, config: ConfigStore): PositionCheck {
    const maxAngle = config.get('maxTorsoAngleTolerance');
    const landmarks = frame.poseLandmarks![0];

    const leftShoulder = landmarks[POSE_LANDMARKS.LEFT_SHOULDER];
    const rightShoulder = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER];

    const torsoAngle = estimateTorsoAngle(leftShoulder, rightShoulder);

    return {
      type: 'torso_forward',
      passed: torsoAngle <= maxAngle,
      value: torsoAngle,
      threshold: maxAngle,
      message: CHECK_MESSAGES.torso_forward,
    };
  }

  private checkShouldersVisible(frame: CVFrameResult, config: ConfigStore): PositionCheck {
    const minConfidence = config.get('minPoseConfidence');
    const landmarks = frame.poseLandmarks![0];

    const leftShoulder = landmarks[POSE_LANDMARKS.LEFT_SHOULDER];
    const rightShoulder = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER];

    const leftVis = leftShoulder?.visibility ?? 0;
    const rightVis = rightShoulder?.visibility ?? 0;
    const minVis = Math.min(leftVis, rightVis);

    return {
      type: 'shoulders_visible',
      passed: minVis >= minConfidence,
      value: minVis,
      threshold: minConfidence,
      message: CHECK_MESSAGES.shoulders_visible,
    };
  }

  private checkArmHeight(frame: CVFrameResult, config: ConfigStore): PositionCheck {
    const maxTolerance = config.get('maxWristHeightTolerance');
    const landmarks = frame.poseLandmarks![0];

    const leftShoulder = landmarks[POSE_LANDMARKS.LEFT_SHOULDER];
    const rightShoulder = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER];
    const leftWrist = landmarks[POSE_LANDMARKS.LEFT_WRIST];
    const rightWrist = landmarks[POSE_LANDMARKS.RIGHT_WRIST];

    // Compute arm lengths (shoulder to wrist distance)
    const leftArmLength = distance2D(leftShoulder, leftWrist);
    const rightArmLength = distance2D(rightShoulder, rightWrist);

    // Wrist height deviation from shoulder height (normalized to arm length)
    // In normalized coords, y increases downward
    const leftHeightDev =
      leftArmLength > 0
        ? Math.abs(leftWrist.y - leftShoulder.y) / leftArmLength
        : 1;
    const rightHeightDev =
      rightArmLength > 0
        ? Math.abs(rightWrist.y - rightShoulder.y) / rightArmLength
        : 1;

    const maxDev = Math.max(leftHeightDev, rightHeightDev);

    return {
      type: 'arm_height',
      passed: maxDev <= maxTolerance,
      value: maxDev,
      threshold: maxTolerance,
      message: CHECK_MESSAGES.arm_height,
    };
  }

  private checkElbowExtension(frame: CVFrameResult, config: ConfigStore): PositionCheck {
    const maxFlexion = config.get('maxElbowFlexionTolerance');
    const landmarks = frame.poseLandmarks![0];

    const leftShoulder = landmarks[POSE_LANDMARKS.LEFT_SHOULDER];
    const rightShoulder = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER];
    const leftElbow = landmarks[POSE_LANDMARKS.LEFT_ELBOW];
    const rightElbow = landmarks[POSE_LANDMARKS.RIGHT_ELBOW];
    const leftWrist = landmarks[POSE_LANDMARKS.LEFT_WRIST];
    const rightWrist = landmarks[POSE_LANDMARKS.RIGHT_WRIST];

    // Angle at elbow (shoulder-elbow-wrist). Full extension = 180 degrees.
    const leftAngle = angleDegrees(leftShoulder, leftElbow, leftWrist);
    const rightAngle = angleDegrees(rightShoulder, rightElbow, rightWrist);

    // Flexion from full extension
    const leftFlexion = 180 - leftAngle;
    const rightFlexion = 180 - rightAngle;
    const maxFlexionMeasured = Math.max(leftFlexion, rightFlexion);

    return {
      type: 'elbow_extension',
      passed: maxFlexionMeasured <= maxFlexion,
      value: maxFlexionMeasured,
      threshold: maxFlexion,
      message: CHECK_MESSAGES.elbow_extension,
    };
  }

  private checkArmsNotResting(frame: CVFrameResult, config: ConfigStore): PositionCheck {
    const minAngle = config.get('minArmBodyAngle');
    const landmarks = frame.poseLandmarks![0];

    const leftShoulder = landmarks[POSE_LANDMARKS.LEFT_SHOULDER];
    const rightShoulder = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER];
    const leftElbow = landmarks[POSE_LANDMARKS.LEFT_ELBOW];
    const rightElbow = landmarks[POSE_LANDMARKS.RIGHT_ELBOW];
    const leftHip = landmarks[POSE_LANDMARKS.LEFT_HIP];
    const rightHip = landmarks[POSE_LANDMARKS.RIGHT_HIP];

    const leftArmAngle = armBodyAngle(leftShoulder, leftElbow, leftHip);
    const rightArmAngle = armBodyAngle(rightShoulder, rightElbow, rightHip);

    const minArmAngleMeasured = Math.min(leftArmAngle, rightArmAngle);

    return {
      type: 'arms_not_resting',
      passed: minArmAngleMeasured >= minAngle,
      value: minArmAngleMeasured,
      threshold: minAngle,
      message: CHECK_MESSAGES.arms_not_resting,
    };
  }

  private checkHandsVisible(frame: CVFrameResult, config: ConfigStore): PositionCheck {
    const minConfidence = config.get('minHandConfidence');
    const handLandmarks = frame.handLandmarks;
    const handedness = frame.handedness;

    if (!handLandmarks || !handedness || handedness.length < 2) {
      return {
        type: 'hands_visible',
        passed: false,
        message: CHECK_MESSAGES.hands_visible,
      };
    }

    // Check that both left and right hands are detected
    const hasLeft = handedness.some(
      (h) => h.label === 'Left' && h.score >= minConfidence
    );
    const hasRight = handedness.some(
      (h) => h.label === 'Right' && h.score >= minConfidence
    );

    const minScore = Math.min(
      ...handedness.map((h) => h.score)
    );

    return {
      type: 'hands_visible',
      passed: hasLeft && hasRight,
      value: minScore,
      threshold: minConfidence,
      message: CHECK_MESSAGES.hands_visible,
    };
  }

  private checkPalmOrientation(frame: CVFrameResult, config: ConfigStore): PositionCheck {
    const maxAngle = config.get('maxPalmOrientationTolerance');
    const handLandmarks = frame.handLandmarks!;
    const handedness = frame.handedness!;

    let maxPalmAngle = 0;

    for (let i = 0; i < handLandmarks.length; i++) {
      const palmAngle = estimatePalmAngle(handLandmarks[i]);
      maxPalmAngle = Math.max(maxPalmAngle, palmAngle);
    }

    return {
      type: 'palm_orientation',
      passed: maxPalmAngle <= maxAngle,
      value: maxPalmAngle,
      threshold: maxAngle,
      message: CHECK_MESSAGES.palm_orientation,
    };
  }

  // ─── Hold Timer ──────────────────────────────────────────────────────────

  private updateHoldTimer(isValid: boolean, timestamp: number): void {
    if (!isValid) {
      // Reset on any invalid frame
      this.holdStartTime = null;
      this.lastValidTimestamp = null;
      this.currentHoldDuration = 0;
      return;
    }

    // Frame is valid
    if (this.holdStartTime === null) {
      // Start of a new hold period
      this.holdStartTime = timestamp;
      this.lastValidTimestamp = timestamp;
      this.currentHoldDuration = 0;
    } else {
      // Continue existing hold
      this.lastValidTimestamp = timestamp;
      this.currentHoldDuration = (timestamp - this.holdStartTime) / 1000; // ms to seconds
    }
  }
}

// ─── Exported Helpers for Testing ────────────────────────────────────────────

export {
  estimateTorsoAngle,
  angleDegrees,
  armBodyAngle,
  estimatePalmAngle,
  distance2D,
  CHECK_PRIORITY,
  CHECK_MESSAGES,
  POSE_LANDMARKS,
};
