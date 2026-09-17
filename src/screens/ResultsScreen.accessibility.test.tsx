import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { ResultsScreen } from './ResultsScreen';
import type {
  PronatorDriftAssessment,
  IndicatorKey,
  TimeSeriesIndicator,
  MicroMovementIndicators,
} from '../types/index';
import type { RecordingResult } from '../analysis/RecordingManager';

/**
 * Unit tests for Results screen rendering and accessibility (Task 13.7).
 *
 * Covers:
 * - Playback/delete controls have accessible names and keyboard operability (Req 12.1, 12.2, 19.2)
 * - "No recording available" state renders (Req 12.3)
 * - Plots have text alternatives (Req 13.4, 19.4)
 * - Medical disclaimer preserved (Req 13.3, 13.5)
 * - Classification announced via aria-live (Req 19.1, 19.3)
 * - Pose-only markers render (Req 15.5)
 * - Reduced-reliability note renders (Req 17.4)
 */

const ALL_INDICATOR_KEYS: IndicatorKey[] = [
  'wristDrift',
  'elbowDrift',
  'elbowFlexionChange',
  'armToTorsoChange',
  'palmRotationChange',
  'wristTremorAmplitude',
  'fingertipTremorAmplitude',
  'wristTremorDominantFrequency',
  'stability',
  'fingerCurlChange',
  'fingerSpreadChange',
];

/** Builds a single measurable time-series indicator with a few samples. */
function makeIndicator(
  key: IndicatorKey,
  overrides: Partial<TimeSeriesIndicator> = {}
): TimeSeriesIndicator {
  return {
    key,
    measurable: true,
    poseOnly: false,
    samples: [
      { timestamp: 0, value: 0.1 },
      { timestamp: 1000, value: 0.3 },
      { timestamp: 2000, value: 0.2 },
    ],
    summary: {
      mean: 0.2,
      max: 0.3,
      standardDeviation: 0.1,
      validFrameCount: 3,
    },
    unit: 'ratio',
    ...overrides,
  };
}

/** Builds a full MicroMovementIndicators object with all keys populated. */
function makeIndicators(
  overrides: Partial<MicroMovementIndicators> = {}
): MicroMovementIndicators {
  const base = {} as Record<IndicatorKey, TimeSeriesIndicator>;
  for (const key of ALL_INDICATOR_KEYS) {
    base[key] = makeIndicator(key);
  }

  return {
    assessedArm: 'left',
    ...base,
    maxElbowFlexionChangeDegrees: 3,
    maxArmToTorsoChangeDegrees: 2,
    totalPalmRotationChangeDegrees: 10,
    possiblePronation: false,
    supinationToPronationTrend: false,
    sustainedDrift: false,
    sustainedDriftDurationMs: 0,
    dominantFrequencyBandwidthLimited: false,
    usedPoseOnlyPath: false,
    ...overrides,
  } as MicroMovementIndicators;
}

