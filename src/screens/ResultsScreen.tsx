import { useState } from 'react';
import type {
  AppEvent,
  PronatorDriftAssessment,
  OverallClassification,
  QualityRating,
  IndicatorKey,
  IndicatorSample,
  TimeSeriesIndicator,
  MicroMovementIndicators,
  NormComparison,
} from '../types/index';

/**
 * Builds a display-only wrist-drift TimeSeriesIndicator from a per-arm sample
 * series. The analyzer's `wristDrift` is an empty placeholder (its data lives in
 * the DriftAnalyzer), so we synthesize a plottable indicator from the series the
 * session captured for each arm.
 */
function wristDriftIndicatorFromSeries(
  samples: IndicatorSample[]
): TimeSeriesIndicator {
  const values = samples.map((s) => s.value);
  const n = values.length;
  const mean = n > 0 ? values.reduce((s, v) => s + v, 0) / n : null;
  const max = n > 0 ? Math.max(...values) : null;
  let sd: number | null = null;
  if (n >= 2 && mean !== null) {
    const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
    sd = Math.sqrt(variance);
  }
  return {
    key: 'wristDrift',
    measurable: n > 0,
    poseOnly: true,
    samples,
    summary: { mean, max, standardDeviation: sd, validFrameCount: n },
    unit: 'normalized',
  };
}
import { deleteAllAssessmentData } from '../privacy/PrivacyManager';
import type { RecordingResult } from '../analysis/RecordingManager';
import './ResultsScreen.css';

/** Non-diagnostic, human-readable label for each derived indicator. */
const INDICATOR_LABELS: Record<IndicatorKey, string> = {
  wristDrift: 'Wrist drift',
  elbowDrift: 'Elbow drift',
  elbowFlexionChange: 'Elbow flexion angle change',
  armToTorsoChange: 'Arm-to-torso angle change',
  palmRotationChange: 'Palm rotation change',
  wristTremorAmplitude: 'Wrist oscillation amplitude',
  fingertipTremorAmplitude: 'Fingertip oscillation amplitude',
  wristTremorDominantFrequency: 'Wrist oscillation dominant frequency',
  stability: 'Stability',
  fingerCurlChange: 'Finger curl change',
  fingerSpreadChange: 'Finger spread change',
};

/** Ordered list of indicator keys for consistent presentation. */
const INDICATOR_ORDER: IndicatorKey[] = [
  'wristDrift',
  'elbowDrift',
  'elbowFlexionChange',
  'armToTorsoChange',
  'palmRotationChange',
  'wristTremorAmplitude',
  'fingertipTremorAmplitude',
  'wristTremorDominantFrequency',
  'stability',
  'fingerCurlChange',
  'fingerSpreadChange',
];

/** Formats a numeric indicator value with its unit for display. */
function formatIndicatorValue(value: number | null, unit: string): string {
  if (value === null || Number.isNaN(value)) {
    return 'Not available';
  }
  const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
  return unit ? `${rounded} ${unit}` : rounded;
}

/** Formats the variability (standard deviation) summary statistic. */
function formatVariability(indicator: TimeSeriesIndicator): string {
  const sd = indicator.summary.standardDeviation;
  if (sd === null || Number.isNaN(sd)) {
    return 'Variability not available';
  }
  const rounded = Math.abs(sd) >= 100 ? sd.toFixed(0) : sd.toFixed(2);
  return `Variability (standard deviation): ${rounded}${indicator.unit ? ` ${indicator.unit}` : ''}`;
}

/** Maps a norm-comparison outcome to non-diagnostic display text. */
function getNormOutcomeText(comparison: NormComparison): string {
  switch (comparison.outcome) {
    case 'within':
      return 'Within typical range';
    case 'outside':
      return 'Outside typical range';
    case 'no_reference':
      return 'No established reference range';
    case 'not_measured':
      return 'Not measured';
  }
}

/** Returns the ordered indicators that are measurable for presentation. */
function getMeasurableIndicators(
  indicators: MicroMovementIndicators
): TimeSeriesIndicator[] {
  return INDICATOR_ORDER.map((key) => indicators[key] as TimeSeriesIndicator).filter(
    (ind) => ind && ind.measurable
  );
}

