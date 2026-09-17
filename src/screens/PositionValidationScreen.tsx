/**
 * PositionValidationScreen — Simplified for Side-View Hand Detection
 *
 * In the new side-view approach, position validation is much simpler:
 * - Just detect if a hand/wrist is visible in the frame
 * - Check it's at roughly the correct height (middle third of frame)
 * - If yes for ~1.5 seconds, position is confirmed
 *
 * No full body pose required. Uses MediaPipe Hand Landmarker only.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { AppEvent, CVFrameResult } from '../types/index';
import { CameraOverlay } from '../components/CameraOverlay';
import type { TestArm } from '../components/CameraOverlay';
import { ConfigStore } from '../config/ConfigStore';
import { CVWorkerManager } from '../cv/CVWorkerManager';
import type { CVWorkerManagerConfig } from '../cv/CVWorkerManager';
import { detectExtendedArm } from '../analysis/ArmPoseDetector';
import './PositionValidationScreen.css';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_CV_CONFIG: CVWorkerManagerConfig = {
  poseModelPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  handModelPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  minPoseConfidence: 0.4,
  minHandConfidence: 0.4,
  numPoses: 1,
};

/** Default timeout in seconds before offering replay/exit options. */
const DEFAULT_TIMEOUT_SECONDS = 60;

/** Consecutive frames with hand at correct height to confirm */
const HAND_CONFIRM_FRAMES = 15;

