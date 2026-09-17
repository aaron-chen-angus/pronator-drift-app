/**
 * OrientationBlocker Component — Now an "Orientation Encourager"
 *
 * Displays a gentle overlay when the device is in PORTRAIT orientation,
 * encouraging the user to rotate to LANDSCAPE mode for the side-view test.
 * The user CAN dismiss this and continue, but landscape is strongly recommended.
 *
 * In the new side-view approach, landscape is preferred because the phone is
 * placed to the user's side to capture their arm profile.
 */

import React, { useState } from 'react';

export interface OrientationBlockerProps {
  /** Whether the device is currently in portrait orientation (non-preferred) */
  isPortrait: boolean;
}

/**
 * Overlay that encourages landscape orientation for the side-view test.
 * Renders nothing when already in landscape orientation.
 * Can be dismissed by the user.
 */
export const OrientationBlocker: React.FC<OrientationBlockerProps> = ({
  isPortrait,
}) => {
  const [dismissed, setDismissed] = useState(false);

  if (!isPortrait || dismissed) {
    return null;
  }

  return (
    <div
      style={overlayStyles}
      role="alertdialog"
      aria-modal="false"
      aria-label="Orientation suggestion"
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
            {/* Phone body in landscape */}
            <rect
              x="8"
              y="16"
              width="48"
              height="32"
              rx="4"
              stroke="currentColor"
              strokeWidth="2.5"
              fill="none"
            />
            {/* Screen area */}
            <rect
              x="14"
              y="19"
              width="36"
              height="26"
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
          For best results, rotate your device to <strong>landscape</strong> orientation
        </p>
        <p style={hintStyles}>
          The side-view test works best with the phone sideways
        </p>
        <button
          style={dismissButtonStyles}
          onClick={() => setDismissed(true)}
          type="button"
        >
          Continue in Portrait
        </button>
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
  backgroundColor: 'rgba(10, 14, 23, 0.92)',
  pointerEvents: 'all',
};

const contentStyles: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '20px',
  padding: '32px',
  maxWidth: '400px',
  textAlign: 'center',
};

const iconContainerStyles: React.CSSProperties = {
  color: 'var(--color-accent-cyan, #00e5ff)',
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

const hintStyles: React.CSSProperties = {
  fontSize: '14px',
  color: 'var(--color-text-secondary, #a0aec0)',
  margin: 0,
};

const dismissButtonStyles: React.CSSProperties = {
  padding: '10px 24px',
  borderRadius: '8px',
  border: '1px solid rgba(0, 229, 255, 0.4)',
  backgroundColor: 'transparent',
  color: 'var(--color-accent-cyan, #00e5ff)',
  fontSize: '14px',
  cursor: 'pointer',
  marginTop: '8px',
};

export default OrientationBlocker;
