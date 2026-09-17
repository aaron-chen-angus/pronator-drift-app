/**
 * Unit tests for AssessmentLoop wiring (Task 10.2).
 *
 * These tests drive the AssessmentLoop against vi.fn spies for every dependency
 * so we can assert the wiring contract without any real CV / recording work:
 * - `start()` calls `driftAnalyzer.startAssessment(baseline)` BEFORE the first
 *   frame is forwarded to `addAssessmentFrame` (Req 1.1). Ordering is verified via
 *   `vi.fn` invocation-order counters.
 * - Each resolved `CVFrameResult` from the single-in-flight pump is forwarded to
 *   BOTH `driftAnalyzer.addAssessmentFrame` (Req 1.2) and `microAnalyzer.addFrame`
 *   (Req 1.3), with the exact resolved frame object.
 * - Multiple sequential ticks each forward their resolved frame to both analyzers,
 *   preserving order.
 *
 * The pump started by `tick()` is asynchronous (grabFrame -> processFrame), so we
 * flush the microtask queue between assertions.
 *
 * Validates: Requirements 1.1, 1.2, 1.3
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AssessmentLoop, type AssessmentLoopDeps } from './AssessmentLoop';
import { ConfigStore } from '../config/ConfigStore';
import type {
  Baseline,
  CVFrameResult,
  DriftFrame,
  ArmBaseline,
} from '../types';
import type { RecordingResult } from './RecordingManager';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** A minimal per-arm baseline; exact values are irrelevant to wiring tests. */
function makeArmBaseline(): ArmBaseline {
  return {
    shoulderPos: { x: 0, y: 0, z: 0 },
    elbowPos: { x: 0, y: 0.2, z: 0 },
    wristPos: { x: 0, y: 0.4, z: 0 },
    normalizedWristHeight: 0.4,
    elbowExtensionAngle: 170,
    palmOrientationAngle: 0,
    armLength: 0.4,
  };
}

function makeBaseline(): Baseline {
  return {
    leftArm: makeArmBaseline(),
    rightArm: makeArmBaseline(),
    torsoAngle: 0,
    shoulderWidth: 0.3,
    captureFrameCount: 30,
    captureStartTime: 0,
    captureEndTime: 2000,
  };
}

/** A scripted CV frame result; identity is what matters for forwarding assertions. */
function makeFrame(timestamp: number): CVFrameResult {
  return {
    timestamp,
    poseLandmarks: [[]],
    poseWorldLandmarks: null,
    handLandmarks: null,
    handedness: null,
    processingTimeMs: 5,
  };
}

/** Flush pending microtasks so the fire-and-forget pump settles. */
async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

// ─── Mock builders ──────────────────────────────────────────────────────────

interface Harness {
  loop: AssessmentLoop;
  deps: AssessmentLoopDeps;
  spies: {
    startAssessment: ReturnType<typeof vi.fn>;
    addAssessmentFrame: ReturnType<typeof vi.fn>;
    microStart: ReturnType<typeof vi.fn>;
    microAddFrame: ReturnType<typeof vi.fn>;
    processFrame: ReturnType<typeof vi.fn>;
    grabFrame: ReturnType<typeof vi.fn>;
    recordingStart: ReturnType<typeof vi.fn>;
    recordingStop: ReturnType<typeof vi.fn>;
  };
}

/**
 * Build an AssessmentLoop with fully-mocked dependencies.
 *
 * `frames` scripts the sequence of CVFrameResults that `cvManager.processFrame`
 * resolves — one per successful tick, consumed in order.
 */
