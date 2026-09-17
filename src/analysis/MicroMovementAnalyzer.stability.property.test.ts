// Feature: pronator-drift-analysis, Property 13: Stability is inversely monotonic with amplitude and bounded
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ConfigStore } from '../config/ConfigStore';
import { MicroMovementAnalyzer } from './MicroMovementAnalyzer';
import type {
  ArmBaseline,
  Baseline,
  CVFrameResult,
  NormalizedLandmark,
  Vec3,
} from '../types';

// ─── Landmark index reference (from design.md) ───────────────────────────────
// Pose: shoulders 11/12, elbows 13/14, wrists 15/16, hips 23/24.
const POSE_INDICES = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24 },
} as const;

const POSE_LANDMARK_COUNT = 33;
/** High visibility so poseConfidence (mean of shoulder/elbow/wrist) clears minPoseConfidence (default 0.5). */
const HIGH_VIS = 0.9;
const FRAME_INTERVAL_MS = 33; // ~30 fps, dense sampling
const ARM_LENGTH = 0.25;

// ─── Baseline helpers ────────────────────────────────────────────────────────

function makeArmBaseline(): ArmBaseline {
  const zero: Vec3 = { x: 0, y: 0, z: 0 };
  return {
    shoulderPos: { ...zero },
    elbowPos: { ...zero },
    wristPos: { ...zero },
    normalizedWristHeight: 0,
    elbowExtensionAngle: 180,
    palmOrientationAngle: 0,
    armLength: ARM_LENGTH,
  };
}

function makeBaseline(): Baseline {
  return {
    leftArm: makeArmBaseline(),
    rightArm: makeArmBaseline(),
    torsoAngle: 0,
    shoulderWidth: 0.2,
    captureFrameCount: 5,
    captureStartTime: 0,
    captureEndTime: 1000,
  };
}

function lm(x: number, y: number): NormalizedLandmark {
  return { x, y, z: 0, visibility: HIGH_VIS };
}

/**
 * Build a confident CV frame whose assessed-arm wrist sits at (wristX, wristY).
 * Shoulder/elbow/hip are placed at fixed, valid positions with high visibility so
 * every frame is a confident, pose-bearing frame (Req 6.6).
 */
function makeFrame(
  assessedArm: 'left' | 'right',
  timestamp: number,
  wristX: number,
  wristY: number
): CVFrameResult {
  const idx = POSE_INDICES[assessedArm];
  const pose: NormalizedLandmark[] = new Array(POSE_LANDMARK_COUNT)
    .fill(null)
    .map(() => lm(0.5, 0.5));
  // Fixed, valid, distinct positions for the assessed arm's landmarks.
  pose[idx.shoulder] = lm(0.4, 0.3);
  pose[idx.elbow] = lm(0.45, 0.5);
  pose[idx.hip] = lm(0.4, 0.8);
  pose[idx.wrist] = lm(wristX, wristY);

  return {
    timestamp,
    poseLandmarks: [pose],
    poseWorldLandmarks: null,
    handLandmarks: null,
    handedness: null,
    processingTimeMs: 16,
  };
}

/**
 * Run the analyzer over a wrist y-path and return the single-valued stability
 * indicator (samples[0].value = 1/(1+amplitude)).
 */
function stabilityValue(
  assessedArm: 'left' | 'right',
  wristX: number,
  ySeries: number[]
): number | undefined {
  const config = new ConfigStore();
  const analyzer = new MicroMovementAnalyzer(config);
  analyzer.start(makeBaseline(), assessedArm);
  for (let i = 0; i < ySeries.length; i++) {
    analyzer.addFrame(makeFrame(assessedArm, i * FRAME_INTERVAL_MS, wristX, ySeries[i]));
  }
  const indicators = analyzer.finalize();
  return indicators.stability.samples[0]?.value;
}

// ─── Property 13: Stability is inversely monotonic with amplitude and bounded ─

