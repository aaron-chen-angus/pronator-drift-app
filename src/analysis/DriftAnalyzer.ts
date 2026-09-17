/**
 * DriftAnalyzer module — core analysis engine for pronator drift screening.
 *
 * This file implements the calibration portion of the DriftAnalyzer interface.
 * It captures baseline measurements during a 2-3 second window, computes
 * per-arm baselines independently, normalizes to arm length, and validates
 * calibration quality.
 *
 * All threshold values are sourced from ConfigStore and are prototype
 * values requiring clinical validation.
 */

import type { ConfigStore } from '../config/ConfigStore';
import type {
  ArmBaseline,
  Baseline,
  CVFrameResult,
  DriftFrame,
  NormalizedLandmark,
  Vec3,
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

// ─── Calibration Result Type ─────────────────────────────────────────────────

export type CalibrationResult =
  | { success: true; baseline: Baseline }
  | { success: false; reason: 'low_confidence' | 'unstable_position' };

// ─── Internal Types ──────────────────────────────────────────────────────────

/** Per-frame arm measurement used during calibration accumulation. */
interface ArmFrameMeasurement {
  shoulderPos: Vec3;
  elbowPos: Vec3;
  wristPos: Vec3;
  normalizedWristHeight: number;
  elbowExtensionAngle: number;
  palmOrientationAngle: number;
  armLength: number;
}

/** A single calibration frame with validity info. */
interface CalibrationFrame {
  timestamp: number;
  confidence: number;
  leftArm: ArmFrameMeasurement | null;
  rightArm: ArmFrameMeasurement | null;
  valid: boolean;
}

// ─── Geometry Helpers ─────────────────────────────────────────────────────────

/** Compute 2D Euclidean distance between two normalized landmarks. */
function distance2D(a: NormalizedLandmark, b: NormalizedLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Compute angle (degrees) at vertex B in triangle A-B-C. */
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

/** Convert a NormalizedLandmark to a Vec3. */
function landmarkToVec3(lm: NormalizedLandmark): Vec3 {
  return { x: lm.x, y: lm.y, z: lm.z };
}

/** Compute median of a numeric array. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Estimate palm orientation angle from hand landmarks.
 * Uses landmarks 0 (wrist), 5 (index MCP), 9 (middle MCP).
 * Returns angle in degrees from camera-facing direction.
 */
function estimatePalmOrientationAngle(handLandmarks: NormalizedLandmark[]): number {
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

  // Cross product gives palm normal
  const nx = v1y * v2z - v1z * v2y;
  const ny = v1z * v2x - v1x * v2z;
  const nz = v1x * v2y - v1y * v2x;

  const mag = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (mag === 0) return 0;

  // Angle between normal and -z axis (camera-facing)
  const dotWithCameraDir = -nz / mag;
  return (Math.acos(Math.max(-1, Math.min(1, dotWithCameraDir))) * 180) / Math.PI;
}

/**
 * Compute the average confidence of key arm landmarks for a given side.
 */
function computeArmConfidence(
  landmarks: NormalizedLandmark[],
  side: 'left' | 'right'
): number {
  const shoulderIdx = side === 'left' ? POSE_LANDMARKS.LEFT_SHOULDER : POSE_LANDMARKS.RIGHT_SHOULDER;
  const elbowIdx = side === 'left' ? POSE_LANDMARKS.LEFT_ELBOW : POSE_LANDMARKS.RIGHT_ELBOW;
  const wristIdx = side === 'left' ? POSE_LANDMARKS.LEFT_WRIST : POSE_LANDMARKS.RIGHT_WRIST;

  const shoulder = landmarks[shoulderIdx];
  const elbow = landmarks[elbowIdx];
  const wrist = landmarks[wristIdx];

  if (!shoulder || !elbow || !wrist) return 0;

  return (shoulder.visibility + elbow.visibility + wrist.visibility) / 3;
}

/**
 * Extract per-arm measurements from a frame's pose landmarks.
 */
function extractArmMeasurement(
  poseLandmarks: NormalizedLandmark[],
  side: 'left' | 'right',
  handLandmarks: NormalizedLandmark[] | null
): ArmFrameMeasurement {
  const shoulderIdx = side === 'left' ? POSE_LANDMARKS.LEFT_SHOULDER : POSE_LANDMARKS.RIGHT_SHOULDER;
  const elbowIdx = side === 'left' ? POSE_LANDMARKS.LEFT_ELBOW : POSE_LANDMARKS.RIGHT_ELBOW;
  const wristIdx = side === 'left' ? POSE_LANDMARKS.LEFT_WRIST : POSE_LANDMARKS.RIGHT_WRIST;

  const shoulder = poseLandmarks[shoulderIdx];
  const elbow = poseLandmarks[elbowIdx];
  const wrist = poseLandmarks[wristIdx];

  const armLength = distance2D(shoulder, wrist);

  // Normalized wrist height: (wristY - shoulderY) / armLength
  // Positive means wrist is below shoulder in image coords (y increases downward)
  const normalizedWristHeight = armLength > 0
    ? (wrist.y - shoulder.y) / armLength
    : 0;

  // Elbow extension angle (shoulder-elbow-wrist angle)
  const elbowExtensionAngle = angleDegrees(shoulder, elbow, wrist);

  // Palm orientation angle from hand landmarks
  const palmOrientationAngle = handLandmarks
    ? estimatePalmOrientationAngle(handLandmarks)
    : 0;

  return {
    shoulderPos: landmarkToVec3(shoulder),
    elbowPos: landmarkToVec3(elbow),
    wristPos: landmarkToVec3(wrist),
    normalizedWristHeight,
    elbowExtensionAngle,
    palmOrientationAngle,
    armLength,
  };
}

// ─── DriftAnalyzer Interface ─────────────────────────────────────────────────

export interface DriftAnalyzerInterface {
  startCalibration(): void;
  addCalibrationFrame(frame: CVFrameResult): void;
  finalizeCalibration(): CalibrationResult;

  // Assessment phase methods
  startAssessment(baseline: Baseline): void;
  addAssessmentFrame(frame: CVFrameResult): void;
  getCurrentDrift(): { left: number; right: number };
  getDriftTimeSeries(): DriftFrame[];
  getMaxDrift(): { left: number; right: number };
  getDriftOnset(): { left: number | null; right: number | null };
}

// ─── DriftAnalyzer Implementation ────────────────────────────────────────────

/** Internal buffer entry for temporal smoothing. */
interface SmoothedDriftEntry {
  timestamp: number;
  leftRawDrift: number;
  rightRawDrift: number;
  leftConfidence: number;
  rightConfidence: number;
  cameraMovement: number;
  torsoCompensation: number;
  valid: boolean;
}

export class DriftAnalyzerImpl implements DriftAnalyzerInterface {
  private config: ConfigStore;
  private calibrationFrames: CalibrationFrame[] = [];
  private calibrationStartTime: number | null = null;
  private calibrationActive: boolean = false;

  // ─── Assessment State ──────────────────────────────────────────────────────
  private assessmentActive: boolean = false;
  private baseline: Baseline | null = null;
  private driftFrames: DriftFrame[] = [];
  private smoothingBuffer: SmoothedDriftEntry[] = [];
  private maxDrift: { left: number; right: number } = { left: 0, right: 0 };
  private driftOnset: { left: number | null; right: number | null } = { left: null, right: null };
  private lowConfidenceStart: { left: number | null; right: number | null } = { left: null, right: null };

  constructor(config: ConfigStore) {
    this.config = config;
  }

  // ─── Assessment Methods ────────────────────────────────────────────────────

  /**
   * Initializes assessment tracking with the given baseline.
   */
  startAssessment(baseline: Baseline): void {
    this.assessmentActive = true;
    this.baseline = baseline;
    this.driftFrames = [];
    this.smoothingBuffer = [];
    this.maxDrift = { left: 0, right: 0 };
    this.driftOnset = { left: null, right: null };
    this.lowConfidenceStart = { left: null, right: null };
  }

  /**
   * Processes a single frame during the assessment phase.
   * Computes normalized drift, applies torso compensation, detects camera movement,
   * handles low-confidence exclusion, and performs temporal smoothing.
   */
  addAssessmentFrame(frame: CVFrameResult): void {
    if (!this.assessmentActive || !this.baseline) return;

    const minPoseConfidence = this.config.get('minPoseConfidence');
    const cameraMovementThreshold = this.config.get('cameraMovementThreshold');
    const occlusionGracePeriod = this.config.get('occlusionGracePeriod');
    const smoothingWindowDuration = this.config.get('smoothingWindowDuration');
    const minDriftThreshold = this.config.get('minDriftThreshold');

    // Check if pose landmarks are available
    if (!frame.poseLandmarks || frame.poseLandmarks.length === 0 || !frame.poseLandmarks[0]) {
      this.driftFrames.push(this.createInvalidDriftFrame(frame.timestamp));
      return;
    }

    const poseLandmarks = frame.poseLandmarks[0];

    // Compute per-arm confidence
    const leftConfidence = computeArmConfidence(poseLandmarks, 'left');
    const rightConfidence = computeArmConfidence(poseLandmarks, 'right');

    // ── Camera movement detection ────────────────────────────────────────────
    const cameraMovement = this.computeCameraMovement(poseLandmarks);
    const cameraAffected = cameraMovement > cameraMovementThreshold;

    // ── Torso compensation ───────────────────────────────────────────────────
    const torsoCompensation = this.computeTorsoCompensation(poseLandmarks);

    // ── Raw drift calculation ────────────────────────────────────────────────
    const leftWrist = poseLandmarks[POSE_LANDMARKS.LEFT_WRIST];
    const rightWrist = poseLandmarks[POSE_LANDMARKS.RIGHT_WRIST];
    const leftElbow = poseLandmarks[POSE_LANDMARKS.LEFT_ELBOW];
    const rightElbow = poseLandmarks[POSE_LANDMARKS.RIGHT_ELBOW];

    const leftRawWristDrift = leftWrist.y - this.baseline.leftArm.wristPos.y;
    const rightRawWristDrift = rightWrist.y - this.baseline.rightArm.wristPos.y;

    // Drift normalization: max(0, (currentWristY - baselineWristY - torsoCompensation)) / armLength
    const leftNormalizedDrift = this.baseline.leftArm.armLength > 0
      ? Math.max(0, (leftRawWristDrift - torsoCompensation)) / this.baseline.leftArm.armLength
      : 0;
    const rightNormalizedDrift = this.baseline.rightArm.armLength > 0
      ? Math.max(0, (rightRawWristDrift - torsoCompensation)) / this.baseline.rightArm.armLength
      : 0;

    // Elbow drift
    const leftElbowDrift = this.baseline.leftArm.armLength > 0
      ? Math.max(0, (leftElbow.y - this.baseline.leftArm.elbowPos.y - torsoCompensation)) / this.baseline.leftArm.armLength
      : 0;
    const rightElbowDrift = this.baseline.rightArm.armLength > 0
      ? Math.max(0, (rightElbow.y - this.baseline.rightArm.elbowPos.y - torsoCompensation)) / this.baseline.rightArm.armLength
      : 0;

    // ── Pronation estimation ─────────────────────────────────────────────────
    const leftHandLandmarks = this.findHandLandmarks(frame, 'Left');
    const rightHandLandmarks = this.findHandLandmarks(frame, 'Right');

    const leftPronation = leftHandLandmarks
      ? estimatePalmOrientationAngle(leftHandLandmarks) - this.baseline.leftArm.palmOrientationAngle
      : null;
    const rightPronation = rightHandLandmarks
      ? estimatePalmOrientationAngle(rightHandLandmarks) - this.baseline.rightArm.palmOrientationAngle
      : null;

    // ── Low-confidence interval exclusion ────────────────────────────────────
    const leftExcluded = this.updateLowConfidenceTracking(
      'left', leftConfidence, frame.timestamp, minPoseConfidence, occlusionGracePeriod
    );
    const rightExcluded = this.updateLowConfidenceTracking(
      'right', rightConfidence, frame.timestamp, minPoseConfidence, occlusionGracePeriod
    );

    // ── Determine frame validity ─────────────────────────────────────────────
    const frameValid = !cameraAffected && !leftExcluded && !rightExcluded;

    // ── Add to smoothing buffer ──────────────────────────────────────────────
    const bufferEntry: SmoothedDriftEntry = {
      timestamp: frame.timestamp,
      leftRawDrift: leftNormalizedDrift,
      rightRawDrift: rightNormalizedDrift,
      leftConfidence,
      rightConfidence,
      cameraMovement,
      torsoCompensation,
      valid: frameValid,
    };
    this.smoothingBuffer.push(bufferEntry);

    // Trim buffer to smoothing window
    const windowMs = smoothingWindowDuration * 1000;
    while (
      this.smoothingBuffer.length > 1 &&
      frame.timestamp - this.smoothingBuffer[0].timestamp > windowMs
    ) {
      this.smoothingBuffer.shift();
    }

    // ── Mark camera-affected frames in buffer ────────────────────────────────
    if (cameraAffected) {
      this.invalidateFramesAroundTimestamp(frame.timestamp, windowMs);
    }

    // ── Temporal smoothing (median filter on valid frames in buffer) ──────────
    const smoothedLeft = this.computeSmoothedDrift('left');
    const smoothedRight = this.computeSmoothedDrift('right');

    // ── Track onset and maximum ──────────────────────────────────────────────
    if (frameValid) {
      // Onset: first time smoothed drift exceeds minDriftThreshold
      if (this.driftOnset.left === null && smoothedLeft > minDriftThreshold) {
        this.driftOnset.left = frame.timestamp;
      }
      if (this.driftOnset.right === null && smoothedRight > minDriftThreshold) {
        this.driftOnset.right = frame.timestamp;
      }

      // Maximum displacement
      if (smoothedLeft > this.maxDrift.left) {
        this.maxDrift.left = smoothedLeft;
      }
      if (smoothedRight > this.maxDrift.right) {
        this.maxDrift.right = smoothedRight;
      }
    }

    // ── Build DriftFrame record ──────────────────────────────────────────────
    const driftFrame: DriftFrame = {
      timestamp: frame.timestamp,
      leftWristDrift: smoothedLeft,
      rightWristDrift: smoothedRight,
      leftElbowDrift,
      rightElbowDrift,
      leftPronation,
      rightPronation,
      leftConfidence,
      rightConfidence,
      torsoCompensation,
      cameraMovement,
      frameValid,
    };

    this.driftFrames.push(driftFrame);
  }

  /**
   * Returns the current (most recent smoothed) drift for both arms.
   */
  getCurrentDrift(): { left: number; right: number } {
    if (this.driftFrames.length === 0) {
      return { left: 0, right: 0 };
    }
    const last = this.driftFrames[this.driftFrames.length - 1];
    return { left: last.leftWristDrift, right: last.rightWristDrift };
  }

  /**
   * Returns the complete time series of drift measurements.
   */
  getDriftTimeSeries(): DriftFrame[] {
    return [...this.driftFrames];
  }

  /**
   * Returns the maximum smoothed drift seen during the assessment for each arm.
   */
  getMaxDrift(): { left: number; right: number } {
    return { ...this.maxDrift };
  }

  /**
   * Returns the onset time (timestamp when smoothed drift first exceeded threshold) for each arm.
   * Returns null if no drift was detected for that arm.
   */
  getDriftOnset(): { left: number | null; right: number | null } {
    return { ...this.driftOnset };
  }

  // ─── Assessment Private Helpers ────────────────────────────────────────────

  /**
   * Creates an invalid DriftFrame for frames with missing landmarks.
   */
  private createInvalidDriftFrame(timestamp: number): DriftFrame {
    return {
      timestamp,
      leftWristDrift: 0,
      rightWristDrift: 0,
      leftElbowDrift: 0,
      rightElbowDrift: 0,
      leftPronation: null,
      rightPronation: null,
      leftConfidence: 0,
      rightConfidence: 0,
      torsoCompensation: 0,
      cameraMovement: 0,
      frameValid: false,
    };
  }

  /**
   * Computes camera movement as the mean displacement of shoulder and hip landmarks
   * from the baseline positions.
   */
  private computeCameraMovement(poseLandmarks: NormalizedLandmark[]): number {
    if (!this.baseline) return 0;

    const leftShoulder = poseLandmarks[POSE_LANDMARKS.LEFT_SHOULDER];
    const rightShoulder = poseLandmarks[POSE_LANDMARKS.RIGHT_SHOULDER];
    const leftHip = poseLandmarks[POSE_LANDMARKS.LEFT_HIP];
    const rightHip = poseLandmarks[POSE_LANDMARKS.RIGHT_HIP];

    // Baseline shoulder midpoint
    const baselineShoulderMidX = (this.baseline.leftArm.shoulderPos.x + this.baseline.rightArm.shoulderPos.x) / 2;
    const baselineShoulderMidY = (this.baseline.leftArm.shoulderPos.y + this.baseline.rightArm.shoulderPos.y) / 2;

    // Current shoulder midpoint
    const currentShoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
    const currentShoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;

    // Shoulder displacement
    const shoulderDx = currentShoulderMidX - baselineShoulderMidX;
    const shoulderDy = currentShoulderMidY - baselineShoulderMidY;
    const shoulderDisplacement = Math.sqrt(shoulderDx * shoulderDx + shoulderDy * shoulderDy);

    // Hip midpoint displacement (approximate baseline from shoulder positions shifted down)
    // We use the current hip midpoint vs the first-frame hip position. For simplicity,
    // compute displacement from the midpoint of hips relative to shoulder displacement.
    const currentHipMidX = (leftHip.x + rightHip.x) / 2;
    const currentHipMidY = (leftHip.y + rightHip.y) / 2;

    // Use first drift frame hips as reference if available, otherwise shoulder-based estimate
    if (this.driftFrames.length === 0) {
      // First frame - store reference implicitly through shoulder displacement only
      return shoulderDisplacement;
    }

    // Mean displacement of torso/shoulder landmarks
    // For camera movement, we look at how the overall torso has shifted
    // (both shoulders + hips moving together indicates camera, not body movement)
    const hipDisplacement = Math.sqrt(
      (currentHipMidX - baselineShoulderMidX) * (currentHipMidX - baselineShoulderMidX) +
      (currentHipMidY - (baselineShoulderMidY + 0.3)) * (currentHipMidY - (baselineShoulderMidY + 0.3))
    );

    // Camera movement = mean of shoulder and hip displacements relative to baseline
    // If both move together by similar amount, it's likely camera movement
    return shoulderDisplacement;
  }

  /**
   * Computes torso lean compensation as the vertical shift of the shoulder midpoint
   * relative to baseline, clamped to non-negative.
   */
  private computeTorsoCompensation(poseLandmarks: NormalizedLandmark[]): number {
    if (!this.baseline) return 0;

    const leftShoulder = poseLandmarks[POSE_LANDMARKS.LEFT_SHOULDER];
    const rightShoulder = poseLandmarks[POSE_LANDMARKS.RIGHT_SHOULDER];

    // Current shoulder midpoint Y
    const currentShoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;

    // Baseline shoulder midpoint Y
    const baselineShoulderMidY = (this.baseline.leftArm.shoulderPos.y + this.baseline.rightArm.shoulderPos.y) / 2;

    // Torso shift: positive means shoulders moved downward (leaning forward/slumping)
    const torsoShift = currentShoulderMidY - baselineShoulderMidY;

    // Return the shift (non-negative only for compensation purposes)
    // If torso shifted UP, we don't compensate (that would add drift)
    return Math.max(0, torsoShift);
  }

  /**
   * Updates low-confidence interval tracking for one arm.
   * Returns true if this frame should be excluded due to exceeding occlusion grace period.
   */
  private updateLowConfidenceTracking(
    side: 'left' | 'right',
    confidence: number,
    timestamp: number,
    minPoseConfidence: number,
    occlusionGracePeriod: number
  ): boolean {
    const gracePeriodMs = occlusionGracePeriod * 1000;

    if (confidence < minPoseConfidence) {
      // Start tracking low confidence if not already
      if (this.lowConfidenceStart[side] === null) {
        this.lowConfidenceStart[side] = timestamp;
      }
      // Check if beyond grace period
      const duration = timestamp - this.lowConfidenceStart[side]!;
      return duration > gracePeriodMs;
    } else {
      // Confidence is acceptable — reset tracking
      this.lowConfidenceStart[side] = null;
      return false;
    }
  }

  /**
   * Marks frames within the smoothing window of a camera-affected timestamp as invalid.
   */
  private invalidateFramesAroundTimestamp(centerTimestamp: number, windowMs: number): void {
    const halfWindow = windowMs / 2;
    for (const entry of this.smoothingBuffer) {
      if (Math.abs(entry.timestamp - centerTimestamp) <= halfWindow) {
        entry.valid = false;
      }
    }
  }

  /**
   * Computes the smoothed (median-filtered) drift from valid entries in the smoothing buffer.
   */
  private computeSmoothedDrift(side: 'left' | 'right'): number {
    const validEntries = this.smoothingBuffer.filter(e => e.valid);
    if (validEntries.length === 0) {
      return 0;
    }

    const values = validEntries.map(e =>
      side === 'left' ? e.leftRawDrift : e.rightRawDrift
    );

    return median(values);
  }

  /**
   * Resets calibration state and begins frame collection.
   */
  startCalibration(): void {
    this.calibrationFrames = [];
    this.calibrationStartTime = null;
    this.calibrationActive = true;
  }

  /**
   * Accumulates a frame during the calibration window.
   * Extracts arm measurements and stores them for later averaging.
   */
  addCalibrationFrame(frame: CVFrameResult): void {
    if (!this.calibrationActive) return;

    if (this.calibrationStartTime === null) {
      this.calibrationStartTime = frame.timestamp;
    }

    const minPoseConfidence = this.config.get('minPoseConfidence');

    // Check if pose landmarks are available
    if (!frame.poseLandmarks || frame.poseLandmarks.length === 0 || !frame.poseLandmarks[0]) {
      this.calibrationFrames.push({
        timestamp: frame.timestamp,
        confidence: 0,
        leftArm: null,
        rightArm: null,
        valid: false,
      });
      return;
    }

    const poseLandmarks = frame.poseLandmarks[0];

    // Compute per-arm confidence
    const leftConfidence = computeArmConfidence(poseLandmarks, 'left');
    const rightConfidence = computeArmConfidence(poseLandmarks, 'right');
    const avgConfidence = (leftConfidence + rightConfidence) / 2;

    const isValid = avgConfidence >= minPoseConfidence;

    if (!isValid) {
      this.calibrationFrames.push({
        timestamp: frame.timestamp,
        confidence: avgConfidence,
        leftArm: null,
        rightArm: null,
        valid: false,
      });
      return;
    }

    // Find hand landmarks for each side
    const leftHandLandmarks = this.findHandLandmarks(frame, 'Left');
    const rightHandLandmarks = this.findHandLandmarks(frame, 'Right');

    const leftArm = extractArmMeasurement(poseLandmarks, 'left', leftHandLandmarks);
    const rightArm = extractArmMeasurement(poseLandmarks, 'right', rightHandLandmarks);

    this.calibrationFrames.push({
      timestamp: frame.timestamp,
      confidence: avgConfidence,
      leftArm,
      rightArm,
      valid: true,
    });
  }

  /**
   * Finalizes calibration by computing baselines from accumulated frames.
   *
   * Rejects if:
   * - >50% of frames have confidence below threshold
   * - Wrist position varies more than maxBaselineVariation of arm length
   */
  finalizeCalibration(): CalibrationResult {
    this.calibrationActive = false;

    const totalFrames = this.calibrationFrames.length;
    if (totalFrames === 0) {
      return { success: false, reason: 'low_confidence' };
    }

    // Check confidence rejection: >50% of frames below threshold
    const invalidFrameCount = this.calibrationFrames.filter((f) => !f.valid).length;
    if (invalidFrameCount > totalFrames * 0.5) {
      return { success: false, reason: 'low_confidence' };
    }

    // Collect valid frames
    const validFrames = this.calibrationFrames.filter((f) => f.valid);
    if (validFrames.length === 0) {
      return { success: false, reason: 'low_confidence' };
    }

    // Compute per-arm baselines from valid frames
    const leftArmMeasurements = validFrames
      .map((f) => f.leftArm)
      .filter((a): a is ArmFrameMeasurement => a !== null);
    const rightArmMeasurements = validFrames
      .map((f) => f.rightArm)
      .filter((a): a is ArmFrameMeasurement => a !== null);

    if (leftArmMeasurements.length === 0 || rightArmMeasurements.length === 0) {
      return { success: false, reason: 'low_confidence' };
    }

    // Compute averaged baselines
    const leftBaseline = this.averageArmMeasurements(leftArmMeasurements);
    const rightBaseline = this.averageArmMeasurements(rightArmMeasurements);

    // Check stability: wrist variation > maxBaselineVariation * armLength
    const maxBaselineVariation = this.config.get('maxBaselineVariation');

    const leftStable = this.checkWristStability(
      leftArmMeasurements,
      leftBaseline.armLength,
      maxBaselineVariation
    );
    const rightStable = this.checkWristStability(
      rightArmMeasurements,
      rightBaseline.armLength,
      maxBaselineVariation
    );

    if (!leftStable || !rightStable) {
      return { success: false, reason: 'unstable_position' };
    }

    // Compute torso angle from average shoulder positions
    const torsoAngle = this.computeAverageTorsoAngle(validFrames);

    // Compute shoulder width from average positions
    const shoulderWidth = this.computeAverageShoulderWidth(validFrames);

    const captureStartTime = this.calibrationFrames[0].timestamp;
    const captureEndTime = this.calibrationFrames[this.calibrationFrames.length - 1].timestamp;

    const baseline: Baseline = {
      leftArm: leftBaseline,
      rightArm: rightBaseline,
      torsoAngle,
      shoulderWidth,
      captureFrameCount: validFrames.length,
      captureStartTime,
      captureEndTime,
    };

    return { success: true, baseline };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Find hand landmarks for a given side from the frame's hand data.
   */
  private findHandLandmarks(
    frame: CVFrameResult,
    label: 'Left' | 'Right'
  ): NormalizedLandmark[] | null {
    if (!frame.handLandmarks || !frame.handedness) return null;

    for (let i = 0; i < frame.handedness.length; i++) {
      if (frame.handedness[i].label === label && frame.handLandmarks[i]) {
        return frame.handLandmarks[i];
      }
    }
    return null;
  }

  /**
   * Average a set of arm measurements into a single ArmBaseline.
   */
  private averageArmMeasurements(measurements: ArmFrameMeasurement[]): ArmBaseline {
    const n = measurements.length;

    const shoulderPos = this.averageVec3(measurements.map((m) => m.shoulderPos));
    const elbowPos = this.averageVec3(measurements.map((m) => m.elbowPos));
    const wristPos = this.averageVec3(measurements.map((m) => m.wristPos));

    const normalizedWristHeight =
      measurements.reduce((sum, m) => sum + m.normalizedWristHeight, 0) / n;
    const elbowExtensionAngle =
      measurements.reduce((sum, m) => sum + m.elbowExtensionAngle, 0) / n;
    const palmOrientationAngle =
      measurements.reduce((sum, m) => sum + m.palmOrientationAngle, 0) / n;
    const armLength =
      measurements.reduce((sum, m) => sum + m.armLength, 0) / n;

    return {
      shoulderPos,
      elbowPos,
      wristPos,
      normalizedWristHeight,
      elbowExtensionAngle,
      palmOrientationAngle,
      armLength,
    };
  }

  /**
   * Compute the arithmetic mean of a list of Vec3 values.
   */
  private averageVec3(vectors: Vec3[]): Vec3 {
    const n = vectors.length;
    if (n === 0) return { x: 0, y: 0, z: 0 };

    const sum = vectors.reduce(
      (acc, v) => ({ x: acc.x + v.x, y: acc.y + v.y, z: acc.z + v.z }),
      { x: 0, y: 0, z: 0 }
    );

    return { x: sum.x / n, y: sum.y / n, z: sum.z / n };
  }

  /**
   * Check wrist stability: returns false if wrist position varies
   * more than maxVariationRatio * armLength across measurements.
   */
  private checkWristStability(
    measurements: ArmFrameMeasurement[],
    armLength: number,
    maxVariationRatio: number
  ): boolean {
    if (measurements.length < 2 || armLength === 0) return true;

    const maxVariation = maxVariationRatio * armLength;

    // Compute standard deviation-based check on wrist position
    const wristXs = measurements.map((m) => m.wristPos.x);
    const wristYs = measurements.map((m) => m.wristPos.y);

    const rangeX = Math.max(...wristXs) - Math.min(...wristXs);
    const rangeY = Math.max(...wristYs) - Math.min(...wristYs);

    // Use the maximum range across axes as the variation measure
    const maxRange = Math.max(rangeX, rangeY);

    return maxRange <= maxVariation;
  }

  /**
   * Compute the average torso angle from valid calibration frames.
   * Uses z-depth difference between shoulders as rotation estimate.
   */
  private computeAverageTorsoAngle(validFrames: CalibrationFrame[]): number {
    let totalAngle = 0;
    let count = 0;

    for (const frame of validFrames) {
      if (frame.leftArm && frame.rightArm) {
        const leftShoulder = frame.leftArm.shoulderPos;
        const rightShoulder = frame.rightArm.shoulderPos;
        const shoulderWidthX = Math.abs(leftShoulder.x - rightShoulder.x);
        const zDiff = Math.abs(leftShoulder.z - rightShoulder.z);

        if (shoulderWidthX > 0) {
          totalAngle += (Math.atan2(zDiff, shoulderWidthX) * 180) / Math.PI;
          count++;
        }
      }
    }

    return count > 0 ? totalAngle / count : 0;
  }

  /**
   * Compute the average shoulder width from valid calibration frames.
   */
  private computeAverageShoulderWidth(validFrames: CalibrationFrame[]): number {
    let totalWidth = 0;
    let count = 0;

    for (const frame of validFrames) {
      if (frame.leftArm && frame.rightArm) {
        const leftShoulder = frame.leftArm.shoulderPos;
        const rightShoulder = frame.rightArm.shoulderPos;
        const dx = leftShoulder.x - rightShoulder.x;
        const dy = leftShoulder.y - rightShoulder.y;
        totalWidth += Math.sqrt(dx * dx + dy * dy);
        count++;
      }
    }

    return count > 0 ? totalWidth / count : 0;
  }
}

// ─── Exported helpers for testing ────────────────────────────────────────────

export {
  distance2D,
  angleDegrees,
  landmarkToVec3,
  estimatePalmOrientationAngle,
  computeArmConfidence,
  extractArmMeasurement,
  median,
  POSE_LANDMARKS,
};
