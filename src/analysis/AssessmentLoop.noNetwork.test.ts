/**
 * Integration test — on-device / no-network guarantee (Task 14.3).
 *
 * This test drives a FULL analysis + recording cycle through the real
 * `AssessmentLoop`, wired to the real `DriftAnalyzerImpl`, real
 * `MicroMovementAnalyzer`, and real `RecordingManager` (with a fake
 * `MediaRecorder` + stubbed `URL.createObjectURL/revokeObjectURL`), plus a stub
 * `CVWorkerManager` that returns scripted `CVFrameResult`s. `grabFrame` returns a
 * fake bitmap so the single-in-flight pump advances.
 *
 * It asserts:
 * - NONE of `fetch`, `XMLHttpRequest.open/send`, `WebSocket` (constructor/send),
 *   or `navigator.sendBeacon` are ever called during analysis OR recording
 *   (Req 10.3, 18.1, 18.2, 18.3).
 * - Returning home / deleting releases resources: `recordingManager.delete()`
 *   revokes the on-device object URL and clears the retained recording
 *   (Req 18.4).
 *
 * Reuses the fake MediaRecorder + URL stubbing approach from
 * `RecordingManager.test.ts` and the frame/baseline construction from
 * `AssessmentLoop.test.ts` / `AssessmentLoop.deliveredCount.property.test.ts`.
 *
 * Validates: Requirements 10.3, 18.1, 18.2, 18.3, 18.4
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AssessmentLoop, type AssessmentLoopDeps } from './AssessmentLoop';
import { DriftAnalyzerImpl } from './DriftAnalyzer';
import { MicroMovementAnalyzer } from './MicroMovementAnalyzer';
import { RecordingManager } from './RecordingManager';
import { buildAssessmentFromAnalysis } from './buildAssessmentFromAnalysis';
import { ConfigStore } from '../config/ConfigStore';
import type { CVWorkerManager } from '../cv/CVWorkerManager';
import type {
  ArmBaseline,
  Baseline,
  CVFrameResult,
  Handedness,
  NormalizedLandmark,
} from '../types';

// ─── MediaPipe pose landmark indices (subset used to build frames) ────────────

const POSE = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
} as const;

// ─── Fake MediaRecorder (same shape as RecordingManager.test.ts) ──────────────

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = vi.fn((_type: string) => true);

  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;

  ondataavailable: ((event: { data: Blob | null }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: (() => void) | null = null;

  start = vi.fn(() => {
    this.state = 'recording';
    // Emulate the browser buffering a chunk shortly after start.
    this.emitData(new Blob(['frame-data'], { type: this.mimeType || 'video/webm' }));
  });

  stop = vi.fn(() => {
    this.emitData(new Blob(['final-chunk'], { type: this.mimeType || 'video/webm' }));
    this.state = 'inactive';
    this.onstop?.();
  });

  constructor(public stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? 'video/webm';
    FakeMediaRecorder.instances.push(this);
  }

  emitData(data: Blob | null): void {
    this.ondataavailable?.({ data });
  }
}

// ─── Global stubs: URL + network primitives ───────────────────────────────────

let createObjectUrlSpy: ReturnType<typeof vi.fn>;
let revokeObjectUrlSpy: ReturnType<typeof vi.fn>;
let urlCounter = 0;

let fetchSpy: ReturnType<typeof vi.fn>;
let sendBeaconSpy: ReturnType<typeof vi.fn>;
let xhrOpenSpy: ReturnType<typeof vi.fn>;
let xhrSendSpy: ReturnType<typeof vi.fn>;
let webSocketSpy: ReturnType<typeof vi.fn>;
let webSocketSendSpy: ReturnType<typeof vi.fn>;

function makeStream(): MediaStream {
  return {} as unknown as MediaStream;
}

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.isTypeSupported = vi.fn((_type: string) => true);
  urlCounter = 0;

  createObjectUrlSpy = vi.fn(() => `blob:mock-${++urlCounter}`);
  revokeObjectUrlSpy = vi.fn();

  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('URL', {
    createObjectURL: createObjectUrlSpy,
    revokeObjectURL: revokeObjectUrlSpy,
  });

  // Network spies — any invocation would signal a privacy violation.
  fetchSpy = vi.fn(() => Promise.resolve(new Response(null)));
  sendBeaconSpy = vi.fn(() => true);
  xhrOpenSpy = vi.fn();
  xhrSendSpy = vi.fn();
  webSocketSpy = vi.fn();
  webSocketSendSpy = vi.fn();

  vi.stubGlobal('fetch', fetchSpy);
  vi.stubGlobal('navigator', { sendBeacon: sendBeaconSpy, userAgent: 'node' });
  vi.stubGlobal(
    'XMLHttpRequest',
    class {
      open = xhrOpenSpy;
      send = xhrSendSpy;
      setRequestHeader = vi.fn();
      addEventListener = vi.fn();
    }
  );
  vi.stubGlobal(
    'WebSocket',
    class {
      constructor(...args: unknown[]) {
        webSocketSpy(...args);
      }
      send = webSocketSendSpy;
      close = vi.fn();
      addEventListener = vi.fn();
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** Asserts that no network transmission primitive was invoked. */
function assertNoNetwork(): void {
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(sendBeaconSpy).not.toHaveBeenCalled();
  expect(xhrOpenSpy).not.toHaveBeenCalled();
  expect(xhrSendSpy).not.toHaveBeenCalled();
  expect(webSocketSpy).not.toHaveBeenCalled();
  expect(webSocketSendSpy).not.toHaveBeenCalled();
}

