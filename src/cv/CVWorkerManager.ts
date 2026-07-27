/**
 * CVWorkerManager — creates and manages the CV Web Worker, provides a clean
 * async interface for processing video frames through MediaPipe models.
 *
 * Features:
 * - Creates and manages the cv-worker.ts Web Worker
 * - Provides processFrame(imageBitmap, timestamp): Promise<CVFrameResult>
 * - Handles the message protocol (send frame, receive result)
 * - Implements fallback: runs inference on main thread if Worker/OffscreenCanvas unavailable
 * - Provides initialize() and destroy() lifecycle methods
 *
 * Requirements: 3.4, 3.9, 8.1, 19.1
 */

import type { CVFrameResult } from '../types';
import type { CVWorkerConfig, CVWorkerOutMessage } from './cv-worker';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Pending frame request waiting for a result from the worker. */
interface PendingRequest {
  resolve: (result: CVFrameResult) => void;
  reject: (error: Error) => void;
}

/** Manager configuration options. */
export interface CVWorkerManagerConfig {
  /** Path to the pose landmark model asset */
  poseModelPath: string;
  /** Path to the hand landmark model asset */
  handModelPath: string;
  /** Minimum pose detection confidence (0.0–1.0) */
  minPoseConfidence: number;
  /** Minimum hand detection confidence (0.0–1.0) */
  minHandConfidence: number;
  /** Number of poses to detect (always 1) */
  numPoses: number;
}

// ─── Fallback Detection ──────────────────────────────────────────────────────

/**
 * Detects whether Web Workers and OffscreenCanvas are available
 * in the current environment for off-main-thread CV processing.
 */
