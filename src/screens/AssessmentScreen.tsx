import { useState, useEffect, useCallback, useRef } from 'react';
import type { AppEvent } from '../types/index';
import type { SpeechSystem } from '../audio/SpeechSystem';
import './AssessmentScreen.css';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Assessment duration in seconds */
const ASSESSMENT_DURATION = 30;

/** Delay between position confirmation speech and eyes-closed instruction (ms) */
const INTER_SPEECH_DELAY_MS = 2500;

/** Spoken texts for the assessment start sequence */
export const SPEECH_POSITION_CONFIRMED =
  'Your position has been confirmed. Please maintain your arms in this position.';

export const SPEECH_EYES_CLOSED =
  'Close your eyes now. Keep your arms extended and still. The assessment will last 30 seconds.';

/**
 * Countdown cue schedule: maps elapsed seconds to the spoken text.
 * Only time-remaining cues are spoken during assessment (no performance/drift speech).
 */
export const COUNTDOWN_CUES: ReadonlyMap<number, string> = new Map([
  [5, '25 remaining'],
  [10, '20 remaining'],
  [15, '15 remaining'],
  [20, '10 remaining'],
  [25, '5'],
  [26, '4'],
  [27, '3'],
  [28, '2'],
  [29, '1'],
]);

// ─── Types ───────────────────────────────────────────────────────────────────

type AssessmentPhase = 'starting' | 'running' | 'error';

interface AssessmentScreenProps {
  dispatch: React.Dispatch<AppEvent>;
  speechSystem?: SpeechSystem;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Assessment Screen
 *
 * Manages the assessment start sequence (speak position confirmation → wait → speak
 * eyes-closed instruction → start 30s timer) and the running countdown with spoken
 * time cues. Displays the remaining time and a visible, accessible stop button.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 15.7, 15.8
 */
export function AssessmentScreen({ dispatch, speechSystem }: AssessmentScreenProps) {
  const [phase, setPhase] = useState<AssessmentPhase>('starting');
  const [timeRemaining, setTimeRemaining] = useState(ASSESSMENT_DURATION);
  const [caption, setCaption] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const speechRef = useRef<SpeechSystem | undefined>(speechSystem);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);
  const spokenCuesRef = useRef<Set<number>>(new Set());

