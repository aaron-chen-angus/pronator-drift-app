// Feature: pronator-drift-analysis, Property 16: Reported changes are offsets from baseline
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
const POSE_INDICES = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24 },
} as const;

const POSE_LANDMARK_COUNT = 33;
const HAND_LANDMARK_COUNT = 21;
/** High visibility so poseConfidence (mean of shoulder/elbow/wrist) clears minPoseConfidence (default 0.5). */
const HIGH_VIS = 0.9;
const FRAME_INTERVAL_MS = 33; // ~30 fps
const ARM_LENGTH = 0.25;

// ─── Finger-metric index reference (must match MicroMovementAnalyzer) ─────────
// Curl uses per-finger [MCP, TIP] pairs (index/middle/ring/pinky), wrist=0.
const FINGER_MCP_TIP_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [5, 8],
  [9, 12],
  [13, 16],
  [17, 20],
];
// Spread uses adjacent MCP distances (index/middle/ring/pinky), normalized by
// wrist(0)->middle-MCP(9) palm length.
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

// ─── Raw metric replicas (must mirror MicroMovementAnalyzer definitions) ──────

function dist2D(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Replica of MicroMovementAnalyzer.computeFingerCurl. */
function rawFingerCurl(hand: NormalizedLandmark[]): number {
  const wrist = hand[0];
  const ratios: number[] = [];
  for (const [mcpIdx, tipIdx] of FINGER_MCP_TIP_PAIRS) {
    const mcp = hand[mcpIdx];
    const tip = hand[tipIdx];
    if (!mcp || !tip) continue;
    const mcpReach = dist2D(wrist, mcp);
    if (mcpReach === 0) continue;
    const tipReach = dist2D(wrist, tip);
    ratios.push(tipReach / mcpReach);
  }
  if (ratios.length === 0) return 0;
  const meanReach = ratios.reduce((s, v) => s + v, 0) / ratios.length;
  return 1 - meanReach;
}

/** Replica of MicroMovementAnalyzer.computeFingerSpread. */
function rawFingerSpread(hand: NormalizedLandmark[]): number {
  const wrist = hand[0];
  const middleMcp = hand[MCP_INDICES[1]];
  const palmLength = middleMcp ? dist2D(wrist, middleMcp) : 0;
  let total = 0;
  let count = 0;
  for (let i = 1; i < MCP_INDICES.length; i++) {
    const prev = hand[MCP_INDICES[i - 1]];
    const cur = hand[MCP_INDICES[i]];
    if (!prev || !cur) continue;
    total += dist2D(prev, cur);
    count += 1;
  }
  if (count === 0) return 0;
  const meanAdjacent = total / count;
  return palmLength > 0 ? meanAdjacent / palmLength : meanAdjacent;
}

// ─── Hand-landmark generator ──────────────────────────────────────────────────

/**
 * Build a full 21-point hand. Index 0 is the wrist; the remaining 20 points are
 * placed at generator-provided positions. Positions are kept in a valid, distinct
 * range so palm length / MCP reaches are non-degenerate for typical draws.
 */
function makeHand(points: Array<{ x: number; y: number }>): NormalizedLandmark[] {
  const hand: NormalizedLandmark[] = new Array(HAND_LANDMARK_COUNT);
  for (let i = 0; i < HAND_LANDMARK_COUNT; i++) {
    const p = points[i];
    hand[i] = lm(p.x, p.y);
  }
  return hand;
}

const handPoint = (): fc.Arbitrary<{ x: number; y: number }> =>
  fc.record({
    x: fc.double({ min: 0.2, max: 0.8, noNaN: true, noDefaultInfinity: true }),
    y: fc.double({ min: 0.2, max: 0.8, noNaN: true, noDefaultInfinity: true }),
  });

/** A 21-point hand where the wrist is fixed and other points are generated. */
const handArb = (): fc.Arbitrary<NormalizedLandmark[]> =>
  fc
    .array(handPoint(), { minLength: HAND_LANDMARK_COUNT, maxLength: HAND_LANDMARK_COUNT })
    .map((points) => {
      // Fix the wrist away from the MCPs so palm length is non-degenerate.
      const pts = [...points];
      pts[0] = { x: 0.5, y: 0.9 };
      return makeHand(pts);
    });

// ─── Frame construction ───────────────────────────────────────────────────────

/**
 * Build a confident CV frame with assessed-arm pose landmarks and a
 * matching-handedness hand (21 points). High visibility guarantees the frame is
 * a confident, pose-bearing frame that also has hand data.
 */
function makeFrame(
  assessedArm: 'left' | 'right',
  timestamp: number,
  hand: NormalizedLandmark[]
): CVFrameResult {
  const idx = POSE_INDICES[assessedArm];
  const pose: NormalizedLandmark[] = new Array(POSE_LANDMARK_COUNT)
    .fill(null)
    .map(() => lm(0.5, 0.5));
  pose[idx.shoulder] = lm(0.4, 0.3);
  pose[idx.elbow] = lm(0.45, 0.5);
  pose[idx.hip] = lm(0.4, 0.8);
  pose[idx.wrist] = lm(0.5, 0.6);

  const label: 'Left' | 'Right' = assessedArm === 'left' ? 'Left' : 'Right';
  const handedness: Handedness[] = [{ label, score: 0.95 }];

  return {
    timestamp,
    poseLandmarks: [pose],
    poseWorldLandmarks: null,
    handLandmarks: [hand],
    handedness,
    processingTimeMs: 16,
  };
}

// ─── Property 16: Reported changes are offsets from baseline ─────────────────

/**
 * **Validates: Requirements 7.3**
 *
 * Property 16: Reported changes are offsets from baseline.
 *
 * The reported finger-curl change and finger-spread change for each frame equal
 * that frame's raw finger-curl / finger-spread value minus the baseline value
 * (the value from the FIRST hand frame). Therefore:
 *   - the first hand frame's change sample is exactly 0, and
 *   - each subsequent sample equals raw(frame) - raw(firstHandFrame).
 *
 * All frames are confident (assessed-arm pose visibility >= 0.5) and carry a
 * matching-handedness 21-point hand, so every frame is a valid, measurable
 * finger-metric frame.
 */
describe('Property 16: Reported changes are offsets from baseline', () => {
  it('finger curl/spread change samples equal raw value minus first-hand-frame baseline', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'left' | 'right'>('left', 'right'),
        // A sequence of hands, one per frame (>= 1 so a baseline frame exists).
        fc.array(handArb(), { minLength: 1, maxLength: 30 }),
        (assessedArm, hands) => {
          const config = new ConfigStore();
          const analyzer = new MicroMovementAnalyzer(config);
          analyzer.start(makeBaseline(), assessedArm);
          hands.forEach((hand, i) => {
            analyzer.addFrame(makeFrame(assessedArm, i * FRAME_INTERVAL_MS, hand));
          });

          const indicators = analyzer.finalize();
          const curl = indicators.fingerCurlChange;
          const spread = indicators.fingerSpreadChange;

          // Every frame is confident with a matching hand -> measurable, one
          // sample per frame in delivery order.
          expect(curl.measurable).toBe(true);
          expect(spread.measurable).toBe(true);
          expect(curl.samples).toHaveLength(hands.length);
          expect(spread.samples).toHaveLength(hands.length);

          const baselineCurl = rawFingerCurl(hands[0]);
          const baselineSpread = rawFingerSpread(hands[0]);

          // First hand frame is the baseline: its change sample is exactly 0.
          expect(curl.samples[0].value).toBe(0);
          expect(spread.samples[0].value).toBe(0);

          // Each sample equals raw(frame) - raw(firstHandFrame).
          for (let i = 0; i < hands.length; i++) {
            const expectedCurl = rawFingerCurl(hands[i]) - baselineCurl;
            const expectedSpread = rawFingerSpread(hands[i]) - baselineSpread;
            expect(curl.samples[i].value).toBeCloseTo(expectedCurl, 12);
            expect(spread.samples[i].value).toBeCloseTo(expectedSpread, 12);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
