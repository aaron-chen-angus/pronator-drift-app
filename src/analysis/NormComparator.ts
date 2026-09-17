/**
 * NormComparator
 *
 * Pure comparison of a derived micro-movement indicator value against its
 * prototype normative reference range (sourced from `ConfigStore`).
 *
 * All normative ranges are prototype values requiring clinical validation, so
 * every produced comparison carries `prototype: true` and the range's citation.
 *
 * Requirements: 9.2, 9.3, 9.4, 9.5, 9.6
 */

import type { IndicatorKey, NormComparison, NormOutcome } from '../types';
import type { ConfigStore } from '../config/ConfigStore';

/**
 * Compares an indicator value against its normative range.
 *
 * Outcome precedence:
 * - `not_measured` when the indicator is not measurable or its value is null (Req 9.6).
 * - `no_reference` when no normative range is defined for the indicator (Req 9.4).
 * - `within` when the value lies inside [lowerBound, upperBound] inclusive (Req 9.2).
 * - `outside` otherwise (Req 9.2).
 *
 * The associated citation (Req 9.3) is always carried when a range exists, and
 * every result is labeled `prototype: true` (Req 9.5).
 */
export function compareToNorm(
  indicatorKey: IndicatorKey,
  value: number | null,
  measurable: boolean,
  config: ConfigStore
): NormComparison {
  // Req 9.6: not measurable or missing value => not_measured, no comparison.
  if (!measurable || value === null) {
    return {
      indicatorKey,
      value: null,
      outcome: 'not_measured',
      range: null,
      citation: null,
      prototype: true,
    };
  }

  const range = config.getNormativeRange(indicatorKey);

  // Req 9.4: no established reference range => no_reference.
  if (range === null) {
    return {
      indicatorKey,
      value,
      outcome: 'no_reference',
      range: null,
      citation: null,
      prototype: true,
    };
  }

  // Req 9.2: within when inside [lowerBound, upperBound] inclusive, outside otherwise.
  const outcome: NormOutcome =
    value >= range.lowerBound && value <= range.upperBound ? 'within' : 'outside';

  return {
    indicatorKey,
    value,
    outcome,
    range,
    // Req 9.3: always carry the citation from the range.
    citation: range.citation,
    // Req 9.5: always labeled prototype pending validation.
    prototype: true,
  };
}
