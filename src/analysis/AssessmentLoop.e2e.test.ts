// Feature: pronator-drift-analysis, Task 14.2: end-to-end assessment loop integration test
/**
 * Integration test for the end-to-end assessment loop (Task 14.2).
 *
 * **Validates: Requirements 1.4**
 *
 * This is a REAL integration — not a wiring/mocking test. It constructs:
 *  - a REAL `DriftAnalyzerImpl(config)`,
 *  - a REAL `MicroMovementAnalyzer(config)`,
 *  - a stub `RecordingManager` that returns a `skipped` result (no MediaRecorder
 *    in jsdom, and recording is orthogonal to the analysis path under test),
 *  - a stub `CVWorkerManager` whose `processFrame(bitmap, ts)` resolves scripted
 *    `CVFrameResult`s containing valid assessed-arm pose landmarks (and hands)
 *    that show progressive downward wrist/elbow drift, and
 *  - a `grabFrame` that returns a fake `ImageBitmap`.
 *
 * These are wired into a REAL `AssessmentLoop`. The test calls
 * `start(baseline, assessedArm)`, issues N ticks (awaiting the single-in-flight
 * pump between ticks so each scripted frame is actually delivered), then awaits
 * `finalize()` to obtain an `AssessmentAnalysisResult`. That result is passed to
 * `buildAssessmentFromAnalysis(result, config)` and the resulting
 * `PronatorDriftAssessment` is asserted to be POPULATED with real (non-placeholder)
 * values — i.e. NOT the old `no_significant_drift` / 0.0% placeholder:
 *  - `assessedArm` is set,
 *  - `indicators` are present,
 *  - `analysisMeta.deliveredFrameCount` equals the number of delivered frames,
 *  - at least one real (non-zero) drift/indicator value reflects the scripted motion,
 *  - `overallClassification` is a valid classification derived from the data.
 *
 * The scripted motion crosses `minDriftThreshold` (default 0.03 normalized) so the
 * DriftAnalyzer produces a non-null onset and non-zero max drift. Shoulders and hips
 * are held fixed so torso compensation and camera movement stay ~0 and every frame
 * is valid (visibility >= 0.9 >> minPoseConfidence 0.5), giving a 100% valid-frame
 * rate that is above `minValidFramePercentage`.
 */

import { describe, it, expect } from 'vitest';
import { AssessmentLoop, type AssessmentLoopDeps } from './AssessmentLoop';
import { DriftAnalyzerImpl } from './DriftAnalyzer';
import { MicroMovementAnalyzer } from './MicroMovementAnalyzer';
import { buildAssessmentFromAnalysis } from './buildAssessmentFromAnalysis';
import { ConfigStore } from '../config/ConfigStore';
import type { RecordingManager, RecordingResult } from './RecordingManager';
import type {
  Baseline,
  CVFrameResult,
  Handedness,
  NormalizedLandmark,
  OverallClassification,
} from '../types';

// ─── Landmark construction helpers ──────────────────────────────────────────

/** Create a normalized landmark with a given position and (high) visibility. */
function makeLandmark(
  x: number,
  y: number,
  z = 0,
  visibility = 0.95
): NormalizedLandmark {
  return { x, y, z, visibility };
}

/**
 * Build a complete 33-point pose landmark set. Shoulders/elbows/hips are held at
 * fixed positions (so torso compensation and camera movement stay ~0); the assessed
 * (right) arm's wrist and elbow drop by `wristDrop` / `elbowDrop` (normalized image
 * units, y increases downward) to script progressive downward drift.
 *
 * Right-arm indices (MediaPipe): shoulder 12, elbow 14, wrist 16, hip 24.
 * Baseline right shoulder x=0.4, wrist x=0.2 => horizontal arm length 0.2 (matches
 * the baseline armLength below), and baseline wrist/elbow y = 0.4.
 */