/** Returns the ordered indicators that were not measurable. */
function getNotMeasuredIndicators(
  indicators: MicroMovementIndicators
): TimeSeriesIndicator[] {
  return INDICATOR_ORDER.map((key) => indicators[key] as TimeSeriesIndicator).filter(
    (ind) => ind && !ind.measurable
  );
}

interface TimelinePlotProps {
  indicator: TimeSeriesIndicator;
  label: string;
  durationSeconds: number;
}

/**
 * Renders a simple inline bar plot of an indicator's time series with an
 * accessible text-alternative summary describing the plotted values.
 */
function TimelinePlot({ indicator, label, durationSeconds }: TimelinePlotProps) {
  const samples = indicator.samples;
  const values = samples.map((s) => s.value);
  const maxValue = values.length > 0 ? Math.max(...values, 0) : 0;
  const minValue = values.length > 0 ? Math.min(...values, 0) : 0;
  const range = maxValue - minValue || 1;

  const summaryText =
    samples.length > 0
      ? `Timeline of ${label.toLowerCase()} over the ${durationSeconds}-second window: ` +
        `${samples.length} samples, minimum ${minValue.toFixed(2)}${indicator.unit ? ` ${indicator.unit}` : ''}, ` +
        `maximum ${maxValue.toFixed(2)}${indicator.unit ? ` ${indicator.unit}` : ''}.`
      : `No timeline data available for ${label.toLowerCase()}.`;

  return (
    <div className="results-screen__plot">
      <span className="results-screen__detail-label">{label}</span>
      <div
        className="results-screen__plot-bars"
        role="img"
        aria-label={summaryText}
      >
        {samples.map((sample, idx) => {
          const heightPct = ((sample.value - minValue) / range) * 100;
          return (
            <div
              key={idx}
              className="results-screen__plot-bar"
              style={{ height: `${Math.max(2, heightPct)}%` }}
              aria-hidden="true"
            />
          );
        })}
      </div>
      <p className="results-screen__plot-summary">{summaryText}</p>
    </div>
  );
}

interface IndicatorArmListProps {
  title: string;
  indicators: MicroMovementIndicators;
  /** Real wrist-drift samples for this arm (the indicator's own are empty). */
  wristDriftSamples: IndicatorSample[];
  testIdPrefix: string;
}

/**
 * Renders the full ordered indicator list for a single arm (value + variability),
 * substituting the real wrist-drift series for the empty placeholder.
 */
