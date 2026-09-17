/**
 * Centralized, typed configuration store for all detection thresholds.
 *
 * All threshold values are prototype values requiring clinical validation.
 * Values can be updated at runtime and take effect on the next assessment session.
 */

import type { IndicatorKey, NormativeRange } from '../types';

/**
 * Interface representing all configurable detection thresholds.
 */
export interface ConfigStoreValues {
  /**
   * Minimum pose landmark confidence score for acceptance.
   * @remarks Prototype value requiring clinical validation
   * @default 0.5
   * @range [0.0, 1.0]
   */
  minPoseConfidence: number;

  /**
   * Minimum hand landmark confidence score for acceptance.
   * @remarks Prototype value requiring clinical validation
   * @default 0.5
   * @range [0.0, 1.0]
   */
  minHandConfidence: number;

  /**
   * Required continuous hold duration for position confirmation (seconds).
   * @remarks Prototype value requiring clinical validation
   * @default 2.0
   * @range [0.5, 3.0]
   */
  requiredHoldDuration: number;

  /**
   * Maximum permitted torso angle deviation from forward-facing (degrees).
   * @remarks Prototype value requiring clinical validation
   * @default 15
   * @range [1, 45]
   */
  maxTorsoAngleTolerance: number;

  /**
   * Maximum permitted elbow flexion deviation from full extension (degrees).
   * @remarks Prototype value requiring clinical validation
   * @default 15
   * @range [1, 45]
   */
  maxElbowFlexionTolerance: number;

  /**
   * Maximum permitted wrist height deviation from shoulder height (ratio of arm length).
   * @remarks Prototype value requiring clinical validation
   * @default 0.10
   * @range [0.01, 0.5]
   */
  maxWristHeightTolerance: number;

  /**
   * Minimum angle between upper arm and torso midline (degrees).
   * @remarks Prototype value requiring clinical validation
   * @default 20
   * @range [5, 90]
   */
  minArmBodyAngle: number;

  /**
   * Maximum permitted palm orientation deviation from vertical (degrees).
   * @remarks Prototype value requiring clinical validation
   * @default 45
   * @range [5, 90]
   */
  maxPalmOrientationTolerance: number;

  /**
   * Timeout for position validation before offering replay/exit (seconds).
   * @remarks Prototype value requiring clinical validation
   * @default 60
   * @range [10, 300]
   */
  positionValidationTimeout: number;

  /**
   * Duration of baseline capture window (seconds).
   * @remarks Prototype value requiring clinical validation
   * @default 2.5
   * @range [1.0, 5.0]
   */
  calibrationDuration: number;

  /**
   * Maximum extension of calibration window when instability detected (seconds).
   * @remarks Prototype value requiring clinical validation
   * @default 2.0
   * @range [0.5, 5.0]
   */
  maxCalibrationExtension: number;

  /**
   * Maximum acceptable wrist variation during calibration (ratio of arm length).
   * @remarks Prototype value requiring clinical validation
   * @default 0.05
   * @range [0.01, 0.2]
   */
  maxBaselineVariation: number;

  /**
   * Duration of the timed assessment (seconds).
   * @remarks Prototype value requiring clinical validation
   * @default 30
   * @range [10, 120]
   */
  assessmentDuration: number;

  /**
   * Minimum acceptable analysis frame rate during assessment (fps).
   * @remarks Prototype value requiring clinical validation
   * @default 10
   * @range [5, 60]
   */
  minAnalysisFrameRate: number;

  /**
   * Minimum normalized downward drift to be considered significant.
   * @remarks Prototype value requiring clinical validation
   * @default 0.03
   * @range [0.005, 0.2]
   */
  minDriftThreshold: number;

  /**
   * Minimum duration of sustained drift to qualify as meaningful (seconds).
   * @remarks Prototype value requiring clinical validation
   * @default 2.0
   * @range [0.5, 10.0]
   */
  minDriftDuration: number;

  /**
   * Minimum palm rotation change to report pronation (degrees).
   * @remarks Prototype value requiring clinical validation
   * @default 15
   * @range [5, 90]
   */
  minPronationChange: number;

