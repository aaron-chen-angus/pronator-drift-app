import { useMemo, useEffect, useRef } from 'react';
import { useAssessmentStateMachine } from './state/AssessmentStateMachine';
import type { AppState } from './types/index';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { SafetyConfirmationScreen } from './screens/SafetyConfirmationScreen';
import { CameraSetupScreen } from './screens/CameraSetupScreen';
import { InstructionScreen } from './screens/InstructionScreen';
import { PositionValidationScreen } from './screens/PositionValidationScreen';
import { AssessmentScreen } from './screens/AssessmentScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { CompletionScreen } from './screens/CompletionScreen';
import { FailureScreen } from './screens/FailureScreen';
import { createSpeechSystem } from './audio/SpeechSystem';
import { BrowserCompatibilityGate } from './components/BrowserCompatibilityGate';
import './App.css';

/**
 * Returns a human-readable screen label for a given app state.
 */
function getScreenLabel(state: AppState): string {
  switch (state.screen) {
    case 'welcome':
      return 'Welcome Screen';
    case 'howItWorks':
      return 'How It Works';
    case 'safetyConfirmation':
      return 'Safety Confirmation Screen';
    case 'cameraSetup':
      return 'Camera Setup Screen';
    case 'instruction':
      return 'Instruction Screen';
    case 'positionValidation':
      return 'Position Validation Screen';
    case 'calibration':
      return 'Calibration Screen';
    case 'assessmentStart':
      return 'Assessment Starting';
    case 'assessment':
      return 'Assessment Screen';
    case 'completion':
      return 'Completion Screen';
    case 'failure':
      return 'Failure Screen';
    case 'results':
      return 'Results Screen';
    default:
      return 'Unknown Screen';
  }
}

/**
 * Returns a brief description for the current screen state.
 */
function getScreenDescription(state: AppState): string {
  switch (state.screen) {
    case 'welcome':
      return 'Begin your pronator drift screening assessment';
    case 'howItWorks':
      return 'Learn how the assessment works';
    case 'safetyConfirmation':
      return 'Please confirm safety requirements before proceeding';
    case 'cameraSetup':
      return 'Setting up your camera for the assessment';
    case 'instruction':
      return 'Follow the instructions to position yourself correctly';
    case 'positionValidation':
      return 'Validating your position...';
    case 'calibration':
      return 'Calibrating baseline measurements...';
    case 'assessmentStart':
      return 'Preparing to begin the 30-second assessment';
    case 'assessment':
      return `Assessment in progress — ${state.timeRemaining}s remaining`;
    case 'completion':
      return 'Assessment complete — processing results';
    case 'failure':
      return `Assessment interrupted: ${state.reason}`;
    case 'results':
      return 'View your assessment results';
    default:
      return '';
  }
}

function App() {
  const [state, dispatch] = useAssessmentStateMachine();
  const speechSystem = useMemo(() => {
    try {
      return createSpeechSystem();
    } catch {
      return null;
    }
  }, []);
  const previousScreenRef = useRef<string>(state.screen);
  const mainContentRef = useRef<HTMLElement>(null);

  const label = getScreenLabel(state);
  const description = getScreenDescription(state);

  // Focus management: move focus to main content heading on screen transitions
  useEffect(() => {
    if (previousScreenRef.current !== state.screen) {
      previousScreenRef.current = state.screen;

      // Allow DOM to update, then focus the first heading in the new screen
      requestAnimationFrame(() => {
        const mainEl = mainContentRef.current;
        if (!mainEl) return;

        // Try to focus the first heading in the new screen content
        const heading = mainEl.querySelector<HTMLElement>('h1, h2, [data-screen-heading]');
        if (heading) {
          // Make the heading focusable if it isn't already
          if (!heading.getAttribute('tabindex')) {
            heading.setAttribute('tabindex', '-1');
          }
          heading.classList.add('screen-heading');
          heading.focus();
        }
      });
    }
  }, [state.screen]);

  function renderScreen(currentState: AppState) {
    switch (currentState.screen) {
      case 'welcome':
        return <WelcomeScreen dispatch={dispatch} />;
      case 'safetyConfirmation':
        return <SafetyConfirmationScreen dispatch={dispatch} />;
      case 'cameraSetup':
        return <CameraSetupScreen dispatch={dispatch} />;
      case 'instruction':
        return <InstructionScreen dispatch={dispatch} speechSystem={speechSystem} />;
      case 'positionValidation':
        return <PositionValidationScreen dispatch={dispatch} />;
      case 'assessment':
        return <AssessmentScreen dispatch={dispatch} speechSystem={speechSystem} />;
      case 'completion':
        return <CompletionScreen dispatch={dispatch} speechSystem={speechSystem} />;
      case 'failure':
        return <FailureScreen dispatch={dispatch} speechSystem={speechSystem} reason={currentState.reason} />;
      case 'results':
        return <ResultsScreen dispatch={dispatch} assessment={currentState.assessment} />;
      default:
        return (
          <div className="app__screen-placeholder" role="status">
            <h2>{label}</h2>
            <p>{description}</p>
          </div>
        );
    }
  }

  return (
    <BrowserCompatibilityGate>
    <div className="app">
      {/* Skip to content link for keyboard users */}
      <a href="#main-content" className="skip-to-content">
        Skip to main content
      </a>

      {/* Screen transition announcement for screen readers */}
      <div className="sr-only" aria-live="assertive" aria-atomic="true" role="status">
        {label}: {description}
      </div>

      <div className="app__portrait-container">
        <main
          id="main-content"
          ref={mainContentRef}
          className="app__screen"
          aria-label={label}
        >
          {renderScreen(state)}
        </main>
      </div>
      {import.meta.env.DEV && (
        <div className="app__state-indicator" aria-hidden="true">
          state: {state.screen}
        </div>
      )}
    </div>
    </BrowserCompatibilityGate>
  );
}

export default App;
