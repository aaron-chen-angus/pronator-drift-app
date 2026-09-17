# Pronator Drift Computer-Vision Screening Application

**A browser-based, on-device computer-vision system for quantitative screening of pronator drift.**

> **Medical disclaimer.** This software is a **research prototype and screening aid**. It is **not a medical device**, does **not** provide a diagnosis, and must **not** be used as a substitute for examination by a qualified clinician. Every threshold and reference range below is a **prototype value pending clinical validation**. Outputs are described in non-diagnostic language ("possible", "observed", "detected").

---

## Live Deployment & Resources

This project is part of the **SMILE** initiative (*Smart Monitoring for
Individualised Living and Engagement*). The screening application, the aggregated
research dataset, and the analytics dashboard are all publicly accessible:

| Resource | Link | Purpose |
|---|---|---|
| **Screening web app** (GitHub Pages) | <https://aaron-chen-angus.github.io/pronator-drift-app/> | Run the camera-based pronator-drift screening in any modern browser. |
| **Source repository** | <https://github.com/aaron-chen-angus/pronator-drift-app> | Full source, build workflow, and documentation. |
| **Aggregate results dataset** (Google Sheets) | <https://docs.google.com/spreadsheets/d/1OOmyyNWHg40keKS8rl8SQt7aQxwX14MdXsYQGiEVStQ> | De-identified per-assessment records: participant intake + every computed metric (see §5, §14). |
| **Analytics & education dashboard** (R Shiny) | <https://smile-rp.shinyapps.io/SMILE-PronatorDrift/> | Interactive, educational visual analysis of the aggregate dataset (see §17). |

> **Data-governance note.** The Google Sheet and Shiny dashboard receive result
> values and participant intake fields **only** for sessions where the on-screen
> declaration/consent was accepted (see §7, §14). No video or raw landmark data
> is ever transmitted or stored. Operators are responsible for complying with
> their institution's ethics, consent, and data-protection requirements.

---

## Table of Contents

