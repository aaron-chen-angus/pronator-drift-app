/**
 * useOrientationEnforcement Hook
 *
 * Detects device orientation (portrait vs landscape) and enforces portrait mode.
 * During an active assessment, landscape triggers an ORIENTATION_CHANGED event
 * to terminate the assessment. Outside of assessment, it blocks UI progression
 * until portrait is restored.
 *
 * Requirements: 18.1, 18.3, 18.4
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import type { AppEvent } from '../types/index';

export interface OrientationEnforcementResult {
  /** Whether the device is currently in landscape orientation */
  isLandscape: boolean;
  /** Whether the assessment is currently active (set externally) */
  isAssessmentActive: boolean;
  /** Set whether the assessment is currently active */
  setAssessmentActive: (active: boolean) => void;
}

/**
 * Custom hook that detects landscape orientation and integrates with the
 * AppEvent system to enforce portrait mode.
 *
 * @param dispatch - Dispatch function for AppEvent (from the state machine).
 *   When landscape is detected during an active assessment, dispatches
 *   ORIENTATION_CHANGED to terminate the assessment.
 *
 * @returns OrientationEnforcementResult with current orientation state
 *   and a setter for assessment-active status.
 */
export function useOrientationEnforcement(
  dispatch: (event: AppEvent) => void
): OrientationEnforcementResult {
  const [isLandscape, setIsLandscape] = useState<boolean>(() =>
    getIsLandscape()
  );
  const [isAssessmentActive, setAssessmentActive] = useState(false);

  // Use a ref so the media query listener always sees the latest value
  const isAssessmentActiveRef = useRef(isAssessmentActive);
  useEffect(() => {
    isAssessmentActiveRef.current = isAssessmentActive;
  }, [isAssessmentActive]);

  const dispatchRef = useRef(dispatch);
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  const handleOrientationChange = useCallback((landscape: boolean) => {
    setIsLandscape(landscape);

    if (landscape && isAssessmentActiveRef.current) {
      // During assessment: terminate via ORIENTATION_CHANGED event
      dispatchRef.current({ type: 'ORIENTATION_CHANGED' });
    }
    // Outside assessment: the isLandscape flag blocks UI progression
    // via the OrientationBlocker component
  }, []);

  useEffect(() => {
    // Use matchMedia for reliable orientation detection
    const mediaQuery = window.matchMedia('(orientation: landscape)');

    const listener = (e: MediaQueryListEvent) => {
      handleOrientationChange(e.matches);
    };

    // Set initial state
    setIsLandscape(mediaQuery.matches);

    // Listen for changes
    mediaQuery.addEventListener('change', listener);

    // Also listen to screen.orientation API if available, as a fallback
    const screenOrientationHandler = () => {
      const landscape = getIsLandscape();
      handleOrientationChange(landscape);
    };

    if (screen.orientation) {
      screen.orientation.addEventListener('change', screenOrientationHandler);
    }

    return () => {
      mediaQuery.removeEventListener('change', listener);
      if (screen.orientation) {
        screen.orientation.removeEventListener(
          'change',
          screenOrientationHandler
        );
      }
    };
  }, [handleOrientationChange]);

  return {
    isLandscape,
    isAssessmentActive,
    setAssessmentActive,
  };
}

/**
 * Utility to check if the device is currently in landscape orientation.
 * Uses screen.orientation when available, falls back to matchMedia.
 */
function getIsLandscape(): boolean {
  // Prefer screen.orientation API
  if (screen.orientation) {
    return screen.orientation.type.startsWith('landscape');
  }
  // Fallback to matchMedia
  return window.matchMedia('(orientation: landscape)').matches;
}
