/**
 * Core TypeScript interfaces and data models for the Pronator Drift Screening Application.
 *
 * All types are defined here as the single source of truth for the application's
 * data structures, classification unions, and state machine types.
 */

// ─── Geometry ────────────────────────────────────────────────────────────────

/** 3D vector used for internal geometry calculations. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// ─── Computer Vision Pipeline ────────────────────────────────────────────────

/** Normalized landmark with coordinates in [0.0, 1.0] image space. */
export interface NormalizedLandmark {
  /** Horizontal position, 0.0–1.0 */
  x: number;
  /** Vertical position, 0.0–1.0 */
  y: number;
  /** Depth estimate */
  z: number;
  /** Visibility confidence, 0.0–1.0 */
  visibility: number;
  /** Presence confidence (optional) */
  presence?: number;
}

/** World-space landmark with coordinates in meters. */
export interface Landmark {
  /** X position in meters */
  x: number;
  /** Y position in meters */
  y: number;
  /** Z position in meters */
  z: number;
  /** Visibility confidence, 0.0–1.0 */
  visibility: number;
}

/** Hand classification with confidence score. */
export type Handedness = {
  label: 'Left' | 'Right';
  score: number;
};

/** Result from a single CV frame processed by the Web Worker. */
export interface CVFrameResult {
  /** Frame timestamp in milliseconds */
  timestamp: number;
  /** Normalized pose landmarks per detected person (null if detection failed) */
  poseLandmarks: NormalizedLandmark[][] | null;
  /** World-space pose landmarks per detected person (null if detection failed) */
  poseWorldLandmarks: Landmark[][] | null;
  /** Normalized hand landmarks per detected hand (null if detection failed) */
  handLandmarks: NormalizedLandmark[][] | null;
  /** Handedness classification per detected hand (null if detection failed) */
  handedness: Handedness[] | null;
  /** Time taken to process this frame in milliseconds */
  processingTimeMs: number;
}

// ─── Drift Analysis ──────────────────────────────────────────────────────────

/** Per-frame drift measurements during the 30-second assessment. */
export interface DriftFrame {
  /** Frame timestamp in milliseconds */
  timestamp: number;
  /** Left wrist normalized drift (0.0 = no drift, positive = downward) */
  leftWristDrift: number;
  /** Right wrist normalized drift (0.0 = no drift, positive = downward) */
  rightWristDrift: number;
  /** Left elbow normalized drift */
  leftElbowDrift: number;
  /** Right elbow normalized drift */
  rightElbowDrift: number;
  /** Left palm rotation change in degrees from baseline (null if not measurable) */
  leftPronation: number | null;
  /** Right palm rotation change in degrees from baseline (null if not measurable) */
  rightPronation: number | null;
  /** Left arm landmark confidence, 0.0–1.0 */
  leftConfidence: number;
  /** Right arm landmark confidence, 0.0–1.0 */
  rightConfidence: number;
  /** Measured torso compensation applied this frame */
  torsoCompensation: number;
  /** Measured camera movement this frame */
  cameraMovement: number;
  /** Whether this frame is valid for drift analysis */
  frameValid: boolean;
}

// ─── Baseline / Calibration ──────────────────────────────────────────────────

/** Per-arm baseline measurements captured during calibration. */
export interface ArmBaseline {
  /** Shoulder position in normalized/world coordinates */
  shoulderPos: Vec3;
  /** Elbow position in normalized/world coordinates */
  elbowPos: Vec3;
  /** Wrist position in normalized/world coordinates */
  wristPos: Vec3;
  /** Normalized wrist height relative to body dimensions */
  normalizedWristHeight: number;
  /** Elbow extension angle in degrees */
  elbowExtensionAngle: number;
  /** Palm orientation angle in degrees from vertical */
  palmOrientationAngle: number;
  /** Measured shoulder-to-wrist distance */
  armLength: number;
}