function makePoseLandmarks(wristDrop: number, elbowDrop: number): NormalizedLandmark[] {
  const vis = 0.95;
  const landmarks: NormalizedLandmark[] = Array.from({ length: 33 }, () =>
    makeLandmark(0.5, 0.5, 0, vis)
  );

  // Shoulders (fixed).
  landmarks[11] = makeLandmark(0.6, 0.4, 0, vis); // left shoulder
  landmarks[12] = makeLandmark(0.4, 0.4, 0, vis); // right shoulder (assessed)

  // Elbows: left fixed; right (assessed) drops progressively.
  landmarks[13] = makeLandmark(0.7, 0.4, 0, vis); // left elbow
  landmarks[14] = makeLandmark(0.3, 0.4 + elbowDrop, 0, vis); // right elbow (assessed)

  // Wrists: left fixed; right (assessed) drops progressively.
  landmarks[15] = makeLandmark(0.8, 0.4, 0, vis); // left wrist
  landmarks[16] = makeLandmark(0.2, 0.4 + wristDrop, 0, vis); // right wrist (assessed)

  // Hips (fixed).
  landmarks[23] = makeLandmark(0.55, 0.7, 0, vis); // left hip
  landmarks[24] = makeLandmark(0.45, 0.7, 0, vis); // right hip

  return landmarks;
}

/**
 * Build a 21-point hand landmark set for the assessed (right) hand. The palm is
 * progressively rotated by nudging the z of the middle-MCP by `pronation`, which
 * changes the cross-product palm normal and therefore the palm-orientation angle,
 * scripting a monotonic rotation trend.
 */
function makeHandLandmarks(pronation: number): NormalizedLandmark[] {
  const vis = 0.95;
  const hand: NormalizedLandmark[] = Array.from({ length: 21 }, () =>
    makeLandmark(0.2, 0.42, 0, vis)
  );
  // Wrist (0) + finger MCPs (5/9/13/17) + fingertips (4/8/12/16/20) laid out so
  // palm angle, finger curl, and finger spread are all well-defined.
  hand[0] = makeLandmark(0.2, 0.45, 0, vis); // hand wrist
  hand[5] = makeLandmark(0.22, 0.4, 0, vis); // index MCP
  hand[9] = makeLandmark(0.2, 0.39, pronation, vis); // middle MCP (z nudged for rotation)
  hand[13] = makeLandmark(0.18, 0.4, 0, vis); // ring MCP
  hand[17] = makeLandmark(0.16, 0.41, 0, vis); // pinky MCP
  // Fingertips extended beyond their MCPs.
  hand[4] = makeLandmark(0.24, 0.36, 0, vis); // thumb tip
  hand[8] = makeLandmark(0.23, 0.34, 0, vis); // index tip
  hand[12] = makeLandmark(0.2, 0.33, 0, vis); // middle tip
  hand[16] = makeLandmark(0.17, 0.34, 0, vis); // ring tip
  hand[20] = makeLandmark(0.15, 0.35, 0, vis); // pinky tip
  return hand;
}

/** Build a scripted CVFrameResult with assessed-arm pose + hand landmarks. */
function makeFrame(
  timestamp: number,
  wristDrop: number,
  elbowDrop: number,
  pronation: number
): CVFrameResult {
  const handedness: Handedness[] = [{ label: 'Right', score: 0.98 }];
  return {
    timestamp,
    poseLandmarks: [makePoseLandmarks(wristDrop, elbowDrop)],
    poseWorldLandmarks: null,
    handLandmarks: [makeHandLandmarks(pronation)],
    handedness,
    processingTimeMs: 8,
  };
}

/**
 * A baseline matching the fixed landmark positions above. The assessed (right) arm
 * has armLength 0.2 and baseline wrist/elbow y = 0.4, so a wrist drop of d units
 * produces normalized drift d / 0.2. A drop of 0.05 => 0.25 normalized, well above
 * the 0.03 minDriftThreshold.
 */
