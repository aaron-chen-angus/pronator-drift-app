/**
 * PrivacyManager — Implements the privacy-first architecture for the
 * pronator drift screening application.
 *
 * Responsibilities:
 * - Generate random UUID assessment identifiers (no personal info)
 * - Store assessment results in localStorage
 * - Delete stored assessment data from localStorage
 * - Retrieve stored assessments
 *
 * Privacy guarantees enforced by architecture:
 * - No video/images/landmarks are transmitted to any server
 * - No account creation required
 * - No face recognition or identity matching
 * - No inference of age, ethnicity, emotion, or unrelated personal characteristics
 * - Assessment IDs are random UUIDs with no personal info
 *
 * Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 19.9
 */

import { v4 as uuidv4 } from 'uuid';
import type { PronatorDriftAssessment } from '../types/index';

/** localStorage key for stored assessment results. */
const STORAGE_KEY = 'pronator_drift_assessments';

/**
 * Generates a random UUID v4 assessment identifier.
 * Contains no personal information — purely random.
 *
 * @returns A random UUID string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 */
export function generateAssessmentId(): string {
  return uuidv4();
}

/**
 * Stores an assessment result in localStorage.
 * Only stores the processed assessment data — never raw video, images, or landmarks.
 *
 * @param assessment - The completed assessment result to store
 */
export function storeAssessment(assessment: PronatorDriftAssessment): void {
  const existing = getStoredAssessments();
  existing.push(assessment);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

/**
 * Retrieves all stored assessment results from localStorage.
 *
 * @returns Array of stored assessment results, or empty array if none exist
 */
export function getStoredAssessments(): PronatorDriftAssessment[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as PronatorDriftAssessment[];
  } catch {
    return [];
  }
}

/**
 * Deletes all stored assessment data from localStorage.
 * Provides the user with full control over their locally stored data.
 *
 * @returns true if data was deleted, false if no data existed
 */
export function deleteAllAssessmentData(): boolean {
  const existing = localStorage.getItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_KEY);
  return existing !== null;
}

/**
 * Deletes a specific assessment by its ID from localStorage.
 *
 * @param assessmentId - The UUID of the assessment to delete
 * @returns true if the assessment was found and deleted, false otherwise
 */
export function deleteAssessmentById(assessmentId: string): boolean {
  const assessments = getStoredAssessments();
  const filtered = assessments.filter(a => a.assessmentId !== assessmentId);
  if (filtered.length === assessments.length) {
    return false;
  }
  if (filtered.length === 0) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  }
  return true;
}

/**
 * Privacy notice text displayed before camera access is requested.
 * Requirement 19.8: Must be shown before camera permission request.
 */
export const PRIVACY_NOTICE_TEXT =
  'All video processing occurs on your device. No video, images, or movement data is transmitted to any server. Assessment results are stored locally and can be deleted at any time.';