/**
 * **Validates: Requirements 6.4**
 *
 * Property 13: Stability is inversely monotonic with amplitude and bounded.
 *
 * For any two oscillation signals sharing a smooth base path, the signal with the
 * larger high-frequency oscillation amplitude yields a smaller-or-equal stability
 * value (inverse monotonicity), and every stability value is bounded in (0, 1].
 *
 * Generators mirror the amplitude property test so the amplitude ordering is
 * robust:
 * - fixed dense timestamps (~33ms) so the high-pass window is short,
 * - the oscillation is added at the highest frequency (per-frame sign flip) so it
 *   survives detrending regardless of the window,
 * - the added oscillation is strictly larger in the second sequence than in the
 *   first over the same smooth low-frequency base path.
 */
describe('Property 13: Stability is inversely monotonic with amplitude and bounded', () => {
  it('a larger high-frequency oscillation does not increase stability, and stability stays in (0,1]', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'left' | 'right'>('left', 'right'),
        // Number of frames: dense capture window.
        fc.integer({ min: 40, max: 100 }),
        // Base wrist x (fixed across the series).
        fc.double({ min: 0.3, max: 0.7, noNaN: true, noDefaultInfinity: true }),
        // Base wrist y-center.
        fc.double({ min: 0.3, max: 0.7, noNaN: true, noDefaultInfinity: true }),
        // Smooth low-frequency drift amplitude for the shared base path.
        fc.double({ min: 0, max: 0.05, noNaN: true, noDefaultInfinity: true }),
        // Base oscillation amplitude (sequence 1).
        fc.double({ min: 0, max: 0.01, noNaN: true, noDefaultInfinity: true }),
        // Extra oscillation added in sequence 2 (strictly larger).
        fc.double({ min: 0.01, max: 0.05, noNaN: true, noDefaultInfinity: true }),
        (assessedArm, n, wristX, yCenter, driftAmp, baseOsc, extraOsc) => {
          // Shared smooth low-frequency base path (slow half-cycle over the window).
          const basePath: number[] = [];
          for (let i = 0; i < n; i++) {
            const slow = driftAmp * Math.sin((Math.PI * i) / n);
            basePath.push(yCenter + slow);
          }

          // High-frequency oscillation: per-frame sign flip (alternating), the
          // highest resolvable frequency, always surviving detrending.
          const osc = (i: number): number => (i % 2 === 0 ? 1 : -1);

          const seqSmall = basePath.map((y, i) => y + baseOsc * osc(i));
          const seqLarge = basePath.map((y, i) => y + (baseOsc + extraOsc) * osc(i));

          const stabilitySmall = stabilityValue(assessedArm, wristX, seqSmall);
          const stabilityLarge = stabilityValue(assessedArm, wristX, seqLarge);

          // Both must be measurable single-value stability samples.
          expect(stabilitySmall).toBeDefined();
          expect(stabilityLarge).toBeDefined();

          // Inverse monotonicity: the larger-amplitude signal yields
          // smaller-or-equal stability (tiny tolerance for float noise).
          expect(stabilityLarge as number).toBeLessThanOrEqual(
            (stabilitySmall as number) + 1e-9
          );

          // Bounds: both stability values are in (0, 1].
          for (const s of [stabilitySmall as number, stabilityLarge as number]) {
            expect(s).toBeGreaterThan(0);
            expect(s).toBeLessThanOrEqual(1 + 1e-12);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('a constant (non-oscillating) wrist series yields stability ~1', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'left' | 'right'>('left', 'right'),
        fc.integer({ min: 40, max: 100 }),
        fc.double({ min: 0.3, max: 0.7, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.3, max: 0.7, noNaN: true, noDefaultInfinity: true }),
        (assessedArm, n, wristX, wristY) => {
          const constantSeries = new Array(n).fill(wristY);
          const stability = stabilityValue(assessedArm, wristX, constantSeries);
          // amplitude ~0 => stability = 1/(1+0) = 1.
          expect(stability).toBeDefined();
          expect(stability as number).toBeGreaterThan(1 - 1e-6);
          expect(stability as number).toBeLessThanOrEqual(1 + 1e-12);
        }
      ),
      { numRuns: 100 }
    );
  });
});
