import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  ConfigStore,
  validateThreshold,
  getDefaultConfig,
  getAllThresholdDefinitions,
  ConfigStoreValues,
} from './ConfigStore';

/**
 * **Validates: Requirements 17.4**
 *
 * Property 23: Config Fallback on Invalid Values
 *
 * For any threshold value in Config_Store that is missing or falls outside its
 * permitted numeric range, the system shall apply the documented default value
 * and produce a warning. The system shall never operate with an out-of-range threshold.
 */
describe('Property 23: Config Fallback on Invalid Values', () => {
  const definitions = getAllThresholdDefinitions();
  const keys = Object.keys(definitions) as Array<keyof ConfigStoreValues>;
  const defaults = getDefaultConfig();

  it('should always fall back to default and produce a warning for out-of-range values', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    fc.assert(
      fc.property(
        // Pick an arbitrary config key
        fc.constantFrom(...keys),
        // Generate a value that is outside the permitted range
        fc.oneof(
          // Below min
          fc.double({ min: -1e10, max: -1e-10, noNaN: true }).map((v) => v),
          // Above max (large positive)
          fc.double({ min: 1e3, max: 1e10, noNaN: true }),
          // Specifically below the key's min
          fc.constantFrom(...keys).chain((k) =>
            fc.double({ min: definitions[k].min - 1000, max: definitions[k].min - 0.001, noNaN: true })
          ),
          // Specifically above the key's max
          fc.constantFrom(...keys).chain((k) =>
            fc.double({ min: definitions[k].max + 0.001, max: definitions[k].max + 1000, noNaN: true })
          )
        ),
        (key, outOfRangeValue) => {
          const def = definitions[key];

          // Only test when value is truly out of range for this specific key
          if (outOfRangeValue >= def.min && outOfRangeValue <= def.max) {
            return; // Skip - value happens to be in range for this key
          }

          const result = validateThreshold(key, outOfRangeValue);

          // Must fall back to default
          expect(result.value).toBe(def.default);
          // Must produce a warning
          expect(result.warning).not.toBeNull();
        }
      ),
      { numRuns: 500 }
    );
  });

  it('should always fall back to default and produce a warning for non-numeric values', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Arbitrary non-number values: null, undefined, NaN, strings, objects, arrays, booleans
    const invalidValueArb = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.constant(NaN),
      fc.string(),
      fc.constant({}),
      fc.constant([]),
      fc.boolean(),
      fc.constant(Infinity),
      fc.constant(-Infinity)
    );

    fc.assert(
      fc.property(
        fc.constantFrom(...keys),
        invalidValueArb,
        (key, invalidValue) => {
          const def = definitions[key];
          const result = validateThreshold(key, invalidValue);

          // Must fall back to default
          expect(result.value).toBe(def.default);
          // Must produce a warning
          expect(result.warning).not.toBeNull();
          expect(result.warning).toContain(key);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('should use the provided value with no warning for valid in-range values', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...keys),
        fc.double({ min: 0, max: 1, noNaN: true }), // unit interval seed
        (key, unitSeed) => {
          const def = definitions[key];
          // Generate a valid value within the key's range
          const validValue = def.min + unitSeed * (def.max - def.min);

          // Clamp to ensure within range (floating point safety)
          const clampedValue = Math.min(def.max, Math.max(def.min, validValue));

          const result = validateThreshold(key, clampedValue);

          // Must use the provided value
          expect(result.value).toBe(clampedValue);
          // Must NOT produce a warning
          expect(result.warning).toBeNull();
        }
      ),
      { numRuns: 500 }
    );
  });

  it('ConfigStore should never contain out-of-range thresholds after construction with arbitrary overrides', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Generate arbitrary override objects with potentially invalid values
    const overrideArb = fc.dictionary(
      fc.constantFrom(...keys),
      fc.oneof(
        fc.double({ noNaN: false }), // includes NaN, infinities
        fc.constant(null),
        fc.constant(undefined),
        fc.string(),
        fc.integer({ min: -10000, max: 10000 })
      )
    ) as fc.Arbitrary<Partial<Record<keyof ConfigStoreValues, unknown>>>;

    fc.assert(
      fc.property(overrideArb, (overrides) => {
        const store = new ConfigStore(overrides);
        const values = store.getAll();

        // Every value in the store must be within its permitted range
        for (const key of keys) {
          const def = definitions[key];
          const val = values[key];

          expect(val).toBeGreaterThanOrEqual(def.min);
          expect(val).toBeLessThanOrEqual(def.max);
          expect(Number.isFinite(val)).toBe(true);
          expect(Number.isNaN(val)).toBe(false);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('ConfigStore should produce warnings for every invalid override provided', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    fc.assert(
      fc.property(
        fc.constantFrom(...keys),
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.constant(NaN),
          fc.string(),
          fc.constant(Infinity),
          fc.constant(-Infinity)
        ),
        (key, invalidValue) => {
          const store = new ConfigStore({ [key]: invalidValue } as Partial<Record<keyof ConfigStoreValues, unknown>>);
          const warnings = store.getWarnings();

          // At least one warning should be produced for the invalid value
          expect(warnings.length).toBeGreaterThanOrEqual(1);
          // The warning should reference the key that was invalid
          expect(warnings.some((w) => w.includes(key))).toBe(true);
          // The resulting stored value should be the default
          expect(store.get(key)).toBe(defaults[key]);
        }
      ),
      { numRuns: 300 }
    );
  });
});
