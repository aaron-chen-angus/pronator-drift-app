/**
 * Tests for AudioControls component
 *
 * Validates:
 * - Volume slider renders with correct range (0-100) and default value
 * - Mute toggle displays correct icon for muted/unmuted states
 * - Warning message appears when muted but not yet confirmed
 * - Confirmation and cancel buttons work correctly
 * - Volume change callback fires with correct value
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AudioControls } from './AudioControls';

const defaultProps = {
  volume: 100,
  isMuted: false,
  isMuteConfirmed: false,
  onVolumeChange: vi.fn(),
  onMuteToggle: vi.fn(),
  onMuteConfirm: vi.fn(),
  onMuteCancel: vi.fn(),
};

describe('AudioControls', () => {
  describe('Volume Slider', () => {
    it('renders a volume slider with min=0, max=100', () => {
      render(<AudioControls {...defaultProps} />);

      const slider = screen.getByRole('slider', { name: /volume/i });
      expect(slider).toBeTruthy();
      expect(slider.getAttribute('min')).toBe('0');
      expect(slider.getAttribute('max')).toBe('100');
    });

    it('displays the current volume value', () => {
      render(<AudioControls {...defaultProps} volume={75} />);

      expect(screen.getByText('75%')).toBeTruthy();
    });

    it('calls onVolumeChange when slider is adjusted', () => {
      const onVolumeChange = vi.fn();
      render(<AudioControls {...defaultProps} onVolumeChange={onVolumeChange} />);

      const slider = screen.getByRole('slider', { name: /volume/i });
      fireEvent.change(slider, { target: { value: '50' } });

      expect(onVolumeChange).toHaveBeenCalledWith(50);
    });

    it('slider reflects the provided volume prop', () => {
      render(<AudioControls {...defaultProps} volume={42} />);

      const slider = screen.getByRole('slider', { name: /volume/i }) as HTMLInputElement;
      expect(slider.value).toBe('42');
    });

    it('disables slider when muted and confirmed', () => {
      render(
        <AudioControls {...defaultProps} isMuted={true} isMuteConfirmed={true} />
      );

      const slider = screen.getByRole('slider', { name: /volume/i }) as HTMLInputElement;
      expect(slider.disabled).toBe(true);
    });

    it('shows "Muted" text when muted and confirmed', () => {
      render(
        <AudioControls {...defaultProps} isMuted={true} isMuteConfirmed={true} />
      );

      expect(screen.getByText('Muted')).toBeTruthy();
    });
  });

  describe('Mute Toggle', () => {
    it('renders unmute label when not muted', () => {
      render(<AudioControls {...defaultProps} isMuted={false} />);

      const button = screen.getByRole('button', { name: /mute audio/i });
      expect(button).toBeTruthy();
      expect(button.getAttribute('aria-pressed')).toBe('false');
    });

    it('renders muted label when muted', () => {
      render(<AudioControls {...defaultProps} isMuted={true} isMuteConfirmed={true} />);

      const button = screen.getByRole('button', { name: /unmute audio/i });
      expect(button).toBeTruthy();
      expect(button.getAttribute('aria-pressed')).toBe('true');
    });

    it('calls onMuteToggle when mute button is clicked', () => {
      const onMuteToggle = vi.fn();
      render(<AudioControls {...defaultProps} onMuteToggle={onMuteToggle} />);

      const button = screen.getByRole('button', { name: /mute audio/i });
      fireEvent.click(button);

      expect(onMuteToggle).toHaveBeenCalledTimes(1);
    });
  });

  describe('Mute Warning Dialog', () => {
    it('does not show warning when not muted', () => {
      render(<AudioControls {...defaultProps} isMuted={false} />);

      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('shows warning when muted but not confirmed', () => {
      render(
        <AudioControls {...defaultProps} isMuted={true} isMuteConfirmed={false} />
      );

      const alert = screen.getByRole('alert');
      expect(alert).toBeTruthy();
      expect(
        screen.getByText(
          'Audio is recommended because your eyes will be closed during the assessment.'
        )
      ).toBeTruthy();
    });

    it('does not show warning when muted and already confirmed', () => {
      render(
        <AudioControls {...defaultProps} isMuted={true} isMuteConfirmed={true} />
      );

      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('shows "Proceed without audio" button in warning', () => {
      render(
        <AudioControls {...defaultProps} isMuted={true} isMuteConfirmed={false} />
      );

      expect(screen.getByRole('button', { name: /proceed without audio/i })).toBeTruthy();
    });

    it('shows "Keep audio" button in warning', () => {
      render(
        <AudioControls {...defaultProps} isMuted={true} isMuteConfirmed={false} />
      );

      expect(screen.getByRole('button', { name: /keep audio/i })).toBeTruthy();
    });

    it('calls onMuteConfirm when "Proceed without audio" is clicked', () => {
      const onMuteConfirm = vi.fn();
      render(
        <AudioControls
          {...defaultProps}
          isMuted={true}
          isMuteConfirmed={false}
          onMuteConfirm={onMuteConfirm}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /proceed without audio/i }));
      expect(onMuteConfirm).toHaveBeenCalledTimes(1);
    });

    it('calls onMuteCancel when "Keep audio" is clicked', () => {
      const onMuteCancel = vi.fn();
      render(
        <AudioControls
          {...defaultProps}
          isMuted={true}
          isMuteConfirmed={false}
          onMuteCancel={onMuteCancel}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /keep audio/i }));
      expect(onMuteCancel).toHaveBeenCalledTimes(1);
    });
  });
});
