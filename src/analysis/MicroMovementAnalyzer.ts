/**
 * MicroMovementAnalyzer module — the new aggregation analysis module for the
 * pronator drift screening pipeline.
 *
 * This module captures all available pose and hand landmarks for the assessed arm
 * on a per-frame basis during the 30-second timed assessment, and (in later tasks)
 * derives drift, joint-angle, rotational, tremor/stability, and finger-level
 * indicators plus per-indicator summary statistics.
 *
 * This file implements Task 2.1: per-frame landmark capture via `start`/`addFrame`
 * and a stub `finalize()`. Subsequent tasks (3.x–6.x) fill in indicator computation
 * using the captured-frame structure defined here.
 *
 * All threshold values are sourced from ConfigStore and are prototype values
 * requiring clinical validation.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

import type { ConfigStore } from '../config/ConfigStore';
import { computePalmAngle } from './PalmOrientationEstimator';
import type {
  Baseline,
  CVFrameResult,
  Handedness,
  IndicatorKey,
  IndicatorSample,
  Landmark,
  MicroMovementIndicators,
  NormalizedLandmark,
  SummaryStatistic,
  TimeSeriesIndicator,
} from '../types';

// ─── MediaPipe Pose Landmark Indices ─────────────────────────────────────────
// Reused from the existing DriftAnalyzer convention (left arm = odd indices).

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

/** The number of hand landmarks MediaPipe Hand Landmarker produces per hand. */
const HAND_LANDMARK_COUNT = 21;

// ─── Captured-frame data model ───────────────────────────────────────────────

/**
 * A captured pose landmark for the assessed arm, retaining the source position
 * (normalized image coordinates) and the visibility confidence used downstream.
 */
export interface CapturedPoseLandmark {
  x: number;
  y: number;
  z: number;
  /** Visibility confidence, 0.0–1.0, used in subsequent indicator computation (Req 2.5). */
  visibility: number;
}

/**
 * World-space captured landmark (meters) for the assessed arm, when world
 * landmarks are present in the frame (Req 2.2).
 */
export interface CapturedWorldLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

/**
 * A single captured hand landmark (one of the 21 MediaPipe hand points),
 * retaining position and visibility confidence.
 */
export interface CapturedHandLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

/**
 * A single frame captured by the analyzer for the assessed arm.
 *
 * This is the internal record subsequent tasks (3.x–6.x) consume to compute
 * joint angles, rotation, drift, tremor/stability, and finger-level indicators.
 */
export interface CapturedFrame {
  /** Frame timestamp in milliseconds (raw, as delivered) (Req 2.5). */
  timestamp: number;
  /** Timestamp relative to assessment start in milliseconds. */
  relativeTimestamp: number;

  /**
   * When false, the frame lacked assessed-arm pose landmarks and is excluded
   * from position-based indicator computation (Req 2.6).
   */
  hasPose: boolean;

  /** Assessed-arm shoulder (normalized), null when pose is missing. */
  shoulder: CapturedPoseLandmark | null;
  /** Assessed-arm elbow (normalized), null when pose is missing. */
  elbow: CapturedPoseLandmark | null;
  /** Assessed-arm wrist (normalized), null when pose is missing. */
  wrist: CapturedPoseLandmark | null;
  /** Assessed-arm hip (normalized), null when pose is missing. */
  hip: CapturedPoseLandmark | null;

  /** Assessed-arm world shoulder (meters), null when world landmarks absent. */
  worldShoulder: CapturedWorldLandmark | null;
  /** Assessed-arm world elbow (meters), null when world landmarks absent. */
  worldElbow: CapturedWorldLandmark | null;
  /** Assessed-arm world wrist (meters), null when world landmarks absent. */
  worldWrist: CapturedWorldLandmark | null;

  /**
   * All 21 hand landmarks for the assessed arm, associated by handedness label
   * (Req 2.3, 2.4). null when no matching hand was present in the frame.
   */
  handLandmarks: CapturedHandLandmark[] | null;

  /**
   * Average visibility confidence of the assessed-arm shoulder/elbow/wrist
   * pose landmarks (0 when pose is missing) — a convenient per-frame confidence
   * used for low-confidence handling in later tasks (Req 2.5).
   */
  poseConfidence: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve the pose landmark indices for the assessed arm. */
function poseIndicesFor(assessedArm: 'left' | 'right'): {
  shoulder: number;
  elbow: number;
  wrist: number;
  hip: number;
} {
  if (assessedArm === 'left') {
    return {
      shoulder: POSE_LANDMARKS.LEFT_SHOULDER,
      elbow: POSE_LANDMARKS.LEFT_ELBOW,
      wrist: POSE_LANDMARKS.LEFT_WRIST,
      hip: POSE_LANDMARKS.LEFT_HIP,
    };
  }
  return {
    shoulder: POSE_LANDMARKS.RIGHT_SHOULDER,
    elbow: POSE_LANDMARKS.RIGHT_ELBOW,
    wrist: POSE_LANDMARKS.RIGHT_WRIST,
    hip: POSE_LANDMARKS.RIGHT_HIP,
  };
}

/** The handedness label corresponding to the assessed arm. */
function handednessLabelFor(assessedArm: 'left' | 'right'): 'Left' | 'Right' {
  return assessedArm === 'left' ? 'Left' : 'Right';
}

/** Copy a normalized landmark into a captured pose landmark, preserving visibility. */
function captureNormalized(lm: NormalizedLandmark): CapturedPoseLandmark {
  return { x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility };
}

/** Copy a world landmark into a captured world landmark, preserving visibility. */
function captureWorld(lm: Landmark): CapturedWorldLandmark {
  return { x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility };
}

// ─── Geometry helpers (Task 3.1) ─────────────────────────────────────────────

/** Minimal 2D point shape used by the angle helpers. */
interface Point2D {
  x: number;
  y: number;
}

/**
 * Compute the interior angle (degrees) at vertex `b` in the triangle a-b-c,
 * using the 2D (x, y) projection consistent with the existing DriftAnalyzer /
 * PositionValidator convention. Result is clamped to [0, 180]. Returns null when
 * either arm has zero length (degenerate; angle undefined).
 */
function angleAtVertexDegrees(a: Point2D, b: Point2D, c: Point2D): number | null {
  const baX = a.x - b.x;
  const baY = a.y - b.y;
  const bcX = c.x - b.x;
  const bcY = c.y - b.y;

  const magBA = Math.sqrt(baX * baX + baY * baY);
  const magBC = Math.sqrt(bcX * bcX + bcY * bcY);
  if (magBA === 0 || magBC === 0) return null;

  const dot = baX * bcX + baY * bcY;
  const cosAngle = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
  return (Math.acos(cosAngle) * 180) / Math.PI;
}

/**
 * Compute the Elbow_Flexion_Angle (degrees) for a captured frame: the
 * shoulder-elbow-wrist angle. Returns null when the required landmarks are
 * missing or the geometry is degenerate (Req 4.1, 4.6).
 */
function computeElbowFlexionAngle(frame: CapturedFrame): number | null {
  if (!frame.shoulder || !frame.elbow || !frame.wrist) return null;
  return angleAtVertexDegrees(frame.shoulder, frame.elbow, frame.wrist);
}

/**
 * Compute the Arm_To_Torso_Angle (degrees) for a captured frame: the angle
 * between the upper arm (shoulder->elbow) and the torso midline (shoulder->hip),
 * measured at the shoulder. Returns null when the required landmarks are missing
 * or the geometry is degenerate (Req 4.2, 4.6).
 */
function computeArmToTorsoAngle(frame: CapturedFrame): number | null {
  if (!frame.shoulder || !frame.elbow || !frame.hip) return null;
  // Angle at the shoulder between the elbow direction and the hip direction.
  return angleAtVertexDegrees(frame.elbow, frame.shoulder, frame.hip);
}

// ─── Tremor / stability signal helpers (Task 5.1) ────────────────────────────

/** Fingertip hand-landmark indices (thumb/index/middle/ring/pinky TIPs). */
const FINGERTIP_INDICES = [4, 8, 12, 16, 20] as const;

/**
 * Metacarpophalangeal (MCP) hand-landmark indices for the four fingers used by
 * the finger-spread indicator (index/middle/ring/pinky MCPs). The thumb CMC is
 * excluded so spread reflects the finger fan across the palm (Req 7.2).
 */
const MCP_INDICES = [5, 9, 13, 17] as const;

/**
 * Per-finger [MCP, TIP] index pairs (index/middle/ring/pinky) used by the
 * finger-curl indicator. The thumb is excluded because its curl geometry differs
 * from the fingers and is noisier from a side view (Req 7.1).
 */
const FINGER_MCP_TIP_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [5, 8],
  [9, 12],
  [13, 16],
  [17, 20],
] as const;

