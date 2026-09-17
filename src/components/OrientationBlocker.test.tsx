/**
 * Tests for OrientationBlocker component (now "Orientation Encourager")
 *
 * Validates:
 * - Renders nothing when in landscape (isPortrait=false)
 * - Renders overlay encouraging landscape when in portrait (isPortrait=true)
 * - Can be dismissed by the user
 * - Has proper ARIA attributes for accessibility
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrientationBlocker } from './OrientationBlocker';

describe('OrientationBlocker', () => {
  it('renders nothing when isPortrait is false (already in landscape)', () => {
    const { container } = render(<OrientationBlocker isPortrait={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders overlay when isPortrait is true', () => {
    render(<OrientationBlocker isPortrait={true} />);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toBeTruthy();
  });

  it('displays a message encouraging landscape orientation', () => {
    render(<OrientationBlocker isPortrait={true} />);

    const message = screen.getByText(/rotate your device to/i);
    expect(message).toBeTruthy();
    expect(message.textContent).toContain('landscape');
  });

  it('has role="alertdialog" for accessibility', () => {
    render(<OrientationBlocker isPortrait={true} />);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toBeTruthy();
  });

  it('has aria-describedby pointing to the message', () => {
    render(<OrientationBlocker isPortrait={true} />);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.getAttribute('aria-describedby')).toBe('orientation-message');

    const message = document.getElementById('orientation-message');
    expect(message).toBeTruthy();
  });

  it('uses fixed positioning to cover the entire viewport', () => {
    render(<OrientationBlocker isPortrait={true} />);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.style.position).toBe('fixed');
    expect(dialog.style.top).toBe('0px');
    expect(dialog.style.left).toBe('0px');
    expect(dialog.style.right).toBe('0px');
    expect(dialog.style.bottom).toBe('0px');
  });

  it('has a high z-index to sit above all other content', () => {
    render(<OrientationBlocker isPortrait={true} />);

    const dialog = screen.getByRole('alertdialog');
    const zIndex = parseInt(dialog.style.zIndex, 10);
    expect(zIndex).toBeGreaterThanOrEqual(9999);
  });

  it('can be dismissed by clicking "Continue in Portrait"', () => {
    const { container } = render(<OrientationBlocker isPortrait={true} />);

    // Initially visible
    expect(screen.getByRole('alertdialog')).toBeTruthy();

    // Click dismiss button
    const dismissBtn = screen.getByText('Continue in Portrait');
    fireEvent.click(dismissBtn);

    // Now renders nothing
    expect(container.firstChild).toBeNull();
  });
});
