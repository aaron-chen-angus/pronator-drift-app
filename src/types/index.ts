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

// ─── Participant Intake ──────────────────────────────────────────────────────

/** Biological / self-reported sex options collected at intake. */
export type ParticipantGender = 'male' | 'female' | 'other' | 'prefer_not_to_say';

/**
 * Participant-provided intake information collected before the assessment.
 *
 * This is entered on the ParticipantInfoScreen and carried through to the final
 * `PronatorDriftAssessment` so it can be shown on the results screen and
 * (optionally) exported alongside the measured metrics. No PII is transmitted
 * anywhere unless the operator explicitly enables the Google Sheets export.
 */
export interface ParticipantInfo {
  /** Participant full name (free text, as entered). */
  name: string;
  /** Self-reported gender / biological sex. */
  gender: ParticipantGender;
  /** Age in whole years. */
  age: number;
  /**
   * Whether the participant acknowledged the declaration / consent statement.
   * The form cannot be submitted unless this is `true`.
   */
  declarationAccepted: boolean;
  /**
   * ISO 8601 timestamp captured at the moment the intake form was submitted
   * (i.e. when the test session began). This is the "date and time the test was
   * done" requested at intake.
   */
  testDateTime: string;
}

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
  /**
   * Participant-provided intake information (name, gender, age, declaration,
   * and the captured test date/time). Optional so historical/placeholder
   * assessments built without an intake step still type-check.
   */
  participant?: ParticipantInfo;
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
  /** Derived micro-movement indicators for the assessed arm (new, optional). */
  indicators?: MicroMovementIndicators;
  /**
   * Full derived indicators for BOTH arms (front-facing both-arms mode). When
   * present, the Results screen shows left and right side by side. The assessed
   * arm's indicators equal `indicators` above.
   */
  leftIndicators?: MicroMovementIndicators;
  rightIndicators?: MicroMovementIndicators;
  /**
   * Per-arm wrist-drift time series (normalized), sourced from the DriftAnalyzer
   * which tracks both arms every frame. Used for the wrist-drift timeline plot
   * that the placeholder `indicators.wristDrift` cannot provide.
   */
  wristDriftSeries?: {
    left: IndicatorSample[];
    right: IndicatorSample[];
  };
  /** Norm comparisons per indicator (new, optional). */
  normComparisons?: NormComparison[];
  /** Which arm was assessed (new, optional). */
  assessedArm?: 'left' | 'right';
  /** Frame accounting + reliability metadata (new, optional). */
  analysisMeta?: {
    /** Number of CV frames delivered to the analysis pipeline. */
    deliveredFrameCount: number;
    /** Number of CV frames dropped under backpressure. */
    droppedFrameCount: number;
    /** Effective analysis frame rate (valid frames / duration). */
    effectiveFrameRate: number;
    /** Whether the effective frame rate fell below the configured minimum. */
    frameRateBelowMinimum: boolean;
    /** Status of the on-device recording for this assessment. */
    recordingStatus: 'recorded' | 'skipped' | 'incomplete';
  };
}

// ─── Micro-Movement Indicators ───────────────────────────────────────────────

/** Identifier for each derived micro-movement indicator. */
export type IndicatorKey =
  | 'wristDrift'
  | 'elbowDrift'
  | 'elbowFlexionChange'
  | 'armToTorsoChange'
  | 'palmRotationChange'
  | 'wristTremorAmplitude'
  | 'fingertipTremorAmplitude'
  | 'wristTremorDominantFrequency'
  | 'stability'
  | 'fingerCurlChange'
  | 'fingerSpreadChange';

/** Per-indicator summary aggregate over valid frames. */
export interface SummaryStatistic {
  /** Arithmetic mean over valid frames (null if no valid frames). */
  mean: number | null;
  /** Maximum over valid frames (null if no valid frames). */
  max: number | null;
  /** Standard deviation; null when fewer than two valid frames (Req 8.3). */
  standardDeviation: number | null;
  /** Count of valid frames used (Req 8.4). */
  validFrameCount: number;
}

