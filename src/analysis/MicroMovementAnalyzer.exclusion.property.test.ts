// Feature: pronator-drift-analysis, Property 2: Invalid frames are excluded from position-based series
//
// **Validates: Requirements 2.6, 4.6, 6.6, 8.2, 15.2**
//
// Property 2: Invalid frames are excluded from position-based series
//
// For any window mixing frames with and without assessed-arm pose landmarks (and
// with and without hand landmarks), every frame lacking the landmarks required for
// a position-based indicator SHALL be marked excluded (hasPose=false) and thus
// absent from position-based series.
//
// This test focuses on the pose-landmark-presence exclusion that IS implemented in
// the current analyzer (Task 2.1): frames missing the assessed-arm shoulder/elbow/
// wrist are captured but flagged hasPose=false with null shoulder/elbow/wrist, while
// complete frames are flagged hasPose=true with populated landmarks.
//
// NOTE: finalize()'s low-confidence-interval exclusion (occlusionGracePeriod) is a
// stub in the analyzer (implemented by later tasks). It is therefore not asserted
// here; this property validates the pose-landmark-presence exclusion path only.

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

const HAND_LANDMARK_COUNT = 21;

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Create a normalized landmark with given position and visibility. */
function makeLandmark(
  x: number,
  y: number,
  z: number = 0,
  visibility: number = 0.9
): NormalizedLandmark {
  return { x, y, z, visibility };
}

/** Build a minimal ArmBaseline for constructing a valid Baseline. */
function makeArmBaseline(): ArmBaseline {
  return {
    shoulderPos: { x: 0.6, y: 0.4, z: 0 },
    elbowPos: { x: 0.7, y: 0.4, z: 0 },
    wristPos: { x: 0.8, y: 0.4, z: 0 },
    normalizedWristHeight: 0.5,
    elbowExtensionAngle: 180,
    palmOrientationAngle: 0,
    armLength: 0.2,
  };
}

/** Build a minimal valid Baseline for start(). */
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
 * Build a full 33-landmark pose set with the assessed arm's shoulder/elbow/wrist
 * present at distinct positions. Optionally omit the arm landmarks (to simulate a
 * frame lacking required pose landmarks) or set visibility.
 */
function makePoseSet(
  assessedArm: 'left' | 'right',
  opts: {
    includeArm: boolean;
    shoulderPos?: [number, number];
    elbowPos?: [number, number];
    wristPos?: [number, number];
    visibility?: number;
  }
): NormalizedLandmark[] {
  const vis = opts.visibility ?? 0.9;
  // Fill non-arm landmarks with a neutral position so their presence never
  // affects the assessed-arm pose-presence decision.
  const set: NormalizedLandmark[] = Array.from({ length: 33 }, () =>
    makeLandmark(0.5, 0.5, 0, vis)
  );
  const idx = POSE_INDICES[assessedArm];
  if (opts.includeArm) {
    const [sx, sy] = opts.shoulderPos ?? [0.6, 0.4];
    const [ex, ey] = opts.elbowPos ?? [0.7, 0.45];
    const [wx, wy] = opts.wristPos ?? [0.8, 0.5];
    set[idx.shoulder] = makeLandmark(sx, sy, 0, vis);
    set[idx.elbow] = makeLandmark(ex, ey, 0, vis);
    set[idx.wrist] = makeLandmark(wx, wy, 0, vis);
    set[idx.hip] = makeLandmark(0.55, 0.7, 0, vis);
  } else {
    // Explicitly clear the assessed-arm shoulder/elbow/wrist so the frame lacks
    // the required position landmarks. We do this by removing entries such that
    // indexing returns undefined for these positions.
    // Using a sparse-ish array: reassign to a shorter array is unsafe, so instead
    // we place `undefined` by constructing a new array copy with holes.
    const withHoles = set.slice();
    // Delete creates holes -> withHoles[idx] === undefined
    delete (withHoles as (NormalizedLandmark | undefined)[])[idx.shoulder];
    delete (withHoles as (NormalizedLandmark | undefined)[])[idx.elbow];
    delete (withHoles as (NormalizedLandmark | undefined)[])[idx.wrist];
    return withHoles as NormalizedLandmark[];
  }
  return set;
}

/** Build 21 hand landmarks. */
function makeHandLandmarks(): NormalizedLandmark[] {
  return Array.from({ length: HAND_LANDMARK_COUNT }, (_, i) =>
    makeLandmark(0.5 + i * 0.001, 0.5 + i * 0.001, 0, 0.9)
  );
}

/**
 * Specification for a single generated frame in the mixed window.
 */
interface FrameSpec {
  /** Whether the frame includes the assessed-arm pose landmarks. */
  hasPose: boolean;
  /** Whether the frame includes a hand matching the assessed-arm handedness. */
  hasHand: boolean;
  /** Landmark visibility for the frame. */
  visibility: number;
}