/** Euclidean distance between two hand landmarks in the 2D (x, y) projection. */
function landmarkDistance2D(
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Finger-curl scalar for a captured hand (Req 7.1).
 *
 * Defined so that a more-flexed (curled) hand yields a value no smaller than a
 * more-extended hand (Property 15). For each finger we take the wrist(0)->TIP
 * distance normalized by the wrist(0)->MCP distance (a scale-invariant reach
 * ratio): an extended finger reaches far past its MCP (large ratio) while a
 * curled finger's tip sits near or behind its MCP (small ratio). Curl is defined
 * as `1 - meanReachRatio`, which increases monotonically as fingers curl. Fingers
 * whose MCP coincides with the wrist (degenerate) are skipped; when no finger is
 * usable the curl is 0.
 */
function computeFingerCurl(hand: CapturedHandLandmark[]): number {
  const wrist = hand[0];
  const ratios: number[] = [];
  for (const [mcpIdx, tipIdx] of FINGER_MCP_TIP_PAIRS) {
    const mcp = hand[mcpIdx];
    const tip = hand[tipIdx];
    if (!mcp || !tip) continue;
    const mcpReach = landmarkDistance2D(wrist, mcp);
    if (mcpReach === 0) continue; // degenerate finger base
    const tipReach = landmarkDistance2D(wrist, tip);
    ratios.push(tipReach / mcpReach);
  }
  if (ratios.length === 0) return 0;
  const meanReach = ratios.reduce((s, v) => s + v, 0) / ratios.length;
  return 1 - meanReach;
}

/**
 * Finger-spread scalar for a captured hand (Req 7.2).
 *
 * Defined so that MCP landmarks spread farther apart yield a value no smaller than
 * MCP landmarks brought closer together (Property 15). Computed as the mean
 * pairwise distance between adjacent finger MCPs (index->middle->ring->pinky),
 * normalized by the wrist(0)->middle-MCP(9) palm length so the metric is
 * scale-invariant. Larger = more spread.
 */
function computeFingerSpread(hand: CapturedHandLandmark[]): number {
  const wrist = hand[0];
  const middleMcp = hand[MCP_INDICES[1]];
  const palmLength = middleMcp ? landmarkDistance2D(wrist, middleMcp) : 0;

  let total = 0;
  let count = 0;
  for (let i = 1; i < MCP_INDICES.length; i++) {
    const prev = hand[MCP_INDICES[i - 1]];
    const cur = hand[MCP_INDICES[i]];
    if (!prev || !cur) continue;
    total += landmarkDistance2D(prev, cur);
    count += 1;
  }
  if (count === 0) return 0;
  const meanAdjacent = total / count;
  return palmLength > 0 ? meanAdjacent / palmLength : meanAdjacent;
}

/** Population standard deviation of a numeric series (0 for <2 samples). */
function populationStd(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance =
    values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
  return Math.sqrt(variance);
}

/**
 * High-pass (detrend) a series by subtracting a centered moving average, leaving
 * the high-frequency residual. `window` is the number of samples in the moving
 * average window (clamped to an odd value >= 1). When the window covers the whole
 * series, the residual reduces to subtracting the mean.
 *
 * A constant (non-oscillating) input yields an all-zero residual, satisfying the
 * "constant series -> ~0 amplitude" expectation of Property 11.
 */
function highPassResidual(values: number[], window: number): number[] {
  const n = values.length;
  if (n === 0) return [];
  // Clamp window to an odd number within [1, n].
  let w = Math.max(1, Math.min(window, n));
  if (w % 2 === 0) w += 1;
  if (w > n) w = n % 2 === 0 ? n - 1 : n;
  if (w < 1) w = 1;

  const half = Math.floor(w / 2);
  const residual: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += values[j];
    const avg = sum / (hi - lo + 1);
    residual[i] = values[i] - avg;
  }
  return residual;
}

