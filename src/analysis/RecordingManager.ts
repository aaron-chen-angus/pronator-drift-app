/**
 * RecordingManager — wraps the browser MediaRecorder API to capture, retain,
 * and delete the assessment video entirely on-device.
 *
 * Responsibilities:
 * - Record the camera stream only when MediaRecorder is supported AND the user
 *   has consented (Req 10.1, 11.1).
 * - Retain the recorded video as a local Blob / object URL, never transmitting
 *   it anywhere (Req 10.2, 10.3, 18.2, 18.3).
 * - Skip recording gracefully when capture is unavailable so the assessment can
 *   continue uninterrupted (Req 10.4).
 * - On a mid-recording failure, stop, retain any partial footage, and mark the
 *   recording as `incomplete` (Req 10.5).
 * - Release resources on `delete()` / `reset()` (Req 11.4, 11.5, 18.4).
 *
 * All capture and storage occur On_Device; this module never performs network
 * transmission of any kind.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 11.1, 11.4, 11.5, 18.2, 18.3, 18.4
 */

/**
 * The retained result of a recording attempt.
 *
 * - `recorded`   — recording completed and footage is retained on-device.
 * - `skipped`    — recording was not performed (unsupported or not consented).
 * - `incomplete` — recording started but failed mid-way; partial footage retained.
 */
export interface RecordingResult {
  status: 'recorded' | 'skipped' | 'incomplete';
  blob: Blob | null;
  objectUrl: string | null; // created lazily for playback
  mimeType: string | null;
  reason?: string; // when skipped/incomplete
}

/** Candidate MIME types tried in order of preference for video capture. */
const PREFERRED_MIME_TYPES: readonly string[] = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

/**
 * Determines whether MediaRecorder-based capture is available in the current
 * environment. Kept as a standalone default so it can be overridden in tests.
 */
function defaultIsSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  );
}

/**
 * Selects the first supported MIME type from the preference list, or `null`
 * when the browser cannot report support (in which case the recorder default
 * is used).
 */
