/**
 * Unit tests for the RecordingManager module.
 *
 * These tests drive the RecordingManager against a fake MediaRecorder so we can
 * deterministically fire `dataavailable`, `stop`, and `error` events and verify:
 * - consent gating (start with consented=false -> skipped)
 * - unsupported skip (isSupported() returns false -> skipped)
 * - happy path (start then stop -> recorded, blob + objectUrl)
 * - mid-recording failure (onerror -> incomplete with partial footage retained)
 * - delete() revokes the object URL and clears the recording
 * - reset() releases a prior recording before a new one begins
 * - no network transmission of any kind occurs
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 11.1, 11.4, 11.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RecordingManager } from './RecordingManager';

// ─── Fake MediaRecorder ──────────────────────────────────────────────────────

/**
 * Minimal, controllable stand-in for the browser MediaRecorder. Exposes the
 * on* handlers and a mutable `state` so tests can drive lifecycle events.
 */
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
  });

  stop = vi.fn(() => {
    // Emulate the browser: flush a final chunk, then transition + fire onstop.
    this.emitData(new Blob(['chunk'], { type: this.mimeType || 'video/webm' }));
    this.state = 'inactive';
    this.onstop?.();
  });

  constructor(public stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? 'video/webm';
    FakeMediaRecorder.instances.push(this);
  }

  /** Test helper: fire a dataavailable event with the given blob. */
  emitData(data: Blob | null): void {
    this.ondataavailable?.({ data });
  }

  /** Test helper: fire an error event, simulating a mid-recording failure. */
  emitError(message = 'mid_recording_failure'): void {
    const event = { error: { message, name: 'RecorderError' } } as unknown as Event;
    this.onerror?.(event);
  }
}

// ─── Global stubs ────────────────────────────────────────────────────────────

let createObjectUrlSpy: ReturnType<typeof vi.fn>;
let revokeObjectUrlSpy: ReturnType<typeof vi.fn>;
let urlCounter = 0;

// Network primitives — spied to assert nothing is ever transmitted.
let fetchSpy: ReturnType<typeof vi.fn>;
let sendBeaconSpy: ReturnType<typeof vi.fn>;
let xhrOpenSpy: ReturnType<typeof vi.fn>;
let xhrSendSpy: ReturnType<typeof vi.fn>;
let webSocketSpy: ReturnType<typeof vi.fn>;

