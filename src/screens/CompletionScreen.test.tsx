import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import {
  CompletionScreen,
  COMPLETION_MESSAGE,
  POST_SPEECH_DELAY_MS,
  NO_SPEECH_FALLBACK_DELAY_MS,
} from './CompletionScreen';
import type { SpeechSystem } from '../audio/SpeechSystem';
import type { PronatorDriftAssessment } from '../types/index';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Creates a mock SpeechSystem for testing.
 */
function createMockSpeechSystem(options?: {
  failOnSpeak?: boolean;
  muted?: boolean;
  unavailable?: boolean;
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
    isMuted: vi.fn(() => options?.muted ?? false),
    isAvailable: vi.fn(() => !(options?.unavailable ?? false)),
    getCurrentCaption: vi.fn(() => null),
    onCaptionChange: vi.fn((callback: (caption: string | null) => void) => {
      captionListeners.push(callback);
    }),
  } as unknown as SpeechSystem;

  return mock;
}

/**
 * Creates a minimal mock PronatorDriftAssessment for testing.
 */
function createMockAssessment(): PronatorDriftAssessment {
  return {
    assessmentId: 'test-uuid-1234',
    startedAt: '2024-01-01T00:00:00.000Z',
    completedAt: '2024-01-01T00:00:30.000Z',
    durationSeconds: 30,
    deviceType: 'desktop',
    orientation: 'portrait',
    modelVersions: {
      poseModel: 'pose_landmarker_full',
      handModel: 'hand_landmarker',
    },
    quality: {
      overall: 'good',
      metrics: {
        validFramePercentage: 95,
        avgPoseConfidence: 0.85,
        avgLeftHandConfidence: 0.8,
        avgRightHandConfidence: 0.8,
        cameraStability: 0.95,
        subjectVisibilityRate: 0.98,
        lightingAdequacyRate: 0.99,
        excessiveTorsoMovement: false,
        handsRemainedVisible: true,
        startingPoseValid: true,
        fullDurationCompleted: true,
      },
      primaryFailureReason: null,
      reasons: [],
    },
    leftArm: {
      baselineWristHeight: 0.5,
      maximumDownwardDriftNormalised: 0.01,
      driftDurationMilliseconds: 0,
      driftOnsetSeconds: null,
      maximumElbowFlexionChangeDegrees: 2,
      estimatedPalmRotationChangeDegrees: 5,
      possiblePronation: false,
      sustainedDownwardDrift: false,
      confidence: 0.9,
    },
    rightArm: {
      baselineWristHeight: 0.5,
      maximumDownwardDriftNormalised: 0.02,
      driftDurationMilliseconds: 0,
      driftOnsetSeconds: null,
      maximumElbowFlexionChangeDegrees: 3,
      estimatedPalmRotationChangeDegrees: 4,
      possiblePronation: false,
      sustainedDownwardDrift: false,
      confidence: 0.88,
    },
    overallClassification: 'no_significant_drift',
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CompletionScreen', () => {
  const mockDispatch = vi.fn();
  let mockSpeech: SpeechSystem;
  let mockAssessment: PronatorDriftAssessment;

  beforeEach(() => {
    vi.useFakeTimers();
    mockDispatch.mockClear();
    mockSpeech = createMockSpeechSystem();
    mockAssessment = createMockAssessment();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders with "Assessment Complete" region label', async () => {
    await act(async () => {
      render(
        <CompletionScreen
          dispatch={mockDispatch}
          speechSystem={mockSpeech}
          assessment={mockAssessment}
        />
      );
    });
    expect(screen.getByRole('region', { name: 'Assessment Complete' })).toBeDefined();
  });

  it('displays "Assessment complete" heading', async () => {
    await act(async () => {
      render(
        <CompletionScreen
          dispatch={mockDispatch}
          speechSystem={mockSpeech}
          assessment={mockAssessment}
        />
      );
    });
    expect(screen.getByText('Assessment complete')).toBeDefined();
  });

  it('speaks the completion message on mount', async () => {
    await act(async () => {
      render(
        <CompletionScreen
          dispatch={mockDispatch}
          speechSystem={mockSpeech}
          assessment={mockAssessment}
        />
      );
    });
    expect(mockSpeech.speak).toHaveBeenCalledWith(
      COMPLETION_MESSAGE,
      expect.objectContaining({ rate: expect.any(Number) })
    );
  });

  it('dispatches SHOW_RESULTS with assessment data after speech + 2s delay', async () => {
    await act(async () => {
      render(
        <CompletionScreen
          dispatch={mockDispatch}
          speechSystem={mockSpeech}
          assessment={mockAssessment}
        />
      );
    });

    // Speech completes immediately in mock, then 2s delay
    await act(async () => {
      vi.advanceTimersByTime(POST_SPEECH_DELAY_MS);
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SHOW_RESULTS',
      assessment: mockAssessment,
    });
  });

  it('does NOT dispatch SHOW_RESULTS before 2s delay after speech completes', async () => {
    await act(async () => {
      render(
        <CompletionScreen
          dispatch={mockDispatch}
          speechSystem={mockSpeech}
          assessment={mockAssessment}
        />
      );
    });

    // Advance less than the post-speech delay
    await act(async () => {
      vi.advanceTimersByTime(POST_SPEECH_DELAY_MS - 100);
    });

    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SHOW_RESULTS' })
    );
  });

  it('uses fallback path when speech system is unavailable', async () => {
    const unavailableSpeech = createMockSpeechSystem({ unavailable: true });

    await act(async () => {
      render(
        <CompletionScreen
          dispatch={mockDispatch}
          speechSystem={unavailableSpeech}
          assessment={mockAssessment}
        />
      );
    });

    // Should show on-screen completion message
    expect(screen.getByText(COMPLETION_MESSAGE)).toBeDefined();

    // Should NOT dispatch immediately
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SHOW_RESULTS' })
    );

    // Wait 5 seconds then dispatches
    await act(async () => {
      vi.advanceTimersByTime(NO_SPEECH_FALLBACK_DELAY_MS);
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SHOW_RESULTS',
      assessment: mockAssessment,
    });
  });

  it('uses fallback path when speech system is muted', async () => {
    const mutedSpeech = createMockSpeechSystem({ muted: true });

    await act(async () => {
      render(
        <CompletionScreen
          dispatch={mockDispatch}
          speechSystem={mutedSpeech}
          assessment={mockAssessment}
        />
      );
    });

    // Should show on-screen completion message
    expect(screen.getByText(COMPLETION_MESSAGE)).toBeDefined();

    // Wait 5 seconds then dispatches
    await act(async () => {
      vi.advanceTimersByTime(NO_SPEECH_FALLBACK_DELAY_MS);
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SHOW_RESULTS',
      assessment: mockAssessment,
    });
  });

  it('uses fallback path when no speech system is provided', async () => {
    await act(async () => {
      render(
        <CompletionScreen
          dispatch={mockDispatch}
          speechSystem={undefined}
          assessment={mockAssessment}
        />
      );
    });

    // Should show on-screen completion message
    expect(screen.getByText(COMPLETION_MESSAGE)).toBeDefined();

    // Wait 5 seconds then dispatches
    await act(async () => {
      vi.advanceTimersByTime(NO_SPEECH_FALLBACK_DELAY_MS);
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SHOW_RESULTS',
      assessment: mockAssessment,
    });
  });

  it('falls back to 5s delay when speech fails', async () => {
    const failingSpeech = createMockSpeechSystem({ failOnSpeak: true });

    await act(async () => {
      render(
        <CompletionScreen
          dispatch={mockDispatch}
          speechSystem={failingSpeech}
          assessment={mockAssessment}
        />
      );
    });

    // Should show on-screen message after failure
    expect(screen.getByText(COMPLETION_MESSAGE)).toBeDefined();

    // Should not dispatch before 5s
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SHOW_RESULTS' })
    );

    // Wait 5 seconds then dispatches
    await act(async () => {
      vi.advanceTimersByTime(NO_SPEECH_FALLBACK_DELAY_MS);
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SHOW_RESULTS',
      assessment: mockAssessment,
    });
  });

  it('shows a waiting indicator while speech is playing', async () => {
    // Use a speech system that resolves after a delay to simulate speech duration
    const slowSpeech = createMockSpeechSystem();
    (slowSpeech.speak as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 3000))
    );

    await act(async () => {
      render(
        <CompletionScreen
          dispatch={mockDispatch}
          speechSystem={slowSpeech}
          assessment={mockAssessment}
        />
      );
    });

    expect(screen.getByText('Playing completion message…')).toBeDefined();
  });

  it('shows "Preparing results" text after speech completes but before SHOW_RESULTS', async () => {
    await act(async () => {
      render(
        <CompletionScreen
          dispatch={mockDispatch}
          speechSystem={mockSpeech}
          assessment={mockAssessment}
        />
      );
    });

    // Speech completes immediately in mock, transition to 'waiting' phase
    expect(screen.getByText('Preparing results…')).toBeDefined();
  });

  it('does not dispatch SHOW_RESULTS without assessment data', async () => {
    await act(async () => {
      render(
        <CompletionScreen
          dispatch={mockDispatch}
          speechSystem={mockSpeech}
          assessment={undefined}
        />
      );
    });

    await act(async () => {
      vi.advanceTimersByTime(POST_SPEECH_DELAY_MS);
    });

    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SHOW_RESULTS' })
    );
  });
});
