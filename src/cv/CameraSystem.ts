/**
 * CameraSystem module — manages browser camera access, frame delivery, and device selection.
 *
 * Responsibilities:
 * - Request getUserMedia with front-facing preference on mobile
 * - Deliver frames to consumers at the configured rate
 * - Evaluate per-frame brightness from a downsampled luminance sample
 * - Detect camera interruption and emit error events
 * - Support camera switching between available devices
 */

// ─── Configuration ───────────────────────────────────────────────────────────

/**
 * Configuration for camera system initialization.
 */
export interface CameraSystemConfig {
  /** Preferred camera facing direction: 'user' (front) or 'environment' (rear) */
  preferredFacing: 'user' | 'environment';
  /** Target frame delivery rate in frames per second */
  targetFrameRate: number;
  /** Target camera resolution */
  targetResolution: { width: number; height: number };
}

// ─── Interface ───────────────────────────────────────────────────────────────

/**
 * Camera system interface for managing browser camera access and frame delivery.
 */
export interface ICameraSystem {
  initialize(config: CameraSystemConfig): Promise<void>;
  start(): Promise<MediaStream>;
  stop(): void;
  switchCamera(deviceId: string): Promise<void>;
  getAvailableCameras(): Promise<MediaDeviceInfo[]>;
  getCurrentBrightness(): number;
  onFrame(callback: (frame: VideoFrame | HTMLVideoElement, timestamp: number) => void): void;
  onError(callback: (error: Error) => void): void;
  getVideoElement(): HTMLVideoElement | null;
  destroy(): void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Downsampled canvas dimensions for brightness evaluation */
const BRIGHTNESS_SAMPLE_WIDTH = 64;
const BRIGHTNESS_SAMPLE_HEIGHT = 48;

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * Concrete implementation of the CameraSystem interface.
 *
 * Uses a hidden <video> element to receive the media stream,
 * requestAnimationFrame for frame delivery at the target rate,
 * and a downscaled canvas for brightness computation.
 */
export class CameraSystem implements ICameraSystem {
  private config: CameraSystemConfig | null = null;
  private stream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private animationFrameId: number | null = null;
  private isRunning = false;
  private lastFrameTime = 0;
  private currentBrightness = 0;

  // Callbacks
  private frameCallback: ((frame: VideoFrame | HTMLVideoElement, timestamp: number) => void) | null = null;
  private errorCallback: ((error: Error) => void) | null = null;

  // Brightness evaluation canvas (downsampled)
  private brightnessCanvas: HTMLCanvasElement | null = null;
  private brightnessCtx: CanvasRenderingContext2D | null = null;

  // Track ended listener reference for cleanup
  private trackEndedHandler: (() => void) | null = null;

  /**
   * Initialize the camera system with the given configuration.
   * Creates the hidden video element and brightness sampling canvas.
   */
  async initialize(config: CameraSystemConfig): Promise<void> {
    this.config = config;

    // Create hidden video element for receiving the media stream
    this.videoElement = document.createElement('video');
    this.videoElement.setAttribute('playsinline', 'true');
    this.videoElement.setAttribute('autoplay', 'true');
    this.videoElement.setAttribute('muted', 'true');
    this.videoElement.muted = true;
    this.videoElement.style.display = 'none';
    document.body.appendChild(this.videoElement);

    // Create offscreen canvas for brightness evaluation
    this.brightnessCanvas = document.createElement('canvas');
    this.brightnessCanvas.width = BRIGHTNESS_SAMPLE_WIDTH;
    this.brightnessCanvas.height = BRIGHTNESS_SAMPLE_HEIGHT;
    this.brightnessCtx = this.brightnessCanvas.getContext('2d', { willReadFrequently: true });
  }

