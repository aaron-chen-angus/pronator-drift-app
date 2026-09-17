/**
 * AssessmentSession — a shared, session-scoped controller that owns the single
 * camera stream, the single CV worker, and the analysis pipeline so that the
 * camera-setup, calibration, and assessment screens all operate on ONE live
 * pipeline instead of each spinning up their own.
 *
 * This is what makes the real analysis run end-to-end:
 *   - CameraSetupScreen publishes its MediaStream + CVWorkerManager here.
 *   - CalibrationScreen runs real calibration frames -> real Baseline.
 *   - AssessmentScreen drives the AssessmentLoop with real frames for 30s.
 *   - App reads the finalized AssessmentAnalysisResult to build the result.
 *
 * Everything stays on-device. The session holds resources for the whole flow
 * and releases them on reset()/dispose().
 */

import { CVWorkerManager } from '../cv/CVWorkerManager';
import type { CVWorkerManagerConfig } from '../cv/CVWorkerManager';
import { DriftAnalyzerImpl } from '../analysis/DriftAnalyzer';
import { MicroMovementAnalyzer } from '../analysis/MicroMovementAnalyzer';
import { RecordingManager } from '../analysis/RecordingManager';
import { AssessmentLoop } from '../analysis/AssessmentLoop';
import type { AssessmentAnalysisResult } from '../analysis/AssessmentLoop';
import { getConfigStore } from '../config/ConfigStore';
import type {
  Baseline,
  CVFrameResult,
  IndicatorSample,
  MicroMovementIndicators,
} from '../types';

/** MediaPipe model paths (public Google host; override for offline hosting). */
export const SESSION_CV_CONFIG: CVWorkerManagerConfig = {
  poseModelPath:
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  handModelPath:
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  minPoseConfidence: 0.4,
  minHandConfidence: 0.4,
  numPoses: 1,
};

/**
 * Owns the shared, live pipeline for one screening session.
 *
 * Lifecycle:
 *   setStream() / getCvManager()   ← published by CameraSetupScreen
 *   calibrate(...)                 ← run by CalibrationScreen
 *   runAssessment(...)             ← run by AssessmentScreen
 *   getLastResult()                ← read by App on completion
 *   reset()                        ← between assessments
 *   dispose()                      ← teardown
 */
export class AssessmentSession {
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private cvManager: CVWorkerManager | null = null;

  private readonly config = getConfigStore();
  private readonly recordingManager = new RecordingManager();

  private baseline: Baseline | null = null;
  private assessedArm: 'left' | 'right' = 'left';
  private lastResult: AssessmentAnalysisResult | null = null;
  private recordingConsented = false;

  /** Per-arm derived indicators from the last run (front-facing both-arms mode). */
  private lastLeftIndicators: MicroMovementIndicators | null = null;
  private lastRightIndicators: MicroMovementIndicators | null = null;
  /** Per-arm wrist-drift time series (normalized) from the last run. */
  private lastWristDriftSeries: {
    left: IndicatorSample[];
    right: IndicatorSample[];
  } | null = null;

  /**
   * Optional observer notified with every processed CV frame during a running
   * assessment. Used by the AssessmentScreen to draw live pose markers without
   * running a second, competing CV pass.
   */
  private frameObserver: ((frame: CVFrameResult) => void) | null = null;

  // ─── Camera + CV wiring (from CameraSetupScreen) ───────────────────────────

