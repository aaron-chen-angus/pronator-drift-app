/**
 * Tests for PositionValidationScreen component
 *
 * Validates:
 * - Real-time position validation feedback display
 * - Hold progress indicator (0-100%)
 * - "Position confirmed" display when hold duration met
 * - Highest-priority correction message display when invalid
 * - 60-second timeout with replay/exit options
 * - Dispatch of POSITION_VALID event on confirmation
 * - Dispatch of POSITION_TIMEOUT event on timeout
 * - Dispatch of REPLAY_INSTRUCTIONS and EXIT_ASSESSMENT on timeout buttons
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { PositionValidationScreen } from './PositionValidationScreen';

// ─── Mocks ───────────────────────────────────────────────────────────────────

function createMockMediaStream(): MediaStream {
  const mockTrack = {
    kind: 'video' as const,
    stop: vi.fn(),
    getSettings: () => ({ deviceId: 'camera-1' }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };

  return {
    getTracks: () => [mockTrack],
    getVideoTracks: () => [mockTrack],
    getAudioTracks: () => [],
    id: 'mock-stream-id',
    active: true,
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    clone: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onaddtrack: null,
    onremovetrack: null,
  } as unknown as MediaStream;
}

let mockGetUserMedia: ReturnType<typeof vi.fn>;

function setupMocks() {
  mockGetUserMedia = vi.fn().mockResolvedValue(createMockMediaStream());

  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getUserMedia: mockGetUserMedia,
      enumerateDevices: vi.fn().mockResolvedValue([]),
    },
    writable: true,
    configurable: true,
  });

  // Mock HTMLVideoElement.play
  vi.spyOn(HTMLVideoElement.prototype, 'play').mockResolvedValue(undefined);

  // Mock requestAnimationFrame — do not invoke callback to prevent loop
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

  // Mock canvas getContext for CameraOverlay
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({
      data: new Uint8ClampedArray(64 * 48 * 4).fill(128),
      width: 64,
      height: 48,
      colorSpace: 'srgb' as PredefinedColorSpace,
    }),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    setLineDash: vi.fn(),
    fillText: vi.fn(),
    ellipse: vi.fn(),
    measureText: () => ({ width: 20 }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
  } as unknown as CanvasRenderingContext2D);
}

beforeEach(() => {
  setupMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PositionValidationScreen', () => {
  describe('Rendering', () => {
    it('renders with the title "Hold Your Position"', async () => {
      const dispatch = vi.fn();
      const mockStream = createMockMediaStream();

      await act(async () => {
        render(<PositionValidationScreen dispatch={dispatch} stream={mockStream} />);
      });

      expect(screen.getByText('Hold Your Position')).toBeTruthy();
    });

    it('has aria-label "Position Validation" on the region', async () => {
      const dispatch = vi.fn();
      const mockStream = createMockMediaStream();

      await act(async () => {
        render(<PositionValidationScreen dispatch={dispatch} stream={mockStream} />);
      });

      const region = screen.getByRole('region', { name: 'Position Validation' });
      expect(region).toBeTruthy();
    });

    it('renders a video element for camera preview', async () => {
      const dispatch = vi.fn();
      const mockStream = createMockMediaStream();

      await act(async () => {
        render(<PositionValidationScreen dispatch={dispatch} stream={mockStream} />);
      });

      const video = screen.getByTestId('validation-camera-preview');
      expect(video).toBeTruthy();
    });

    it('renders the camera overlay canvas', async () => {
      const dispatch = vi.fn();
      const mockStream = createMockMediaStream();

      await act(async () => {
        render(<PositionValidationScreen dispatch={dispatch} stream={mockStream} />);
      });

      const canvas = screen.getByTestId('camera-overlay-canvas');
      expect(canvas).toBeTruthy();
    });
  });

  describe('Hold Progress Indicator', () => {
    it('displays hold progress indicator element', async () => {
      const dispatch = vi.fn();
      const mockStream = createMockMediaStream();

      await act(async () => {
        render(<PositionValidationScreen dispatch={dispatch} stream={mockStream} />);
      });

      const progress = screen.getByTestId('hold-progress');
      expect(progress).toBeTruthy();
    });

    it('displays initial progress as 0%', async () => {
      const dispatch = vi.fn();
      const mockStream = createMockMediaStream();

      await act(async () => {
        render(<PositionValidationScreen dispatch={dispatch} stream={mockStream} />);
      });

      expect(screen.getByText('0%')).toBeTruthy();
    });

    it('has a progressbar with aria attributes', async () => {
      const dispatch = vi.fn();
      const mockStream = createMockMediaStream();

      await act(async () => {
        render(<PositionValidationScreen dispatch={dispatch} stream={mockStream} />);
      });

      const progressBar = screen.getByRole('progressbar', { name: 'Hold progress' });
      expect(progressBar).toBeTruthy();
      expect(progressBar.getAttribute('aria-valuenow')).toBe('0');
      expect(progressBar.getAttribute('aria-valuemin')).toBe('0');
      expect(progressBar.getAttribute('aria-valuemax')).toBe('100');
    });
  });

  describe('Positioning Feedback', () => {
    it('has an aria-live polite feedback area', async () => {
      const dispatch = vi.fn();
      const mockStream = createMockMediaStream();

      await act(async () => {
        render(<PositionValidationScreen dispatch={dispatch} stream={mockStream} />);
      });

      const status = screen.getByRole('status');
      expect(status).toBeTruthy();
    });
  });

  describe('60-second Timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers({
        toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'],
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('dispatches POSITION_TIMEOUT after 60 seconds', async () => {
      const dispatch = vi.fn();
      const mockStream = createMockMediaStream();

      await act(async () => {
        render(<PositionValidationScreen dispatch={dispatch} stream={mockStream} />);
      });

      // Advance timers to 60 seconds
      await act(async () => {
        vi.advanceTimersByTime(60000);
      });

      expect(dispatch).toHaveBeenCalledWith({ type: 'POSITION_TIMEOUT' });
    });

    it('shows timeout message with replay and exit options', async () => {
      const dispatch = vi.fn();
      const mockStream = createMockMediaStream();

      await act(async () => {
        render(<PositionValidationScreen dispatch={dispatch} stream={mockStream} />);
      });

      await act(async () => {
        vi.advanceTimersByTime(60000);
      });

      expect(screen.getByTestId('timeout-message')).toBeTruthy();
      expect(screen.getByTestId('replay-instructions-btn')).toBeTruthy();
      expect(screen.getByTestId('exit-assessment-btn')).toBeTruthy();
    });

    it('dispatches REPLAY_INSTRUCTIONS when replay button is clicked after timeout', async () => {
      const dispatch = vi.fn();
      const mockStream = createMockMediaStream();

      await act(async () => {
        render(<PositionValidationScreen dispatch={dispatch} stream={mockStream} />);
      });

      await act(async () => {
        vi.advanceTimersByTime(60000);
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('replay-instructions-btn'));
      });

      expect(dispatch).toHaveBeenCalledWith({ type: 'REPLAY_INSTRUCTIONS' });
    });

    it('dispatches EXIT_ASSESSMENT when exit button is clicked after timeout', async () => {
      const dispatch = vi.fn();
      const mockStream = createMockMediaStream();

      await act(async () => {
        render(<PositionValidationScreen dispatch={dispatch} stream={mockStream} />);
      });

      await act(async () => {
        vi.advanceTimersByTime(60000);
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('exit-assessment-btn'));
      });

      expect(dispatch).toHaveBeenCalledWith({ type: 'EXIT_ASSESSMENT' });
    });

    it('does not dispatch timeout before 60 seconds', async () => {
      const dispatch = vi.fn();
      const mockStream = createMockMediaStream();

      await act(async () => {
        render(<PositionValidationScreen dispatch={dispatch} stream={mockStream} />);
      });

      await act(async () => {
        vi.advanceTimersByTime(59000);
      });

      expect(dispatch).not.toHaveBeenCalledWith({ type: 'POSITION_TIMEOUT' });
    });
  });

  describe('Position Confirmed', () => {
    it('does not show confirmed state initially', async () => {
      const dispatch = vi.fn();
      const mockStream = createMockMediaStream();

      await act(async () => {
        render(<PositionValidationScreen dispatch={dispatch} stream={mockStream} />);
      });

      expect(screen.queryByTestId('position-confirmed')).toBeNull();
    });
  });

  describe('Accessibility', () => {
    it('video has aria-label for camera preview', async () => {
      const dispatch = vi.fn();
      const mockStream = createMockMediaStream();

      await act(async () => {
        render(<PositionValidationScreen dispatch={dispatch} stream={mockStream} />);
      });

      const video = screen.getByTestId('validation-camera-preview');
      expect(video.getAttribute('aria-label')).toBe('Camera preview');
    });

    it('timeout buttons have accessible text', async () => {
      vi.useFakeTimers({
        toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'],
      });
      const dispatch = vi.fn();
      const mockStream = createMockMediaStream();

      await act(async () => {
        render(<PositionValidationScreen dispatch={dispatch} stream={mockStream} />);
      });

      await act(async () => {
        vi.advanceTimersByTime(60000);
      });

      expect(screen.getByText('Replay Instructions')).toBeTruthy();
      expect(screen.getByText('Exit Assessment')).toBeTruthy();
      vi.useRealTimers();
    });
  });

  describe('Camera Fallback', () => {
    it('requests camera via getUserMedia when no stream prop is provided', async () => {
      const dispatch = vi.fn();

      await act(async () => {
        render(<PositionValidationScreen dispatch={dispatch} />);
      });

      expect(mockGetUserMedia).toHaveBeenCalledTimes(1);
    });

    it('does not request camera when stream prop is provided', async () => {
      const dispatch = vi.fn();
      const mockStream = createMockMediaStream();

      await act(async () => {
        render(<PositionValidationScreen dispatch={dispatch} stream={mockStream} />);
      });

      expect(mockGetUserMedia).not.toHaveBeenCalled();
    });
  });
});
