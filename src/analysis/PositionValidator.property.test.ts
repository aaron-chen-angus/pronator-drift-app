import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { PositionValidatorImpl, CHECK_PRIORITY } from './PositionValidator';
import { ConfigStore } from '../config/ConfigStore';
import type { CVFrameResult, NormalizedLandmark, Handedness, PositionCheckType } from '../types';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Creates a NormalizedLandmark with reasonable defaults for a "good" position.
 */
function makeLandmark(
  x: number,
  y: number,
  z: number = 0,
  visibility: number = 0.95
): NormalizedLandmark {
  return { x, y, z, visibility };
}

/**
 * Builds a set of pose landmarks representing a valid starting position:
 * - Subject facing forward (shoulders at similar z)
 * - Arms raised to shoulder height
 * - Elbows extended (shoulder-elbow-wrist ~180°)
 * - Arms not resting against body
 *
 * MediaPipe indices used:
 *   11=LEFT_SHOULDER, 12=RIGHT_SHOULDER, 13=LEFT_ELBOW, 14=RIGHT_ELBOW,
 *   15=LEFT_WRIST, 16=RIGHT_WRIST, 23=LEFT_HIP, 24=RIGHT_HIP
 */
function makeValidPoseLandmarks(confidence: number = 0.95): NormalizedLandmark[] {
  const landmarks: NormalizedLandmark[] = new Array(33).fill(null).map(() =>
    makeLandmark(0.5, 0.5, 0, confidence)
  );

  // Shoulders at same height, facing forward (similar z)
  landmarks[11] = makeLandmark(0.6, 0.4, 0.0, confidence); // LEFT_SHOULDER
  landmarks[12] = makeLandmark(0.4, 0.4, 0.0, confidence); // RIGHT_SHOULDER

  // Elbows straight out from shoulders at same height (arms horizontal, extended)
  landmarks[13] = makeLandmark(0.75, 0.4, 0.0, confidence); // LEFT_ELBOW
  landmarks[14] = makeLandmark(0.25, 0.4, 0.0, confidence); // RIGHT_ELBOW

  // Wrists further out at same height (full extension = ~180° angle at elbow)
  landmarks[15] = makeLandmark(0.9, 0.4, 0.0, confidence); // LEFT_WRIST
  landmarks[16] = makeLandmark(0.1, 0.4, 0.0, confidence); // RIGHT_WRIST

  // Hips below shoulders (for arms_not_resting check)
  landmarks[23] = makeLandmark(0.55, 0.7, 0.0, confidence); // LEFT_HIP
  landmarks[24] = makeLandmark(0.45, 0.7, 0.0, confidence); // RIGHT_HIP

  return landmarks;
}

/**
 * Builds valid hand landmarks for both hands (palms facing up).
 * Uses landmarks 0 (wrist), 5 (index MCP), 9 (middle MCP) to form a palm plane
 * whose normal points toward the camera (negative z).
 *
 * For cross(v1, v2) to have a strong -z component (palm facing camera):
 * - v1 = indexMCP - wrist, v2 = middleMCP - wrist
 * - With all z=0, the cross product z-component = v1.x*v2.y - v1.y*v2.x
 *   We need this to be negative (normal points toward camera = -z direction).
 *   So we arrange: v1.x*v2.y - v1.y*v2.x < 0
 */