/** A trivial fake stream; the fake recorder never touches its internals. */
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

  // Network spies.
  fetchSpy = vi.fn(() => Promise.resolve(new Response(null)));
  sendBeaconSpy = vi.fn(() => true);
  xhrOpenSpy = vi.fn();
  xhrSendSpy = vi.fn();
  webSocketSpy = vi.fn();

  vi.stubGlobal('fetch', fetchSpy);
  vi.stubGlobal('navigator', { sendBeacon: sendBeaconSpy });
  vi.stubGlobal(
    'XMLHttpRequest',
    class {
      open = xhrOpenSpy;
      send = xhrSendSpy;
      setRequestHeader = vi.fn();
    }
  );
  vi.stubGlobal(
    'WebSocket',
    class {
      constructor(...args: unknown[]) {
        webSocketSpy(...args);
      }
      send = vi.fn();
      close = vi.fn();
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
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RecordingManager', () => {
  describe('consent gating (Req 11.1)', () => {
    it('skips recording when consent is not granted', async () => {
      const manager = new RecordingManager();

      manager.start(makeStream(), false);

      const recording = manager.getRecording();
      expect(recording).not.toBeNull();
      expect(recording?.status).toBe('skipped');
      expect(recording?.reason).toBe('not_consented');
      expect(recording?.blob).toBeNull();
      expect(recording?.objectUrl).toBeNull();
      // No recorder should have been constructed.
      expect(FakeMediaRecorder.instances).toHaveLength(0);

      const result = await manager.stop();
      expect(result.status).toBe('skipped');
      assertNoNetwork();
    });
  });

  describe('unsupported environment (Req 10.4)', () => {
    it('skips recording when MediaRecorder support is unavailable', async () => {
      const manager = new RecordingManager({ isSupported: () => false });

      manager.start(makeStream(), true);

      const recording = manager.getRecording();
      expect(recording?.status).toBe('skipped');
      expect(recording?.reason).toBe('unsupported');
      expect(FakeMediaRecorder.instances).toHaveLength(0);

      // The assessment can continue: stop() resolves without error.
      const result = await manager.stop();
      expect(result.status).toBe('skipped');
      assertNoNetwork();
    });
  });

  describe('happy path start/stop (Req 10.1, 10.2, 10.3)', () => {
    it('records and retains footage as a local blob + object URL', async () => {
      const manager = new RecordingManager();

      manager.start(makeStream(), true);

      // A recorder was constructed and started.
      expect(FakeMediaRecorder.instances).toHaveLength(1);
      const recorder = FakeMediaRecorder.instances[0];
      expect(recorder.start).toHaveBeenCalledTimes(1);
      expect(recorder.state).toBe('recording');

      // Simulate the browser buffering some data during recording.
      recorder.emitData(new Blob(['frame-data'], { type: 'video/webm' }));

      const result = await manager.stop();

      expect(recorder.stop).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('recorded');
      expect(result.blob).not.toBeNull();
      expect(result.blob?.size).toBeGreaterThan(0);
      expect(result.objectUrl).toBe('blob:mock-1');
      expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);

      // getRecording reflects the retained result.
      expect(manager.getRecording()).toEqual(result);

      // Nothing was transmitted anywhere.
      assertNoNetwork();
    });
  });

  describe('mid-recording failure (Req 10.5)', () => {
    it('resolves stop() as incomplete and retains partial footage', async () => {
      const manager = new RecordingManager();

      manager.start(makeStream(), true);
      const recorder = FakeMediaRecorder.instances[0];

      // Buffer some partial footage, then fire an error mid-recording.
      recorder.emitData(new Blob(['partial'], { type: 'video/webm' }));
      recorder.emitError('device_lost');

      const result = await manager.stop();

      expect(result.status).toBe('incomplete');
      expect(result.reason).toBe('device_lost');
      // Partial footage is retained rather than discarded.
      expect(result.blob).not.toBeNull();
      expect(result.blob?.size).toBeGreaterThan(0);
      expect(result.objectUrl).toBe('blob:mock-1');

      assertNoNetwork();
    });
  });

  describe('delete() resource release (Req 11.4)', () => {
    it('revokes the object URL and clears the retained recording', async () => {
      const manager = new RecordingManager();

      manager.start(makeStream(), true);
      const recorder = FakeMediaRecorder.instances[0];
      recorder.emitData(new Blob(['frame'], { type: 'video/webm' }));
      const result = await manager.stop();

      expect(result.objectUrl).toBe('blob:mock-1');
      expect(manager.getRecording()).not.toBeNull();

      manager.delete();

      // The retained object URL is revoked and the recording is cleared.
      expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:mock-1');
      expect(manager.getRecording()).toBeNull();

      assertNoNetwork();
    });
  });

  describe('reset() releases prior recording (Req 11.5)', () => {
    it('revokes a prior recording before beginning a new one', async () => {
      const manager = new RecordingManager();

      // First recording.
      manager.start(makeStream(), true);
      const firstRecorder = FakeMediaRecorder.instances[0];
      firstRecorder.emitData(new Blob(['first'], { type: 'video/webm' }));
      const first = await manager.stop();
      expect(first.objectUrl).toBe('blob:mock-1');

      // Starting a new assessment implicitly resets, releasing the prior URL.
      manager.start(makeStream(), true);

      expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:mock-1');
      // A fresh recorder is now active for the new assessment.
      expect(FakeMediaRecorder.instances).toHaveLength(2);
      const secondRecorder = FakeMediaRecorder.instances[1];
      expect(secondRecorder.start).toHaveBeenCalledTimes(1);

      secondRecorder.emitData(new Blob(['second'], { type: 'video/webm' }));
      const second = await manager.stop();
      expect(second.status).toBe('recorded');
      expect(second.objectUrl).toBe('blob:mock-2');

      assertNoNetwork();
    });

    it('explicit reset() releases resources and clears the recording', async () => {
      const manager = new RecordingManager();

      manager.start(makeStream(), true);
      const recorder = FakeMediaRecorder.instances[0];
      recorder.emitData(new Blob(['frame'], { type: 'video/webm' }));
      await manager.stop();

      manager.reset();

      expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:mock-1');
      expect(manager.getRecording()).toBeNull();

      assertNoNetwork();
    });
  });

  describe('no network transmission (Req 10.3, 18.3)', () => {
    it('never touches any network primitive across a full lifecycle', async () => {
      const manager = new RecordingManager();

      manager.start(makeStream(), true);
      const recorder = FakeMediaRecorder.instances[0];
      recorder.emitData(new Blob(['frame'], { type: 'video/webm' }));
      await manager.stop();
      manager.delete();

      assertNoNetwork();
    });
  });
});