/**
 * Estimate the dominant oscillation frequency (Hz) of a residual series via a
 * discrete periodogram (naive DFT over candidate frequencies up to Nyquist).
 *
 * Returns the peak frequency together with whether the reported frequency was
 * capped at Nyquist / the sampling is inadequate (bandwidth-limited).
 *
 * `sampleRate` is the effective sampling rate in Hz. The reported frequency is
 * always <= Nyquist = sampleRate / 2 (Property 14, Req 6.5).
 */
function dominantFrequencyHz(
  residual: number[],
  sampleRate: number
): { frequency: number; bandwidthLimited: boolean } {
  const n = residual.length;
  const nyquist = sampleRate > 0 ? sampleRate / 2 : 0;

  // Inadequate sampling: too few samples or no positive rate -> cannot resolve a
  // frequency. Report 0 and mark bandwidth-limited (Req 6.5).
  if (n < 4 || sampleRate <= 0) {
    return { frequency: 0, bandwidthLimited: true };
  }

  // If the residual carries no energy, there is no oscillation to report.
  const energy = residual.reduce((s, v) => s + v * v, 0);
  if (energy === 0) {
    return { frequency: 0, bandwidthLimited: false };
  }

  // Evaluate the periodogram over a set of candidate frequencies from the lowest
  // resolvable bin (sampleRate / n) up to just below Nyquist. Use the standard
  // DFT bin spacing so a known sinusoid sampled above Nyquist is recovered.
  const binCount = Math.floor(n / 2);
  let bestFreq = 0;
  let bestPower = -Infinity;
  for (let k = 1; k <= binCount; k++) {
    const freq = (k * sampleRate) / n;
    if (freq > nyquist) break;
    let re = 0;
    let im = 0;
    const omega = (2 * Math.PI * k) / n;
    for (let t = 0; t < n; t++) {
      const angle = omega * t;
      re += residual[t] * Math.cos(angle);
      im -= residual[t] * Math.sin(angle);
    }
    const power = re * re + im * im;
    if (power > bestPower) {
      bestPower = power;
      bestFreq = freq;
    }
  }

  // Cap at Nyquist (defensive; loop already excludes freq > nyquist).
  let bandwidthLimited = false;
  let frequency = bestFreq;
  if (frequency >= nyquist) {
    frequency = nyquist;
    bandwidthLimited = true;
  }

  return { frequency, bandwidthLimited };
}

/**
 * Bounded stability metric derived from the inverse of oscillation amplitude.
 * Maps amplitude in [0, ∞) to (0, 1], monotonically decreasing with amplitude
 * (Property 13, Req 6.4): stability = 1 / (1 + amplitude).
 */
function stabilityFromAmplitude(amplitude: number): number {
  const amp = amplitude > 0 ? amplitude : 0;
  return 1 / (1 + amp);
}

/** Compute mean/max/std over a set of numeric values (population std). */
function summarize(values: number[]): SummaryStatistic {
  const validFrameCount = values.length;
  if (validFrameCount === 0) {
    return { mean: null, max: null, standardDeviation: null, validFrameCount: 0 };
  }
  const mean = values.reduce((sum, v) => sum + v, 0) / validFrameCount;
  const max = values.reduce((m, v) => (v > m ? v : m), values[0]);
  let standardDeviation: number | null = null;
  if (validFrameCount >= 2) {
    const variance =
      values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / validFrameCount;
    standardDeviation = Math.sqrt(variance);
  }
  return { mean, max, standardDeviation, validFrameCount };
}

/**
 * Find the hand landmarks matching the assessed-arm handedness label.
 * Returns null if hand data or a matching label is unavailable (Req 2.4).
 */
function findAssessedHand(
  frame: CVFrameResult,
  label: 'Left' | 'Right'
): NormalizedLandmark[] | null {
  const hands = frame.handLandmarks;
  const handedness = frame.handedness;
  if (!hands || !handedness) return null;

  for (let i = 0; i < handedness.length; i++) {
    const h: Handedness | undefined = handedness[i];
    if (h && h.label === label && hands[i]) {
      return hands[i];
    }
  }
  return null;
}

/** Build an empty (not-measured) time-series indicator placeholder for the stub finalize. */
function emptyIndicator(
  key: IndicatorKey,
  unit: string,
  measurable: boolean,
  poseOnly: boolean
): TimeSeriesIndicator {
  const summary: SummaryStatistic = {
    mean: null,
    max: null,
    standardDeviation: null,
    validFrameCount: 0,
  };
  return { key, measurable, poseOnly, samples: [], summary, unit };
}

// ─── MicroMovementAnalyzer ────────────────────────────────────────────────────

export class MicroMovementAnalyzer {
  private readonly config: ConfigStore;

  private baseline: Baseline | null = null;
  private assessedArm: 'left' | 'right' = 'left';
  private active = false;
  private startTimestamp: number | null = null;

  /** Every frame delivered to the analyzer, in delivery order. */
  private capturedFrames: CapturedFrame[] = [];

  constructor(config: ConfigStore) {
    this.config = config;
  }

  /**
   * Begins a new capture session for the given baseline and assessed arm.
   * Resets all accumulated state.
   */
  start(baseline: Baseline, assessedArm: 'left' | 'right'): void {
    this.baseline = baseline;
    this.assessedArm = assessedArm;
    this.active = true;
    this.startTimestamp = null;
    this.capturedFrames = [];
  }