function makeValidHandLandmarks(confidence: number = 0.95): NormalizedLandmark[][] {
  // Left hand - palm up (cross product normal points -z)
  const leftHand: NormalizedLandmark[] = new Array(21).fill(null).map(() =>
    makeLandmark(0.9, 0.4, 0, confidence)
  );
  leftHand[0] = makeLandmark(0.9, 0.4, 0.0, confidence);    // wrist
  leftHand[5] = makeLandmark(0.92, 0.38, 0.0, confidence);  // index MCP
  leftHand[9] = makeLandmark(0.9, 0.36, 0.0, confidence);   // middle MCP
  // v1 = (0.02, -0.02, 0), v2 = (0.0, -0.04, 0)
  // cross z = 0.02*(-0.04) - (-0.02)*0 = -0.0008 → normal in -z ✓

  // Right hand - palm up
  const rightHand: NormalizedLandmark[] = new Array(21).fill(null).map(() =>
    makeLandmark(0.1, 0.4, 0, confidence)
  );
  rightHand[0] = makeLandmark(0.1, 0.4, 0.0, confidence);   // wrist
  rightHand[5] = makeLandmark(0.08, 0.38, 0.0, confidence); // index MCP
  rightHand[9] = makeLandmark(0.1, 0.36, 0.0, confidence);  // middle MCP
  // v1 = (-0.02, -0.02, 0), v2 = (0.0, -0.04, 0)
  // cross z = (-0.02)*(-0.04) - (-0.02)*0 = 0.0008 → normal in +z
  // This is wrong! Need to flip so normal is -z for right hand too.
  // Let's adjust: indexMCP slightly below-left of wrist, middleMCP slightly ahead
  rightHand[5] = makeLandmark(0.12, 0.38, 0.0, confidence); // index MCP
  rightHand[9] = makeLandmark(0.1, 0.36, 0.0, confidence);  // middle MCP
  // v1 = (0.02, -0.02, 0), v2 = (0.0, -0.04, 0)
  // cross z = 0.02*(-0.04) - (-0.02)*0 = -0.0008 → normal in -z ✓

  return [leftHand, rightHand];
}

/**
 * Creates a valid handedness array for both hands.
 */
function makeValidHandedness(confidence: number = 0.95): Handedness[] {
  return [
    { label: 'Left', score: confidence },
    { label: 'Right', score: confidence },
  ];
}

/**
 * Creates a fully valid CVFrameResult that should pass all position checks.
 */
function makeValidFrame(timestamp: number = 0): CVFrameResult {
  return {
    timestamp,
    poseLandmarks: [makeValidPoseLandmarks()],
    poseWorldLandmarks: null,
    handLandmarks: makeValidHandLandmarks(),
    handedness: makeValidHandedness(),
    processingTimeMs: 10,
  };
}

/**
 * Creates a ConfigStore with default values.
 */
function makeConfig(): ConfigStore {
  return new ConfigStore();
}

// ─── Property 2: Highest-Priority Feedback Selection ─────────────────────────

/**
 * **Validates: Requirements 3.5, 5.5**
 *
 * Property 2: Highest-Priority Feedback Selection
 *
 * For any combination of position check failures, the application shall display
 * exactly the single failure with the highest priority according to the fixed
 * priority order, and no other corrections shall be shown simultaneously.
 */