/** Builds a valid PronatorDriftAssessment with sensible defaults. */
function makeAssessment(
  overrides: Partial<PronatorDriftAssessment> = {}
): PronatorDriftAssessment {
  return {
    assessmentId: 'test-uuid-13-7',
    startedAt: '2024-01-01T12:00:00Z',
    completedAt: '2024-01-01T12:00:30Z',
    durationSeconds: 30,
    deviceType: 'desktop',
    orientation: 'portrait',
    modelVersions: {
      poseModel: '1.0.0',
      handModel: '1.0.0',
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
    ...overrides,
  };
}

/** Builds a playable recording fixture. */
function makeRecording(
  overrides: Partial<RecordingResult> = {}
): RecordingResult {
  return {
    status: 'recorded',
    blob: {} as Blob,
    objectUrl: 'blob:x',
    mimeType: 'video/webm',
    ...overrides,
  };
}

describe('ResultsScreen accessibility & rendering (Task 13.7)', () => {
  const mockDispatch = vi.fn();

  beforeEach(() => {
    mockDispatch.mockClear();
    cleanup();
  });

  describe('Playback and delete controls (Req 12.1, 12.2, 19.2)', () => {
    it('renders a video with accessible name "Recorded assessment video" when a playable recording is present', () => {
      const assessment = makeAssessment();
      render(
        <ResultsScreen
          dispatch={mockDispatch}
          assessment={assessment}
          recording={makeRecording()}
        />
      );

      // The video element carries an accessible name via aria-label.
      const video = screen.getByTestId('recording-video');
      expect(video.tagName.toLowerCase()).toBe('video');
      expect(video.getAttribute('aria-label')).toBe('Recorded assessment video');
    });

    it('delete control has accessible name "Delete recorded video" and is a native, keyboard-operable button', () => {
      const assessment = makeAssessment();
      render(
        <ResultsScreen
          dispatch={mockDispatch}
          assessment={assessment}
          recording={makeRecording()}
        />
      );

      const deleteBtn = screen.getByTestId('delete-recording-btn');
      // Native <button> is keyboard operable (focusable + Enter/Space activate).
      expect(deleteBtn.tagName.toLowerCase()).toBe('button');
      expect(deleteBtn.getAttribute('type')).toBe('button');
      // Accessible name resolves via getByRole with name
      expect(
        screen.getByRole('button', { name: 'Delete recorded video' })
      ).toBe(deleteBtn);
    });

    it('clicking delete invokes onDeleteRecording and shows the "no recording available" state (Req 12.3)', () => {
      const assessment = makeAssessment();
      const onDeleteRecording = vi.fn();
      render(
        <ResultsScreen
          dispatch={mockDispatch}
          assessment={assessment}
          recording={makeRecording()}
          onDeleteRecording={onDeleteRecording}
        />
      );

      expect(screen.queryByTestId('no-recording')).toBeNull();

      fireEvent.click(screen.getByTestId('delete-recording-btn'));

      expect(onDeleteRecording).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('no-recording')).toBeTruthy();
      // Video and delete controls are gone after deletion
      expect(screen.queryByTestId('recording-video')).toBeNull();
      expect(screen.queryByTestId('delete-recording-btn')).toBeNull();
    });
  });

  describe('No recording available state (Req 12.3)', () => {
    it('renders no-recording when recording is undefined and still renders the rest of the results', () => {
      const assessment = makeAssessment();
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);

      expect(screen.getByTestId('no-recording')).toBeTruthy();
      // Remaining results render normally
      expect(screen.getByTestId('classification-announcement')).toBeTruthy();
      expect(screen.getByTestId('screening-not-diagnosis')).toBeTruthy();
      expect(
        screen.getByRole('button', { name: 'Repeat Assessment' })
      ).toBeTruthy();
    });

    it('renders no-recording when recording status is "skipped"', () => {
      const assessment = makeAssessment();
      render(
        <ResultsScreen
          dispatch={mockDispatch}
          assessment={assessment}
          recording={makeRecording({
            status: 'skipped',
            blob: null,
            objectUrl: null,
            mimeType: null,
            reason: 'unsupported',
          })}
        />
      );

      expect(screen.getByTestId('no-recording')).toBeTruthy();
      expect(screen.queryByTestId('recording-video')).toBeNull();
    });
  });

  describe('Plots have text alternatives (Req 13.4, 19.4)', () => {
    it('renders role="img" plot elements each with a descriptive aria-label and a visible summary paragraph', () => {
      const assessment = makeAssessment({ indicators: makeIndicators() });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);

      const plots = screen.getAllByRole('img');
      expect(plots.length).toBeGreaterThan(0);

      for (const plot of plots) {
        const label = plot.getAttribute('aria-label');
        expect(label).toBeTruthy();
        // The alternative text describes the indicator timeline
        expect(label!.toLowerCase()).toContain('timeline');
      }

      // Visible summary text alternative describing the wrist drift plot
      expect(
        screen.getByText(/Timeline of wrist drift over the 30-second window/i)
      ).toBeTruthy();
    });
  });

  describe('Medical disclaimer preserved (Req 13.3, 13.5)', () => {
    it('always renders the medical disclaimer text', () => {
      const assessment = makeAssessment();
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);

      expect(
        screen.getByText(/does not constitute a medical diagnosis/i)
      ).toBeTruthy();
    });
  });

  describe('Classification announced via aria-live (Req 19.1, 19.3)', () => {
    it('classification-announcement region has role="status", aria-live="polite", and contains the classification text', () => {
      const assessment = makeAssessment({
        overallClassification: 'possible_left_pronator_drift',
      });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);

      const region = screen.getByTestId('classification-announcement');
      expect(region.getAttribute('role')).toBe('status');
      expect(region.getAttribute('aria-live')).toBe('polite');
      expect(
        within(region).getByText(
          'Possible pronator drift was observed in the left arm'
        )
      ).toBeTruthy();
    });
  });

  describe('Pose-only markers (Req 15.5)', () => {
    it('renders the pose-only note and a pose-only badge when the pose-only path was used', () => {
      const indicators = makeIndicators({
        usedPoseOnlyPath: true,
        // Mark wristDrift as pose-only so its badge renders in the list.
        wristDrift: makeIndicator('wristDrift', { poseOnly: true }),
      });
      const assessment = makeAssessment({ indicators });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);

      expect(screen.getByTestId('pose-only-note')).toBeTruthy();
      expect(screen.getByTestId('pose-only-wristDrift')).toBeTruthy();
    });
  });

  describe('Reduced-reliability note (Req 17.4)', () => {
    it('renders the reduced-reliability note when frameRateBelowMinimum is true', () => {
      const assessment = makeAssessment({
        analysisMeta: {
          deliveredFrameCount: 100,
          droppedFrameCount: 40,
          effectiveFrameRate: 8,
          frameRateBelowMinimum: true,
          recordingStatus: 'recorded',
        },
      });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);

      expect(screen.getByTestId('reduced-reliability-note')).toBeTruthy();
    });

    it('does not render the reduced-reliability note when frame rate is adequate', () => {
      const assessment = makeAssessment({
        analysisMeta: {
          deliveredFrameCount: 300,
          droppedFrameCount: 0,
          effectiveFrameRate: 30,
          frameRateBelowMinimum: false,
          recordingStatus: 'recorded',
        },
      });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);

      expect(screen.queryByTestId('reduced-reliability-note')).toBeNull();
    });
  });
});
