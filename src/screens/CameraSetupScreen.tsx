/**
 * CameraSetupScreen — Side-View Landscape Design
 *
 * Requests camera permission (preferring the environment/back camera for
 * side-view capture), shows live preview with the side-view overlay guide,
 * and validates that a hand is detected at the correct height.
 *
 * Key changes from original:
 * - Uses environment (back) camera instead of user (front) camera
 * - 16:9 landscape aspect ratio video preview
 * - No mirror transform (side view, not selfie)
 * - Simplified position detection: just needs hand in middle-third of frame
 * - Instructions reference side-view placement
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { AppEvent, CVFrameResult } from '../types/index';
import { CameraOverlay } from '../components/CameraOverlay';
import type { TestArm } from '../components/CameraOverlay';
import { ConfigStore } from '../config/ConfigStore';
import { CVWorkerManager } from '../cv/CVWorkerManager';
import type { CVWorkerManagerConfig } from '../cv/CVWorkerManager';
import { detectBothArmsExtended } from '../analysis/ArmPoseDetector';
import { PRIVACY_NOTICE_TEXT } from '../privacy/PrivacyManager';
import { useAssessmentSession } from '../session/AssessmentSessionContext';
import './CameraSetupScreen.css';

// ─── CV Worker Configuration ─────────────────────────────────────────────────

const DEFAULT_CV_CONFIG: CVWorkerManagerConfig = {
  poseModelPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  handModelPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  minPoseConfidence: 0.4,
  minHandConfidence: 0.4,
  numPoses: 1,
};

// ─── Types ───────────────────────────────────────────────────────────────────

type CameraPermissionState = 'requesting' | 'denied' | 'granted';

interface CameraSetupScreenProps {
  dispatch: React.Dispatch<AppEvent>;
  /** Which arm is being tested currently */
  testArm?: TestArm;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BRIGHTNESS_SAMPLE_WIDTH = 64;
const BRIGHTNESS_SAMPLE_HEIGHT = 36; // 16:9 ratio

/** Number of consecutive frames with hand detected at correct height to confirm */
const HAND_CONFIRM_FRAMES = 15; // ~1.5s at 10fps

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

