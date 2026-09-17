/**
 * sheetsExport — optional, consented Google Sheets result sink.
 *
 * Posts each completed assessment's PARTICIPANT DETAILS + every metric in the
 * data dictionary (README §5) to a Google Apps Script Web App, which appends a
 * row to a Google Sheet. It uses a "fire-and-forget" POST with a `text/plain`
 * body so it works from a static host (GitHub Pages / the standalone launcher)
 * without a CORS preflight.
 *
 * PRIVACY: this is DISABLED unless a Web App URL is configured (either the
 * `SHEETS_WEBAPP_URL` constant below, or the `VITE_SHEETS_WEBAPP_URL` build-time
 * env var). No video or landmark data is ever sent — only the computed result
 * values and the participant details entered on the intake screen. Obtain
 * participant consent before enabling it (the intake declaration covers this).
 *
 * The payload keys and their ORDER mirror the Google Sheet header row defined in
 * the Apps Script (README §14). Keep the two in sync when adding fields.
 */

import type {
  MicroMovementIndicators,
  NormComparison,
  NormOutcome,
  IndicatorKey,
  PronatorDriftAssessment,
  TimeSeriesIndicator,
} from '../types/index';

/**
 * Paste your Apps Script Web App URL here to enable the export, OR set the
 * `VITE_SHEETS_WEBAPP_URL` environment variable at build time (preferred, so the
 * URL is not committed). The env var takes precedence when present.
 */
const SHEETS_WEBAPP_URL_CONSTANT = 'https://script.google.com/macros/s/AKfycbwO9scBGtGIFf0EBi3Qx2MknCQ2G_eNYJSXIfh2uIeHs8QXgqeyeydO3NeNYYMxkoIT/exec';

function resolveWebAppUrl(): string {
  // Vite exposes VITE_-prefixed env vars on import.meta.env (typed via
  // vite/client). Fall back to the in-file constant when the env var is absent.
  const env = import.meta.env as Record<string, string | undefined>;
  const fromEnv = env.VITE_SHEETS_WEBAPP_URL;
  return (fromEnv && fromEnv.trim()) || SHEETS_WEBAPP_URL_CONSTANT.trim();
}

