// Feature: pronator-drift-analysis, Property 28: Frame processing backpressure is bounded
//
// Property 28: Frame processing backpressure is bounded.
// Validates: Requirements 17.2
//
// For any burst of assessment ticks arriving faster than frames can be processed,
// the AssessmentLoop keeps at most ONE frame in flight (single-in-flight) and drops
// excess ticks — counting them as droppedFrameCount — rather than growing an
// unbounded queue.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { AssessmentLoop, type AssessmentLoopDeps } from './AssessmentLoop';
import type { Baseline, CVFrameResult } from '../types';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** A controllable deferred promise used to hold a frame "in flight". */
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

function makeDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flush pending microtasks so awaited promises inside the pump can settle. */
async function flushMicrotasks(): Promise<void> {
  // A few awaits are enough to drain the pump's `await grabFrame()` +
  // `await processFrame()` chain and the trailing `finally`.
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

/** Minimal fake CVFrameResult; contents are irrelevant to backpressure. */
function makeFrameResult(timestamp: number): CVFrameResult {
  return {
    timestamp,
    poseLandmarks: null,
    poseWorldLandmarks: null,
    handLandmarks: null,
    handedness: null,
    processingTimeMs: 1,
  };
}

/** A do-nothing baseline; the loop only stores it, backpressure ignores it. */
function makeBaseline(): Baseline {
  return {} as Baseline;
}

/** Fake bitmap object returned by grabFrame. */
const FAKE_BITMAP = {} as ImageBitmap;

/**
 * Build an AssessmentLoop whose `cvManager.processFrame` is a controllable
 * deferred. Each call to processFrame:
 *   - increments a live concurrency counter (tracking max observed concurrency),
 *   - records the invocation,
 *   - returns a fresh deferred promise the test resolves to release the frame.
 */
function buildHarness() {
  let concurrent = 0;
  let maxConcurrent = 0;
  let processFrameCalls = 0;
  // Queue of deferreds, one per outstanding processFrame invocation.
  const pending: Deferred<CVFrameResult>[] = [];

  const deps: AssessmentLoopDeps = {
    cvManager: {
      processFrame: (_bitmap: ImageBitmap, ts: number): Promise<CVFrameResult> => {
        processFrameCalls += 1;
        concurrent += 1;
        if (concurrent > maxConcurrent) maxConcurrent = concurrent;

        const d = makeDeferred<CVFrameResult>();
        // Wrap so that when the deferred settles, we decrement the counter
        // (the frame is no longer "in flight" from processFrame's perspective).
        const tracked = d.promise.then(
          (r) => {
            concurrent -= 1;
            return r;
          },
          (e) => {
            concurrent -= 1;
            throw e;
          }
        );
        // Store a deferred whose resolve/reject drive the tracked promise, but
        // hand the loop the *tracked* promise so decrement happens on settle.
        pending.push({
          promise: tracked,
          resolve: (v) => d.resolve(v),
          reject: (e) => d.reject(e),
        });
        // Return the tracked promise (decrements concurrency when settled),
        // but with the frame timestamp baked into the eventual resolution.
        void ts;
        return tracked;
      },
    } as unknown as AssessmentLoopDeps['cvManager'],

    driftAnalyzer: {
      startAssessment: () => {},
      addAssessmentFrame: () => {},
      getDriftTimeSeries: () => [],
      getMaxDrift: () => ({ left: 0, right: 0 }),
      getDriftOnset: () => ({ left: null, right: null }),
    } as unknown as AssessmentLoopDeps['driftAnalyzer'],

    microAnalyzer: {
      start: () => {},
      addFrame: () => {},
      finalize: () => ({}) as never,
      getCapturedFrames: () => [],
    } as unknown as AssessmentLoopDeps['microAnalyzer'],

    recordingManager: {
      start: () => {},
      stop: async () => ({ status: 'skipped' }) as never,
    } as unknown as AssessmentLoopDeps['recordingManager'],

    config: {} as AssessmentLoopDeps['config'],

    grabFrame: async () => FAKE_BITMAP,

    now: () => 0,
  };

  const loop = new AssessmentLoop(deps);

  return {
    loop,
    resolveNext: (result?: CVFrameResult) => {
      const d = pending.shift();
      if (!d) throw new Error('no pending processFrame to resolve');
      d.resolve(result ?? makeFrameResult(0));
    },
    get processFrameCalls() {
      return processFrameCalls;
    },
    get maxConcurrent() {
      return maxConcurrent;
    },
    get concurrent() {
      return concurrent;
    },
  };
}

// ─── Property 28 ──────────────────────────────────────────────────────────────

describe('AssessmentLoop — Property 28: Frame processing backpressure is bounded', () => {
  it('keeps at most one frame in flight and drops excess ticks (counted as dropped)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // A schedule: for each in-flight "window", how many EXTRA overlapping ticks
        // arrive while the single frame is pending. 1..8 windows, 0..6 extra each.
        fc.array(fc.integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 8 }),
        async (extraTicksPerWindow) => {
          const h = buildHarness();
          h.loop.start(makeBaseline(), 'right');

          let expectedDropped = 0;
          let expectedDelivered = 0;
          let ts = 0;

          for (const extra of extraTicksPerWindow) {
            // First tick of the window starts the pump. The pump awaits grabFrame()
            // (a microtask) before calling processFrame, so flush microtasks to
            // ensure the single processFrame invocation actually begins and the
            // frame is truly "in flight" before we pile on overlapping ticks.
            h.loop.tick(ts++);
            await flushMicrotasks();

            // Exactly one frame should now be in flight.
            expect(h.concurrent).toBe(1);

            // Overlapping ticks arrive while the frame is pending — all dropped.
            for (let i = 0; i < extra; i++) {
              h.loop.tick(ts++);
            }
            expectedDropped += extra;

            // Concurrency never exceeds 1 regardless of how many ticks piled up.
            expect(h.concurrent).toBe(1);
            expect(h.maxConcurrent).toBe(1);

            // Dropped count reflects every overlapping tick so far.
            expect(h.loop.getDroppedFrameCount()).toBe(expectedDropped);

            // Release the in-flight frame; the pump settles and delivers it.
            h.resolveNext();
            await flushMicrotasks();
            expectedDelivered += 1;

            // The window's single frame is delivered; nothing left in flight.
            expect(h.concurrent).toBe(0);
            expect(h.loop.getDeliveredFrameCount()).toBe(expectedDelivered);
          }

          // Across the whole sequence: max concurrency is exactly 1, one
          // processFrame per window, and dropped == total overlapping ticks.
          expect(h.maxConcurrent).toBe(1);
          expect(h.processFrameCalls).toBe(extraTicksPerWindow.length);
          expect(h.loop.getDeliveredFrameCount()).toBe(
            extraTicksPerWindow.length
          );
          expect(h.loop.getDroppedFrameCount()).toBe(
            extraTicksPerWindow.reduce((a, b) => a + b, 0)
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