// ─── Frame / baseline construction ────────────────────────────────────────────

/** A fully-visible normalized landmark at (x, y). */
function lm(x: number, y: number, z = 0, visibility = 0.95): NormalizedLandmark {
  return { x, y, z, visibility };
}

/**
 * Builds a 33-entry pose landmark array with realistic arm geometry. `wristY`
 * lets a caller script downward drift of the wrists over time.
 */
function makePose(wristY: number): NormalizedLandmark[] {
  const pose: NormalizedLandmark[] = Array.from({ length: 33 }, () => lm(0.5, 0.5));
  pose[POSE.LEFT_SHOULDER] = lm(0.4, 0.3);
  pose[POSE.RIGHT_SHOULDER] = lm(0.6, 0.3);
  pose[POSE.LEFT_ELBOW] = lm(0.38, 0.45);
  pose[POSE.RIGHT_ELBOW] = lm(0.62, 0.45);
  pose[POSE.LEFT_WRIST] = lm(0.36, wristY);
  pose[POSE.RIGHT_WRIST] = lm(0.64, wristY);
  pose[POSE.LEFT_HIP] = lm(0.42, 0.7);
  pose[POSE.RIGHT_HIP] = lm(0.58, 0.7);
  return pose;
}

/** Builds a 21-landmark hand set with a slight per-frame rotation offset. */
function makeHand(rotation: number): NormalizedLandmark[] {
  const hand: NormalizedLandmark[] = Array.from({ length: 21 }, (_, i) =>
    lm(0.36 + i * 0.001, 0.5 + i * 0.001)
  );
  // Perturb the MCP landmarks so the palm-orientation estimate varies with time.
  hand[0] = lm(0.36, 0.5);
  hand[5] = lm(0.4 + rotation * 0.01, 0.52);
  hand[9] = lm(0.42, 0.53 + rotation * 0.01);
  return hand;
}

/**
 * Scripts one CVFrameResult with pose + a left hand. `wristY` drives wrist drift
 * and `rotation` drives palm rotation change over the assessment.
 */
function makeFrameResult(
  timestamp: number,
  wristY: number,
  rotation: number
): CVFrameResult {
  const handedness: Handedness[] = [{ label: 'Left', score: 0.95 }];
  return {
    timestamp,
    poseLandmarks: [makePose(wristY)],
    poseWorldLandmarks: null,
    handLandmarks: [makeHand(rotation)],
    handedness,
    processingTimeMs: 4,
  };
}

function makeArmBaseline(): ArmBaseline {
  return {
    shoulderPos: { x: 0.4, y: 0.3, z: 0 },
    elbowPos: { x: 0.38, y: 0.45, z: 0 },
    wristPos: { x: 0.36, y: 0.5, z: 0 },
    normalizedWristHeight: 0.5,
    elbowExtensionAngle: 170,
    palmOrientationAngle: 0,
    armLength: 0.25,
  };
}

function makeBaseline(): Baseline {
  return {
    leftArm: makeArmBaseline(),
    rightArm: {
      ...makeArmBaseline(),
      shoulderPos: { x: 0.6, y: 0.3, z: 0 },
      elbowPos: { x: 0.62, y: 0.45, z: 0 },
      wristPos: { x: 0.64, y: 0.5, z: 0 },
    },
    torsoAngle: 0,
    shoulderWidth: 0.2,
    captureFrameCount: 30,
    captureStartTime: 0,
    captureEndTime: 2000,
  };
}