  /**
   * Duration of the temporal smoothing window (seconds).
   * @remarks Prototype value requiring clinical validation
   * @default 0.5
   * @range [0.1, 2.0]
   */
  smoothingWindowDuration: number;

  /**
   * Minimum duration for a disturbance to not be rejected as noise (seconds).
   * @remarks Prototype value requiring clinical validation
   * @default 0.3
   * @range [0.1, 2.0]
   */
  minDisturbanceDuration: number;

  /**
   * Duration drift must persist before being classified (seconds).
   * @remarks Prototype value requiring clinical validation
   * @default 1.5
   * @range [0.5, 5.0]
   */
  driftPersistenceDuration: number;

  /**
   * Normalized camera movement threshold for frame exclusion.
   * @remarks Prototype value requiring clinical validation
   * @default 0.02
   * @range [0.005, 0.1]
   */
  cameraMovementThreshold: number;

  /**
   * Torso lean angle change threshold for compensation (degrees).
   * @remarks Prototype value requiring clinical validation
   * @default 5
   * @range [1, 30]
   */
  torsoLeanThreshold: number;

  /**
   * Minimum percentage of valid frames for reliable assessment (0-100).
   * @remarks Prototype value requiring clinical validation
   * @default 70
   * @range [30, 100]
   */
  minValidFramePercentage: number;

  /**
   * Grace period before excluding low-confidence intervals (seconds).
   * @remarks Prototype value requiring clinical validation
   * @default 2.0
   * @range [0.5, 10.0]
   */
  occlusionGracePeriod: number;

  /**
   * Minimum brightness level for adequate lighting (0-255).
   * @remarks Prototype value requiring clinical validation
   * @default 60
   * @range [10, 200]
   */
  minBrightnessThreshold: number;

  /**
   * Minimum frame rate for camera setup positioning checks (fps).
   * @remarks Prototype value requiring clinical validation
   * @default 5
   * @range [1, 30]
   */
  minPositioningFrameRate: number;
}

/** Definition of a config threshold including its valid range and default. */
interface ThresholdDefinition {
  default: number;
  min: number;
  max: number;
  unit: string;
}

/**
 * Registry of all threshold definitions with their defaults and valid ranges.
 * Each entry is a prototype value requiring clinical validation.
 */
const THRESHOLD_DEFINITIONS: Record<keyof ConfigStoreValues, ThresholdDefinition> = {
  minPoseConfidence: { default: 0.5, min: 0.0, max: 1.0, unit: 'normalized ratio' },
  minHandConfidence: { default: 0.5, min: 0.0, max: 1.0, unit: 'normalized ratio' },
  requiredHoldDuration: { default: 2.0, min: 0.5, max: 3.0, unit: 'seconds' },
  maxTorsoAngleTolerance: { default: 15, min: 1, max: 45, unit: 'degrees' },
  maxElbowFlexionTolerance: { default: 15, min: 1, max: 45, unit: 'degrees' },
  maxWristHeightTolerance: { default: 0.10, min: 0.01, max: 0.5, unit: 'ratio of arm length' },
  minArmBodyAngle: { default: 20, min: 5, max: 90, unit: 'degrees' },
  maxPalmOrientationTolerance: { default: 45, min: 5, max: 90, unit: 'degrees' },
  positionValidationTimeout: { default: 60, min: 10, max: 300, unit: 'seconds' },
  calibrationDuration: { default: 2.5, min: 1.0, max: 5.0, unit: 'seconds' },
  maxCalibrationExtension: { default: 2.0, min: 0.5, max: 5.0, unit: 'seconds' },
  maxBaselineVariation: { default: 0.05, min: 0.01, max: 0.2, unit: 'ratio of arm length' },
  assessmentDuration: { default: 30, min: 10, max: 120, unit: 'seconds' },
  minAnalysisFrameRate: { default: 10, min: 5, max: 60, unit: 'fps' },
  minDriftThreshold: { default: 0.03, min: 0.005, max: 0.2, unit: 'normalized' },
  minDriftDuration: { default: 2.0, min: 0.5, max: 10.0, unit: 'seconds' },
  minPronationChange: { default: 15, min: 5, max: 90, unit: 'degrees' },
  smoothingWindowDuration: { default: 0.5, min: 0.1, max: 2.0, unit: 'seconds' },
  minDisturbanceDuration: { default: 0.3, min: 0.1, max: 2.0, unit: 'seconds' },
  driftPersistenceDuration: { default: 1.5, min: 0.5, max: 5.0, unit: 'seconds' },
  cameraMovementThreshold: { default: 0.02, min: 0.005, max: 0.1, unit: 'normalized' },
  torsoLeanThreshold: { default: 5, min: 1, max: 30, unit: 'degrees' },
  minValidFramePercentage: { default: 70, min: 30, max: 100, unit: 'percentage' },
  occlusionGracePeriod: { default: 2.0, min: 0.5, max: 10.0, unit: 'seconds' },
  minBrightnessThreshold: { default: 60, min: 10, max: 200, unit: '0-255 luminance' },
  minPositioningFrameRate: { default: 5, min: 1, max: 30, unit: 'fps' },
};

