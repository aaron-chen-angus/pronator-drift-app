import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  formatNormalizedMeasurement,
  parseNormalizedMeasurement,
  validateNormalizedRange,
} from './validation';

describe('Property 25: Normalized Measurement Round-Trip', () => {
  /**
   * **Validates: Requirements 25.4**
   *
   * For any valid normalized measurement value (a number in the range [0.0, 1.0]),
   * formatting it to a string representation and parsing it back shall produce
   * a value within 1e-9 of the original.
   */
  it('round-trip preserves value within 1e-9 for any double in [0.0, 1.0]', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.0, max: 1.0, noNaN: true, noDefaultInfinity: true }),
        (value) => {
          const formatted = formatNormalizedMeasurement(value);
          const parsed = parseNormalizedMeasurement(formatted);
          expect(Math.abs(parsed - value)).toBeLessThanOrEqual(1e-9);
        }
      )
    );
  });
});

describe('Property 26: Range Validation Rejects Out-of-Bounds', () => {
  /**
   * **Validates: Requirements 26.5**
   *
   * For any numeric value assigned to a field constrained to the range [0.0, 1.0],
   * if the value is less than 0.0 or greater than 1.0, the validation layer shall
   * treat it as invalid.
   */
  it('values below 0.0 are always rejected as invalid', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e308, max: -5e-324, noNaN: true, noDefaultInfinity: true }),
        (value) => {
          const result = validateNormalizedRange(value);
          expect(result.valid).toBe(false);
        }
      )
    );
  });

  it('values above 1.0 are always rejected as invalid', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1.0000000000000002, max: 1e308, noNaN: true, noDefaultInfinity: true }),
        (value) => {
          const result = validateNormalizedRange(value);
          expect(result.valid).toBe(false);
        }
      )
    );
  });

  it('values in [0.0, 1.0] are always accepted as valid', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.0, max: 1.0, noNaN: true, noDefaultInfinity: true }),
        (value) => {
          const result = validateNormalizedRange(value);
          expect(result.valid).toBe(true);
        }
      )
    );
  });
});
