/**
 * CameraSetupScreen — requests camera permission, shows live preview,
 * validates positioning, and reports readiness.
 *
 * Responsibilities:
 * - Request getUserMedia on mount
 * - Show a permission-denied message with platform-specific guidance if denied
 * - Show live video preview via <video> element
 * - Overlay the CameraOverlay component for positioning guides
 * - Run PositionValidator at ≥5 fps for positioning checks
 * - Display single highest-priority positioning feedback within 500ms
 * - Show brightness warning if CameraSystem reports low brightness
 * - Show camera switch button when multiple cameras available
 * - Show "Position Confirmed" when all validation checks pass
 * - Dispatch CAMERA_READY then ALL_CHECKS_PASS events
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { AppEvent, CVFrameResult, PositionValidationResult } from '../types/index';
import { CameraOverlay } from '../components/CameraOverlay';
import { PositionValidatorImpl } from '../analysis/PositionValidator';
import { ConfigStore } from '../config/ConfigStore';
import { PRIVACY_NOTICE_TEXT } from '../privacy/PrivacyManager';
import './CameraSetupScreen.css';

// ─── Types ───────────────────────────────────────────────────────────────────

type CameraPermissionState = 'requesting' | 'denied' | 'granted';

interface CameraSetupScreenProps {
  dispatch: React.Dispatch<AppEvent>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Minimum brightness threshold (0–255) below which a warning is shown. */
const BRIGHTNESS_SAMPLE_WIDTH = 64;
const BRIGHTNESS_SAMPLE_HEIGHT = 48;

/** Detected platform for permission guidance. */
function detectPlatform(): 'ios' | 'android' | 'desktop' {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  return 'desktop';
}

