import { useState } from 'react';
import type { AppEvent, PronatorDriftAssessment, OverallClassification, QualityRating } from '../types/index';
import { deleteAllAssessmentData } from '../privacy/PrivacyManager';
import './ResultsScreen.css';

interface ResultsScreenProps {
  dispatch: React.Dispatch<AppEvent>;
  assessment: PronatorDriftAssessment;
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
export function ResultsScreen({ dispatch, assessment }: ResultsScreenProps) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [dataDeleted, setDataDeleted] = useState(false);

  const { quality, overallClassification, leftArm, rightArm } = assessment;
  const isUnableToAssess = quality.overall === 'unable_to_assess';
  const isLowQuality = quality.overall === 'low';
  const affectedSide = getAffectedSide(overallClassification);

  return (
    <div className="results-screen" role="region" aria-label="Assessment Results">
      <header className="results-screen__header">
        <h1 className="results-screen__title">Screening Observation</h1>
      </header>

      {/* Classification Result / Unable to Assess */}
      <section className="results-screen__observation" aria-label="Observation">
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
