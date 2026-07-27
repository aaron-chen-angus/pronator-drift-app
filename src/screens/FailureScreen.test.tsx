import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { FailureScreen } from './FailureScreen';
import { FAILURE_SPEECH_MESSAGE, USER_STOP_REASON } from '../state/FailureHandler';
import type { ISpeechSystem } from '../audio/SpeechSystem';
import type { AppEvent } from '../types/index';

// ─── Mock SpeechSystem ───────────────────────────────────────────────────────

function createMockSpeechSystem(options?: { speakDelay?: number }): ISpeechSystem {
  const { speakDelay = 0 } = options ?? {};
  return {
    speak: vi.fn().mockImplementation(() =>
      new Promise<void>((resolve) => {
        if (speakDelay > 0) {
          setTimeout(resolve, speakDelay);
        } else {
          resolve();
        }
      })
    ),
    cancel: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    isMuted: vi.fn().mockReturnValue(false),
    isAvailable: vi.fn().mockReturnValue(true),
    getCurrentCaption: vi.fn().mockReturnValue(null),
    onCaptionChange: vi.fn(),
  };
}

describe('FailureScreen', () => {
  let dispatch: React.Dispatch<AppEvent>;
  let dispatchedEvents: AppEvent[];

  beforeEach(() => {
    dispatchedEvents = [];
    dispatch = vi.fn((event: AppEvent) => {
      dispatchedEvents.push(event);
    }) as unknown as React.Dispatch<AppEvent>;
  });

  describe('non-user-initiated failure', () => {
    it('shows waiting state initially while speech is playing', () => {
      const speech = createMockSpeechSystem({ speakDelay: 1000 });
      render(
        <FailureScreen
          dispatch={dispatch}
          speechSystem={speech}
          reason="Camera access was interrupted"
        />
      );

      expect(screen.getByText('Please wait...')).toBeTruthy();
      expect(screen.getByText(FAILURE_SPEECH_MESSAGE)).toBeTruthy();
    });

    it('speaks the failure message on mount', () => {
      const speech = createMockSpeechSystem();
      render(
        <FailureScreen
          dispatch={dispatch}
          speechSystem={speech}
          reason="Camera access was interrupted"
        />
      );

      expect(speech.speak).toHaveBeenCalledWith(FAILURE_SPEECH_MESSAGE);
    });

    it('shows reason and buttons after speech completes', async () => {
      const speech = createMockSpeechSystem();
      render(
        <FailureScreen
          dispatch={dispatch}
          speechSystem={speech}
          reason="Camera access was interrupted"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Assessment Interrupted')).toBeTruthy();
        expect(screen.getByText('Camera access was interrupted')).toBeTruthy();
        expect(screen.getByText('Repeat Assessment')).toBeTruthy();
        expect(screen.getByText('Return Home')).toBeTruthy();
      });
    });

    it('shows relaxation instruction for non-user failures', async () => {
      const speech = createMockSpeechSystem();
      render(
        <FailureScreen
          dispatch={dispatch}
          speechSystem={speech}
          reason="Both hands lost from tracking"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('You may open your eyes and relax.')).toBeTruthy();
      });
    });
  });

  describe('user-initiated stop', () => {
    it('immediately shows reason and buttons (no speech)', () => {
      const speech = createMockSpeechSystem();
      render(
        <FailureScreen
          dispatch={dispatch}
          speechSystem={speech}
          reason={USER_STOP_REASON}
        />
      );

      // Should immediately show the full UI without waiting for speech
      expect(screen.getByText('Assessment Interrupted')).toBeTruthy();
      expect(screen.getByText(USER_STOP_REASON)).toBeTruthy();
      expect(screen.getByText('Repeat Assessment')).toBeTruthy();
      expect(screen.getByText('Return Home')).toBeTruthy();
      // Should NOT speak the failure message
      expect(speech.speak).not.toHaveBeenCalled();
    });

    it('does not show relaxation instruction for user-initiated stop', () => {
      const speech = createMockSpeechSystem();
      render(
        <FailureScreen
          dispatch={dispatch}
          speechSystem={speech}
          reason={USER_STOP_REASON}
        />
      );

      expect(screen.queryByText('You may open your eyes and relax.')).toBeNull();
    });
  });

  describe('button actions', () => {
    it('dispatches REPEAT_ASSESSMENT when Repeat Assessment is clicked', () => {
      const speech = createMockSpeechSystem();
      render(
        <FailureScreen
          dispatch={dispatch}
          speechSystem={speech}
          reason={USER_STOP_REASON}
        />
      );

      fireEvent.click(screen.getByText('Repeat Assessment'));
      expect(dispatchedEvents).toContainEqual({ type: 'REPEAT_ASSESSMENT' });
    });

    it('dispatches RETURN_HOME when Return Home is clicked', () => {
      const speech = createMockSpeechSystem();
      render(
        <FailureScreen
          dispatch={dispatch}
          speechSystem={speech}
          reason={USER_STOP_REASON}
        />
      );

      fireEvent.click(screen.getByText('Return Home'));
      expect(dispatchedEvents).toContainEqual({ type: 'RETURN_HOME' });
    });
  });

  describe('speech error handling', () => {
    it('shows full UI even if speech fails', async () => {
      const speech = createMockSpeechSystem();
      (speech.speak as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Speech failed'));
      render(
        <FailureScreen
          dispatch={dispatch}
          speechSystem={speech}
          reason="Browser tab lost visibility"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Assessment Interrupted')).toBeTruthy();
        expect(screen.getByText('Browser tab lost visibility')).toBeTruthy();
      });
    });
  });

  describe('cleanup', () => {
    it('cancels speech on unmount', () => {
      const speech = createMockSpeechSystem({ speakDelay: 5000 });
      const { unmount } = render(
        <FailureScreen
          dispatch={dispatch}
          speechSystem={speech}
          reason="Camera access was interrupted"
        />
      );

      unmount();
      expect(speech.cancel).toHaveBeenCalled();
    });
  });
});