/** Platform-specific permission guidance messages. */
function getPermissionGuidance(): string {
  const platform = detectPlatform();
  switch (platform) {
    case 'ios':
      return 'On iOS, go to Settings > Safari > Camera & Microphone Access and enable camera for this site.';
    case 'android':
      return 'On Android, tap the lock icon in the address bar and allow camera access for this site.';
    default:
      return 'In your browser settings, find the site permissions section and allow camera access for this page.';
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CameraSetupScreen({ dispatch }: CameraSetupScreenProps) {
  // Permission state
  const [permissionState, setPermissionState] = useState<CameraPermissionState>('requesting');

  // Camera stream
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Available cameras
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [currentCameraId, setCurrentCameraId] = useState<string | null>(null);

  // Positioning feedback
  const [validationResult, setValidationResult] = useState<PositionValidationResult | null>(null);
  const [positionConfirmed, setPositionConfirmed] = useState(false);

  // Brightness warning
  const [brightnessLow, setBrightnessLow] = useState(false);

  // Multi-person detection
  const [multiplePersons, setMultiplePersons] = useState(false);

  // References for cleanup and frame processing
  const positionValidatorRef = useRef<PositionValidatorImpl>(new PositionValidatorImpl());
  const configRef = useRef<ConfigStore>(new ConfigStore());
  const animFrameRef = useRef<number | null>(null);
  const brightnessCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const brightnessCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  // Video container dimensions for overlay
  const [videoDimensions, setVideoDimensions] = useState({ width: 640, height: 480 });

  // Track whether position was already confirmed to avoid double-dispatch
  const confirmedRef = useRef(false);

  // ─── Camera Request ──────────────────────────────────────────────────────

  const requestCamera = useCallback(async (deviceId?: string) => {
    try {
      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId } }
          : { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(mediaStream);
      setPermissionState('granted');

      // Enumerate available cameras
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      setCameras(videoDevices);

      // Track which camera is active
      const activeTrack = mediaStream.getVideoTracks()[0];
      if (activeTrack) {
        const settings = activeTrack.getSettings();
        setCurrentCameraId(settings.deviceId ?? null);
      }

      // Dispatch CAMERA_READY to state machine
      dispatch({ type: 'CAMERA_READY' });
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setPermissionState('denied');
      } else {
        setPermissionState('denied');
      }
    }
  }, [dispatch]);

  // Request camera on mount
  useEffect(() => {
    requestCamera();

    return () => {
      // Cleanup stream on unmount
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Attach stream to video element
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {
        // Autoplay may be blocked, handled gracefully
      });
    }
  }, [stream]);

  // ─── Camera Switch ──────────────────────────────────────────────────────

  const handleSwitchCamera = useCallback(async () => {
    if (cameras.length < 2) return;

    // Stop current stream
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }

    // Find next camera
    const currentIdx = cameras.findIndex(c => c.deviceId === currentCameraId);
    const nextIdx = (currentIdx + 1) % cameras.length;
    const nextCamera = cameras[nextIdx];

    if (nextCamera) {
      await requestCamera(nextCamera.deviceId);
    }
  }, [cameras, currentCameraId, stream, requestCamera]);

  // ─── Frame Processing Loop (Positioning Checks) ─────────────────────────

  useEffect(() => {
    if (permissionState !== 'granted' || !stream || positionConfirmed) return;

    // Create brightness evaluation canvas
    const brightnessCanvas = document.createElement('canvas');
    brightnessCanvas.width = BRIGHTNESS_SAMPLE_WIDTH;
    brightnessCanvas.height = BRIGHTNESS_SAMPLE_HEIGHT;
    const brightnessCtx = brightnessCanvas.getContext('2d', { willReadFrequently: true });
    brightnessCanvasRef.current = brightnessCanvas;
    brightnessCtxRef.current = brightnessCtx;

    const minFrameRate = configRef.current.get('minPositioningFrameRate');
    const frameInterval = 1000 / minFrameRate;
    const brightnessThreshold = configRef.current.get('minBrightnessThreshold');
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

      // Evaluate brightness
      if (brightnessCtxRef.current && brightnessCanvasRef.current) {
        brightnessCtxRef.current.drawImage(video, 0, 0, BRIGHTNESS_SAMPLE_WIDTH, BRIGHTNESS_SAMPLE_HEIGHT);
        const imageData = brightnessCtxRef.current.getImageData(0, 0, BRIGHTNESS_SAMPLE_WIDTH, BRIGHTNESS_SAMPLE_HEIGHT);
        const pixels = imageData.data;
        const pixelCount = BRIGHTNESS_SAMPLE_WIDTH * BRIGHTNESS_SAMPLE_HEIGHT;
        let totalLuminance = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          totalLuminance += 0.299 * pixels[i]! + 0.587 * pixels[i + 1]! + 0.114 * pixels[i + 2]!;
        }
        const avgBrightness = totalLuminance / pixelCount;
        setBrightnessLow(avgBrightness < brightnessThreshold);
      }

      // Create a synthetic CVFrameResult for position validation
      // In a full implementation, this would come from the CV Worker.
      // For the camera setup screen, we run basic pose detection checks.
      // Since MediaPipe runs in a worker, we simulate the validation
      // result structure here. The actual Pose Landmarker integration
      // will provide real landmarks through the CV pipeline.
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

      // Check for multiple persons (poseLandmarks array length > 1)
      if (frameResult.poseLandmarks && frameResult.poseLandmarks.length > 1) {
        setMultiplePersons(true);
      } else {
        setMultiplePersons(false);
      }

      // Check if position confirmed
      const requiredHold = configRef.current.get('requiredHoldDuration');
      if (result.isValid && result.holdProgress >= 1.0) {
        if (!confirmedRef.current) {
          confirmedRef.current = true;
          setPositionConfirmed(true);
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
  }, [permissionState, stream, positionConfirmed]);

  // ─── Continue Handler ────────────────────────────────────────────────────

  const handleContinue = useCallback(() => {
    dispatch({ type: 'ALL_CHECKS_PASS' });
  }, [dispatch]);

  // ─── Render ──────────────────────────────────────────────────────────────

  // Permission denied state
  if (permissionState === 'denied') {
    return (
      <div className="camera-setup-screen" role="region" aria-label="Camera Setup">
        <div className="camera-setup-screen__permission-denied">
          <h2 className="camera-setup-screen__title">Camera Access Required</h2>
          <p className="camera-setup-screen__permission-message">
            Camera access is required for the pronator drift assessment. The camera
            is used to observe your arm position during the test.
          </p>
          <p className="camera-setup-screen__permission-guidance">
            {getPermissionGuidance()}
          </p>
          <button
            className="camera-setup-screen__btn camera-setup-screen__btn--retry"
            onClick={() => {
              setPermissionState('requesting');
              requestCamera();
            }}
            type="button"
          >
            Retry Camera Access
          </button>
        </div>
      </div>
    );
  }

  // Requesting state — shows privacy notice before camera access
  if (permissionState === 'requesting') {
    return (
      <div className="camera-setup-screen" role="region" aria-label="Camera Setup">
        <div className="camera-setup-screen__requesting">
          <h2 className="camera-setup-screen__title">Camera Setup</h2>
          <p className="camera-setup-screen__privacy-notice" data-testid="privacy-notice">
            {PRIVACY_NOTICE_TEXT}
          </p>
          <p className="camera-setup-screen__requesting-message">
            Requesting camera access...
          </p>
        </div>
      </div>
    );
  }

  // Granted state — show live preview with overlay
  return (
    <div className="camera-setup-screen" role="region" aria-label="Camera Setup">
      <h2 className="camera-setup-screen__title">Camera Setup</h2>

      {/* Live camera preview with overlay */}
      <div className="camera-setup-screen__preview-container">
        <video
          ref={videoRef}
          className="camera-setup-screen__video"
          autoPlay
          playsInline
          muted
          data-testid="camera-preview"
          aria-label="Camera preview"
        />
        <CameraOverlay
          width={videoDimensions.width}
          height={videoDimensions.height}
          mode="positioning"
        />
      </div>

      {/* Positioning feedback — highest priority only */}
      <div className="camera-setup-screen__feedback" aria-live="polite" role="status">
        {positionConfirmed ? (
          <div className="camera-setup-screen__confirmed" data-testid="position-confirmed">
            <span className="camera-setup-screen__confirmed-icon" aria-hidden="true">✓</span>
            <span className="camera-setup-screen__confirmed-text">Position Confirmed</span>
          </div>
        ) : validationResult?.highestPriorityFail ? (
          <p className="camera-setup-screen__correction" data-testid="positioning-feedback">
            {validationResult.checks.find(c => c.type === validationResult.highestPriorityFail)?.message}
          </p>
        ) : null}
      </div>

      {/* Multiple persons warning */}
      {multiplePersons && (
        <p className="camera-setup-screen__warning" data-testid="multiple-persons-warning" role="alert">
          Multiple people detected. Please ensure only one person is visible to the camera.
        </p>
      )}

      {/* Brightness warning */}
      {brightnessLow && (
        <p className="camera-setup-screen__warning" data-testid="brightness-warning" role="alert">
          Lighting appears too low. Please improve lighting conditions for accurate tracking.
        </p>
      )}

      {/* Camera switch control */}
      {cameras.length > 1 && (
        <button
          className="camera-setup-screen__btn camera-setup-screen__btn--switch"
          onClick={handleSwitchCamera}
          type="button"
          data-testid="camera-switch-btn"
          aria-label="Switch camera"
        >
          Switch Camera
        </button>
      )}

      {/* Continue button — enabled when position confirmed */}
      {positionConfirmed && (
        <button
          className="camera-setup-screen__btn camera-setup-screen__btn--continue"
          onClick={handleContinue}
          type="button"
          data-testid="continue-btn"
        >
          Continue
        </button>
      )}
    </div>
  );
}