/** Rounds a number for compact storage, preserving nulls. */
function round(value: number | null | undefined, dp = 4): number | null {
  if (value == null || Number.isNaN(value)) return null;
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

/** Pulls the max summary value of a time-series indicator (null-safe). */
function seriesMax(ind: TimeSeriesIndicator | undefined): number | null {
  return ind ? round(ind.summary.max) : null;
}

/** Pulls the standard deviation (variability) of a time-series indicator. */
function seriesSd(ind: TimeSeriesIndicator | undefined): number | null {
  return ind ? round(ind.summary.standardDeviation) : null;
}

/** Pulls the mean of a time-series indicator. */
function seriesMean(ind: TimeSeriesIndicator | undefined): number | null {
  return ind ? round(ind.summary.mean) : null;
}

/**
 * Builds the per-arm block of metrics from that arm's derived indicators plus
 * the arm-level assessment aggregates. Covers every per-arm field in §5.
 */
function armBlock(
  ind: MicroMovementIndicators | undefined,
  arm: {
    maximumDownwardDriftNormalised: number;
    driftOnsetSeconds: number | null;
    driftDurationMilliseconds: number;
    sustainedDownwardDrift: boolean;
    baselineWristHeight: number;
    confidence: number;
  }
) {
  return {
    // Primary drift indicators (§5.1)
    maxDrift: round(arm.maximumDownwardDriftNormalised),
    driftOnsetSeconds: round(arm.driftOnsetSeconds, 2),
    driftDurationMs: Math.round(arm.driftDurationMilliseconds),
    sustainedDrift: !!arm.sustainedDownwardDrift,
    elbowDriftMax: seriesMax(ind?.elbowDrift),
    baselineWristHeight: round(arm.baselineWristHeight),
    // Rotational / pronation indicators (§5.2)
    pronationDegrees: round(ind?.totalPalmRotationChangeDegrees, 2),
    possiblePronation: ind?.possiblePronation ?? false,
    supinationToPronationTrend: ind?.supinationToPronationTrend ?? false,
    // Joint-angle indicators (§5.3)
    elbowFlexionChange: round(ind?.maxElbowFlexionChangeDegrees, 2),
    armToTorsoChange: round(ind?.maxArmToTorsoChangeDegrees, 2),
    // Tremor / stability / finger indicators (§5.4)
    wristTremorAmplitude: seriesMax(ind?.wristTremorAmplitude),
    fingertipTremorAmplitude: seriesMax(ind?.fingertipTremorAmplitude),
    tremorFrequency: seriesMax(ind?.wristTremorDominantFrequency),
    stability: seriesMax(ind?.stability),
    fingerCurlChange: seriesMax(ind?.fingerCurlChange),
    fingerSpreadChange: seriesMax(ind?.fingerSpreadChange),
    // Variability (standard deviation) for the key oscillation measures (§5.5)
    wristTremorSd: seriesSd(ind?.wristTremorAmplitude),
    stabilityMean: seriesMean(ind?.stability),
    // Reliability of this arm's indicators
    confidence: round(arm.confidence, 3),
  };
}

/** Serialises a norm-comparison outcome for a given indicator key. */
function normOutcomeFor(
  comparisons: NormComparison[],
  key: IndicatorKey
): NormOutcome | '' {
  const c = comparisons.find((x) => x.indicatorKey === key);
  return c ? c.outcome : '';
}

/**
 * Posts the assessment to the configured Google Sheet. No-op when no URL is set.
 * Never throws; failures are swallowed so the UI is never affected.
 */
export function exportToSheets(a: PronatorDriftAssessment): void {
  const url = resolveWebAppUrl();
  if (!url) return; // disabled unless a URL is configured

  const comparisons = a.normComparisons ?? [];
  const p = a.participant;

  const payload = {
    // ── Participant intake (entered at the start) ──────────────────────────
    participantName: p?.name ?? '',
    participantGender: p?.gender ?? '',
    participantAge: p?.age ?? '',
    declarationAccepted: p?.declarationAccepted ?? false,
    // The date/time the test was taken (captured at intake). Fall back to the
    // assessment start time when intake was skipped.
    testDateTime: p?.testDateTime ?? a.startedAt,

    // ── Session metadata (§5.6) ────────────────────────────────────────────
    exportedAt: new Date().toISOString(),
    assessmentId: a.assessmentId,
    startedAt: a.startedAt,
    completedAt: a.completedAt,
    durationSeconds: a.durationSeconds,
    deviceType: a.deviceType,
    overallClassification: a.overallClassification,
    assessedArm: a.assessedArm ?? '',
    quality: a.quality.overall,
    validFramePercentage: round(a.quality.metrics.validFramePercentage, 1),
    avgPoseConfidence: round(a.quality.metrics.avgPoseConfidence, 3),
    avgLeftHandConfidence: round(a.quality.metrics.avgLeftHandConfidence, 3),
    avgRightHandConfidence: round(a.quality.metrics.avgRightHandConfidence, 3),
    cameraStability: round(a.quality.metrics.cameraStability, 3),
    primaryFailureReason: a.quality.primaryFailureReason ?? '',

    // ── Analysis / reliability metadata (§5.6) ─────────────────────────────
    deliveredFrameCount: a.analysisMeta?.deliveredFrameCount ?? '',
    droppedFrameCount: a.analysisMeta?.droppedFrameCount ?? '',
    effectiveFrameRate: round(a.analysisMeta?.effectiveFrameRate, 2),
    frameRateBelowMinimum: a.analysisMeta?.frameRateBelowMinimum ?? false,
    recordingStatus: a.analysisMeta?.recordingStatus ?? '',
    dominantFrequencyBandwidthLimited:
      a.indicators?.dominantFrequencyBandwidthLimited ?? false,
    usedPoseOnlyPath: a.indicators?.usedPoseOnlyPath ?? false,

    // ── Per-arm metric blocks (§5.1–5.5) ───────────────────────────────────
    left: armBlock(a.leftIndicators, a.leftArm),
    right: armBlock(a.rightIndicators, a.rightArm),

    // ── Reference-range comparison outcomes (§5.7) ─────────────────────────
    normWristDrift: normOutcomeFor(comparisons, 'wristDrift'),
    normPalmRotation: normOutcomeFor(comparisons, 'palmRotationChange'),
    normWristTremorFreq: normOutcomeFor(comparisons, 'wristTremorDominantFrequency'),
    anyIndicatorOutsideRange: comparisons.some((c) => c.outcome === 'outside'),
  };

  // text/plain avoids a CORS preflight; the Apps Script parses JSON from the body.
  void fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  }).catch(() => {
    /* non-blocking; failures never affect the UX */
  });
}
