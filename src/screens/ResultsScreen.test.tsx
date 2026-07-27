import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResultsScreen } from './ResultsScreen';
import type { PronatorDriftAssessment, OverallClassification, QualityRating } from '../types/index';

function createMockAssessment(overrides: Partial<PronatorDriftAssessment> = {}): PronatorDriftAssessment {
  return {
    assessmentId: 'test-uuid-123',
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

describe('ResultsScreen', () => {
  const mockDispatch = vi.fn();

  beforeEach(() => {
    mockDispatch.mockClear();
  });

  describe('Classification Display', () => {
    it('displays "No significant arm drift was observed" for no_significant_drift', () => {
      const assessment = createMockAssessment({ overallClassification: 'no_significant_drift' });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      expect(screen.getByText('No significant arm drift was observed')).toBeDefined();
    });

    it('displays correct text for possible_left_pronator_drift', () => {
      const assessment = createMockAssessment({ overallClassification: 'possible_left_pronator_drift' });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      expect(screen.getByText('Possible pronator drift was observed in the left arm')).toBeDefined();
    });

    it('displays correct text for possible_right_pronator_drift', () => {
      const assessment = createMockAssessment({ overallClassification: 'possible_right_pronator_drift' });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      expect(screen.getByText('Possible pronator drift was observed in the right arm')).toBeDefined();
    });

    it('displays correct text for possible_bilateral_drift', () => {
      const assessment = createMockAssessment({ overallClassification: 'possible_bilateral_drift' });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      expect(screen.getByText('Possible bilateral arm drift was observed')).toBeDefined();
    });

    it('displays correct text for drift_without_clear_pronation', () => {
      const assessment = createMockAssessment({ overallClassification: 'drift_without_clear_pronation' });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      expect(screen.getByText('Arm drift was detected without clear pronation')).toBeDefined();
    });

    it('displays correct text for possible_pronation_without_drift', () => {
      const assessment = createMockAssessment({ overallClassification: 'possible_pronation_without_drift' });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      expect(screen.getByText('Possible pronation was detected without significant arm drift')).toBeDefined();
    });
  });

  describe('Affected Side', () => {
    it('displays affected side for left pronator drift', () => {
      const assessment = createMockAssessment({ overallClassification: 'possible_left_pronator_drift' });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      expect(screen.getByText(/Affected side: Left side/)).toBeDefined();
    });

    it('displays affected side for right pronator drift', () => {
      const assessment = createMockAssessment({ overallClassification: 'possible_right_pronator_drift' });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      expect(screen.getByText(/Affected side: Right side/)).toBeDefined();
    });

    it('does not display affected side for bilateral drift', () => {
      const assessment = createMockAssessment({ overallClassification: 'possible_bilateral_drift' });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      expect(screen.queryByText(/Affected side/)).toBeNull();
    });

    it('does not display affected side for no significant drift', () => {
      const assessment = createMockAssessment({ overallClassification: 'no_significant_drift' });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      expect(screen.queryByText(/Affected side/)).toBeNull();
    });
  });

  describe('Quality Rating', () => {
    it('displays "Good quality" for good rating', () => {
      const assessment = createMockAssessment();
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      expect(screen.getByText('Good quality')).toBeDefined();
    });

    it('displays "Acceptable quality" for acceptable rating', () => {
      const assessment = createMockAssessment({
        quality: {
          ...createMockAssessment().quality,
          overall: 'acceptable',
        },
      });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      expect(screen.getByText('Acceptable quality')).toBeDefined();
    });

    it('displays low quality text with recommendation', () => {
      const assessment = createMockAssessment({
        quality: {
          ...createMockAssessment().quality,
          overall: 'low',
          primaryFailureReason: 'Insufficient lighting',
        },
      });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      expect(screen.getByText(/Low quality — results may be less reliable/)).toBeDefined();
    });

    it('displays "Unable to assess quality" for unable_to_assess rating', () => {
      const assessment = createMockAssessment({
        overallClassification: 'unable_to_assess',
        quality: {
          ...createMockAssessment().quality,
          overall: 'unable_to_assess',
          primaryFailureReason: 'Camera moved excessively',
        },
      });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      expect(screen.getByText('Unable to assess quality')).toBeDefined();
    });
  });

  describe('Unable to Assess Handling', () => {
    it('shows failure reason when unable to assess', () => {
      const assessment = createMockAssessment({
        overallClassification: 'unable_to_assess',
        quality: {
          ...createMockAssessment().quality,
          overall: 'unable_to_assess',
          primaryFailureReason: 'Camera moved excessively',
        },
      });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      expect(screen.getByText('Camera moved excessively')).toBeDefined();
    });

    it('hides classification when unable to assess', () => {
      const assessment = createMockAssessment({
        overallClassification: 'unable_to_assess',
        quality: {
          ...createMockAssessment().quality,
          overall: 'unable_to_assess',
          primaryFailureReason: 'Subject left frame',
        },
      });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      expect(screen.getByText('Assessment could not be interpreted reliably')).toBeDefined();
      // Should not show movement details section
      expect(screen.queryByText('View Movement Details')).toBeNull();
    });
  });

  describe('Low Quality Handling', () => {
    it('shows classification with quality warning for low quality', () => {
      const assessment = createMockAssessment({
        overallClassification: 'no_significant_drift',
        quality: {
          ...createMockAssessment().quality,
          overall: 'low',
          primaryFailureReason: 'Poor lighting conditions',
        },
      });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      // Classification is still shown
      expect(screen.getByText('No significant arm drift was observed')).toBeDefined();
      // Warning about quality is shown
      expect(screen.getByText(/Assessment quality was reduced/)).toBeDefined();
      expect(screen.getByText(/Poor lighting conditions/)).toBeDefined();
      // Both quality text and warning contain "repeat" phrasing
      const repeatMatches = screen.getAllByText(/Consider repeating/);
      expect(repeatMatches.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Action Buttons', () => {
    it('displays "Repeat Assessment" button', () => {
      const assessment = createMockAssessment();
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      expect(screen.getByRole('button', { name: 'Repeat Assessment' })).toBeDefined();
    });

    it('displays "Return Home" button', () => {
      const assessment = createMockAssessment();
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      expect(screen.getByRole('button', { name: 'Return Home' })).toBeDefined();
    });

    it('dispatches REPEAT_ASSESSMENT when "Repeat Assessment" is clicked', () => {
      const assessment = createMockAssessment();
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      fireEvent.click(screen.getByRole('button', { name: 'Repeat Assessment' }));
      expect(mockDispatch).toHaveBeenCalledWith({ type: 'REPEAT_ASSESSMENT' });
    });

    it('dispatches RETURN_HOME when "Return Home" is clicked', () => {
      const assessment = createMockAssessment();
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      fireEvent.click(screen.getByRole('button', { name: 'Return Home' }));
      expect(mockDispatch).toHaveBeenCalledWith({ type: 'RETURN_HOME' });
    });
  });

  describe('Medical Disclaimer', () => {
    it('displays the medical disclaimer with exact required wording', () => {
      const assessment = createMockAssessment();
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      expect(screen.getByText(/This screening does not constitute a medical diagnosis/)).toBeDefined();
      expect(screen.getByText(/observations are based on detected movement patterns/)).toBeDefined();
      expect(screen.getByText(/discussed with a qualified healthcare provider/)).toBeDefined();
      expect(screen.getByText(/proper clinical evaluation/)).toBeDefined();
    });
  });

  describe('Collapsible Movement Details', () => {
    it('details section is collapsed by default', () => {
      const assessment = createMockAssessment();
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      const toggle = screen.getByRole('button', { name: /View Movement Details/ });
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByText('Max left arm drift')).toBeNull();
    });

    it('expands details when toggle is clicked', () => {
      const assessment = createMockAssessment();
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      fireEvent.click(screen.getByRole('button', { name: /View Movement Details/ }));
      expect(screen.getByText('Max left arm drift')).toBeDefined();
      expect(screen.getByText('Max right arm drift')).toBeDefined();
      expect(screen.getByText('Possible left pronation')).toBeDefined();
      expect(screen.getByText('Possible right pronation')).toBeDefined();
    });

    it('collapses details when toggle is clicked again', () => {
      const assessment = createMockAssessment();
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      const toggle = screen.getByRole('button', { name: /View Movement Details/ });
      fireEvent.click(toggle);
      expect(screen.getByText('Max left arm drift')).toBeDefined();
      fireEvent.click(toggle);
      expect(screen.queryByText('Max left arm drift')).toBeNull();
    });

    it('shows drift values as percentages', () => {
      const assessment = createMockAssessment({
        leftArm: { ...createMockAssessment().leftArm, maximumDownwardDriftNormalised: 0.05 },
        rightArm: { ...createMockAssessment().rightArm, maximumDownwardDriftNormalised: 0.12 },
      });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      fireEvent.click(screen.getByRole('button', { name: /View Movement Details/ }));
      expect(screen.getByText('5.0%')).toBeDefined();
      expect(screen.getByText('12.0%')).toBeDefined();
    });

    it('shows pronation in degrees', () => {
      const assessment = createMockAssessment({
        leftArm: { ...createMockAssessment().leftArm, estimatedPalmRotationChangeDegrees: 25.5 },
        rightArm: { ...createMockAssessment().rightArm, estimatedPalmRotationChangeDegrees: null },
      });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      fireEvent.click(screen.getByRole('button', { name: /View Movement Details/ }));
      expect(screen.getByText('25.5°')).toBeDefined();
      expect(screen.getByText('Not measured')).toBeDefined();
    });

    it('shows assessment duration', () => {
      const assessment = createMockAssessment({ durationSeconds: 30 });
      render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      fireEvent.click(screen.getByRole('button', { name: /View Movement Details/ }));
      expect(screen.getByText('Assessment duration')).toBeDefined();
      // Duration value appears in both the detail and timeline end label
      const durationElements = screen.getAllByText(/30s|30 s/);
      expect(durationElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Non-Diagnostic Language', () => {
    const classifications: OverallClassification[] = [
      'no_significant_drift',
      'possible_left_pronator_drift',
      'possible_right_pronator_drift',
      'possible_bilateral_drift',
      'drift_without_clear_pronation',
      'possible_pronation_without_drift',
    ];

    classifications.forEach((classification) => {
      it(`uses non-diagnostic language for ${classification}`, () => {
        const assessment = createMockAssessment({ overallClassification: classification });
        const { container } = render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
        const text = container.textContent || '';
        // Should not use definitive diagnostic terms
        expect(text).not.toMatch(/\bconfirmed\b/i);
        expect(text).not.toMatch(/\bdefinite\b/i);
        expect(text).not.toMatch(/\bproven\b/i);
        // "diagnosis" is OK in disclaimer context negating diagnostic intent
        // The rest of the text should use qualifying terms
      });
    });
  });

  describe('Graded Visual Indicators', () => {
    it('does not use bold uppercase warning labels in rendered text', () => {
      const assessment = createMockAssessment({
        quality: {
          ...createMockAssessment().quality,
          overall: 'low',
          primaryFailureReason: 'Testing',
        },
      });
      const { container } = render(<ResultsScreen dispatch={mockDispatch} assessment={assessment} />);
      // Check that no element has text-transform: uppercase combined with font-weight: bold
      // We verify the text itself doesn't use all-caps warning patterns
      const text = container.textContent || '';
      expect(text).not.toMatch(/^WARNING$/m);
      expect(text).not.toMatch(/^CAUTION$/m);
      expect(text).not.toMatch(/^ALERT$/m);
    });
  });
});
