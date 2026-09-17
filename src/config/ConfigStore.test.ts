import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ConfigStore,
  ConfigStoreValues,
  getDefaultConfig,
  getThresholdDefinition,
  getAllThresholdDefinitions,
  validateThreshold,
  getConfigStore,
  initConfigStore,
  resetConfigStore,
} from './ConfigStore';

describe('ConfigStore', () => {
  beforeEach(() => {
    resetConfigStore();
    vi.restoreAllMocks();
  });

  describe('default values', () => {
    it('should initialize with all expected default values', () => {
      const store = new ConfigStore();
      const values = store.getAll();

      expect(values.minPoseConfidence).toBe(0.5);
      expect(values.minHandConfidence).toBe(0.5);
      expect(values.requiredHoldDuration).toBe(2.0);
      expect(values.maxTorsoAngleTolerance).toBe(15);
      expect(values.maxElbowFlexionTolerance).toBe(15);
      expect(values.maxWristHeightTolerance).toBe(0.10);
      expect(values.minArmBodyAngle).toBe(20);
      expect(values.maxPalmOrientationTolerance).toBe(45);
      expect(values.positionValidationTimeout).toBe(60);
      expect(values.calibrationDuration).toBe(2.5);
      expect(values.maxCalibrationExtension).toBe(2.0);
      expect(values.maxBaselineVariation).toBe(0.05);
      expect(values.assessmentDuration).toBe(30);
      expect(values.minAnalysisFrameRate).toBe(10);
      expect(values.minDriftThreshold).toBe(0.03);
      expect(values.minDriftDuration).toBe(2.0);
      expect(values.minPronationChange).toBe(15);
      expect(values.smoothingWindowDuration).toBe(0.5);
      expect(values.minDisturbanceDuration).toBe(0.3);
      expect(values.driftPersistenceDuration).toBe(1.5);
      expect(values.cameraMovementThreshold).toBe(0.02);
      expect(values.torsoLeanThreshold).toBe(5);
      expect(values.minValidFramePercentage).toBe(70);
      expect(values.occlusionGracePeriod).toBe(2.0);
      expect(values.minBrightnessThreshold).toBe(60);
      expect(values.minPositioningFrameRate).toBe(5);
    });

    it('should have 26 threshold keys', () => {
      const store = new ConfigStore();
      const values = store.getAll();
      expect(Object.keys(values)).toHaveLength(26);
    });
  });

  describe('overrides during construction', () => {
    it('should accept valid overrides', () => {
      const store = new ConfigStore({ minPoseConfidence: 0.7, assessmentDuration: 45 });
      expect(store.get('minPoseConfidence')).toBe(0.7);
      expect(store.get('assessmentDuration')).toBe(45);
    });

    it('should reject out-of-range values and apply defaults', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = new ConfigStore({ minPoseConfidence: 2.0 });

      expect(store.get('minPoseConfidence')).toBe(0.5);
      expect(store.getWarnings().length).toBe(1);
      expect(store.getWarnings()[0]).toContain('outside permitted range');
      expect(warnSpy).toHaveBeenCalled();
    });

    it('should reject negative out-of-range values and apply defaults', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = new ConfigStore({ minPoseConfidence: -0.1 });

      expect(store.get('minPoseConfidence')).toBe(0.5);
      expect(store.getWarnings().length).toBe(1);
    });

    it('should reject non-number values and apply defaults', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = new ConfigStore({ minPoseConfidence: 'invalid' as unknown as number });

      expect(store.get('minPoseConfidence')).toBe(0.5);
      expect(store.getWarnings()[0]).toContain('not a valid number');
    });

    it('should reject null values and apply defaults', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = new ConfigStore({ assessmentDuration: null as unknown as number });

      expect(store.get('assessmentDuration')).toBe(30);
    });

    it('should reject undefined values and apply defaults', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = new ConfigStore({ assessmentDuration: undefined as unknown as number });

      expect(store.get('assessmentDuration')).toBe(30);
    });

    it('should reject NaN values and apply defaults', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = new ConfigStore({ assessmentDuration: NaN });

      expect(store.get('assessmentDuration')).toBe(30);
    });

    it('should warn on unknown keys', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = new ConfigStore({ unknownKey: 42 } as unknown as Partial<Record<keyof ConfigStoreValues, unknown>>);

      expect(store.getWarnings()[0]).toContain('unknown key');
    });
  });

  describe('runtime updates', () => {
    it('should update valid values', () => {
      const store = new ConfigStore();
      store.update({ minDriftThreshold: 0.05, calibrationDuration: 3.0 });

      expect(store.get('minDriftThreshold')).toBe(0.05);
      expect(store.get('calibrationDuration')).toBe(3.0);
    });

    it('should reject invalid runtime updates and apply defaults', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = new ConfigStore({ minDriftThreshold: 0.05 });
      store.update({ minDriftThreshold: 999 });

      expect(store.get('minDriftThreshold')).toBe(0.03); // falls back to default
      expect(store.getWarnings().length).toBe(1);
    });

    it('should accept boundary values (min)', () => {
      const store = new ConfigStore();
      store.update({ minPoseConfidence: 0.0 });
      expect(store.get('minPoseConfidence')).toBe(0.0);
    });

    it('should accept boundary values (max)', () => {
      const store = new ConfigStore();
      store.update({ minPoseConfidence: 1.0 });
      expect(store.get('minPoseConfidence')).toBe(1.0);
    });
  });

  describe('getWarnings and clearWarnings', () => {
    it('should accumulate warnings across updates', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = new ConfigStore({ minPoseConfidence: -1 });
      store.update({ minHandConfidence: 5 });

      expect(store.getWarnings()).toHaveLength(2);
    });

    it('should clear warnings', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = new ConfigStore({ minPoseConfidence: -1 });
      store.clearWarnings();

      expect(store.getWarnings()).toHaveLength(0);
    });
  });

  describe('validateThreshold utility', () => {
    it('should return value and no warning for valid input', () => {
      const result = validateThreshold('minPoseConfidence', 0.7);
      expect(result.value).toBe(0.7);
      expect(result.warning).toBeNull();
    });

    it('should return default and warning for out-of-range input', () => {
      const result = validateThreshold('minPoseConfidence', 1.5);
      expect(result.value).toBe(0.5);
      expect(result.warning).not.toBeNull();
    });

    it('should return default and warning for non-number input', () => {
      const result = validateThreshold('assessmentDuration', 'hello');
      expect(result.value).toBe(30);
      expect(result.warning).toContain('not a valid number');
    });
  });

  describe('getDefaultConfig', () => {
    it('should return a complete config object', () => {
      const defaults = getDefaultConfig();
      expect(Object.keys(defaults)).toHaveLength(26);
      expect(defaults.minPoseConfidence).toBe(0.5);
    });
  });

  describe('getThresholdDefinition', () => {
    it('should return definition with default, min, max, unit', () => {
      const def = getThresholdDefinition('assessmentDuration');
      expect(def.default).toBe(30);
      expect(def.min).toBe(10);
      expect(def.max).toBe(120);
      expect(def.unit).toBe('seconds');
    });
  });

  describe('getAllThresholdDefinitions', () => {
    it('should return all 26 definitions', () => {
      const defs = getAllThresholdDefinitions();
      expect(Object.keys(defs)).toHaveLength(26);
    });
  });

  describe('singleton management', () => {
    it('getConfigStore should return same instance', () => {
      const a = getConfigStore();
      const b = getConfigStore();
      expect(a).toBe(b);
    });

    it('initConfigStore should create new instance with overrides', () => {
      const store = initConfigStore({ assessmentDuration: 45 });
      expect(store.get('assessmentDuration')).toBe(45);
      expect(getConfigStore()).toBe(store);
    });

    it('resetConfigStore should clear singleton', () => {
      const a = getConfigStore();
      resetConfigStore();
      const b = getConfigStore();
      expect(a).not.toBe(b);
    });
  });
});
