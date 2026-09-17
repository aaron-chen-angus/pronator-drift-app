// Feature: pronator-drift-analysis, Property 15: Finger metrics track physical change
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
  Vec3,
} from '../types';

// ─── Landmark index reference (from design.md) ───────────────────────────────
// Pose: shoulders 11/12, elbows 13/14, wrists 15/16, hips 23/24.
// Hand: 21 points (0..20). wrist = 0; MCPs = 5/9/13/17; TIPs = 8/12/16/20.

const POSE_INDICES = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24 },
} as const;

const HAND_LANDMARK_COUNT = 21;
const POSE_LANDMARK_COUNT = 33;

/** Finger [MCP, TIP] index pairs used by the analyzer's finger-curl metric. */
const FINGER_MCP_TIP_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [5, 8],
  [9, 12],
  [13, 16],
  [17, 20],
] as const;

/** MCP indices used by the analyzer's finger-spread metric. */
const MCP_INDICES = [5, 9, 13, 17] as const;

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
    armLength: 0.2,
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

// ─── Frame construction helpers ──────────────────────────────────────────────

/**
 * Build a high-confidence 33-entry pose landmark array whose assessed-arm
 * shoulder/elbow/wrist/hip are all visible (visibility 1.0) so the frame passes
 * the `isConfidentFrame` gate (poseConfidence >= minPoseConfidence = 0.5).
 */
function makeConfidentPose(assessedArm: 'left' | 'right'): NormalizedLandmark[] {
  const pose: NormalizedLandmark[] = [];
  for (let i = 0; i < POSE_LANDMARK_COUNT; i++) {
    pose.push({ x: 0, y: 0, z: 0, visibility: 1 });
  }
  const idx = POSE_INDICES[assessedArm];
  // Give the assessed arm a simple bent-elbow geometry with full visibility.
  pose[idx.shoulder] = { x: 0.5, y: 0.3, z: 0, visibility: 1 };
  pose[idx.elbow] = { x: 0.6, y: 0.5, z: 0, visibility: 1 };
  pose[idx.wrist] = { x: 0.7, y: 0.5, z: 0, visibility: 1 };
  pose[idx.hip] = { x: 0.5, y: 0.8, z: 0, visibility: 1 };
  return pose;
}

/**
 * Build a full 21-point hand for the given curl/spread configuration.
 *
 * Geometry: the wrist sits at the origin; fingers fan out along +y. Each finger i
 * has its MCP at (spread * i, mcpReach) and its TIP at (spread * i, tipReach).
 * The thumb (indices 1..4) is placed but is excluded from both metrics.
 *
 * - Larger `tipReach` (relative to `mcpReach`) => tips reach farther past the
 *   MCPs => LOWER curl (more extended). Smaller `tipReach` => HIGHER curl.
 * - Larger `spread` => MCPs farther apart => HIGHER finger spread.
 *
 * PIP/DIP joints (unused by the metrics) are interpolated along the finger.
 */
function makeHand(mcpReach: number, tipReach: number, spread: number): NormalizedLandmark[] {
  const hand: NormalizedLandmark[] = [];
  for (let i = 0; i < HAND_LANDMARK_COUNT; i++) {
    hand.push({ x: 0, y: 0, z: 0, visibility: 1 });
  }
  // Wrist at origin.
  hand[0] = { x: 0, y: 0, z: 0, visibility: 1 };

  // Thumb (1 CMC, 2 MCP, 3 IP, 4 TIP) — placed off to the side, excluded from metrics.
  hand[1] = { x: -0.02, y: 0.01, z: 0, visibility: 1 };
  hand[2] = { x: -0.03, y: 0.02, z: 0, visibility: 1 };
  hand[3] = { x: -0.04, y: 0.03, z: 0, visibility: 1 };
  hand[4] = { x: -0.05, y: 0.04, z: 0, visibility: 1 };

  // Four fingers: index/middle/ring/pinky.
  FINGER_MCP_TIP_PAIRS.forEach(([mcpIdx, tipIdx], f) => {
    const x = spread * f;
    hand[mcpIdx] = { x, y: mcpReach, z: 0, visibility: 1 };
    hand[tipIdx] = { x, y: tipReach, z: 0, visibility: 1 };
    // Fill PIP (mcp+1) and DIP (mcp+2) as interpolations (unused by metrics).
    hand[mcpIdx + 1] = {
      x,
      y: mcpReach + (tipReach - mcpReach) / 3,
      z: 0,
      visibility: 1,
    };
    hand[mcpIdx + 2] = {
      x,
      y: mcpReach + (2 * (tipReach - mcpReach)) / 3,
      z: 0,
      visibility: 1,
    };
  });

  return hand;
}

/** Assemble a confident CVFrameResult carrying the assessed-arm pose and hand. */
function makeFrame(
  timestamp: number,
  assessedArm: 'left' | 'right',
  hand: NormalizedLandmark[]
): CVFrameResult {
  const label: 'Left' | 'Right' = assessedArm === 'left' ? 'Left' : 'Right';
  const handedness: Handedness[] = [{ label, score: 0.95 }];
  return {
    timestamp,
    poseLandmarks: [makeConfidentPose(assessedArm)],
    poseWorldLandmarks: null,
    handLandmarks: [hand],
    handedness,
    processingTimeMs: 16,
  };
}

