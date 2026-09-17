/**
 * React context exposing a single shared AssessmentSession instance to every
 * screen in the workflow, so the camera stream, CV worker, calibration baseline,
 * and assessment loop are all shared rather than recreated per screen.
 */

import { createContext, useContext, useRef, type ReactNode } from 'react';
import { AssessmentSession } from './AssessmentSession';

const AssessmentSessionContext = createContext<AssessmentSession | null>(null);

export function AssessmentSessionProvider({ children }: { children: ReactNode }) {
  const ref = useRef<AssessmentSession | null>(null);
  if (ref.current === null) {
    ref.current = new AssessmentSession();
  }
  return (
    <AssessmentSessionContext.Provider value={ref.current}>
      {children}
    </AssessmentSessionContext.Provider>
  );
}

/** Access the shared AssessmentSession. Throws if used outside the provider. */
export function useAssessmentSession(): AssessmentSession {
  const session = useContext(AssessmentSessionContext);
  if (!session) {
    throw new Error('useAssessmentSession must be used within AssessmentSessionProvider');
  }
  return session;
}

/**
 * Non-throwing variant: returns the shared session, or `null` when no provider
 * is present (e.g. isolated component tests that don't exercise analysis).
 */
export function useOptionalAssessmentSession(): AssessmentSession | null {
  return useContext(AssessmentSessionContext);
}