/** Complete baseline captured during the calibration stage. */
export interface Baseline {
  /** Left arm baseline measurements */
  leftArm: ArmBaseline;
  /** Right arm baseline measurements */
  rightArm: ArmBaseline;
  /** Torso angle at baseline in degrees */
  torsoAngle: number;
  /** Measured shoulder width */
  shoulderWidth: number;
  /** Number of valid frames used for calibration */
  captureFrameCount: number;
  /** Timestamp when calibration capture started */
  captureStartTime: number;
  /** Timestamp when calibration capture ended */
  captureEndTime: number;
}

// ─── Quality Assessment ──────────────────────────────────────────────────────

/** Detailed quality metrics for an assessment session. */
export interface QualityMetrics {
  /** Percentage of frames considered valid for analysis */
  validFramePercentage: number;
  /** Average pose landmark confidence across valid frames */
  avgPoseConfidence: number;
  /** Average left hand landmark confidence */
  avgLeftHandConfidence: number;
  /** Average right hand landmark confidence */
  avgRightHandConfidence: number;
  /** Camera stability score, 0.0–1.0 */
  cameraStability: number;
  /** Fraction of frames with subject detected */
  subjectVisibilityRate: number;
  /** Fraction of frames with adequate brightness */
  lightingAdequacyRate: number;
  /** Whether excessive torso movement was detected */
  excessiveTorsoMovement: boolean;
  /** Whether both hands remained visible throughout */
  handsRemainedVisible: boolean;
  /** Whether the starting pose was valid */
  startingPoseValid: boolean;
  /** Whether the full 30-second duration was completed */
  fullDurationCompleted: boolean;
}

/** Quality rating for an assessment. */
export type QualityRating = 'good' | 'acceptable' | 'low' | 'unable_to_assess';

/** Overall quality assessment including rating, metrics, and failure reasons. */
export interface QualityAssessment {
  /** Overall quality rating */
  overall: QualityRating;
  /** Detailed quality metrics */
  metrics: QualityMetrics;
  /** Primary reason for quality failure (null if quality is good/acceptable) */
  primaryFailureReason: string | null;
  /** All contributing reasons for reduced quality */
  reasons: string[];
}

// ─── Position Validation ─────────────────────────────────────────────────────

/** Types of position checks performed during starting-position validation. */
export type PositionCheckType =
  | 'subject_detected'
  | 'torso_forward'
  | 'shoulders_visible'
  | 'arm_height'
  | 'elbow_extension'
  | 'arms_not_resting'
  | 'hands_visible'
  | 'palm_orientation';

/** Individual position check result. */
export interface PositionCheck {
  /** Type of check performed */
  type: PositionCheckType;
  /** Whether this check passed */
  passed: boolean;
  /** Measured value (optional, for debugging/display) */
  value?: number;
  /** Required threshold (optional, for debugging/display) */
  threshold?: number;
  /** User-facing correction message */
  message: string;
}

/** Complete position validation result. */
export interface PositionValidationResult {
  /** Whether all position checks pass */
  isValid: boolean;
  /** Individual check results */
  checks: PositionCheck[];
  /** The highest-priority failing check type (null if all pass) */
  highestPriorityFail: PositionCheckType | null;
  /** Hold progress from 0.0 to 1.0 */
  holdProgress: number;
}

// ─── Classification ──────────────────────────────────────────────────────────

/** Overall drift classification result. Exactly one is produced per assessment. */
export type OverallClassification =
  | 'no_significant_drift'
  | 'possible_left_pronator_drift'
  | 'possible_right_pronator_drift'
  | 'possible_bilateral_drift'
  | 'drift_without_clear_pronation'
  | 'possible_pronation_without_drift'
  | 'unable_to_assess';

// ─── Assessment Results ──────────────────────────────────────────────────────