/**
 * Run the analyzer over two confident hand frames (baseline then test) and
 * return the reported finger-curl and finger-spread changes for the second
 * frame. Finger indicators are reported as per-frame offsets from the first hand
 * frame (baseline contributes sample 0 with change 0); the frame-1 sample value
 * is therefore the change of the test configuration relative to the baseline.
 */
function runTwoFrame(
  assessedArm: 'left' | 'right',
  baselineHand: NormalizedLandmark[],
  testHand: NormalizedLandmark[]
): { curlChange: number; spreadChange: number } {
  const config = new ConfigStore();
  const analyzer = new MicroMovementAnalyzer(config);
  analyzer.start(makeBaseline(), assessedArm);
  analyzer.addFrame(makeFrame(0, assessedArm, baselineHand));
  analyzer.addFrame(makeFrame(100, assessedArm, testHand));
  const result = analyzer.finalize();

  const curlSamples = result.fingerCurlChange.samples;
  const spreadSamples = result.fingerSpreadChange.samples;
  expect(curlSamples).toHaveLength(2);
  expect(spreadSamples).toHaveLength(2);
  // Sample 0 is the baseline (change 0); sample 1 is the test-config change.
  expect(curlSamples[0].value).toBeCloseTo(0, 9);
  expect(spreadSamples[0].value).toBeCloseTo(0, 9);

  return {
    curlChange: curlSamples[1].value,
    spreadChange: spreadSamples[1].value,
  };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const positive = (min: number, max: number): fc.Arbitrary<number> =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

// ─── Property 15: Finger metrics track physical change ───────────────────────

/**
 * **Validates: Requirements 7.1, 7.2**
 *
 * Property 15: Finger metrics track physical change
 *
 * For any pair of hand poses, a more-flexed (curled) hand yields a finger-curl
 * value no smaller than a more-extended hand; MCP landmarks spread farther apart
 * yield a finger-spread value no smaller than MCP landmarks brought closer
 * together.
 *
 * Because finger indicators are reported as offsets from the first hand frame
 * (baseline), we verify the ordering by making frame 0 one configuration and
 * frame 1 the other, then asserting the reported frame-1 change respects the
 * physical ordering (>= 0 when the second frame is more curled / more spread,
 * and <= 0 when reversed). fast-check randomizes the magnitude of the difference
 * while preserving the ordering.
 */
describe('Property 15: Finger metrics track physical change', () => {
  it('a more-flexed hand yields finger-curl no smaller than a more-extended hand', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'left' | 'right'>('left', 'right'),
        // Shared MCP reach and fixed spread so only curl differs.
        positive(0.05, 0.2), // mcpReach
        positive(0.02, 0.06), // spread (fixed across the two hands)
        // Two tip reaches with a strict ordering: extended reaches farther than curled.
        positive(0.05, 0.4), // tipReachA
        positive(0.05, 0.4), // tipReachB
        (assessedArm, mcpReach, spread, tipReachA, tipReachB) => {
          // extendedTip has the LARGER tip reach (tips far past MCP => lower curl).
          const extendedTip = Math.max(tipReachA, tipReachB);
          const curledTip = Math.min(tipReachA, tipReachB);

          const extendedHand = makeHand(mcpReach, extendedTip, spread);
          const curledHand = makeHand(mcpReach, curledTip, spread);

          // Frame0 = extended (baseline), Frame1 = curled: change should be >= 0.
          const forward = runTwoFrame(assessedArm, extendedHand, curledHand);
          expect(forward.curlChange).toBeGreaterThanOrEqual(-1e-9);

          // Reverse ordering: Frame0 = curled (baseline), Frame1 = extended: <= 0.
          const reverse = runTwoFrame(assessedArm, curledHand, extendedHand);
          expect(reverse.curlChange).toBeLessThanOrEqual(1e-9);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('MCP landmarks spread farther apart yield finger-spread no smaller than closer MCPs', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'left' | 'right'>('left', 'right'),
        positive(0.05, 0.2), // mcpReach (fixed across the two hands => equal palm length)
        positive(0.1, 0.4), // tipReach (fixed; irrelevant to spread)
        // Two adjacent-MCP spacings with a strict ordering.
        positive(0.01, 0.08), // spreadA
        positive(0.01, 0.08), // spreadB
        (assessedArm, mcpReach, tipReach, spreadA, spreadB) => {
          const wideSpread = Math.max(spreadA, spreadB);
          const narrowSpread = Math.min(spreadA, spreadB);

          const wideHand = makeHand(mcpReach, tipReach, wideSpread);
          const narrowHand = makeHand(mcpReach, tipReach, narrowSpread);

          // Frame0 = narrow (baseline), Frame1 = wide: spread change should be >= 0.
          const forward = runTwoFrame(assessedArm, narrowHand, wideHand);
          expect(forward.spreadChange).toBeGreaterThanOrEqual(-1e-9);

          // Reverse ordering: Frame0 = wide (baseline), Frame1 = narrow: <= 0.
          const reverse = runTwoFrame(assessedArm, wideHand, narrowHand);
          expect(reverse.spreadChange).toBeLessThanOrEqual(1e-9);
        }
      ),
      { numRuns: 100 }
    );
  });
});