  /**
   * Start the camera stream with the configured preferences.
   * Requests getUserMedia with front-facing preference on mobile.
   */
  async start(): Promise<MediaStream> {
    if (!this.config) {
      throw new Error('CameraSystem must be initialized before starting');
    }

    const constraints: MediaStreamConstraints = {
      video: {
        facingMode: { ideal: this.config.preferredFacing },
        width: { ideal: this.config.targetResolution.width },
        height: { ideal: this.config.targetResolution.height },
        frameRate: { ideal: this.config.targetFrameRate },
      },
      audio: false,
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emitError(new Error(`Camera access failed: ${err.message}`));
      throw err;
    }

    // Attach stream to video element
    if (this.videoElement) {
      this.videoElement.srcObject = this.stream;
      await this.videoElement.play();
    }

    // Listen for track ended events (camera interruption)
    this.attachTrackEndedListener();

    // Start the frame delivery loop
    this.isRunning = true;
    this.lastFrameTime = 0;
    this.scheduleNextFrame();

    return this.stream;
  }

  /**
   * Stop the camera stream and frame delivery loop.
   */
  stop(): void {
    this.isRunning = false;

    // Cancel animation frame
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Stop all tracks
    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        track.removeEventListener('ended', this.trackEndedHandler as EventListener);
        track.stop();
      });
      this.stream = null;
    }

    // Detach stream from video element
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }

    this.trackEndedHandler = null;
  }

  /**
   * Switch to a different camera by device ID.
   * Stops the current stream and restarts with the specified device.
   */
  async switchCamera(deviceId: string): Promise<void> {
    if (!this.config) {
      throw new Error('CameraSystem must be initialized before switching cameras');
    }

    // Stop current stream
    this.stop();

    // Request new stream with specific device
    const constraints: MediaStreamConstraints = {
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: this.config.targetResolution.width },
        height: { ideal: this.config.targetResolution.height },
        frameRate: { ideal: this.config.targetFrameRate },
      },
      audio: false,
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emitError(new Error(`Camera switch failed: ${err.message}`));
      throw err;
    }

    // Attach stream to video element
    if (this.videoElement) {
      this.videoElement.srcObject = this.stream;
      await this.videoElement.play();
    }

    // Listen for track ended events on new stream
    this.attachTrackEndedListener();

    // Restart frame delivery
    this.isRunning = true;
    this.lastFrameTime = 0;
    this.scheduleNextFrame();
  }

  /**
   * Get a list of available video input devices (cameras).
   */
  async getAvailableCameras(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'videoinput');
  }

  /**
   * Get the current brightness level (0-255) computed from the most recent frame.
   * Uses average luminance from a downsampled canvas.
   */
  getCurrentBrightness(): number {
    return this.currentBrightness;
  }

  /**
   * Register a callback to receive video frames at the configured rate.
   * The callback receives the HTMLVideoElement and a timestamp.
   */
  onFrame(callback: (frame: VideoFrame | HTMLVideoElement, timestamp: number) => void): void {
    this.frameCallback = callback;
  }

  /**
   * Register an error callback for camera interruption and other errors.
   */
  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback;
  }

  /**
   * Get the underlying HTMLVideoElement for preview rendering.
   */
  getVideoElement(): HTMLVideoElement | null {
    return this.videoElement;
  }

  /**
   * Destroy the camera system, releasing all resources.
   */
  destroy(): void {
    this.stop();

    // Remove video element from DOM
    if (this.videoElement) {
      if (this.videoElement.parentNode) {
        this.videoElement.parentNode.removeChild(this.videoElement);
      }
      this.videoElement = null;
    }

    // Clean up brightness canvas
    this.brightnessCanvas = null;
    this.brightnessCtx = null;

    // Clear callbacks
    this.frameCallback = null;
    this.errorCallback = null;
  }

  // ─── Private Methods ─────────────────────────────────────────────────────

  /**
   * Schedule the next frame delivery using requestAnimationFrame.
   * Throttles delivery to the configured target frame rate.
   */
  private scheduleNextFrame(): void {
    if (!this.isRunning) return;

    this.animationFrameId = requestAnimationFrame((timestamp) => {
      this.onAnimationFrame(timestamp);
    });
  }

  /**
   * Handle an animation frame tick.
   * Delivers the frame if enough time has elapsed since the last delivery.
   */
  private onAnimationFrame(timestamp: number): void {
    if (!this.isRunning || !this.config) return;

    const frameInterval = 1000 / this.config.targetFrameRate;

    if (timestamp - this.lastFrameTime >= frameInterval) {
      this.lastFrameTime = timestamp;
      this.deliverFrame(timestamp);
    }

    // Continue the loop
    this.scheduleNextFrame();
  }

  /**
   * Deliver a frame to the registered callback and evaluate brightness.
   */
  private deliverFrame(timestamp: number): void {
    if (!this.videoElement || this.videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }

    // Evaluate brightness from the current frame
    this.evaluateBrightness();

    // Deliver frame to consumer
    if (this.frameCallback) {
      this.frameCallback(this.videoElement, timestamp);
    }
  }

  /**
   * Evaluate the brightness of the current video frame by
   * drawing it to a downsampled canvas and computing average luminance.
   *
   * Uses the standard luminance formula:
   * L = 0.299 * R + 0.587 * G + 0.114 * B
   */
  private evaluateBrightness(): void {
    if (!this.brightnessCtx || !this.brightnessCanvas || !this.videoElement) {
      return;
    }

    // Draw the current video frame to the downsampled canvas
    this.brightnessCtx.drawImage(
      this.videoElement,
      0,
      0,
      BRIGHTNESS_SAMPLE_WIDTH,
      BRIGHTNESS_SAMPLE_HEIGHT
    );

    // Read pixel data
    const imageData = this.brightnessCtx.getImageData(
      0,
      0,
      BRIGHTNESS_SAMPLE_WIDTH,
      BRIGHTNESS_SAMPLE_HEIGHT
    );

    const pixels = imageData.data;
    const pixelCount = BRIGHTNESS_SAMPLE_WIDTH * BRIGHTNESS_SAMPLE_HEIGHT;

    let totalLuminance = 0;

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      // Standard luminance formula (ITU-R BT.601)
      totalLuminance += 0.299 * r + 0.587 * g + 0.114 * b;
    }

    this.currentBrightness = totalLuminance / pixelCount;
  }

  /**
   * Attach a listener for track 'ended' events to detect camera interruption.
   */
  private attachTrackEndedListener(): void {
    if (!this.stream) return;

    this.trackEndedHandler = () => {
      this.emitError(new Error('Camera track ended unexpectedly'));
      this.isRunning = false;
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
    };

    const videoTracks = this.stream.getVideoTracks();
    for (const track of videoTracks) {
      track.addEventListener('ended', this.trackEndedHandler);
    }
  }

  /**
   * Emit an error to the registered error callback.
   */
  private emitError(error: Error): void {
    if (this.errorCallback) {
      this.errorCallback(error);
    }
  }
}

// ─── Utility: Compute brightness from raw pixel data ─────────────────────────

/**
 * Compute average luminance (0-255) from an array of RGBA pixel data.
 * Exported for unit testing of the brightness algorithm.
 *
 * Uses the standard luminance formula (ITU-R BT.601):
 * L = 0.299 * R + 0.587 * G + 0.114 * B
 */
export function computeAverageLuminance(pixelData: Uint8ClampedArray, pixelCount: number): number {
  if (pixelCount === 0) return 0;

  let totalLuminance = 0;

  for (let i = 0; i < pixelData.length; i += 4) {
    const r = pixelData[i]!;
    const g = pixelData[i + 1]!;
    const b = pixelData[i + 2]!;
    totalLuminance += 0.299 * r + 0.587 * g + 0.114 * b;
  }

  return totalLuminance / pixelCount;
}
