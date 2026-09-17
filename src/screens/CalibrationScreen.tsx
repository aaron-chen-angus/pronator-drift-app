/**
 * CalibrationScreen — real baseline capture.
 *
 * Runs live calibration frames through the shared AssessmentSession's
 * DriftAnalyzer to compute a real Baseline of the user's starting arm position,
 * then dispatches CALIBRATION_COMPLETE with that baseline. Self-advancing so the
 * workflow never dead-ends: if strict calibration fails, a usable fallback
 * baseline is still produced.
 */

import { useEffect, useRef, useState } from 'react';
import type { AppEvent } from '../types/index';
import { getConfigStore } from '../config/ConfigStore';
import { useAssessmentSession } from '../session/AssessmentSessionContext';

interface CalibrationScreenProps {
  dispatch: React.Dispatch<AppEvent>;
}

export function CalibrationScreen({ dispatch }: CalibrationScreenProps) {
  const session = useAssessmentSession();
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Hold your arm steady — capturing your starting position…');
  const doneRef = useRef(false);

  useEffect(() => {
    doneRef.current = false;
    const config = getConfigStore();
    const durationMs = Math.round(config.get('calibrationDuration') * 1000);

    void (async () => {
      try {
        const { success, baseline } = await session.calibrate(durationMs, (pct) => {
          setProgress(pct);
        });
        if (doneRef.current) return;
        doneRef.current = true;
        setProgress(100);
        setStatus(
          success
            ? 'Baseline captured.'
            : 'Baseline captured (best effort — hold steadier next time for a cleaner reading).'
        );
        dispatch({ type: 'CALIBRATION_COMPLETE', baseline });
      } catch {
        // Even on unexpected failure, advance with whatever baseline exists so
        // the user is never stuck. The session provides a fallback baseline.
        if (doneRef.current) return;
        doneRef.current = true;
        const baseline =
          session.getBaseline() ?? {
            leftArm: {
              shoulderPos: { x: 0, y: 0, z: 0 },
              elbowPos: { x: 0, y: 0, z: 0 },
              wristPos: { x: 0, y: 0, z: 0 },
              normalizedWristHeight: 0,
              elbowExtensionAngle: 180,
              palmOrientationAngle: 0,
              armLength: 0.2,
            },
            rightArm: {
              shoulderPos: { x: 0, y: 0, z: 0 },
              elbowPos: { x: 0, y: 0, z: 0 },
              wristPos: { x: 0, y: 0, z: 0 },
              normalizedWristHeight: 0,
              elbowExtensionAngle: 180,
              palmOrientationAngle: 0,
              armLength: 0.2,
            },
            torsoAngle: 0,
            shoulderWidth: 0.2,
            captureFrameCount: 0,
            captureStartTime: Date.now(),
            captureEndTime: Date.now(),
          };
        dispatch({ type: 'CALIBRATION_COMPLETE', baseline });
      }
    })();

    return () => {
      doneRef.current = true;
    };
  }, [dispatch, session]);

  return (
    <div className="app__screen-placeholder" role="status" aria-live="polite">
      <h2>Calibration</h2>
      <p>{status}</p>
      <div
        style={{
          width: '80%',
          maxWidth: 420,
          height: 10,
          margin: '16px auto 0',
          borderRadius: 6,
          background: 'rgba(255,255,255,0.12)',
          overflow: 'hidden',
        }}
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          style={{
            width: `${progress}%`,
            height: '100%',
            background: 'var(--color-accent-cyan, #00e5ff)',
            transition: 'width 0.1s linear',
          }}
        />
      </div>
      <p style={{ marginTop: 8 }}>{progress}%</p>
    </div>
  );
}
