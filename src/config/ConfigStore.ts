/**
 * Centralized, typed configuration store for all detection thresholds.
 *
 * All threshold values are prototype values requiring clinical validation.
 * Values can be updated at runtime and take effect on the next assessment session.
 */

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

/**
 * ConfigStore — centralized, typed configuration for all detection thresholds.
 *
 * All values are prototype values requiring clinical validation.
 * Supports runtime updates; changed values take effect on the next assessment session.
 */
export class ConfigStore {
  private values: ConfigStoreValues;
  private warnings: string[] = [];

  constructor(overrides?: Partial<Record<keyof ConfigStoreValues, unknown>>) {
    this.values = getDefaultConfig();

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
