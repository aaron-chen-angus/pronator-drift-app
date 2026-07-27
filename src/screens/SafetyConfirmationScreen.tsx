import { useState, useCallback } from 'react';
import type { AppEvent } from '../types/index';
import './SafetyConfirmationScreen.css';

/**
 * Safety confirmation items the user must acknowledge before proceeding.
 * Each item has an id (used for state tracking) and display label.
 */
const SAFETY_ITEMS = [
  { id: 'safe-sit-stand', label: 'I can safely sit or stand for the duration of the test' },
  { id: 'clear-space', label: 'I have clear space around me' },
  { id: 'device-stable', label: 'My device is securely placed on a stable surface' },
  { id: 'no-arm-pain', label: 'I am not experiencing pain when raising my arms' },
  { id: 'stop-if-unwell', label: 'I understand to stop if feeling unwell, dizzy, unstable, or uncomfortable' },
] as const;

interface SafetyConfirmationScreenProps {
  dispatch: React.Dispatch<AppEvent>;
}

/**
 * Safety Confirmation Screen
 *
 * Displays safety checkboxes that must all be confirmed before the user
 * can proceed. Includes a seated recommendation, an urgent symptom warning,
 * and exit/proceed buttons.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */
export function SafetyConfirmationScreen({ dispatch }: SafetyConfirmationScreenProps) {
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());

  const allConfirmed = confirmed.size === SAFETY_ITEMS.length;

  const handleCheckboxChange = useCallback((id: string, checked: boolean) => {
    setConfirmed(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const handleReady = useCallback(() => {
    if (allConfirmed) {
      dispatch({ type: 'SAFETY_CONFIRMED' });
    }
  }, [allConfirmed, dispatch]);

  const handleExit = useCallback(() => {
    dispatch({ type: 'EXIT_ASSESSMENT' });
  }, [dispatch]);

  return (
    <div className="safety-screen" role="region" aria-label="Safety Confirmation">
      <h2 className="safety-screen__title">Safety Confirmation</h2>

      <p className="safety-screen__description">
        Please confirm the following before proceeding with the assessment.
      </p>

      {/* Urgent symptom warning - visually distinct, no dismiss, persistently visible */}
      <div
        className="safety-screen__urgent-warning"
        role="alert"
        aria-live="assertive"
      >
        <span className="safety-screen__urgent-warning-icon" aria-hidden="true">⚠</span>
        <div className="safety-screen__urgent-warning-content">
          <strong className="safety-screen__urgent-warning-heading">STOP immediately and seek emergency medical attention if you experience:</strong>
          <ul className="safety-screen__urgent-warning-list">
            <li>Sudden weakness or numbness on one side</li>
            <li>Difficulty speaking or understanding speech</li>
            <li>Sudden severe headache</li>
            <li>Sudden vision problems</li>
            <li>Loss of balance or coordination</li>
          </ul>
        </div>
      </div>

      {/* Safety checkboxes */}
      <fieldset className="safety-screen__checklist">
        <legend className="safety-screen__checklist-legend">Safety Checklist</legend>
        {SAFETY_ITEMS.map(item => (
          <label key={item.id} className="safety-screen__checkbox-label">
            <input
              type="checkbox"
              className="safety-screen__checkbox"
              checked={confirmed.has(item.id)}
              onChange={e => handleCheckboxChange(item.id, e.target.checked)}
              aria-describedby={`${item.id}-desc`}
            />
            <span className="safety-screen__checkbox-custom" aria-hidden="true" />
            <span id={`${item.id}-desc`} className="safety-screen__checkbox-text">
              {item.label}
            </span>
          </label>
        ))}
      </fieldset>

      {/* Seated recommendation */}
      <p className="safety-screen__seated-recommendation">
        We recommend performing this test while seated if you are uncertain about your balance.
      </p>

      {/* Action buttons */}
      <div className="safety-screen__actions">
        <button
          className="safety-screen__btn safety-screen__btn--ready"
          onClick={handleReady}
          disabled={!allConfirmed}
          aria-disabled={!allConfirmed}
        >
          I am ready
        </button>
        <button
          className="safety-screen__btn safety-screen__btn--exit"
          onClick={handleExit}
        >
          Exit Assessment
        </button>
      </div>
    </div>
  );
}