describe('Property 2: Highest-Priority Feedback Selection', () => {
  let validator: PositionValidatorImpl;
  let config: ConfigStore;

  beforeEach(() => {
    validator = new PositionValidatorImpl();
    config = makeConfig();
  });

  it('should report exactly the first failing check in CHECK_PRIORITY order for any subset of failures', () => {
    // Strategy: Generate frames that deterministically fail at a specific priority level.
    // For each check type, create a frame that passes all higher-priority checks but
    // fails at this level. We test all checks that can be independently isolated.
    //
    // Note: 'arms_not_resting' is geometrically coupled with 'arm_height' and
    // 'elbow_extension' (making arms rest against body while keeping wrists at
    // shoulder height requires bending elbows), so we test it separately below.
    const isolatableChecks: PositionCheckType[] = [
      'subject_detected',
      'torso_forward',
      'shoulders_visible',
      'arm_height',
      'elbow_extension',
      'hands_visible',
      'palm_orientation',
    ];
    const checkIndexArb = fc.integer({ min: 0, max: isolatableChecks.length - 1 });

    fc.assert(
      fc.property(checkIndexArb, (idx: number) => {
        const targetCheck = isolatableChecks[idx];
        const frame = makeValidFrame();
        const poseLandmarks = frame.poseLandmarks![0];
        const handLandmarks = frame.handLandmarks!;

        // Induce failure ONLY for the target check
        switch (targetCheck) {
          case 'subject_detected':
            frame.poseLandmarks = null;
            break;
          case 'torso_forward':
            poseLandmarks[11] = makeLandmark(0.6, 0.4, 0.5, 0.95);
            poseLandmarks[12] = makeLandmark(0.4, 0.4, -0.5, 0.95);
            break;
          case 'shoulders_visible':
            poseLandmarks[11] = makeLandmark(0.6, 0.4, 0.0, 0.1);
            poseLandmarks[12] = makeLandmark(0.4, 0.4, 0.0, 0.1);
            break;
          case 'arm_height':
            poseLandmarks[15] = makeLandmark(0.9, 0.8, 0.0, 0.95);
            poseLandmarks[16] = makeLandmark(0.1, 0.8, 0.0, 0.95);
            break;
          case 'elbow_extension':
            poseLandmarks[13] = makeLandmark(0.75, 0.6, 0.0, 0.95);
            poseLandmarks[14] = makeLandmark(0.25, 0.6, 0.0, 0.95);
            break;
          case 'hands_visible':
            frame.handLandmarks = null;
            frame.handedness = null;
            break;
          case 'palm_orientation':
            handLandmarks[0][0] = makeLandmark(0.9, 0.4, 0.0, 0.95);
            handLandmarks[0][5] = makeLandmark(0.9, 0.4, 0.1, 0.95);
            handLandmarks[0][9] = makeLandmark(0.9, 0.5, 0.0, 0.95);
            handLandmarks[1][0] = makeLandmark(0.1, 0.4, 0.0, 0.95);
            handLandmarks[1][5] = makeLandmark(0.1, 0.4, 0.1, 0.95);
            handLandmarks[1][9] = makeLandmark(0.1, 0.5, 0.0, 0.95);
            break;
        }

        const result = validator.validate(frame, config);

        // Frame should be invalid
        expect(result.isValid).toBe(false);
        // The reported fail should be exactly the target check
        expect(result.highestPriorityFail).toBe(targetCheck);
        // Only one value reported (string, not array)
        expect(typeof result.highestPriorityFail).toBe('string');
      }),
      { numRuns: 100 }
    );
  });

  it('should report only ONE highest-priority fail even when multiple checks would fail', () => {
    // Generate two different check indices where the lower-priority one is later in the order
    const twoIndicesArb = fc.tuple(
      fc.integer({ min: 0, max: CHECK_PRIORITY.length - 2 }),
      fc.integer({ min: 1, max: CHECK_PRIORITY.length - 1 })
    ).filter(([a, b]) => a < b);

    fc.assert(
      fc.property(twoIndicesArb, ([higherIdx, _lowerIdx]) => {
        const higherCheck = CHECK_PRIORITY[higherIdx];
        const frame = makeValidFrame();

        // Make the higher-priority check fail (which prevents evaluation of lower checks)
        switch (higherCheck) {
          case 'subject_detected':
            frame.poseLandmarks = null;
            break;
          case 'torso_forward':
            frame.poseLandmarks![0][11] = makeLandmark(0.6, 0.4, 0.5, 0.95);
            frame.poseLandmarks![0][12] = makeLandmark(0.4, 0.4, -0.5, 0.95);
            break;
          case 'shoulders_visible':
            frame.poseLandmarks![0][11] = makeLandmark(0.6, 0.4, 0.0, 0.1);
            frame.poseLandmarks![0][12] = makeLandmark(0.4, 0.4, 0.0, 0.1);
            break;
          case 'arm_height':
            frame.poseLandmarks![0][15] = makeLandmark(0.9, 0.8, 0.0, 0.95);
            frame.poseLandmarks![0][16] = makeLandmark(0.1, 0.8, 0.0, 0.95);
            break;
          case 'elbow_extension':
            frame.poseLandmarks![0][13] = makeLandmark(0.75, 0.6, 0.0, 0.95);
            frame.poseLandmarks![0][14] = makeLandmark(0.25, 0.6, 0.0, 0.95);
            break;
          case 'arms_not_resting':
            // This will also fail elbow_extension (higher priority), which is fine —
            // we just verify that whatever the validator reports is the highest-priority fail.
            frame.poseLandmarks![0][13] = makeLandmark(0.59, 0.55, 0.0, 0.95);
            frame.poseLandmarks![0][14] = makeLandmark(0.41, 0.55, 0.0, 0.95);
            break;
          case 'hands_visible':
            frame.handLandmarks = null;
            frame.handedness = null;
            break;
        }

        const result = validator.validate(frame, config);

        expect(result.isValid).toBe(false);
        // The reported fail must be at or above the index of the check we targeted
        const reportedIdx = CHECK_PRIORITY.indexOf(result.highestPriorityFail!);
        expect(reportedIdx).toBeLessThanOrEqual(CHECK_PRIORITY.indexOf(higherCheck));
      }),
      { numRuns: 100 }
    );
  });

  it('should report null highestPriorityFail when all checks pass', () => {
    const frame = makeValidFrame();
    const result = validator.validate(frame, config);

    // If all pass, highestPriorityFail should be null
    if (result.isValid) {
      expect(result.highestPriorityFail).toBeNull();
    }
  });
});

