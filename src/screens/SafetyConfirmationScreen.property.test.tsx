import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SafetyConfirmationScreen } from './SafetyConfirmationScreen';

/**
 * **Validates: Requirements 2.4**
 *
 * Property 1: Safety Confirmation Gate
 *
 * For any subset of safety confirmation checkboxes that is not the complete set,
 * the "I am ready" button must be in a disabled state. Only when all checkboxes
 * are confirmed shall the button become enabled.
 */
describe('Property 1: Safety Confirmation Gate', () => {
  const CHECKBOX_COUNT = 5;
  const ALL_INDICES = [0, 1, 2, 3, 4];

  /**
   * Arbitrary that generates a proper subset of checkbox indices (not all 5).
   * This includes the empty set and any subset of size 1-4.
   */
  const incompleteSubsetArb = fc
    .subarray(ALL_INDICES, { minLength: 0, maxLength: CHECKBOX_COUNT - 1 });

  it('should keep "I am ready" button disabled for any incomplete subset of checked checkboxes', () => {
    fc.assert(
      fc.property(incompleteSubsetArb, (checkedIndices) => {
        cleanup();
        const dispatch = vi.fn();
        render(<SafetyConfirmationScreen dispatch={dispatch} />);

        // Get all checkbox inputs
        const checkboxes = screen.getAllByRole('checkbox');
        expect(checkboxes).toHaveLength(CHECKBOX_COUNT);

        // Check the subset of checkboxes
        for (const index of checkedIndices) {
          fireEvent.click(checkboxes[index]);
        }

        // The "I am ready" button should remain disabled
        const readyButton = screen.getByRole('button', { name: /i am ready/i });
        expect((readyButton as HTMLButtonElement).disabled).toBe(true);

        // Clicking the button should NOT dispatch SAFETY_CONFIRMED
        fireEvent.click(readyButton);
        expect(dispatch).not.toHaveBeenCalledWith({ type: 'SAFETY_CONFIRMED' });

        cleanup();
      }),
      { numRuns: 50 }
    );
  });

  it('should enable "I am ready" button only when all 5 checkboxes are checked', () => {
    cleanup();
    const dispatch = vi.fn();
    render(<SafetyConfirmationScreen dispatch={dispatch} />);

    // Get all checkbox inputs
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(CHECKBOX_COUNT);

    // Check all checkboxes
    for (const checkbox of checkboxes) {
      fireEvent.click(checkbox);
    }

    // The "I am ready" button should now be enabled
    const readyButton = screen.getByRole('button', { name: /i am ready/i });
    expect((readyButton as HTMLButtonElement).disabled).toBe(false);

    // Clicking the button should dispatch SAFETY_CONFIRMED
    fireEvent.click(readyButton);
    expect(dispatch).toHaveBeenCalledWith({ type: 'SAFETY_CONFIRMED' });

    cleanup();
  });

  it('should disable "I am ready" button if any checkbox is unchecked after all were checked', () => {
    fc.assert(
      fc.property(
        // Pick an arbitrary index to uncheck after all are checked
        fc.integer({ min: 0, max: CHECKBOX_COUNT - 1 }),
        (uncheckIndex) => {
          cleanup();
          const dispatch = vi.fn();
          render(<SafetyConfirmationScreen dispatch={dispatch} />);

          const checkboxes = screen.getAllByRole('checkbox');

          // Check all checkboxes first
          for (const checkbox of checkboxes) {
            fireEvent.click(checkbox);
          }

          // Verify button is enabled when all are checked
          const readyButton = screen.getByRole('button', { name: /i am ready/i });
          expect((readyButton as HTMLButtonElement).disabled).toBe(false);

          // Uncheck one checkbox
          fireEvent.click(checkboxes[uncheckIndex]);

          // Button should be disabled again
          expect((readyButton as HTMLButtonElement).disabled).toBe(true);

          cleanup();
        }
      ),
      { numRuns: 20 }
    );
  });
});
