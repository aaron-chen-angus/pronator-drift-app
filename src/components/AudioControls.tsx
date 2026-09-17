/**
 * AudioControls Component
 *
 * Provides volume slider and mute toggle with confirmation dialog.
 * When user attempts to mute, shows a warning that audio is recommended
 * because eyes will be closed during the assessment, and requires explicit
 * confirmation before applying mute.
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4
 */

import React from 'react';

export interface AudioControlsProps {
  /** Volume level from 0-100, default 100 */
  volume: number;
  /** Whether audio is currently muted */
  isMuted: boolean;
  /** Whether the user has confirmed the mute action */
  isMuteConfirmed: boolean;
  /** Called when volume slider value changes */
  onVolumeChange: (volume: number) => void;
  /** Called when user toggles the mute button */
  onMuteToggle: () => void;
  /** Called when user confirms proceeding without audio */
  onMuteConfirm: () => void;
  /** Called when user cancels the mute action */
  onMuteCancel: () => void;
}

/**
 * Audio controls with volume slider and mute toggle.
 * Shows a warning dialog when muting is requested, requiring confirmation.
 */
export const AudioControls: React.FC<AudioControlsProps> = ({
  volume,
  isMuted,
  isMuteConfirmed,
  onVolumeChange,
  onMuteToggle,
  onMuteConfirm,
  onMuteCancel,
}) => {
  const showWarning = isMuted && !isMuteConfirmed;

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onVolumeChange(Number(e.target.value));
  };

  return (
    <div style={containerStyles} aria-label="Audio controls">
      <div style={controlsRowStyles}>
        <button
          type="button"
          onClick={onMuteToggle}
          style={muteButtonStyles}
          aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
          aria-pressed={isMuted}
        >
          {isMuted ? (
            <MutedIcon />
          ) : (
            <UnmutedIcon />
          )}
        </button>

        <label style={sliderLabelStyles}>
          <span style={srOnlyStyles}>Volume</span>
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={handleVolumeChange}
            disabled={isMuted && isMuteConfirmed}
            style={sliderStyles}
            aria-label="Volume"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={volume}
          />
        </label>

        <span style={volumeValueStyles} aria-live="polite">
          {isMuted && isMuteConfirmed ? 'Muted' : `${volume}%`}
        </span>
      </div>

      {showWarning && (
        <div
          style={warningStyles}
          role="alert"
          aria-live="assertive"
        >
          <p style={warningTextStyles}>
            Audio is recommended because your eyes will be closed during the assessment.
          </p>
          <div style={warningButtonsStyles}>
            <button
              type="button"
              onClick={onMuteConfirm}
              style={proceedButtonStyles}
            >
              Proceed without audio
            </button>
            <button
              type="button"
              onClick={onMuteCancel}
              style={keepAudioButtonStyles}
            >
              Keep audio
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Icons ───────────────────────────────────────────────────────────────────

const MutedIcon: React.FC = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M11 5L6 9H2v6h4l5 4V5z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
    <line
      x1="23"
      y1="9"
      x2="17"
      y2="15"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <line
      x1="17"
      y1="9"
      x2="23"
      y2="15"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

const UnmutedIcon: React.FC = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M11 5L6 9H2v6h4l5 4V5z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
    <path
      d="M15.54 8.46a5 5 0 0 1 0 7.07"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M19.07 4.93a10 10 0 0 1 0 14.14"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      fill="none"
    />
  </svg>
);

// ─── Styles ──────────────────────────────────────────────────────────────────

const containerStyles: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  padding: '12px',
  borderRadius: '8px',
  backgroundColor: 'var(--color-bg-secondary, #1a1f2e)',
};

const controlsRowStyles: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
};

const muteButtonStyles: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '40px',
  height: '40px',
  border: '1px solid var(--color-border, #2a3040)',
  borderRadius: '8px',
  backgroundColor: 'transparent',
  color: 'var(--color-text-primary, #f0f4f8)',
  cursor: 'pointer',
  flexShrink: 0,
};

const sliderLabelStyles: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
};

const srOnlyStyles: React.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

const sliderStyles: React.CSSProperties = {
  width: '100%',
  cursor: 'pointer',
};

const volumeValueStyles: React.CSSProperties = {
  minWidth: '48px',
  textAlign: 'right',
  fontSize: 'var(--font-size-sm, 14px)',
  color: 'var(--color-text-secondary, #a0aec0)',
  flexShrink: 0,
};

const warningStyles: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: '8px',
  backgroundColor: 'var(--color-warning-bg, #2d2a1a)',
  border: '1px solid var(--color-warning-border, #f5a623)',
};

const warningTextStyles: React.CSSProperties = {
  margin: '0 0 12px 0',
  fontSize: 'var(--font-size-sm, 14px)',
  color: 'var(--color-warning-text, #f5c842)',
  lineHeight: 1.5,
};

const warningButtonsStyles: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap',
};

const proceedButtonStyles: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 'var(--font-size-sm, 14px)',
  border: '1px solid var(--color-warning-border, #f5a623)',
  borderRadius: '6px',
  backgroundColor: 'transparent',
  color: 'var(--color-warning-text, #f5c842)',
  cursor: 'pointer',
};

const keepAudioButtonStyles: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 'var(--font-size-sm, 14px)',
  border: '1px solid var(--color-accent-cyan, #00e5ff)',
  borderRadius: '6px',
  backgroundColor: 'var(--color-accent-cyan, #00e5ff)',
  color: 'var(--color-bg-primary, #0a0e17)',
  cursor: 'pointer',
  fontWeight: 500,
};

export default AudioControls;
