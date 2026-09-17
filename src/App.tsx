import { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { useAssessmentStateMachine } from './state/AssessmentStateMachine';
import type { AppState, ParticipantInfo, PronatorDriftAssessment } from './types/index';
import { exportToSheets } from './integrations/sheetsExport';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { ParticipantInfoScreen } from './screens/ParticipantInfoScreen';
import { SafetyConfirmationScreen } from './screens/SafetyConfirmationScreen';
import { CameraSetupScreen } from './screens/CameraSetupScreen';
import { InstructionScreen } from './screens/InstructionScreen';
import { PositionValidationScreen } from './screens/PositionValidationScreen';
import { CalibrationScreen } from './screens/CalibrationScreen';
import { AssessmentScreen } from './screens/AssessmentScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { CompletionScreen } from './screens/CompletionScreen';
import { FailureScreen } from './screens/FailureScreen';
import { buildAssessment } from './analysis/buildAssessment';
import { buildAssessmentFromAnalysis } from './analysis/buildAssessmentFromAnalysis';
import type { RecordingResult } from './analysis/RecordingManager';
import { getConfigStore } from './config/ConfigStore';
import { createSpeechSystem } from './audio/SpeechSystem';
import { BrowserCompatibilityGate } from './components/BrowserCompatibilityGate';
import { AssessmentSessionProvider, useAssessmentSession } from './session/AssessmentSessionContext';
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
    case 'participantInfo':
      return 'Participant Information Screen';
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
    case 'participantInfo':
      return 'Enter your details before starting';
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

function AppInner() {
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
  // Timestamp when the timed assessment began, used to build the result.
  const assessmentStartRef = useRef<number>(Date.now());

  // ─── Analysis + recording wiring (shared AssessmentSession) ────────────────
  //
  // The shared session owns the live camera stream, the CV worker, and the
  // analysis pipeline. The camera-setup, calibration, and assessment screens all
  // operate on this ONE pipeline, so a completed assessment produces a real,
  // populated result (drift/tremor/pronation/etc.) rather than a placeholder.
  const session = useAssessmentSession();
  const config = useMemo(() => getConfigStore(), []);

  // On-device recording consent (Req 11.2). Defaults to false; the user opts in
  // via the consent toggle on the camera setup screen. Consent flows to the
  // session's RecordingManager so recording only ever happens with consent.
  const [recordingConsented, setRecordingConsented] = useState(false);
  useEffect(() => {
    session.setRecordingConsent(recordingConsented);
  }, [session, recordingConsented]);

  // The recording surfaced to the Results screen for playback/deletion.
  const [recording, setRecording] = useState<RecordingResult | null>(null);

  // Participant intake (name, gender, age, declaration, test date/time) captured
  // on the ParticipantInfoScreen. Held in a ref so the completion builder reads
  // the latest value without re-creating the callback, and mirrored in state so
  // the intake screen resets cleanly between runs.
  const [participant, setParticipant] = useState<ParticipantInfo | null>(null);
  const participantRef = useRef<ParticipantInfo | null>(null);
  useEffect(() => {
    participantRef.current = participant;
  }, [participant]);

  // Guards single-shot export per completed assessment so the fire-and-forget
  // Sheets POST is not re-sent on re-render.
  const exportedAssessmentIdRef = useRef<string | null>(null);

  const label = getScreenLabel(state);
  const description = getScreenDescription(state);

  // Record when the timed assessment begins so results have a real start time.
  // The real per-frame analysis is driven inside AssessmentScreen via the shared
  // session (session.runAssessment), so App does not pump frames here.
  useEffect(() => {
    if (state.screen === 'assessment' && state.elapsed === 0) {
      assessmentStartRef.current = Date.now();
    }
  }, [state]);

  /**
   * Builds the assessment for the completed run. Prefers the real
   * `buildAssessmentFromAnalysis(result, config)` path using the session's
   * finalized analysis; falls back to the placeholder builder only if no valid
   * frames were captured, so the workflow always completes end-to-end (Req 1.4).
   */
  const buildCompletedAssessment = useCallback((): PronatorDriftAssessment => {
    const participantInfo = participantRef.current ?? undefined;
    const result = session.getLastResult();
    if (result && !result.noValidAssessedArmFrames) {
      const assessment = buildAssessmentFromAnalysis(result, config);
      // Attach per-arm indicators + the real wrist-drift time series so the
      // Results screen can show LEFT and RIGHT side by side (front-facing mode).
      const armIndicators = session.getLastArmIndicators();
      const wristDriftSeries = session.getLastWristDriftSeries();
      return {
        ...assessment,
        participant: participantInfo,
        leftIndicators: armIndicators?.left,
        rightIndicators: armIndicators?.right,
        wristDriftSeries: wristDriftSeries ?? undefined,
      };
    }
    return { ...buildAssessment(assessmentStartRef.current), participant: participantInfo };
  }, [config, session]);

  // On entering completion, surface the session's recording (if any) for the
  // Results screen. The analysis itself was finalized inside the session's
  // runAssessment(); we just wait a tick for it to settle, then mark ready.
  useEffect(() => {
    if (state.screen !== 'completion') return;
    let cancelled = false;
    // The session's runAssessment resolves ~when the timer ends; give it a brief
    // moment to store its result before we read it.
    const id = setTimeout(() => {
      if (cancelled) return;
      setRecording(session.getRecordingManager().getRecording());
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [state.screen, session]);

  // Release prior recording + movement data when starting over or leaving to
  // home (Req 11.5, 18.4).
  useEffect(() => {
    if (state.screen === 'welcome') {
      // Full teardown when returning home: stop camera + CV worker, and clear
      // the participant details so a new session starts from a blank intake.
      session.dispose();
      setRecording(null);
      setParticipant(null);
      exportedAssessmentIdRef.current = null;
    } else if (state.screen === 'cameraSetup') {
      // New run: release prior analysis + recording, keep camera/CV for reuse.
      session.reset();
      setRecording(null);
    }
  }, [state.screen, session]);

  // Fire the optional Google Sheets export exactly once when the results screen
  // is reached. This is a no-op unless a Web App URL is configured in
  // integrations/sheetsExport.ts (or via the VITE_SHEETS_WEBAPP_URL env var),
  // and it never blocks or affects the UI.
  useEffect(() => {
    if (state.screen !== 'results') return;
    const { assessment } = state;
    if (exportedAssessmentIdRef.current === assessment.assessmentId) return;
    exportedAssessmentIdRef.current = assessment.assessmentId;
    exportToSheets(assessment);
  }, [state]);

  // Deletes the surfaced recording and releases its on-device resources when the
  // user requests deletion from the Results screen (Req 11.4, 18.4).
  const handleDeleteRecording = useCallback(() => {
    session.getRecordingManager().delete();
    setRecording(null);
  }, [session]);

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
      case 'participantInfo':
        return (
          <ParticipantInfoScreen
            dispatch={(event) => {
              if (event.type === 'PARTICIPANT_INFO_SUBMITTED') {
                setParticipant(event.participant);
              }
              dispatch(event);
            }}
          />
        );
      case 'safetyConfirmation':
        return <SafetyConfirmationScreen dispatch={dispatch} />;
      case 'cameraSetup':
        return (
          <>
            <CameraSetupScreen dispatch={dispatch} />
            {/* On-device-only recording consent (Req 11.2). Presented before the
                assessment begins so the user can opt in to an optional video
                recording that is stored on this device only and never uploaded. */}
            <section
              className="app__recording-consent"
              aria-label="Recording consent"
              data-testid="recording-consent"
            >
              <label className="app__recording-consent-label">
                <input
                  type="checkbox"
                  checked={recordingConsented}
                  onChange={(e) => setRecordingConsented(e.target.checked)}
                  data-testid="recording-consent-checkbox"
                />
                <span data-testid="recording-consent-text">
                  Record this assessment on my device only. The video is stored
                  on this device, is never uploaded or transmitted anywhere, and
                  can be deleted at any time.
                </span>
              </label>
            </section>
          </>
        );
      case 'instruction':
        return <InstructionScreen dispatch={dispatch} speechSystem={speechSystem} />;
      case 'positionValidation':
        return <PositionValidationScreen dispatch={dispatch} />;
      case 'calibration':
        return <CalibrationScreen dispatch={dispatch} />;
      case 'assessment':
        return <AssessmentScreen dispatch={dispatch} speechSystem={speechSystem ?? undefined} />;
      case 'completion':
        return (
          <CompletionScreen
            dispatch={dispatch}
            speechSystem={speechSystem ?? undefined}
            buildAssessment={buildCompletedAssessment}
          />
        );
      case 'failure':
        return <FailureScreen dispatch={dispatch} speechSystem={speechSystem} reason={currentState.reason} />;
      case 'results':
        return (
          <ResultsScreen
            dispatch={dispatch}
            assessment={currentState.assessment}
            recording={recording}
            onDeleteRecording={handleDeleteRecording}
          />
        );
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

/**
 * Root App — provides the shared AssessmentSession to the whole workflow so the
 * camera, CV worker, calibration baseline, and assessment loop are shared across
 * screens (making the real analysis run end-to-end).
 */
function App() {
  return (
    <AssessmentSessionProvider>
      <AppInner />
    </AssessmentSessionProvider>
  );
}

export default App;