/** A stand-in bitmap; the CV manager is stubbed so only truthiness matters. */
function fakeBitmap(): ImageBitmap {
  return { width: 1, height: 1, close: () => {} } as unknown as ImageBitmap;
}

/** Flush the fire-and-forget pump so a tick settles before the next one. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

// ─── Test ─────────────────────────────────────────────────────────────────────

describe('AssessmentLoop — on-device / no-network guarantee (Task 14.3)', () => {
  it('drives a full analysis + recording cycle without touching any network primitive, and releases resources on delete', async () => {
    const config = new ConfigStore();

    // Real analysis + recording collaborators.
    const driftAnalyzer = new DriftAnalyzerImpl(config);
    const microAnalyzer = new MicroMovementAnalyzer(config);
    const recordingManager = new RecordingManager();

    // Script ~40 frames of gradually drifting wrists + rotating palm.
    const FRAME_COUNT = 40;
    const frames: CVFrameResult[] = Array.from({ length: FRAME_COUNT }, (_, i) => {
      const timestamp = i * 33; // ~30 fps
      const wristY = 0.5 + i * 0.004; // wrists drift downward over time
      const rotation = i; // palm rotates progressively
      return makeFrameResult(timestamp, wristY, rotation);
    });

    // Stub CVWorkerManager: returns the next scripted frame per processFrame call.
    let frameCursor = 0;
    const processFrame = vi.fn(
      async (_bitmap: ImageBitmap, _ts: number): Promise<CVFrameResult> => {
        const frame = frames[Math.min(frameCursor, frames.length - 1)];
        frameCursor += 1;
        return frame;
      }
    );
    const cvManager = { processFrame } as unknown as CVWorkerManager;

    const grabFrame = vi.fn(async (): Promise<ImageBitmap | null> => fakeBitmap());

    // Injectable clock so the effective frame rate is well-defined.
    let clock = 0;
    const now = () => clock;

    const deps: AssessmentLoopDeps = {
      cvManager,
      driftAnalyzer,
      microAnalyzer,
      recordingManager,
      config,
      grabFrame,
      // Present stream + consent so the RecordingManager actually records.
      recordingStream: makeStream(),
      recordingConsented: true,
      now,
    };

    const loop = new AssessmentLoop(deps);

    // ── Drive the assessment ────────────────────────────────────────────────
    loop.start(makeBaseline(), 'left');

    // The recorder must have been constructed + started under consent.
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(FakeMediaRecorder.instances[0].start).toHaveBeenCalledTimes(1);

    for (let i = 0; i < FRAME_COUNT; i++) {
      clock = i * 33;
      loop.tick(i * 33);
      await settle();
    }

    // Advance the clock so finalize computes a positive duration.
    clock = FRAME_COUNT * 33;

    const analysis = await loop.finalize();

    // Every scripted frame was delivered to the analyzers (single-in-flight,
    // settled between ticks so nothing was dropped).
    expect(loop.getDeliveredFrameCount()).toBe(FRAME_COUNT);
    expect(loop.getDroppedFrameCount()).toBe(0);

    // Recording ran and retained footage on-device as a local blob + object URL.
    expect(analysis.recording.status).toBe('recorded');
    expect(analysis.recording.blob).not.toBeNull();
    expect(analysis.recording.objectUrl).toBe('blob:mock-1');

    // Assemble the full assessment (the downstream result path).
    const assessment = buildAssessmentFromAnalysis(analysis, config);

    // Sanity: the pipeline produced a real assessment, exercising the full path.
    expect(assessment.assessedArm).toBe('left');
    expect(Array.isArray(assessment.normComparisons)).toBe(true);
    expect(assessment.indicators).toBe(analysis.indicators);

    // ── No network was ever used during analysis or recording ────────────────
    // (Req 10.3, 18.1, 18.2, 18.3).
    assertNoNetwork();

    // ── Return-home / delete releases resources (Req 18.4) ────────────────────
    expect(recordingManager.getRecording()).not.toBeNull();

    recordingManager.delete();

    // The on-device object URL is revoked and the recording is cleared.
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:mock-1');
    expect(recordingManager.getRecording()).toBeNull();

    // reset() is also safe and keeps the recording cleared (return-home path).
    recordingManager.reset();
    expect(recordingManager.getRecording()).toBeNull();

    // Still no network, even after release.
    assertNoNetwork();
  });
});