/**
 * Returns the complete set of default configuration values.
 */
export function getDefaultConfig(): ConfigStoreValues {
  const defaults = {} as ConfigStoreValues;
  for (const key of Object.keys(THRESHOLD_DEFINITIONS) as Array<keyof ConfigStoreValues>) {
    defaults[key] = THRESHOLD_DEFINITIONS[key].default;
  }
  return defaults;
}

/**
 * Retrieves the threshold definition (range, default, unit) for a given key.
 */
export function getThresholdDefinition(key: keyof ConfigStoreValues): ThresholdDefinition {
  return THRESHOLD_DEFINITIONS[key];
}

/**
 * Retrieves all threshold definitions.
 */
export function getAllThresholdDefinitions(): Record<keyof ConfigStoreValues, ThresholdDefinition> {
  return { ...THRESHOLD_DEFINITIONS };
}

/**
 * Validates a single threshold value against its permitted range.
 * Returns the validated value (clamped to default if invalid) and any warning message.
 */
export function validateThreshold(
  key: keyof ConfigStoreValues,
  value: unknown
): { value: number; warning: string | null } {
  const def = THRESHOLD_DEFINITIONS[key];

  if (value === undefined || value === null || typeof value !== 'number' || isNaN(value)) {
    return {
      value: def.default,
      warning: `Config "${key}": value is missing or not a valid number. Applying default: ${def.default} (${def.unit}).`,
    };
  }

  if (value < def.min || value > def.max) {
    return {
      value: def.default,
      warning: `Config "${key}": value ${value} is outside permitted range [${def.min}, ${def.max}]. Applying default: ${def.default} (${def.unit}).`,
    };
  }

  return { value, warning: null };
}

// ─── Normative Ranges registry ───────────────────────────────────────────────

/**
 * Definition of a prototype normative reference range, extending {@link NormativeRange}
 * with the permitted bounds used to validate runtime updates (Req 16.4).
 */
export interface NormativeRangeDefinition extends NormativeRange {
  /** Minimum permitted value for `lowerBound` during a runtime update. */
  minLower: number;
  /** Maximum permitted value for `upperBound` during a runtime update. */
  maxUpper: number;
}

/**
 * Registry of prototype normative reference ranges keyed by indicator.
 *
 * Each entry is a prototype seed carrying a literature-style citation and is
 * explicitly labeled `prototype: true` pending clinical validation (Req 9.5, 16.2).
 * Indicators without an entry have "no established reference range" (Req 9.4).
 */
const NORMATIVE_RANGES: Partial<Record<IndicatorKey, NormativeRangeDefinition>> = {
  wristDrift: {
    lowerBound: 0,
    upperBound: 0.03,
    unit: 'normalized',
    prototype: true,
    citation: 'Prototype seed — pending clinical validation',
    minLower: 0,
    maxUpper: 0.5,
  },
  wristTremorDominantFrequency: {
    lowerBound: 8,
    upperBound: 12,
    unit: 'Hz',
    prototype: true,
    citation: 'Physiological tremor band (prototype) — pending clinical validation',
    minLower: 0,
    maxUpper: 30,
  },
  palmRotationChange: {
    lowerBound: 0,
    upperBound: 15,
    unit: 'degrees',
    prototype: true,
    citation: 'Prototype seed — pending clinical validation',
    minLower: 0,
    maxUpper: 180,
  },
};

