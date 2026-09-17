import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SafetyConfirmationScreen } from './SafetyConfirmationScreen';

describe('SafetyConfirmationScreen', () => {
  const createDispatch = () => vi.fn();

  it('renders the title and description', () => {
    const dispatch = createDispatch();
    render(<SafetyConfirmationScreen dispatch={dispatch} />);

    expect(screen.getByText('Safety Confirmation')).toBeDefined();
    expect(screen.getByText(/confirm the following/i)).toBeDefined();
  });

  it('renders all five safety checkboxes', () => {
    const dispatch = createDispatch();
    render(<SafetyConfirmationScreen dispatch={dispatch} />);

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(5);
  });

  it('renders the urgent symptom warning with correct content', () => {
    const dispatch = createDispatch();
    render(<SafetyConfirmationScreen dispatch={dispatch} />);

    expect(screen.getByText(/STOP immediately and seek emergency medical attention/i)).toBeDefined();
    expect(screen.getByText(/Sudden weakness or numbness on one side/i)).toBeDefined();
    expect(screen.getByText(/Difficulty speaking or understanding speech/i)).toBeDefined();
    expect(screen.getByText(/Sudden severe headache/i)).toBeDefined();
    expect(screen.getByText(/Sudden vision problems/i)).toBeDefined();
    expect(screen.getByText(/Loss of balance or coordination/i)).toBeDefined();
  });

  it('renders the seated recommendation', () => {
    const dispatch = createDispatch();
    render(<SafetyConfirmationScreen dispatch={dispatch} />);

    expect(screen.getByText(/recommend performing this test while seated/i)).toBeDefined();
  });

  it('disables "I am ready" button when not all checkboxes are confirmed', () => {
    const dispatch = createDispatch();
    render(<SafetyConfirmationScreen dispatch={dispatch} />);

    const readyBtn = screen.getByRole('button', { name: /I am ready/i });
    expect((readyBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables "I am ready" button when all checkboxes are confirmed', () => {
    const dispatch = createDispatch();
    render(<SafetyConfirmationScreen dispatch={dispatch} />);

    const checkboxes = screen.getAllByRole('checkbox');
    checkboxes.forEach(cb => fireEvent.click(cb));

    const readyBtn = screen.getByRole('button', { name: /I am ready/i });
    expect((readyBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('dispatches SAFETY_CONFIRMED when "I am ready" is clicked after all confirmed', () => {
    const dispatch = createDispatch();
    render(<SafetyConfirmationScreen dispatch={dispatch} />);

    const checkboxes = screen.getAllByRole('checkbox');
    checkboxes.forEach(cb => fireEvent.click(cb));

    const readyBtn = screen.getByRole('button', { name: /I am ready/i });
    fireEvent.click(readyBtn);

    expect(dispatch).toHaveBeenCalledWith({ type: 'SAFETY_CONFIRMED' });
  });

  it('does not dispatch SAFETY_CONFIRMED when button is disabled', () => {
    const dispatch = createDispatch();
    render(<SafetyConfirmationScreen dispatch={dispatch} />);

    const readyBtn = screen.getByRole('button', { name: /I am ready/i });
    fireEvent.click(readyBtn);

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dispatches EXIT_ASSESSMENT when "Exit Assessment" is clicked', () => {
    const dispatch = createDispatch();
    render(<SafetyConfirmationScreen dispatch={dispatch} />);

    const exitBtn = screen.getByRole('button', { name: /Exit Assessment/i });
    fireEvent.click(exitBtn);

    expect(dispatch).toHaveBeenCalledWith({ type: 'EXIT_ASSESSMENT' });
  });

  it('re-disables "I am ready" when a checkbox is unchecked', () => {
    const dispatch = createDispatch();
    render(<SafetyConfirmationScreen dispatch={dispatch} />);

    const checkboxes = screen.getAllByRole('checkbox');
    checkboxes.forEach(cb => fireEvent.click(cb));

    // Uncheck the first one
    fireEvent.click(checkboxes[0]);

    const readyBtn = screen.getByRole('button', { name: /I am ready/i });
    expect((readyBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('urgent warning has role="alert" for accessibility', () => {
    const dispatch = createDispatch();
    render(<SafetyConfirmationScreen dispatch={dispatch} />);

    const alert = screen.getByRole('alert');
    expect(alert).toBeDefined();
  });
});
