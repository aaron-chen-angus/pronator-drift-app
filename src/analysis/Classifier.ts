/**
 * Classifier module — implements the classification precedence table for pronator drift screening.
 *
 * Produces exactly one of seven classification categories per assessment based on:
 * - Drift metrics (sustained downward displacement per arm)
 * - Pronation metrics (palm rotation per arm)
 * - Quality assessment (override to "unable_to_assess" when quality is low)
 *
 * Classification follows strict precedence order defined in the design document.
 * All threshold values are sourced from ConfigStore.
 */

import type { ConfigStore } from '../config/ConfigStore';
import type {
  ArmAssessment,
  OverallClassification,
  QualityAssessment,
  QualityRating,
} from '../types';

// ─── Input Types ─────────────────────────────────────────────────────────────

/** Input data required by the classifier to produce a classification. */
export interface ClassificationInput {
  /** Left arm assessment results */
  leftArm: ArmAssessment;
  /** Right arm assessment results */
  rightArm: ArmAssessment;
  /** Quality assessment for the session */
  quality: QualityAssessment;
}

// ─── Classifier Implementation ───────────────────────────────────────────────

/**
 * Classifies assessment results into exactly one of seven categories.
 *
 * Precedence order (highest to lowest):
 * 1. unable_to_assess — quality is "low" or "unable_to_assess"
 * 2. possible_left_pronator_drift — left arm has sustained drift AND pronation
 * 3. possible_right_pronator_drift — right arm has sustained drift AND pronation
 * 4. possible_bilateral_drift — both arms have sustained drift (regardless of pronation)
 * 5. drift_without_clear_pronation — one/both arms have sustained drift, no pronation
 * 6. possible_pronation_without_drift — pronation detected without significant drift
 * 7. no_significant_drift — neither drift nor pronation meets threshold
 */
export function classify(
  input: ClassificationInput,
  config: ConfigStore
): OverallClassification {
  const { leftArm, rightArm, quality } = input;

  // ── Priority 1: Quality override ─────────────────────────────────────────
  if (isLowQuality(quality.overall)) {
    return 'unable_to_assess';
  }

  // ── Evaluate per-arm drift and pronation status ──────────────────────────
  const leftHasDrift = leftArm.sustainedDownwardDrift;
  const rightHasDrift = rightArm.sustainedDownwardDrift;
  const leftHasPronation = leftArm.possiblePronation;
  const rightHasPronation = rightArm.possiblePronation;

  // ── Priority 2: Possible left pronator drift ─────────────────────────────
  // Requires BOTH sustained drift AND pronation on left arm
  if (leftHasDrift && leftHasPronation) {
    return 'possible_left_pronator_drift';
  }

  // ── Priority 3: Possible right pronator drift ────────────────────────────
  // Requires BOTH sustained drift AND pronation on right arm
  if (rightHasDrift && rightHasPronation) {
    return 'possible_right_pronator_drift';
  }

  // ── Priority 4: Bilateral drift ─────────────────────────────────────────
  // Both arms have sustained drift (regardless of pronation)
  if (leftHasDrift && rightHasDrift) {
    return 'possible_bilateral_drift';
  }

  // ── Priority 5: Drift without clear pronation ───────────────────────────
  // One or both arms have drift, but no pronation on affected arm(s)
  if (leftHasDrift || rightHasDrift) {
    return 'drift_without_clear_pronation';
  }

  // ── Priority 6: Pronation without drift ──────────────────────────────────
  // Pronation detected on one or both arms without significant drift
  if (leftHasPronation || rightHasPronation) {
    return 'possible_pronation_without_drift';
  }

  // ── Priority 7: No significant drift ────────────────────────────────────
  return 'no_significant_drift';
}

/**
 * Determines if the quality rating triggers an "unable_to_assess" override.
 */
function isLowQuality(rating: QualityRating): boolean {
  return rating === 'low' || rating === 'unable_to_assess';
}