function pickMimeType(): string | null {
  if (
    typeof MediaRecorder === 'undefined' ||
    typeof MediaRecorder.isTypeSupported !== 'function'
  ) {
    return null;
  }
  for (const type of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return null;
}

export class RecordingManager {
  private readonly isSupported: () => boolean;

  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private recording: RecordingResult | null = null;

  /** Set when recording is active; resolved by stop() once data is flushed. */
  private stopPromise: Promise<RecordingResult> | null = null;
  private resolveStop: ((result: RecordingResult) => void) | null = null;

  /** Reason captured from a mid-recording error, used to mark `incomplete`. */
  private failureReason: string | null = null;
  private mimeType: string | null = null;

  constructor(opts?: { isSupported?: () => boolean }) {
    this.isSupported = opts?.isSupported ?? defaultIsSupported;
  }

  /**
   * Begins recording the given stream, provided MediaRecorder is supported and
   * the user has consented. When recording cannot start, a `skipped` result is
   * retained and the caller (Assessment_Loop) continues uninterrupted.
   *
   * Any previously retained recording is released before a new one begins.
   *
   * @param stream    The live camera MediaStream to capture.
   * @param consented Whether the user granted on-device recording consent.
   */
  start(stream: MediaStream, consented: boolean): void {
    // Release any prior recording before starting a new one (Req 11.5, 18.4).
    this.reset();

    // Gate on consent (Req 11.1).
    if (!consented) {
      this.recording = {
        status: 'skipped',
        blob: null,
        objectUrl: null,
        mimeType: null,
        reason: 'not_consented',
      };
      return;
    }

    // Gate on capability; skip gracefully when unavailable (Req 10.4).
    if (!this.isSupported()) {
      this.recording = {
        status: 'skipped',
        blob: null,
        objectUrl: null,
        mimeType: null,
        reason: 'unsupported',
      };
      return;
    }

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch (err) {
      // Construction can throw (e.g., unsupported options); skip gracefully.
      this.recording = {
        status: 'skipped',
        blob: null,
        objectUrl: null,
        mimeType: null,
        reason: `recorder_init_failed: ${errorMessage(err)}`,
      };
      return;
    }

    this.recorder = recorder;
    this.chunks = [];
    this.failureReason = null;
    this.mimeType = mimeType ?? recorder.mimeType ?? null;

    // Prepare the stop promise that stop() and error/stop handlers resolve.
    this.stopPromise = new Promise<RecordingResult>((resolve) => {
      this.resolveStop = resolve;
    });

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };

    recorder.onerror = (event: Event) => {
      // On mid-recording failure, retain partial footage and mark incomplete
      // (Req 10.5). Extract a best-effort reason for diagnostics.
      const errEvent = event as unknown as { error?: { message?: string; name?: string } };
      this.failureReason =
        errEvent.error?.message ?? errEvent.error?.name ?? 'recorder_error';
      // Attempt to stop so the buffered data flushes and onstop finalizes.
      try {
        if (recorder.state !== 'inactive') {
          recorder.stop();
        } else {
          this.finalizeStop();
        }
      } catch {
        this.finalizeStop();
      }
    };

    recorder.onstop = () => {
      this.finalizeStop();
    };

    try {
      recorder.start();
    } catch (err) {
      // Failed to begin capturing after construction — treat as skipped.
      this.recorder = null;
      this.stopPromise = null;
      this.resolveStop = null;
      this.recording = {
        status: 'skipped',
        blob: null,
        objectUrl: null,
        mimeType: null,
        reason: `recorder_start_failed: ${errorMessage(err)}`,
      };
    }
  }

  /**
   * Stops recording and retains the (possibly partial) video on-device.
   * Resolves with the retained RecordingResult. Safe to call when recording
   * was skipped or never started.
   */
  async stop(): Promise<RecordingResult> {
    // Nothing active — return whatever we already retained (skipped or null).
    if (!this.recorder) {
      return (
        this.recording ?? {
          status: 'skipped',
          blob: null,
          objectUrl: null,
          mimeType: null,
          reason: 'not_started',
        }
      );
    }

    const pending = this.stopPromise;

    try {
      if (this.recorder.state !== 'inactive') {
        this.recorder.stop(); // triggers onstop -> finalizeStop()
      } else {
        this.finalizeStop();
      }
    } catch (err) {
      // Stopping failed; retain buffered chunks and mark incomplete.
      this.failureReason = this.failureReason ?? errorMessage(err);
      this.finalizeStop();
    }

    if (pending) {
      return pending;
    }
    return (
      this.recording ?? {
        status: 'skipped',
        blob: null,
        objectUrl: null,
        mimeType: null,
        reason: 'not_started',
      }
    );
  }

  /**
   * Returns the current retained recording, if any.
   */
  getRecording(): RecordingResult | null {
    return this.recording;
  }

  /**
   * Deletes the retained video and revokes its object URL, releasing resources
   * (Req 11.4). Leaves the manager ready for a subsequent recording.
   */
  delete(): void {
    this.releaseRecording();
    this.recording = null;
  }

  /**
   * Releases any prior recording (and active recorder) before a new one begins
   * (Req 11.5, 18.4).
   */
  reset(): void {
    // Detach any active recorder without emitting a retained result.
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onerror = null;
      this.recorder.onstop = null;
      try {
        if (this.recorder.state !== 'inactive') {
          this.recorder.stop();
        }
      } catch {
        // Ignore — we are tearing down.
      }
      this.recorder = null;
    }
    this.chunks = [];
    this.stopPromise = null;
    this.resolveStop = null;
    this.failureReason = null;
    this.mimeType = null;
    this.releaseRecording();
    this.recording = null;
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  /**
   * Assembles the buffered chunks into a retained on-device Blob/object URL and
   * resolves the pending stop promise. Marks `incomplete` when a mid-recording
   * failure was observed (Req 10.5), otherwise `recorded` (Req 10.2).
   */
  private finalizeStop(): void {
    // Guard against double-finalization.
    if (!this.recorder && this.recording !== null) {
      if (this.resolveStop) {
        this.resolveStop(this.recording);
        this.resolveStop = null;
      }
      return;
    }

    const mimeType = this.mimeType ?? this.recorder?.mimeType ?? null;
    const blob =
      this.chunks.length > 0
        ? new Blob(this.chunks, mimeType ? { type: mimeType } : undefined)
        : null;

    const objectUrl = blob ? URL.createObjectURL(blob) : null;

    const result: RecordingResult = {
      status: this.failureReason ? 'incomplete' : 'recorded',
      blob,
      objectUrl,
      mimeType,
      ...(this.failureReason ? { reason: this.failureReason } : {}),
    };

    // Clean up recorder wiring; keep the retained result.
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onerror = null;
      this.recorder.onstop = null;
    }
    this.recorder = null;
    this.chunks = [];

    this.recording = result;

    if (this.resolveStop) {
      this.resolveStop(result);
      this.resolveStop = null;
    }
    this.stopPromise = null;
  }

  /**
   * Revokes the object URL of the currently retained recording, if present.
   */
  private releaseRecording(): void {
    if (
      this.recording?.objectUrl &&
      typeof URL !== 'undefined' &&
      typeof URL.revokeObjectURL === 'function'
    ) {
      URL.revokeObjectURL(this.recording.objectUrl);
    }
  }
}

/** Extracts a human-readable message from an unknown thrown value. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unknown_error';
}
