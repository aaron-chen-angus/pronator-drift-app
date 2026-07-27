/**
 * FailureHandler - Detects failure conditions and manages graceful assessment interruption.
 *
 * Detects:
 * - Both hands lost from tracking for longer than the configured grace period
 * - Camera access interrupted during assessment
 * - Browser tab losing visibility (Page Visibility API)
 * - Device orientation change during assessment
 *
 * On failure detection:
 * - Speaks failure message BEFORE showing visual termination
 * - Displays reason and "Repeat Assessment" button only after speech completes
 *
 * On user-initiated stop:
 * - Stops timer, discards result, shows reason and Repeat button (no failure speech)
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7
 */

import type { AppEvent } from '../types/index';
import type { ISpeechSystem } from '../audio/SpeechSystem';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * The failure message spoken to the user before visual termination is shown.
 * Requirements 15.5
 */
export const FAILURE_SPEECH_MESSAGE =
  'We have lost a clear view of your arms. You may open your eyes and relax.';

/**
 * Reason string used for user-initiated stop events.
 */
export const USER_STOP_REASON = 'Assessment stopped by user';

// ─── Types ───────────────────────────────────────────────────────────────────

export type FailureReason =
  | 'tracking_lost'
  | 'camera_interrupted'
  | 'tab_hidden'
  | 'orientation_changed'
  | 'user_stop';

export interface FailureInfo {
  reason: FailureReason;
  message: string;
  isUserInitiated: boolean;
}

export interface FailureHandlerConfig {
  /** Grace period in seconds before declaring hands lost (from ConfigStore.occlusionGracePeriod) */
  handsLostGracePeriod: number;
}

// ─── Failure Detection State ─────────────────────────────────────────────────

export interface FailureDetectionState {
  /** Whether both hands have been lost */
  bothHandsLost: boolean;
  /** Timestamp when both hands were first lost (null if not lost) */
  handsLostSince: number | null;
  /** Whether the camera has been interrupted */
  cameraInterrupted: boolean;
  /** Whether the tab is hidden */
  tabHidden: boolean;
  /** Whether orientation has changed */
  orientationChanged: boolean;
  /** Whether assessment is currently active */
  assessmentActive: boolean;
}

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Creates the initial failure detection state.
 */
export function createInitialDetectionState(): FailureDetectionState {
  return {
    bothHandsLost: false,
    handsLostSince: null,
    cameraInterrupted: false,
    tabHidden: false,
    orientationChanged: false,
    assessmentActive: false,
  };
}

/**
 * Determines the human-readable failure message for a given failure reason.
 */
export function getFailureMessage(reason: FailureReason): string {
  switch (reason) {
    case 'tracking_lost':
      return 'Both hands lost from tracking';
    case 'camera_interrupted':
      return 'Camera access was interrupted';
    case 'tab_hidden':
      return 'Browser tab lost visibility';
    case 'orientation_changed':
      return 'Device orientation changed';
    case 'user_stop':
      return USER_STOP_REASON;
  }
}

/**
 * Determines whether a failure reason is user-initiated.
 */
export function isUserInitiated(reason: FailureReason): boolean {
  return reason === 'user_stop';
}

/**
 * Creates a FailureInfo object from a failure reason.
 */
export function createFailureInfo(reason: FailureReason): FailureInfo {
  return {
    reason,
    message: getFailureMessage(reason),
    isUserInitiated: isUserInitiated(reason),
  };
}

// ─── FailureHandler Class ────────────────────────────────────────────────────

/**
 * FailureHandler monitors for failure conditions during the assessment phase
 * and coordinates graceful interruption with speech-first notification.
 */
export class FailureHandler {
  private state: FailureDetectionState;
  private config: FailureHandlerConfig;
  private dispatch: React.Dispatch<AppEvent>;
  private speechSystem: ISpeechSystem;
  private visibilityHandler: (() => void) | null = null;
  private orientationHandler: (() => void) | null = null;
  private destroyed = false;

  constructor(
    dispatch: React.Dispatch<AppEvent>,
    speechSystem: ISpeechSystem,
    config: FailureHandlerConfig
  ) {
    this.state = createInitialDetectionState();
    this.config = config;
    this.dispatch = dispatch;
    this.speechSystem = speechSystem;
  }