function makeBaseline(): Baseline {
  return {
    leftArm: {
      shoulderPos: { x: 0.6, y: 0.4, z: 0 },
      elbowPos: { x: 0.7, y: 0.4, z: 0 },
      wristPos: { x: 0.8, y: 0.4, z: 0 },
      normalizedWristHeight: 0,
      elbowExtensionAngle: 180,
      palmOrientationAngle: 0,
      armLength: 0.2,
    },
    rightArm: {
      shoulderPos: { x: 0.4, y: 0.4, z: 0 },
      elbowPos: { x: 0.3, y: 0.4, z: 0 },
      wristPos: { x: 0.2, y: 0.4, z: 0 },
      normalizedWristHeight: 0,
      elbowExtensionAngle: 180,
      palmOrientationAngle: 0,
      armLength: 0.2,
    },
    torsoAngle: 0,
    shoulderWidth: 0.2,
    captureFrameCount: 20,
    captureStartTime: 0,
    captureEndTime: 2000,
  };
}

/** Flush pending microtasks so the fire-and-forget pump settles between ticks. */
async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

/** All valid overall classification values (for a "derived from data" sanity check). */
const VALID_CLASSIFICATIONS: OverallClassification[] = [
  'no_significant_drift',
  'possible_left_pronator_drift',
  'possible_right_pronator_drift',
  'possible_bilateral_drift',
  'drift_without_clear_pronation',
  'possible_pronation_without_drift',
  'unable_to_assess',
];

// ─── Test ────────────────────────────────────────────────────────────────────

