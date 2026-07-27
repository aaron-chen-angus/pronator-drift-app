import { useEffect, useRef, useState, useCallback } from 'react';
import type { AppEvent, PronatorDriftAssessment } from '../types/index';
import type { SpeechSystem } from '../audio/SpeechSystem';
import './CompletionScreen.css';

// ─── Constants ───────────────────────────────────────────────────────────────

/** The spoken completion message per Requirement 10.1 */
export const COMPLETION_MESSAGE =
  'The assessment is complete. You may open your eyes, lower your arms, and relax.';

/** Delay after speech completes before showing results (ms). Requirement 10.2 */
export const POST_SPEECH_DELAY_MS = 2000;

/** Fallback delay when speech is unavailable/muted (ms). Requirement 10.4 */
export const NO_SPEECH_FALLBACK_DELAY_MS = 5000;

// ─── Types ───────────────────────────────────────────────────────────────────

interface CompletionScreenProps {
  dispatch: React.Dispatch<AppEvent>;
  speechSystem?: SpeechSystem;
  /** The assessment data to pass with SHOW_RESULTS event */
  assessment?: PronatorDriftAssessment;
}

type CompletionPhase = 'speaking' | 'waiting' | 'fallback';

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * CompletionScreen
 *
 * Handles the assessment completion flow:
 * 1. On mount, speaks the completion message via SpeechSystem
 * 2. Shows "Assessment complete" with a brief waiting indicator while speech plays
 * 3. After speech completes, waits 2 seconds then dispatches SHOW_RESULTS event
 * 4. If no speech system / muted: displays on-screen completion text and waits 5 seconds
 *    then dispatches SHOW_RESULTS
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4
 */
export function CompletionScreen({ dispatch, speechSystem, assessment }: CompletionScreenProps) {
  const [phase, setPhase] = useState<CompletionPhase>('speaking');
  const [caption, setCaption] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const speechRef = useRef<SpeechSystem | undefined>(speechSystem);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs in sync
  useEffect(() => {
    speechRef.current = speechSystem;
  }, [speechSystem]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  /**
   * Dispatches SHOW_RESULTS with the assessment data.
   */
  const showResults = useCallback(() => {
    if (!mountedRef.current) return;
    if (assessment) {
      dispatch({ type: 'SHOW_RESULTS', assessment });
    }
  }, [dispatch, assessment]);

  /**
   * Handles the speech-available path:
   * - Speak completion message
   * - Wait 2 seconds after speech ends
   * - Dispatch SHOW_RESULTS
   */
  const runSpeechFlow = useCallback(async () => {
    const speech = speechRef.current;
    if (!speech || !speech.isAvailable() || speech.isMuted()) {
      // Use fallback flow
      if (mountedRef.current) {
        setPhase('fallback');
        setCaption(COMPLETION_MESSAGE);
        timerRef.current = setTimeout(() => {
          showResults();
        }, NO_SPEECH_FALLBACK_DELAY_MS);
      }
      return;
    }

    // Register caption listener
    const captionHandler = (c: string | null) => {
      if (mountedRef.current) setCaption(c);
    };
    speech.onCaptionChange(captionHandler);

    try {
      // Speak the completion message (Requirement 10.1)
      setPhase('speaking');
      await speech.speak(COMPLETION_MESSAGE, { rate: 145 });

      if (!mountedRef.current) return;

      // Speech completed — wait 2 seconds then show results (Requirement 10.2)
      setPhase('waiting');
      timerRef.current = setTimeout(() => {
        showResults();
      }, POST_SPEECH_DELAY_MS);
    } catch {
      // Speech failed — use fallback path
      if (mountedRef.current) {
        setPhase('fallback');
        setCaption(COMPLETION_MESSAGE);
        timerRef.current = setTimeout(() => {
          showResults();
        }, NO_SPEECH_FALLBACK_DELAY_MS);
      }
    }
  }, [showResults]);

  // Run the completion flow on mount
  useEffect(() => {
    runSpeechFlow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="completion-screen" role="region" aria-label="Assessment Complete">
      <div className="completion-screen__content">
        {/* Completion indicator */}
        <div className="completion-screen__icon" aria-hidden="true">
          <svg
            className="completion-screen__checkmark"
            viewBox="0 0 52 52"
            width="64"
            height="64"
          >
            <circle
              className="completion-screen__checkmark-circle"
              cx="26"
              cy="26"
              r="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              className="completion-screen__checkmark-path"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14 27l7 7 16-16"
            />
          </svg>
        </div>

        {/* Status heading */}
        <h2 className="completion-screen__heading">Assessment complete</h2>

        {/* Phase-specific content */}
        {phase === 'speaking' && (
          <div className="completion-screen__status" aria-live="polite">
            <div className="completion-screen__spinner" aria-hidden="true" />
            <p className="completion-screen__status-text">Playing completion message…</p>
          </div>
        )}

        {phase === 'waiting' && (
          <div className="completion-screen__status" aria-live="polite">
            <div className="completion-screen__spinner" aria-hidden="true" />
            <p className="completion-screen__status-text">Preparing results…</p>
          </div>
        )}

        {phase === 'fallback' && (
          <div className="completion-screen__fallback" role="alert" aria-live="assertive">
            <p className="completion-screen__fallback-text">
              {COMPLETION_MESSAGE}
            </p>
          </div>
        )}

        {/* Caption display */}
        {caption && phase !== 'fallback' && (
          <div
            className="completion-screen__caption"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <p className="completion-screen__caption-text">{caption}</p>
          </div>
        )}
      </div>
    </div>
  );
}