  /**
   * Start monitoring for failure conditions.
   * Call this when the assessment begins.
   */
  start(): void {
    this.state.assessmentActive = true;
    this.destroyed = false;

    // Monitor Page Visibility API (Requirement 15.3)
    this.visibilityHandler = () => {
      if (document.hidden && this.state.assessmentActive) {
        this.handleFailure('tab_hidden');
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    // Monitor orientation change (Requirement 15.4)
    this.orientationHandler = () => {
      if (this.state.assessmentActive) {
        this.handleFailure('orientation_changed');
      }
    };

    // Use screen.orientation API if available, otherwise fall back to matchMedia
    if (screen.orientation) {
      screen.orientation.addEventListener('change', this.orientationHandler);
    } else {
      window.addEventListener('orientationchange', this.orientationHandler);
    }
  }

  /**
   * Stop monitoring and clean up event listeners.
   * Call this when the assessment ends (successfully or via failure).
   */
  stop(): void {
    this.state.assessmentActive = false;
    this.destroyed = true;

    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }

    if (this.orientationHandler) {
      if (screen.orientation) {
        screen.orientation.removeEventListener('change', this.orientationHandler);
      } else {
        window.removeEventListener('orientationchange', this.orientationHandler);
      }
      this.orientationHandler = null;
    }
  }

  /**
   * Report that both hands have been lost from tracking.
   * Starts the grace period timer. Call this each frame where both hands are not detected.
   * @param timestamp - Current frame timestamp in milliseconds
   */
  reportHandsLost(timestamp: number): void {
    if (!this.state.assessmentActive || this.destroyed) return;

    if (!this.state.bothHandsLost) {
      this.state.bothHandsLost = true;
      this.state.handsLostSince = timestamp;
    } else if (this.state.handsLostSince !== null) {
      const elapsedMs = timestamp - this.state.handsLostSince;
      const gracePeriodMs = this.config.handsLostGracePeriod * 1000;

      if (elapsedMs > gracePeriodMs) {
        // Grace period exceeded (Requirement 15.1)
        this.handleFailure('tracking_lost');
      }
    }
  }

  /**
   * Report that hands have been recovered (at least one hand is visible again).
   * Resets the grace period timer.
   */
  reportHandsRecovered(): void {
    this.state.bothHandsLost = false;
    this.state.handsLostSince = null;
  }

  /**
   * Report that the camera has been interrupted.
   * Immediately triggers failure (Requirement 15.2).
   */
  reportCameraInterrupted(): void {
    if (!this.state.assessmentActive || this.destroyed) return;
    this.state.cameraInterrupted = true;
    this.handleFailure('camera_interrupted');
  }

  /**
   * Handle user pressing the stop button (Requirement 15.7).
   * Stops timer, discards result, shows reason - NO failure speech.
   */
  handleUserStop(): void {
    if (!this.state.assessmentActive || this.destroyed) return;
    this.state.assessmentActive = false;
    this.stop();
    this.dispatch({ type: 'USER_STOP' });
  }

  /**
   * Internal: handle a detected failure condition.
   * Dispatches the appropriate event to the state machine.
   */
  private handleFailure(reason: FailureReason): void {
    if (!this.state.assessmentActive || this.destroyed) return;

    this.state.assessmentActive = false;
    this.stop();

    switch (reason) {
      case 'tracking_lost':
        this.dispatch({ type: 'TRACKING_LOST', reason: 'Both hands lost from tracking' });
        break;
      case 'camera_interrupted':
        this.dispatch({ type: 'CAMERA_LOST' });
        break;
      case 'tab_hidden':
        this.dispatch({ type: 'TAB_HIDDEN' });
        break;
      case 'orientation_changed':
        this.dispatch({ type: 'ORIENTATION_CHANGED' });
        break;
    }
  }

  /**
   * Returns the current failure detection state (useful for testing).
   */
  getState(): Readonly<FailureDetectionState> {
    return { ...this.state };
  }

  /**
   * Returns whether the handler is currently monitoring.
   */
  isActive(): boolean {
    return this.state.assessmentActive;
  }
}

/**
 * Speaks the failure message to the user.
 * Returns a promise that resolves when speech completes.
 * Used by FailureScreen to announce failure before showing visual content.
 *
 * Requirements 15.5: Speak failure message BEFORE showing visual termination.
 */
export async function speakFailureMessage(speechSystem: ISpeechSystem): Promise<void> {
  await speechSystem.speak(FAILURE_SPEECH_MESSAGE);
}
