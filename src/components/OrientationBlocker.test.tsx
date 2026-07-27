/**
 * Tests for OrientationBlocker component
 *
 * Validates:
 * - Renders nothing when in portrait (isLandscape=false)
 * - Renders full-screen overlay with rotation message when in landscape
 * - Contains correct message text per Requirement 18.1
 * - Has proper ARIA attributes for accessibility
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrientationBlocker } from './OrientationBlocker';

describe('OrientationBlocker', () => {
  it('renders nothing when isLandscape is false', () => {
    const { container } = render(<OrientationBlocker isLandscape={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders overlay when isLandscape is true', () => {
    render(<OrientationBlocker isLandscape={true} />);

    const message = screen.getByText(
      'Please rotate your device to portrait orientation to continue'
    );
    expect(message).toBeTruthy();
  });

  it('displays the exact message from Requirement 18.1', () => {
    render(<OrientationBlocker isLandscape={true} />);

    expect(
      screen.getByText(
        'Please rotate your device to portrait orientation to continue'
      )
    ).toBeTruthy();
  });

  it('has role="alertdialog" for accessibility', () => {
    render(<OrientationBlocker isLandscape={true} />);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toBeTruthy();
  });

  it('has aria-modal="true" to indicate blocking overlay', () => {
    render(<OrientationBlocker isLandscape={true} />);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('has aria-describedby pointing to the message', () => {
    render(<OrientationBlocker isLandscape={true} />);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.getAttribute('aria-describedby')).toBe('orientation-message');

    const message = document.getElementById('orientation-message');
    expect(message).toBeTruthy();
    expect(message?.textContent).toBe(
      'Please rotate your device to portrait orientation to continue'
    );
  });

  it('uses fixed positioning to cover the entire viewport', () => {
    render(<OrientationBlocker isLandscape={true} />);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.style.position).toBe('fixed');
    expect(dialog.style.top).toBe('0px');
    expect(dialog.style.left).toBe('0px');
    expect(dialog.style.right).toBe('0px');
    expect(dialog.style.bottom).toBe('0px');
  });

  it('has a high z-index to sit above all other content', () => {
    render(<OrientationBlocker isLandscape={true} />);

    const dialog = screen.getByRole('alertdialog');
    const zIndex = parseInt(dialog.style.zIndex, 10);
    expect(zIndex).toBeGreaterThanOrEqual(9999);
  });
});
