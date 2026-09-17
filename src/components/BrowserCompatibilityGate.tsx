/**
 * BrowserCompatibilityGate Component
 *
 * Wraps the entire application and performs a browser compatibility check on mount.
 * If all required features are available, renders children normally.
 * If features are missing, displays a compatibility message with details.
 *
 * @module BrowserCompatibilityGate
 */

import { useEffect, useState, type ReactNode } from 'react';
import {
  checkCompatibility,
  SUPPORTED_BROWSERS,
  type CompatibilityResult,
} from '../compatibility/BrowserCompatibility';

interface BrowserCompatibilityGateProps {
  children: ReactNode;
}

export function BrowserCompatibilityGate({ children }: BrowserCompatibilityGateProps) {
  const [result, setResult] = useState<CompatibilityResult | null>(null);

  useEffect(() => {
    // Delay check slightly to allow browser APIs to initialize
    const timer = setTimeout(() => {
      setResult(checkCompatibility());
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // While checking, render children anyway (don't block)
  if (result === null) {
    return <>{children}</>;
  }

  // All features supported — render children normally
  if (result.compatible) {
    return <>{children}</>;
  }

  // Features missing — show warning banner BUT still render the app below it
  // This prevents a complete blank page if only speech is missing
  const criticalMissing = result.missingFeatures.filter(
    f => f.includes('getUserMedia') || f.includes('WebGL')
  );

  // Only fully block if camera or WebGL is missing (app literally can't work)
  if (criticalMissing.length > 0) {
    return (
      <div className="compatibility-gate" role="alert" aria-live="assertive">
        <div className="compatibility-gate__content">
          <h1 className="compatibility-gate__title">Browser Not Supported</h1>
          <p className="compatibility-gate__description">
            Your current browser does not support all features required by this application.
          </p>

          <div className="compatibility-gate__missing">
            <h2 className="compatibility-gate__subtitle">Unsupported Features</h2>
            <ul className="compatibility-gate__list" aria-label="Unsupported features">
              {result.missingFeatures.map((feature) => (
                <li key={feature} className="compatibility-gate__list-item">
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          <div className="compatibility-gate__suggestion">
            <h2 className="compatibility-gate__subtitle">Suggested Browsers</h2>
            <p className="compatibility-gate__hint">
              Please use one of the following browsers for the best experience:
            </p>
            <ul className="compatibility-gate__browsers" aria-label="Supported browsers">
              {SUPPORTED_BROWSERS.map((browser) => (
                <li key={browser} className="compatibility-gate__browser-item">
                  {browser}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // Non-critical missing features (e.g. speech only) — render app with a small warning
  return <>{children}</>;
}