1. [Abstract](#1-abstract)
2. [Scientific Background](#2-scientific-background)
3. [What the Test Measures — The Three Signs](#3-what-the-test-measures--the-three-signs)
4. [Measurement Model: From Landmarks to Indicators](#4-measurement-model-from-landmarks-to-indicators)
5. [Complete Data Dictionary](#5-complete-data-dictionary)
6. [Classification Logic](#6-classification-logic)
7. [Assessment Protocol (How the Test Is Conducted)](#7-assessment-protocol-how-the-test-is-conducted)
8. [Quality Control & Signal Processing](#8-quality-control--signal-processing)
9. [Technical Architecture & Tech Stack](#9-technical-architecture--tech-stack)
10. [Configuration Reference](#10-configuration-reference)
11. [Privacy & Data Handling](#11-privacy--data-handling)
12. [Running the Application](#12-running-the-application)
13. [Deploying to GitHub Pages](#13-deploying-to-github-pages)
14. [Integrating Live Results with Google Sheets](#14-integrating-live-results-with-google-sheets)
15. [Limitations & Validation Status](#15-limitations--validation-status)
16. [References](#16-references)
17. [Aggregate Data Analytics — R Shiny Dashboard](#17-aggregate-data-analytics--r-shiny-dashboard)
18. [Research Use, Reproducibility & Data Management](#18-research-use-reproducibility--data-management)
19. [Ethics, Consent & Regulatory Positioning](#19-ethics-consent--regulatory-positioning)
20. [How to Cite / Authorship & Acknowledgements](#20-how-to-cite--authorship--acknowledgements)

---

## 1. Abstract

The **pronator drift test** (also known as Barré's test) is a bedside neurological
examination used to detect subtle upper-limb weakness of central origin. This
application reproduces the test using a standard webcam and on-device computer
vision, replacing subjective visual judgement with **quantitative, reproducible
kinematic measurements**. The subject faces the camera with both arms extended
forward, palms up, and eyes closed for 30 seconds. Using Google MediaPipe pose
and hand landmark models running entirely in the browser, the system tracks both
arms and derives measures of **downward drift**, **forearm pronation**, and
**finger movement**, along with joint-angle, tremor, and stability indicators.
All computation is performed locally; no video or landmark data leaves the
device. The system is a screening aid intended to support, not replace, clinical
examination.

---

## 2. Scientific Background

### 2.1 Clinical basis

Pronator drift is a sign of **upper motor neuron (UMN) dysfunction**. When a
patient holds both arms outstretched and supinated (palms up) with eyes closed,
a limb affected by a corticospinal (pyramidal) tract lesion tends to **drift
downward and pronate** (the palm rotates toward the floor), because the pyramidal
pathway lesion preferentially weakens the supinator muscles relative to the
stronger pronators [[3]](#ref3)[[8]](#ref8). The eyes are closed to remove visual
feedback that would otherwise let the subject consciously correct the drift.

The test is valued for being fast, requiring no equipment, and being relatively
specific for a corticospinal lesion. In a comparative study of motor-function
tests for detecting subtle unilateral cerebral lesions, pronator drift (combined
with finger tapping and reflexes) was reported to be among the most reliable and
time-effective screening manoeuvres [[2]](#ref2). Prior work has also
demonstrated that instrumenting the test with handheld and mobile sensors yields
objective, repeatable measures of drift [[4]](#ref4)[[10]](#ref10). This project
extends that line of work to **markerless, camera-only** measurement.

> Content in this section was paraphrased and summarised for compliance with
> source licensing.

### 2.2 What a positive sign suggests

A pathological response is for one arm to **drift (down, up, or out)** and/or for
the hand to **pronate** [[8]](#ref8). Classically:

- **Downward drift with pronation** → suggestive of a contralateral corticospinal
  (UMN) lesion.
- **Upward or lateral drift** → more suggestive of a proprioceptive (sensory)
  deficit than of weakness [[5]](#ref5).
- **Drift without pronation** → non-specific; warrants correlation with other
  findings.

Because the same sign can arise from proprioceptive or cerebellar disturbance,
the sign is **screening-level**, not diagnostic. This application mirrors that
epistemic caution in its output language and its explicit "prototype, pending
validation" labelling.

---

## 3. What the Test Measures — The Three Signs

The clinician looks for three things. This application measures each with
specific computer-vision-derived indicators.

### 3.1 Downward drift of one arm relative to the other

**Clinical meaning.** A weak arm cannot be held level and sinks over the holding
period. The *asymmetry* between arms is the key signal.

**How it is measured.** The vertical (image-Y) position of each **wrist landmark**
is tracked frame by frame relative to its own calibrated baseline, normalised by
arm length so the measure is scale-invariant. See
[`Wrist_Drift`](#51-primary-drift-indicators).

### 3.2 Pronation of the forearm (palm rotates toward the floor)

**Clinical meaning.** The palm rotates from supinated (up) toward pronated (down),
reflecting the relative weakness of supinators in a pyramidal lesion.

**How it is measured.** A **palm-orientation angle** is computed from the hand
landmarks (wrist, index-MCP, middle-MCP) via a surface-normal cross-product, then
compared to the calibrated baseline orientation. See
[`Palm_Rotation_Change`](#52-rotational-pronation-indicators).

### 3.3 Slight flexion of the fingers

**Clinical meaning.** Subtle finger flexion/curl or loss of the extended-finger
posture can accompany distal weakness.

**How it is measured.** Two scale-invariant hand-geometry metrics — **finger
curl** (fingertip reach relative to the knuckle) and **finger spread** (fan of
the knuckles) — are tracked over time. See
[`Finger_Curl_Change` and `Finger_Spread_Change`](#54-finger-level-indicators).

---

## 4. Measurement Model: From Landmarks to Indicators

### 4.1 Landmark sources

Two Google MediaPipe Tasks-Vision models run in the browser:

- **Pose Landmarker (Lite, float16)** — 33 body landmarks per person. The
  application uses the shoulder/elbow/wrist/hip landmarks for each arm.
- **Hand Landmarker (float16)** — 21 landmarks per detected hand, associated to a
  `Left`/`Right` handedness label used to match each hand to the correct arm.

**Pose landmark indices used (MediaPipe convention, anatomical):**

| Landmark | Left index | Right index |
|---|---|---|
| Shoulder | 11 | 12 |
| Elbow | 13 | 14 |
| Wrist | 15 | 16 |
| Hip | 23 | 24 |

> MediaPipe labels pose landmarks **anatomically** — index 11 is the subject's own
> left shoulder — regardless of whether the on-screen preview is mirrored. The
> app therefore reports the subject's true left/right side.

**Hand landmark indices used:** wrist `0`; MCP knuckles `5, 9, 13, 17`
(index/middle/ring/pinky); fingertips `4, 8, 12, 16, 20`.

### 4.2 Coordinate conventions

- Positions are **normalised image coordinates** in `[0, 1]`; `x` increases
  rightward, `y` increases **downward**. Therefore an increase in wrist `y`
  corresponds to the wrist moving **down** (drift).
- **Arm length** is `distance(shoulder, wrist)` in normalised units and is used to
  normalise drift so that results do not depend on the subject's distance from the
  camera.
- **Visibility/confidence** is MediaPipe's per-landmark score in `[0, 1]`.

### 4.3 Baseline (calibration)

Before the timed hold, a **2.5-second calibration** window captures the starting
posture. For each arm the app averages, over valid frames, the shoulder/elbow/
wrist positions, elbow angle, palm-orientation angle, and arm length to form a
per-arm **baseline**. Calibration is rejected if more than half the frames are
low-confidence or if the wrist position varies by more than
`maxBaselineVariation × armLength`. If strict calibration fails, a best-effort
baseline is derived from the last valid frame so the workflow never dead-ends
(the reduced reliability is surfaced to the user).

### 4.4 Drift computation (per arm, per frame)

```
rawWristDrift      = currentWristY − baselineWristY
torsoCompensation  = max(0, currentShoulderMidY − baselineShoulderMidY)
normalizedDrift    = max(0, rawWristDrift − torsoCompensation) / baselineArmLength
```

- `torsoCompensation` subtracts whole-body sinking (leaning/slumping) so it is not
  mistaken for arm drift.
- A **camera-movement** estimate (shoulder-midpoint displacement) invalidates
  frames where the camera itself moved beyond `cameraMovementThreshold`.
- The per-frame drift series is **median-smoothed** over a
  `smoothingWindowDuration` (0.5 s) window. **Maximum drift** and **drift onset**
  (first time smoothed drift exceeds `minDriftThreshold`) are tracked per arm.
- **Sustained drift** requires a continuous above-threshold run of at least
  `minDriftDuration` (2.0 s).

### 4.5 Pronation computation (per arm, per frame)

The palm-orientation angle is the angle between the hand's surface normal and the
camera axis. The normal is the cross-product of two in-plane vectors
(wrist→index-MCP and wrist→middle-MCP):

```
n = (indexMCP − wrist) × (middleMCP − wrist)
palmAngle = acos( −n_z / |n| )   → degrees
palmRotationChange = palmAngle − baselinePalmAngle
```

`Total_Palm_Rotation_Change` is the sign-preserving extremum of the per-frame
series. Because a single frame where the hand is edge-on to the camera can spike,
the **possible-pronation flag** is applied with a **noise-robust rule**: the
rotation must be *sustained* — met in at least ~40 % of the confident hand frames
(and at least five frames) — before pronation is flagged.

### 4.6 Joint-angle, tremor, stability, and finger metrics

- **Elbow flexion angle** — the shoulder–elbow–wrist interior angle; the app
  reports its change from baseline.
- **Arm-to-torso angle** — the angle between the upper arm and the torso midline
  at the shoulder; reported as change from the first valid frame.
- **Tremor amplitude** — the standard deviation of the **high-pass (detrended)**
  wrist and fingertip position residuals (a moving-average is subtracted to leave
  high-frequency motion).
- **Dominant tremor frequency** — the peak of a discrete periodogram (naive DFT)
  of the wrist residual, capped at the Nyquist frequency (½ × effective frame
  rate); flagged `bandwidthLimited` when sampling is inadequate.
- **Stability** — a bounded score `1 / (1 + amplitude)` in `(0, 1]`; higher means
  steadier.
- **Finger curl** — `1 − mean(tipReach / knuckleReach)` per finger, where reach is
  the wrist→tip and wrist→MCP distance; higher means more curled.
- **Finger spread** — mean adjacent-MCP distance normalised by palm length; higher
  means more splayed.

All summarised statistics (mean/max/standard deviation) are computed over
**confident frames only**; low-confidence intervals beyond an
`occlusionGracePeriod` are excluded.

---

## 5. Complete Data Dictionary

Every value the application computes is defined below. Values are reported **per
arm** (left and right shown separately). Units follow each definition.

### 5.0 Per-frame primitives (internal)

| Field | Type | Unit | Meaning |
|---|---|---|---|
| `timestamp` | number | ms | Frame time (raw, from `performance.now`). |
| `relativeTimestamp` | number | ms | Time since assessment start. |
| `leftConfidence` / `rightConfidence` | number | 0–1 | Mean visibility of that arm's shoulder/elbow/wrist. |
| `frameValid` | boolean | — | True when not camera-affected and not in an excluded low-confidence interval. |
| `torsoCompensation` | number | normalized | Whole-body vertical sink subtracted from drift. |
| `cameraMovement` | number | normalized | Estimated shoulder-midpoint displacement vs baseline. |

### 5.1 Primary drift indicators

| Indicator | Field(s) | Unit | Definition / meaning |
|---|---|---|---|
| **Wrist drift** | `Wrist_Drift` series; `maximumDownwardDriftNormalised` | normalized (÷ arm length) | Downward wrist displacement from baseline. The core drift measure. Higher = more drift. Displayed as a percentage of arm length. |
| **Drift onset** | `driftOnsetSeconds` | seconds | Time at which smoothed drift first exceeded `minDriftThreshold`; `null` if never. |
| **Drift duration** | `driftDurationMilliseconds` | ms | Total duration of sustained above-threshold drift. |
| **Sustained drift** | `sustainedDownwardDrift` | boolean | True when a continuous run of drift ≥ `minDriftThreshold` lasted ≥ `minDriftDuration`. |
| **Elbow drift** | `Elbow_Drift` series | normalized | Downward elbow displacement from baseline (corroborates whole-arm drift). |

### 5.2 Rotational (pronation) indicators

| Indicator | Field(s) | Unit | Definition / meaning |
|---|---|---|---|
| **Palm rotation change** | `Palm_Rotation_Change` series; `estimatedPalmRotationChangeDegrees`; `totalPalmRotationChangeDegrees` | degrees | Change in palm-orientation angle from baseline. Positive = rotating toward pronation (palm-down). The sign-preserving extremum is the reported total. |
| **Possible pronation** | `possiblePronation` | boolean | True when the palm rotation is *sustained* past `minPronationChange` (noise-robust rule, §4.5). |
| **Supination→pronation trend** | `supinationToPronationTrend` | boolean | True when the per-frame rotation increases monotonically toward pronation across the window. |

### 5.3 Joint-angle indicators (pose-only)

| Indicator | Field | Unit | Definition / meaning |
|---|---|---|---|
| **Elbow flexion change** | `Elbow_Flexion_Change`; `maxElbowFlexionChangeDegrees` | degrees | Change in shoulder–elbow–wrist angle from baseline; a straight arm ≈ 180°. Large negative change = elbow bending (arm collapsing). |
| **Arm-to-torso change** | `Arm_To_Torso_Change`; `maxArmToTorsoChangeDegrees` | degrees | Change in the upper-arm-vs-torso-midline angle; captures arm lowering/abduction relative to the body. |

### 5.4 Tremor, stability, and finger-level indicators

| Indicator | Field | Unit | Definition / meaning |
|---|---|---|---|
| **Wrist oscillation amplitude** | `Wrist_Tremor_Amplitude` | normalized | SD of high-pass-filtered wrist position; higher = more tremor/instability. |
| **Fingertip oscillation amplitude** | `Fingertip_Tremor_Amplitude` | normalized | Same, for the fingertips (requires hand tracking). |
| **Wrist oscillation dominant frequency** | `Wrist_Tremor_Dominant_Frequency`; `dominantFrequencyBandwidthLimited` | Hz | Peak frequency of wrist oscillation, capped at Nyquist. The 8–12 Hz band is a prototype physiological-tremor reference. |
| **Stability** | `Stability` | ratio 0–1 | `1 / (1 + amplitude)`; higher = steadier hold. |
| **Finger curl change** | `Finger_Curl_Change` | normalized | Increase in finger curl from baseline (fingers flexing). |
| **Finger spread change** | `Finger_Spread_Change` | normalized | Change in knuckle fan; captures fingers coming together/apart. |

### 5.5 Per-indicator summary statistics

Each time-series indicator carries a `Summary_Statistic`:

| Field | Meaning |
|---|---|
| `mean` | Arithmetic mean over valid frames (`null` if none). |
| `max` | Maximum over valid frames (the value shown as the headline figure). |
| `standardDeviation` | Population SD; `null` when fewer than two valid frames. |
| `validFrameCount` | Number of confident frames contributing to the statistic. |
| `measurable` | `false` when the indicator could not be computed (e.g. no hand frames). |
| `poseOnly` | `true` when computed without hand landmarks. |

### 5.6 Quality & session metadata

| Field | Unit | Meaning |
|---|---|---|
| `quality.overall` | — | `good` / `acceptable` / `low` / `unable_to_assess`. |
| `quality.metrics.validFramePercentage` | % | Percentage of frames usable for the assessed arm. |
| `quality.metrics.avgPoseConfidence` | 0–1 | Mean pose confidence across the session. |
| `quality.primaryFailureReason` | text | Human-readable reason when quality is degraded. |
| `analysisMeta.deliveredFrameCount` | count | Frames processed by the analysis pipeline. |
| `analysisMeta.droppedFrameCount` | count | Frames skipped under backpressure. |
| `analysisMeta.effectiveFrameRate` | fps | Valid frames ÷ duration. |
| `analysisMeta.frameRateBelowMinimum` | boolean | True when below `minAnalysisFrameRate`. |
| `analysisMeta.recordingStatus` | — | `recorded` / `skipped` / `incomplete`. |
| `assessedArm` | `left`/`right` | The arm chosen as clinically most affected (largest drift). |
| `durationSeconds` | s | Actual hold duration. |

### 5.7 Reference-range comparison (`NormComparison`)

For indicators with a prototype reference range, each value is compared and
labelled `within` / `outside` / `no_reference` / `not_measured`. Seeded ranges:

| Indicator | Range | Unit | Citation label |
|---|---|---|---|
| `wristDrift` | 0 – 0.03 | normalized | Prototype seed — pending clinical validation |
| `palmRotationChange` | 0 – 15 | degrees | Prototype seed — pending clinical validation |
| `wristTremorDominantFrequency` | 8 – 12 | Hz | Physiological tremor band (prototype) |

All other indicators report **"no established reference range."**

---

## 6. Classification Logic

The classifier produces **exactly one** of seven outcomes using a strict
precedence order over the per-arm flags plus quality:

| Priority | Outcome | Condition |
|---|---|---|
| 1 | `unable_to_assess` | Quality is `low` or `unable_to_assess` (overrides all). |
| 2 | `possible_left_pronator_drift` | Left arm has **sustained drift AND** pronation. |
| 3 | `possible_right_pronator_drift` | Right arm has **sustained drift AND** pronation. |
| 4 | `possible_bilateral_drift` | Both arms have sustained drift. |
| 5 | `drift_without_clear_pronation` | One/both arms drift, no pronation. |
| 6 | `possible_pronation_without_drift` | Pronation without significant drift. |
| 7 | `no_significant_drift` | Neither drift nor pronation meets threshold. |

A **consult recommendation** is shown when any indicator falls outside its
prototype reference range. All wording is non-diagnostic.

---

## 7. Assessment Protocol (How the Test Is Conducted)

The workflow mirrors the clinical manoeuvre and is fully guided on-screen.

1. **Welcome & safety confirmation** — the subject acknowledges they can safely
   stand/sit and hold their arms out.
2. **Camera setup (front-facing)** — the front camera is requested. The subject
   faces the camera so the head and both arms are in view. On-screen guidance:
   *"Face the camera with both arms raised — hold both arms out in front at
   shoulder height, palms up."* The app confirms when **both** arms are detected
   at shoulder height.
3. **Instructions** — a spoken + visual demonstration: arms extended forward,
   palms up, elbows straight, fingers together, looking straight ahead.
4. **Calibration (~2.5 s)** — the starting posture is captured as the per-arm
   baseline while the subject holds still.
5. **Timed hold (30 s)** — the subject is told to **close their eyes** and hold
   position. During the hold the screen shows a **live camera preview with pose
   markers** and an in-frame indicator so an operator can confirm the subject
   stays visible, alongside the countdown. Real per-frame analysis runs the whole
   time.
6. **Completion → results** — indicators are finalised and the results screen is
   shown with per-arm timelines, indicator tables, and reference comparisons.

The eyes-closed instruction reproduces the clinical requirement to remove visual
feedback so that a genuine motor drift is not consciously corrected.

---

## 8. Quality Control & Signal Processing

- **Confidence gating.** Frames below `minPoseConfidence` for the assessed arm are
  excluded after an `occlusionGracePeriod`, so brief occlusions do not abort the
  test but sustained loss of tracking does.
- **Camera-movement rejection.** Frames where the whole body shifts (camera bump)
  beyond `cameraMovementThreshold` are invalidated in the smoothing window.
- **Torso compensation.** Whole-body sinking is subtracted before drift is
  attributed to the arm.
- **Temporal smoothing.** A median filter over `smoothingWindowDuration` removes
  single-frame spikes from the drift series.
- **Arm selection.** The **assessed arm** is chosen *after* the run as the arm with
  the larger measured drift (the clinically significant side), not by which arm is
  more visible. Both arms are always analysed and reported.
- **Backpressure.** The frame pump is single-in-flight: if a frame is still being
  processed, the next tick is dropped and counted, bounding latency and yielding a
  stable `effectiveFrameRate`.
- **Reliability flag.** If the effective frame rate falls below
  `minAnalysisFrameRate`, or the valid-frame percentage falls below
  `minValidFramePercentage`, the result is marked reduced-reliability or
  `unable_to_assess`.

---

## 9. Technical Architecture & Tech Stack

### 9.1 Stack

| Layer | Technology |
|---|---|
| UI | React 19 + TypeScript, Vite 6 build |
| Computer vision | Google MediaPipe Tasks-Vision (`@mediapipe/tasks-vision`): Pose Landmarker Lite + Hand Landmarker, WebAssembly |
| Execution | Web Worker for CV (with main-thread WASM fallback) |
| State | Typed finite-state machine (screen transitions) |
| Audio | Web Speech API for spoken instructions/countdown |
| Testing | Vitest + fast-check (property-based tests), Playwright (e2e) |
| Packaging | Static SPA (relative asset paths) — deployable to any static host |

### 9.2 Module map (`src/`)

```
analysis/
  DriftAnalyzer.ts            calibration + per-arm drift time series
  MicroMovementAnalyzer.ts    joint-angle, pronation, tremor, finger indicators
  AssessmentLoop.ts           per-frame pump + finalize → AssessmentAnalysisResult
  QualityAssessor.ts          valid-frame %, confidence, quality rating
  Classifier.ts               7-way classification precedence
  NormComparator.ts           reference-range comparison
  buildAssessmentFromAnalysis.ts  assembles the final PronatorDriftAssessment
  RecordingManager.ts         optional on-device recording (consented)
cv/
  CVWorkerManager.ts          worker lifecycle + model init + processFrame
config/ConfigStore.ts         all thresholds + prototype reference ranges
session/
  AssessmentSession.ts        shared camera + CV + pipeline across screens
  AssessmentSessionContext.tsx  React context provider/hook
screens/                      Welcome → CameraSetup → Instruction → Calibration →
                              Assessment → Completion → Results
components/CameraOverlay.tsx  canvas pose/hand skeleton overlay
types/index.ts                shared domain types (data model)
```

### 9.3 Data flow

```
Camera stream ─▶ CVWorkerManager.processFrame ─▶ CVFrameResult (pose + hand landmarks)
    │                                                   │
    │                              ┌────────────────────┴───────────────────┐
    │                              ▼                                        ▼
    │                   DriftAnalyzer (both arms)          MicroMovementAnalyzer ×2 (L, R)
    │                              │                                        │
    └────── AssessmentLoop (30 s pump, backpressure) ──────────────────────┘
                                   │
                                   ▼
                         AssessmentAnalysisResult
                                   │
                        buildAssessmentFromAnalysis + per-arm attach
                                   │
                                   ▼
                         PronatorDriftAssessment ─▶ ResultsScreen
```

The **AssessmentSession** owns one `MediaStream` and one CV worker for the whole
workflow, so calibration and the timed hold operate on the *same* live pipeline —
this is what makes the analysis run end-to-end rather than producing placeholders.

### 9.4 Why on-device

All inference and analysis run in the browser via WebAssembly. No frames or
landmarks are transmitted. MediaPipe model files are the only network fetch (from
Google's public model host on first run); they can be self-hosted for fully
offline operation by overriding the model paths in `AssessmentSession.ts` /
`CameraSetupScreen.tsx`.

---

## 10. Configuration Reference

All thresholds live in `src/config/ConfigStore.ts` and are **prototype values
pending clinical validation**. They can be overridden at runtime via
`initConfigStore({ ... })`.

| Key | Default | Range | Unit | Purpose |
|---|---|---|---|---|
| `minPoseConfidence` | 0.5 | 0–1 | ratio | Min pose-landmark confidence to accept a frame. |
| `minHandConfidence` | 0.5 | 0–1 | ratio | Min hand-landmark confidence. |
| `requiredHoldDuration` | 2.0 | 0.5–3.0 | s | Hold to confirm position. |
| `maxTorsoAngleTolerance` | 15 | 1–45 | ° | Max torso deviation from forward. |
| `maxElbowFlexionTolerance` | 15 | 1–45 | ° | Max elbow bend from straight. |
| `maxWristHeightTolerance` | 0.10 | 0.01–0.5 | ratio | Max wrist offset from shoulder height. |
| `minArmBodyAngle` | 20 | 5–90 | ° | Min arm-to-torso angle. |
| `maxPalmOrientationTolerance` | 45 | 5–90 | ° | Max palm deviation from vertical at setup. |
| `positionValidationTimeout` | 60 | 10–300 | s | Timeout before offering replay/exit. |
| `calibrationDuration` | 2.5 | 1.0–5.0 | s | Baseline capture window. |
| `maxCalibrationExtension` | 2.0 | 0.5–5.0 | s | Extra time if unstable. |
| `maxBaselineVariation` | 0.05 | 0.01–0.2 | ratio | Max wrist variation during calibration. |
| `assessmentDuration` | 30 | 10–120 | s | Timed hold length. |
| `minAnalysisFrameRate` | 10 | 5–60 | fps | Below this → reduced-reliability flag. |
| `minDriftThreshold` | 0.03 | 0.005–0.2 | normalized | Drift considered significant. |
| `minDriftDuration` | 2.0 | 0.5–10.0 | s | Drift must persist this long to be "sustained". |
| `minPronationChange` | 15 | 5–90 | ° | Palm rotation to flag pronation. |
| `smoothingWindowDuration` | 0.5 | 0.1–2.0 | s | Median-filter window. |
| `minDisturbanceDuration` | 0.3 | 0.1–2.0 | s | Ignore shorter disturbances as noise. |
| `driftPersistenceDuration` | 1.5 | 0.5–5.0 | s | Persistence before classification. |
| `cameraMovementThreshold` | 0.02 | 0.005–0.1 | normalized | Camera-movement frame exclusion. |
| `torsoLeanThreshold` | 5 | 1–30 | ° | Torso-lean compensation threshold. |
| `minValidFramePercentage` | 70 | 30–100 | % | Below this → `unable_to_assess`. |
| `occlusionGracePeriod` | 2.0 | 0.5–10.0 | s | Grace before excluding low-confidence intervals. |
| `minBrightnessThreshold` | 60 | 10–200 | luminance | Low-light warning. |
| `minPositioningFrameRate` | 5 | 1–30 | fps | Min frame rate for setup checks. |

---

## 11. Privacy & Data Handling

| Data | Where it lives | Transmitted? |
|---|---|---|
| Camera video frames | Device RAM only, during analysis | **No** |
| Pose/hand landmarks | Device RAM only | **No** |
| Optional recording | Device only, if the user opts in | **No** (never uploaded) |
| Computed indicators/results | In-memory; shown on screen | **No** (unless *you* add the optional Sheets export in §14) |
| MediaPipe model files | Downloaded from Google's public host on first run | Inbound only |

- Recording is **off by default** and requires an explicit consent checkbox.
- A **Delete Assessment Data** control clears stored data; deleting a recording
  releases its resources immediately.
- The camera requires a **secure context** (`https://` or `localhost`); it will
  not work from a `file://` path.
- If you enable the optional Google Sheets export (§14), aggregate **result
  values** (not video) are sent to *your* endpoint. Inform participants and obtain
  consent before enabling it.

---

## 12. Running the Application

There are three ways to run this app, from easiest to most technical:

| I want to... | Use | Needs |
|---|---|---|
| Just open it online, nothing to install | **GitHub Pages URL** (§13) | A browser + webcam |
| Run it offline on a Windows PC without dev tools | **Standalone launcher** (§12.6) | Node.js installed |
| Develop / modify the source | **Dev / build workflow** (§12.2–12.3) | Node.js + npm |

### 12.1 Prerequisites

- Node.js 20+ and npm (a portable Node 20 is bundled under `.node/` on Windows).
- A device with a webcam and a modern browser (Chrome/Edge/Safari).

### 12.2 Development

```bash
npm install
npm run dev        # Vite dev server at http://localhost:5173
```

### 12.3 Production build

```bash
npm run build      # outputs static assets to dist/
npm run preview    # serve the production build locally
```

### 12.4 Standalone launcher (Windows)

A self-contained launcher is provided under `standalone/`:

- `standalone/RunPronatorDrift.bat` starts a local static server
  (`standalone/server.cjs`) that serves `standalone/app/` at
  `http://localhost:8080` (a secure context, so the camera works).
- To refresh the standalone copy after a rebuild:

```powershell
npm run build
Remove-Item -Recurse -Force .\standalone\app\*
Copy-Item -Recurse -Force .\dist\* .\standalone\app\
```

### 12.5 Testing

```bash
npm run test       # unit + property-based tests (Vitest + fast-check)
npm run test:e2e   # Playwright end-to-end
```

### 12.6 Standalone app for non-technical users (step-by-step, Windows)

This runs the full app **offline** on a Windows PC with no coding and no build
step. You only need Node.js installed once (it provides the tiny local server
the app uses).

> **Why a local server and not a double-click?** Browsers only allow the camera
> on a "secure" address (`https://` or `http://localhost`). Opening the file
> directly (a `file://…` path) will silently block the camera. The included
> launcher serves the app at `http://localhost:8080`, which the browser trusts.

**Step 1 — Install Node.js (one time).**
1. Go to [https://nodejs.org](https://nodejs.org) and download the **LTS**
   installer for Windows.
2. Run the installer and click through with the default options.
3. This only has to be done once per computer.

**Step 2 — Download the app files.**
- On the GitHub repository page, click the green **Code** button →
  **Download ZIP**, then unzip it. (Or, if someone sent you just the
  `standalone` folder, use that.)
- You need the **`standalone`** folder, which contains three things:
  - `RunPronatorDrift.bat` — the launcher you double-click
  - `server.cjs` — the tiny local server
  - `app` — the actual application

**Step 3 — Start the app.**
1. Open the `standalone` folder.
2. Double-click **`RunPronatorDrift.bat`**.
3. A small black command window opens and shows
   `Pronator Drift App running at http://localhost:8080`.
   **Leave this window open** — closing it stops the app.
   - If Windows SmartScreen shows a warning, click **More info → Run anyway**
     (this happens because the file is not code-signed).

**Step 4 — Open it in your browser.**
1. Open Chrome or Edge.
2. Go to **`http://localhost:8080`**.
3. When the browser asks, click **Allow** to give the page camera access.
4. Follow the on-screen steps (welcome → camera setup → instructions →
   calibration → 30-second hold → results).

**Step 5 — Stop the app when finished.**
- Close the browser tab, then close the small black command window.

**Troubleshooting.**
- *"'node' is not recognized"* in the black window → Node.js isn't installed;
  redo Step 1, then restart the PC.
- *Camera does not turn on* → make sure the address bar shows
  `http://localhost:8080` (not a `file://…` path), and that you clicked
  **Allow**. Check no other app (Zoom/Teams) is using the camera.
- *Nothing happens on double-click* → right-click `RunPronatorDrift.bat` →
  **Run as administrator**.
- *First run needs internet* → the pose/hand models download once from Google's
  public host on first use; after that it works offline.

---

## 13. Deploying to GitHub Pages

The repository already includes a GitHub Actions workflow at
`.github/workflows/deploy.yml` that builds and publishes `dist/` to GitHub Pages.
Visitors need **no** npm or build tools — they just open the page.

**One-time setup:**

1. Push the project to a GitHub repository (default branch `main`).
2. In the repo, go to **Settings → Pages → Build and deployment → Source** and
   select **GitHub Actions**.
3. Push to `main` (or run the workflow manually via **Actions →
   Deploy to GitHub Pages → Run workflow**).

**What the workflow does:**

- Checks out the repo, sets up Node 20, runs `npm ci` and `npm run build`.
- Uploads `dist/` as a Pages artifact and deploys it.

**Why it "just works" on any path:** `vite.config.ts` sets `base: './'`, so assets
load correctly whether the site is served from a user/org root or a
`https://<user>.github.io/<repo>/` project path. The deployed URL appears in the
Actions run summary and under **Settings → Pages**.

> GitHub Pages is served over HTTPS (a secure context), so the camera and
> MediaPipe models load correctly.

---

## 14. Integrating Live Results with Google Sheets

This optional integration posts each completed assessment's **participant intake
details** (name, gender, age, declaration, and the captured test date/time) plus
**every metric in the data dictionary (§5)** — never video — to a Google Sheet
via a Google Apps Script Web App. It uses a "fire-and-forget" `POST` that avoids
a CORS preflight, so it works from a static site (GitHub Pages or the standalone
launcher).

The app already ships with the client-side helper (`src/integrations/sheetsExport.ts`)
wired into the results flow. It is a **no-op until you configure a Web App URL**,
so nothing is transmitted by default. You only need to (1) create the sheet +
Apps Script, and (2) give the app the resulting URL (§14.4 / §6-equivalent below).

> **Consent first.** Enabling this transmits participant details and result
> values off-device. The intake declaration on the participant screen covers
> this consent; do not enable the export for participants who have not accepted
> it, and follow your institution's data-handling / ethics requirements.

### 14.1 Create the Google Sheet and Apps Script Web App (step by step)

1. **Create the sheet.** Go to <https://sheets.google.com> and create a new blank
   spreadsheet. Give it a name such as *Pronator Drift Results*.
2. **Copy the Sheet ID.** It is the long token in the URL between `/d/` and
   `/edit`:
   `https://docs.google.com/spreadsheets/d/`**`<THIS-IS-THE-ID>`**`/edit`.
3. **Open the script editor.** In the sheet menu, choose
   **Extensions → Apps Script**. A new editor tab opens.
4. **Paste the script.** Delete any placeholder `function myFunction() {}` and
   paste the entire script from §14.2 below.
5. **Set your Sheet ID.** Replace `PASTE_YOUR_SHEET_ID_HERE` with the ID from
   step 2.
6. **Save** (the floppy-disk icon, or `Ctrl`/`Cmd` + `S`).
7. **Create the header row once (recommended).** In the Apps Script toolbar,
   select the function `setupHeaders` from the dropdown and click **Run**. The
   first time you run anything you will be asked to **Review permissions →
   choose your Google account → Advanced → Go to <project> (unsafe) → Allow**.
   (The "unsafe" wording is Google's standard message for personal scripts; it
   simply means the script is not published/verified. It only edits *your* sheet.)
   After it runs, row 1 of the **Results** tab will contain the full header.
8. **Deploy as a Web App.** Click **Deploy → New deployment**. Click the gear
   next to *Select type* and choose **Web app**. Set:
   - **Description:** anything, e.g. `v1`.
   - **Execute as:** **Me**.
   - **Who has access:** **Anyone** (this allows anonymous `POST`s from the app;
     no one can read your sheet through it — the endpoint only appends rows).
9. Click **Deploy**, authorise if prompted, and **copy the Web App URL**. It
   looks like `https://script.google.com/macros/s/AKfyc.../exec`.
10. **Test it.** Open that URL in a browser. You should see
    `{"status":"Pronator Drift API running"}`. That confirms the deployment is
    live. You will paste this URL into the app in §14.4.

> **Updating the script later.** If you change the script, you must
> **Deploy → Manage deployments → (edit) → New version → Deploy** for the change
> to take effect. Creating a brand-new deployment instead gives you a *new* URL.

### 14.2 Apps Script (full — participant details + every metric)

This writes one row per assessment. The header row and the row builder are kept
in lock-step with the client payload in `src/integrations/sheetsExport.ts`. If
you add a field in one place, add it in the other (append to the **end** so
existing columns keep their position).

```javascript
/**
 * Pronator Drift — Google Apps Script (results sink).
 * Writes participant intake details + every data-dictionary metric.
 * Deploy as Web App: Execute as "Me", Access "Anyone".
 */
const SPREADSHEET_ID = "PASTE_YOUR_SHEET_ID_HERE";
const SHEET_NAME = "Results";

function doPost(e) {
  try {
    var data = (e && e.postData && e.postData.contents)
      ? JSON.parse(e.postData.contents)
      : (e && e.parameter && e.parameter.data ? JSON.parse(e.parameter.data) : {});
    var sheet = getOrCreateSheet_();
    ensureHeaders_(sheet);
    sheet.appendRow(buildRow_(data));
    return json_({ success: true });
  } catch (err) {
    return json_({ success: false, error: String(err) });
  }
}

function doGet() { return json_({ status: "Pronator Drift API running" }); }

/** Run this once from the editor to write/refresh the bold header row. */
function setupHeaders() {
  var sheet = getOrCreateSheet_();
  var h = HEADERS_();
  sheet.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight("bold");
  sheet.setFrozenRows(1);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

/**
 * The complete header row. Order MUST match buildRow_() below and the payload
 * emitted by src/integrations/sheetsExport.ts.
 */
function HEADERS_() {
  return [
    // ── Participant intake ──────────────────────────────────────────────
    "Participant Name", "Gender", "Age", "Declaration Accepted", "Test Date/Time",
    // ── Session metadata ────────────────────────────────────────────────
    "Exported At", "Assessment ID", "Started At", "Completed At", "Duration (s)",
    "Device", "Overall Classification", "Assessed Arm",
    // ── Quality metrics ─────────────────────────────────────────────────
    "Quality", "Valid Frame %", "Avg Pose Confidence",
    "Avg Left Hand Confidence", "Avg Right Hand Confidence", "Camera Stability",
    "Primary Failure Reason",
    // ── Analysis / reliability metadata ─────────────────────────────────
    "Delivered Frames", "Dropped Frames", "Effective FPS", "Frame Rate Below Min",
    "Recording Status", "Tremor Freq Bandwidth Limited", "Used Pose-Only Path",
    // ── LEFT arm metrics ────────────────────────────────────────────────
    "Left Max Drift (norm)", "Left Drift Onset (s)", "Left Drift Duration (ms)",
    "Left Sustained Drift", "Left Elbow Drift (norm)", "Left Baseline Wrist Height",
    "Left Pronation (deg)", "Left Possible Pronation", "Left Supination→Pronation Trend",
    "Left Elbow Flexion Change (deg)", "Left Arm-to-Torso Change (deg)",
    "Left Wrist Tremor Amp", "Left Fingertip Tremor Amp", "Left Tremor Freq (Hz)",
    "Left Stability", "Left Finger Curl Change", "Left Finger Spread Change",
    "Left Wrist Tremor SD", "Left Stability Mean", "Left Confidence",
    // ── RIGHT arm metrics ───────────────────────────────────────────────
    "Right Max Drift (norm)", "Right Drift Onset (s)", "Right Drift Duration (ms)",
    "Right Sustained Drift", "Right Elbow Drift (norm)", "Right Baseline Wrist Height",
    "Right Pronation (deg)", "Right Possible Pronation", "Right Supination→Pronation Trend",
    "Right Elbow Flexion Change (deg)", "Right Arm-to-Torso Change (deg)",
    "Right Wrist Tremor Amp", "Right Fingertip Tremor Amp", "Right Tremor Freq (Hz)",
    "Right Stability", "Right Finger Curl Change", "Right Finger Spread Change",
    "Right Wrist Tremor SD", "Right Stability Mean", "Right Confidence",
    // ── Reference-range comparison outcomes ─────────────────────────────
    "Norm: Wrist Drift", "Norm: Palm Rotation", "Norm: Wrist Tremor Freq",
    "Any Indicator Outside Range"
  ];
}

function ensureHeaders_(sheet) {
  if (sheet.getRange(1, 1).getValue() === "") {
    var h = HEADERS_();
    sheet.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
}

/** Safe getter: returns "" for null/undefined so blanks stay blank. */
function v_(x) { return (x === null || x === undefined) ? "" : x; }

function buildRow_(d) {
  var L = d.left || {}, R = d.right || {};
  function armCols(A) {
    return [
      v_(A.maxDrift), v_(A.driftOnsetSeconds), v_(A.driftDurationMs),
      !!A.sustainedDrift, v_(A.elbowDriftMax), v_(A.baselineWristHeight),
      v_(A.pronationDegrees), !!A.possiblePronation, !!A.supinationToPronationTrend,
      v_(A.elbowFlexionChange), v_(A.armToTorsoChange),
      v_(A.wristTremorAmplitude), v_(A.fingertipTremorAmplitude), v_(A.tremorFrequency),
      v_(A.stability), v_(A.fingerCurlChange), v_(A.fingerSpreadChange),
      v_(A.wristTremorSd), v_(A.stabilityMean), v_(A.confidence)
    ];
  }
  return [
    // Participant intake
    v_(d.participantName), v_(d.participantGender), v_(d.participantAge),
    !!d.declarationAccepted, v_(d.testDateTime),
    // Session metadata
    v_(d.exportedAt) || new Date().toISOString(), v_(d.assessmentId),
    v_(d.startedAt), v_(d.completedAt), v_(d.durationSeconds),
    v_(d.deviceType), v_(d.overallClassification), v_(d.assessedArm),
    // Quality metrics
    v_(d.quality), v_(d.validFramePercentage), v_(d.avgPoseConfidence),
    v_(d.avgLeftHandConfidence), v_(d.avgRightHandConfidence), v_(d.cameraStability),
    v_(d.primaryFailureReason),
    // Analysis metadata
    v_(d.deliveredFrameCount), v_(d.droppedFrameCount), v_(d.effectiveFrameRate),
    !!d.frameRateBelowMinimum, v_(d.recordingStatus),
    !!d.dominantFrequencyBandwidthLimited, !!d.usedPoseOnlyPath
  ]
    .concat(armCols(L))
    .concat(armCols(R))
    .concat([
      // Reference-range comparison outcomes
      v_(d.normWristDrift), v_(d.normPalmRotation), v_(d.normWristTremorFreq),
      !!d.anyIndicatorOutsideRange
    ]);
}
```

### 14.3 What the client sends

The client helper `src/integrations/sheetsExport.ts` is already wired into the
app (it fires once when the results screen is shown). Its JSON payload mirrors
the header order above:

- **Participant:** `participantName`, `participantGender`, `participantAge`,
  `declarationAccepted`, `testDateTime`.
- **Session:** `exportedAt`, `assessmentId`, `startedAt`, `completedAt`,
  `durationSeconds`, `deviceType`, `overallClassification`, `assessedArm`.
- **Quality:** `quality`, `validFramePercentage`, `avgPoseConfidence`,
  `avgLeftHandConfidence`, `avgRightHandConfidence`, `cameraStability`,
  `primaryFailureReason`.
- **Analysis meta:** `deliveredFrameCount`, `droppedFrameCount`,
  `effectiveFrameRate`, `frameRateBelowMinimum`, `recordingStatus`,
  `dominantFrequencyBandwidthLimited`, `usedPoseOnlyPath`.
- **Per arm (`left` / `right` objects):** `maxDrift`, `driftOnsetSeconds`,
  `driftDurationMs`, `sustainedDrift`, `elbowDriftMax`, `baselineWristHeight`,
  `pronationDegrees`, `possiblePronation`, `supinationToPronationTrend`,
  `elbowFlexionChange`, `armToTorsoChange`, `wristTremorAmplitude`,
  `fingertipTremorAmplitude`, `tremorFrequency`, `stability`, `fingerCurlChange`,
  `fingerSpreadChange`, `wristTremorSd`, `stabilityMean`, `confidence`.
- **Norm outcomes:** `normWristDrift`, `normPalmRotation`, `normWristTremorFreq`,
  `anyIndicatorOutsideRange`.

### 14.4 Give the app your Web App URL

Choose **one** of the following:

1. **Environment variable (recommended — keeps the URL out of the source).**
   Create a file named `.env.local` in the project root with:

   ```
   VITE_SHEETS_WEBAPP_URL=https://script.google.com/macros/s/AKfyc.../exec
   ```

   Then rebuild (see §14.5). Vite injects this at build time.

2. **In-source constant (quick, but do not commit it publicly).** Open
   `src/integrations/sheetsExport.ts` and set:

   ```typescript
   const SHEETS_WEBAPP_URL_CONSTANT = 'https://script.google.com/macros/s/AKfyc.../exec';
   ```

The env var takes precedence over the constant when both are present.

### 14.5 Rebuild after configuring

The URL is baked in at build time, so rebuild the artefact you actually deploy:

- **Standalone launcher / single-file build:**

  ```powershell
  npm run build:standalone   # if defined, else:
  npx vite build --config vite.config.singlefile.ts
  ```

  (On the bundled Windows Node, run the equivalent:
  `.\.node\node-v20.18.0-win-x64\node.exe .\node_modules\vite\bin\vite.js build --config vite.config.singlefile.ts`.)
  This regenerates `standalone/app/index.html`.

- **GitHub Pages build:**

  ```powershell
  npm run build   # outputs dist/, deployed by the Actions workflow
  ```

### 14.6 Notes & troubleshooting

- The `no-cors` / `text/plain` pattern intentionally makes the response opaque —
  the client cannot read the reply, which is fine for a fire-and-forget log.
- **No rows appearing?** Confirm the Web App URL ends in `/exec` (not `/dev`),
  that access is **Anyone**, and that you re-deployed a **new version** after any
  script edit. Open the URL directly to confirm the running-status JSON.
- **Header mismatch:** if you added metrics, re-run `setupHeaders` after clearing
  row 1, or append the new columns to both `HEADERS_()` and `buildRow_()`.
- **Privacy:** participant name/age are personal data. Restrict who can view the
  sheet, and only enable the export where the intake declaration was accepted.

### 14.7 When you hand over the Web App URL (what gets updated)

Once you have the Web App URL from §14.1, this is exactly what changes in the
site so results start flowing to your sheet:

1. **`src/integrations/sheetsExport.ts`** — the URL is placed either in the
   `SHEETS_WEBAPP_URL_CONSTANT` constant or, preferably, in a root `.env.local`
   as `VITE_SHEETS_WEBAPP_URL`. This single value flips the export from a no-op
   to live. No other source file needs editing — the helper is already imported
   and fired from `src/App.tsx` when the results screen appears.
2. **Rebuild the artefact you deploy** (§14.5): `npm run build:standalone`
   refreshes `standalone/app/index.html` for the offline launcher, and
   `npm run build` refreshes `dist/` for GitHub Pages.
3. **Publish**:
   - *Standalone:* re-zip / re-share the `standalone/` folder (or just the
     regenerated `standalone/app/`).
   - *GitHub Pages:* commit and push to `main`; the workflow at
     `.github/workflows/deploy.yml` rebuilds and publishes automatically. The
     live URL appears under **Settings → Pages** and in the Actions run summary.
4. **Verify end-to-end:** run one assessment on the deployed site and confirm a
   new row lands in the **Results** tab with the participant columns populated.

> If you send me a **deployed site URL** (rather than the source) I can only
> update files I have in this workspace — I cannot edit a hosted GitHub Pages
> site directly. The flow is always: set the URL here → rebuild → you push /
> redeploy. If your deployment is this same repo, pushing to `main` is all that
> is needed after the rebuild.

---

## 15. Limitations & Validation Status

- **Not clinically validated.** All thresholds and reference ranges are prototype
  values. The tool has not been evaluated against clinician assessment or imaging.
- **Camera-only pronation is approximate.** Palm-orientation from 2.5-D hand
  landmarks is noisy when the hand is edge-on; the app mitigates this with a
  sustained-rotation rule but cannot match an inertial sensor.
- **Single-plane view.** A front-facing 2D view cannot fully resolve
  out-of-plane motion; drift is measured primarily in the image-Y axis.
- **Proprioceptive vs motor causes are not distinguished.** As in the clinical
  test, drift can arise from sensory as well as motor causes; the output is
  screening-level only [[5]](#ref5)[[8]](#ref8).
- **Model/device dependence.** Frame rate and landmark quality vary by device and
  lighting; the reliability flags exist to surface this.

**Intended use:** education, research prototyping, and screening triage under
professional supervision — never standalone diagnosis.

---

## 16. References

<a id="ref2"></a>[2] Teitelbaum JS, et al. *Tests of Motor Function in Patients
Suspected of Having Mild Unilateral Cerebral Lesions.* (Pronator drift with finger
tap and reflexes reported as a reliable, time-effective screening combination.)
ResearchGate record: https://www.researchgate.net/publication/11006650

<a id="ref3"></a>[3] *Pronator Drift* (Encyclopedia of Clinical Neuropsychology /
Springer). Describes UMN-related downward drift and pronation with eyes closed:
https://link.springer.com/rwe/10.1007/978-3-319-56782-2_775-2

<a id="ref4"></a>[4] Park E, Lee DH, Nam HS, Heo JH, et al. *An Objective Pronator
Drift Test Application (iPronator) Using a Handheld Device.* PLoS ONE (PMC):
https://pmc.ncbi.nlm.nih.gov/articles/PMC3404034/

<a id="ref5"></a>[5] *Pronator Drift* (Encyclopedia of Clinical Neuropsychology,
Springer). On upward/lateral drift suggesting proprioceptive rather than motor
deficit: https://link.springer.com/content/pdf/10.1007/978-0-387-79948-3_775.pdf

<a id="ref6"></a>[6] *Pronator Drift.* New England Journal of Medicine, Images in
Clinical Medicine (NEJM 2013): outstretched arms, palms up:
http://www3.med.unipmn.it/papers/2013/NEJM/2013-10-17_nejm/nejmicm1213343.pdf

<a id="ref7"></a>[7] *Pronator Drift (Barré's sign): Neurological Examination.*
Epomedicine. Protocol: arms supinated at shoulder height ≥ 10 s, eyes open then
closed: https://epomedicine.com/clinical-medicine/pronator-drift-neurological-examination/

<a id="ref8"></a>[8] *Pronator Drift / Arm Roll* (Encyclopedia of Clinical
Neuropsychology, Springer). On pathological drift (up/down/out) and pronation
indicating UMN lesion or proprioceptive disturbance:
https://link.springer.com/rwe/10.1007/978-3-319-57111-9_775

<a id="ref9"></a>[9] *The Hand Pronation Phenomenon: A Franco-German Tale.* Karger
/ ResearchGate. Historical and physiological account of pyramidal-tract-related
pronation: https://www.karger.com/Article/Fulltext/329270

<a id="ref10"></a>[10] *Quantifying the Pronator Drift Test (PDT) for stroke motor
weakness.* Journal of Medical Internet Research (JMIR 2017):
https://www.jmir.org/2017/4/e120/PDF

**Software components**

- Google MediaPipe Tasks-Vision (Pose Landmarker, Hand Landmarker) —
  https://ai.google.dev/edge/mediapipe/solutions/vision
- React, Vite, TypeScript, Vitest, fast-check, Playwright.

> Citations above are provided for scientific grounding of the *manoeuvre and its
> interpretation*. They do **not** validate this specific software or its
> prototype thresholds. Reference text was paraphrased and summarised for
> compliance with source licensing.

---

## 17. Aggregate Data Analytics — R Shiny Dashboard

Individual assessments are educational, but the scientific value of this system
emerges at the **cohort level**. Every consented assessment is appended as one
row to the aggregate Google Sheet (§14), and an accompanying **R Shiny**
application turns that live dataset into an interactive analytics-and-education
environment.

- **Live dashboard:** <https://smile-rp.shinyapps.io/SMILE-PronatorDrift/>
- **Data source:** the Google Sheet
  <https://docs.google.com/spreadsheets/d/1OOmyyNWHg40keKS8rl8SQt7aQxwX14MdXsYQGiEVStQ>
- **Source code:** [`PronatorDriftDashboard/app.R`](./PronatorDriftDashboard/app.R)
  with deployment notes in [`PronatorDriftDashboard/README.md`](./PronatorDriftDashboard/README.md)

### 17.1 Design intent

The dashboard is deliberately **dual-purpose**:

1. **Analytical** — it lets a researcher explore distributions, group
   differences, left–right asymmetry, correlations, and data quality across the
   whole cohort.
2. **Educational** — every view carries an "About this view" panel written in
   plain, non-diagnostic language, and every metric is defined in an on-screen
   data dictionary, so a student or clinician-in-training can learn *what the
   test measures and why* while reading the data.

It reads the sheet as a public CSV (`gviz/tq?tqx=out:csv`) and re-polls every two
minutes, so newly completed assessments appear automatically. A status banner
states whether the app is showing **live sheet data**, **demo data**, or **both**
(the demo cohort of 60 synthetic records can be retained and the live rows
appended beneath it, controlled by the `INCLUDE_DEMO_DATA` flag in `app.R`).

### 17.2 Views

| Tab | What it shows | Why it matters scientifically |
|---|---|---|
| **Overview** | KPIs, classification mix, timeline, and a primer on the three signs. | Orientates the reader; summarises cohort size, flag rate, and data quality at a glance. |
| **Participants** | Age and gender distributions, device mix, drift-by-age. | Physiological tremor and baseline steadiness vary with age; cohort structure must be understood before interpreting group effects. |
| **Drift & Pronation** | Left vs right violins with prototype reference bands, plus the drift × pronation "diagnostic quadrant". | Makes the classic *downward-drift-with-pronation* pattern visible and separates it from non-specific presentations. |
| **Left–Right Asymmetry** | Left-vs-right scatter, asymmetry distribution, and a paired *t*-test. | Pronator drift is fundamentally an **asymmetry** sign; between-arm difference is often more informative than either arm alone. |
| **Tremor & Stability** | Dominant-frequency density with the 8–12 Hz band, stability, wrist/fingertip amplitude, finger metrics. | Distinguishes physiological from pathological oscillation and quantifies hold steadiness. |
| **Relationships** | Any-metric-vs-any-metric scatter explorer + Pearson correlation heatmap. | Surfaces associations and confounders (e.g. age vs tremor) for hypothesis generation. |
| **Quality & Reliability** | Valid-frame %, effective FPS, and quality-vs-drift. | Guards against mistaking tracking artefacts for real movement findings. |
| **Data Explorer** | Full filterable table, CSV download, and the data dictionary. | Enables independent re-analysis and export for statistical software. |

### 17.3 Reproducing / redeploying the dashboard

```r
# Local run
install.packages(c("shiny","bslib","ggplot2","dplyr","tidyr","DT",
                   "plotly","scales","lubridate","stringr"))
shiny::runApp("PronatorDriftDashboard")

# Deploy to shinyapps.io
install.packages("rsconnect")
rsconnect::setAccountInfo(name = "smile-rp", token = "<token>", secret = "<secret>")
rsconnect::deployApp(appDir = "PronatorDriftDashboard", appName = "SMILE-PronatorDrift")
```

The `SHEET_ID` and `SHEET_TAB` constants at the top of `app.R` point the
dashboard at the dataset; they are already set to the SMILE results sheet.

---

## 18. Research Use, Reproducibility & Data Management

This section documents the system as a **reproducible research instrument**.

### 18.1 End-to-end data lineage

```
Camera (device) ─▶ MediaPipe pose/hand landmarks (in-browser, WASM)
                 ─▶ DriftAnalyzer + MicroMovementAnalyzer (per-frame, on-device)
                 ─▶ PronatorDriftAssessment (typed result object, §5)
                 ─▶ sheetsExport.ts (consented POST of result values only)
                 ─▶ Google Apps Script Web App (§14) ─▶ Google Sheet row
                 ─▶ R Shiny dashboard (live CSV read, §17)
```

No video frames or raw landmark coordinates leave the device at any point; only
the **derived, aggregate result values** and the **participant intake fields**
are transmitted, and only with consent.

### 18.2 The record (one row per assessment)

Each row of the aggregate sheet is a complete, self-describing observation:

- **Participant intake** — Name, Gender, Age, Declaration Accepted, and the
  captured **Test Date/Time** (ISO 8601), entered at the start of the session.
- **Session metadata** — assessment ID, start/complete timestamps, duration,
  device type, overall classification, assessed arm.
- **Quality metrics** — valid-frame %, mean pose/hand confidence, camera
  stability, primary failure reason.
- **Analysis/reliability metadata** — delivered/dropped frame counts, effective
  frame rate, frame-rate-below-minimum flag, recording status, bandwidth-limited
  and pose-only-path flags.
- **Per-arm metrics (LEFT and RIGHT)** — max drift, drift onset, drift duration,
  sustained-drift flag, elbow drift, baseline wrist height, pronation degrees,
  possible-pronation flag, supination→pronation trend, elbow-flexion change,
  arm-to-torso change, wrist and fingertip tremor amplitude, dominant tremor
  frequency, stability, finger-curl and finger-spread change, tremor variability,
  and per-arm confidence.
- **Reference-range outcomes** — within/outside/no-reference for the three
  prototype-seeded indicators, plus an "any indicator outside range" flag.

Full field-by-field definitions and units are in §5 (Complete Data Dictionary);
the exact column order is in §14.2 (`HEADERS_`).

### 18.3 Units, coordinate frame, and normalisation

- Positions are **normalised image coordinates** in `[0, 1]`; drift is divided by
  **arm length** (shoulder→wrist distance) so measurements are invariant to the
  subject's distance from the camera.
- Angles are in **degrees**; frequency in **Hz** (capped at the Nyquist limit for
  the effective frame rate); stability is a bounded `(0, 1]` ratio.
- Torso compensation is subtracted from wrist drift so whole-body sinking is not
  mistaken for arm drift (§4.4).

### 18.4 Suggested analyses

- **Asymmetry as the primary signal:** analyse `|Left − Right|` for drift,
  pronation, and stability rather than raw per-arm values.
- **Age adjustment:** treat age as a covariate — physiological tremor and reduced
  steadiness rise with age and can confound group comparisons.
- **Quality gating:** exclude or sensitivity-test rows with low valid-frame % or
  effective FPS below the configured minimum before drawing conclusions.
- **Threshold calibration:** the seeded reference ranges (§5.7) are prototypes;
  the aggregate dataset is the substrate for deriving empirically-grounded ranges
  in future validation work.

### 18.5 Reproducibility checklist

- Deterministic, documented pipeline (source in `src/analysis/`, thresholds in
  `src/config/ConfigStore.ts`, all versioned in Git).
- Model versions recorded per assessment (`modelVersions`, §5.6).
- Property-based and end-to-end tests (`npm run test`, `npm run test:e2e`).
- Open data path (public sheet) and open analysis code (`PronatorDriftDashboard/`).

---

## 19. Ethics, Consent & Regulatory Positioning

### 19.1 Consent model

Consent is obtained **before** any measurement, on the participant intake screen,
via an explicit declaration the participant must accept to proceed. The
declaration states that the participant's details and screening results are
recorded for the session, and that the tool is a research prototype and screening
aid — **not a medical device**. The acceptance flag (`Declaration Accepted`) is
stored with every record so consent is auditable.

### 19.2 Data minimisation & privacy

- **On-device computation:** video and landmark data never leave the device.
- **Transmitted data:** only derived result values and the intake fields, and
  only when the operator has configured the export (§14) for a consented session.
- **Personal data:** participant name and age are personal data. Restrict access
  to the results sheet and dashboard accordingly (e.g. shinyapps.io
  authentication), and pseudonymise names where full identification is not
  required for your protocol.
- **Right to deletion:** the app provides an on-device "Delete Assessment Data"
  control; sheet rows can be removed directly by the data controller.

### 19.3 Regulatory positioning

This software is a **research prototype and educational tool**. It is not
CE-marked, not FDA-cleared, and not registered as a medical device in any
jurisdiction. All thresholds and reference ranges are prototype values pending
clinical validation. Outputs use non-diagnostic language throughout. It must be
used only under appropriate professional supervision and governance, and never as
a standalone basis for clinical decisions.

---

## 20. How to Cite / Authorship & Acknowledgements

### 20.1 Suggested citation

> SMILE — *Smart Monitoring for Individualised Living and Engagement*.
> *Pronator Drift Computer-Vision Screening Application and Aggregate Analytics
> Dashboard.* Research prototype. Software: <https://github.com/aaron-chen-angus/pronator-drift-app>.
> Live app: <https://aaron-chen-angus.github.io/pronator-drift-app/>.
> Analytics dashboard: <https://smile-rp.shinyapps.io/SMILE-PronatorDrift/>.
> (Add year, version tag, and DOI on release.)

*(Adjust the author list, affiliations, and year to match your publication
records before formal dissemination.)*

### 20.2 Making the release citable

- Tag a release in the repository (e.g. `v1.0.0`) and, if a persistent identifier
  is required, mint a **DOI** via a Git-archiving service such as Zenodo by
  linking the repository and publishing a release.
- Record the exact MediaPipe model versions used (already captured per assessment
  in `modelVersions`, §5.6) in the methods section of any publication.

### 20.3 Software components & acknowledgements

- **Google MediaPipe Tasks-Vision** — Pose Landmarker (Lite, float16) and Hand
  Landmarker (float16): <https://ai.google.dev/edge/mediapipe/solutions/vision>
- **Web application:** React 19, TypeScript, Vite, Vitest, fast-check, Playwright.
- **Analytics dashboard:** R, Shiny, bslib, ggplot2, dplyr, tidyr, DT, plotly,
  scales; hosted on shinyapps.io.
- **Data transport:** Google Apps Script + Google Sheets.

> The scientific references in §16 ground the *manoeuvre and its clinical
> interpretation*. They do **not** validate this specific software or its
> prototype thresholds, which remain pending clinical validation.
