/**
 * useOrientationEnforcement Hook
 *
 * Detects device orientation and ENCOURAGES landscape mode for the side-view
 * pronator drift test. Shows a gentle prompt when in portrait, but does NOT
 * block usage entirely.
 *
 * In the new side-view approach, landscape is the preferred orientation since
 * the phone is placed to the user's side with the camera capturing their profile.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import type { AppEvent } from '../types/index';

export interface OrientationEnforcementResult {
  /** Whether the device is currently in portrait orientation (non-preferred) */
  isPortrait: boolean;
  /** Whether the device is currently in landscape orientation (preferred) */
  isLandscape: boolean;
  /** Whether the assessment is currently active (set externally) */
  isAssessmentActive: boolean;
  /** Set whether the assessment is currently active */
  setAssessmentActive: (active: boolean) => void;
}

/**
 * Custom hook that detects orientation and encourages landscape mode.
 *
 * @param dispatch - Dispatch function for AppEvent (from the state machine).
 *   When portrait is detected during an active assessment, dispatches
 *   ORIENTATION_CHANGED to warn the user.
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

    // If switched to PORTRAIT during an active assessment, warn
    if (!landscape && isAssessmentActiveRef.current) {
      dispatchRef.current({ type: 'ORIENTATION_CHANGED' });
    }
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
    isPortrait: !isLandscape,
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