export function CameraSetupScreen({ dispatch, testArm = 'left' }: CameraSetupScreenProps) {
  // Shared session that persists the camera + CV pipeline across screens.
  const session = useAssessmentSession();

  // Permission state
  const [permissionState, setPermissionState] = useState<CameraPermissionState>('requesting');

  // Camera stream
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Available cameras
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [currentCameraId, setCurrentCameraId] = useState<string | null>(null);

  // Position confirmation (simplified: just detect hand at correct height)
  const [handDetected, setHandDetected] = useState(false);
  const [positionConfirmed, setPositionConfirmed] = useState(false);
  const handConfirmCountRef = useRef(0);

  // Brightness warning
  const [brightnessLow, setBrightnessLow] = useState(false);

  // References for cleanup and frame processing
  const configRef = useRef<ConfigStore>(new ConfigStore());
  const animFrameRef = useRef<number | null>(null);
  const brightnessCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const brightnessCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  // CV Worker Manager for hand detection
  const cvWorkerRef = useRef<CVWorkerManager | null>(null);
  const [cvReady, setCvReady] = useState(false);
  const cvInitAttemptedRef = useRef(false);

  // Native video frame dimensions (for overlay object-fit mapping)
  const [videoDimensions, setVideoDimensions] = useState({ width: 1280, height: 720 });

  // Displayed size of the preview box (CSS pixels) for the overlay canvas
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [displaySize, setDisplaySize] = useState({ width: 640, height: 360 });

  // Latest detected landmarks for live visualization
  const [handLandmarks, setHandLandmarks] = useState<CVFrameResult['handLandmarks']>(null);
  const [poseLandmarks, setPoseLandmarks] = useState<CVFrameResult['poseLandmarks']>(null);

  // Live debug/status readout so it's obvious what the CV pipeline is doing
  const [debugStatus, setDebugStatus] = useState<string>('Loading pose model…');
  const [cvError, setCvError] = useState<string | null>(null);

  // Detect insecure file:// context up front (camera + models are blocked there)
  const isInsecureContext =
    typeof window !== 'undefined' &&
    window.location.protocol === 'file:';

  // Track whether position was already confirmed to avoid double-dispatch
  const confirmedRef = useRef(false);

  // ─── CV Worker Initialization ─────────────────────────────────────────────

  useEffect(() => {
    if (cvInitAttemptedRef.current) return;
    cvInitAttemptedRef.current = true;

    // Reuse the session's CV manager if it already exists; otherwise create one
    // and hand it to the session so calibration/assessment reuse the same worker.
    const manager = session.getCvManager() ?? new CVWorkerManager();
    session.setCvManager(manager);
    cvWorkerRef.current = manager;

    if (manager.ready) {
      setCvReady(true);
      setDebugStatus(manager.isFallbackMode ? 'Pose model ready (main thread)' : 'Pose model ready');
      return;
    }

    const config: CVWorkerManagerConfig = {
      ...DEFAULT_CV_CONFIG,
      minHandConfidence: configRef.current.get('minHandConfidence'),
    };

    setDebugStatus('Loading pose model…');
    manager.initialize(config).then(() => {
      setCvReady(true);
      setDebugStatus(manager.isFallbackMode ? 'Pose model ready (main thread)' : 'Pose model ready');
    }).catch((err) => {
      console.warn('CV initialization failed:', err);
      setCvError(
        'Could not load the pose model. Check your internet connection ' +
        '(the model downloads from the web on first run).'
      );
      setDebugStatus('Pose model failed to load');
    });

    // NOTE: the CV manager is owned by the shared session now, so we do NOT
    // destroy it on unmount — calibration and the assessment reuse it.
  }, [session]);

  // ─── Camera Request (environment/back camera for side view) ──────────────

  const requestCamera = useCallback(async (deviceId?: string) => {
    try {
      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId } }
          : {
              // Front camera so the user can sit directly in front of a
              // laptop/desktop webcam without turning the device around.
              facingMode: { ideal: 'user' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
        audio: false,
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(mediaStream);
      // Publish the live stream to the shared session so calibration and the
      // timed assessment can grab frames from the same camera.
      session.setStream(mediaStream);
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

      // Remember which arm this run assesses.
      session.setAssessedArm(testArm);

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
  }, [dispatch, session, testArm]);

  // Request camera on mount. The stream is owned by the shared session now, so
  // we do NOT stop its tracks on unmount — calibration and the timed assessment
  // reuse the same live camera. The session releases it on reset()/dispose().
  useEffect(() => {
    requestCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Attach stream to video element
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  // Track the displayed preview box size so the overlay canvas matches it
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
  }, [permissionState]);

  // ─── Camera Switch ──────────────────────────────────────────────────────

  const handleSwitchCamera = useCallback(async () => {
    if (cameras.length < 2) return;

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }

    const currentIdx = cameras.findIndex(c => c.deviceId === currentCameraId);
    const nextIdx = (currentIdx + 1) % cameras.length;
    const nextCamera = cameras[nextIdx];

    if (nextCamera) {
      await requestCamera(nextCamera.deviceId);
    }
  }, [cameras, currentCameraId, stream, requestCamera]);

  // ─── Frame Processing Loop (simplified hand detection) ──────────────────

  useEffect(() => {
    if (permissionState !== 'granted' || !stream || positionConfirmed) return;

    // Create brightness evaluation canvas
    const brightnessCanvas = document.createElement('canvas');
    brightnessCanvas.width = BRIGHTNESS_SAMPLE_WIDTH;
    brightnessCanvas.height = BRIGHTNESS_SAMPLE_HEIGHT;
    const brightnessCtx = brightnessCanvas.getContext('2d', { willReadFrequently: true });
    brightnessCanvasRef.current = brightnessCanvas;
    brightnessCtxRef.current = brightnessCtx;

    const frameInterval = 100; // ~10fps for position checking
    const brightnessThreshold = configRef.current.get('minBrightnessThreshold');
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

      // Send frame to CV Worker for hand detection
      const manager = cvWorkerRef.current;
      if (manager && manager.ready && !processingInFlight) {
        processingInFlight = true;
        createImageBitmap(video).then((imageBitmap) => {
          return manager.processFrame(imageBitmap, timestamp);
        }).then((frameResult: CVFrameResult) => {
          processingInFlight = false;

          // Store landmarks for live visualization (skeleton + optional fingers)
          setHandLandmarks(frameResult.handLandmarks);
          setPoseLandmarks(frameResult.poseLandmarks);

          // POSE-FIRST detection for the FRONT-FACING both-arms test: the subject
          // faces the camera and holds BOTH arms out in front (palms up). We only
          // need each arm's shoulder → elbow → wrist at roughly shoulder height —
          // no hand/finger model required to begin.
          const armsResult = detectBothArmsExtended(frameResult.poseLandmarks?.[0]);
          const bothArmsReady = armsResult.bothDetected;

          // Live debug readout of what the pose model actually sees, per arm.
          const pose = frameResult.poseLandmarks?.[0];
          if (!pose) {
            setDebugStatus('No person detected — step back so your head and both arms are in view');
          } else {
            // Mirror-aware labels: the preview is mirrored (selfie), and MediaPipe
            // labels arms from the image's perspective, so image "left" is the
            // user's RIGHT arm and vice-versa. Report using the user's own sides.
            const yourRight = armsResult.left ? '✓' : '✗';
            const yourLeft = armsResult.right ? '✓' : '✗';
            setDebugStatus(
              (bothArmsReady ? 'Both arms detected — ' : 'Raise both arms — ') +
                `your left ${yourLeft}   your right ${yourRight}`
            );
          }

          setHandDetected(bothArmsReady);

          if (bothArmsReady) {
            handConfirmCountRef.current++;
            if (handConfirmCountRef.current >= HAND_CONFIRM_FRAMES && !confirmedRef.current) {
              confirmedRef.current = true;
              setPositionConfirmed(true);
            }
          } else {
            // Reset counter if hand lost
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
  }, [permissionState, stream, positionConfirmed, cvReady]);

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
            observes both of your arms from the front during the test.
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

  // Requesting state
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

  // Granted state — show live preview (front-facing, both arms)

  return (
    <div className="camera-setup-screen" role="region" aria-label="Camera Setup">
      <h2 className="camera-setup-screen__title">Camera Setup — Face the Camera</h2>

      {/* file:// warning — camera + models are blocked when opened directly */}
      {isInsecureContext && (
        <p className="camera-setup-screen__warning" role="alert" style={{ width: '100%' }}>
          ⚠ You opened this file directly. The camera and pose model are blocked
          in this mode. Please launch the app with <strong>RunPronatorDrift.bat</strong>
          (it opens the app at http://localhost so everything works).
        </p>
      )}

      {/* CV load error */}
      {cvError && (
        <p className="camera-setup-screen__warning" role="alert" style={{ width: '100%' }}>
          ⚠ {cvError}
        </p>
      )}

      {/* Live pose-detection status readout */}
      <p
        className="camera-setup-screen__debug"
        aria-live="polite"
        style={{
          width: '100%',
          textAlign: 'center',
          fontSize: '0.85rem',
          color: handDetected ? '#00e676' : 'var(--color-text-secondary)',
          margin: 0,
        }}
      >
        {debugStatus}
      </p>

      {/* Live camera preview with side-view overlay */}
      <div className="camera-setup-screen__preview-container" ref={previewContainerRef}>
        <video
          ref={videoRef}
          className="camera-setup-screen__video"
          autoPlay
          playsInline
          muted
          data-testid="camera-preview"
          aria-label="Camera preview - front facing"
        />
        <CameraOverlay
          width={displaySize.width}
          height={displaySize.height}
          videoWidth={videoDimensions.width}
          videoHeight={videoDimensions.height}
          objectFit="contain"
          mirrored
          mode="positioning"
          testArm={testArm}
          handLandmarks={handLandmarks}
          poseLandmarks={poseLandmarks}
        />
      </div>

      {/* Side panel with instructions and controls */}
      <div className="camera-setup-screen__side-panel">
        {/* Instructions */}
        <div className="camera-setup-screen__instructions">
          <p>
            <strong>1.</strong> Face the camera so your head and both arms are in view<br />
            <strong>2.</strong> Hold <strong>both arms</strong> straight out in front of you<br />
            <strong>3.</strong> Turn your <strong>palms up</strong> (as if holding a tray)<br />
            <strong>4.</strong> Keep arms at shoulder height and close your eyes — the test starts automatically
          </p>
        </div>

        {/* Positioning feedback */}
        <div className="camera-setup-screen__feedback" aria-live="polite" role="status">
          {positionConfirmed ? (
            <div className="camera-setup-screen__confirmed" data-testid="position-confirmed">
              <span className="camera-setup-screen__confirmed-icon" aria-hidden="true">✓</span>
              <span className="camera-setup-screen__confirmed-text">Both arms detected — ready!</span>
            </div>
          ) : handDetected ? (
            <p className="camera-setup-screen__correction" data-testid="positioning-feedback"
               style={{ borderColor: 'rgba(0, 230, 118, 0.4)', color: '#00e676' }}>
              Both arms detected — hold steady...
            </p>
          ) : (
            <p className="camera-setup-screen__correction" data-testid="positioning-feedback">
              Waiting — hold both arms out in front at shoulder height, palms up
            </p>
          )}
        </div>

        {/* Brightness warning */}
        {brightnessLow && (
          <p className="camera-setup-screen__warning" data-testid="brightness-warning" role="alert">
            Lighting appears too low. Please improve lighting conditions.
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
            Start Assessment
          </button>
        )}
      </div>
    </div>
  );
}