export function isWorkerSupported(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

// ─── CVWorkerManager Class ───────────────────────────────────────────────────

/**
 * Manages the CV Web Worker lifecycle and provides an async frame-processing interface.
 *
 * Usage:
 * ```ts
 * const manager = new CVWorkerManager();
 * await manager.initialize(config);
 * const result = await manager.processFrame(imageBitmap, timestamp);
 * manager.destroy();
 * ```
 */
export class CVWorkerManager {
  private worker: Worker | null = null;
  private isReady = false;
  private isDestroyed = false;
  private useFallback = false;

  // Queue for pending frame requests (single-item queue: only latest request matters)
  private pendingRequest: PendingRequest | null = null;

  // Initialization promise management
  private initResolve: (() => void) | null = null;
  private initReject: ((error: Error) => void) | null = null;

  // Fallback: main-thread model references (loaded only in fallback mode)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private fallbackPoseLandmarker: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private fallbackHandLandmarker: any = null;

  /**
   * Initialize the CV processing pipeline.
   *
   * If Worker/OffscreenCanvas are available, creates a Web Worker and loads models there.
   * Otherwise, falls back to main-thread model loading.
   */
  async initialize(config: CVWorkerManagerConfig): Promise<void> {
    if (this.isDestroyed) {
      throw new Error('CVWorkerManager has been destroyed');
    }

    this.useFallback = !isWorkerSupported();

    if (this.useFallback) {
      await this.initializeMainThread(config);
    } else {
      await this.initializeWorker(config);
    }
  }

  /**
   * Process a single video frame and return landmark results.
   *
   * @param imageBitmap - The frame to process (transferred to worker, closed after use)
   * @param timestamp - Frame timestamp in milliseconds
   * @returns Promise resolving to CVFrameResult with landmarks and processing time
   */
  async processFrame(imageBitmap: ImageBitmap, timestamp: number): Promise<CVFrameResult> {
    if (this.isDestroyed) {
      throw new Error('CVWorkerManager has been destroyed');
    }

    if (!this.isReady) {
      throw new Error('CVWorkerManager is not initialized');
    }

    if (this.useFallback) {
      return this.processFrameMainThread(imageBitmap, timestamp);
    }

    return this.processFrameWorker(imageBitmap, timestamp);
  }

  /**
   * Destroy the manager, cleaning up the worker and releasing resources.
   */
  destroy(): void {
    if (this.isDestroyed) return;

    this.isDestroyed = true;
    this.isReady = false;

    // Reject any pending request
    if (this.pendingRequest) {
      this.pendingRequest.reject(new Error('CVWorkerManager destroyed'));
      this.pendingRequest = null;
    }

    // Destroy worker
    if (this.worker) {
      this.worker.postMessage({ type: 'destroy' });
      this.worker.terminate();
      this.worker = null;
    }

    // Cleanup fallback resources
    if (this.fallbackPoseLandmarker) {
      this.fallbackPoseLandmarker.close?.();
      this.fallbackPoseLandmarker = null;
    }
    if (this.fallbackHandLandmarker) {
      this.fallbackHandLandmarker.close?.();
      this.fallbackHandLandmarker = null;
    }
  }

  /**
   * Whether the manager is using main-thread fallback mode.
   */
  get isFallbackMode(): boolean {
    return this.useFallback;
  }

  /**
   * Whether the manager is ready to process frames.
   */
  get ready(): boolean {
    return this.isReady;
  }

  // ─── Private: Worker-based processing ──────────────────────────────────────

  /**
   * Initialize the Web Worker and wait for it to report 'ready'.
   */
  private initializeWorker(config: CVWorkerManagerConfig): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;

      try {
        // Create the web worker using Vite's worker import pattern
        this.worker = new Worker(new URL('./cv-worker.ts', import.meta.url), {
          type: 'module',
        });

        this.worker.onmessage = (event: MessageEvent<CVWorkerOutMessage>) => {
          this.handleWorkerMessage(event.data);
        };

        this.worker.onerror = (error: ErrorEvent) => {
          const err = new Error(`Worker error: ${error.message}`);
          if (this.initReject) {
            this.initReject(err);
            this.initResolve = null;
            this.initReject = null;
          }
          if (this.pendingRequest) {
            this.pendingRequest.reject(err);
            this.pendingRequest = null;
          }
        };

        // Send init message with configuration
        const workerConfig: CVWorkerConfig = {
          poseModelPath: config.poseModelPath,
          handModelPath: config.handModelPath,
          minPoseConfidence: config.minPoseConfidence,
          minHandConfidence: config.minHandConfidence,
          numPoses: config.numPoses,
        };

        this.worker.postMessage({ type: 'init', config: workerConfig });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        reject(err);
      }
    });
  }

  /**
   * Handle messages received from the Web Worker.
   */
  private handleWorkerMessage(message: CVWorkerOutMessage): void {
    switch (message.type) {
      case 'ready':
        this.isReady = true;
        if (this.initResolve) {
          this.initResolve();
          this.initResolve = null;
          this.initReject = null;
        }
        break;

      case 'result':
        if (this.pendingRequest) {
          this.pendingRequest.resolve(message.data);
          this.pendingRequest = null;
        }
        break;

      case 'error':
        if (this.initReject) {
          this.initReject(new Error(message.error));
          this.initResolve = null;
          this.initReject = null;
        }
        if (this.pendingRequest) {
          this.pendingRequest.reject(new Error(message.error));
          this.pendingRequest = null;
        }
        break;
    }
  }

  /**
   * Send a frame to the worker for processing.
   * Uses transferable objects for zero-copy ImageBitmap transfer.
   */
  private processFrameWorker(imageBitmap: ImageBitmap, timestamp: number): Promise<CVFrameResult> {
    return new Promise<CVFrameResult>((resolve, reject) => {
      // If there's already a pending request, reject it (frame dropping for backpressure)
      if (this.pendingRequest) {
        this.pendingRequest.reject(new Error('Frame dropped: newer frame submitted'));
      }

      this.pendingRequest = { resolve, reject };

      // Transfer the ImageBitmap to the worker (zero-copy)
      this.worker!.postMessage(
        { type: 'processFrame', frame: imageBitmap, timestamp },
        [imageBitmap]
      );
    });
  }

  // ─── Private: Main-thread fallback processing ──────────────────────────────

  /**
   * Initialize MediaPipe models on the main thread (fallback mode).
   * Used when Worker or OffscreenCanvas is not available.
   */
  private async initializeMainThread(config: CVWorkerManagerConfig): Promise<void> {
    try {
      // Dynamic import of @mediapipe/tasks-vision
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vision = await import('@mediapipe/tasks-vision') as any;
      const { PoseLandmarker, HandLandmarker, FilesetResolver } = vision;

      // Load the WASM fileset
      const wasmFileset = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      // Create Pose Landmarker
      this.fallbackPoseLandmarker = await PoseLandmarker.createFromOptions(wasmFileset, {
        baseOptions: {
          modelAssetPath: config.poseModelPath,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: config.numPoses,
        minPoseDetectionConfidence: config.minPoseConfidence,
        minPosePresenceConfidence: config.minPoseConfidence,
        minTrackingConfidence: config.minPoseConfidence,
      });

      // Create Hand Landmarker
      this.fallbackHandLandmarker = await HandLandmarker.createFromOptions(wasmFileset, {
        baseOptions: {
          modelAssetPath: config.handModelPath,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: config.minHandConfidence,
        minHandPresenceConfidence: config.minHandConfidence,
        minTrackingConfidence: config.minHandConfidence,
      });

      this.isReady = true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Main-thread initialization failed: ${errorMessage}`);
    }
  }

  /**
   * Process a frame on the main thread (fallback mode).
   */
  private async processFrameMainThread(
    imageBitmap: ImageBitmap,
    timestamp: number
  ): Promise<CVFrameResult> {
    const startTime = performance.now();

    try {
      // Run Pose Landmarker
      const poseResult = this.fallbackPoseLandmarker.detectForVideo(imageBitmap, timestamp);

      // Run Hand Landmarker
      const handResult = this.fallbackHandLandmarker.detectForVideo(imageBitmap, timestamp);

      // Close the ImageBitmap to free memory
      imageBitmap.close();

      const processingTimeMs = performance.now() - startTime;

      // Map results to typed format
      const poseLandmarks =
        poseResult.landmarks && poseResult.landmarks.length > 0
          ? poseResult.landmarks.map(
              (personLandmarks: Array<{ x: number; y: number; z: number; visibility?: number; presence?: number }>) =>
                personLandmarks.map((lm: { x: number; y: number; z: number; visibility?: number; presence?: number }) => ({
                  x: lm.x,
                  y: lm.y,
                  z: lm.z,
                  visibility: lm.visibility ?? 0,
                  presence: lm.presence,
                }))
            )
          : null;

      const poseWorldLandmarks =
        poseResult.worldLandmarks && poseResult.worldLandmarks.length > 0
          ? poseResult.worldLandmarks.map(
              (personLandmarks: Array<{ x: number; y: number; z: number; visibility?: number }>) =>
                personLandmarks.map((lm: { x: number; y: number; z: number; visibility?: number }) => ({
                  x: lm.x,
                  y: lm.y,
                  z: lm.z,
                  visibility: lm.visibility ?? 0,
                }))
            )
          : null;

      const handLandmarks =
        handResult.landmarks && handResult.landmarks.length > 0
          ? handResult.landmarks.map(
              (handLms: Array<{ x: number; y: number; z: number; visibility?: number; presence?: number }>) =>
                handLms.map((lm: { x: number; y: number; z: number; visibility?: number; presence?: number }) => ({
                  x: lm.x,
                  y: lm.y,
                  z: lm.z,
                  visibility: lm.visibility ?? 0,
                  presence: lm.presence,
                }))
            )
          : null;

      const handedness =
        handResult.handedness && handResult.handedness.length > 0
          ? handResult.handedness.map((h: Array<{ categoryName: string; score: number }>) => ({
              label: h[0]?.categoryName === 'Left' ? 'Left' : 'Right',
              score: h[0]?.score ?? 0,
            }))
          : null;

      return {
        timestamp,
        poseLandmarks,
        poseWorldLandmarks,
        handLandmarks,
        handedness,
        processingTimeMs,
      };
    } catch (error) {
      imageBitmap.close();
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Main-thread frame processing failed: ${errorMessage}`);
    }
  }
}
