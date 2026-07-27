import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InstructionScreen, INSTRUCTION_TEXT } from './InstructionScreen';
import { SpeechSystem } from '../audio/SpeechSystem';

/**
 * Creates a mock SpeechSystem for testing.
 * Simulates speak() resolving immediately and emitting caption events.
 */
function createMockSpeechSystem(): SpeechSystem {
  const captionListeners: Array<(caption: string | null) => void> = [];
  let currentCaption: string | null = null;

  const mock = {
    speak: vi.fn(async (text: string) => {
      currentCaption = text;
      captionListeners.forEach(cb => cb(text));
      // Simulate speech completing
      currentCaption = null;
      captionListeners.forEach(cb => cb(null));
    }),
    cancel: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    isMuted: vi.fn(() => false),
    isAvailable: vi.fn(() => true),
    getCurrentCaption: vi.fn(() => currentCaption),
    onCaptionChange: vi.fn((callback: (caption: string | null) => void) => {
      captionListeners.push(callback);
    }),
  } as unknown as SpeechSystem;

  return mock;
}

describe('InstructionScreen', () => {
  const mockDispatch = vi.fn();
  let mockSpeech: SpeechSystem;

  beforeEach(() => {
    mockDispatch.mockClear();
    mockSpeech = createMockSpeechSystem();
  });

  it('displays the screen title', () => {
    render(<InstructionScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    expect(screen.getByText('Position Instructions')).toBeDefined();
  });

  it('displays a visual demonstration of the correct position', () => {
    render(<InstructionScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    const demo = screen.getByLabelText('Demonstration of correct test position');
    expect(demo).toBeDefined();
    expect(screen.getByText('Arms extended forward at shoulder height, palms facing up')).toBeDefined();
  });

  it('displays written instructions describing the correct position', () => {
    render(<InstructionScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    expect(screen.getByText(INSTRUCTION_TEXT)).toBeDefined();
  });

  it('triggers spoken instructions via SpeechSystem on mount', async () => {
    render(<InstructionScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    await waitFor(() => {
      expect(mockSpeech.speak).toHaveBeenCalledWith(
        INSTRUCTION_TEXT,
        expect.objectContaining({ rate: expect.any(Number) })
      );
    });
  });

  it('speaks instructions at 130-160 WPM rate', async () => {
    render(<InstructionScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    await waitFor(() => {
      const call = (mockSpeech.speak as ReturnType<typeof vi.fn>).mock.calls[0];
      const options = call[1];
      expect(options.rate).toBeGreaterThanOrEqual(130);
      expect(options.rate).toBeLessThanOrEqual(160);
    });
  });

  it('displays the "Replay Instructions" button', () => {
    render(<InstructionScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    expect(screen.getByRole('button', { name: 'Replay Instructions' })).toBeDefined();
  });

  it('displays the "Continue" button', () => {
    render(<InstructionScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDefined();
  });

  it('dispatches CONTINUE_TO_POSITION when "Continue" is clicked', async () => {
    render(<InstructionScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    // Wait for initial speech to have completed
    await waitFor(() => {
      expect(mockSpeech.speak).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'CONTINUE_TO_POSITION' });
  });

  it('dispatches REPLAY_INSTRUCTIONS and re-triggers speech when "Replay" is clicked', async () => {
    render(<InstructionScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    
    // Wait for initial speech to complete
    await waitFor(() => {
      expect(mockSpeech.speak).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Replay Instructions' }));

    expect(mockDispatch).toHaveBeenCalledWith({ type: 'REPLAY_INSTRUCTIONS' });
    expect(mockSpeech.cancel).toHaveBeenCalled();

    await waitFor(() => {
      expect(mockSpeech.speak).toHaveBeenCalledTimes(2);
    });
  });

  it('cancels speech when "Continue" is clicked', async () => {
    render(<InstructionScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    // Wait for initial speech to have completed
    await waitFor(() => {
      expect(mockSpeech.speak).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(mockSpeech.cancel).toHaveBeenCalled();
  });

  it('registers a caption change listener on the SpeechSystem', () => {
    render(<InstructionScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    expect(mockSpeech.onCaptionChange).toHaveBeenCalled();
  });

  it('shows instruction text as fallback when no speech system is provided', () => {
    render(<InstructionScreen dispatch={mockDispatch} />);
    // Without a speech system, the caption shows the instruction text as fallback
    // The text will appear both in written instructions and caption area
    const allMatches = screen.getAllByText(INSTRUCTION_TEXT);
    expect(allMatches.length).toBeGreaterThanOrEqual(2);
    // Verify the caption element specifically exists
    const captionEl = screen.getByRole('status');
    expect(captionEl.textContent).toBe(INSTRUCTION_TEXT);
  });

  it('has accessible region label', () => {
    render(<InstructionScreen dispatch={mockDispatch} speechSystem={mockSpeech} />);
    expect(screen.getByRole('region', { name: 'Instructions and Demonstration' })).toBeDefined();
  });
});
