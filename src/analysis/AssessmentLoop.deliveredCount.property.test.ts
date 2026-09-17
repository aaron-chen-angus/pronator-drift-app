// Feature: pronator-drift-analysis, Property 24: Delivered frame count equals frames delivered
import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { ConfigStore } from '../config/ConfigStore';
import { AssessmentLoop } from './AssessmentLoop';
import type { AssessmentLoopDeps } from './AssessmentLoop';
import type { CVWorkerManager } from '../cv/CVWorkerManager';
import type { DriftAnalyzerInterface } from './DriftAnalyzer';
import type { MicroMovementAnalyzer } from './MicroMovementAnalyzer';
import type { RecordingManager } from './RecordingManager';
import type {
  ArmBaseline,
  Baseline,
  CVFrameResult,
  DriftFrame,
  MicroMovementIndicators,
  NormalizedLandmark,
  Vec3,
} from '../types';

// ─── Minimal Baseline helper ─────────────────────────────────────────────────

function makeArmBaseline(): ArmBaseline {
  const zero: Vec3 = { x: 0, y: 0, z: 0 };
  return {
    shoulderPos: { ...zero },
    elbowPos: { ...zero },
    wristPos: { ...zero },
    normalizedWristHeight: 0,
    elbowExtensionAngle: 180,
    palmOrientationAngle: 0,
    armLength: 0.2,
  };
}

function makeBaseline(): Baseline {
  return {
    leftArm: makeArmBaseline(),
    rightArm: makeArmBaseline(),
    torsoAngle: 0,
    shoulderWidth: 0.2,
    captureFrameCount: 5,
    captureStartTime: 0,
    captureEndTime: 1000,
  };
}

// ─── Minimal CVFrameResult (a "fake bitmap" produces a minimal result) ───────

function makeFrameResult(timestamp: number): CVFrameResult {
  const pose: NormalizedLandmark[] = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 0.9,
  }));
  return {
    timestamp,
    poseLandmarks: [pose],
    poseWorldLandmarks: null,
    handLandmarks: null,
    handedness: null,
    processingTimeMs: 5,
  };
}

// ─── Fake ImageBitmap ────────────────────────────────────────────────────────

/** A stand-in bitmap; the CV manager is mocked so only truthiness matters. */
function fakeBitmap(): ImageBitmap {
  return { width: 1, height: 1, close: () => {} } as unknown as ImageBitmap;
}

// ─── Settle helper ────────────────────────────────────────────────────────────

/**
 * Await the single-in-flight pump to settle. Because the pump is fire-and-forget
 * (kicked off by `tick`) and our mocked `grabFrame`/`processFrame` resolve on
 * already-resolved promises, flushing a bounded number of microtask turns lets
 * the pump run to completion (increment the delivered count and clear inFlight)
 * before the next tick is issued.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

// ─── Dependency assembly with spies ───────────────────────────────────────────

interface HarnessSpies {
  addAssessmentFrame: ReturnType<typeof vi.fn>;
  addFrame: ReturnType<typeof vi.fn>;
}

/**
 * Build an AssessmentLoop whose `grabFrame` follows a generated schedule: for
 * each tick, `grabFrame` returns a fake bitmap (frame available) or null
 * (no frame this tick). `cvManager.processFrame` resolves a minimal frame
 * result. The drift/micro analyzers are spies so we can count forwarded frames.
 */
function makeLoop(schedule: boolean[]): {
  loop: AssessmentLoop;
  spies: HarnessSpies;
} {
  const config = new ConfigStore();

  let callIndex = 0;
  const grabFrame = vi.fn(async (): Promise<ImageBitmap | null> => {
    const available = schedule[callIndex] ?? false;
    callIndex += 1;
    return available ? fakeBitmap() : null;
  });

  const cvManager = {
    processFrame: vi.fn(
      async (_bitmap: ImageBitmap, ts: number): Promise<CVFrameResult> =>
        makeFrameResult(ts)
    ),
  } as unknown as CVWorkerManager;

  const addAssessmentFrame = vi.fn();
  const driftAnalyzer = {
    startAssessment: vi.fn(),
    addAssessmentFrame,
    getDriftTimeSeries: vi.fn((): DriftFrame[] => []),
    getMaxDrift: vi.fn(() => ({ left: 0, right: 0 })),
    getDriftOnset: vi.fn(() => ({ left: null, right: null })),
  } as unknown as DriftAnalyzerInterface;

  const addFrame = vi.fn();
  const microAnalyzer = {
    start: vi.fn(),
    addFrame,
    finalize: vi.fn((): MicroMovementIndicators => ({}) as MicroMovementIndicators),
    getCapturedFrames: vi.fn(() => []),
  } as unknown as MicroMovementAnalyzer;

  const recordingManager = {
    start: vi.fn(),
    stop: vi.fn(async () => ({
      status: 'skipped' as const,
      blob: null,
      objectUrl: null,
      mimeType: null,
    })),
  } as unknown as RecordingManager;

  const deps: AssessmentLoopDeps = {
    cvManager,
    driftAnalyzer,
    microAnalyzer,
    recordingManager,
    config,
    grabFrame,
    now: () => 0,
  };

  return { loop: new AssessmentLoop(deps), spies: { addAssessmentFrame, addFrame } };
}

// ─── Property 24: Delivered frame count equals frames delivered ───────────────

/**
 * **Validates: Requirements 1.6**
 *
 * Property 24: Delivered frame count equals frames delivered
 *
 * When each tick's single-in-flight pump is awaited to completion before the next
 * tick is issued, the AssessmentLoop's `deliveredFrameCount` equals the number of
 * ticks whose `grabFrame` returned a non-null bitmap (and whose `processFrame`
 * resolved). Ticks whose `grabFrame` returned null are not delivered and do not
 * increment the count. The delivered count also equals the number of
 * `microAnalyzer.addFrame` calls and the number of
 * `driftAnalyzer.addAssessmentFrame` calls.
 */
describe('Property 24: Delivered frame count equals frames delivered', () => {
  it('delivered count equals non-null grabFrame ticks and equals forwarded frame counts', async () => {
    await fc.assert(
      fc.asyncProperty(
        // A schedule of ticks; true = grabFrame returns a bitmap, false = null.
        fc.array(fc.boolean(), { minLength: 0, maxLength: 40 }),
        async (schedule) => {
          const { loop, spies } = makeLoop(schedule);
          loop.start(makeBaseline(), 'left');

          // Issue one tick per scheduled entry, awaiting the pump to settle after
          // each so every non-null grabFrame results in exactly one delivered frame
          // (no overlapping ticks are dropped).
          for (let i = 0; i < schedule.length; i++) {
            loop.tick(i * 33);
            await settle();
          }

          const expectedDelivered = schedule.filter((available) => available).length;

          // deliveredFrameCount equals the number of delivered (non-null) frames.
          expect(loop.getDeliveredFrameCount()).toBe(expectedDelivered);

          // No ticks were dropped because each pump settled before the next tick.
          expect(loop.getDroppedFrameCount()).toBe(0);

          // Delivered count equals frames forwarded to each analyzer.
          expect(spies.addFrame).toHaveBeenCalledTimes(expectedDelivered);
          expect(spies.addAssessmentFrame).toHaveBeenCalledTimes(expectedDelivered);

          // And the finalized result reports the same delivered count.
          const result = await loop.finalize();
          expect(result.deliveredFrameCount).toBe(expectedDelivered);
        }
      ),
      { numRuns: 100 }
    );
  });
});