/** Deep-copies a normative range definition so callers cannot mutate the registry. */
function cloneNormativeRangeDefinition(def: NormativeRangeDefinition): NormativeRangeDefinition {
  return { ...def };
}

/**
 * Returns the default (seeded) normative range registry as a fresh copy.
 */
export function getDefaultNormativeRanges(): Partial<Record<IndicatorKey, NormativeRangeDefinition>> {
  const copy: Partial<Record<IndicatorKey, NormativeRangeDefinition>> = {};
  for (const key of Object.keys(NORMATIVE_RANGES) as Array<keyof typeof NORMATIVE_RANGES>) {
    const def = NORMATIVE_RANGES[key];
    if (def) {
      copy[key] = cloneNormativeRangeDefinition(def);
    }
  }
  return copy;
}

/**
 * Validates a proposed partial update to a normative range against its permitted bounds.
 *
 * Returns the resulting merged definition (unchanged when invalid) and any warning.
 * A well-formed update must keep `lowerBound <= upperBound`, keep `lowerBound >= minLower`,
 * and keep `upperBound <= maxUpper` (Req 16.4).
 */
export function validateNormativeRangeUpdate(
  key: IndicatorKey,
  current: NormativeRangeDefinition,
  partial: Partial<Pick<NormativeRange, 'lowerBound' | 'upperBound' | 'unit' | 'citation'>>
): { value: NormativeRangeDefinition; warning: string | null } {
  const lowerBound = partial.lowerBound ?? current.lowerBound;
  const upperBound = partial.upperBound ?? current.upperBound;

  const isInvalidNumber = (n: unknown): boolean =>
    typeof n !== 'number' || Number.isNaN(n);

  if (isInvalidNumber(lowerBound) || isInvalidNumber(upperBound)) {
    return {
      value: current,
      warning: `NormativeRange "${key}": bounds must be valid numbers. Retaining current range [${current.lowerBound}, ${current.upperBound}] (${current.unit}).`,
    };
  }

  if (lowerBound > upperBound) {
    return {
      value: current,
      warning: `NormativeRange "${key}": lowerBound ${lowerBound} exceeds upperBound ${upperBound}. Retaining current range [${current.lowerBound}, ${current.upperBound}] (${current.unit}).`,
    };
  }

  if (lowerBound < current.minLower || upperBound > current.maxUpper) {
    return {
      value: current,
      warning: `NormativeRange "${key}": range [${lowerBound}, ${upperBound}] is outside permitted bounds [${current.minLower}, ${current.maxUpper}]. Retaining current range [${current.lowerBound}, ${current.upperBound}] (${current.unit}).`,
    };
  }

  const merged: NormativeRangeDefinition = {
    ...current,
    lowerBound,
    upperBound,
    unit: partial.unit ?? current.unit,
    citation: partial.citation ?? current.citation,
    prototype: true,
  };

  return { value: merged, warning: null };
}

/**
 * ConfigStore — centralized, typed configuration for all detection thresholds.
 *
 * All values are prototype values requiring clinical validation.
 * Supports runtime updates; changed values take effect on the next assessment session.
 */
export class ConfigStore {
  private values: ConfigStoreValues;
  private warnings: string[] = [];
  private normativeRanges: Partial<Record<IndicatorKey, NormativeRangeDefinition>>;

  constructor(overrides?: Partial<Record<keyof ConfigStoreValues, unknown>>) {
    this.values = getDefaultConfig();
    this.normativeRanges = getDefaultNormativeRanges();

    if (overrides) {
      this.applyOverrides(overrides);
    }
  }

  /**
   * Returns the current value for a given threshold key.
   */
  get<K extends keyof ConfigStoreValues>(key: K): ConfigStoreValues[K] {
    return this.values[key];
  }

  /**
   * Returns a snapshot of all current configuration values.
   */
  getAll(): Readonly<ConfigStoreValues> {
    return { ...this.values };
  }

