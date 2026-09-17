// Feature: pronator-drift-analysis, Property 12: Dominant frequency recovers a known signal
//
// **Validates: Requirements 6.3**
//
// Property 12: Dominant frequency recovers a known signal
//
// For any synthetic sinusoidal wrist-position signal at frequency f sampled above
// the Nyquist rate for f, the reported dominant oscillation frequency
// (MicroMovementIndicators.wristTremorDominantFrequency.samples[0].value, in Hz)
// SHALL be within tolerance of f.
//
// ── Signal construction (documented) ─────────────────────────────────────────
// The analyzer estimates the dominant frequency from the high-pass residual of the
// wrist POSITION MAGNITUDE = sqrt(x^2 + y^2), not from a single axis. To drive one
// clean frequency f into the magnitude we oscillate a SINGLE axis about a large
// constant offset while holding the other axis constant:
//
//     wrist.y = C                (constant)
//     wrist.x = C + A * sin(2*pi*f*t)   with A << C
//
// Then magnitude(t) = sqrt((C + A*sin(2*pi*f*t))^2 + C^2). Because A << C, the
// magnitude is a smooth monotonic function of x over the small oscillation range,
// so it oscillates at exactly frequency f (the fundamental dominates; higher-order
// distortion from the sqrt is negligible for A/C small). The analyzer's centered
// moving-average high-pass removes the DC/offset, leaving a residual that peaks at
// bin f in the periodogram.
//
// Sampling: frames are spaced 1000/fs ms apart so the analyzer's effective sample
// rate estimate ((N-1)/durationSeconds) equals fs. f is chosen well below Nyquist
// (f in [2, fs/3]) so the signal is comfortably sampled above the Nyquist rate.
//
// Tolerance: the periodogram uses standard DFT bin spacing fs/N, so exact recovery
// is limited to one frequency bin. With N = 90 frames and fs in {30, 60}, one bin
// is fs/N = 0.33 or 0.67 Hz. We assert recovery within a generous +/- 1.5 Hz
// tolerance (>= one bin for both sample rates) to be robust to the magnitude
// transform and windowing.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ConfigStore } from '../config/ConfigStore';
import { MicroMovementAnalyzer } from './MicroMovementAnalyzer';
import type {
  ArmBaseline,
  Baseline,
  CVFrameResult,
  Handedness,
  NormalizedLandmark,
} from '../types';

// ─── MediaPipe Pose Landmark Indices (matching MicroMovementAnalyzer) ─────────

const POSE_INDICES = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24 },
} as const;

// Recovery tolerance in Hz: >= one DFT bin (fs/N) for both fs in {30, 60} with
// N = 90 frames (max bin = 60/90 = 0.67 Hz).
const TOLERANCE_HZ = 1.5;

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeLandmark(
  x: number,
  y: number,
  z: number = 0,
  visibility: number = 0.95
): NormalizedLandmark {
  return { x, y, z, visibility };
}

/** Minimal ArmBaseline; armLength does not affect the frequency estimate. */
function makeArmBaseline(): ArmBaseline {
  return {
    shoulderPos: { x: 0.6, y: 0.4, z: 0 },
    elbowPos: { x: 0.7, y: 0.45, z: 0 },
    wristPos: { x: 0.8, y: 0.5, z: 0 },
    normalizedWristHeight: 0.5,
    elbowExtensionAngle: 180,
    palmOrientationAngle: 0,
    armLength: 0.2,
  };
}

function makeBaseline(): Baseline {
  return {
    leftArm: makeArmBaseline(),
    rightArm: makeArmBaseline(),
    torsoAngle: 0,
    shoulderWidth: 0.2,
    captureFrameCount: 10,
    captureStartTime: 0,
    captureEndTime: 1000,
  };
}

/**
 * Build a full 33-landmark pose set for the assessed arm. The assessed-arm wrist
 * carries the synthetic sinusoidal position; shoulder/elbow/hip are fixed at
 * stable positions so those frames are confident (visibility high) and the wrist
 * series drives the tremor estimate.
 */
