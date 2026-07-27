import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  beforeEach(() => {
    // Mock browser APIs so BrowserCompatibilityGate passes through
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn() },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'speechSynthesis', {
      value: { speak: vi.fn(), cancel: vi.fn(), getVoices: vi.fn(() => []) },
      writable: true,
      configurable: true,
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the welcome screen by default', () => {
    render(<App />);
    expect(screen.getByText('Pronator Drift Screener')).toBeDefined();
  });

  it('displays the welcome description', () => {
    render(<App />);
    expect(
      screen.getByText('A camera-based guided 30-second upper-limb movement screening'),
    ).toBeDefined();
  });

  it('renders the portrait container', () => {
    const { container } = render(<App />);
    const portraitContainer = container.querySelector(
      '.app__portrait-container',
    );
    expect(portraitContainer).not.toBeNull();
  });

  it('renders an aria-live region for screen transitions', () => {
    const { container } = render(<App />);
    const liveRegion = container.querySelector('[aria-live="assertive"]');
    expect(liveRegion).not.toBeNull();
  });

  it('applies the app class for grid background', () => {
    const { container } = render(<App />);
    const appDiv = container.querySelector('.app');
    expect(appDiv).not.toBeNull();
  });

  it('renders the WelcomeScreen component in welcome state', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Start Assessment' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'How It Works' })).toBeDefined();
  });
});