  /**
   * Captures the assessed-arm landmarks from a single CV frame.
   *
   * Captures (Req 2.1–2.5):
   * - assessed-arm shoulder/elbow/wrist/hip (normalized) when pose landmarks present,
   * - world-space shoulder/elbow/wrist when world landmarks present,
   * - all 21 hand landmarks for the assessed arm, associated via the handedness label,
   * - the frame timestamp and per-landmark visibility confidence.
   *
   * Frames missing assessed-arm pose landmarks are captured but marked as
   * excluded from position-based indicator computation (Req 2.6).
   */
  addFrame(frame: CVFrameResult): void {
    if (!this.active) return;

    if (this.startTimestamp === null) {
      this.startTimestamp = frame.timestamp;
    }
    const relativeTimestamp = frame.timestamp - this.startTimestamp;

    const { shoulder: sIdx, elbow: eIdx, wrist: wIdx, hip: hIdx } = poseIndicesFor(
      this.assessedArm
    );

    const poseSet = frame.poseLandmarks && frame.poseLandmarks[0] ? frame.poseLandmarks[0] : null;

    const shoulderLm = poseSet ? poseSet[sIdx] : undefined;
    const elbowLm = poseSet ? poseSet[eIdx] : undefined;
    const wristLm = poseSet ? poseSet[wIdx] : undefined;
    const hipLm = poseSet ? poseSet[hIdx] : undefined;

    // A frame has usable assessed-arm pose only when shoulder, elbow, and wrist
    // are all present — these are required for the position-based series.
    const hasPose = !!(shoulderLm && elbowLm && wristLm);

    if (!hasPose) {
      // Capture the frame but mark it excluded from position-based series (Req 2.6).
      this.capturedFrames.push({
        timestamp: frame.timestamp,
        relativeTimestamp,
        hasPose: false,
        shoulder: null,
        elbow: null,
        wrist: null,
        hip: null,
        worldShoulder: null,
        worldElbow: null,
        worldWrist: null,
        handLandmarks: this.captureHand(frame),
        poseConfidence: 0,
      });
      return;
    }

    // World-space landmarks for the assessed arm, when present (Req 2.2).
    const worldSet =
      frame.poseWorldLandmarks && frame.poseWorldLandmarks[0]
        ? frame.poseWorldLandmarks[0]
        : null;
    const worldShoulderLm = worldSet ? worldSet[sIdx] : undefined;
    const worldElbowLm = worldSet ? worldSet[eIdx] : undefined;
    const worldWristLm = worldSet ? worldSet[wIdx] : undefined;

    const shoulder = captureNormalized(shoulderLm!);
    const elbow = captureNormalized(elbowLm!);
    const wrist = captureNormalized(wristLm!);
    const hip = hipLm ? captureNormalized(hipLm) : null;

    const poseConfidence =
      (shoulder.visibility + elbow.visibility + wrist.visibility) / 3;

    this.capturedFrames.push({
      timestamp: frame.timestamp,
      relativeTimestamp,
      hasPose: true,
      shoulder,
      elbow,
      wrist,
      hip,
      worldShoulder: worldShoulderLm ? captureWorld(worldShoulderLm) : null,
      worldElbow: worldElbowLm ? captureWorld(worldElbowLm) : null,
      worldWrist: worldWristLm ? captureWorld(worldWristLm) : null,
      handLandmarks: this.captureHand(frame),
      poseConfidence,
    });
  }

  /**
   * Captures all 21 hand landmarks for the assessed arm from the frame, associated
   * via the handedness label (Req 2.3, 2.4). Returns null when no matching hand
   * is present or the hand landmark count is unexpected.
   */
  private captureHand(frame: CVFrameResult): CapturedHandLandmark[] | null {
    const label = handednessLabelFor(this.assessedArm);
    const hand = findAssessedHand(frame, label);
    if (!hand || hand.length < HAND_LANDMARK_COUNT) {
      return null;
    }
    const captured: CapturedHandLandmark[] = [];
    for (let i = 0; i < HAND_LANDMARK_COUNT; i++) {
      const lm = hand[i];
      captured.push({ x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility });
    }
    return captured;
  }

  /**
   * Returns a shallow copy of the captured frames for the current session.
   * Exposed for subsequent tasks and tests that inspect capture fidelity.
   */
  getCapturedFrames(): CapturedFrame[] {
    return [...this.capturedFrames];
  }

  /** Returns the currently assessed arm. */
  getAssessedArm(): 'left' | 'right' {
    return this.assessedArm;
  }

  /** The assessed-arm baseline measurements for the current session. */
  private assessedBaseline(): Baseline['leftArm'] | null {
    if (!this.baseline) return null;
    return this.assessedArm === 'left' ? this.baseline.leftArm : this.baseline.rightArm;
  }

  /**
   * Builds the Elbow_Flexion_Angle change series and its aggregate max change.
   *
   * For each frame with valid shoulder/elbow/wrist landmarks, computes the
   * shoulder-elbow-wrist angle (Req 4.1), then reports the change relative to the
   * baseline Elbow_Flexion_Angle (`baseline.elbowExtensionAngle`). Frames lacking
   * the required landmarks are excluded from the series (Req 4.6). The reported
   * aggregate is the maximum absolute change over the valid frames (Req 4.3).
   */
  private buildElbowFlexionSeries(): { indicator: TimeSeriesIndicator; maxChange: number } {
    const baseline = this.assessedBaseline();
    const baselineAngle = baseline ? baseline.elbowExtensionAngle : 0;

    const samples: IndicatorSample[] = [];
    const changeMagnitudes: number[] = [];

    for (const frame of this.capturedFrames) {
      // Req 8.2 / 15.2: exclude low-confidence frames from the summarized series so
      // the per-indicator Summary_Statistic uses only frames not marked
      // low-confidence. `isConfidentFrame` also requires hasPose.
      if (!this.isConfidentFrame(frame)) continue;
      const angle = computeElbowFlexionAngle(frame);
      if (angle === null) continue; // frame lacks required landmarks (Req 4.6)
      const change = angle - baselineAngle;
      samples.push({ timestamp: frame.relativeTimestamp, value: change });
      changeMagnitudes.push(Math.abs(change));
    }

    const maxChange =
      changeMagnitudes.length > 0 ? Math.max(...changeMagnitudes) : 0;

    const indicator: TimeSeriesIndicator = {
      key: 'elbowFlexionChange',
      measurable: samples.length > 0,
      poseOnly: true,
      samples,
      summary: summarize(samples.map((s) => s.value)),
      unit: 'degrees',
    };

    return { indicator, maxChange };
  }