interface PositionValidationScreenProps {
  dispatch: React.Dispatch<AppEvent>;
  /** Optional external stream from camera system (for reuse from CameraSetup). */
  stream?: MediaStream | null;
  /** Which arm is being tested */
  testArm?: TestArm;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PositionValidationScreen({
  dispatch,
  stream: externalStream,
  testArm = 'left',
}: PositionValidationScreenProps) {
  // Position validation state
  const [handDetected, setHandDetected] = useState(false);
  const [positionConfirmed, setPositionConfirmed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const handConfirmCountRef = useRef(0);

  // Camera stream
  const [stream, setStream] = useState<MediaStream | null>(externalStream ?? null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Native video frame dimensions (for overlay object-fit mapping)
  const [videoDimensions, setVideoDimensions] = useState({ width: 1280, height: 720 });

  // Displayed preview box size (CSS pixels) for the overlay canvas
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [displaySize, setDisplaySize] = useState({ width: 640, height: 360 });

  // Latest detected landmarks for live visualization
  const [handLandmarks, setHandLandmarks] = useState<CVFrameResult['handLandmarks']>(null);
  const [poseLandmarks, setPoseLandmarks] = useState<CVFrameResult['poseLandmarks']>(null);

  // Refs for processing
  const configRef = useRef<ConfigStore>(new ConfigStore());
  const animFrameRef = useRef<number | null>(null);
  const timeoutTimerRef = useRef<number | null>(null);
  const confirmedRef = useRef(false);

  // CV Worker Manager for hand detection
  const cvWorkerRef = useRef<CVWorkerManager | null>(null);
  const [cvReady, setCvReady] = useState(false);
  const cvInitAttemptedRef = useRef(false);

  // ─── CV Worker Initialization ─────────────────────────────────────────────

  useEffect(() => {
    if (cvInitAttemptedRef.current) return;
    cvInitAttemptedRef.current = true;

    const manager = new CVWorkerManager();
    cvWorkerRef.current = manager;

    const config: CVWorkerManagerConfig = {
      ...DEFAULT_CV_CONFIG,
      minHandConfidence: configRef.current.get('minHandConfidence'),
    };

    manager.initialize(config).then(() => {
      setCvReady(true);
    }).catch((err) => {
      console.warn('CV Worker initialization failed:', err);
    });

    return () => {
      manager.destroy();
      cvWorkerRef.current = null;
    };
  }, []);

  // ─── Camera Request (fallback if no external stream) ──────────────────

  useEffect(() => {
    if (externalStream) {
      setStream(externalStream);
      return;
    }

    let mediaStream: MediaStream | null = null;

    async function requestCamera() {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'user' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        setStream(mediaStream);
      } catch {
        // Camera access handled by CameraSetup screen
      }
    }

    requestCamera();

    return () => {
      if (mediaStream && !externalStream) {
        mediaStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [externalStream]);

  // Attach stream to video element
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  // Track displayed preview box size for the overlay canvas
  useEffect(() => {
    const el = previewContainerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setDisplaySize({ width: Math.round(rect.width), height: Math.round(rect.height) });
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [stream]);

  // ─── 60-second Timeout ────────────────────────────────────────────────

  useEffect(() => {
    if (positionConfirmed || timedOut) return;

    const timeoutDuration = configRef.current.get('positionValidationTimeout') ?? DEFAULT_TIMEOUT_SECONDS;

    timeoutTimerRef.current = window.setTimeout(() => {
      setTimedOut(true);
      dispatch({ type: 'POSITION_TIMEOUT' });
    }, timeoutDuration * 1000);

    return () => {
      if (timeoutTimerRef.current !== null) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
    };
  }, [positionConfirmed, timedOut, dispatch]);

  // ─── Frame Processing Loop (Simplified Hand Detection) ────────────────

  useEffect(() => {
    if (!stream || positionConfirmed || timedOut) return;

    const frameInterval = 100; // ~10fps
    let lastFrameTime = 0;
    let processingInFlight = false;

    const processFrame = (timestamp: number) => {
      if (!videoRef.current || videoRef.current.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        animFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }

      if (timestamp - lastFrameTime < frameInterval) {
        animFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }
      lastFrameTime = timestamp;

      const video = videoRef.current;

      // Update video dimensions
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
      }

      // Send frame to CV Worker for hand detection
      const manager = cvWorkerRef.current;
      if (manager && manager.ready && !processingInFlight) {
        processingInFlight = true;
        createImageBitmap(video).then((imageBitmap) => {
          return manager.processFrame(imageBitmap, timestamp);
        }).then((frameResult: CVFrameResult) => {
          processingInFlight = false;

          // Store landmarks for live visualization
          setHandLandmarks(frameResult.handLandmarks);
          setPoseLandmarks(frameResult.poseLandmarks);

          // POSE-FIRST: start as soon as the pose shows an extended arm at
          // roughly shoulder height. No hand/finger model needed.
          const armResult = detectExtendedArm(frameResult.poseLandmarks?.[0], testArm);
          const handAtCorrectHeight = armResult.detected;

          setHandDetected(handAtCorrectHeight);

          if (handAtCorrectHeight) {
            handConfirmCountRef.current++;
            if (handConfirmCountRef.current >= HAND_CONFIRM_FRAMES && !confirmedRef.current) {
              confirmedRef.current = true;
              setPositionConfirmed(true);
              dispatch({ type: 'POSITION_VALID' });
            }
          } else {
            handConfirmCountRef.current = Math.max(0, handConfirmCountRef.current - 2);
          }
        }).catch((err) => {
          processingInFlight = false;
          if (err?.message !== 'Frame dropped: newer frame submitted') {
            console.warn('CV frame processing error:', err);
          }
        });
      }

      animFrameRef.current = requestAnimationFrame(processFrame);
    };

    animFrameRef.current = requestAnimationFrame(processFrame);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [stream, positionConfirmed, timedOut, dispatch, cvReady]);

  // ─── Handlers ─────────────────────────────────────────────────────────

  const handleReplayInstructions = useCallback(() => {
    dispatch({ type: 'REPLAY_INSTRUCTIONS' });
  }, [dispatch]);

  const handleExitAssessment = useCallback(() => {
    dispatch({ type: 'EXIT_ASSESSMENT' });
  }, [dispatch]);

  // ─── Render: Timed Out State ──────────────────────────────────────────

  if (timedOut) {
    return (
      <div className="position-validation-screen" role="region" aria-label="Position Validation">
        <h2 className="position-validation-screen__title">Position Validation</h2>
        <div className="position-validation-screen__timeout" data-testid="timeout-message">
          <p className="position-validation-screen__timeout-text">
            Could not detect your hand in the correct position.
          </p>
          <p className="position-validation-screen__timeout-hint">
            Make sure your hand is visible in the middle of the camera frame.
          </p>
          <div className="position-validation-screen__timeout-actions">
            <button
              className="position-validation-screen__btn position-validation-screen__btn--replay"
              onClick={handleReplayInstructions}
              type="button"
              data-testid="replay-instructions-btn"
            >
              Replay Instructions
            </button>
            <button
              className="position-validation-screen__btn position-validation-screen__btn--exit"
              onClick={handleExitAssessment}
              type="button"
              data-testid="exit-assessment-btn"
            >
              Exit Assessment
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render: Position Confirmed State ─────────────────────────────────

  if (positionConfirmed) {
    return (
      <div className="position-validation-screen" role="region" aria-label="Position Validation">
        <h2 className="position-validation-screen__title">Position Confirmed</h2>
        <div className="position-validation-screen__confirmed" data-testid="position-confirmed">
          <span className="position-validation-screen__confirmed-icon" aria-hidden="true">✓</span>
          <span className="position-validation-screen__confirmed-text">
            Hand detected at correct height — starting test
          </span>
        </div>
      </div>
    );
  }

  // ─── Render: Active Validation ────────────────────────────────────────

  const armLabel = testArm === 'left' ? 'LEFT' : 'RIGHT';
  const holdPercentage = Math.round((handConfirmCountRef.current / HAND_CONFIRM_FRAMES) * 100);

  return (
    <div className="position-validation-screen" role="region" aria-label="Position Validation">
      <h2 className="position-validation-screen__title">Hold Your {armLabel} Arm Steady</h2>

      {/* Live camera preview with overlay */}
      <div className="position-validation-screen__preview-container" ref={previewContainerRef}>
        <video
          ref={videoRef}
          className="position-validation-screen__video"
          autoPlay
          playsInline
          muted
          data-testid="validation-camera-preview"
          aria-label="Camera preview - side view"
        />
        <CameraOverlay
          width={displaySize.width}
          height={displaySize.height}
          videoWidth={videoDimensions.width}
          videoHeight={videoDimensions.height}
          objectFit="contain"
          mirrored
          mode="tracking"
          testArm={testArm}
          handLandmarks={handLandmarks}
          poseLandmarks={poseLandmarks}
        />
      </div>

      {/* Hold Progress Indicator */}
      <div className="position-validation-screen__progress" data-testid="hold-progress">
        <div className="position-validation-screen__progress-bar-container">
          <div
            className="position-validation-screen__progress-bar-fill"
            style={{ width: `${Math.min(holdPercentage, 100)}%` }}
            role="progressbar"
            aria-valuenow={Math.min(holdPercentage, 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Hold progress"
          />
        </div>
        <span className="position-validation-screen__progress-text" aria-live="polite">
          {Math.min(holdPercentage, 100)}%
        </span>
      </div>

      {/* Feedback */}
      <div className="position-validation-screen__feedback" aria-live="polite" role="status">
        {handDetected ? (
          <p className="position-validation-screen__valid-text" data-testid="position-valid-feedback">
            ✓ Hand detected — hold steady...
          </p>
        ) : (
          <p className="position-validation-screen__correction" data-testid="positioning-correction">
            Extend your {armLabel.toLowerCase()} arm so your hand is visible in the middle of the frame
          </p>
        )}
      </div>
    </div>
  );
}
