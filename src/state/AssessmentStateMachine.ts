/**
 * Assessment State Machine
 *
 * Manages all screen transitions for the pronator drift screening workflow.
 * Enforces strict workflow ordering: invalid events for the current screen
 * are no-ops (return current state unchanged).
 *
 * State diagram:
 *   Welcome → SafetyConfirmation → CameraSetup → Instruction → PositionValidation
 *   → Calibration → AssessmentStart → Assessment → Completion → Results
 *
 * Additional transitions:
 *   Welcome ↔ HowItWorks
 *   SafetyConfirmation → Welcome (exit)
 *   PositionValidation → Instruction (timeout/replay)
 *   Calibration → PositionValidation (retry on failure)
 *   Assessment → Failure (tracking lost / camera lost / tab hidden / orientation)
 *   Failure → Results (after speech)
 *   Results → Welcome (return home)
 *   Results → CameraSetup (repeat)
 */

import { useReducer } from 'react';
import type { AppState, AppEvent } from '../types/index';

// Re-export types for convenience
export type { AppState, AppEvent };

/** Initial application state – the welcome screen. */
export const initialState: AppState = { screen: 'welcome' };

/**
 * Pure reducer function implementing the assessment state machine.
 * Invalid transitions return the current state unchanged (no-op).
 */
export function assessmentReducer(state: AppState, event: AppEvent): AppState {
  switch (state.screen) {
    case 'welcome':
      return handleWelcome(state, event);
    case 'howItWorks':
      return handleHowItWorks(state, event);
    case 'safetyConfirmation':
      return handleSafetyConfirmation(state, event);
    case 'cameraSetup':
      return handleCameraSetup(state, event);
    case 'instruction':
      return handleInstruction(state, event);
    case 'positionValidation':
      return handlePositionValidation(state, event);
    case 'calibration':
      return handleCalibration(state, event);
    case 'assessmentStart':
      return handleAssessmentStart(state, event);
    case 'assessment':
      return handleAssessment(state, event);
    case 'completion':
      return handleCompletion(state, event);
    case 'failure':
      return handleFailure(state, event);
    case 'results':
      return handleResults(state, event);
    default:
      return state;
  }
}

// ─── Per-Screen Handlers ─────────────────────────────────────────────────────

function handleWelcome(_state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case 'START_ASSESSMENT':
      return { screen: 'safetyConfirmation', confirmed: new Set<string>() };
    case 'SHOW_HOW_IT_WORKS':
      return { screen: 'howItWorks' };
    default:
      return _state;
  }
}

function handleHowItWorks(_state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case 'BACK_TO_WELCOME':
      return { screen: 'welcome' };
    default:
      return _state;
  }
}

function handleSafetyConfirmation(_state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case 'SAFETY_CONFIRMED':
      return { screen: 'cameraSetup', cameraStatus: 'requesting' };
    case 'EXIT_ASSESSMENT':
      return { screen: 'welcome' };
    default:
      return _state;
  }
}

function handleCameraSetup(_state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case 'CAMERA_READY':
      return { screen: 'cameraSetup', cameraStatus: 'active' };
    case 'ALL_CHECKS_PASS':
      return { screen: 'instruction' };
    default:
      return _state;
  }
}

function handleInstruction(_state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case 'CONTINUE_TO_POSITION':
      return {
        screen: 'positionValidation',
        validation: {
          isValid: false,
          checks: [],
          highestPriorityFail: null,
          holdProgress: 0,
        },
      };
    case 'REPLAY_INSTRUCTIONS':
      // Stay on instruction screen (re-trigger speech externally)
      return { screen: 'instruction' };
    default:
      return _state;
  }
}

function handlePositionValidation(_state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case 'POSITION_VALID':
      return { screen: 'calibration', progress: 0 };
    case 'POSITION_TIMEOUT':
      // Go back to instruction screen so user can replay or exit
      return { screen: 'instruction' };
    case 'REPLAY_INSTRUCTIONS':
      return { screen: 'instruction' };
    case 'EXIT_ASSESSMENT':
      return { screen: 'welcome' };
    default:
      return _state;
  }
}

function handleCalibration(_state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case 'CALIBRATION_COMPLETE':
      return { screen: 'assessmentStart', speechPhase: 'position' };
    case 'CALIBRATION_FAILED':
      // Retry: go back to position validation
      return {
        screen: 'positionValidation',
        validation: {
          isValid: false,
          checks: [],
          highestPriorityFail: null,
          holdProgress: 0,
        },
      };
    default:
      return _state;
  }
}

function handleAssessmentStart(_state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case 'SPEECH_COMPLETE':
      if (_state.screen === 'assessmentStart') {
        if (_state.speechPhase === 'position') {
          // First speech done → move to eyes_closed phase
          return { screen: 'assessmentStart', speechPhase: 'eyes_closed' };
        }
        if (_state.speechPhase === 'eyes_closed') {
          // Eyes-closed speech done → start assessment timer
          return { screen: 'assessment', elapsed: 0, timeRemaining: 30 };
        }
      }
      return _state;
    default:
      return _state;
  }
}

function handleAssessment(_state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case 'ASSESSMENT_TICK':
      return {
        screen: 'assessment',
        elapsed: event.elapsed,
        timeRemaining: Math.max(0, 30 - event.elapsed),
      };
    case 'ASSESSMENT_COMPLETE':
      return { screen: 'completion', speechPlaying: true };
    case 'TRACKING_LOST':
      return { screen: 'failure', reason: event.reason };
    case 'CAMERA_LOST':
      return { screen: 'failure', reason: 'Camera access was interrupted' };
    case 'TAB_HIDDEN':
      return { screen: 'failure', reason: 'Browser tab lost visibility' };
    case 'ORIENTATION_CHANGED':
      return { screen: 'failure', reason: 'Device orientation changed' };
    case 'USER_STOP':
      return { screen: 'failure', reason: 'Assessment stopped by user' };
    default:
      return _state;
  }
}

function handleCompletion(_state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case 'SPEECH_COMPLETE':
      // After completion speech finishes, mark speechPlaying as false
      return { screen: 'completion', speechPlaying: false };
    case 'SHOW_RESULTS':
      // Transition to results screen with assessment data
      return { screen: 'results', assessment: event.assessment };
    default:
      return _state;
  }
}

function handleFailure(_state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case 'SPEECH_COMPLETE':
      // After failure speech completes, remain on failure screen
      // (waiting for user to choose repeat or return home)
      return _state;
    case 'REPEAT_ASSESSMENT':
      return { screen: 'cameraSetup', cameraStatus: 'requesting' };
    case 'RETURN_HOME':
      return { screen: 'welcome' };
    default:
      return _state;
  }
}

function handleResults(_state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case 'RETURN_HOME':
      return { screen: 'welcome' };
    case 'REPEAT_ASSESSMENT':
      return { screen: 'cameraSetup', cameraStatus: 'requesting' };
    default:
      return _state;
  }
}

// ─── React Hook ──────────────────────────────────────────────────────────────

/**
 * React hook wrapping the assessment state machine with useReducer.
 * Returns the current state and a dispatch function for sending events.
 */
export function useAssessmentStateMachine(): [AppState, React.Dispatch<AppEvent>] {
  return useReducer(assessmentReducer, initialState);
}
