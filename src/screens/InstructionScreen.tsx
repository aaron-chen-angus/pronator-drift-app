import { useState, useEffect, useCallback, useRef } from 'react';
import type { AppEvent } from '../types/index';
import { SpeechSystem } from '../audio/SpeechSystem';
import './InstructionScreen.css';

/**
 * The instruction text spoken and displayed to the user.
 * Describes the correct test position for the pronator drift screening.
 */
export const INSTRUCTION_TEXT =
  'Please extend both arms straight forward at shoulder height with your palms facing upward. ' +
  'Keep your elbows straight and your fingers together. You should be looking straight ahead. ' +
  'When instructed, you will close your eyes and hold this position for 30 seconds.';

interface InstructionScreenProps {
  dispatch: React.Dispatch<AppEvent>;
  speechSystem?: SpeechSystem;
}

/**
 * Instruction and Demonstration Screen
 *
 * Displays a visual demonstration of the correct test position,
 * provides written instructions, triggers spoken instructions via SpeechSystem,
 * shows synchronized captions, and offers "Replay Instructions" and "Continue" controls.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */
export function InstructionScreen({ dispatch, speechSystem }: InstructionScreenProps) {
  const [caption, setCaption] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const speechRef = useRef<SpeechSystem | null>(speechSystem ?? null);
  const mountedRef = useRef(true);

  // Keep speechRef in sync if prop changes
  useEffect(() => {
    speechRef.current = speechSystem ?? null;
  }, [speechSystem]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Triggers spoken instructions and manages caption synchronization.
   */
  const speakInstructions = useCallback(async () => {
    const speech = speechRef.current;
    if (!speech) {
      // No speech system — show caption as fallback
      setCaption(INSTRUCTION_TEXT);
      return;
    }

    setIsSpeaking(true);

    // Register caption listener
    const captionHandler = (text: string | null) => {
      if (mountedRef.current) {
        setCaption(text);
      }
    };
    speech.onCaptionChange(captionHandler);

    try {
      await speech.speak(INSTRUCTION_TEXT, {
        rate: 145, // Within 130-160 WPM range, neutral pace
      });
    } catch {
      // Speech failed — show text caption as fallback
      if (mountedRef.current) {
        setCaption(INSTRUCTION_TEXT);
      }
    } finally {
      if (mountedRef.current) {
        setIsSpeaking(false);
      }
    }
  }, []);

  // Auto-play instructions on mount
  useEffect(() => {
    speakInstructions();
  }, [speakInstructions]);

  const handleReplay = useCallback(() => {
    const speech = speechRef.current;
    if (speech) {
      speech.cancel();
    }
    setCaption(null);
    speakInstructions();
    dispatch({ type: 'REPLAY_INSTRUCTIONS' });
  }, [speakInstructions, dispatch]);

  const handleContinue = useCallback(() => {
    const speech = speechRef.current;
    if (speech) {
      speech.cancel();
    }
    dispatch({ type: 'CONTINUE_TO_POSITION' });
  }, [dispatch]);

  return (
    <div className="instruction-screen" role="region" aria-label="Instructions and Demonstration">
      <h2 className="instruction-screen__title">Position Instructions</h2>

      {/* Visual demonstration / illustration */}
      <div className="instruction-screen__demonstration" aria-label="Demonstration of correct test position">
        <svg
          className="instruction-screen__figure"
          viewBox="0 0 200 200"
          aria-hidden="true"
          role="img"
        >
          {/* Head */}
          <circle cx="100" cy="45" r="16" className="instruction-screen__figure-head" />
          {/* Torso */}
          <line x1="100" y1="61" x2="100" y2="130" className="instruction-screen__figure-body" />
          {/* Left arm extended forward (shoulder height) */}
          <line x1="80" y1="80" x2="30" y2="78" className="instruction-screen__figure-arm" />
          {/* Right arm extended forward (shoulder height) */}
          <line x1="120" y1="80" x2="170" y2="78" className="instruction-screen__figure-arm" />
          {/* Left hand (palm up indicator) */}
          <ellipse cx="26" cy="78" rx="6" ry="4" className="instruction-screen__figure-palm" />
          {/* Right hand (palm up indicator) */}
          <ellipse cx="174" cy="78" rx="6" ry="4" className="instruction-screen__figure-palm" />
          {/* Shoulders */}
          <line x1="80" y1="80" x2="120" y2="80" className="instruction-screen__figure-body" />
          {/* Legs */}
          <line x1="100" y1="130" x2="85" y2="180" className="instruction-screen__figure-body" />
          <line x1="100" y1="130" x2="115" y2="180" className="instruction-screen__figure-body" />
          {/* Palm-up direction arrows */}
          <text x="26" y="68" className="instruction-screen__figure-label" textAnchor="middle">↑</text>
          <text x="174" y="68" className="instruction-screen__figure-label" textAnchor="middle">↑</text>
        </svg>
        <p className="instruction-screen__figure-caption">
          Arms extended forward at shoulder height, palms facing up
        </p>
      </div>

      {/* Written instructions */}
      <div className="instruction-screen__written-instructions">
        <p className="instruction-screen__text">{INSTRUCTION_TEXT}</p>
      </div>

      {/* Synchronized captions for spoken content */}
      {caption && (
        <div
          className="instruction-screen__caption"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <p className="instruction-screen__caption-text">{caption}</p>
        </div>
      )}

      {/* Controls */}
      <div className="instruction-screen__actions">
        <button
          className="instruction-screen__btn instruction-screen__btn--replay"
          onClick={handleReplay}
          type="button"
          aria-label="Replay Instructions"
        >
          Replay Instructions
        </button>
        <button
          className="instruction-screen__btn instruction-screen__btn--continue"
          onClick={handleContinue}
          type="button"
          disabled={isSpeaking}
          aria-disabled={isSpeaking}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
