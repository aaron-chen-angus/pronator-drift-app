/**
 * OrientationBlocker Component
 *
 * Displays a full-screen overlay when the device is in landscape orientation.
 * Shows a rotation icon and message asking the user to rotate to portrait mode.
 * Blocks all interaction with the application behind it.
 *
 * Requirements: 18.1, 18.4
 */

import React from 'react';

export interface OrientationBlockerProps {
  /** Whether the device is currently in landscape orientation */
  isLandscape: boolean;
}

/**
 * Full-screen overlay that blocks all app interaction when in landscape mode.
 * Renders nothing when in portrait orientation.
 */
export const OrientationBlocker: React.FC<OrientationBlockerProps> = ({
  isLandscape,
}) => {
  if (!isLandscape) {
    return null;
  }

  return (
    <div
      style={overlayStyles}
      role="alertdialog"
      aria-modal="true"
      aria-label="Orientation warning"
      aria-describedby="orientation-message"
    >
      <div style={contentStyles}>
        <div style={iconContainerStyles} aria-hidden="true">
          <svg
            width="64"
            height="64"
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={iconStyles}
          >
            {/* Phone body */}
            <rect
              x="16"
              y="8"
              width="32"
              height="48"
              rx="4"
              stroke="currentColor"
              strokeWidth="2.5"
              fill="none"
            />
            {/* Screen area */}
            <rect
              x="19"
              y="14"
              width="26"
              height="36"
              rx="1"
              fill="currentColor"
              opacity="0.15"
            />
            {/* Rotation arrow */}
            <path
              d="M52 32C52 21 43 12 32 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M32 8L32 16L40 12Z"
              fill="currentColor"
            />
          </svg>
        </div>
        <p id="orientation-message" style={messageStyles}>
          Please rotate your device to portrait orientation to continue
        </p>
      </div>
    </div>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const overlayStyles: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 10000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'var(--color-bg-primary, #0a0e17)',
  // Blocks all pointer events to the app behind
  pointerEvents: 'all',
};

const contentStyles: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '24px',
  padding: '32px',
  maxWidth: '360px',
  textAlign: 'center',
};

const iconContainerStyles: React.CSSProperties = {
  color: 'var(--color-accent-cyan, #00e5ff)',
  animation: 'rotate-hint 2s ease-in-out infinite',
};

const iconStyles: React.CSSProperties = {
  width: '64px',
  height: '64px',
};

const messageStyles: React.CSSProperties = {
  fontSize: 'var(--font-size-lg, 20px)',
  fontWeight: 'var(--font-weight-medium, 500)' as React.CSSProperties['fontWeight'],
  color: 'var(--color-text-primary, #f0f4f8)',
  lineHeight: 1.5,
  margin: 0,
};

export default OrientationBlocker;
