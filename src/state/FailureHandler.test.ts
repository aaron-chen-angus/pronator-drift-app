import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  FailureHandler,
  createInitialDetectionState,
  createFailureInfo,
  getFailureMessage,
  isUserInitiated,
  speakFailureMessage,
  FAILURE_SPEECH_MESSAGE,
  USER_STOP_REASON,
} from './FailureHandler';
import type { ISpeechSystem } from '../audio/SpeechSystem';
import type { AppEvent } from '../types/index';

// ─── Mock SpeechSystem ───────────────────────────────────────────────────────

function createMockSpeechSystem(): ISpeechSystem {
  return {
    speak: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    isMuted: vi.fn().mockReturnValue(false),
    isAvailable: vi.fn().mockReturnValue(true),
    getCurrentCaption: vi.fn().mockReturnValue(null),
    onCaptionChange: vi.fn(),
  };
}

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createMockDispatch(): { dispatch: React.Dispatch<AppEvent>; events: AppEvent[] } {
  const events: AppEvent[] = [];
  const dispatch = vi.fn((event: AppEvent) => {
    events.push(event);
  }) as unknown as React.Dispatch<AppEvent>;
  return { dispatch, events };
}

describe('FailureHandler', () => {
  let mockSpeech: ISpeechSystem;
  let mockDispatch: ReturnType<typeof createMockDispatch>;
  let handler: FailureHandler;

  beforeEach(() => {
    mockSpeech = createMockSpeechSystem();
    mockDispatch = createMockDispatch();
    handler = new FailureHandler(mockDispatch.dispatch, mockSpeech, {
      handsLostGracePeriod: 2.0,
    });
  });

  afterEach(() => {
    handler.stop();
  });

  describe('createInitialDetectionState', () => {
    it('returns a state with all conditions false', () => {
      const state = createInitialDetectionState();
      expect(state.bothHandsLost).toBe(false);
      expect(state.handsLostSince).toBeNull();
      expect(state.cameraInterrupted).toBe(false);
      expect(state.tabHidden).toBe(false);
      expect(state.orientationChanged).toBe(false);
      expect(state.assessmentActive).toBe(false);
    });
  });

  describe('getFailureMessage', () => {
    it('returns correct message for tracking_lost', () => {
      expect(getFailureMessage('tracking_lost')).toBe('Both hands lost from tracking');
    });

    it('returns correct message for camera_interrupted', () => {
      expect(getFailureMessage('camera_interrupted')).toBe('Camera access was interrupted');
    });

    it('returns correct message for tab_hidden', () => {
      expect(getFailureMessage('tab_hidden')).toBe('Browser tab lost visibility');
    });

    it('returns correct message for orientation_changed', () => {
      expect(getFailureMessage('orientation_changed')).toBe('Device orientation changed');
    });

    it('returns correct message for user_stop', () => {
      expect(getFailureMessage('user_stop')).toBe(USER_STOP_REASON);
    });
  });

  describe('isUserInitiated', () => {
    it('returns true for user_stop', () => {
      expect(isUserInitiated('user_stop')).toBe(true);
    });

    it('returns false for all other reasons', () => {
      expect(isUserInitiated('tracking_lost')).toBe(false);
      expect(isUserInitiated('camera_interrupted')).toBe(false);
      expect(isUserInitiated('tab_hidden')).toBe(false);
      expect(isUserInitiated('orientation_changed')).toBe(false);
    });
  });

  describe('createFailureInfo', () => {
    it('creates correct failure info for tracking_lost', () => {
      const info = createFailureInfo('tracking_lost');
      expect(info.reason).toBe('tracking_lost');
      expect(info.message).toBe('Both hands lost from tracking');
      expect(info.isUserInitiated).toBe(false);
    });

    it('creates correct failure info for user_stop', () => {
      const info = createFailureInfo('user_stop');
      expect(info.reason).toBe('user_stop');
      expect(info.message).toBe(USER_STOP_REASON);
      expect(info.isUserInitiated).toBe(true);
    });
  });

  describe('start and stop', () => {
    it('sets assessmentActive to true on start', () => {
      handler.start();
      expect(handler.isActive()).toBe(true);
    });

    it('sets assessmentActive to false on stop', () => {
      handler.start();
      handler.stop();
      expect(handler.isActive()).toBe(false);
    });
  });

  describe('hands lost detection (Requirement 15.1)', () => {
    it('does not trigger failure within grace period', () => {
      handler.start();
      handler.reportHandsLost(0);
      handler.reportHandsLost(1000); // 1 second elapsed, grace period is 2s
      expect(mockDispatch.events.length).toBe(0);
    });

    it('triggers TRACKING_LOST after grace period exceeded', () => {
      handler.start();
      handler.reportHandsLost(0);
      handler.reportHandsLost(2001); // 2.001 seconds > 2.0 grace period
      expect(mockDispatch.events.length).toBe(1);
      expect(mockDispatch.events[0]).toEqual({
        type: 'TRACKING_LOST',
        reason: 'Both hands lost from tracking',
      });
    });

    it('resets when hands are recovered', () => {
      handler.start();
      handler.reportHandsLost(0);
      handler.reportHandsLost(1500); // 1.5s - still in grace period
      handler.reportHandsRecovered();
      handler.reportHandsLost(3000); // Starts fresh
      handler.reportHandsLost(4000); // Only 1s since new loss - within grace
      expect(mockDispatch.events.length).toBe(0);
    });

    it('does not trigger when handler is not active', () => {
      handler.reportHandsLost(0);
      handler.reportHandsLost(5000);
      expect(mockDispatch.events.length).toBe(0);
    });
  });

  describe('camera interrupted (Requirement 15.2)', () => {
    it('dispatches CAMERA_LOST immediately', () => {
      handler.start();
      handler.reportCameraInterrupted();
      expect(mockDispatch.events.length).toBe(1);
      expect(mockDispatch.events[0]).toEqual({ type: 'CAMERA_LOST' });
    });

    it('does not trigger when not active', () => {
      handler.reportCameraInterrupted();
      expect(mockDispatch.events.length).toBe(0);
    });
  });

  describe('tab visibility (Requirement 15.3)', () => {
    it('dispatches TAB_HIDDEN when document becomes hidden', () => {
      handler.start();
      // Simulate the tab becoming hidden
      Object.defineProperty(document, 'hidden', { value: true, writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(mockDispatch.events.length).toBe(1);
      expect(mockDispatch.events[0]).toEqual({ type: 'TAB_HIDDEN' });
      // Restore
      Object.defineProperty(document, 'hidden', { value: false, writable: true });
    });

    it('does not trigger when tab becomes visible', () => {
      handler.start();
      Object.defineProperty(document, 'hidden', { value: false, writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(mockDispatch.events.length).toBe(0);
    });
  });

  describe('user stop (Requirement 15.7)', () => {
    it('dispatches USER_STOP event', () => {
      handler.start();
      handler.handleUserStop();
      expect(mockDispatch.events.length).toBe(1);
      expect(mockDispatch.events[0]).toEqual({ type: 'USER_STOP' });
    });

    it('deactivates the handler', () => {
      handler.start();
      handler.handleUserStop();
      expect(handler.isActive()).toBe(false);
    });

    it('does not dispatch when not active', () => {
      handler.handleUserStop();
      expect(mockDispatch.events.length).toBe(0);
    });
  });

  describe('prevents double-triggering', () => {
    it('only dispatches one failure event even if multiple conditions occur', () => {
      handler.start();
      handler.reportCameraInterrupted();
      // Try another failure - should be ignored since handler is no longer active
      handler.reportHandsLost(0);
      handler.reportHandsLost(5000);
      expect(mockDispatch.events.length).toBe(1);
    });
  });
});

describe('speakFailureMessage', () => {
  it('speaks the failure message via speech system', async () => {
    const mockSpeech = createMockSpeechSystem();
    await speakFailureMessage(mockSpeech);
    expect(mockSpeech.speak).toHaveBeenCalledWith(FAILURE_SPEECH_MESSAGE);
  });

  it('uses the correct failure message text', () => {
    expect(FAILURE_SPEECH_MESSAGE).toBe(
      'We have lost a clear view of your arms. You may open your eyes and relax.'
    );
  });
});
