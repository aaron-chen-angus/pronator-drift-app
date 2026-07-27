/**
 * Unit tests for DriftAnalyzer assessment-phase functionality.
 *
 * Tests cover:
 * - Drift normalization formula
 * - Torso lean compensation with non-negative clamp
 * - Temporal smoothing via sliding-window median filter
 * - Camera movement detection and frame exclusion
 * - Low-confidence interval exclusion (beyond occlusion grace period)
 * - Drift onset tracking (first threshold exceedance)
 * - Maximum drift tracking per arm
 * - getDriftTimeSeries / getCurrentDrift / getMaxDrift / getDriftOnset
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigStore } from '../config/ConfigStore';
import { DriftAnalyzerImpl, median } from './DriftAnalyzer';
import type { CVFrameResult, NormalizedLandmark, Baseline } from '../types';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Create a landmark with given position and visibility. */
function makeLandmark(
  x: number,
  y: number,
  z: number = 0,
  visibility: number = 0.9
): NormalizedLandmark {
  return { x, y, z, visibility };
}

/**
 * Create a complete set of 33 pose landmarks with configurable positions.
 */
function makeAssessmentPoseLandmarks(overrides?: {
  leftShoulderY?: number;
  rightShoulderY?: number;
  leftWristY?: number;
  rightWristY?: number;
  leftElbowY?: number;
  rightElbowY?: number;
  visibility?: number;
}): NormalizedLandmark[] {
  const vis = overrides?.visibility ?? 0.9;
  const landmarks: NormalizedLandmark[] = Array.from({ length: 33 }, () =>
    makeLandmark(0.5, 0.5, 0, vis)
  );

  // Shoulders
  landmarks[11] = makeLandmark(0.6, overrides?.leftShoulderY ?? 0.4, 0, vis);
  landmarks[12] = makeLandmark(0.4, overrides?.rightShoulderY ?? 0.4, 0, vis);

  // Elbows
  landmarks[13] = makeLandmark(0.7, overrides?.leftElbowY ?? 0.4, 0, vis);
  landmarks[14] = makeLandmark(0.3, overrides?.rightElbowY ?? 0.4, 0, vis);

  // Wrists
  landmarks[15] = makeLandmark(0.8, overrides?.leftWristY ?? 0.4, 0, vis);
  landmarks[16] = makeLandmark(0.2, overrides?.rightWristY ?? 0.4, 0, vis);

  // Hips
  landmarks[23] = makeLandmark(0.55, 0.7, 0, vis);
  landmarks[24] = makeLandmark(0.45, 0.7, 0, vis);

  return landmarks;
}

/**
 * Create a minimal CVFrameResult.
 */
function makeFrame(
  timestamp: number,
  poseLandmarks: NormalizedLandmark[] | null = null,
  handLandmarks: NormalizedLandmark[][] | null = null,
  handedness: { label: 'Left' | 'Right'; score: number }[] | null = null
): CVFrameResult {
  return {
    timestamp,
    poseLandmarks: poseLandmarks ? [poseLandmarks] : null,
    poseWorldLandmarks: null,
    handLandmarks,
    handedness,
    processingTimeMs: 16,
  };
}

/**
 * Create a standard baseline matching the default landmark positions.
 * Shoulders at y=0.4, wrists at y=0.4, arm length = 0.2 (horizontal distance).
 */
function makeDefaultBaseline(): Baseline {
  return {
    leftArm: {
      shoulderPos: { x: 0.6, y: 0.4, z: 0 },
      elbowPos: { x: 0.7, y: 0.4, z: 0 },
      wristPos: { x: 0.8, y: 0.4, z: 0 },
      normalizedWristHeight: 0,
      elbowExtensionAngle: 180,
      palmOrientationAngle: 0,
      armLength: 0.2,
    },
    rightArm: {
      shoulderPos: { x: 0.4, y: 0.4, z: 0 },
      elbowPos: { x: 0.3, y: 0.4, z: 0 },
      wristPos: { x: 0.2, y: 0.4, z: 0 },
      normalizedWristHeight: 0,
      elbowExtensionAngle: 180,
      palmOrientationAngle: 0,
      armLength: 0.2,
    },
    torsoAngle: 0,
    shoulderWidth: 0.2,
    captureFrameCount: 10,
    captureStartTime: 0,
    captureEndTime: 2500,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DriftAnalyzer - median helper', () => {
  it('returns 0 for empty array', () => {
    expect(median([])).toBe(0);
  });

  it('returns the single element for array of length 1', () => {
    expect(median([5])).toBe(5);
  });

  it('returns middle value for odd-length array', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('returns average of two middle values for even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('handles already sorted arrays', () => {
    expect(median([1, 2, 3, 4, 5])).toBe(3);
  });
});