function makePoseSet(
  assessedArm: 'left' | 'right',
  wristX: number,
  wristY: number
): NormalizedLandmark[] {
  const set: NormalizedLandmark[] = Array.from({ length: 33 }, () =>
    makeLandmark(0.5, 0.5, 0, 0.95)
  );
  const idx = POSE_INDICES[assessedArm];
  // Fixed shoulder/elbow/hip for the assessed arm; only the wrist oscillates.
  set[idx.shoulder] = makeLandmark(0.6, 0.4, 0, 0.95);
  set[idx.elbow] = makeLandmark(0.7, 0.45, 0, 0.95);
  set[idx.wrist] = makeLandmark(wristX, wristY, 0, 0.95);
  set[idx.hip] = makeLandmark(0.55, 0.7, 0, 0.95);
  return set;
}

function makeFrame(
  assessedArm: 'left' | 'right',
  timestamp: number,
  wristX: number,
  wristY: number
): CVFrameResult {
  // No hand landmarks needed for the wrist-position tremor estimate.
  const handLandmarks: NormalizedLandmark[][] | null = null;
  const handedness: Handedness[] | null = null;
  return {
    timestamp,
    poseLandmarks: [makePoseSet(assessedArm, wristX, wristY)],
    poseWorldLandmarks: null,
    handLandmarks,
    handedness,
    processingTimeMs: 16,
  };
}

// ─── Generators ──────────────────────────────────────────────────────────────

const assessedArmArb: fc.Arbitrary<'left' | 'right'> = fc.constantFrom('left', 'right');

// Effective sample rate via frame timestamps: 30 or 60 Hz.
const sampleRateArb: fc.Arbitrary<number> = fc.constantFrom(30, 60);

// ─── Property Test ───────────────────────────────────────────────────────────

describe('Property 12: Dominant frequency recovers a known signal', () => {
  it('recovers the frequency of a synthetic sinusoidal wrist signal within tolerance', () => {
    fc.assert(
      fc.property(
        assessedArmArb,
        sampleRateArb,
        // Frame count fixed at 90 for good spectral resolution across fs in {30,60}.
        fc.constant(90),
        // f in [2, fs/3] chosen below via a fraction so it stays well under Nyquist.
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (assessedArm, fs, frameCount, fFraction) => {
          // Map fFraction in [0,1] to a target frequency f in [2, fs/3] Hz. This
          // keeps f above 2 Hz and comfortably below Nyquist (fs/2).
          const fMin = 2;
          const fMax = fs / 3;
          const f = fMin + fFraction * (fMax - fMin);

          const config = new ConfigStore();
          const analyzer = new MicroMovementAnalyzer(config);
          analyzer.start(makeBaseline(), assessedArm);

          const dtMs = 1000 / fs; // frame spacing so effective sample rate == fs
          const C = 0.5; // large constant offset
          const A = 0.01; // small oscillation amplitude, A << C

          for (let i = 0; i < frameCount; i++) {
            const tSeconds = i / fs;
            const wristX = C + A * Math.sin(2 * Math.PI * f * tSeconds);
            const wristY = C; // constant -> magnitude oscillates at frequency f
            const timestamp = 1000 + i * dtMs;
            analyzer.addFrame(makeFrame(assessedArm, timestamp, wristX, wristY));
          }

          const indicators = analyzer.finalize();
          const freqIndicator = indicators.wristTremorDominantFrequency;

          // The dominant frequency must be measurable and reported as a single value.
          expect(freqIndicator.measurable).toBe(true);
          expect(freqIndicator.samples.length).toBe(1);

          const reported = freqIndicator.samples[0].value;

          // Reported frequency recovers f within tolerance (Req 6.3).
          expect(Math.abs(reported - f)).toBeLessThanOrEqual(TOLERANCE_HZ);

          // Sanity: the reported frequency respects the Nyquist bound.
          expect(reported).toBeLessThanOrEqual(fs / 2 + 1e-9);
        }
      ),
      { numRuns: 100 }
    );
  });
});
