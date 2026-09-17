// Feature: pronator-drift-analysis, Property 18: Norm comparison classifies by interval membership with citation and prototype label

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { compareToNorm } from './NormComparator';
import { ConfigStore } from '../config/ConfigStore';
import type { IndicatorKey } from '../types';

/**
 * **Validates: Requirements 9.2, 9.3, 9.5**
 *
 * Property 18: Norm comparison classifies by interval membership with citation and prototype label
 *
 * For any indicator with a defined normative range and any measurable numeric value,
 * `compareToNorm` returns:
 *   - 'within'  iff value ∈ [lowerBound, upperBound] (inclusive)
 *   - 'outside' otherwise
 * and, when the outcome is 'within' or 'outside', the returned citation equals the
 * range's citation and `prototype === true`.
 *
 * It also covers:
 *   - not measurable / null value  => 'not_measured' (Req 9.6, covered here for completeness)
 *   - indicator with no defined range => 'no_reference' (Req 9.4, covered here for completeness)
 */
describe('Property 18: Norm comparison classifies by interval membership with citation and prototype label', () => {
  // Indicators seeded with a defined normative range in ConfigStore.
  const rangedKeys: IndicatorKey[] = [
    'wristDrift',
    'wristTremorDominantFrequency',
    'palmRotationChange',
  ];

  // Indicators without a defined normative range (=> no_reference).
  const unreferencedKeys: IndicatorKey[] = ['stability', 'elbowDrift'];

  it('classifies measurable values by interval membership, always carrying citation + prototype label', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...rangedKeys),
        // A wide numeric value space spanning inside and well outside any range.
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        (key, value) => {
          const config = new ConfigStore();
          const range = config.getNormativeRange(key);
          // Precondition: these keys must have a defined range.
          expect(range).not.toBeNull();

          const result = compareToNorm(key, value, true, config);

          const inInterval = value >= range!.lowerBound && value <= range!.upperBound;
          const expectedOutcome = inInterval ? 'within' : 'outside';

          // Outcome matches interval membership (Req 9.2).
          expect(result.outcome).toBe(expectedOutcome);
          // Value is preserved.
          expect(result.value).toBe(value);
          // Range is carried through and matches the store's range.
          expect(result.range).not.toBeNull();
          expect(result.range!.lowerBound).toBe(range!.lowerBound);
          expect(result.range!.upperBound).toBe(range!.upperBound);
          // Citation equals the range's citation (Req 9.3).
          expect(result.citation).toBe(range!.citation);
          // Always labeled prototype pending validation (Req 9.5).
          expect(result.prototype).toBe(true);
          // Indicator key is echoed back.
          expect(result.indicatorKey).toBe(key);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('classifies boundary values (exactly on the bounds) as within', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...rangedKeys),
        // Choose one of the two inclusive boundaries.
        fc.boolean(),
        (key, useLower) => {
          const config = new ConfigStore();
          const range = config.getNormativeRange(key)!;
          const boundary = useLower ? range.lowerBound : range.upperBound;

          const result = compareToNorm(key, boundary, true, config);

          // Inclusive bounds => within (Req 9.2).
          expect(result.outcome).toBe('within');
          expect(result.citation).toBe(range.citation);
          expect(result.prototype).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('returns not_measured (with no comparison) when value is null or not measurable (Req 9.6)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...rangedKeys, ...unreferencedKeys),
        // Either explicitly not measurable, or a null value while "measurable".
        fc.oneof(
          fc.record({ measurable: fc.constant(false), value: fc.double({ min: -100, max: 100, noNaN: true }) }),
          fc.record({ measurable: fc.constant(true), value: fc.constant(null) }),
          fc.record({ measurable: fc.constant(false), value: fc.constant(null) })
        ),
        (key, { measurable, value }) => {
          const config = new ConfigStore();
          const result = compareToNorm(key, value as number | null, measurable, config);

          expect(result.outcome).toBe('not_measured');
          expect(result.value).toBeNull();
          expect(result.range).toBeNull();
          expect(result.citation).toBeNull();
          expect(result.prototype).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('returns no_reference for measurable values on indicators without a defined range (Req 9.4)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...unreferencedKeys),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        (key, value) => {
          const config = new ConfigStore();
          // Precondition: these keys have no defined range.
          expect(config.getNormativeRange(key)).toBeNull();

          const result = compareToNorm(key, value, true, config);

          expect(result.outcome).toBe('no_reference');
          expect(result.value).toBe(value);
          expect(result.range).toBeNull();
          expect(result.citation).toBeNull();
          expect(result.prototype).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });
});