  setStream(stream: MediaStream | null): void {
    this.stream = stream;
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  /**
   * Subscribe to processed CV frames during a running assessment (for live pose
   * overlay). Returns an unsubscribe function. Only one observer is kept at a
   * time; subscribing replaces any previous observer.
   */
  observeFrames(observer: (frame: CVFrameResult) => void): () => void {
    this.frameObserver = observer;
    return () => {
      if (this.frameObserver === observer) this.frameObserver = null;
    };
  }

  /** A hidden/off-screen video element the session grabs frames from. */
  ensureVideoElement(): HTMLVideoElement {
    if (!this.videoEl) {
      const el = document.createElement('video');
      el.muted = true;
      el.playsInline = true;
      el.setAttribute('aria-hidden', 'true');
      el.style.position = 'fixed';
      el.style.width = '1px';
      el.style.height = '1px';
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      this.videoEl = el;
    }
    return this.videoEl;
  }

  /** Bind the current stream to the session's frame-grab video element. */
  async attachStreamToVideo(): Promise<void> {
    if (!this.stream) return;
    const el = this.ensureVideoElement();
    if (el.srcObject !== this.stream) {
      el.srcObject = this.stream;
      try {
        await el.play();
      } catch {
        /* autoplay may need a user gesture; frames still arrive once playing */
      }
    }
  }

  setCvManager(manager: CVWorkerManager | null): void {
    this.cvManager = manager;
  }

  getCvManager(): CVWorkerManager | null {
    return this.cvManager;
  }

  /** Lazily create + initialise a CV manager if the setup screen didn't share one. */
  async ensureCvManager(): Promise<CVWorkerManager> {
    if (this.cvManager && this.cvManager.ready) return this.cvManager;
    const manager = this.cvManager ?? new CVWorkerManager();
    this.cvManager = manager;
    if (!manager.ready) {
      await manager.initialize({
        ...SESSION_CV_CONFIG,
        minPoseConfidence: this.config.get('minPoseConfidence'),
        minHandConfidence: this.config.get('minHandConfidence'),
      });
    }
    return manager;
  }

  setRecordingConsent(consented: boolean): void {
    this.recordingConsented = consented;
  }

  getRecordingManager(): RecordingManager {
    return this.recordingManager;
  }

  getAssessedArm(): 'left' | 'right' {
    return this.assessedArm;
  }

  setAssessedArm(arm: 'left' | 'right'): void {
    this.assessedArm = arm;
  }

  // ─── Frame grabbing ────────────────────────────────────────────────────────

  /** Grab the current camera frame as an ImageBitmap, or null if not ready. */
  private async grabFrame(): Promise<ImageBitmap | null> {
    const el = this.videoEl;
    if (!el || el.readyState < 2 /* HAVE_CURRENT_DATA */) return null;
    if (el.videoWidth === 0 || el.videoHeight === 0) return null;
    try {
      return await createImageBitmap(el);
    } catch {
      return null;
    }
  }

  // ─── Calibration (real Baseline) ───────────────────────────────────────────

  /**
   * Capture a real baseline over `durationMs` by running calibration frames
   * through a DriftAnalyzer. Resolves with the assessed arm chosen from the
   * detected extended arm, and whether calibration succeeded.
   *
   * Falls back to a usable baseline even if the strict calibration check fails,
   * so the workflow never dead-ends — but marks success accordingly.
   */
  async calibrate(
    durationMs: number,
    onProgress?: (pct: number) => void
  ): Promise<{ success: boolean; baseline: Baseline; assessedArm: 'left' | 'right' }> {
    await this.attachStreamToVideo();
    const cv = await this.ensureCvManager();

    const drift = new DriftAnalyzerImpl(this.config);
    drift.startCalibration();

    // Collect frames for the calibration window at ~15 fps. In the front-facing,
    // both-arms test we calibrate BOTH arms and do NOT pre-commit to one assessed
    // arm here — the assessed arm is chosen after the assessment as the arm that
    // actually drifted the most (the clinically significant side).
    const start = performance.now();
    const frames: CVFrameResult[] = [];

    await new Promise<void>((resolve) => {
      const tick = async () => {
        const elapsed = performance.now() - start;
        if (onProgress) onProgress(Math.min(100, Math.round((elapsed / durationMs) * 100)));

        const bitmap = await this.grabFrame();
        if (bitmap && cv.ready) {
          try {
            const frame = await cv.processFrame(bitmap, performance.now());
            drift.addCalibrationFrame(frame);
            frames.push(frame);
          } catch {
            /* dropped/failed frame — ignore */
          }
        }

        if (elapsed >= durationMs) {
          resolve();
          return;
        }
        setTimeout(tick, 66);
      };
      void tick();
    });

    // Default assessed arm until the assessment determines the drifting side.
    this.assessedArm = 'left';

    const result = drift.finalizeCalibration();
    if (result.success) {
      this.baseline = result.baseline;
      return { success: true, baseline: result.baseline, assessedArm: this.assessedArm };
    }

    // Fallback baseline derived from the last valid frame so the flow continues.
    const fallback = this.deriveFallbackBaseline(frames);
    this.baseline = fallback;
    return { success: false, baseline: fallback, assessedArm: this.assessedArm };
  }

  /**
   * Build a minimal but real baseline from the most recent frame that had the
   * assessed-arm pose landmarks, so the assessment can still produce meaningful
   * relative measurements even when the strict calibration check was not met.
   */
  private deriveFallbackBaseline(frames: CVFrameResult[]): Baseline {
    const buildArm = (idx: { s: number; e: number; w: number }) => {
      let arm = {
        shoulderPos: { x: 0, y: 0, z: 0 },
        elbowPos: { x: 0, y: 0, z: 0 },
        wristPos: { x: 0, y: 0, z: 0 },
        normalizedWristHeight: 0,
        elbowExtensionAngle: 180,
        palmOrientationAngle: 0,
        armLength: 0.2,
      };
      for (let i = frames.length - 1; i >= 0; i--) {
        const pose = frames[i].poseLandmarks?.[0];
        if (!pose) continue;
        const s = pose[idx.s];
        const e = pose[idx.e];
        const w = pose[idx.w];
        if (!s || !e || !w) continue;
        const armLength =
          Math.hypot(s.x - e.x, s.y - e.y) + Math.hypot(e.x - w.x, e.y - w.y) || 0.2;
        arm = {
          shoulderPos: { x: s.x, y: s.y, z: s.z ?? 0 },
          elbowPos: { x: e.x, y: e.y, z: e.z ?? 0 },
          wristPos: { x: w.x, y: w.y, z: w.z ?? 0 },
          normalizedWristHeight: w.y,
          elbowExtensionAngle: 180,
          palmOrientationAngle: 0,
          armLength,
        };
        break;
      }
      return arm;
    };

    // Build BOTH arms independently so the front-facing both-arms assessment has
    // a real baseline for each side.
    const leftArm = buildArm({ s: 11, e: 13, w: 15 });
    const rightArm = buildArm({ s: 12, e: 14, w: 16 });

    return {
      leftArm,
      rightArm,
      torsoAngle: 0,
      shoulderWidth: 0.2,
      captureFrameCount: frames.length,
      captureStartTime: Date.now(),
      captureEndTime: Date.now(),
    };
  }

  getBaseline(): Baseline | null {
    return this.baseline;
  }

  /**
   * Recompute a NOISE-ROBUST `possiblePronation` flag from the palm-rotation
   * time series. The analyzer flags pronation from the single extremum frame,
   * which is fooled by an isolated palm-angle spike (hand momentarily edge-on).
   *
   * Here we require the pronation to be SUSTAINED: at least `minSustainedFrames`
   * confident hand frames, and at least `minFraction` of them, must show a
   * rotation in the dominant direction whose magnitude meets `minPronationChange`.
   * When too few hand frames exist to judge, we fall back to the analyzer flag.
   */
  private applyRobustPronation(
    indicators: AssessmentAnalysisResult['indicators']
  ): AssessmentAnalysisResult['indicators'] {
    const samples = indicators.palmRotationChange.samples;
    // Not measurable or too sparse to judge robustly — keep the analyzer flag.
    if (!indicators.palmRotationChange.measurable || samples.length < 6) {
      return indicators;
    }

    const threshold = this.config.get('minPronationChange');
    const total = indicators.totalPalmRotationChangeDegrees ?? 0;
    const sign = Math.sign(total) || 1;

    const sustainedCount = samples.filter((s) => s.value * sign >= threshold).length;
    const fraction = sustainedCount / samples.length;

    const minSustainedFrames = 5;
    const minFraction = 0.4;
    const robustFlag = sustainedCount >= minSustainedFrames && fraction >= minFraction;

    if (robustFlag === indicators.possiblePronation) return indicators;

    // eslint-disable-next-line no-console
    console.info('[PronatorDrift] pronation flag adjusted (noise-robust):', {
      analyzerFlag: indicators.possiblePronation,
      robustFlag,
      sustainedCount,
      totalFrames: samples.length,
      fraction: Math.round(fraction * 100) / 100,
      thresholdDeg: threshold,
    });

    return { ...indicators, possiblePronation: robustFlag };
  }

  // ─── Assessment (real AssessmentLoop) ──────────────────────────────────────

  /**
   * Run the timed assessment for `durationMs`, pumping real camera frames
   * through the AssessmentLoop. Resolves with the finalized analysis result.
   */
  async runAssessment(durationMs: number): Promise<AssessmentAnalysisResult> {
    // Guaranteed entry log so we can always see the assessment kicked off.
    // eslint-disable-next-line no-console
    console.info('[PronatorDrift] runAssessment START', {
      durationMs,
      hasStream: !!this.stream,
      assessedArm: this.assessedArm,
      hasBaseline: !!this.baseline,
    });

    let cv: CVWorkerManager;
    try {
      await this.attachStreamToVideo();
      cv = await this.ensureCvManager();
      // eslint-disable-next-line no-console
      console.info('[PronatorDrift] CV ready', {
        ready: cv.ready,
        fallback: cv.isFallbackMode,
        videoReadyState: this.videoEl?.readyState,
        videoW: this.videoEl?.videoWidth,
        videoH: this.videoEl?.videoHeight,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[PronatorDrift] CV setup FAILED — analysis cannot run:', err);
      throw err;
    }

    const driftAnalyzer = new DriftAnalyzerImpl(this.config);
    const baseline = this.baseline ?? this.deriveFallbackBaseline([]);

    // ── Front-facing both-arms analysis ──────────────────────────────────────
    // Run TWO MicroMovementAnalyzers in parallel — one per arm — so we capture
    // real indicators for BOTH sides. After the run we pick the assessed arm as
    // the side that actually drifted the most (the clinically significant arm),
    // instead of guessing by visibility beforehand.
    const leftMicro = new MicroMovementAnalyzer(this.config);
    const rightMicro = new MicroMovementAnalyzer(this.config);

    // Composite analyzer satisfying the AssessmentLoop's microAnalyzer contract:
    // it fans every frame out to both per-arm analyzers. `finalize()` returns the
    // left arm's indicators as a placeholder; the real per-arm choice happens
    // below after drift is known.
    const compositeMicro = {
      start: (b: Baseline, _arm: 'left' | 'right') => {
        leftMicro.start(b, 'left');
        rightMicro.start(b, 'right');
      },
      addFrame: (frame: CVFrameResult) => {
        leftMicro.addFrame(frame);
        rightMicro.addFrame(frame);
        // Surface the processed frame (with landmarks) to any live observer so
        // the assessment screen can draw pose markers without a second CV pass.
        if (this.frameObserver) {
          try {
            this.frameObserver(frame);
          } catch {
            /* observer errors must never break the analysis loop */
          }
        }
      },
      getCapturedFrames: () => {
        // Report whichever side captured more pose frames so the loop's
        // "no valid assessed-arm frames" check reflects the better-tracked arm.
        const l = leftMicro.getCapturedFrames();
        const r = rightMicro.getCapturedFrames();
        const lPose = l.filter((f) => f.hasPose).length;
        const rPose = r.filter((f) => f.hasPose).length;
        return rPose > lPose ? r : l;
      },
      finalize: () => leftMicro.finalize(),
    } as unknown as MicroMovementAnalyzer;

    // Fresh recording for this run.
    this.recordingManager.reset();

    const loop = new AssessmentLoop({
      cvManager: cv,
      driftAnalyzer,
      microAnalyzer: compositeMicro,
      recordingManager: this.recordingManager,
      config: this.config,
      grabFrame: () => this.grabFrame(),
      recordingStream: this.stream,
      recordingConsented: this.recordingConsented,
    });

    loop.start(baseline, this.assessedArm);

    const start = performance.now();
    let lastLog = start;
    await new Promise<void>((resolve) => {
      const tick = () => {
        loop.tick(performance.now());
        const now = performance.now();
        // Per-~5s heartbeat so we can watch frames accumulate live.
        if (now - lastLog >= 5000) {
          lastLog = now;
          // eslint-disable-next-line no-console
          console.info('[PronatorDrift] progress', {
            elapsedS: Math.round((now - start) / 1000),
            delivered: loop.getDeliveredFrameCount(),
            dropped: loop.getDroppedFrameCount(),
          });
        }
        if (now - start >= durationMs) {
          resolve();
          return;
        }
        setTimeout(tick, 33); // ~30fps ticks; the loop drops extras under load
      };
      tick();
    });

    const rawResult = await loop.finalize();

    // ── Choose the assessed arm from ACTUAL drift ────────────────────────────
    // The clinically significant arm is the one that drifted downward the most.
    // DriftAnalyzer computes drift for both arms every frame, so we pick the side
    // with the larger maximum drift. Ties (or ~zero drift on both) fall back to
    // whichever arm was tracked more confidently.
    const md = rawResult.maxDrift;
    const driftDiff = Math.abs(md.left - md.right);
    let chosenArm: 'left' | 'right';
    if (driftDiff > 1e-4) {
      chosenArm = md.left >= md.right ? 'left' : 'right';
    } else {
      // No meaningful drift difference — use the better-tracked arm.
      const dfAll = rawResult.driftFrames;
      const leftConf = dfAll.reduce((s, f) => s + f.leftConfidence, 0);
      const rightConf = dfAll.reduce((s, f) => s + f.rightConfidence, 0);
      chosenArm = rightConf > leftConf ? 'right' : 'left';
    }

    // Rebuild the indicators for the CHOSEN arm from its own analyzer, and set the
    // assessed arm on the result so buildAssessmentFromAnalysis reports the right
    // side. We also keep BOTH arms' full indicators so the Results screen can show
    // left and right side by side.
    const leftIndicators = leftMicro.finalize();
    const rightIndicators = rightMicro.finalize();
    const chosenIndicators = chosenArm === 'left' ? leftIndicators : rightIndicators;

    // Per-arm wrist-drift time series (normalized) from the DriftAnalyzer frames,
    // which track BOTH arms every frame. The `indicators.wristDrift` placeholder
    // carries no samples, so this is the real source for the drift timeline.
    const t0 = rawResult.driftFrames.length > 0 ? rawResult.driftFrames[0].timestamp : 0;
    this.lastWristDriftSeries = {
      left: rawResult.driftFrames.map((f) => ({
        timestamp: Math.max(0, f.timestamp - t0),
        value: f.leftWristDrift,
      })),
      right: rawResult.driftFrames.map((f) => ({
        timestamp: Math.max(0, f.timestamp - t0),
        value: f.rightWristDrift,
      })),
    };

    this.assessedArm = chosenArm;

    // ── Suppress false pronation from palm-angle noise ───────────────────────
    // The palm-orientation angle estimated from hand landmarks is noisy — a single
    // frame where the hand is momentarily edge-on to the camera can spike by 100°+.
    // The analyzer's `possiblePronation` flag is (per spec) driven by the EXTREMUM
    // of the per-frame series, so one spike can falsely flag pronation. Here, at the
    // app layer, we recompute a robust flag: pronation is reported only when the
    // rotation is SUSTAINED across a meaningful fraction of the confident hand
    // frames (not a lone spike). The analyzer's raw values are left untouched.
    const robustIndicators = this.applyRobustPronation(chosenIndicators);

    // Apply the same noise-robust pronation flag to both arms so the per-arm
    // Results display is consistent with the assessed-arm finding.
    this.lastLeftIndicators = this.applyRobustPronation(leftIndicators);
    this.lastRightIndicators = this.applyRobustPronation(rightIndicators);

    const result: AssessmentAnalysisResult = {
      ...rawResult,
      assessedArm: chosenArm,
      indicators: robustIndicators,
    };

    // ── Valid-frame robustness fix ───────────────────────────────────────────
    // DriftAnalyzer marks a frame "valid" only when NEITHER arm is low-confidence.
    // If one arm dips (e.g. hand briefly out of frame), frames get counted invalid
    // and QualityAssessor's validFramePercentage can fall below the minimum ->
    // "unable_to_assess" even though the assessed arm was tracked fine.
    //
    // Recompute the valid-frame percentage using ASSESSED-ARM confidence only,
    // and, when the assessed arm was actually seen for enough of the window,
    // relax the quality rating so the real indicators are shown.
    const minPoseConfidence = this.config.get('minPoseConfidence');
    const df = result.driftFrames;
    const assessedConfidentFrames = df.filter((f) => {
      const conf = this.assessedArm === 'left' ? f.leftConfidence : f.rightConfidence;
      return conf >= minPoseConfidence;
    }).length;
    const assessedValidPct = df.length > 0 ? (assessedConfidentFrames / df.length) * 100 : 0;

    // Diagnostics so failures are explainable from the browser console.
    // NOTE: assessedArm is ANATOMICAL (the subject's own left/right) because
    // MediaPipe labels pose landmarks anatomically (index 11/13/15 = subject's
    // left arm) regardless of whether the preview is mirrored. The arm is chosen
    // from actual drift, so the reported side reflects the arm that drifted most.
    // eslint-disable-next-line no-console
    console.info(
      '[PronatorDrift] assessment finished:',
      JSON.stringify({
        assessedArm: this.assessedArm,
        armChosenBy: driftDiff > 1e-4 ? 'drift' : 'tracking-confidence',
        deliveredFrames: result.deliveredFrameCount,
        droppedFrames: result.droppedFrameCount,
        totalDriftFrames: df.length,
        assessedConfidentFrames,
        assessedValidPct: Math.round(assessedValidPct),
        strictValidPct: Math.round(result.quality.metrics.validFramePercentage),
        effectiveFrameRate: Math.round(result.effectiveFrameRate * 10) / 10,
        maxDrift: result.maxDrift,
        possiblePronation: result.indicators.possiblePronation,
        palmRotationDeg: result.indicators.totalPalmRotationChangeDegrees,
        baselineArmLength: {
          left: result.baseline.leftArm.armLength,
          right: result.baseline.rightArm.armLength,
        },
      })
    );

    const minValidPct = this.config.get('minValidFramePercentage');
    const patched: AssessmentAnalysisResult = { ...result };

    if (assessedConfidentFrames > 0) {
      // The assessed arm was tracked. Base the quality gate on the assessed arm
      // so a single-arm side view is not spuriously "unable to assess".
      const relaxedPct = Math.max(assessedValidPct, result.quality.metrics.validFramePercentage);
      const overall =
        relaxedPct >= 90 ? 'good' : relaxedPct >= minValidPct ? 'acceptable' : 'low';
      patched.quality = {
        ...result.quality,
        overall,
        metrics: {
          ...result.quality.metrics,
          validFramePercentage: relaxedPct,
        },
        primaryFailureReason: relaxedPct >= minValidPct ? null : result.quality.primaryFailureReason,
      };
      patched.noValidAssessedArmFrames = false;
    }

    this.lastResult = patched;
    return patched;
  }

  getLastResult(): AssessmentAnalysisResult | null {
    return this.lastResult;
  }

  /** Full derived indicators for both arms from the last run (both-arms mode). */
  getLastArmIndicators(): {
    left: MicroMovementIndicators;
    right: MicroMovementIndicators;
  } | null {
    if (!this.lastLeftIndicators || !this.lastRightIndicators) return null;
    return { left: this.lastLeftIndicators, right: this.lastRightIndicators };
  }

  /** Per-arm wrist-drift time series (normalized) from the last run. */
  getLastWristDriftSeries():
    | { left: IndicatorSample[]; right: IndicatorSample[] }
    | null {
    return this.lastWristDriftSeries;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /** Release per-assessment analysis state + recording (keeps camera/CV alive). */
  reset(): void {
    this.baseline = null;
    this.lastResult = null;
    this.lastLeftIndicators = null;
    this.lastRightIndicators = null;
    this.lastWristDriftSeries = null;
    this.recordingManager.reset();
  }

  /** Full teardown: stop camera, destroy CV worker, remove video element. */
  dispose(): void {
    this.reset();
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.cvManager) {
      this.cvManager.destroy();
      this.cvManager = null;
    }
    if (this.videoEl) {
      this.videoEl.srcObject = null;
      this.videoEl.remove();
      this.videoEl = null;
    }
  }
}