describe('DriftAnalyzer - Assessment Phase', () => {
  let config: ConfigStore;
  let analyzer: DriftAnalyzerImpl;
  let baseline: Baseline;

  beforeEach(() => {
    config = new ConfigStore();
    analyzer = new DriftAnalyzerImpl(config);
    baseline = makeDefaultBaseline();
  });

  describe('startAssessment', () => {
    it('initializes assessment state', () => {
      analyzer.startAssessment(baseline);
      expect(analyzer.getDriftTimeSeries()).toEqual([]);
      expect(analyzer.getCurrentDrift()).toEqual({ left: 0, right: 0 });
      expect(analyzer.getMaxDrift()).toEqual({ left: 0, right: 0 });
      expect(analyzer.getDriftOnset()).toEqual({ left: null, right: null });
    });

    it('resets state if called again', () => {
      analyzer.startAssessment(baseline);
      // Add a frame with drift
      const frame = makeFrame(3000, makeAssessmentPoseLandmarks({ leftWristY: 0.5 }));
      analyzer.addAssessmentFrame(frame);
      expect(analyzer.getDriftTimeSeries().length).toBe(1);

      // Restart assessment
      analyzer.startAssessment(baseline);
      expect(analyzer.getDriftTimeSeries()).toEqual([]);
      expect(analyzer.getMaxDrift()).toEqual({ left: 0, right: 0 });
    });
  });

  describe('addAssessmentFrame - drift normalization', () => {
    it('computes zero drift when wrist is at baseline position', () => {
      analyzer.startAssessment(baseline);
      const frame = makeFrame(3000, makeAssessmentPoseLandmarks());
      analyzer.addAssessmentFrame(frame);

      const drift = analyzer.getCurrentDrift();
      expect(drift.left).toBeCloseTo(0);
      expect(drift.right).toBeCloseTo(0);
    });

    it('computes positive drift when wrist drops below baseline', () => {
      analyzer.startAssessment(baseline);
      // Wrist drops from y=0.4 to y=0.5 (0.1 units down)
      // Normalized: (0.5 - 0.4 - 0) / 0.2 = 0.5
      const frame = makeFrame(3000, makeAssessmentPoseLandmarks({ leftWristY: 0.5 }));
      analyzer.addAssessmentFrame(frame);

      const drift = analyzer.getCurrentDrift();
      expect(drift.left).toBeCloseTo(0.5);
    });

    it('clamps drift to non-negative (wrist above baseline yields 0)', () => {
      analyzer.startAssessment(baseline);
      // Wrist moves UP from y=0.4 to y=0.3 (would give negative raw drift)
      const frame = makeFrame(3000, makeAssessmentPoseLandmarks({ leftWristY: 0.3 }));
      analyzer.addAssessmentFrame(frame);

      const drift = analyzer.getCurrentDrift();
      expect(drift.left).toBe(0);
    });

    it('normalizes drift by arm length', () => {
      analyzer.startAssessment(baseline);
      // Arm length is 0.2; wrist drops 0.04 units
      // Normalized: 0.04 / 0.2 = 0.2
      const frame = makeFrame(3000, makeAssessmentPoseLandmarks({ leftWristY: 0.44 }));
      analyzer.addAssessmentFrame(frame);

      const drift = analyzer.getCurrentDrift();
      expect(drift.left).toBeCloseTo(0.2);
    });

    it('computes drift independently for each arm', () => {
      analyzer.startAssessment(baseline);
      // Left drops 0.1, right drops 0.04
      const frame = makeFrame(3000, makeAssessmentPoseLandmarks({
        leftWristY: 0.5,
        rightWristY: 0.44,
      }));
      analyzer.addAssessmentFrame(frame);

      const drift = analyzer.getCurrentDrift();
      expect(drift.left).toBeCloseTo(0.5);
      expect(drift.right).toBeCloseTo(0.2);
    });
  });

  describe('addAssessmentFrame - torso compensation', () => {
    it('subtracts torso shift from drift when shoulders move down', () => {
      analyzer.startAssessment(baseline);
      // Shoulders move down from y=0.4 to y=0.41 (torsoShift = 0.01, below camera threshold of 0.02)
      // Wrist moves down from y=0.4 to y=0.46 (raw drift = 0.06)
      // Compensated drift = max(0, (0.06 - 0.01)) / 0.2 = 0.25
      const frame = makeFrame(3000, makeAssessmentPoseLandmarks({
        leftShoulderY: 0.41,
        rightShoulderY: 0.41,
        leftWristY: 0.46,
      }));
      analyzer.addAssessmentFrame(frame);

      const drift = analyzer.getCurrentDrift();
      expect(drift.left).toBeCloseTo(0.25);
    });

    it('clamps compensated drift to non-negative', () => {
      analyzer.startAssessment(baseline);
      // Shoulders move down by 0.015, wrist only by 0.002
      // raw drift = 0.002, torso shift = 0.015
      // compensated = max(0, 0.002 - 0.015) / 0.2 = 0
      const frame = makeFrame(3000, makeAssessmentPoseLandmarks({
        leftShoulderY: 0.415,
        rightShoulderY: 0.415,
        leftWristY: 0.402,
      }));
      analyzer.addAssessmentFrame(frame);

      const drift = analyzer.getCurrentDrift();
      expect(drift.left).toBe(0);
    });

    it('does not compensate when shoulders move up (negative torso shift)', () => {
      analyzer.startAssessment(baseline);
      // Shoulders move UP from y=0.4 to y=0.39 (shift = -0.01, clamped to 0)
      // Wrist drops from y=0.4 to y=0.5 (raw drift = 0.1)
      // But shoulder midpoint displacement = 0.01 < 0.02 camera threshold, so valid
      // Compensated drift = max(0, 0.1 - 0) / 0.2 = 0.5
      const frame = makeFrame(3000, makeAssessmentPoseLandmarks({
        leftShoulderY: 0.39,
        rightShoulderY: 0.39,
        leftWristY: 0.5,
      }));
      analyzer.addAssessmentFrame(frame);

      const drift = analyzer.getCurrentDrift();
      expect(drift.left).toBeCloseTo(0.5);
    });
  });

  describe('addAssessmentFrame - temporal smoothing', () => {
    it('applies median filter over smoothing window', () => {
      // smoothingWindowDuration default is 0.5s = 500ms
      analyzer.startAssessment(baseline);

      // Add frames with different drift levels within the smoothing window
      // Frame 1: left wrist at y=0.44 -> normalized = 0.2
      analyzer.addAssessmentFrame(makeFrame(3000, makeAssessmentPoseLandmarks({ leftWristY: 0.44 })));
      // Frame 2: left wrist at y=0.46 -> normalized = 0.3
      analyzer.addAssessmentFrame(makeFrame(3100, makeAssessmentPoseLandmarks({ leftWristY: 0.46 })));
      // Frame 3: left wrist at y=0.42 -> normalized = 0.1
      analyzer.addAssessmentFrame(makeFrame(3200, makeAssessmentPoseLandmarks({ leftWristY: 0.42 })));

      const drift = analyzer.getCurrentDrift();
      // Median of [0.2, 0.3, 0.1] = 0.2
      expect(drift.left).toBeCloseTo(0.2);
    });

    it('removes old frames outside the smoothing window', () => {
      analyzer.startAssessment(baseline);

      // Frame outside window (older than 500ms)
      analyzer.addAssessmentFrame(makeFrame(2400, makeAssessmentPoseLandmarks({ leftWristY: 0.6 })));
      // Frames inside window
      analyzer.addAssessmentFrame(makeFrame(2950, makeAssessmentPoseLandmarks({ leftWristY: 0.44 })));
      analyzer.addAssessmentFrame(makeFrame(3000, makeAssessmentPoseLandmarks({ leftWristY: 0.44 })));

      const drift = analyzer.getCurrentDrift();
      // Old frame should have been dropped; median of [0.2, 0.2] = 0.2
      expect(drift.left).toBeCloseTo(0.2);
    });
  });

  describe('addAssessmentFrame - camera movement detection', () => {
    it('marks frame as invalid when camera movement exceeds threshold', () => {
      // cameraMovementThreshold default is 0.02
      analyzer.startAssessment(baseline);

      // Move shoulders significantly (simulating camera shake)
      // Baseline shoulder midpoint is at x=0.5, y=0.4
      // Shift shoulders by 0.05 in y (exceeds 0.02 threshold)
      const landmarks = makeAssessmentPoseLandmarks({
        leftShoulderY: 0.45,
        rightShoulderY: 0.45,
        leftWristY: 0.5,
        rightWristY: 0.5,
      });
      // Also shift shoulder x positions to simulate lateral camera movement
      landmarks[11] = makeLandmark(0.65, 0.45, 0, 0.9); // left shoulder shifted
      landmarks[12] = makeLandmark(0.45, 0.45, 0, 0.9); // right shoulder shifted

      analyzer.addAssessmentFrame(makeFrame(3000, landmarks));

      const timeSeries = analyzer.getDriftTimeSeries();
      expect(timeSeries.length).toBe(1);
      // Frame should be marked invalid due to camera movement
      expect(timeSeries[0].cameraMovement).toBeGreaterThan(0.02);
      expect(timeSeries[0].frameValid).toBe(false);
    });

    it('marks frame as valid when camera movement is below threshold', () => {
      analyzer.startAssessment(baseline);

      // Wrist drifts down slightly but shoulders stay put
      const frame = makeFrame(3000, makeAssessmentPoseLandmarks({ leftWristY: 0.44 }));
      analyzer.addAssessmentFrame(frame);

      const timeSeries = analyzer.getDriftTimeSeries();
      expect(timeSeries[0].cameraMovement).toBeLessThanOrEqual(0.02);
      expect(timeSeries[0].frameValid).toBe(true);
    });
  });

  describe('addAssessmentFrame - low-confidence exclusion', () => {
    it('includes frames with low confidence within grace period', () => {
      // occlusionGracePeriod default is 2.0s = 2000ms
      analyzer.startAssessment(baseline);

      // Low confidence frame within grace period
      const lowConfLandmarks = makeAssessmentPoseLandmarks({
        leftWristY: 0.5,
        visibility: 0.3,
      });
      analyzer.addAssessmentFrame(makeFrame(3000, lowConfLandmarks));
      // Only 0ms since low confidence started, within 2000ms grace period
      const timeSeries = analyzer.getDriftTimeSeries();
      expect(timeSeries[0].frameValid).toBe(true);
    });

    it('excludes frames with low confidence beyond grace period', () => {
      // occlusionGracePeriod default is 2.0s = 2000ms
      analyzer.startAssessment(baseline);

      // Add consecutive low-confidence frames exceeding grace period
      for (let i = 0; i <= 25; i++) {
        const lowConfLandmarks = makeAssessmentPoseLandmarks({
          leftWristY: 0.5,
          visibility: 0.3,
        });
        analyzer.addAssessmentFrame(makeFrame(3000 + i * 100, lowConfLandmarks));
      }

      // Frame at t=3000+2500 = 5500 should be beyond 2000ms grace period
      const timeSeries = analyzer.getDriftTimeSeries();
      const lastFrame = timeSeries[timeSeries.length - 1];
      expect(lastFrame.frameValid).toBe(false);
    });

    it('resets grace period when confidence recovers', () => {
      analyzer.startAssessment(baseline);

      // Low confidence for 1500ms (within grace)
      for (let i = 0; i < 15; i++) {
        analyzer.addAssessmentFrame(
          makeFrame(3000 + i * 100, makeAssessmentPoseLandmarks({ visibility: 0.3, leftWristY: 0.5 }))
        );
      }

      // Good confidence frame resets tracking
      analyzer.addAssessmentFrame(
        makeFrame(4500, makeAssessmentPoseLandmarks({ leftWristY: 0.5 }))
      );

      // Low confidence again — should restart grace period
      for (let i = 0; i < 5; i++) {
        analyzer.addAssessmentFrame(
          makeFrame(4600 + i * 100, makeAssessmentPoseLandmarks({ visibility: 0.3, leftWristY: 0.5 }))
        );
      }

      const timeSeries = analyzer.getDriftTimeSeries();
      const lastFrame = timeSeries[timeSeries.length - 1];
      // Only 500ms of low confidence after recovery — within grace
      expect(lastFrame.frameValid).toBe(true);
    });
  });

  describe('addAssessmentFrame - drift onset tracking', () => {
    it('records onset time when drift first exceeds threshold', () => {
      // minDriftThreshold default is 0.03
      analyzer.startAssessment(baseline);

      // Frame with no drift
      analyzer.addAssessmentFrame(makeFrame(3000, makeAssessmentPoseLandmarks()));
      expect(analyzer.getDriftOnset().left).toBeNull();

      // Frame with drift exceeding threshold: 0.04/0.2 = 0.2 > 0.03
      analyzer.addAssessmentFrame(makeFrame(3100, makeAssessmentPoseLandmarks({ leftWristY: 0.44 })));
      expect(analyzer.getDriftOnset().left).toBe(3100);
    });

    it('does not update onset once already set', () => {
      analyzer.startAssessment(baseline);

      // First frame with drift exceeding threshold
      analyzer.addAssessmentFrame(makeFrame(3000, makeAssessmentPoseLandmarks({ leftWristY: 0.44 })));
      expect(analyzer.getDriftOnset().left).toBe(3000);

      // Later frame also exceeds threshold — onset should remain 3000
      analyzer.addAssessmentFrame(makeFrame(3500, makeAssessmentPoseLandmarks({ leftWristY: 0.5 })));
      expect(analyzer.getDriftOnset().left).toBe(3000);
    });

    it('tracks onset independently per arm', () => {
      analyzer.startAssessment(baseline);

      // Left arm drifts at t=3000
      analyzer.addAssessmentFrame(makeFrame(3000, makeAssessmentPoseLandmarks({ leftWristY: 0.44 })));
      expect(analyzer.getDriftOnset().left).toBe(3000);
      expect(analyzer.getDriftOnset().right).toBeNull();

      // Right arm drifts at t=3500
      analyzer.addAssessmentFrame(makeFrame(3500, makeAssessmentPoseLandmarks({
        leftWristY: 0.44,
        rightWristY: 0.44,
      })));
      expect(analyzer.getDriftOnset().left).toBe(3000);
      expect(analyzer.getDriftOnset().right).toBe(3500);
    });

    it('returns null for onset when no drift detected', () => {
      analyzer.startAssessment(baseline);

      // All frames at baseline
      for (let i = 0; i < 5; i++) {
        analyzer.addAssessmentFrame(makeFrame(3000 + i * 100, makeAssessmentPoseLandmarks()));
      }

      expect(analyzer.getDriftOnset()).toEqual({ left: null, right: null });
    });
  });

  describe('addAssessmentFrame - max drift tracking', () => {
    it('tracks maximum drift per arm', () => {
      analyzer.startAssessment(baseline);

      // Increasing drift
      analyzer.addAssessmentFrame(makeFrame(3000, makeAssessmentPoseLandmarks({ leftWristY: 0.42 }))); // 0.1
      analyzer.addAssessmentFrame(makeFrame(3100, makeAssessmentPoseLandmarks({ leftWristY: 0.46 }))); // 0.3
      analyzer.addAssessmentFrame(makeFrame(3200, makeAssessmentPoseLandmarks({ leftWristY: 0.44 }))); // 0.2

      const maxDrift = analyzer.getMaxDrift();
      // Median with all 3 in buffer: sorted [0.1, 0.2, 0.3] -> median = 0.2
      // But max is tracked per-frame from smoothed values
      // After frame 1: buffer=[0.1], median=0.1
      // After frame 2: buffer=[0.1,0.3], median=0.2
      // After frame 3: buffer=[0.1,0.3,0.2], median=0.2
      // Max smoothed = 0.2
      expect(maxDrift.left).toBeCloseTo(0.2);
    });

    it('tracks arms independently', () => {
      analyzer.startAssessment(baseline);

      analyzer.addAssessmentFrame(makeFrame(3000, makeAssessmentPoseLandmarks({
        leftWristY: 0.5,   // normalized = 0.5
        rightWristY: 0.46, // normalized = 0.3
      })));

      const maxDrift = analyzer.getMaxDrift();
      expect(maxDrift.left).toBeCloseTo(0.5);
      expect(maxDrift.right).toBeCloseTo(0.3);
    });
  });

  describe('getDriftTimeSeries', () => {
    it('returns all recorded frames', () => {
      analyzer.startAssessment(baseline);

      for (let i = 0; i < 5; i++) {
        analyzer.addAssessmentFrame(makeFrame(3000 + i * 100, makeAssessmentPoseLandmarks()));
      }

      const series = analyzer.getDriftTimeSeries();
      expect(series.length).toBe(5);
      expect(series[0].timestamp).toBe(3000);
      expect(series[4].timestamp).toBe(3400);
    });

    it('includes invalid frames in time series', () => {
      analyzer.startAssessment(baseline);

      // Valid frame
      analyzer.addAssessmentFrame(makeFrame(3000, makeAssessmentPoseLandmarks()));
      // Invalid frame (no landmarks)
      analyzer.addAssessmentFrame(makeFrame(3100, null));

      const series = analyzer.getDriftTimeSeries();
      expect(series.length).toBe(2);
      expect(series[0].frameValid).toBe(true);
      expect(series[1].frameValid).toBe(false);
    });

    it('returns a copy (not a reference)', () => {
      analyzer.startAssessment(baseline);
      analyzer.addAssessmentFrame(makeFrame(3000, makeAssessmentPoseLandmarks()));

      const series1 = analyzer.getDriftTimeSeries();
      analyzer.addAssessmentFrame(makeFrame(3100, makeAssessmentPoseLandmarks()));
      const series2 = analyzer.getDriftTimeSeries();

      expect(series1.length).toBe(1);
      expect(series2.length).toBe(2);
    });
  });

  describe('addAssessmentFrame - does nothing without active assessment', () => {
    it('ignores frames when assessment not started', () => {
      const frame = makeFrame(3000, makeAssessmentPoseLandmarks({ leftWristY: 0.5 }));
      analyzer.addAssessmentFrame(frame);

      expect(analyzer.getDriftTimeSeries()).toEqual([]);
    });
  });

  describe('DriftFrame structure', () => {
    it('includes all required fields', () => {
      analyzer.startAssessment(baseline);
      analyzer.addAssessmentFrame(makeFrame(3000, makeAssessmentPoseLandmarks({ leftWristY: 0.44 })));

      const frame = analyzer.getDriftTimeSeries()[0];
      expect(frame.timestamp).toBe(3000);
      expect(typeof frame.leftWristDrift).toBe('number');
      expect(typeof frame.rightWristDrift).toBe('number');
      expect(typeof frame.leftElbowDrift).toBe('number');
      expect(typeof frame.rightElbowDrift).toBe('number');
      expect(typeof frame.leftConfidence).toBe('number');
      expect(typeof frame.rightConfidence).toBe('number');
      expect(typeof frame.torsoCompensation).toBe('number');
      expect(typeof frame.cameraMovement).toBe('number');
      expect(typeof frame.frameValid).toBe('boolean');
    });
  });
});