  /**
   * Updates one or more threshold values at runtime.
   * Invalid values are rejected, defaults applied, and warnings logged.
   * Updated values take effect on the next assessment session.
   */
  update(overrides: Partial<Record<keyof ConfigStoreValues, unknown>>): void {
    this.applyOverrides(overrides);
  }

  /**
   * Returns all warnings generated during construction or updates.
   */
  getWarnings(): readonly string[] {
    return [...this.warnings];
  }

  /**
   * Clears accumulated warnings.
   */
  clearWarnings(): void {
    this.warnings = [];
  }

  /**
   * Returns the prototype normative reference range for a given indicator, or
   * `null` when the indicator has no established reference range (Req 9.4, 16.1).
   *
   * The returned value is the public {@link NormativeRange} shape (permitted-bound
   * metadata is kept internal) and is a copy that callers cannot use to mutate the store.
   */
  getNormativeRange(key: IndicatorKey): NormativeRange | null {
    const def = this.normativeRanges[key];
    if (!def) {
      return null;
    }
    const { minLower: _minLower, maxUpper: _maxUpper, ...range } = def;
    return { ...range };
  }

  /**
   * Returns a snapshot of all defined normative reference ranges keyed by indicator (Req 16.1).
   * Only indicators with a defined range are present; each value is the public
   * {@link NormativeRange} shape.
   */
  getAllNormativeRanges(): Partial<Record<IndicatorKey, NormativeRange>> {
    const snapshot: Partial<Record<IndicatorKey, NormativeRange>> = {};
    for (const key of Object.keys(this.normativeRanges) as IndicatorKey[]) {
      const range = this.getNormativeRange(key);
      if (range) {
        snapshot[key] = range;
      }
    }
    return snapshot;
  }

  /**
   * Updates a normative reference range at runtime (Req 16.3).
   *
   * Only indicators that already have a defined range can be updated. Invalid updates
   * (unknown indicator, malformed bounds, or bounds outside the permitted range) are
   * rejected, the existing range is retained, and a warning is recorded (Req 16.4).
   * Updated ranges take effect on the next assessment session.
   */
  updateNormativeRange(
    key: IndicatorKey,
    partial: Partial<Pick<NormativeRange, 'lowerBound' | 'upperBound' | 'unit' | 'citation'>>
  ): void {
    const current = this.normativeRanges[key];

    if (!current) {
      const warning = `NormativeRange: no established reference range for indicator "${key}"; update ignored.`;
      this.warnings.push(warning);
      console.warn(warning);
      return;
    }

    const { value, warning } = validateNormativeRangeUpdate(key, current, partial);
    this.normativeRanges[key] = value;

    if (warning) {
      this.warnings.push(warning);
      console.warn(warning);
    }
  }

  /**
   * Applies partial overrides, validating each value and logging warnings for invalid entries.
   */
  private applyOverrides(overrides: Partial<Record<keyof ConfigStoreValues, unknown>>): void {
    for (const key of Object.keys(overrides) as Array<keyof ConfigStoreValues>) {
      if (!(key in THRESHOLD_DEFINITIONS)) {
        const warning = `Config: unknown key "${key}" ignored.`;
        this.warnings.push(warning);
        console.warn(warning);
        continue;
      }

      const { value, warning } = validateThreshold(key, overrides[key]);
      this.values[key] = value;

      if (warning) {
        this.warnings.push(warning);
        console.warn(warning);
      }
    }
  }
}

/**
 * Singleton instance for application-wide access.
 * Can be replaced via `resetConfigStore()` for testing.
 */
let configStoreInstance: ConfigStore | null = null;

/**
 * Returns the global ConfigStore singleton, creating it with defaults if needed.
 */
export function getConfigStore(): ConfigStore {
  if (!configStoreInstance) {
    configStoreInstance = new ConfigStore();
  }
  return configStoreInstance;
}

/**
 * Initializes or replaces the global ConfigStore singleton with the given overrides.
 */
export function initConfigStore(overrides?: Partial<Record<keyof ConfigStoreValues, unknown>>): ConfigStore {
  configStoreInstance = new ConfigStore(overrides);
  return configStoreInstance;
}

/**
 * Resets the global ConfigStore singleton (useful for testing).
 */
export function resetConfigStore(): void {
  configStoreInstance = null;
}