function makeHarness(frames: CVFrameResult[]): Harness {
  const startAssessment = vi.fn();
  const addAssessmentFrame = vi.fn();
  const microStart = vi.fn();
  const microAddFrame = vi.fn();

  // processFrame resolves the next scripted frame each call.
  let frameCursor = 0;
  const processFrame = vi.fn(async (_bitmap: ImageBitmap, _ts: number) => {
    const frame = frames[Math.min(frameCursor, frames.length - 1)];
    frameCursor += 1;
    return frame;
  });

  // grabFrame returns a placeholder bitmap (identity is irrelevant here).
  const grabFrame = vi.fn(async () => ({}) as unknown as ImageBitmap);

  const recordingStart = vi.fn();
  const recordingResult: RecordingResult = {
    status: 'skipped',
    blob: null,
    objectUrl: null,
    mimeType: null,
    reason: 'not_started',
  };
  const recordingStop = vi.fn(async () => recordingResult);

  const driftAnalyzer = {
    startCalibration: vi.fn(),
    addCalibrationFrame: vi.fn(),
    finalizeCalibration: vi.fn(),
    startAssessment,
    addAssessmentFrame,
    getCurrentDrift: vi.fn(() => ({ left: 0, right: 0 })),
    getDriftTimeSeries: vi.fn((): DriftFrame[] => []),
    getMaxDrift: vi.fn(() => ({ left: 0, right: 0 })),
    getDriftOnset: vi.fn(() => ({ left: null, right: null })),
  };

  const microAnalyzer = {
    start: microStart,
    addFrame: microAddFrame,
    finalize: vi.fn(),
    getCapturedFrames: vi.fn(() => []),
  };

  const recordingManager = {
    start: recordingStart,
    stop: recordingStop,
    getRecording: vi.fn(() => null),
    delete: vi.fn(),
    reset: vi.fn(),
  };

  const cvManager = {
    processFrame,
  };

  const deps = {
    cvManager,
    driftAnalyzer,
    microAnalyzer,
    recordingManager,
    config: new ConfigStore(),
    grabFrame,
    recordingStream: null,
    recordingConsented: false,
    now: () => 0,
  } as unknown as AssessmentLoopDeps;

  return {
    loop: new AssessmentLoop(deps),
    deps,
    spies: {
      startAssessment,
      addAssessmentFrame,
      microStart,
      microAddFrame,
      processFrame,
      grabFrame,
      recordingStart,
      recordingStop,
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AssessmentLoop wiring', () => {
  let baseline: Baseline;

  beforeEach(() => {
    baseline = makeBaseline();
  });

  describe('start ordering (Req 1.1)', () => {
    it('calls startAssessment(baseline) before delivering the first frame', async () => {
      const frame = makeFrame(100);
      const { loop, spies } = makeHarness([frame]);

      loop.start(baseline, 'left');

      // startAssessment ran synchronously in start(), before any frame processing.
      expect(spies.startAssessment).toHaveBeenCalledTimes(1);
      expect(spies.startAssessment).toHaveBeenCalledWith(baseline);
      expect(spies.microStart).toHaveBeenCalledWith(baseline, 'left');
      // No frame has been forwarded yet.
      expect(spies.addAssessmentFrame).not.toHaveBeenCalled();
      expect(spies.microAddFrame).not.toHaveBeenCalled();

      // Now drive one tick and let the pump settle.
      loop.tick(100);
      await flush();

      expect(spies.addAssessmentFrame).toHaveBeenCalledTimes(1);

      // Invocation-order check: startAssessment strictly precedes the first
      // addAssessmentFrame call (Req 1.1).
      const startOrder = spies.startAssessment.mock.invocationCallOrder[0];
      const firstFrameOrder = spies.addAssessmentFrame.mock.invocationCallOrder[0];
      expect(startOrder).toBeLessThan(firstFrameOrder);
    });
  });

  describe('single-frame forwarding (Req 1.2, 1.3)', () => {
    it('forwards the resolved CVFrameResult to both analyzers', async () => {
      const frame = makeFrame(250);
      const { loop, spies } = makeHarness([frame]);

      loop.start(baseline, 'right');
      loop.tick(250);
      await flush();

      // The exact resolved frame is forwarded to the drift analyzer (Req 1.2)...
      expect(spies.addAssessmentFrame).toHaveBeenCalledTimes(1);
      expect(spies.addAssessmentFrame).toHaveBeenCalledWith(frame);

      // ...and to the micro-movement analyzer (Req 1.3).
      expect(spies.microAddFrame).toHaveBeenCalledTimes(1);
      expect(spies.microAddFrame).toHaveBeenCalledWith(frame);

      // Delivered-frame count reflects the single delivery (Req 1.6 sanity).
      expect(loop.getDeliveredFrameCount()).toBe(1);
    });

    it('forwards to addAssessmentFrame before microAnalyzer.addFrame for a frame', async () => {
      const frame = makeFrame(300);
      const { loop, spies } = makeHarness([frame]);

      loop.start(baseline, 'left');
      loop.tick(300);
      await flush();

      const driftOrder = spies.addAssessmentFrame.mock.invocationCallOrder[0];
      const microOrder = spies.microAddFrame.mock.invocationCallOrder[0];
      expect(driftOrder).toBeLessThan(microOrder);
    });
  });

  describe('multi-frame forwarding (Req 1.2, 1.3)', () => {
    it('forwards each resolved frame from sequential ticks to both analyzers in order', async () => {
      const frames = [makeFrame(100), makeFrame(200), makeFrame(300)];
      const { loop, spies } = makeHarness(frames);

      loop.start(baseline, 'left');

      // Drive three sequential ticks, awaiting the pump between each so no tick is
      // dropped under the single-in-flight backpressure guard.
      for (let i = 0; i < frames.length; i++) {
        loop.tick(frames[i].timestamp);
        await flush();
      }

      // Every scripted frame was forwarded to both analyzers, in delivery order.
      expect(spies.addAssessmentFrame).toHaveBeenCalledTimes(frames.length);
      expect(spies.microAddFrame).toHaveBeenCalledTimes(frames.length);

      const driftForwarded = spies.addAssessmentFrame.mock.calls.map((c) => c[0]);
      const microForwarded = spies.microAddFrame.mock.calls.map((c) => c[0]);
      expect(driftForwarded).toEqual(frames);
      expect(microForwarded).toEqual(frames);

      expect(loop.getDeliveredFrameCount()).toBe(frames.length);
    });

    it('keeps startAssessment before every forwarded frame across the session', async () => {
      const frames = [makeFrame(100), makeFrame(200)];
      const { loop, spies } = makeHarness(frames);

      loop.start(baseline, 'right');
      for (const f of frames) {
        loop.tick(f.timestamp);
        await flush();
      }

      const startOrder = spies.startAssessment.mock.invocationCallOrder[0];
      for (const order of spies.addAssessmentFrame.mock.invocationCallOrder) {
        expect(startOrder).toBeLessThan(order);
      }
      for (const order of spies.microAddFrame.mock.invocationCallOrder) {
        expect(startOrder).toBeLessThan(order);
      }
    });
  });

  describe('backpressure interaction with forwarding (Req 1.2, 1.3)', () => {
    it('drops a tick fired while one is in flight and forwards only delivered frames', async () => {
      const frames = [makeFrame(100), makeFrame(200)];
      const { loop, spies } = makeHarness(frames);

      loop.start(baseline, 'left');

      // First tick starts the async pump (inFlight = true). A second tick fired
      // immediately (before flushing) is dropped, not forwarded.
      loop.tick(100);
      loop.tick(150); // dropped under backpressure
      await flush();

      expect(spies.addAssessmentFrame).toHaveBeenCalledTimes(1);
      expect(spies.microAddFrame).toHaveBeenCalledTimes(1);
      expect(loop.getDroppedFrameCount()).toBe(1);
      expect(loop.getDeliveredFrameCount()).toBe(1);
    });
  });
});
