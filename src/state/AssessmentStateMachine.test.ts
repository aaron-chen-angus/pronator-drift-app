import { describe, it, expect } from 'vitest';
import { assessmentReducer, initialState } from './AssessmentStateMachine';
import type { AppState } from '../types/index';
import type { Baseline } from '../types/index';

// Helper to create a minimal baseline for testing
function makeBaseline(): Baseline {
  const armBaseline = {
    shoulderPos: { x: 0, y: 0, z: 0 },
    elbowPos: { x: 0.1, y: 0, z: 0 },
    wristPos: { x: 0.2, y: 0, z: 0 },
    normalizedWristHeight: 0.5,
    elbowExtensionAngle: 170,
    palmOrientationAngle: 10,
    armLength: 0.4,
  };
  return {
    leftArm: armBaseline,
    rightArm: armBaseline,
    torsoAngle: 0,
    shoulderWidth: 0.3,
    captureFrameCount: 60,
    captureStartTime: 0,
    captureEndTime: 2500,
  };
}

describe('AssessmentStateMachine', () => {
  describe('initial state', () => {
    it('starts on the welcome screen', () => {
      expect(initialState).toEqual({ screen: 'welcome' });
    });
  });

  describe('welcome screen transitions', () => {
    const state: AppState = { screen: 'welcome' };

    it('START_ASSESSMENT → safetyConfirmation', () => {
      const next = assessmentReducer(state, { type: 'START_ASSESSMENT' });
      expect(next.screen).toBe('safetyConfirmation');
      if (next.screen === 'safetyConfirmation') {
        expect(next.confirmed).toBeInstanceOf(Set);
        expect(next.confirmed.size).toBe(0);
      }
    });

    it('SHOW_HOW_IT_WORKS → howItWorks', () => {
      const next = assessmentReducer(state, { type: 'SHOW_HOW_IT_WORKS' });
      expect(next.screen).toBe('howItWorks');
    });

    it('ignores invalid events', () => {
      const next = assessmentReducer(state, { type: 'CAMERA_READY' });
      expect(next).toBe(state);
    });
  });

  describe('howItWorks screen transitions', () => {
    const state: AppState = { screen: 'howItWorks' };

    it('BACK_TO_WELCOME → welcome', () => {
      const next = assessmentReducer(state, { type: 'BACK_TO_WELCOME' });
      expect(next.screen).toBe('welcome');
    });

    it('ignores invalid events', () => {
      const next = assessmentReducer(state, { type: 'START_ASSESSMENT' });
      expect(next).toBe(state);
    });
  });

  describe('safetyConfirmation screen transitions', () => {
    const state: AppState = { screen: 'safetyConfirmation', confirmed: new Set(['a', 'b']) };

    it('SAFETY_CONFIRMED → cameraSetup (requesting)', () => {
      const next = assessmentReducer(state, { type: 'SAFETY_CONFIRMED' });
      expect(next.screen).toBe('cameraSetup');
      if (next.screen === 'cameraSetup') {
        expect(next.cameraStatus).toBe('requesting');
      }
    });

    it('EXIT_ASSESSMENT → welcome', () => {
      const next = assessmentReducer(state, { type: 'EXIT_ASSESSMENT' });
      expect(next.screen).toBe('welcome');
    });

    it('ignores invalid events', () => {
      const next = assessmentReducer(state, { type: 'CAMERA_READY' });
      expect(next).toBe(state);
    });
  });

  describe('cameraSetup screen transitions', () => {
    const state: AppState = { screen: 'cameraSetup', cameraStatus: 'requesting' };

    it('CAMERA_READY → cameraSetup (active)', () => {
      const next = assessmentReducer(state, { type: 'CAMERA_READY' });
      expect(next.screen).toBe('cameraSetup');
      if (next.screen === 'cameraSetup') {
        expect(next.cameraStatus).toBe('active');
      }
    });

    it('ALL_CHECKS_PASS → instruction', () => {
      const next = assessmentReducer(state, { type: 'ALL_CHECKS_PASS' });
      expect(next.screen).toBe('instruction');
    });

    it('ignores invalid events', () => {
      const next = assessmentReducer(state, { type: 'START_ASSESSMENT' });
      expect(next).toBe(state);
    });
  });

  describe('instruction screen transitions', () => {
    const state: AppState = { screen: 'instruction' };

    it('CONTINUE_TO_POSITION → positionValidation', () => {
      const next = assessmentReducer(state, { type: 'CONTINUE_TO_POSITION' });
      expect(next.screen).toBe('positionValidation');
      if (next.screen === 'positionValidation') {
        expect(next.validation.isValid).toBe(false);
        expect(next.validation.holdProgress).toBe(0);
      }
    });

    it('REPLAY_INSTRUCTIONS → instruction (stays)', () => {
      const next = assessmentReducer(state, { type: 'REPLAY_INSTRUCTIONS' });
      expect(next.screen).toBe('instruction');
    });

    it('ignores invalid events', () => {
      const next = assessmentReducer(state, { type: 'CAMERA_READY' });
      expect(next).toBe(state);
    });
  });

  describe('positionValidation screen transitions', () => {
    const state: AppState = {
      screen: 'positionValidation',
      validation: { isValid: false, checks: [], highestPriorityFail: null, holdProgress: 0.5 },
    };

    it('POSITION_VALID → calibration', () => {
      const next = assessmentReducer(state, { type: 'POSITION_VALID' });
      expect(next.screen).toBe('calibration');
      if (next.screen === 'calibration') {
        expect(next.progress).toBe(0);
      }
    });

    it('POSITION_TIMEOUT → instruction', () => {
      const next = assessmentReducer(state, { type: 'POSITION_TIMEOUT' });
      expect(next.screen).toBe('instruction');
    });

    it('REPLAY_INSTRUCTIONS → instruction', () => {
      const next = assessmentReducer(state, { type: 'REPLAY_INSTRUCTIONS' });
      expect(next.screen).toBe('instruction');
    });

    it('EXIT_ASSESSMENT → welcome', () => {
      const next = assessmentReducer(state, { type: 'EXIT_ASSESSMENT' });
      expect(next.screen).toBe('welcome');
    });

    it('ignores invalid events', () => {
      const next = assessmentReducer(state, { type: 'START_ASSESSMENT' });
      expect(next).toBe(state);
    });
  });

  describe('calibration screen transitions', () => {
    const state: AppState = { screen: 'calibration', progress: 0.5 };

    it('CALIBRATION_COMPLETE → assessmentStart (position phase)', () => {
      const next = assessmentReducer(state, {
        type: 'CALIBRATION_COMPLETE',
        baseline: makeBaseline(),
      });
      expect(next.screen).toBe('assessmentStart');
      if (next.screen === 'assessmentStart') {
        expect(next.speechPhase).toBe('position');
      }
    });

    it('CALIBRATION_FAILED → positionValidation (retry)', () => {
      const next = assessmentReducer(state, {
        type: 'CALIBRATION_FAILED',
        reason: 'unstable_position',
      });
      expect(next.screen).toBe('positionValidation');
    });

    it('ignores invalid events', () => {
      const next = assessmentReducer(state, { type: 'START_ASSESSMENT' });
      expect(next).toBe(state);
    });
  });

  describe('assessmentStart screen transitions', () => {
    it('SPEECH_COMPLETE (position phase) → assessmentStart (eyes_closed phase)', () => {
      const state: AppState = { screen: 'assessmentStart', speechPhase: 'position' };
      const next = assessmentReducer(state, { type: 'SPEECH_COMPLETE', phase: 'position' });
      expect(next.screen).toBe('assessmentStart');
      if (next.screen === 'assessmentStart') {
        expect(next.speechPhase).toBe('eyes_closed');
      }
    });

    it('SPEECH_COMPLETE (eyes_closed phase) → assessment', () => {
      const state: AppState = { screen: 'assessmentStart', speechPhase: 'eyes_closed' };
      const next = assessmentReducer(state, { type: 'SPEECH_COMPLETE', phase: 'eyes_closed' });
      expect(next.screen).toBe('assessment');
      if (next.screen === 'assessment') {
        expect(next.elapsed).toBe(0);
        expect(next.timeRemaining).toBe(30);
      }
    });

    it('ignores invalid events', () => {
      const state: AppState = { screen: 'assessmentStart', speechPhase: 'position' };
      const next = assessmentReducer(state, { type: 'START_ASSESSMENT' });
      expect(next).toBe(state);
    });
  });

  describe('assessment screen transitions', () => {
    const state: AppState = { screen: 'assessment', elapsed: 10, timeRemaining: 20 };

    it('ASSESSMENT_TICK updates elapsed and timeRemaining', () => {
      const next = assessmentReducer(state, { type: 'ASSESSMENT_TICK', elapsed: 15 });
      expect(next.screen).toBe('assessment');
      if (next.screen === 'assessment') {
        expect(next.elapsed).toBe(15);
        expect(next.timeRemaining).toBe(15);
      }
    });

    it('ASSESSMENT_COMPLETE → completion', () => {
      const next = assessmentReducer(state, { type: 'ASSESSMENT_COMPLETE' });
      expect(next.screen).toBe('completion');
      if (next.screen === 'completion') {
        expect(next.speechPlaying).toBe(true);
      }
    });

    it('TRACKING_LOST → failure', () => {
      const next = assessmentReducer(state, {
        type: 'TRACKING_LOST',
        reason: 'Both hands lost for too long',
      });
      expect(next.screen).toBe('failure');
      if (next.screen === 'failure') {
        expect(next.reason).toBe('Both hands lost for too long');
      }
    });

    it('CAMERA_LOST → failure', () => {
      const next = assessmentReducer(state, { type: 'CAMERA_LOST' });
      expect(next.screen).toBe('failure');
      if (next.screen === 'failure') {
        expect(next.reason).toBe('Camera access was interrupted');
      }
    });

    it('TAB_HIDDEN → failure', () => {
      const next = assessmentReducer(state, { type: 'TAB_HIDDEN' });
      expect(next.screen).toBe('failure');
      if (next.screen === 'failure') {
        expect(next.reason).toBe('Browser tab lost visibility');
      }
    });

    it('ORIENTATION_CHANGED → failure', () => {
      const next = assessmentReducer(state, { type: 'ORIENTATION_CHANGED' });
      expect(next.screen).toBe('failure');
      if (next.screen === 'failure') {
        expect(next.reason).toBe('Device orientation changed');
      }
    });

    it('USER_STOP → failure', () => {
      const next = assessmentReducer(state, { type: 'USER_STOP' });
      expect(next.screen).toBe('failure');
      if (next.screen === 'failure') {
        expect(next.reason).toBe('Assessment stopped by user');
      }
    });

    it('ignores invalid events', () => {
      const next = assessmentReducer(state, { type: 'START_ASSESSMENT' });
      expect(next).toBe(state);
    });
  });

  describe('completion screen transitions', () => {
    const state: AppState = { screen: 'completion', speechPlaying: true };

    it('SPEECH_COMPLETE → completion (speechPlaying: false)', () => {
      const next = assessmentReducer(state, { type: 'SPEECH_COMPLETE', phase: 'completion' });
      expect(next.screen).toBe('completion');
      if (next.screen === 'completion') {
        expect(next.speechPlaying).toBe(false);
      }
    });

    it('SHOW_RESULTS → results', () => {
      const assessment = {
        assessmentId: 'test-123',
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T00:00:30Z',
        durationSeconds: 30,
        deviceType: 'desktop' as const,
        orientation: 'portrait' as const,
        modelVersions: { poseModel: 'v1', handModel: 'v1' },
        quality: {
          overall: 'good' as const,
          metrics: {
            validFramePercentage: 95,
            avgPoseConfidence: 0.9,
            avgLeftHandConfidence: 0.85,
            avgRightHandConfidence: 0.85,
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
          estimatedPalmRotationChangeDegrees: 3,
          possiblePronation: false,
          sustainedDownwardDrift: false,
          confidence: 0.9,
        },
        rightArm: {
          baselineWristHeight: 0.5,
          maximumDownwardDriftNormalised: 0.01,
          driftDurationMilliseconds: 0,
          driftOnsetSeconds: null,
          maximumElbowFlexionChangeDegrees: 2,
          estimatedPalmRotationChangeDegrees: 3,
          possiblePronation: false,
          sustainedDownwardDrift: false,
          confidence: 0.9,
        },
        overallClassification: 'no_significant_drift' as const,
      };

      const next = assessmentReducer(state, { type: 'SHOW_RESULTS', assessment });
      expect(next.screen).toBe('results');
      if (next.screen === 'results') {
        expect(next.assessment.assessmentId).toBe('test-123');
      }
    });

    it('ignores invalid events', () => {
      const next = assessmentReducer(state, { type: 'START_ASSESSMENT' });
      expect(next).toBe(state);
    });
  });

  describe('failure screen transitions', () => {
    const state: AppState = { screen: 'failure', reason: 'Tracking lost' };

    it('REPEAT_ASSESSMENT → cameraSetup', () => {
      const next = assessmentReducer(state, { type: 'REPEAT_ASSESSMENT' });
      expect(next.screen).toBe('cameraSetup');
      if (next.screen === 'cameraSetup') {
        expect(next.cameraStatus).toBe('requesting');
      }
    });

    it('RETURN_HOME → welcome', () => {
      const next = assessmentReducer(state, { type: 'RETURN_HOME' });
      expect(next.screen).toBe('welcome');
    });

    it('SPEECH_COMPLETE stays on failure (waiting for user choice)', () => {
      const next = assessmentReducer(state, { type: 'SPEECH_COMPLETE', phase: 'failure' });
      expect(next).toBe(state);
    });

    it('ignores invalid events', () => {
      const next = assessmentReducer(state, { type: 'ALL_CHECKS_PASS' });
      expect(next).toBe(state);
    });
  });

  describe('results screen transitions', () => {
    const state: AppState = {
      screen: 'results',
      assessment: {
        assessmentId: 'test-123',
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T00:00:30Z',
        durationSeconds: 30,
        deviceType: 'desktop',
        orientation: 'portrait',
        modelVersions: { poseModel: 'v1', handModel: 'v1' },
        quality: {
          overall: 'good',
          metrics: {
            validFramePercentage: 95,
            avgPoseConfidence: 0.9,
            avgLeftHandConfidence: 0.85,
            avgRightHandConfidence: 0.85,
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
          estimatedPalmRotationChangeDegrees: 3,
          possiblePronation: false,
          sustainedDownwardDrift: false,
          confidence: 0.9,
        },
        rightArm: {
          baselineWristHeight: 0.5,
          maximumDownwardDriftNormalised: 0.01,
          driftDurationMilliseconds: 0,
          driftOnsetSeconds: null,
          maximumElbowFlexionChangeDegrees: 2,
          estimatedPalmRotationChangeDegrees: 3,
          possiblePronation: false,
          sustainedDownwardDrift: false,
          confidence: 0.9,
        },
        overallClassification: 'no_significant_drift',
      },
    };

    it('RETURN_HOME → welcome', () => {
      const next = assessmentReducer(state, { type: 'RETURN_HOME' });
      expect(next.screen).toBe('welcome');
    });

    it('REPEAT_ASSESSMENT → cameraSetup', () => {
      const next = assessmentReducer(state, { type: 'REPEAT_ASSESSMENT' });
      expect(next.screen).toBe('cameraSetup');
      if (next.screen === 'cameraSetup') {
        expect(next.cameraStatus).toBe('requesting');
      }
    });

    it('ignores invalid events', () => {
      const next = assessmentReducer(state, { type: 'START_ASSESSMENT' });
      expect(next).toBe(state);
    });
  });

  describe('strict workflow enforcement', () => {
    it('START_ASSESSMENT only works from welcome', () => {
      const screens: AppState[] = [
        { screen: 'howItWorks' },
        { screen: 'safetyConfirmation', confirmed: new Set() },
        { screen: 'cameraSetup', cameraStatus: 'active' },
        { screen: 'instruction' },
        { screen: 'positionValidation', validation: { isValid: false, checks: [], highestPriorityFail: null, holdProgress: 0 } },
        { screen: 'calibration', progress: 0 },
        { screen: 'assessment', elapsed: 0, timeRemaining: 30 },
        { screen: 'failure', reason: 'test' },
      ];

      for (const s of screens) {
        const next = assessmentReducer(s, { type: 'START_ASSESSMENT' });
        expect(next).toBe(s);
      }
    });

    it('SAFETY_CONFIRMED only works from safetyConfirmation', () => {
      const screens: AppState[] = [
        { screen: 'welcome' },
        { screen: 'howItWorks' },
        { screen: 'cameraSetup', cameraStatus: 'active' },
        { screen: 'instruction' },
        { screen: 'assessment', elapsed: 0, timeRemaining: 30 },
      ];

      for (const s of screens) {
        const next = assessmentReducer(s, { type: 'SAFETY_CONFIRMED' });
        expect(next).toBe(s);
      }
    });

    it('ASSESSMENT_COMPLETE only works from assessment', () => {
      const screens: AppState[] = [
        { screen: 'welcome' },
        { screen: 'cameraSetup', cameraStatus: 'active' },
        { screen: 'instruction' },
        { screen: 'calibration', progress: 0 },
        { screen: 'assessmentStart', speechPhase: 'position' },
        { screen: 'completion', speechPlaying: true },
        { screen: 'failure', reason: 'test' },
      ];

      for (const s of screens) {
        const next = assessmentReducer(s, { type: 'ASSESSMENT_COMPLETE' });
        expect(next).toBe(s);
      }
    });

    it('SHOW_RESULTS only works from completion', () => {
      const assessment = {
        assessmentId: 'test-123',
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T00:00:30Z',
        durationSeconds: 30,
        deviceType: 'desktop' as const,
        orientation: 'portrait' as const,
        modelVersions: { poseModel: 'v1', handModel: 'v1' },
        quality: {
          overall: 'good' as const,
          metrics: {
            validFramePercentage: 95,
            avgPoseConfidence: 0.9,
            avgLeftHandConfidence: 0.85,
            avgRightHandConfidence: 0.85,
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
          estimatedPalmRotationChangeDegrees: 3,
          possiblePronation: false,
          sustainedDownwardDrift: false,
          confidence: 0.9,
        },
        rightArm: {
          baselineWristHeight: 0.5,
          maximumDownwardDriftNormalised: 0.01,
          driftDurationMilliseconds: 0,
          driftOnsetSeconds: null,
          maximumElbowFlexionChangeDegrees: 2,
          estimatedPalmRotationChangeDegrees: 3,
          possiblePronation: false,
          sustainedDownwardDrift: false,
          confidence: 0.9,
        },
        overallClassification: 'no_significant_drift' as const,
      };

      const screens: AppState[] = [
        { screen: 'welcome' },
        { screen: 'cameraSetup', cameraStatus: 'active' },
        { screen: 'instruction' },
        { screen: 'assessment', elapsed: 0, timeRemaining: 30 },
        { screen: 'failure', reason: 'test' },
      ];

      for (const s of screens) {
        const next = assessmentReducer(s, { type: 'SHOW_RESULTS', assessment });
        expect(next).toBe(s);
      }
    });

    it('failure events only transition from assessment', () => {
      const failureEvents = [
        { type: 'TRACKING_LOST' as const, reason: 'Lost tracking' },
        { type: 'CAMERA_LOST' as const },
        { type: 'TAB_HIDDEN' as const },
        { type: 'ORIENTATION_CHANGED' as const },
        { type: 'USER_STOP' as const },
      ];

      const screens: AppState[] = [
        { screen: 'welcome' },
        { screen: 'cameraSetup', cameraStatus: 'active' },
        { screen: 'instruction' },
        { screen: 'calibration', progress: 0 },
        { screen: 'completion', speechPlaying: true },
      ];

      for (const s of screens) {
        for (const event of failureEvents) {
          const next = assessmentReducer(s, event);
          expect(next).toBe(s);
        }
      }
    });

    it('REPEAT_ASSESSMENT only works from failure and results', () => {
      const screens: AppState[] = [
        { screen: 'welcome' },
        { screen: 'cameraSetup', cameraStatus: 'active' },
        { screen: 'instruction' },
        { screen: 'assessment', elapsed: 0, timeRemaining: 30 },
        { screen: 'completion', speechPlaying: true },
      ];

      for (const s of screens) {
        const next = assessmentReducer(s, { type: 'REPEAT_ASSESSMENT' });
        expect(next).toBe(s);
      }
    });

    it('RETURN_HOME only works from failure and results', () => {
      const screens: AppState[] = [
        { screen: 'welcome' },
        { screen: 'cameraSetup', cameraStatus: 'active' },
        { screen: 'instruction' },
        { screen: 'assessment', elapsed: 0, timeRemaining: 30 },
        { screen: 'completion', speechPlaying: true },
      ];

      for (const s of screens) {
        const next = assessmentReducer(s, { type: 'RETURN_HOME' });
        expect(next).toBe(s);
      }
    });

    it('timeRemaining never goes below 0', () => {
      const state: AppState = { screen: 'assessment', elapsed: 0, timeRemaining: 30 };
      const next = assessmentReducer(state, { type: 'ASSESSMENT_TICK', elapsed: 35 });
      if (next.screen === 'assessment') {
        expect(next.timeRemaining).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('full happy-path workflow', () => {
    it('traverses the complete workflow from welcome to results', () => {
      let state: AppState = initialState;

      // Welcome → SafetyConfirmation
      state = assessmentReducer(state, { type: 'START_ASSESSMENT' });
      expect(state.screen).toBe('safetyConfirmation');

      // SafetyConfirmation → CameraSetup
      state = assessmentReducer(state, { type: 'SAFETY_CONFIRMED' });
      expect(state.screen).toBe('cameraSetup');

      // Camera becomes active
      state = assessmentReducer(state, { type: 'CAMERA_READY' });
      expect(state.screen).toBe('cameraSetup');
      if (state.screen === 'cameraSetup') expect(state.cameraStatus).toBe('active');

      // CameraSetup → Instruction
      state = assessmentReducer(state, { type: 'ALL_CHECKS_PASS' });
      expect(state.screen).toBe('instruction');

      // Instruction → PositionValidation
      state = assessmentReducer(state, { type: 'CONTINUE_TO_POSITION' });
      expect(state.screen).toBe('positionValidation');

      // PositionValidation → Calibration
      state = assessmentReducer(state, { type: 'POSITION_VALID' });
      expect(state.screen).toBe('calibration');

      // Calibration → AssessmentStart
      state = assessmentReducer(state, {
        type: 'CALIBRATION_COMPLETE',
        baseline: makeBaseline(),
      });
      expect(state.screen).toBe('assessmentStart');

      // AssessmentStart (position phase) → AssessmentStart (eyes_closed phase)
      state = assessmentReducer(state, { type: 'SPEECH_COMPLETE', phase: 'position' });
      expect(state.screen).toBe('assessmentStart');
      if (state.screen === 'assessmentStart') expect(state.speechPhase).toBe('eyes_closed');

      // AssessmentStart (eyes_closed phase) → Assessment
      state = assessmentReducer(state, { type: 'SPEECH_COMPLETE', phase: 'eyes_closed' });
      expect(state.screen).toBe('assessment');

      // Assessment ticks
      state = assessmentReducer(state, { type: 'ASSESSMENT_TICK', elapsed: 15 });
      if (state.screen === 'assessment') {
        expect(state.elapsed).toBe(15);
        expect(state.timeRemaining).toBe(15);
      }

      // Assessment completes
      state = assessmentReducer(state, { type: 'ASSESSMENT_COMPLETE' });
      expect(state.screen).toBe('completion');

      // Completion speech finishes
      state = assessmentReducer(state, { type: 'SPEECH_COMPLETE', phase: 'completion' });
      expect(state.screen).toBe('completion');
      if (state.screen === 'completion') expect(state.speechPlaying).toBe(false);

      // Completion → Results (via SHOW_RESULTS)
      const assessment = {
        assessmentId: 'happy-path-001',
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T00:00:30Z',
        durationSeconds: 30,
        deviceType: 'desktop' as const,
        orientation: 'portrait' as const,
        modelVersions: { poseModel: 'v1', handModel: 'v1' },
        quality: {
          overall: 'good' as const,
          metrics: {
            validFramePercentage: 95,
            avgPoseConfidence: 0.9,
            avgLeftHandConfidence: 0.85,
            avgRightHandConfidence: 0.85,
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
          estimatedPalmRotationChangeDegrees: 3,
          possiblePronation: false,
          sustainedDownwardDrift: false,
          confidence: 0.9,
        },
        rightArm: {
          baselineWristHeight: 0.5,
          maximumDownwardDriftNormalised: 0.01,
          driftDurationMilliseconds: 0,
          driftOnsetSeconds: null,
          maximumElbowFlexionChangeDegrees: 2,
          estimatedPalmRotationChangeDegrees: 3,
          possiblePronation: false,
          sustainedDownwardDrift: false,
          confidence: 0.9,
        },
        overallClassification: 'no_significant_drift' as const,
      };
      state = assessmentReducer(state, { type: 'SHOW_RESULTS', assessment });
      expect(state.screen).toBe('results');
      if (state.screen === 'results') {
        expect(state.assessment.assessmentId).toBe('happy-path-001');
      }

      // Results → Welcome (return home)
      state = assessmentReducer(state, { type: 'RETURN_HOME' });
      expect(state.screen).toBe('welcome');
    });

    it('traverses the failure recovery path back to assessment', () => {
      let state: AppState = initialState;

      // Get to assessment
      state = assessmentReducer(state, { type: 'START_ASSESSMENT' });
      state = assessmentReducer(state, { type: 'SAFETY_CONFIRMED' });
      state = assessmentReducer(state, { type: 'ALL_CHECKS_PASS' });
      state = assessmentReducer(state, { type: 'CONTINUE_TO_POSITION' });
      state = assessmentReducer(state, { type: 'POSITION_VALID' });
      state = assessmentReducer(state, { type: 'CALIBRATION_COMPLETE', baseline: makeBaseline() });
      state = assessmentReducer(state, { type: 'SPEECH_COMPLETE', phase: 'position' });
      state = assessmentReducer(state, { type: 'SPEECH_COMPLETE', phase: 'eyes_closed' });
      expect(state.screen).toBe('assessment');

      // Assessment fails due to tracking loss
      state = assessmentReducer(state, { type: 'TRACKING_LOST', reason: 'Both hands lost' });
      expect(state.screen).toBe('failure');
      if (state.screen === 'failure') {
        expect(state.reason).toBe('Both hands lost');
      }

      // User chooses to repeat
      state = assessmentReducer(state, { type: 'REPEAT_ASSESSMENT' });
      expect(state.screen).toBe('cameraSetup');
      if (state.screen === 'cameraSetup') {
        expect(state.cameraStatus).toBe('requesting');
      }
    });
  });
});
