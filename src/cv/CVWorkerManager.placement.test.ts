/**
 * Integration / placement smoke test for CVWorkerManager — Task 14.4.
 *
 * Goal (Req 17.1): confirm that landmark detection is *routed through the Web
 * Worker path* when Worker + OffscreenCanvas are available, or through the
 * documented main-thread fallback when they are not — WITHOUT blocking the
 * main thread.
 *
 * Why this is a smoke/placement test, not a full inference test:
 *   A real MediaPipe worker (WASM + GPU) cannot run inside jsdom, and Vite's
 *   `new Worker(new URL('./cv-worker.ts', import.meta.url), { type: 'module' })`
 *   import pattern does not spin up a real worker under Vitest/jsdom. So instead
 *   of asserting inference output, we assert the *routing decision*:
 *     1. isWorkerSupported() reflects the environment (Worker present => true;
 *        deleted => false).
 *     2. When Worker is available, the manager constructs a Worker and drives
 *        initialization through worker messaging (worker path) rather than doing
 *        synchronous main-thread inference.
 *     3. When Worker is unavailable, the manager selects the documented
 *        main-thread fallback (isFallbackMode === true after initialize).
 *     4. processFrame() returns a Promise (async, non-blocking) — heavy
 *        inference is dispatched off the caller's synchronous path, documenting
 *        that per Req 17.1 the main-thread UI is not blocked.
 *
 * Limitation (documented): We cannot observe the real worker executing MediaPipe
 * inference in jsdom. We therefore verify that the manager *hands the frame to
 * the worker via postMessage with a transferable* (worker path) instead of
 * running detection inline. The actual off-thread execution is guaranteed by the
 * browser Worker contract, exercised in E2E, not here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CVWorkerManager, isWorkerSupported, CVWorkerManagerConfig } from './CVWorkerManager';

const testConfig: CVWorkerManagerConfig = {
  poseModelPath: '/models/pose_landmarker_lite.task',
  handModelPath: '/models/hand_landmarker.task',
  minPoseConfidence: 0.5,
  minHandConfidence: 0.5,
  numPoses: 1,
};

// ─── Fake Worker that captures construction + messaging ──────────────────────

/**
 * Records every FakeWorker constructed and the messages posted to it, so the
 * test can assert the manager routed work to a Worker (off-main-thread path)
 * rather than running inference synchronously.
 */
interface WorkerCall {
  url: unknown;
  options: unknown;
  posted: Array<{ message: unknown; transfer?: unknown[] }>;
}

const workerCalls: WorkerCall[] = [];

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  private readonly record: WorkerCall;

  constructor(url: unknown, options: unknown) {
    this.record = { url, options, posted: [] };
    workerCalls.push(this.record);
  }

  postMessage(message: unknown, transfer?: unknown[]): void {
    this.record.posted.push({ message, transfer });

    // Simulate the worker's async responses without blocking the main thread.
    // The real cv-worker replies with 'ready' after init and 'result' per frame.
    const msg = message as { type?: string; timestamp?: number };
    if (msg?.type === 'init') {
      queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } } as MessageEvent));
    } else if (msg?.type === 'processFrame') {
      queueMicrotask(() =>
        this.onmessage?.({
          data: {
            type: 'result',
            data: {
              timestamp: msg.timestamp ?? 0,
              poseLandmarks: null,
              poseWorldLandmarks: null,
              handLandmarks: null,
              handedness: null,
              processingTimeMs: 1,
            },
          },
        } as MessageEvent)
      );
    }
  }

  terminate(): void {}
}

class FakeOffscreenCanvas {}

