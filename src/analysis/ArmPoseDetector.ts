/**
 * ArmPoseDetector — pose-first detection of an extended arm for the
 * side-view pronator drift test.
 *
 * The pronator drift test only needs the ARM (shoulder → elbow → wrist), which
 * MediaPipe Pose provides reliably. The hand/finger model is unnecessary for
 * detecting "arm is extended" and often fails from a side view, so we do NOT
 * depend on it here. Hand landmarks remain optional (used later for palm /
 * pronation estimation only).
 *
 * Detection rule (intentionally forgiving):
 *   - The relevant shoulder + elbow + wrist are visible, AND
 *   - the wrist is roughly at shoulder height (not hanging down by the hip),
 *     i.e. the arm is raised/extended rather than resting.
 */

import type { NormalizedLandmark } from '../types';

/** MediaPipe Pose landmark indices. */
export const POSE_IDX = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
} as const;

export interface ArmDetectionResult {
  /** Whether an extended arm was detected. */
  detected: boolean;
  /** Which arm was detected (if any). */
  arm: 'left' | 'right' | null;
  /** Normalized wrist Y (0=top, 1=bottom) of the detected arm, for feedback. */
  wristY: number | null;
}

interface ArmDetectionOptions {
  /** Minimum landmark visibility to trust a joint (0..1). */
  minVisibility?: number;
  /**
   * How far the wrist may sit below the shoulder, as a fraction of the frame
   * height, and still count as "extended at shoulder height". Generous so the
   * test starts easily. Wrist ABOVE the shoulder is always fine.
   */
  maxWristBelowShoulder?: number;
}

/**
 * Detect whether either arm is extended roughly at shoulder height.
 *
 * @param pose  Pose landmarks for one person (33 landmarks) or undefined.
 * @param preferArm  Which arm the current step is testing; that arm is checked
 *                   first, but the other arm still counts so the user isn't
 *                   blocked by left/right confusion in a mirrored view.
 */
export function detectExtendedArm(
  pose: NormalizedLandmark[] | undefined | null,
  preferArm: 'left' | 'right' = 'left',
  options: ArmDetectionOptions = {}
): ArmDetectionResult {
  const minVis = options.minVisibility ?? 0.3;
  const maxBelow = options.maxWristBelowShoulder ?? 0.2;

  if (!pose || pose.length < 17) {
    return { detected: false, arm: null, wristY: null };
  }

  const check = (arm: 'left' | 'right'): number | null => {
    const s = arm === 'left' ? pose[POSE_IDX.leftShoulder] : pose[POSE_IDX.rightShoulder];
    const e = arm === 'left' ? pose[POSE_IDX.leftElbow] : pose[POSE_IDX.rightElbow];
    const w = arm === 'left' ? pose[POSE_IDX.leftWrist] : pose[POSE_IDX.rightWrist];

    if (!s || !e || !w) return null;

    const vis = (lm: NormalizedLandmark) => lm.visibility === undefined || lm.visibility >= minVis;
    if (!vis(s) || !vis(e) || !vis(w)) return null;

    // Wrist should not hang well below the shoulder (that would be a resting
    // arm). Above the shoulder or near shoulder height is accepted.
    if (w.y - s.y > maxBelow) return null;

    return w.y;
  };

  // Check the preferred arm first, then the other.
  const order: Array<'left' | 'right'> =
    preferArm === 'left' ? ['left', 'right'] : ['right', 'left'];

  for (const arm of order) {
    const wristY = check(arm);
    if (wristY !== null) {
      return { detected: true, arm, wristY };
    }
  }

  return { detected: false, arm: null, wristY: null };
}

/**
 * Detect whether BOTH arms are extended roughly at shoulder height, as required
 * by the front-facing pronator drift test (subject faces the camera, both arms
 * out in front, palms up, eyes closed).
 *
 * Returns per-arm detection plus an overall `bothDetected` flag. The wrist-height
 * rule is the same forgiving rule used by {@link detectExtendedArm}.
 */
export function detectBothArmsExtended(
  pose: NormalizedLandmark[] | undefined | null,
  options: ArmDetectionOptions = {}
): { left: boolean; right: boolean; bothDetected: boolean } {
  const minVis = options.minVisibility ?? 0.3;
  const maxBelow = options.maxWristBelowShoulder ?? 0.25;

  if (!pose || pose.length < 17) {
    return { left: false, right: false, bothDetected: false };
  }

  const check = (arm: 'left' | 'right'): boolean => {
    const s = arm === 'left' ? pose[POSE_IDX.leftShoulder] : pose[POSE_IDX.rightShoulder];
    const e = arm === 'left' ? pose[POSE_IDX.leftElbow] : pose[POSE_IDX.rightElbow];
    const w = arm === 'left' ? pose[POSE_IDX.leftWrist] : pose[POSE_IDX.rightWrist];
    if (!s || !e || !w) return false;
    const vis = (lm: NormalizedLandmark) => lm.visibility === undefined || lm.visibility >= minVis;
    if (!vis(s) || !vis(e) || !vis(w)) return false;
    if (w.y - s.y > maxBelow) return false;
    return true;
  };

  const left = check('left');
  const right = check('right');
  return { left, right, bothDetected: left && right };
}
