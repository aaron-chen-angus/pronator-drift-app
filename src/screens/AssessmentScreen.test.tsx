import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import {
  AssessmentScreen,
  SPEECH_POSITION_CONFIRMED,
  SPEECH_EYES_CLOSED,
  COUNTDOWN_CUES,
} from './AssessmentScreen';
import type { SpeechSystem } from '../audio/SpeechSystem';

/**
 * Creates a mock SpeechSystem for testing.
 * By default, speak() resolves immediately.
 */
function createMockSpeechSystem(options?: {
  failOnSpeak?: boolean;
}): SpeechSystem {
  const captionListeners: Array<(caption: string | null) => void> = [];

  const mock = {
    speak: vi.fn(async (text: string) => {
      if (options?.failOnSpeak) {
        throw new Error('Speech synthesis failed');
      }
      captionListeners.forEach(cb => cb(text));
      captionListeners.forEach(cb => cb(null));
    }),
    cancel: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    isMuted: vi.fn(() => false),
    isAvailable: vi.fn(() => true),
    getCurrentCaption: vi.fn(() => null),
    onCaptionChange: vi.fn((callback: (caption: string | null) => void) => {
      captionListeners.push(callback);
    }),
  } as unknown as SpeechSystem;

  return mock;
}

describe('AssessmentScreen', () => {
  const mockDispatch = vi.fn();
  let mockSpeech: SpeechSystem;

  beforeEach(() => {
    vi.useFakeTimers();
    mockDispatch.mockClear();
    mockSpeech = createMockSpeechSystem();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders with assessment region label', async () => {
    await act(async () => {
      render(<AssessmentScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    });
    // After start sequence completes, we'll be in running state
    await act(async () => {
      vi.advanceTimersByTime(3000); // inter-speech delay
    });
    expect(screen.getByRole('region', { name: 'Assessment in Progress' })).toBeDefined();
  });

  it('displays the timer showing remaining seconds', async () => {
    await act(async () => {
      render(<AssessmentScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText('30')).toBeDefined();
    expect(screen.getByText('seconds remaining')).toBeDefined();
  });

  it('runs the start sequence: position speech → delay → eyes-closed speech', async () => {
    await act(async () => {
      render(<AssessmentScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    });

    // Position confirmation speech should be called
    expect(mockSpeech.speak).toHaveBeenCalledWith(
      SPEECH_POSITION_CONFIRMED,
      expect.objectContaining({ rate: expect.any(Number) })
    );

    // Advance past inter-speech delay
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    // Eyes-closed instruction should be called
    expect(mockSpeech.speak).toHaveBeenCalledWith(
      SPEECH_EYES_CLOSED,
      expect.objectContaining({ rate: expect.any(Number) })
    );
  });

  it('starts the 30s timer after start sequence completes', async () => {
    await act(async () => {
      render(<AssessmentScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(3000); // inter-speech delay
    });

    // Advance 1 second — timer should tick
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockDispatch).toHaveBeenCalledWith({ type: 'ASSESSMENT_TICK', elapsed: 1 });
    expect(screen.getByText('29')).toBeDefined();
  });

  it('displays a visible, accessible stop button', async () => {
    await act(async () => {
      render(<AssessmentScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    const stopBtn = screen.getByRole('button', { name: 'Stop assessment' });
    expect(stopBtn).toBeDefined();
  });

  it('dispatches USER_STOP when stop button is pressed', async () => {
    await act(async () => {
      render(<AssessmentScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Stop assessment' }));
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'USER_STOP' });
  });

  it('cancels speech when stop button is pressed', async () => {
    await act(async () => {
      render(<AssessmentScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Stop assessment' }));
    expect(mockSpeech.cancel).toHaveBeenCalled();
  });

  it('dispatches ASSESSMENT_COMPLETE when timer reaches 30s', async () => {
    await act(async () => {
      render(<AssessmentScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(3000); // inter-speech delay
    });

    // Advance 30 seconds
    await act(async () => {
      vi.advanceTimersByTime(30000);
    });

    expect(mockDispatch).toHaveBeenCalledWith({ type: 'ASSESSMENT_COMPLETE' });
  });

  it('shows 0 seconds when timer completes', async () => {
    await act(async () => {
      render(<AssessmentScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    await act(async () => {
      vi.advanceTimersByTime(30000);
    });

    expect(screen.getByText('0')).toBeDefined();
  });

  it('speaks countdown cues at correct times', async () => {
    await act(async () => {
      render(<AssessmentScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    // At 5 seconds elapsed: "25 remaining"
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(mockSpeech.speak).toHaveBeenCalledWith('25 remaining', expect.any(Object));

    // At 10 seconds elapsed: "20 remaining"
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(mockSpeech.speak).toHaveBeenCalledWith('20 remaining', expect.any(Object));
  });

  it('speaks final countdown "5, 4, 3, 2, 1" at 1-second intervals', async () => {
    await act(async () => {
      render(<AssessmentScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    // Advance to 25 seconds elapsed
    await act(async () => {
      vi.advanceTimersByTime(25000);
    });

    expect(mockSpeech.speak).toHaveBeenCalledWith('5', expect.any(Object));

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(mockSpeech.speak).toHaveBeenCalledWith('4', expect.any(Object));

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(mockSpeech.speak).toHaveBeenCalledWith('3', expect.any(Object));

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(mockSpeech.speak).toHaveBeenCalledWith('2', expect.any(Object));

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(mockSpeech.speak).toHaveBeenCalledWith('1', expect.any(Object));
  });

  it('only speaks time cues during assessment — no drift/performance speech', () => {
    // Verify the COUNTDOWN_CUES contain only time-remaining info
    const forbiddenWords = ['drift', 'pronation', 'arm', 'movement', 'position', 'performance'];
    for (const [, text] of COUNTDOWN_CUES) {
      for (const word of forbiddenWords) {
        expect(text.toLowerCase()).not.toContain(word);
      }
    }
  });

  it('shows error with retry option when speech system is unavailable', async () => {
    await act(async () => {
      render(<AssessmentScreen dispatch={mockDispatch} speechSystem={undefined} />);
    });

    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Retry starting the assessment' })).toBeDefined();
  });

  it('shows error with retry option when speech fails during start sequence', async () => {
    const failingSpeech = createMockSpeechSystem({ failOnSpeak: true });

    await act(async () => {
      render(<AssessmentScreen dispatch={mockDispatch} speechSystem={failingSpeech} />);
    });

    // Flush all pending promises and timers
    await act(async () => {
      vi.runAllTimers();
    });

    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Retry starting the assessment' })).toBeDefined();
  });

  it('retries the start sequence when retry button is pressed', async () => {
    const failingSpeech = createMockSpeechSystem({ failOnSpeak: true });

    await act(async () => {
      render(<AssessmentScreen dispatch={mockDispatch} speechSystem={failingSpeech} />);
    });

    // Flush to get to error state
    await act(async () => {
      vi.runAllTimers();
    });

    expect(screen.getByRole('alert')).toBeDefined();

    // Now make speech work
    (failingSpeech.speak as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      // success
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry starting the assessment' }));
    });

    // Speech should be called again for the position confirmation
    expect(failingSpeech.speak).toHaveBeenCalledWith(
      SPEECH_POSITION_CONFIRMED,
      expect.any(Object)
    );
  });

  it('has proper ARIA timer role on the countdown element', async () => {
    await act(async () => {
      render(<AssessmentScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    const timerEl = screen.getByRole('timer');
    expect(timerEl).toBeDefined();
    expect(timerEl.getAttribute('aria-label')).toBe('30 seconds remaining');
  });

  it('updates the timer aria-label as countdown progresses', async () => {
    await act(async () => {
      render(<AssessmentScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    const timerEl = screen.getByRole('timer');
    expect(timerEl.getAttribute('aria-label')).toBe('25 seconds remaining');
  });

  it('stop button is accessible via keyboard (button element)', async () => {
    await act(async () => {
      render(<AssessmentScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    const stopBtn = screen.getByRole('button', { name: 'Stop assessment' });
    // Button elements are natively keyboard-accessible
    expect(stopBtn.tagName).toBe('BUTTON');
    expect(stopBtn.getAttribute('type')).toBe('button');
  });
});