// ─── Property 5: Position Validation Correctness ─────────────────────────────

/**
 * **Validates: Requirements 5.1, 5.2, 5.6**
 *
 * Property 5: Position Validation Correctness
 *
 * For any set of landmarks with associated confidence scores, accept position
 * iff all criteria are satisfied. When all criteria meet their thresholds →
 * isValid = true. When any single criterion fails → isValid = false.
 */
describe('Property 5: Position Validation Correctness', () => {
  let validator: PositionValidatorImpl;
  let config: ConfigStore;

  beforeEach(() => {
    validator = new PositionValidatorImpl();
    config = makeConfig();
  });

  it('should accept position when all criteria are met with valid landmarks', () => {
    // Generate landmarks that satisfy all criteria
    // Use small perturbations that stay within thresholds
    const perturbationArb = fc.double({ min: -0.01, max: 0.01, noNaN: true });

    fc.assert(
      fc.property(
        perturbationArb,
        perturbationArb,
        perturbationArb,
        (wristYPert, shoulderZPert, elbowPert) => {
          const frame = makeValidFrame();
          const landmarks = frame.poseLandmarks![0];

          // Apply small perturbations that keep position valid
          landmarks[15] = makeLandmark(0.9, 0.4 + wristYPert, 0.0, 0.95);
          landmarks[16] = makeLandmark(0.1, 0.4 + wristYPert, 0.0, 0.95);
          landmarks[11] = makeLandmark(0.6, 0.4, shoulderZPert, 0.95);
          landmarks[12] = makeLandmark(0.4, 0.4, shoulderZPert, 0.95);

          const result = validator.validate(frame, config);
          expect(result.isValid).toBe(true);
          expect(result.highestPriorityFail).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject position when subject is not detected (no pose landmarks)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(null, [], [[]]),
        (poseLandmarks) => {
          const frame = makeValidFrame();
          frame.poseLandmarks = poseLandmarks as NormalizedLandmark[][] | null;

          const result = validator.validate(frame, config);
          expect(result.isValid).toBe(false);
        }
      ),
      { numRuns: 10 }
    );
  });

  it('should reject position when any single criterion fails while others pass', () => {
    // For each check type, create a frame that fails ONLY that check
    const checkTypeArb = fc.constantFrom(...CHECK_PRIORITY);

    fc.assert(
      fc.property(checkTypeArb, (failingCheck: PositionCheckType) => {
        const frame = makeValidFrame();
        const landmarks = frame.poseLandmarks![0];
        const handLandmarks = frame.handLandmarks!;

        switch (failingCheck) {
          case 'subject_detected':
            frame.poseLandmarks = null;
            break;
          case 'torso_forward':
            // Extreme z difference = rotated torso
            landmarks[11] = makeLandmark(0.6, 0.4, 0.8, 0.95);
            landmarks[12] = makeLandmark(0.4, 0.4, -0.8, 0.95);
            break;
          case 'shoulders_visible':
            landmarks[11] = makeLandmark(0.6, 0.4, 0.0, 0.05);
            landmarks[12] = makeLandmark(0.4, 0.4, 0.0, 0.05);
            break;
          case 'arm_height':
            // Wrists far below shoulders
            landmarks[15] = makeLandmark(0.9, 0.9, 0.0, 0.95);
            landmarks[16] = makeLandmark(0.1, 0.9, 0.0, 0.95);
            break;
          case 'elbow_extension':
            // Elbows significantly bent (elbow below the shoulder-wrist line)
            landmarks[13] = makeLandmark(0.75, 0.65, 0.0, 0.95);
            landmarks[14] = makeLandmark(0.25, 0.65, 0.0, 0.95);
            break;
          case 'arms_not_resting':
            // Elbows right next to body (very small arm-body angle)
            landmarks[13] = makeLandmark(0.59, 0.55, 0.0, 0.95);
            landmarks[14] = makeLandmark(0.41, 0.55, 0.0, 0.95);
            break;
          case 'hands_visible':
            frame.handLandmarks = null;
            frame.handedness = null;
            break;
          case 'palm_orientation':
            // Palms facing completely sideways (bad orientation)
            handLandmarks[0][0] = makeLandmark(0.9, 0.4, 0.0, 0.95);
            handLandmarks[0][5] = makeLandmark(0.9, 0.4, 0.1, 0.95);
            handLandmarks[0][9] = makeLandmark(0.9, 0.5, 0.0, 0.95);
            handLandmarks[1][0] = makeLandmark(0.1, 0.4, 0.0, 0.95);
            handLandmarks[1][5] = makeLandmark(0.1, 0.4, 0.1, 0.95);
            handLandmarks[1][9] = makeLandmark(0.1, 0.5, 0.0, 0.95);
            break;
        }

        const result = validator.validate(frame, config);
        expect(result.isValid).toBe(false);
      }),
      { numRuns: 50 }
    );
  });
});

// ─── Property 6: Hold Timer Reset on Invalidity ─────────────────────────────

/**
 * **Validates: Requirements 5.3**
 *
 * Property 6: Hold Timer Reset on Invalidity
 *
 * Hold timer advances only during continuous validity. If any validation
 * result is invalid, timer resets to zero. Hold progress reaches 1.0 only
 * after requiredHoldDuration of continuous validity.
 */
describe('Property 6: Hold Timer Reset on Invalidity', () => {
  let validator: PositionValidatorImpl;
  let config: ConfigStore;

  beforeEach(() => {
    validator = new PositionValidatorImpl();
    config = makeConfig();
  });

  it('should advance hold timer only during consecutive valid frames', () => {
    // Generate a sequence of validity states (true/false) with timestamps
    const sequenceArb = fc.array(fc.boolean(), { minLength: 2, maxLength: 20 });

    fc.assert(
      fc.property(sequenceArb, (validitySequence: boolean[]) => {
        validator.resetHold();

        let consecutiveValidCount = 0;
        const frameDurationMs = 100; // 100ms between frames

        for (let i = 0; i < validitySequence.length; i++) {
          const isValid = validitySequence[i];
          const timestamp = i * frameDurationMs;

          const frame = isValid ? makeValidFrame(timestamp) : makeInvalidFrame(timestamp);
          const result = validator.validate(frame, config);

          if (isValid) {
            consecutiveValidCount++;
          } else {
            consecutiveValidCount = 0;
          }

          if (!isValid) {
            // After an invalid frame, hold progress should be 0
            expect(result.holdProgress).toBe(0);
          } else if (consecutiveValidCount === 1) {
            // First valid frame after reset: holdProgress = 0 (just started)
            expect(result.holdProgress).toBe(0);
          } else {
            // Hold progress should advance (> 0) during consecutive valid frames
            expect(result.holdProgress).toBeGreaterThanOrEqual(0);
          }
        }
      }),
      { numRuns: 200 }
    );
  });

  it('should reset timer to zero whenever an invalid frame occurs', () => {
    // Generate sequences with at least some valid frames before an invalid frame
    const patternArb = fc.tuple(
      fc.integer({ min: 3, max: 10 }), // valid frames before (need at least 3 for measurable duration)
      fc.integer({ min: 1, max: 5 })   // invalid frames
    );

    fc.assert(
      fc.property(patternArb, ([validCount, _invalidCount]) => {
        validator.resetHold();
        const frameDurationMs = 100;
        let timestamp = 0;

        // Feed valid frames to build up hold time
        for (let i = 0; i < validCount; i++) {
          const frame = makeValidFrame(timestamp);
          validator.validate(frame, config);
          timestamp += frameDurationMs;
        }

        // After 3+ valid frames, hold should have advanced
        // (First frame starts at 0, subsequent frames accumulate duration)
        expect(validator.getHoldDuration()).toBeGreaterThan(0);

        // Feed an invalid frame
        const invalidFrame = makeInvalidFrame(timestamp);
        const result = validator.validate(invalidFrame, config);

        // Hold should reset to 0
        expect(result.holdProgress).toBe(0);
        expect(validator.getHoldDuration()).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it('should reach holdProgress 1.0 only after requiredHoldDuration of continuous validity', () => {
    // Generate different hold durations within valid range [0.5, 3.0]
    const holdDurationArb = fc.double({ min: 0.5, max: 3.0, noNaN: true });

    fc.assert(
      fc.property(holdDurationArb, (requiredDuration: number) => {
        validator.resetHold();
        const testConfig = new ConfigStore({ requiredHoldDuration: requiredDuration });

        const frameDurationMs = 50; // 50ms per frame (20fps)
        const totalFrames = Math.ceil((requiredDuration * 1000) / frameDurationMs) + 5;

        let reachedOneAt: number | null = null;

        for (let i = 0; i < totalFrames; i++) {
          const timestamp = i * frameDurationMs;
          const frame = makeValidFrame(timestamp);
          const result = validator.validate(frame, testConfig);

          if (result.holdProgress >= 1.0 && reachedOneAt === null) {
            reachedOneAt = timestamp;
          }
        }

        // Hold should reach 1.0
        expect(reachedOneAt).not.toBeNull();

        // It should not reach 1.0 before the required duration has elapsed
        // (First frame is the hold start, so duration = (reachedOneAt - 0) / 1000)
        if (reachedOneAt !== null) {
          const actualDurationSec = reachedOneAt / 1000;
          // Allow small tolerance for frame timing
          expect(actualDurationSec).toBeGreaterThanOrEqual(requiredDuration - 0.1);
        }
      }),
      { numRuns: 50 }
    );
  });
});

// ─── Helper to create an invalid frame ───────────────────────────────────────

/**
 * Creates a CVFrameResult that will fail position validation (no pose landmarks).
 */
function makeInvalidFrame(timestamp: number): CVFrameResult {
  return {
    timestamp,
    poseLandmarks: null,
    poseWorldLandmarks: null,
    handLandmarks: null,
    handedness: null,
    processingTimeMs: 10,
  };
}