describe('AssessmentLoop end-to-end integration (Task 14.2)', () => {
  it('produces a populated PronatorDriftAssessment with real (non-placeholder) values', async () => {
    const config = new ConfigStore();
    const baseline = makeBaseline();
    const assessedArm = 'right' as const;

    // ── Script the frames: progressive downward drift + monotonic pronation ──
    // 18 frames at 10fps (100ms apart), starting at t=3000ms. Wrist/elbow drop
    // grows linearly from 0 to ~0.06 units (normalized up to ~0.3), crossing the
    // 0.03 minDriftThreshold partway through so onset is non-null and the sustained
    // run (well over minDriftDuration=2s) is detected.
    const FRAME_COUNT = 18;
    const START_TS = 3000;
    const FRAME_INTERVAL = 100;
    const frames: CVFrameResult[] = Array.from({ length: FRAME_COUNT }, (_, i) => {
      const progress = i / (FRAME_COUNT - 1); // 0 .. 1
      const wristDrop = progress * 0.06; // up to 0.30 normalized
      const elbowDrop = progress * 0.04; // up to 0.20 normalized
      const pronation = progress * 0.05; // grows z -> monotonic palm rotation
      return makeFrame(START_TS + i * FRAME_INTERVAL, wristDrop, elbowDrop, pronation);
    });

    // ── Stub CVWorkerManager: resolves the next scripted frame per call ──
    let cursor = 0;
    const cvManager = {
      processFrame: async (_bitmap: ImageBitmap, _ts: number): Promise<CVFrameResult> => {
        const frame = frames[Math.min(cursor, frames.length - 1)];
        cursor += 1;
        return frame;
      },
    } as unknown as AssessmentLoopDeps['cvManager'];

    // ── Stub RecordingManager: skipped (no MediaRecorder in jsdom) ──
    const skippedRecording: RecordingResult = {
      status: 'skipped',
      blob: null,
      objectUrl: null,
      mimeType: null,
      reason: 'not_started',
    };
    const recordingManager = {
      start: () => {},
      stop: async () => skippedRecording,
      getRecording: () => null,
      delete: () => {},
      reset: () => {},
    } as unknown as RecordingManager;

    // ── grabFrame returns a fake ImageBitmap ──
    const grabFrame = async (): Promise<ImageBitmap> => ({}) as unknown as ImageBitmap;

    // ── REAL analyzers ──
    const driftAnalyzer = new DriftAnalyzerImpl(config);
    const microAnalyzer = new MicroMovementAnalyzer(config);

    // Injectable clock: advance so the effective frame rate is realistic (~10 fps)
    // and duration is > 0. The loop uses now() at start() and finalize().
    let clock = START_TS;
    const now = () => clock;

    const deps: AssessmentLoopDeps = {
      cvManager,
      driftAnalyzer,
      microAnalyzer,
      recordingManager,
      config,
      grabFrame,
      recordingStream: null,
      recordingConsented: false,
      now,
    };

    const loop = new AssessmentLoop(deps);

    // ── Drive the loop ──
    loop.start(baseline, assessedArm);

    for (let i = 0; i < FRAME_COUNT; i++) {
      clock = START_TS + i * FRAME_INTERVAL;
      loop.tick(clock);
      // Await the single-in-flight pump so this scripted frame is delivered before
      // the next tick fires (otherwise it would be dropped under backpressure).
      await flush();
    }

    // Advance the clock to the end of the window so duration > 0.
    clock = START_TS + FRAME_COUNT * FRAME_INTERVAL;

    const result = await loop.finalize();

    // ── Sanity: every scripted frame was delivered to the analyzers ──
    expect(loop.getDeliveredFrameCount()).toBe(FRAME_COUNT);
    expect(loop.getDroppedFrameCount()).toBe(0);
    expect(result.deliveredFrameCount).toBe(FRAME_COUNT);
    expect(result.driftFrames.length).toBe(FRAME_COUNT);

    // The DriftAnalyzer saw the scripted downward motion.
    expect(result.maxDrift.right).toBeGreaterThan(0.03);
    expect(result.driftOnset.right).not.toBeNull();

    // ── Build the assessment from the analysis ──
    const assessment = buildAssessmentFromAnalysis(result, config);

    // ── Populated (non-placeholder) assertions ──
    // assessedArm is set.
    expect(assessment.assessedArm).toBe('right');

    // Indicators are present.
    expect(assessment.indicators).toBeDefined();
    expect(assessment.indicators!.assessedArm).toBe('right');

    // analysisMeta.deliveredFrameCount === number of delivered frames.
    expect(assessment.analysisMeta).toBeDefined();
    expect(assessment.analysisMeta!.deliveredFrameCount).toBe(FRAME_COUNT);

    // Norm comparisons were attached.
    expect(Array.isArray(assessment.normComparisons)).toBe(true);
    expect(assessment.normComparisons!.length).toBeGreaterThan(0);

    // The assessed (right) arm carries real, non-zero drift derived from the motion
    // (the old placeholder always produced 0.0). Onset is a real time in seconds.
    expect(assessment.rightArm.maximumDownwardDriftNormalised).toBeGreaterThan(0.03);
    expect(assessment.rightArm.driftOnsetSeconds).not.toBeNull();

    // At least one real (non-zero) indicator value reflects the scripted motion.
    const indicators = assessment.indicators!;
    const nonZeroSignals = [
      assessment.rightArm.maximumDownwardDriftNormalised,
      indicators.elbowDrift.summary.max ?? 0,
      indicators.maxElbowFlexionChangeDegrees,
      Math.abs(indicators.totalPalmRotationChangeDegrees ?? 0),
    ];
    expect(nonZeroSignals.some((v) => v > 0)).toBe(true);

    // Elbow drift indicator is measurable with a non-zero maximum (scripted elbow drop).
    expect(indicators.elbowDrift.measurable).toBe(true);
    expect(indicators.elbowDrift.summary.max ?? 0).toBeGreaterThan(0);

    // Hand-dependent indicators are measurable (we supplied hand landmarks) and the
    // pose-only path was NOT used.
    expect(indicators.usedPoseOnlyPath).toBe(false);
    expect(indicators.palmRotationChange.measurable).toBe(true);

    // overallClassification is a valid classification derived from the data. With a
    // strong sustained right-arm drift and a fully-valid frame stream, it must NOT
    // be the old placeholder-forced `no_significant_drift`, and NOT `unable_to_assess`.
    expect(VALID_CLASSIFICATIONS).toContain(assessment.overallClassification);
    expect(assessment.overallClassification).not.toBe('unable_to_assess');
    expect(assessment.overallClassification).not.toBe('no_significant_drift');

    // Quality reflects a fully-valid stream (100% valid frames > minValidFramePercentage).
    expect(assessment.quality.metrics.validFramePercentage).toBeGreaterThanOrEqual(
      config.get('minValidFramePercentage')
    );
  });
});
