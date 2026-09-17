/**
 * AssessmentLoop — the controller that drives per-frame CV processing during the
 * timed single-arm assessment.
 *
 * Responsibilities (mapped to requirements):
 * - `start` calls `driftAnalyzer.startAssessment(baseline)` BEFORE the first frame
 *   is processed (Req 1.1), then starts the MicroMovementAnalyzer (Req 1.3) and the
 *   RecordingManager (Req 10.1, 11.1).
 * - Each resolved `CVFrameResult` is forwarded to `driftAnalyzer.addAssessmentFrame`
 *   (Req 1.2) and `microAnalyzer.addFrame` (Req 1.3), and counted as a delivered
 *   frame (Req 1.6).
 * - The frame pump uses a single-in-flight model: while a frame is being processed
 *   (`processFrame` not yet resolved), any additional `tick()` is dropped and counted
 *   as a dropped frame, giving bounded backpressure (Req 17.2).
 * - `finalize` stops recording, computes the effective frame rate (valid frames /
 *   duration) (Req 17.3), runs the QualityAssessor over the drift frames, collects
 *   micro-movement indicators, and assembles an `AssessmentAnalysisResult`. When no
 *   frame carried valid assessed-arm pose landmarks, it flags the result so the
 *   downstream `buildAssessmentFromAnalysis` can force `unable_to_assess` (Req 1.5).
 *
 * All work here is cheap main-thread arithmetic operating on already-computed
 * landmarks; heavy inference stays in `CVWorkerManager`'s worker (Req 17.1).
 *
 * Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 17.1, 17.2, 17.3
 */

import type { CVWorkerManager } from '../cv/CVWorkerManager';
import type { ConfigStore } from '../config/ConfigStore';
import type { DriftAnalyzerInterface } from './DriftAnalyzer';
import type { MicroMovementAnalyzer } from './MicroMovementAnalyzer';
import type { RecordingManager, RecordingResult } from './RecordingManager';
import { evaluateQuality } from './QualityAssessor';
import type {
  Baseline,
  CVFrameResult,
  DriftFrame,
  MicroMovementIndicators,
  QualityAssessment,
} from '../types';

// ─── Dependencies ─────────────────────────────────────────────────────────────

/**
 * Optional recording source. Because the design's `start(baseline, assessedArm)`
 * signature does not carry the camera stream/consent, the loop obtains them for the
 * RecordingManager via `deps` (the sequence diagram shows `AL->>RM: start(stream)`).
 *
 * When `recordingStream` is omitted the recorder is not started and `finalize`
 * still returns whatever the RecordingManager reports (a `skipped` result), so the
 * loop continues uninterrupted (Req 10.4).
 */
export interface AssessmentLoopDeps {
  cvManager: CVWorkerManager;
  driftAnalyzer: DriftAnalyzerInterface;
  microAnalyzer: MicroMovementAnalyzer;
  recordingManager: RecordingManager;
  config: ConfigStore;
  /** Source of frames: a getter returning the current ImageBitmap for processing. */
  grabFrame: () => Promise<ImageBitmap | null>;
  /** The live camera stream to record; when present the recorder is started. */
  recordingStream?: MediaStream | null;
  /** Whether the user consented to on-device recording. */
  recordingConsented?: boolean;
  now?: () => number; // injectable clock for tests
}

// ─── Result ─────────────────────────────────────────────────────────────────

/**
 * The complete analysis output of a finished assessment, consumed by
 * `buildAssessmentFromAnalysis` (Task 12.1).
 */
export interface AssessmentAnalysisResult {
  baseline: Baseline;
  assessedArm: 'left' | 'right';
  driftFrames: DriftFrame[];
  maxDrift: { left: number; right: number };
  driftOnset: { left: number | null; right: number | null };
  indicators: MicroMovementIndicators; // from MicroMovementAnalyzer
  quality: QualityAssessment; // from QualityAssessor
  deliveredFrameCount: number;
  droppedFrameCount: number;
  effectiveFrameRate: number; // valid frames / duration
  recording: RecordingResult; // from RecordingManager
  startedAtMs: number;
  durationSeconds: number;
  /**
   * True when no frame had valid assessed-arm pose landmarks. Downstream assembly
   * uses this to force `unable_to_assess` (Req 1.5).
   */
  noValidAssessedArmFrames: boolean;
}

// ─── AssessmentLoop ─────────────────────────────────────────────────────────

export class AssessmentLoop {
  private readonly deps: AssessmentLoopDeps;
  private readonly now: () => number;

  private baseline: Baseline | null = null;
  private assessedArm: 'left' | 'right' = 'left';
  private active = false;

  /** Single-in-flight guard: true while a `processFrame` call is outstanding. */
  private inFlight = false;

  private deliveredFrameCount = 0;
  private droppedFrameCount = 0;

  private startedAtMs = 0;

