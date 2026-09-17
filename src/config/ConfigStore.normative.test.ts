import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ConfigStore,
  getDefaultNormativeRanges,
} from './ConfigStore';
import type { IndicatorKey, NormativeRange } from '../types';

/**
 * Unit tests for the ConfigStore prototype normative-range registry.
 *
 * Covers:
 *  - Every defined range has numeric bounds, a unit, a non-empty citation, and prototype === true.
 *  - Out-of-permitted-bounds updates retain the default range and record a warning.
 *  - Updates to an unknown indicator (no range) record a warning and do not create a range.
 *
 * _Requirements: 9.1, 16.2, 16.4_
 */

describe('ConfigStore normative registry', () => {
  let store: ConfigStore;

  beforeEach(() => {
    store = new ConfigStore();
    vi.restoreAllMocks();
  });

  describe('registry integrity (Req 9.1, 16.2)', () => {
    it('every defined range has numeric bounds, a unit, a non-empty citation, and prototype: true', () => {
      const ranges = store.getAllNormativeRanges();
      const keys = Object.keys(ranges) as IndicatorKey[];

      // There is at least one seeded range to validate.
      expect(keys.length).toBeGreaterThan(0);

      for (const key of keys) {
        const range = ranges[key] as NormativeRange;
        expect(range).toBeDefined();

        // Numeric, finite bounds with lower <= upper.
        expect(typeof range.lowerBound).toBe('number');
        expect(Number.isFinite(range.lowerBound)).toBe(true);
        expect(typeof range.upperBound).toBe('number');
        expect(Number.isFinite(range.upperBound)).toBe(true);
        expect(range.lowerBound).toBeLessThanOrEqual(range.upperBound);

        // Unit present and non-empty.
        expect(typeof range.unit).toBe('string');
        expect(range.unit.length).toBeGreaterThan(0);

        // Non-empty citation.
        expect(typeof range.citation).toBe('string');
        expect(range.citation.trim().length).toBeGreaterThan(0);

        // Always labeled prototype pending clinical validation.
        expect(range.prototype).toBe(true);
      }
    });

    it('exposes the seeded indicators (wristDrift, wristTremorDominantFrequency, palmRotationChange)', () => {
      expect(store.getNormativeRange('wristDrift')).not.toBeNull();
      expect(store.getNormativeRange('wristTremorDominantFrequency')).not.toBeNull();
      expect(store.getNormativeRange('palmRotationChange')).not.toBeNull();
    });

    it('getNormativeRange returns the same shape validated above and null for undefined indicators', () => {
      const wristDrift = store.getNormativeRange('wristDrift');
      expect(wristDrift).not.toBeNull();
      expect(wristDrift?.prototype).toBe(true);
      expect(wristDrift?.citation).toBeTruthy();
      expect(wristDrift?.unit).toBeTruthy();

      // An indicator with no seeded range => "no established reference range".
      expect(store.getNormativeRange('stability')).toBeNull();
    });

    it('does not leak the internal permitted-bound metadata (minLower/maxUpper)', () => {
      const range = store.getNormativeRange('wristDrift') as NormativeRange & {
        minLower?: number;
        maxUpper?: number;
      };
      expect(range.minLower).toBeUndefined();
      expect(range.maxUpper).toBeUndefined();
    });

    it('getAllNormativeRanges returns a snapshot that cannot mutate the store', () => {
      const snapshot = store.getAllNormativeRanges();
      const original = store.getNormativeRange('wristDrift')!.upperBound;

      // Mutate the returned copy.
      (snapshot.wristDrift as NormativeRange).upperBound = 999;

      // Store must be unaffected.
      expect(store.getNormativeRange('wristDrift')!.upperBound).toBe(original);
    });
  });

  describe('invalid updates retain defaults and record a warning (Req 16.4)', () => {
    it('rejects an out-of-permitted-bounds update, retains the default range, and records a warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const defaults = getDefaultNormativeRanges();
      const defaultRange = defaults.wristDrift!;
      const before = store.getNormativeRange('wristDrift')!;

      // wristDrift permits upperBound at most maxUpper (0.5). Exceed it.
      store.updateNormativeRange('wristDrift', { upperBound: 5 });

      const after = store.getNormativeRange('wristDrift')!;

      // Default range retained (unchanged).
      expect(after.lowerBound).toBe(before.lowerBound);
      expect(after.upperBound).toBe(before.upperBound);
      expect(after.upperBound).toBe(defaultRange.upperBound);

      // A warning was recorded and logged.
      const warnings = store.getWarnings();
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some((w) => w.includes('wristDrift'))).toBe(true);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('rejects an update where lowerBound exceeds upperBound and retains the default range', () => {
      const before = store.getNormativeRange('palmRotationChange')!;

      store.updateNormativeRange('palmRotationChange', { lowerBound: 100, upperBound: 10 });

      const after = store.getNormativeRange('palmRotationChange')!;
      expect(after.lowerBound).toBe(before.lowerBound);
      expect(after.upperBound).toBe(before.upperBound);
      expect(store.getWarnings().some((w) => w.includes('palmRotationChange'))).toBe(true);
    });

    it('rejects a non-numeric bound and retains the default range', () => {
      const before = store.getNormativeRange('wristTremorDominantFrequency')!;

      store.updateNormativeRange('wristTremorDominantFrequency', {
        // Force an invalid runtime value past the type system.
        lowerBound: Number.NaN,
      });

      const after = store.getNormativeRange('wristTremorDominantFrequency')!;
      expect(after.lowerBound).toBe(before.lowerBound);
      expect(after.upperBound).toBe(before.upperBound);
      expect(store.getWarnings().length).toBeGreaterThan(0);
    });

    it('accepts a valid in-bounds update (control case) and records no warning', () => {
      store.updateNormativeRange('wristDrift', { upperBound: 0.04 });

      const after = store.getNormativeRange('wristDrift')!;
      expect(after.upperBound).toBe(0.04);
      expect(after.prototype).toBe(true);
      expect(store.getWarnings().length).toBe(0);
    });
  });

  describe('unknown-indicator updates record a warning and create no range (Req 16.4)', () => {
    it('does not create a range for an indicator that has no established reference range', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // 'stability' has no seeded range.
      expect(store.getNormativeRange('stability')).toBeNull();

      store.updateNormativeRange('stability', { lowerBound: 0, upperBound: 1, unit: 'ratio' });

      // Still no range — the update was ignored.
      expect(store.getNormativeRange('stability')).toBeNull();

      const warnings = store.getWarnings();
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some((w) => w.includes('stability'))).toBe(true);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('leaves the set of defined indicators unchanged after an unknown-indicator update', () => {
      const keysBefore = Object.keys(store.getAllNormativeRanges()).sort();

      store.updateNormativeRange('elbowDrift', { lowerBound: 0, upperBound: 0.1 });

      const keysAfter = Object.keys(store.getAllNormativeRanges()).sort();
      expect(keysAfter).toEqual(keysBefore);
    });
  });
});