/** Build a CVFrameResult from a FrameSpec for the given assessed arm. */
function makeFrame(
  assessedArm: 'left' | 'right',
  timestamp: number,
  spec: FrameSpec
): CVFrameResult {
  const poseSet = makePoseSet(assessedArm, {
    includeArm: spec.hasPose,
    visibility: spec.visibility,
  });

  let handLandmarks: NormalizedLandmark[][] | null = null;
  let handedness: Handedness[] | null = null;
  if (spec.hasHand) {
    const label = assessedArm === 'left' ? 'Left' : 'Right';
    handLandmarks = [makeHandLandmarks()];
    handedness = [{ label, score: 0.95 }];
  }

  return {
    timestamp,
    poseLandmarks: [poseSet],
    poseWorldLandmarks: null,
    handLandmarks,
    handedness,
    processingTimeMs: 16,
  };
}

// ─── Generators ──────────────────────────────────────────────────────────────

const frameSpecArb: fc.Arbitrary<FrameSpec> = fc.record({
  hasPose: fc.boolean(),
  hasHand: fc.boolean(),
  visibility: fc.double({ min: 0.1, max: 1.0, noNaN: true, noDefaultInfinity: true }),
});

const assessedArmArb: fc.Arbitrary<'left' | 'right'> = fc.constantFrom('left', 'right');

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 2: Invalid frames are excluded from position-based series', () => {
  it('frames lacking assessed-arm pose landmarks are marked hasPose=false with null shoulder/elbow/wrist; complete frames are hasPose=true with populated landmarks', () => {
    fc.assert(
      fc.property(
        assessedArmArb,
        fc.array(frameSpecArb, { minLength: 1, maxLength: 40 }),
        (assessedArm, specs) => {
          const config = new ConfigStore();
          const analyzer = new MicroMovementAnalyzer(config);
          analyzer.start(makeBaseline(), assessedArm);

          specs.forEach((spec, i) => {
            analyzer.addFrame(makeFrame(assessedArm, 1000 + i * 33, spec));
          });

          const captured = analyzer.getCapturedFrames();

          // Every delivered frame is captured, in order (Req 2.6 — captured but excluded).
          expect(captured.length).toBe(specs.length);

          captured.forEach((frame, i) => {
            const spec = specs[i];
            if (spec.hasPose) {
              // Complete frame: included in position-based series.
              expect(frame.hasPose).toBe(true);
              expect(frame.shoulder).not.toBeNull();
              expect(frame.elbow).not.toBeNull();
              expect(frame.wrist).not.toBeNull();
            } else {
              // Frame lacking required landmarks: excluded from position-based series.
              expect(frame.hasPose).toBe(false);
              expect(frame.shoulder).toBeNull();
              expect(frame.elbow).toBeNull();
              expect(frame.wrist).toBeNull();
            }
          });
        }
      ),
      { numRuns: 200 }
    );
  });

  it('the count of position-eligible captured frames (hasPose=true) equals the count of delivered frames that had the required pose landmarks, independent of hand presence', () => {
    fc.assert(
      fc.property(
        assessedArmArb,
        fc.array(frameSpecArb, { minLength: 1, maxLength: 40 }),
        (assessedArm, specs) => {
          const config = new ConfigStore();
          const analyzer = new MicroMovementAnalyzer(config);
          analyzer.start(makeBaseline(), assessedArm);

          specs.forEach((spec, i) => {
            analyzer.addFrame(makeFrame(assessedArm, 2000 + i * 33, spec));
          });

          const captured = analyzer.getCapturedFrames();

          const expectedIncluded = specs.filter((s) => s.hasPose).length;
          const actualIncluded = captured.filter((f) => f.hasPose).length;

          // Only frames with the required pose landmarks contribute to the
          // position-based series; hand presence must not change this count.
          expect(actualIncluded).toBe(expectedIncluded);

          // Excluded frames account for the remainder (all captured, none dropped).
          const excluded = captured.filter((f) => !f.hasPose).length;
          expect(actualIncluded + excluded).toBe(specs.length);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('excluded (hasPose=false) frames never contribute non-null position landmarks even when a matching hand is present', () => {
    fc.assert(
      fc.property(
        assessedArmArb,
        // Force no pose, but let hand presence vary — a frame with only a hand and
        // no assessed-arm pose must still be excluded from position-based series.
        fc.array(
          fc.record({
            hasPose: fc.constant(false),
            hasHand: fc.boolean(),
            visibility: fc.double({
              min: 0.1,
              max: 1.0,
              noNaN: true,
              noDefaultInfinity: true,
            }),
          }),
          { minLength: 1, maxLength: 30 }
        ),
        (assessedArm, specs) => {
          const config = new ConfigStore();
          const analyzer = new MicroMovementAnalyzer(config);
          analyzer.start(makeBaseline(), assessedArm);

          specs.forEach((spec, i) => {
            analyzer.addFrame(makeFrame(assessedArm, 3000 + i * 33, spec));
          });

          const captured = analyzer.getCapturedFrames();

          // No captured frame should be position-eligible.
          expect(captured.every((f) => f.hasPose === false)).toBe(true);
          for (const frame of captured) {
            expect(frame.shoulder).toBeNull();
            expect(frame.elbow).toBeNull();
            expect(frame.wrist).toBeNull();
            expect(frame.hip).toBeNull();
            expect(frame.poseConfidence).toBe(0);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