  /**
   * Builds the Arm_To_Torso_Angle change series and its aggregate max change.
   *
   * For each frame with valid shoulder/elbow/hip landmarks, computes the angle
   * between the upper arm and the torso midline (Req 4.2), then reports the change
   * relative to a baseline Arm_To_Torso_Angle. Because the captured `Baseline`
   * does not carry a hip position, the baseline arm-to-torso angle is taken from
   * the first valid frame that has the required landmarks; subsequent frames are
   * reported relative to that reference. Frames lacking the required landmarks are
   * excluded from the series (Req 4.6). The reported aggregate is the maximum
   * absolute change over the valid frames (Req 4.4).
   */
  private buildArmToTorsoSeries(): { indicator: TimeSeriesIndicator; maxChange: number } {
    const samples: IndicatorSample[] = [];
    const changeMagnitudes: number[] = [];
    let baselineAngle: number | null = null;

    for (const frame of this.capturedFrames) {
      // Req 8.2 / 15.2: exclude low-confidence frames from the summarized series.
      if (!this.isConfidentFrame(frame)) continue;
      const angle = computeArmToTorsoAngle(frame);
      if (angle === null) continue; // frame lacks required landmarks (Req 4.6)
      if (baselineAngle === null) {
        baselineAngle = angle;
      }
      const change = angle - baselineAngle;
      samples.push({ timestamp: frame.relativeTimestamp, value: change });
      changeMagnitudes.push(Math.abs(change));
    }

    const maxChange =
      changeMagnitudes.length > 0 ? Math.max(...changeMagnitudes) : 0;

    const indicator: TimeSeriesIndicator = {
      key: 'armToTorsoChange',
      measurable: samples.length > 0,
      poseOnly: true,
      samples,
      summary: summarize(samples.map((s) => s.value)),
      unit: 'degrees',
    };

    return { indicator, maxChange };
  }

  /**
   * Builds the palm-rotation-change series and its rotational aggregate findings.
   *
   * For each captured frame that has assessed-arm hand landmarks, computes the
   * Palm_Orientation_Angle via {@link computePalmAngle} (Req 5.1) and reports the
   * rotation change relative to the baseline palm-orientation angle
   * (`baseline.palmOrientationAngle`) (Req 5.2). The reported total palm rotation
   * change is the extremum (by absolute value, sign preserved) of the per-frame
   * rotation-change series, matching Property 4 (Req 5.3). Possible pronation is
   * flagged when the absolute total change meets or exceeds `minPronationChange`
   * (Req 5.4). A supination→pronation trend is reported when the per-frame series
   * increases monotonically toward pronation across the window (Req 5.5). When no
   * captured frame contains assessed-arm hand landmarks, the indicator is reported
   * as not measurable and the aggregates are null/false (Req 5.6).
   */
  private buildPalmRotationSeries(): {
    indicator: TimeSeriesIndicator;
    total: number | null;
    possiblePronation: boolean;
    supinationToPronationTrend: boolean;
  } {
    const baseline = this.assessedBaseline();
    const baselineAngle = baseline ? baseline.palmOrientationAngle : 0;
    const minPronationChange = this.config.get('minPronationChange');

    const samples: IndicatorSample[] = [];
    const changes: number[] = [];

    for (const frame of this.capturedFrames) {
      if (!frame.handLandmarks) continue; // requires hand landmarks (Req 5.6)
      // Req 8.2 / 15.2: exclude low-confidence frames from the summarized series.
      // A frame with hand landmarks but low assessed-arm pose confidence is a
      // low-confidence interval and must not contribute to the palm-rotation
      // summary statistic. Frames without pose (hasPose=false) fail this gate.
      if (!this.isConfidentFrame(frame)) continue;
      // CapturedHandLandmark is structurally compatible with NormalizedLandmark.
      const palmAngle = computePalmAngle(frame.handLandmarks);
      const change = palmAngle - baselineAngle; // rotation change vs baseline (Req 5.2)
      samples.push({ timestamp: frame.relativeTimestamp, value: change });
      changes.push(change);
    }

    const measurable = samples.length > 0;

    // Total palm rotation change = extremum by absolute value (sign preserved),
    // i.e. the corresponding extremum of the per-frame series (Property 4, Req 5.3).
    let total: number | null = null;
    if (measurable) {
      total = changes.reduce(
        (best, v) => (Math.abs(v) > Math.abs(best) ? v : best),
        changes[0]
      );
    }

    // Possible pronation when |total| >= minPronationChange (Req 5.4).
    const possiblePronation = total !== null && Math.abs(total) >= minPronationChange;

    // Supination→pronation monotonic trend across the series (Req 5.5): the
    // per-frame rotation change increases monotonically (non-decreasing, with a
    // net increase) toward pronation. Requires at least two samples.
    let supinationToPronationTrend = false;
    if (changes.length >= 2) {
      let nonDecreasing = true;
      for (let i = 1; i < changes.length; i++) {
        if (changes[i] < changes[i - 1]) {
          nonDecreasing = false;
          break;
        }
      }
      const netIncrease = changes[changes.length - 1] > changes[0];
      supinationToPronationTrend = nonDecreasing && netIncrease;
    }

    const indicator: TimeSeriesIndicator = {
      key: 'palmRotationChange',
      measurable,
      poseOnly: false,
      samples,
      summary: summarize(samples.map((s) => s.value)),
      unit: 'degrees',
    };

    return { indicator, total, possiblePronation, supinationToPronationTrend };
  }