describe('CVWorkerManager placement / worker-routing smoke test (Req 17.1)', () => {
  let originalWorker: typeof globalThis.Worker;
  let originalOffscreenCanvas: typeof globalThis.OffscreenCanvas;

  beforeEach(() => {
    originalWorker = globalThis.Worker;
    originalOffscreenCanvas = globalThis.OffscreenCanvas;
    workerCalls.length = 0;
  });

  afterEach(() => {
    globalThis.Worker = originalWorker;
    globalThis.OffscreenCanvas = originalOffscreenCanvas;
    vi.restoreAllMocks();
  });

  // ─── isWorkerSupported reflects the environment ────────────────────────────

  it('isWorkerSupported() is true when Worker + OffscreenCanvas exist', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Worker = FakeWorker;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).OffscreenCanvas = FakeOffscreenCanvas;

    expect(isWorkerSupported()).toBe(true);
  });

  it('isWorkerSupported() is false when Worker is deleted', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).Worker;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).OffscreenCanvas = FakeOffscreenCanvas;

    expect(isWorkerSupported()).toBe(false);
  });

  // ─── Worker path: detection is routed through the worker ───────────────────

  it('routes detection through the Worker (not synchronous main thread) when supported', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Worker = FakeWorker;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).OffscreenCanvas = FakeOffscreenCanvas;

    const manager = new CVWorkerManager();

    await manager.initialize(testConfig);

    // A Worker was constructed => detection is placed off the main thread.
    expect(workerCalls.length).toBe(1);
    // The Vite module-worker options were used (worker path, not fallback).
    expect(workerCalls[0].options).toMatchObject({ type: 'module' });
    // Manager reports it is NOT in fallback mode and is ready via worker messaging.
    expect(manager.isFallbackMode).toBe(false);
    expect(manager.ready).toBe(true);
    // Init was driven by posting an 'init' message to the worker.
    expect(
      workerCalls[0].posted.some((p) => (p.message as { type?: string })?.type === 'init')
    ).toBe(true);

    manager.destroy();
  });

  it('processFrame() dispatches the frame to the worker via transferable postMessage (off-thread)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Worker = FakeWorker;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).OffscreenCanvas = FakeOffscreenCanvas;

    const manager = new CVWorkerManager();
    await manager.initialize(testConfig);

    const mockBitmap = { close: vi.fn() } as unknown as ImageBitmap;

    // processFrame must return a Promise — the synchronous call site is not
    // blocked by inference; work is handed to the worker and awaited (Req 17.1).
    const pending = manager.processFrame(mockBitmap, 123);
    expect(pending).toBeInstanceOf(Promise);

    const result = await pending;
    expect(result.timestamp).toBe(123);

    // The frame was posted to the worker as a transferable (zero-copy handoff),
    // confirming heavy work is routed off the main thread rather than run inline.
    const frameCall = workerCalls[0].posted.find(
      (p) => (p.message as { type?: string })?.type === 'processFrame'
    );
    expect(frameCall).toBeDefined();
    expect(frameCall?.transfer).toEqual([mockBitmap]);

    manager.destroy();
  });

  // ─── Fallback path: documented main-thread fallback ────────────────────────

  it('selects the documented main-thread fallback when Worker is unavailable', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).Worker;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).OffscreenCanvas;

    // Minimally mock the MediaPipe main-thread init so the fallback branch can
    // complete without loading real WASM/GPU assets (unavailable in jsdom).
    vi.doMock('@mediapipe/tasks-vision', () => {
      const fakeLandmarker = {
        detectForVideo: () => ({ landmarks: [], worldLandmarks: [], handedness: [] }),
        close: () => {},
      };
      return {
        FilesetResolver: { forVisionTasks: async () => ({}) },
        PoseLandmarker: { createFromOptions: async () => fakeLandmarker },
        HandLandmarker: { createFromOptions: async () => fakeLandmarker },
      };
    });

    // Re-import the module under the mock so the dynamic import resolves to it.
    const { CVWorkerManager: MockedManager } = await import('./CVWorkerManager');
    const manager = new MockedManager();

    await manager.initialize(testConfig);

    // No Worker was constructed; the manager took the documented fallback.
    expect(workerCalls.length).toBe(0);
    expect(manager.isFallbackMode).toBe(true);
    expect(manager.ready).toBe(true);

    manager.destroy();
    vi.doUnmock('@mediapipe/tasks-vision');
  });
});