function IndicatorArmList({
  title,
  indicators,
  wristDriftSamples,
  testIdPrefix,
}: IndicatorArmListProps) {
  const wristDrift = wristDriftIndicatorFromSeries(wristDriftSamples);
  const rows = INDICATOR_ORDER.map((key) =>
    key === 'wristDrift' ? wristDrift : (indicators[key] as TimeSeriesIndicator)
  ).filter(Boolean);

  return (
    <div className="results-screen__arm-indicators" data-testid={`arm-indicators-${testIdPrefix}`}>
      <h3 className="results-screen__arm-indicators-title">{title}</h3>
      <ul className="results-screen__indicator-list">
        {rows.map((indicator) => (
          <li
            key={indicator.key}
            className="results-screen__indicator-item"
            data-testid={`indicator-${testIdPrefix}-${indicator.key}`}
          >
            <span className="results-screen__indicator-label">
              {INDICATOR_LABELS[indicator.key]}
              {indicator.poseOnly && (
                <span className="results-screen__pose-only-badge">{' '}(pose-only)</span>
              )}
            </span>
            <span className="results-screen__indicator-value">
              {indicator.measurable
                ? formatIndicatorValue(indicator.summary.max, indicator.unit)
                : 'Not measured'}
            </span>
            {indicator.measurable && (
              <span className="results-screen__indicator-variability">
                {formatVariability(indicator)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface ResultsScreenProps {
  dispatch: React.Dispatch<AppEvent>;
  assessment: PronatorDriftAssessment;
  /**
   * Optional on-device recording of the assessment. When present with a
   * playable `objectUrl`, the Results screen offers playback and deletion
   * controls. Kept optional so existing usages that pass only `{ dispatch,
   * assessment }` continue to work (Req 12.1, 12.3).
   */
  recording?: RecordingResult | null;
  /**
   * Optional callback invoked when the user requests deletion of the recorded
   * video. The owner (App) releases the on-device resources (Req 11.4).
   */
  onDeleteRecording?: () => void;
}

/**
 * Maps classification to user-facing display text using non-diagnostic language.
 * Uses qualifying terms: "possible", "observed", "detected".
 */
function getClassificationDisplayText(classification: OverallClassification): string {
  switch (classification) {
    case 'no_significant_drift':
      return 'No significant arm drift was observed';
    case 'possible_left_pronator_drift':
      return 'Possible pronator drift was observed in the left arm';
    case 'possible_right_pronator_drift':
      return 'Possible pronator drift was observed in the right arm';
    case 'possible_bilateral_drift':
      return 'Possible bilateral arm drift was observed';
    case 'drift_without_clear_pronation':
      return 'Arm drift was detected without clear pronation';
    case 'possible_pronation_without_drift':
      return 'Possible pronation was detected without significant arm drift';
    case 'unable_to_assess':
      return 'Assessment could not be interpreted reliably';
  }
}

/**
 * Maps quality rating to user-facing display text.
 */
function getQualityDisplayText(rating: QualityRating): string {
  switch (rating) {
    case 'good':
      return 'Good quality';
    case 'acceptable':
      return 'Acceptable quality';
    case 'low':
      return 'Low quality — results may be less reliable. Consider repeating the assessment.';
    case 'unable_to_assess':
      return 'Unable to assess quality';
  }
}

/**
 * Returns the affected side label for side-specific classifications.
 */
function getAffectedSide(classification: OverallClassification): string | null {
  switch (classification) {
    case 'possible_left_pronator_drift':
      return 'Left side';
    case 'possible_right_pronator_drift':
      return 'Right side';
    default:
      return null;
  }
}

/**
 * Returns a CSS class modifier for the quality rating indicator.
 * Uses graded indicators without red/flashing/exclamation.
 */
function getQualityIndicatorClass(rating: QualityRating): string {
  switch (rating) {
    case 'good':
      return 'results-screen__quality--good';
    case 'acceptable':
      return 'results-screen__quality--acceptable';
    case 'low':
      return 'results-screen__quality--low';
    case 'unable_to_assess':
      return 'results-screen__quality--unable';
  }
}

/**
 * Formats a normalized drift value as a percentage string.
 */
function formatDriftPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Formats pronation degrees or returns "Not detected".
 */
function formatPronation(degrees: number | null): string {
  if (degrees === null) {
    return 'Not measured';
  }
  return `${degrees.toFixed(1)}°`;
}

/** Human-readable gender label for the participant summary. */
function formatGender(gender: string): string {
  switch (gender) {
    case 'male':
      return 'Male';
    case 'female':
      return 'Female';
    case 'other':
      return 'Other';
    case 'prefer_not_to_say':
      return 'Prefer not to say';
    default:
      return gender;
  }
}

/** Formats an ISO timestamp for on-screen display (locale-aware, safe). */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/**
 * ResultsScreen – Displays assessment results with non-diagnostic language.
 *
 * Handles:
 * - Overall classification display
 * - Affected side for side-specific results
 * - Quality rating with graded visual indicators
 * - "Unable to assess" state (shows failure reason, hides classification)
 * - "Low" quality (shows classification with warning)
 * - Collapsible "View Movement Details" section
 * - Medical disclaimer
 * - Non-diagnostic language throughout
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 13.3, 13.4, 13.5, 20.1, 20.2, 20.3, 20.4, 20.5
 */
export function ResultsScreen({
  dispatch,
  assessment,
  recording,
  onDeleteRecording,
}: ResultsScreenProps) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [dataDeleted, setDataDeleted] = useState(false);
  const [recordingDeleted, setRecordingDeleted] = useState(false);

  // A recording is playable when it exists, was not skipped, and has a local
  // object URL to feed the <video> element (Req 12.1). Once the user deletes
  // it, we always show the "no recording available" state (Req 12.3).
  const hasPlayableRecording =
    !recordingDeleted &&
    recording != null &&
    recording.status !== 'skipped' &&
    recording.objectUrl != null;

  const { quality, overallClassification, leftArm, rightArm } = assessment;
  const isUnableToAssess = quality.overall === 'unable_to_assess';
  const isLowQuality = quality.overall === 'low';
  const affectedSide = getAffectedSide(overallClassification);

  const indicators = assessment.indicators;
  const leftIndicators = assessment.leftIndicators;
  const rightIndicators = assessment.rightIndicators;
  const wristDriftSeries = assessment.wristDriftSeries;
  const normComparisons = assessment.normComparisons ?? [];
  const usedPoseOnlyPath = indicators?.usedPoseOnlyPath ?? false;
  const frameRateBelowMinimum = assessment.analysisMeta?.frameRateBelowMinimum ?? false;

  // Consult recommendation is shown exactly when at least one indicator is
  // outside its typical range (Req 14.3). Assessments without norm comparisons
  // behave as before (no consult recommendation).
  const anyIndicatorOutsideRange = normComparisons.some(
    (c) => c.outcome === 'outside'
  );

  return (
    <div className="results-screen" role="region" aria-label="Assessment Results">
      <header className="results-screen__header">
        <h1 className="results-screen__title">Screening Observation</h1>
      </header>

      {/* Participant summary — shows the intake details captured at the start. */}
      {assessment.participant && (
        <section
          className="results-screen__participant"
          aria-label="Participant details"
          data-testid="participant-summary"
        >
          <dl className="results-screen__participant-grid">
            <div className="results-screen__participant-item">
              <dt>Name</dt>
              <dd>{assessment.participant.name}</dd>
            </div>
            <div className="results-screen__participant-item">
              <dt>Gender</dt>
              <dd>{formatGender(assessment.participant.gender)}</dd>
            </div>
            <div className="results-screen__participant-item">
              <dt>Age</dt>
              <dd>{assessment.participant.age}</dd>
            </div>
            <div className="results-screen__participant-item">
              <dt>Test date &amp; time</dt>
              <dd>{formatDateTime(assessment.participant.testDateTime)}</dd>
            </div>
          </dl>
        </section>
      )}

      {/* Non-diagnostic framing — always shown (Req 14.1).
          Makes explicit that results are a screening indication, not a diagnosis. */}
      <p
        className="results-screen__screening-statement"
        data-testid="screening-not-diagnosis"
      >
        These results are a screening indication, not a medical diagnosis.
      </p>

      {/* Classification Result / Unable to Assess.
          Announced to screen readers via the existing aria-live pattern. */}
      <section
        className="results-screen__observation"
        aria-label="Observation"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="classification-announcement"
      >
        {isUnableToAssess ? (
          <>
            <p className="results-screen__observation-text results-screen__observation-text--unable">
              Assessment could not be interpreted reliably
            </p>
            {quality.primaryFailureReason && (
              <p className="results-screen__failure-reason">
                {quality.primaryFailureReason}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="results-screen__observation-text">
              {getClassificationDisplayText(overallClassification)}
            </p>
            {affectedSide && (
              <p className="results-screen__affected-side">
                Affected side: {affectedSide}
              </p>
            )}
          </>
        )}
      </section>

      {/* Quality Rating */}
      <section className="results-screen__quality-section" aria-label="Assessment quality">
        <div className={`results-screen__quality ${getQualityIndicatorClass(quality.overall)}`}>
          <span className="results-screen__quality-icon" aria-hidden="true">◆</span>
          <span className="results-screen__quality-text">
            {getQualityDisplayText(quality.overall)}
          </span>
        </div>

        {isLowQuality && !isUnableToAssess && (
          <p className="results-screen__quality-warning">
            Assessment quality was reduced
            {quality.primaryFailureReason && `: ${quality.primaryFailureReason}`}.
            Consider repeating the assessment under improved conditions.
          </p>
        )}
      </section>

      {/* Recorded video playback + deletion (Req 11.3, 12.1, 12.2, 12.3, 19.2).
          When a playable on-device recording exists, offer a native, keyboard-
          operable <video controls> element with an accessible name plus a
          delete control. Otherwise, indicate no recording is available while
          the remaining results are presented normally. */}
      <section
        className="results-screen__recording-section"
        aria-label="Recorded assessment video"
        data-testid="recording-section"
      >
        <h2 className="results-screen__section-heading">Recorded video</h2>
        {hasPlayableRecording ? (
          <>
            {recording?.status === 'incomplete' && (
              <p
                className="results-screen__recording-note"
                data-testid="recording-incomplete-note"
              >
                Recording was incomplete; only partial footage is available.
              </p>
            )}
            {/* Native controls are keyboard-operable and expose a play control
                to assistive technology (Req 12.1, 12.2, 19.2). */}
            <video
              className="results-screen__recording-video"
              data-testid="recording-video"
              src={recording?.objectUrl ?? undefined}
              controls
              playsInline
              aria-label="Recorded assessment video"
            />
            <div className="results-screen__recording-controls">
              <button
                className="results-screen__delete-recording-btn"
                type="button"
                data-testid="delete-recording-btn"
                aria-label="Delete recorded video"
                onClick={() => {
                  onDeleteRecording?.();
                  setRecordingDeleted(true);
                }}
              >
                Delete recorded video
              </button>
            </div>
          </>
        ) : (
          <p
            className="results-screen__no-recording"
            data-testid="no-recording"
          >
            No recording available.
          </p>
        )}
      </section>

      {/* Collapsible Movement Details */}
      {!isUnableToAssess && (
        <section className="results-screen__details-section" aria-label="Movement details">
          <button
            className="results-screen__details-toggle"
            onClick={() => setDetailsExpanded(!detailsExpanded)}
            aria-expanded={detailsExpanded}
            aria-controls="movement-details"
            type="button"
          >
            <span className="results-screen__details-toggle-icon" aria-hidden="true">
              {detailsExpanded ? '▾' : '▸'}
            </span>
            View Movement Details
          </button>

          {detailsExpanded && (
            <div
              id="movement-details"
              className="results-screen__details-content"
            >
              <div className="results-screen__details-grid">
                <div className="results-screen__detail-item">
                  <span className="results-screen__detail-label">Max left arm drift</span>
                  <span className="results-screen__detail-value">
                    {formatDriftPercent(leftArm.maximumDownwardDriftNormalised)}
                  </span>
                </div>
                <div className="results-screen__detail-item">
                  <span className="results-screen__detail-label">Max right arm drift</span>
                  <span className="results-screen__detail-value">
                    {formatDriftPercent(rightArm.maximumDownwardDriftNormalised)}
                  </span>
                </div>
                <div className="results-screen__detail-item">
                  <span className="results-screen__detail-label">Possible left pronation</span>
                  <span className="results-screen__detail-value">
                    {formatPronation(leftArm.estimatedPalmRotationChangeDegrees)}
                  </span>
                </div>
                <div className="results-screen__detail-item">
                  <span className="results-screen__detail-label">Possible right pronation</span>
                  <span className="results-screen__detail-value">
                    {formatPronation(rightArm.estimatedPalmRotationChangeDegrees)}
                  </span>
                </div>
                <div className="results-screen__detail-item">
                  <span className="results-screen__detail-label">Assessment duration</span>
                  <span className="results-screen__detail-value">
                    {assessment.durationSeconds}s
                  </span>
                </div>
              </div>

              {/* Timeline summary */}
              <div className="results-screen__timeline">
                <span className="results-screen__detail-label">Movement timeline</span>
                <div className="results-screen__timeline-bar" aria-label="Movement timeline">
                  {leftArm.driftOnsetSeconds !== null && (
                    <div
                      className="results-screen__timeline-marker results-screen__timeline-marker--left"
                      style={{ left: `${(leftArm.driftOnsetSeconds / assessment.durationSeconds) * 100}%` }}
                      aria-label={`Left arm drift onset at ${leftArm.driftOnsetSeconds.toFixed(1)}s`}
                      title={`Left arm drift onset: ${leftArm.driftOnsetSeconds.toFixed(1)}s`}
                    />
                  )}
                  {rightArm.driftOnsetSeconds !== null && (
                    <div
                      className="results-screen__timeline-marker results-screen__timeline-marker--right"
                      style={{ left: `${(rightArm.driftOnsetSeconds / assessment.durationSeconds) * 100}%` }}
                      aria-label={`Right arm drift onset at ${rightArm.driftOnsetSeconds.toFixed(1)}s`}
                      title={`Right arm drift onset: ${rightArm.driftOnsetSeconds.toFixed(1)}s`}
                    />
                  )}
                </div>
                <div className="results-screen__timeline-labels">
                  <span>0s</span>
                  <span>{assessment.durationSeconds}s</span>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Reduced-reliability note (non-diagnostic) when frame rate is below minimum */}
      {frameRateBelowMinimum && (
        <section
          className="results-screen__reliability-note"
          aria-label="Analysis reliability"
        >
          <p data-testid="reduced-reliability-note">
            The analysis frame rate was lower than recommended, so these observations
            may be less reliable. Consider repeating the assessment under improved
            conditions.
          </p>
        </section>
      )}

      {/* Derived Micro-Movement Indicators */}
      {indicators && !isUnableToAssess && (
        <section
          className="results-screen__indicators-section"
          aria-label="Movement indicators"
        >
          <h2 className="results-screen__section-heading">Movement indicators</h2>

          {usedPoseOnlyPath && (
            <p className="results-screen__pose-only-note" data-testid="pose-only-note">
              Some indicators were computed without hand tracking (pose-only).
            </p>
          )}

          {/* When both arms were analyzed, show LEFT and RIGHT indicator lists
              side by side so they can be compared. Otherwise show the single
              assessed-arm list as before. */}
          {leftIndicators && rightIndicators ? (
            <div className="results-screen__arm-indicators-grid">
              <IndicatorArmList
                title="Left arm"
                indicators={leftIndicators}
                wristDriftSamples={wristDriftSeries?.left ?? []}
                testIdPrefix="left"
              />
              <IndicatorArmList
                title="Right arm"
                indicators={rightIndicators}
                wristDriftSamples={wristDriftSeries?.right ?? []}
                testIdPrefix="right"
              />
            </div>
          ) : (
            <>
              {/* Measurable indicators with value + variability */}
              <ul className="results-screen__indicator-list">
                {getMeasurableIndicators(indicators).map((indicator) => (
                  <li
                    key={indicator.key}
                    className="results-screen__indicator-item"
                    data-testid={`indicator-${indicator.key}`}
                  >
                    <span className="results-screen__indicator-label">
                      {INDICATOR_LABELS[indicator.key]}
                      {indicator.poseOnly && (
                        <span
                          className="results-screen__pose-only-badge"
                          data-testid={`pose-only-${indicator.key}`}
                        >
                          {' '}
                          (pose-only)
                        </span>
                      )}
                    </span>
                    <span className="results-screen__indicator-value">
                      {formatIndicatorValue(indicator.summary.max, indicator.unit)}
                    </span>
                    <span className="results-screen__indicator-variability">
                      {formatVariability(indicator)}
                    </span>
                  </li>
                ))}
              </ul>

              {/* Not-measured indicators */}
              {getNotMeasuredIndicators(indicators).length > 0 && (
                <ul className="results-screen__indicator-list results-screen__indicator-list--not-measured">
                  {getNotMeasuredIndicators(indicators).map((indicator) => (
                    <li
                      key={indicator.key}
                      className="results-screen__indicator-item"
                      data-testid={`indicator-not-measured-${indicator.key}`}
                    >
                      <span className="results-screen__indicator-label">
                        {INDICATOR_LABELS[indicator.key]}
                      </span>
                      <span className="results-screen__indicator-value">Not measured</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* Timeline plots — LEFT and RIGHT shown separately so the two arms
              can be compared directly. Wrist drift comes from the real per-arm
              DriftAnalyzer series; elbow flexion and palm rotation come from the
              per-arm indicators. Falls back to the single assessed-arm series
              when per-arm data is not present. */}
          {leftIndicators && rightIndicators ? (
            <div className="results-screen__plots">
              <h3 className="results-screen__plots-heading">Left arm</h3>
              <TimelinePlot
                indicator={wristDriftIndicatorFromSeries(wristDriftSeries?.left ?? [])}
                label="Left wrist drift"
                durationSeconds={assessment.durationSeconds}
              />
              <TimelinePlot
                indicator={leftIndicators.elbowFlexionChange}
                label="Left elbow flexion angle"
                durationSeconds={assessment.durationSeconds}
              />
              <TimelinePlot
                indicator={leftIndicators.palmRotationChange}
                label="Left palm rotation"
                durationSeconds={assessment.durationSeconds}
              />

              <h3 className="results-screen__plots-heading">Right arm</h3>
              <TimelinePlot
                indicator={wristDriftIndicatorFromSeries(wristDriftSeries?.right ?? [])}
                label="Right wrist drift"
                durationSeconds={assessment.durationSeconds}
              />
              <TimelinePlot
                indicator={rightIndicators.elbowFlexionChange}
                label="Right elbow flexion angle"
                durationSeconds={assessment.durationSeconds}
              />
              <TimelinePlot
                indicator={rightIndicators.palmRotationChange}
                label="Right palm rotation"
                durationSeconds={assessment.durationSeconds}
              />
            </div>
          ) : (
            <div className="results-screen__plots">
              <TimelinePlot
                indicator={
                  wristDriftSeries
                    ? wristDriftIndicatorFromSeries(
                        (assessment.assessedArm === 'right'
                          ? wristDriftSeries.right
                          : wristDriftSeries.left) ?? []
                      )
                    : indicators.wristDrift
                }
                label="Wrist drift"
                durationSeconds={assessment.durationSeconds}
              />
              <TimelinePlot
                indicator={indicators.elbowFlexionChange}
                label="Elbow flexion angle"
                durationSeconds={assessment.durationSeconds}
              />
              <TimelinePlot
                indicator={indicators.palmRotationChange}
                label="Palm rotation"
                durationSeconds={assessment.durationSeconds}
              />
            </div>
          )}
        </section>
      )}

      {/* Norm Comparisons */}
      {indicators && normComparisons.length > 0 && !isUnableToAssess && (
        <section
          className="results-screen__norms-section"
          aria-label="Reference range comparisons"
        >
          <h2 className="results-screen__section-heading">Reference range comparisons</h2>
          <p className="results-screen__norms-prototype-note">
            All reference ranges are prototype values pending clinical validation.
          </p>
          <ul className="results-screen__norm-list">
            {normComparisons.map((comparison) => (
              <li
                key={comparison.indicatorKey}
                className="results-screen__norm-item"
                data-testid={`norm-${comparison.indicatorKey}`}
              >
                <span className="results-screen__norm-label">
                  {INDICATOR_LABELS[comparison.indicatorKey]}
                </span>
                <span className="results-screen__norm-value">
                  {comparison.value !== null
                    ? formatIndicatorValue(
                        comparison.value,
                        comparison.range?.unit ?? ''
                      )
                    : '—'}
                </span>
                <span className="results-screen__norm-outcome">
                  {getNormOutcomeText(comparison)}
                </span>
                <span className="results-screen__norm-prototype-label">
                  Prototype value pending validation
                </span>
                {comparison.citation && (
                  <span className="results-screen__norm-citation">
                    Reference: {comparison.citation}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Consult recommendation (non-diagnostic) — shown exactly when at least
          one indicator is outside its typical range (Req 14.3). Uses
          non-diagnostic language and never names or asserts a medical
          condition (Req 14.2). */}
      {anyIndicatorOutsideRange && (
        <section
          className="results-screen__consult-recommendation"
          aria-label="Recommendation"
        >
          <p data-testid="consult-recommendation">
            One or more observed indicators were outside their typical range.
            Consider consulting a qualified healthcare professional to discuss
            these screening observations.
          </p>
        </section>
      )}

      {/* Action Buttons */}
      <div className="results-screen__actions">
        <button
          className="results-screen__btn results-screen__btn--primary"
          onClick={() => dispatch({ type: 'REPEAT_ASSESSMENT' })}
          type="button"
        >
          Repeat Assessment
        </button>
        <button
          className="results-screen__btn results-screen__btn--secondary"
          onClick={() => dispatch({ type: 'RETURN_HOME' })}
          type="button"
        >
          Return Home
        </button>
      </div>

      {/* Medical Disclaimer */}
      <footer className="results-screen__disclaimer">
        <p>
          This screening does not constitute a medical diagnosis. The observations
          are based on detected movement patterns and should be discussed with a
          qualified healthcare provider for proper clinical evaluation.
        </p>
      </footer>

      {/* Delete Assessment Data — privacy control */}
      <div className="results-screen__privacy-controls">
        {dataDeleted ? (
          <p className="results-screen__data-deleted" data-testid="data-deleted-confirmation">
            All stored assessment data has been deleted.
          </p>
        ) : (
          <button
            className="results-screen__delete-data-btn"
            onClick={() => {
              deleteAllAssessmentData();
              setDataDeleted(true);
            }}
            type="button"
            data-testid="delete-assessment-data-btn"
          >
            Delete Assessment Data
          </button>
        )}
      </div>
    </div>
  );
}
