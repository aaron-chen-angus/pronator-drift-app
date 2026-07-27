import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WelcomeScreen } from './WelcomeScreen';

describe('WelcomeScreen', () => {
  const mockDispatch = vi.fn();

  beforeEach(() => {
    mockDispatch.mockClear();
  });

  it('displays the application name', () => {
    render(<WelcomeScreen dispatch={mockDispatch} />);
    expect(screen.getByText('Pronator Drift Screener')).toBeDefined();
  });

  it('displays the purpose description', () => {
    render(<WelcomeScreen dispatch={mockDispatch} />);
    expect(
      screen.getByText(
        'A camera-based guided 30-second upper-limb movement screening',
      ),
    ).toBeDefined();
  });

  it('displays the "Start Assessment" button', () => {
    render(<WelcomeScreen dispatch={mockDispatch} />);
    expect(screen.getByRole('button', { name: 'Start Assessment' })).toBeDefined();
  });

  it('displays the "How It Works" button', () => {
    render(<WelcomeScreen dispatch={mockDispatch} />);
    expect(screen.getByRole('button', { name: 'How It Works' })).toBeDefined();
  });

  it('displays the medical screening disclaimer', () => {
    render(<WelcomeScreen dispatch={mockDispatch} />);
    expect(
      screen.getByText(/This tool is not a medical device or diagnostic tool/),
    ).toBeDefined();
    expect(
      screen.getByText(/does not provide medical advice, diagnosis, or treatment recommendations/),
    ).toBeDefined();
    expect(
      screen.getByText(/should not be used as a substitute for professional medical evaluation/),
    ).toBeDefined();
    expect(
      screen.getByText(/please consult a qualified healthcare provider/),
    ).toBeDefined();
  });

  it('displays the privacy notice', () => {
    render(<WelcomeScreen dispatch={mockDispatch} />);
    expect(
      screen.getByText(
        'All processing happens locally on your device. No video, images, or movement data is saved or transmitted to any server.',
      ),
    ).toBeDefined();
  });

  it('dispatches START_ASSESSMENT when "Start Assessment" is clicked', () => {
    render(<WelcomeScreen dispatch={mockDispatch} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Assessment' }));
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'START_ASSESSMENT' });
  });

  it('shows "How It Works" panel when button is clicked', () => {
    render(<WelcomeScreen dispatch={mockDispatch} />);
    const btn = screen.getByRole('button', { name: 'How It Works' });
    fireEvent.click(btn);
    expect(screen.getByText('How It Works', { selector: 'h2' })).toBeDefined();
    expect(
      screen.getByText(/Grant camera access and follow positioning guides/),
    ).toBeDefined();
  });

  it('hides "How It Works" panel when button is clicked again', () => {
    render(<WelcomeScreen dispatch={mockDispatch} />);
    const btn = screen.getByRole('button', { name: 'How It Works' });
    fireEvent.click(btn);
    expect(screen.getByText('How It Works', { selector: 'h2' })).toBeDefined();
    fireEvent.click(btn);
    expect(screen.queryByText('How It Works', { selector: 'h2' })).toBeNull();
  });

  it('has aria-expanded on "How It Works" button', () => {
    render(<WelcomeScreen dispatch={mockDispatch} />);
    const btn = screen.getByRole('button', { name: 'How It Works' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('"How It Works" panel explains the assessment workflow', () => {
    render(<WelcomeScreen dispatch={mockDispatch} />);
    fireEvent.click(screen.getByRole('button', { name: 'How It Works' }));
    expect(screen.getByText(/Confirm safety requirements/)).toBeDefined();
    expect(screen.getByText(/30-second assessment begins/)).toBeDefined();
    expect(screen.getByText(/computer vision to observe arm movement/)).toBeDefined();
    expect(screen.getByText(/screening observation/)).toBeDefined();
  });
});
