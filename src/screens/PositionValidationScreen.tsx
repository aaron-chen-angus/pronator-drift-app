/**
 * PositionValidationScreen — displays real-time position validation feedback,
 * a hold progress indicator, and handles timeout with replay/exit options.
 *
 * Responsibilities:
 * - Show live camera video with canvas overlay
 * - Display highest-priority correction message from PositionValidator
 * - Show hold progress bar (0-100%) as user holds valid position
 * - Display "Position confirmed" when hold duration is met
 * - Dispatch POSITION_VALID event on confirmation
 * - Handle 60-second timeout with "Replay Instructions" and "Exit Assessment" options
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { AppEvent, CVFrameResult, PositionValidationResult } from '../types/index';
import { CameraOverlay } from '../components/CameraOverlay';
import { PositionValidatorImpl } from '../analysis/PositionValidator';
import { ConfigStore } from '../config/ConfigStore';
import './PositionValidationScreen.css';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default timeout in seconds before offering replay/exit options. */
const DEFAULT_TIMEOUT_SECONDS = 60;

interface PositionValidationScreenProps {
  dispatch: React.Dispatch<AppEvent>;
  /** Optional external stream from camera system (for reuse from CameraSetup). */
  stream?: MediaStream | null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PositionValidationScreen({ dispatch, stream: externalStream }: PositionValidationScreenProps) {
  // Position validation state
  const [validationResult, setValidationResult] = useState<PositionValidationResult | null>(null);
  const [positionConfirmed, setPositionConfirmed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Camera stream (from external prop or request own)
  const [stream, setStream] = useState<MediaStream | null>(externalStream ?? null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Video dimensions for overlay
  const [videoDimensions, setVideoDimensions] = useState({ width: 640, height: 480 });

  // Refs for processing
  const positionValidatorRef = useRef<PositionValidatorImpl>(new PositionValidatorImpl());
  const configRef = useRef<ConfigStore>(new ConfigStore());
  const animFrameRef = useRef<number | null>(null);
  const timeoutTimerRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);
  const confirmedRef = useRef(false);
  const startTimeRef = useRef<number>(Date.now());

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
          video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        setStream(mediaStream);
      } catch {
        // Camera access issues are handled by the CameraSetup screen;
        // this is a fallback for robustness.
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
      videoRef.current.play().catch(() => {
        // Autoplay may be blocked
      });
    }
  }, [stream]);

  // ─── 60-second Timeout ────────────────────────────────────────────────

  useEffect(() => {
    if (positionConfirmed || timedOut) return;

    const timeoutDuration = configRef.current.get('positionValidationTimeout') ?? DEFAULT_TIMEOUT_SECONDS;
    startTimeRef.current = Date.now();

    // Elapsed seconds counter (updates every second)
    elapsedTimerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedSeconds(elapsed);
    }, 1000);

    // Timeout handler
    timeoutTimerRef.current = window.setTimeout(() => {
      setTimedOut(true);
      dispatch({ type: 'POSITION_TIMEOUT' });
    }, timeoutDuration * 1000);

    return () => {
      if (timeoutTimerRef.current !== null) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
      if (elapsedTimerRef.current !== null) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    };
  }, [positionConfirmed, timedOut, dispatch]);

  // ─── Frame Processing Loop (Position Validation) ──────────────────────

  useEffect(() => {
    if (!stream || positionConfirmed || timedOut) return;

    const minFrameRate = configRef.current.get('minPositioningFrameRate');
    const frameInterval = 1000 / minFrameRate;
    let lastFrameTime = 0;

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

      // Create a synthetic CVFrameResult for position validation.
      // In full integration, this comes from the CV Worker pipeline.
      const frameResult: CVFrameResult = {
        timestamp,
        poseLandmarks: null,
        poseWorldLandmarks: null,
        handLandmarks: null,
        handedness: null,
        processingTimeMs: 0,
      };

      // Run position validation
      const result = positionValidatorRef.current.validate(frameResult, configRef.current);
      setValidationResult(result);

      // Check if position confirmed (hold progress reached 100%)
      if (result.isValid && result.holdProgress >= 1.0) {
        if (!confirmedRef.current) {
          confirmedRef.current = true;
          setPositionConfirmed(true);
          dispatch({ type: 'POSITION_VALID' });
        }
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
  }, [stream, positionConfirmed, timedOut, dispatch]);

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
            Position could not be confirmed within the allowed time.
          </p>
          <p className="position-validation-screen__timeout-hint">
            Would you like to review the instructions or exit the assessment?
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
        <h2 className="position-validation-screen__title">Position Validation</h2>
        <div className="position-validation-screen__confirmed" data-testid="position-confirmed">
          <span className="position-validation-screen__confirmed-icon" aria-hidden="true">✓</span>
          <span className="position-validation-screen__confirmed-text">Position confirmed</span>
        </div>
      </div>
    );
  }

  // ─── Render: Active Validation ────────────────────────────────────────

  const holdProgress = validationResult?.holdProgress ?? 0;
  const holdPercentage = Math.round(holdProgress * 100);
  const highestPriorityFail = validationResult?.highestPriorityFail ?? null;
  const correctionMessage = highestPriorityFail
    ? validationResult?.checks.find(c => c.type === highestPriorityFail)?.message ?? null
    : null;

  return (
    <div className="position-validation-screen" role="region" aria-label="Position Validation">
      <h2 className="position-validation-screen__title">Hold Your Position</h2>

      {/* Live camera preview with overlay */}
      <div className="position-validation-screen__preview-container">
        <video
          ref={videoRef}
          className="position-validation-screen__video"
          autoPlay
          playsInline
          muted
          data-testid="validation-camera-preview"
          aria-label="Camera preview"
        />
        <CameraOverlay
          width={videoDimensions.width}
          height={videoDimensions.height}
          mode="positioning"
        />
      </div>

      {/* Hold Progress Indicator */}
      <div className="position-validation-screen__progress" data-testid="hold-progress">
        <div className="position-validation-screen__progress-bar-container">
          <div
            className="position-validation-screen__progress-bar-fill"
            style={{ width: `${holdPercentage}%` }}
            role="progressbar"
            aria-valuenow={holdPercentage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Hold progress"
          />
        </div>
        <span className="position-validation-screen__progress-text" aria-live="polite">
          {holdPercentage}%
        </span>
      </div>

      {/* Positioning feedback — highest priority correction */}
      <div className="position-validation-screen__feedback" aria-live="polite" role="status">
        {correctionMessage ? (
          <p className="position-validation-screen__correction" data-testid="positioning-correction">
            {correctionMessage}
          </p>
        ) : validationResult?.isValid ? (
          <p className="position-validation-screen__valid-text" data-testid="position-valid-feedback">
            Hold still...
          </p>
        ) : null}
      </div>
    </div>
  );
}