  /**
   * Builds the elbow-drift series and sustained-drift findings (Task 4.1).
   *
   * Elbow drift is the downward vertical displacement of the assessed-arm elbow
   * relative to its baseline elbow position, normalized to arm length (Req 3.2).
   * In normalized image coordinates the y axis increases downward, so the downward
   * drift component for a frame is `max(0, (elbowY - baselineElbowY) / armLength)`.
   * Frames lacking assessed-arm pose landmarks are excluded from the series (they
   * carry no elbow position). The reported aggregate `maxElbowDrift` is the maximum
   * of the per-frame series, consistent with Property 4 (Req 3.2).
   *
   * Sustained-drift detection (Req 3.5) is derived from this same elbow-drift
   * series: a run of consecutive frames whose drift is above `minDriftThreshold`
   * that spans at least `minDriftDuration` (seconds, converted to milliseconds) is
   * a sustained-drift run. `sustainedDrift` is true when at least one such run
   * exists, and `sustainedDriftDurationMs` is the longest such run's duration in
   * milliseconds.
   *
   * Wrist drift is intentionally NOT computed here: per the design, wrist-drift
   * max/onset/series are sourced from `DriftAnalyzer` (`getMaxDrift`,
   * `getDriftOnset`, `getDriftTimeSeries`) and assembled in
   * `buildAssessmentFromAnalysis` (Task 12.1). The `wristDrift` indicator returned
   * by {@link finalize} remains an empty placeholder that that step populates.
   */
  private buildElbowDriftSeries(): {
    indicator: TimeSeriesIndicator;
    maxElbowDrift: number;
    sustainedDrift: boolean;
    sustainedDriftDurationMs: number;
  } {
    const baseline = this.assessedBaseline();
    const baselineElbowY = baseline ? baseline.elbowPos.y : 0;
    const armLength = baseline ? baseline.armLength : 0;

    const minDriftThreshold = this.config.get('minDriftThreshold');
    // minDriftDuration is configured in seconds; sustained runs are measured in ms.
    const minDriftDurationMs = this.config.get('minDriftDuration') * 1000;

    const samples: IndicatorSample[] = [];

    for (const frame of this.capturedFrames) {
      // Req 8.2 / 15.2: exclude low-confidence frames from the summarized series.
      // `isConfidentFrame` requires hasPose; also require an elbow position.
      if (!this.isConfidentFrame(frame) || !frame.elbow) continue;
      // Downward drift component, normalized to arm length (Req 3.2). y increases
      // downward, so a larger elbowY than baseline means the elbow dropped.
      const drift =
        armLength > 0
          ? Math.max(0, (frame.elbow.y - baselineElbowY) / armLength)
          : 0;
      samples.push({ timestamp: frame.relativeTimestamp, value: drift });
    }

    const maxElbowDrift =
      samples.length > 0 ? Math.max(...samples.map((s) => s.value)) : 0;

    // ── Sustained-drift detection over the elbow-drift series (Req 3.5) ────────
    // Walk the series accumulating continuous runs of above-threshold drift. A run
    // spans from the first above-threshold sample to the last consecutive one; its
    // duration is the elapsed time between those samples. The longest run that
    // reaches minDriftDurationMs marks sustained drift.
    let sustainedDrift = false;
    let sustainedDriftDurationMs = 0;
    let runStartTs: number | null = null;
    let runEndTs: number | null = null;

    const closeRun = () => {
      if (runStartTs !== null && runEndTs !== null) {
        const runDuration = runEndTs - runStartTs;
        if (runDuration >= minDriftDurationMs) {
          sustainedDrift = true;
          if (runDuration > sustainedDriftDurationMs) {
            sustainedDriftDurationMs = runDuration;
          }
        }
      }
      runStartTs = null;
      runEndTs = null;
    };

    for (const sample of samples) {
      if (sample.value > minDriftThreshold) {
        if (runStartTs === null) {
          runStartTs = sample.timestamp;
        }
        runEndTs = sample.timestamp;
      } else {
        closeRun();
      }
    }
    closeRun();

    const indicator: TimeSeriesIndicator = {
      key: 'elbowDrift',
      measurable: samples.length > 0,
      poseOnly: true,
      samples,
      summary: summarize(samples.map((s) => s.value)),
      unit: 'normalized',
    };

    return { indicator, maxElbowDrift, sustainedDrift, sustainedDriftDurationMs };
  }

  /**
   * Whether a captured frame passes the per-frame confidence gate used for
   * tremor/stability computation. Frames below `minPoseConfidence` are treated as
   * low-confidence and excluded (Req 6.6). The full occlusion-grace-period interval
   * logic is simplified here to a per-frame gate, which is sufficient for excluding
   * low-confidence frames from tremor/stability computation.
   */
  private isConfidentFrame(frame: CapturedFrame): boolean {
    const minPoseConfidence = this.config.get('minPoseConfidence');
    return frame.hasPose && frame.poseConfidence >= minPoseConfidence;
  }

  /** Effective sampling rate (Hz) over the confident, pose-bearing frames. */
  private effectiveSampleRate(frames: CapturedFrame[]): number {
    if (frames.length < 2) return 0;
    const first = frames[0].relativeTimestamp;
    const last = frames[frames.length - 1].relativeTimestamp;
    const durationSeconds = (last - first) / 1000;
    if (durationSeconds <= 0) return 0;
    // frames per second = (validFrames - 1) intervals over the elapsed duration,
    // equivalently validFrames / duration for a dense series. Use the interval
    // form so a known sinusoid sampled at rate R is recovered at rate R.
    return (frames.length - 1) / durationSeconds;
  }

  /**
   * Builds the wrist tremor amplitude + dominant-frequency indicators and the
   * stability metric (Task 5.1, Req 6.1, 6.3, 6.4, 6.5, 6.6).
   *
   * Amplitude is the RMS (population standard deviation) of the high-frequency
   * residual of the assessed-arm wrist position magnitude (2D x/y), normalized to
   * baseline arm length (Req 6.1). Low-confidence frames are excluded (Req 6.6).
   * The dominant frequency is the periodogram peak of that residual, capped at
   * Nyquist with a bandwidth-limited flag (Req 6.5). Stability is the bounded
   * inverse of the amplitude (Req 6.4).
   */
  private buildWristTremorSeries(): {
    amplitudeIndicator: TimeSeriesIndicator;
    frequencyIndicator: TimeSeriesIndicator;
    stabilityIndicator: TimeSeriesIndicator;
    bandwidthLimited: boolean;
  } {
    const baseline = this.assessedBaseline();
    const armLength = baseline && baseline.armLength > 0 ? baseline.armLength : 0;

    // Confident, pose-bearing frames with a wrist position (Req 6.6).
    const frames = this.capturedFrames.filter(
      (f) => this.isConfidentFrame(f) && f.wrist !== null
    );

    // Per-frame wrist position magnitude (2D). Using the magnitude of the position
    // captures oscillation in both axes with a single residual series.
    const positionMagnitudes = frames.map((f) => {
      const wx = f.wrist!.x;
      const wy = f.wrist!.y;
      return Math.sqrt(wx * wx + wy * wy);
    });

    // High-pass residual over a moving-average window (~0.5s worth of samples).
    const sampleRate = this.effectiveSampleRate(frames);
    const windowSamples =
      sampleRate > 0 ? Math.max(3, Math.round(sampleRate * 0.5)) : frames.length;
    const residual = highPassResidual(positionMagnitudes, windowSamples);

    // RMS amplitude of the residual, normalized to arm length (Req 6.1).
    const rawAmplitude = populationStd(residual);
    const amplitude = armLength > 0 ? rawAmplitude / armLength : rawAmplitude;

    // The amplitude series exposes the (normalized) residual magnitude per frame
    // for plotting; its summary max/std reflect the oscillation.
    const amplitudeSamples: IndicatorSample[] = frames.map((f, i) => ({
      timestamp: f.relativeTimestamp,
      value: armLength > 0 ? Math.abs(residual[i]) / armLength : Math.abs(residual[i]),
    }));

    const measurable = frames.length > 0;

    const amplitudeIndicator: TimeSeriesIndicator = {
      key: 'wristTremorAmplitude',
      measurable,
      poseOnly: true,
      samples: amplitudeSamples,
      summary: summarize(amplitudeSamples.map((s) => s.value)),
      unit: 'normalized',
    };

    // Dominant frequency over the (arm-length-independent) residual series.
    const { frequency, bandwidthLimited } = measurable
      ? dominantFrequencyHz(residual, sampleRate)
      : { frequency: 0, bandwidthLimited: true };

    // Single-value series for the dominant frequency (Req 6.3): a single sample at
    // the assessment start carrying the estimated Hz value.
    const freqSamples: IndicatorSample[] = measurable
      ? [{ timestamp: 0, value: frequency }]
      : [];
    const frequencyIndicator: TimeSeriesIndicator = {
      key: 'wristTremorDominantFrequency',
      measurable,
      poseOnly: true,
      samples: freqSamples,
      summary: summarize(freqSamples.map((s) => s.value)),
      unit: 'Hz',
    };

    // Stability = bounded inverse of oscillation amplitude (Req 6.4).
    const stabilityValue = stabilityFromAmplitude(amplitude);
    const stabilitySamples: IndicatorSample[] = measurable
      ? [{ timestamp: 0, value: stabilityValue }]
      : [];
    const stabilityIndicator: TimeSeriesIndicator = {
      key: 'stability',
      measurable,
      poseOnly: true,
      samples: stabilitySamples,
      summary: summarize(stabilitySamples.map((s) => s.value)),
      unit: 'ratio',
    };

    return {
      amplitudeIndicator,
      frequencyIndicator,
      stabilityIndicator,
      bandwidthLimited: measurable ? bandwidthLimited : false,
    };
  }

