import { useState, useEffect, useCallback } from 'react';
import type { AppEvent } from '../types/index';
import type { ISpeechSystem } from '../audio/SpeechSystem';
import { FAILURE_SPEECH_MESSAGE, USER_STOP_REASON } from '../state/FailureHandler';
import './FailureScreen.css';

interface FailureScreenProps {
  dispatch: React.Dispatch<AppEvent>;
  speechSystem: ISpeechSystem;
  reason: string;
}

/**
 * FailureScreen - Displayed when the assessment is terminated due to a failure condition.
 *
 * Behavior:
 * 1. On mount, if the failure wasn't user-initiated, speaks the failure message via SpeechSystem
 * 2. Shows a loading state while speech is playing ("Please wait...")
 * 3. After speech completes, shows the failure reason and action buttons
 * 4. For user-initiated stop: immediately shows reason and buttons (no speech)
 * 5. Has "Repeat Assessment" (dispatches REPEAT_ASSESSMENT) and "Return Home" (dispatches RETURN_HOME)
 *
 * Requirements: 15.5, 15.6, 15.7
 */
export function FailureScreen({ dispatch, speechSystem, reason }: FailureScreenProps) {
  const isUserStop = reason === USER_STOP_REASON;
  const [speechComplete, setSpeechComplete] = useState(isUserStop);

  const speakFailure = useCallback(async () => {
    if (isUserStop) return;

    try {
      await speechSystem.speak(FAILURE_SPEECH_MESSAGE);
    } catch {
      // If speech fails, show the visual UI anyway after a brief delay
    } finally {
      setSpeechComplete(true);
    }
  }, [isUserStop, speechSystem]);

  useEffect(() => {
    if (!isUserStop) {
      speakFailure();
    }

    return () => {
      // Cancel any ongoing speech when unmounting
      speechSystem.cancel();
    };
  }, [isUserStop, speakFailure, speechSystem]);

  // While speech is playing, show a loading/waiting state
  if (!speechComplete) {
    return (
      <div className="failure-screen" role="status" aria-live="polite">
        <div className="failure-screen__waiting">
          <div className="failure-screen__spinner" aria-hidden="true" />
          <p className="failure-screen__waiting-text">Please wait...</p>
          <p className="failure-screen__caption" aria-live="polite">
            {FAILURE_SPEECH_MESSAGE}
          </p>
        </div>
      </div>
    );
  }

  // After speech completes (or immediately for user stop), show full UI
  return (
    <div className="failure-screen" role="alert" aria-live="assertive">
      <header className="failure-screen__header">
        <h2 className="failure-screen__title">Assessment Interrupted</h2>
      </header>

      <div className="failure-screen__content">
        <p className="failure-screen__reason">{reason}</p>
        {!isUserStop && (
          <p className="failure-screen__instruction">
            You may open your eyes and relax.
          </p>
        )}
      </div>

      <div className="failure-screen__actions">
        <button
          className="failure-screen__btn failure-screen__btn--primary"
          onClick={() => dispatch({ type: 'REPEAT_ASSESSMENT' })}
          type="button"
        >
          Repeat Assessment
        </button>
        <button
          className="failure-screen__btn failure-screen__btn--secondary"
          onClick={() => dispatch({ type: 'RETURN_HOME' })}
          type="button"
        >
          Return Home
        </button>
      </div>
    </div>
  );
}
