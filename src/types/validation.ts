/**
 * Validation utilities for normalized measurements and range-constrained fields.
 *
 * These utilities support the data model validation requirements for the
 * Pronator Drift Screening Application.
 */

/**
 * Formats a normalized measurement value (in range [0.0, 1.0]) to its string representation.
 * Uses full precision to avoid lossy round-trip.
 *
 * @param value - A number in the range [0.0, 1.0]
 * @returns The string representation of the value
 */
export function formatNormalizedMeasurement(value: number): string {
  return value.toString();
}

/**
 * Parses a string representation of a normalized measurement back to a number.
 *
 * @param str - The string representation of a normalized measurement
 * @returns The parsed numeric value
 */
export function parseNormalizedMeasurement(str: string): number {
  return parseFloat(str);
}

/**
 * Result type for range validation.
 */
export type RangeValidationResult = {
  valid: boolean;
  value: number;
};

/**
 * Validates whether a numeric value falls within the normalized range [0.0, 1.0].
 *
 * Per Requirement 26.5: If a numeric field defined as 0.0 to 1.0 receives a value
 * outside that range, the application shall treat the value as invalid.
 *
 * @param value - The numeric value to validate
 * @returns A RangeValidationResult indicating whether the value is valid
 */
export function validateNormalizedRange(value: number): RangeValidationResult {
  const valid = value >= 0.0 && value <= 1.0;
  return { valid, value };
}