/** Per-arm assessment results summarizing drift and pronation findings. */
export interface ArmAssessment {
  /** Normalized baseline wrist height, 0.0–1.0 */
  baselineWristHeight: number;
  /** Maximum downward drift normalized to arm length, 0.0–1.0 */
  maximumDownwardDriftNormalised: number;
  /** Total duration of detected drift in milliseconds */
  driftDurationMilliseconds: number;
  /** Time in seconds when drift first exceeded threshold (null if no drift) */
  driftOnsetSeconds: number | null;
  /** Maximum change in elbow flexion angle in degrees */
  maximumElbowFlexionChangeDegrees: number;
  /** Estimated palm rotation change in degrees (null if not measurable) */
  estimatedPalmRotationChangeDegrees: number | null;
  /** Whether possible pronation was detected */
  possiblePronation: boolean;
  /** Whether sustained downward drift was detected */
  sustainedDownwardDrift: boolean;
  /** Overall confidence in this arm's assessment, 0.0–1.0 */
  confidence: number;
}

/** Complete pronator drift assessment result. */
export interface PronatorDriftAssessment {
  /** Unique assessment identifier (random UUID) */
  assessmentId: string;
  /** ISO 8601 timestamp when assessment started */
  startedAt: string;
  /** ISO 8601 timestamp when assessment completed */
  completedAt: string;
  /** Duration of the assessment in seconds */
  durationSeconds: number;
  /** Device type determined at runtime */
  deviceType: 'mobile' | 'tablet' | 'desktop';
  /** Orientation (always portrait for this application) */
  orientation: 'portrait';
  /** Versions of the CV models used */
  modelVersions: {
    poseModel: string;
    handModel: string;
    classifier?: string;
  };
  /** Quality assessment for this session */
  quality: QualityAssessment;
  /** Left arm assessment results */
  leftArm: ArmAssessment;
  /** Right arm assessment results */
  rightArm: ArmAssessment;
  /** Overall classification of the assessment */
  overallClassification: OverallClassification;
}

// ─── State Machine ───────────────────────────────────────────────────────────

/** Application state – discriminated union representing all possible screens. */
export type AppState =
  | { screen: 'welcome' }
  | { screen: 'howItWorks' }
  | { screen: 'safetyConfirmation'; confirmed: Set<string> }
  | { screen: 'cameraSetup'; cameraStatus: 'requesting' | 'denied' | 'active' }
  | { screen: 'instruction' }
  | { screen: 'positionValidation'; validation: PositionValidationResult }
  | { screen: 'calibration'; progress: number }
  | { screen: 'assessmentStart'; speechPhase: 'position' | 'eyes_closed' }
  | { screen: 'assessment'; elapsed: number; timeRemaining: number }
  | { screen: 'completion'; speechPlaying: boolean }
  | { screen: 'failure'; reason: string }
  | { screen: 'results'; assessment: PronatorDriftAssessment };

/** Application events – discriminated union representing all possible transitions. */
export type AppEvent =
  | { type: 'START_ASSESSMENT' }
  | { type: 'SHOW_HOW_IT_WORKS' }
  | { type: 'BACK_TO_WELCOME' }
  | { type: 'SAFETY_CONFIRMED' }
  | { type: 'EXIT_ASSESSMENT' }
  | { type: 'CAMERA_READY' }
  | { type: 'ALL_CHECKS_PASS' }
  | { type: 'CONTINUE_TO_POSITION' }
  | { type: 'REPLAY_INSTRUCTIONS' }
  | { type: 'POSITION_VALID' }
  | { type: 'POSITION_TIMEOUT' }
  | { type: 'CALIBRATION_COMPLETE'; baseline: Baseline }
  | { type: 'CALIBRATION_FAILED'; reason: string }
  | { type: 'SPEECH_COMPLETE'; phase: string }
  | { type: 'ASSESSMENT_TICK'; elapsed: number }
  | { type: 'ASSESSMENT_COMPLETE' }
  | { type: 'TRACKING_LOST'; reason: string }
  | { type: 'CAMERA_LOST' }
  | { type: 'TAB_HIDDEN' }
  | { type: 'ORIENTATION_CHANGED' }
  | { type: 'USER_STOP' }
  | { type: 'SHOW_RESULTS'; assessment: PronatorDriftAssessment }
  | { type: 'REPEAT_ASSESSMENT' }
  | { type: 'RETURN_HOME' };
