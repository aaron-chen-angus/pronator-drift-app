import { useState } from 'react';
import type { AppEvent } from '../types/index';
import './WelcomeScreen.css';

interface WelcomeScreenProps {
  dispatch: React.Dispatch<AppEvent>;
}

/**
 * WelcomeScreen – The landing screen of the Pronator Drift application.
 *
 * Displays:
 * - Application name and purpose description
 * - "Start Assessment" and "How It Works" buttons
 * - Medical screening disclaimer
 * - Privacy notice
 * - Expandable "How It Works" panel
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */
export function WelcomeScreen({ dispatch }: WelcomeScreenProps) {
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  return (
    <div className="welcome-screen">
      <header className="welcome-screen__header">
        <h1 className="welcome-screen__title">Pronator Drift Screener</h1>
        <p className="welcome-screen__description">
          A camera-based guided 30-second upper-limb movement screening
        </p>
      </header>

      <div className="welcome-screen__actions">
        <button
          className="welcome-screen__btn welcome-screen__btn--primary"
          onClick={() => dispatch({ type: 'START_ASSESSMENT' })}
          type="button"
        >
          Start Assessment
        </button>
        <button
          className="welcome-screen__btn welcome-screen__btn--secondary"
          onClick={() => setShowHowItWorks(!showHowItWorks)}
          type="button"
          aria-expanded={showHowItWorks}
          aria-controls="how-it-works-panel"
        >
          How It Works
        </button>
      </div>

      {showHowItWorks && (
        <section
          id="how-it-works-panel"
          className="welcome-screen__how-it-works"
          aria-label="How it works"
        >
          <h2 className="welcome-screen__section-title">How It Works</h2>
          <ol className="welcome-screen__steps">
            <li>Confirm safety requirements and position your device on a stable surface</li>
            <li>Grant camera access and follow positioning guides until you are in the correct pose</li>
            <li>Hold both arms straight forward with palms up — the app calibrates your starting position</li>
            <li>Close your eyes when instructed — the 30-second assessment begins</li>
            <li>The app uses computer vision to observe arm movement while spoken cues tell you the remaining time</li>
            <li>Open your eyes when you hear the completion tone — view your screening observation</li>
          </ol>
        </section>
      )}

      <footer className="welcome-screen__footer">
        <p className="welcome-screen__disclaimer">
          This tool is not a medical device or diagnostic tool. It does not
          provide medical advice, diagnosis, or treatment recommendations. The
          results should not be used as a substitute for professional medical
          evaluation. If you have concerns about your health, please consult a
          qualified healthcare provider.
        </p>
        <p className="welcome-screen__privacy">
          All processing happens locally on your device. No video, images, or
          movement data is saved or transmitted to any server.
        </p>
      </footer>
    </div>
  );
}