  /**
   * Builds the fingertip tremor amplitude indicator (Task 5.1, Req 6.2, 6.6).
   *
   * Uses the mean fingertip position (hand landmarks 4/8/12/16/20) magnitude per
   * confident frame that has hand landmarks, high-pass filters it, and reports the
   * RMS amplitude normalized to arm length. Measurable only when at least one
   * confident frame has hand landmarks; otherwise reported as not measurable.
   */
  private buildFingertipTremorSeries(): TimeSeriesIndicator {
    const baseline = this.assessedBaseline();
    const armLength = baseline && baseline.armLength > 0 ? baseline.armLength : 0;

    // Confident frames with hand landmarks (Req 6.2, 6.6).
    const frames = this.capturedFrames.filter(
      (f) => this.isConfidentFrame(f) && f.handLandmarks !== null
    );

    const positionMagnitudes = frames.map((f) => {
      const hand = f.handLandmarks!;
      let sx = 0;
      let sy = 0;
      for (const idx of FINGERTIP_INDICES) {
        sx += hand[idx].x;
        sy += hand[idx].y;
      }
      const mx = sx / FINGERTIP_INDICES.length;
      const my = sy / FINGERTIP_INDICES.length;
      return Math.sqrt(mx * mx + my * my);
    });

    const sampleRate = this.effectiveSampleRate(frames);
    const windowSamples =
      sampleRate > 0 ? Math.max(3, Math.round(sampleRate * 0.5)) : frames.length;
    const residual = highPassResidual(positionMagnitudes, windowSamples);

    const samples: IndicatorSample[] = frames.map((f, i) => ({
      timestamp: f.relativeTimestamp,
      value: armLength > 0 ? Math.abs(residual[i]) / armLength : Math.abs(residual[i]),
    }));

    return {
      key: 'fingertipTremorAmplitude',
      measurable: frames.length > 0,
      poseOnly: false,
      samples,
      summary: summarize(samples.map((s) => s.value)),
      unit: 'normalized',
    };
  }

  /**
   * Builds the finger-curl change series and its aggregate change (Task 5.2,
   * Req 7.1, 7.3, 7.4).
   *
   * For each captured frame that has assessed-arm hand landmarks, computes the
   * per-frame finger-curl scalar (Req 7.1). Because the calibration `Baseline`
   * carries no finger data, the baseline curl is taken from the FIRST frame that
   * has hand landmarks; subsequent frames report the change relative to that
   * baseline (Req 7.3). The reported aggregate is the extremum (by absolute value,
   * sign preserved) of the per-frame change series, consistent with the other
   * change indicators (Property 4/16). When no captured frame contains assessed-arm
   * hand landmarks across the entire assessment, the indicator is reported as not
   * measurable with an empty series (Req 7.4).
   */
  private buildFingerCurlSeries(): { indicator: TimeSeriesIndicator; change: number | null } {
    const samples: IndicatorSample[] = [];
    const changes: number[] = [];
    let baselineCurl: number | null = null;

    for (const frame of this.capturedFrames) {
      if (!frame.handLandmarks) continue; // requires hand landmarks (Req 7.4)
      // Req 8.2 / 15.2: exclude low-confidence frames from the summarized series.
      if (!this.isConfidentFrame(frame)) continue;
      const curl = computeFingerCurl(frame.handLandmarks);
      if (baselineCurl === null) {
        baselineCurl = curl; // baseline from first hand frame (Req 7.3)
      }
      const change = curl - baselineCurl;
      samples.push({ timestamp: frame.relativeTimestamp, value: change });
      changes.push(change);
    }

    const measurable = samples.length > 0;
    let change: number | null = null;
    if (measurable) {
      change = changes.reduce(
        (best, v) => (Math.abs(v) > Math.abs(best) ? v : best),
        changes[0]
      );
    }

    const indicator: TimeSeriesIndicator = {
      key: 'fingerCurlChange',
      measurable,
      poseOnly: false,
      samples,
      summary: summarize(samples.map((s) => s.value)),
      unit: 'normalized',
    };

    return { indicator, change };
  }