  // Keep speechRef in sync
  useEffect(() => {
    speechRef.current = speechSystem;
  }, [speechSystem]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  /**
   * Speaks a countdown cue. If speech fails, shows it on-screen instead.
   * Requirement 9.7: retry once, then display text.
   */
  const speakCountdownCue = useCallback(async (text: string) => {
    const speech = speechRef.current;
    if (!speech) {
      if (mountedRef.current) setCaption(text);
      return;
    }

    // Register caption listener
    const captionHandler = (c: string | null) => {
      if (mountedRef.current) setCaption(c);
    };
    speech.onCaptionChange(captionHandler);

    try {
      await speech.speak(text, { rate: 150 });
    } catch {
      // Speech system has built-in retry; if it still fails, show text
      if (mountedRef.current) setCaption(text);
    }
  }, []);

  /**
   * Starts the 30-second countdown timer.
   * Dispatches ASSESSMENT_TICK events and triggers spoken countdown cues.
   */
  const startTimer = useCallback(() => {
    if (!mountedRef.current) return;

    setPhase('running');
    elapsedRef.current = 0;
    spokenCuesRef.current = new Set();
    setTimeRemaining(ASSESSMENT_DURATION);

    timerRef.current = setInterval(() => {
      if (!mountedRef.current) return;

      elapsedRef.current += 1;
      const remaining = Math.max(0, ASSESSMENT_DURATION - elapsedRef.current);
      setTimeRemaining(remaining);

      dispatch({ type: 'ASSESSMENT_TICK', elapsed: elapsedRef.current });

      // Trigger countdown cues
      const cueText = COUNTDOWN_CUES.get(elapsedRef.current);
      if (cueText && !spokenCuesRef.current.has(elapsedRef.current)) {
        spokenCuesRef.current.add(elapsedRef.current);
        speakCountdownCue(cueText);
      }

      // Timer complete
      if (elapsedRef.current >= ASSESSMENT_DURATION) {
        if (timerRef.current !== null) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        dispatch({ type: 'ASSESSMENT_COMPLETE' });
      }
    }, 1000);
  }, [dispatch, speakCountdownCue]);

  /**
   * Runs the assessment start sequence:
   * 1. Speak position confirmation
   * 2. Wait 2-3 seconds
   * 3. Speak eyes-closed instruction
   * 4. Start timer
   *
   * If speech fails at any point, don't start the timer and show an error.
   * Requirements: 7.1, 7.2, 7.3, 7.4
   */
  const runStartSequence = useCallback(async () => {
    const speech = speechRef.current;

    if (!speech) {
      // No speech system — show error with retry option
      if (mountedRef.current) {
        setPhase('error');
        setErrorMessage('Audio system is unavailable. Speech is required to start the assessment.');
      }
      return;
    }

    // Register caption listener
    const captionHandler = (c: string | null) => {
      if (mountedRef.current) setCaption(c);
    };
    speech.onCaptionChange(captionHandler);

    try {
      // Step 1: Speak position confirmation
      await speech.speak(SPEECH_POSITION_CONFIRMED, { rate: 145 });

      if (!mountedRef.current) return;

      // Step 2: Wait 2-3 seconds
      await new Promise<void>((resolve) => setTimeout(resolve, INTER_SPEECH_DELAY_MS));

      if (!mountedRef.current) return;

      // Step 3: Speak eyes-closed instruction
      await speech.speak(SPEECH_EYES_CLOSED, { rate: 145 });

      if (!mountedRef.current) return;

      // Step 4: Start timer
      startTimer();
    } catch {
      // Speech failure — don't start timer, show error with retry option
      if (mountedRef.current) {
        setPhase('error');
        setErrorMessage('Audio could not be played. Please check your device audio and try again.');
      }
    }
  }, [startTimer]);

  // Run start sequence on mount
  useEffect(() => {
    runStartSequence();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Handles the stop button press.
   * Dispatches USER_STOP event.
   * Requirements: 15.7, 15.8
   */
  const handleStop = useCallback(() => {
    // Stop timer
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Cancel any ongoing speech
    const speech = speechRef.current;
    if (speech) {
      speech.cancel();
    }

    dispatch({ type: 'USER_STOP' });
  }, [dispatch]);

  /**
   * Handles retry when speech fails during start sequence.
   */
  const handleRetry = useCallback(() => {
    setPhase('starting');
    setErrorMessage(null);
    setCaption(null);
    runStartSequence();
  }, [runStartSequence]);

  // ─── Render ──────────────────────────────────────────────────────────────

  if (phase === 'error') {
    return (
      <div className="assessment-screen assessment-screen--error" role="region" aria-label="Assessment Error">
        <div className="assessment-screen__error-container">
          <div className="assessment-screen__error-icon" aria-hidden="true">⚠</div>
          <p className="assessment-screen__error-message" role="alert">
            {errorMessage}
          </p>
          <button
            className="assessment-screen__btn assessment-screen__btn--retry"
            onClick={handleRetry}
            type="button"
            aria-label="Retry starting the assessment"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="assessment-screen" role="region" aria-label="Assessment in Progress">
      {/* Timer display */}
      <div className="assessment-screen__timer-container">
        <div
          className="assessment-screen__timer"
          role="timer"
          aria-live="polite"
          aria-atomic="true"
          aria-label={`${timeRemaining} seconds remaining`}
        >
          <span className="assessment-screen__timer-value">{timeRemaining}</span>
          <span className="assessment-screen__timer-label">seconds remaining</span>
        </div>
      </div>

      {/* Status text */}
      <div className="assessment-screen__status">
        {phase === 'starting' && (
          <p className="assessment-screen__status-text">Preparing assessment…</p>
        )}
        {phase === 'running' && (
          <p className="assessment-screen__status-text">Assessment in progress — keep your eyes closed</p>
        )}
      </div>

      {/* Caption display */}
      {caption && (
        <div
          className="assessment-screen__caption"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <p className="assessment-screen__caption-text">{caption}</p>
        </div>
      )}

      {/* Stop button — visible and accessible via touch + keyboard */}
      <div className="assessment-screen__actions">
        <button
          className="assessment-screen__btn assessment-screen__btn--stop"
          onClick={handleStop}
          type="button"
          aria-label="Stop assessment"
        >
          Stop Assessment
        </button>
      </div>
    </div>
  );
}
