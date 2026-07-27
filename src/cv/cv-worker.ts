/**
 * CV Web Worker — runs MediaPipe Pose Landmarker and Hand Landmarker inference
 * off the main thread for responsive UI during real-time tracking.
 *
 * Message Protocol:
 * - Receives: 'init' (load models), 'processFrame' (run inference), 'destroy' (cleanup)
 * - Posts: 'ready' (models loaded), 'result' (frame result), 'error' (failure)
 *
 * Loads @mediapipe/tasks-vision WASM bundle inside the worker context.
 * Pose Landmarker: runningMode 'VIDEO', numPoses 1
 * Hand Landmarker: runningMode 'VIDEO', numHands 2
 *
 * Frames are received as ImageBitmap (transferable) for zero-copy transfer.
 */

import type { CVFrameResult, NormalizedLandmark, Landmark, Handedness } from '../types';

// ─── Message Types ───────────────────────────────────────────────────────────

export interface CVWorkerConfig {
  poseModelPath: string;
  handModelPath: string;
  minPoseConfidence: number;
  minHandConfidence: number;
  numPoses: number;
}

export type CVWorkerInMessage =
  | { type: 'init'; config: CVWorkerConfig }
  | { type: 'processFrame'; frame: ImageBitmap; timestamp: number }
  | { type: 'destroy' };

export type CVWorkerOutMessage =
  | { type: 'ready' }
  | { type: 'result'; data: CVFrameResult }
  | { type: 'error'; error: string };

// ─── Worker State ────────────────────────────────────────────────────────────

let poseLandmarker: unknown = null;
let handLandmarker: unknown = null;
let isInitialized = false;

// ─── Message Handler ─────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<CVWorkerInMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'init':
      await handleInit(message.config);
      break;
    case 'processFrame':
      handleProcessFrame(message.frame, message.timestamp);
      break;
    case 'destroy':
      handleDestroy();
      break;
  }
};

// ─── Init Handler ────────────────────────────────────────────────────────────

/**
 * Load MediaPipe PoseLandmarker and HandLandmarker from the WASM bundle.
 * Posts 'ready' on success or 'error' on failure.
 */
async function handleInit(config: CVWorkerConfig): Promise<void> {
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
    poseLandmarker = await PoseLandmarker.createFromOptions(wasmFileset, {
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
    handLandmarker = await HandLandmarker.createFromOptions(wasmFileset, {
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

    isInitialized = true;
    postTypedMessage({ type: 'ready' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    postTypedMessage({ type: 'error', error: `Initialization failed: ${errorMessage}` });
  }
}

// ─── Process Frame Handler ───────────────────────────────────────────────────

/**
 * Run both Pose Landmarker and Hand Landmarker on the received ImageBitmap.
 * Returns CVFrameResult with pose landmarks, hand landmarks, handedness, and processing time.
 */
function handleProcessFrame(frame: ImageBitmap, timestamp: number): void {
  if (!isInitialized || !poseLandmarker || !handLandmarker) {
    postTypedMessage({ type: 'error', error: 'Worker not initialized' });
    frame.close();
    return;
  }

  const startTime = performance.now();

  try {
    // Run Pose Landmarker
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const poseResult = (poseLandmarker as any).detectForVideo(frame, timestamp);

    // Run Hand Landmarker
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handResult = (handLandmarker as any).detectForVideo(frame, timestamp);

    // Close the ImageBitmap to free memory
    frame.close();

    const processingTimeMs = performance.now() - startTime;

    // Map pose landmarks to our typed format
    const poseLandmarks: NormalizedLandmark[][] | null =
      poseResult.landmarks && poseResult.landmarks.length > 0
        ? poseResult.landmarks.map((personLandmarks: Array<{ x: number; y: number; z: number; visibility?: number; presence?: number }>) =>
            personLandmarks.map((lm: { x: number; y: number; z: number; visibility?: number; presence?: number }) => ({
              x: lm.x,
              y: lm.y,
              z: lm.z,
              visibility: lm.visibility ?? 0,
              presence: lm.presence,
            }))
          )
        : null;

    const poseWorldLandmarks: Landmark[][] | null =
      poseResult.worldLandmarks && poseResult.worldLandmarks.length > 0
        ? poseResult.worldLandmarks.map((personLandmarks: Array<{ x: number; y: number; z: number; visibility?: number }>) =>
            personLandmarks.map((lm: { x: number; y: number; z: number; visibility?: number }) => ({
              x: lm.x,
              y: lm.y,
              z: lm.z,
              visibility: lm.visibility ?? 0,
            }))
          )
        : null;

    // Map hand landmarks to our typed format
    const handLandmarks: NormalizedLandmark[][] | null =
      handResult.landmarks && handResult.landmarks.length > 0
        ? handResult.landmarks.map((handLms: Array<{ x: number; y: number; z: number; visibility?: number; presence?: number }>) =>
            handLms.map((lm: { x: number; y: number; z: number; visibility?: number; presence?: number }) => ({
              x: lm.x,
              y: lm.y,
              z: lm.z,
              visibility: lm.visibility ?? 0,
              presence: lm.presence,
            }))
          )
        : null;

    // Map handedness results
    const handedness: Handedness[] | null =
      handResult.handedness && handResult.handedness.length > 0
        ? handResult.handedness.map((h: Array<{ categoryName: string; score: number }>) => ({
            label: h[0]?.categoryName === 'Left' ? 'Left' : 'Right',
            score: h[0]?.score ?? 0,
          }))
        : null;

    const result: CVFrameResult = {
      timestamp,
      poseLandmarks,
      poseWorldLandmarks,
      handLandmarks,
      handedness,
      processingTimeMs,
    };

    postTypedMessage({ type: 'result', data: result });
  } catch (error) {
    frame.close();
    const errorMessage = error instanceof Error ? error.message : String(error);
    postTypedMessage({ type: 'error', error: `Frame processing failed: ${errorMessage}` });
  }
}

// ─── Destroy Handler ─────────────────────────────────────────────────────────

/**
 * Clean up MediaPipe models and release resources.
 */
function handleDestroy(): void {
  try {
    if (poseLandmarker) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (poseLandmarker as any).close?.();
      poseLandmarker = null;
    }
    if (handLandmarker) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (handLandmarker as any).close?.();
      handLandmarker = null;
    }
    isInitialized = false;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    postTypedMessage({ type: 'error', error: `Destroy failed: ${errorMessage}` });
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Post a typed message back to the main thread.
 */
function postTypedMessage(message: CVWorkerOutMessage): void {
  self.postMessage(message);
}