  /**
   * Builds the finger-spread change series and its aggregate change (Task 5.2,
   * Req 7.2, 7.3, 7.4).
   *
   * For each captured frame that has assessed-arm hand landmarks, computes the
   * per-frame finger-spread scalar (Req 7.2). As with finger curl, the baseline is
   * taken from the FIRST hand frame (the `Baseline` carries no finger data), and
   * subsequent frames report the change relative to that baseline (Req 7.3). The
   * reported aggregate is the extremum (by absolute value, sign preserved) of the
   * per-frame change series. When no captured frame contains assessed-arm hand
   * landmarks across the entire assessment, the indicator is reported as not
   * measurable with an empty series (Req 7.4).
   */
  private buildFingerSpreadSeries(): { indicator: TimeSeriesIndicator; change: number | null } {
    const samples: IndicatorSample[] = [];
    const changes: number[] = [];
    let baselineSpread: number | null = null;

    for (const frame of this.capturedFrames) {
      if (!frame.handLandmarks) continue; // requires hand landmarks (Req 7.4)
      // Req 8.2 / 15.2: exclude low-confidence frames from the summarized series.
      if (!this.isConfidentFrame(frame)) continue;
      const spread = computeFingerSpread(frame.handLandmarks);
      if (baselineSpread === null) {
        baselineSpread = spread; // baseline from first hand frame (Req 7.3)
      }
      const change = spread - baselineSpread;
      samples.push({ timestamp: frame.relativeTimestamp, value: change });
      changes.push(change);
    }

    const measurable = samples.length > 0;
    let change: number | null = null;
    if (measurable) {
      change = changes.reduce(
        (best, v) => (Math.abs(v) > Math.abs(best) ? v : best),
        changes[0]
      );
    }

    const indicator: TimeSeriesIndicator = {
      key: 'fingerSpreadChange',
      measurable,
      poseOnly: false,
      samples,
      summary: summarize(samples.map((s) => s.value)),
      unit: 'normalized',
    };

    return { indicator, change };
  }

  /**
   * Computes all indicators + per-indicator summary statistics over the captured
   * frames and returns the complete {@link MicroMovementIndicators} object.
   *
   * Summary-statistics contract (Task 6.1 — fully implements Requirement 8):
   * - Req 8.1: For each measurable time-series indicator, `summary` carries the
   *   mean, max, and standard deviation computed over exactly that indicator's
   *   valid per-frame samples. Each indicator builder computes its `summary` via
   *   `summarize(samples.map(s => s.value))`, and each `samples` array contains
   *   only the valid frames for that indicator (never a superset), so the
   *   statistics are over exactly the valid frames.
   * - Req 8.2: Each Summary_Statistic uses only frames not marked as a
   *   low-confidence interval or camera-affected. Every summarized series is built
   *   by iterating captured frames behind the `isConfidentFrame` gate
   *   (`hasPose && poseConfidence >= minPoseConfidence`), which excludes frames
   *   whose assessed-arm landmark confidence is below `minPoseConfidence`. Camera-
   *   affected frames are detected upstream in `DriftAnalyzer`; within this
   *   analyzer the per-frame pose-confidence gate is the available exclusion
   *   signal and is applied consistently to the pose-based series (elbow flexion,
   *   arm-to-torso, elbow drift, palm rotation, finger curl/spread) alongside the
   *   tremor/stability series that already filtered via `isConfidentFrame`.
   * - Req 8.3: `standardDeviation` is reported as `null` (not available) when an
   *   indicator has fewer than two valid frames — enforced centrally in
   *   {@link summarize}.
   * - Req 8.4: Each `summary` carries `validFrameCount = values.length`, the count
   *   of valid frames used in its computation, which equals the length of that
   *   indicator's valid `samples` array.
   *
   * The returned object is complete: it includes every per-indicator
   * `TimeSeriesIndicator` (with its `measurable`/`poseOnly` flags and `summary`),
   * the aggregate scalar findings, and the session-level `usedPoseOnlyPath` flag.
   *
   * NOTE: `wristDrift` is intentionally left as an empty placeholder here; per the
   * design its max/onset/series are sourced from `DriftAnalyzer` and populated by
   * `buildAssessmentFromAnalysis` (Task 12.1).
   */
  finalize(): MicroMovementIndicators {
    // Whether any assessed-arm hand landmarks were captured across the session.
    const anyHand = this.capturedFrames.some((f) => f.handLandmarks !== null);
    // Pose-only path when hands are never available for the assessed arm.
    const usedPoseOnlyPath = !anyHand;

    // Joint-angle indicators over time (Task 3.1, Req 4.1–4.6).
    const elbowFlexion = this.buildElbowFlexionSeries();
    const armToTorso = this.buildArmToTorsoSeries();

    // Rotational (pronation) indicators over time (Task 3.2, Req 5.1–5.6).
    const palmRotation = this.buildPalmRotationSeries();

    // Drift-derived indicators: elbow drift + sustained-drift (Task 4.1, Req 3.2, 3.5).
    const elbowDrift = this.buildElbowDriftSeries();

    // Tremor / stability indicators (Task 5.1, Req 6.1–6.6).
    const wristTremor = this.buildWristTremorSeries();
    const fingertipTremor = this.buildFingertipTremorSeries();

    // Finger-level indicators (Task 5.2, Req 7.1–7.4).
    const fingerCurl = this.buildFingerCurlSeries();
    const fingerSpread = this.buildFingerSpreadSeries();

    return {
      assessedArm: this.assessedArm,
      // NOTE: wristDrift is left as an empty placeholder here. Per the design,
      // wrist-drift max/onset/series are sourced from DriftAnalyzer
      // (getMaxDrift / getDriftOnset / getDriftTimeSeries) and populated by
      // buildAssessmentFromAnalysis (Task 12.1), not by MicroMovementAnalyzer.
      wristDrift: emptyIndicator('wristDrift', 'normalized', true, false),
      elbowDrift: elbowDrift.indicator,
      elbowFlexionChange: elbowFlexion.indicator,
      armToTorsoChange: armToTorso.indicator,
      palmRotationChange: palmRotation.indicator,
      wristTremorAmplitude: wristTremor.amplitudeIndicator,
      fingertipTremorAmplitude: fingertipTremor,
      wristTremorDominantFrequency: wristTremor.frequencyIndicator,
      stability: wristTremor.stabilityIndicator,
      fingerCurlChange: fingerCurl.indicator,
      fingerSpreadChange: fingerSpread.indicator,

      maxElbowFlexionChangeDegrees: elbowFlexion.maxChange,
      maxArmToTorsoChangeDegrees: armToTorso.maxChange,
      totalPalmRotationChangeDegrees: palmRotation.total,
      possiblePronation: palmRotation.possiblePronation,
      supinationToPronationTrend: palmRotation.supinationToPronationTrend,
      sustainedDrift: elbowDrift.sustainedDrift,
      sustainedDriftDurationMs: elbowDrift.sustainedDriftDurationMs,
      dominantFrequencyBandwidthLimited: wristTremor.bandwidthLimited,
      usedPoseOnlyPath,
    };
  }
}