/** A single point in a plottable indicator time series. */
export interface IndicatorSample {
  /** Milliseconds from assessment start. */
  timestamp: number;
  /** Indicator value at this sample. */
  value: number;
}

/** A time-series indicator with its samples and summary. */
export interface TimeSeriesIndicator {
  /** Which indicator this series represents. */
  key: IndicatorKey;
  /** false => not measured (Req 5.6 / 7.4). */
  measurable: boolean;
  /** Computed without hand landmarks (Req 15.5). */
  poseOnly: boolean;
  /** Valid samples only. */
  samples: IndicatorSample[];
  /** Summary statistics over the valid samples. */
  summary: SummaryStatistic;
  /** Unit of the indicator values. */
  unit: string;
}

/** Complete set of derived indicators for the assessed arm. */
export interface MicroMovementIndicators {
  /** Which arm these indicators describe. */
  assessedArm: 'left' | 'right';
  wristDrift: TimeSeriesIndicator;
  elbowDrift: TimeSeriesIndicator;
  elbowFlexionChange: TimeSeriesIndicator;
  armToTorsoChange: TimeSeriesIndicator;
  /** measurable=false when no hand frames. */
  palmRotationChange: TimeSeriesIndicator;
  wristTremorAmplitude: TimeSeriesIndicator;
  fingertipTremorAmplitude: TimeSeriesIndicator;
  /** Single-value series. */
  wristTremorDominantFrequency: TimeSeriesIndicator;
  stability: TimeSeriesIndicator;
  fingerCurlChange: TimeSeriesIndicator;
  fingerSpreadChange: TimeSeriesIndicator;

  /** Aggregate scalar findings. */
  maxElbowFlexionChangeDegrees: number;
  maxArmToTorsoChangeDegrees: number;
  totalPalmRotationChangeDegrees: number | null;
  possiblePronation: boolean;
  supinationToPronationTrend: boolean;
  sustainedDrift: boolean;
  sustainedDriftDurationMs: number;
  dominantFrequencyBandwidthLimited: boolean;
  /** True if any indicator was computed via the pose-only path (Req 15.1 / 15.5). */
  usedPoseOnlyPath: boolean;
}

// ─── Normative Ranges ────────────────────────────────────────────────────────

/** Prototype normative reference range with literature citation. */
export interface NormativeRange {
  /** Lower bound of the typical range. */
  lowerBound: number;
  /** Upper bound of the typical range. */
  upperBound: number;
  /** Unit of the range bounds. */
  unit: string;
  /** Human-readable reference to the source (Req 9.3). */
  citation: string;
  /** Always pending clinical validation (Req 9.5, 16.2). */
  prototype: true;
}

/** Outcome of comparing an indicator value against its normative range. */
export type NormOutcome = 'within' | 'outside' | 'no_reference' | 'not_measured';

/** Comparison of a single indicator value against its normative range. */
export interface NormComparison {
  /** Which indicator this comparison describes. */
  indicatorKey: IndicatorKey;
  /** The indicator value compared (null when not measurable). */
  value: number | null;
  /** Classification outcome. */
  outcome: NormOutcome;
  /** The normative range used, if defined. */
  range: NormativeRange | null;
  /** Citation for the normative range, if any (Req 9.3). */
  citation: string | null;
  /** Always labeled prototype pending validation (Req 9.5). */
  prototype: true;
}

// ─── State Machine ───────────────────────────────────────────────────────────

/** Application state – discriminated union representing all possible screens. */
export type AppState =
  | { screen: 'welcome' }
  | { screen: 'howItWorks' }
  | { screen: 'participantInfo' }
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
  | { type: 'PARTICIPANT_INFO_SUBMITTED'; participant: ParticipantInfo }
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