  constructor(deps: AssessmentLoopDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * Begins the loop. Calls `startAssessment` on the drift analyzer BEFORE any frame
   * is processed (Req 1.1), starts the micro-movement analyzer (Req 1.3), and starts
   * the recorder when a stream is available (Req 10.1, 11.1).
   */
  start(baseline: Baseline, assessedArm: 'left' | 'right'): void {
    this.baseline = baseline;
    this.assessedArm = assessedArm;
    this.active = true;
    this.inFlight = false;
    this.deliveredFrameCount = 0;
    this.droppedFrameCount = 0;
    this.startedAtMs = this.now();

    // Order matters: startAssessment must run before the first frame is forwarded
    // to addAssessmentFrame (Req 1.1).
    this.deps.driftAnalyzer.startAssessment(baseline);
    this.deps.microAnalyzer.start(baseline, assessedArm);

    // Start recording only when a stream is provided; the RecordingManager itself
    // gates on consent + capability and skips gracefully otherwise (Req 10.1, 10.4, 11.1).
    if (this.deps.recordingStream) {
      this.deps.recordingManager.start(
        this.deps.recordingStream,
        this.deps.recordingConsented ?? false
      );
    }
  }

  /**
   * Called on each camera tick / animation frame. Implements the single-in-flight
   * frame pump: if a frame is currently being processed, this tick is dropped and
   * counted (Req 17.2); otherwise it kicks off async processing of the next frame.
   *
   * `tick` is synchronous for its caller — it starts the async pump and returns
   * immediately, using the `inFlight` boolean guard for backpressure.
   */
  tick(_timestampMs: number): void {
    if (!this.active) return;

    // Bounded backpressure: drop the frame if one is already in flight (Req 17.2).
    if (this.inFlight) {
      this.droppedFrameCount += 1;
      return;
    }

    this.inFlight = true;
    // Fire-and-forget: the pump clears `inFlight` when processing settles.
    void this.pump(_timestampMs);
  }

  /**
   * The async frame pump for a single tick. Grabs a frame, processes it via the CV
   * manager (heavy work off-thread), and forwards the resolved result to both
   * analyzers. Always clears the in-flight guard when done so the next tick can run.
   */
  private async pump(timestampMs: number): Promise<void> {
    try {
      const bitmap = await this.deps.grabFrame();
      if (!bitmap) {
        // No frame available this tick — nothing delivered, nothing dropped.
        return;
      }

      let result: CVFrameResult;
      try {
        result = await this.deps.cvManager.processFrame(bitmap, timestampMs);
      } catch {
        // A dropped/failed processing attempt does not count as a delivered frame.
        // (CVWorkerManager rejects superseded frames; our single-in-flight guard
        // makes that path unlikely, but we tolerate it defensively.)
        return;
      }

      // Only forward/count if the loop is still active when the result arrives.
      if (!this.active) return;

      // Forward the resolved frame to both analyzers (Req 1.2, 1.3).
      this.deps.driftAnalyzer.addAssessmentFrame(result);
      this.deps.microAnalyzer.addFrame(result);

      this.deliveredFrameCount += 1;
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Stops the loop and recording, then assembles the `AssessmentAnalysisResult`.
   *
   * Computes:
   * - `durationSeconds` from the injectable clock (start -> finalize).
   * - `effectiveFrameRate` as valid frames / duration (Req 17.3).
   * - `quality` via the QualityAssessor over the drift time series.
   * - `indicators` via the MicroMovementAnalyzer.
   * - `noValidAssessedArmFrames` when no frame carried valid assessed-arm pose
   *   landmarks, so downstream assembly can force `unable_to_assess` (Req 1.5).
   */
  async finalize(): Promise<AssessmentAnalysisResult> {
    this.active = false;

    if (!this.baseline) {
      throw new Error('AssessmentLoop.finalize() called before start()');
    }
    const baseline = this.baseline;

    // Stop recording and retain (possibly partial) footage on-device (Req 10.5).
    const recording = await this.deps.recordingManager.stop();

    const endedAtMs = this.now();
    const durationSeconds = Math.max(0, (endedAtMs - this.startedAtMs) / 1000);

    const driftFrames = this.deps.driftAnalyzer.getDriftTimeSeries();
    const maxDrift = this.deps.driftAnalyzer.getMaxDrift();
    const driftOnset = this.deps.driftAnalyzer.getDriftOnset();

    const indicators = this.deps.microAnalyzer.finalize();
    const quality = evaluateQuality(driftFrames, baseline, this.deps.config);

    // Effective frame rate uses valid frames over the elapsed duration (Req 17.3).
    const validFrameCount = driftFrames.filter((f) => f.frameValid).length;
    const effectiveFrameRate =
      durationSeconds > 0 ? validFrameCount / durationSeconds : 0;

    // "No valid assessed-arm frames" (Req 1.5): the assessed arm never produced a
    // valid drift frame. We check the assessed-arm confidence + frame validity in
    // the drift time series, and corroborate with the analyzer's captured frames
    // (frames that had usable assessed-arm pose landmarks).
    const capturedPoseFrames = this.deps.microAnalyzer
      .getCapturedFrames()
      .filter((f) => f.hasPose).length;
    const validAssessedDriftFrames = driftFrames.filter((f) => {
      if (!f.frameValid) return false;
      const conf =
        this.assessedArm === 'left' ? f.leftConfidence : f.rightConfidence;
      return conf > 0;
    }).length;
    const noValidAssessedArmFrames =
      validAssessedDriftFrames === 0 && capturedPoseFrames === 0;

    return {
      baseline,
      assessedArm: this.assessedArm,
      driftFrames,
      maxDrift,
      driftOnset,
      indicators,
      quality,
      deliveredFrameCount: this.deliveredFrameCount,
      droppedFrameCount: this.droppedFrameCount,
      effectiveFrameRate,
      recording,
      startedAtMs: this.startedAtMs,
      durationSeconds,
      noValidAssessedArmFrames,
    };
  }

  /** Number of frames delivered to the analyzers so far (Req 1.6). */
  getDeliveredFrameCount(): number {
    return this.deliveredFrameCount;
  }

  /** Number of ticks dropped under backpressure so far (Req 17.2). */
  getDroppedFrameCount(): number {
    return this.droppedFrameCount;
  }
}
