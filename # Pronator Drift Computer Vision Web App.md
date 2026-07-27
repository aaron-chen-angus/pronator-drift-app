# Pronator Drift Computer Vision Web Application

## Product and Software Requirements Specification

## 1. Project Objective

Develop a responsive, portrait-oriented web application that guides a user through a 30-second pronator drift screening test using computer vision and verbal instructions.

The application shall:

* Explain and demonstrate the correct test position.
* Confirm that the user is correctly positioned before starting.
* Monitor both arms continuously for 30 seconds.
* Detect downward arm drift and possible forearm pronation.
* Provide spoken instructions and countdown cues because the user’s eyes will be closed during the assessment.
* Display an understandable screening result after the assessment.
* Operate on both desktop and mobile web browsers.
* Use a modern, high-technology interface inspired by a TRON-style visual aesthetic.
* Clearly state that the result is a screening observation and not a medical diagnosis.

The application is intended as a prototype neurological screening aid. It must not claim to diagnose stroke, corticospinal tract lesions, multiple sclerosis, or any other neurological condition.

---

# 2. Clinical Background

The pronator drift test is a neurological examination used to identify subtle upper-limb weakness.

During the test, the subject holds both arms extended forward at approximately shoulder level, with elbows straight and palms facing upward. The subject then closes their eyes while the examiner observes for downward arm movement, forearm pronation, finger flexion, or asymmetry.

A classical positive pronator drift pattern consists of:

* Progressive downward movement of one arm.
* Rotation of the affected forearm from palm-up towards palm-down.
* Possible flexion of the fingers, wrist, or elbow.

The app must treat these observations as screening indicators rather than conclusive evidence of a neurological lesion.

---

# 3. Intended Users

The prototype may be used by:

* Members of the public conducting a guided screening.
* Healthcare students learning neurological assessment.
* Researchers evaluating computer-vision-based neurological screening.
* Healthcare or community-care personnel supervising a screening.
* Developers and clinical collaborators validating the assessment workflow.

The first version should support one subject performing the test at a time.

---

# 4. Supported Devices and Orientation

## 4.1 Devices

The web application shall support:

* Desktop computers with webcams.
* Laptop computers with integrated cameras.
* Android mobile phones.
* iPhones using supported mobile browsers.
* Tablets, where camera access and portrait orientation are supported.

## 4.2 Orientation

The primary experience shall use **portrait orientation**.

On mobile devices:

* Detect the current screen orientation.
* Prevent the assessment from starting in landscape orientation.
* Display:
  “Please rotate your device to portrait orientation to continue.”

On desktop devices:

* Display the assessment within a portrait-proportioned central interface.
* The live camera area may remain vertically framed even when the browser window is wider.

## 4.3 Camera Requirements

The application shall:

* Request camera permission before entering the positioning stage.
* Prefer the front-facing camera on mobile devices.
* Allow the user to switch cameras when multiple cameras are available.
* Display a clear message when camera access is denied.
* Not record or upload video by default.
* Process camera frames locally in the browser where technically feasible.

---

# 5. Recommended Camera and Subject Position

The subject shall face the camera directly.

The app should instruct the subject to:

* Sit or stand comfortably.
* Place the device on a stable surface.
* Position the camera approximately at chest or upper-torso height.
* Stand far enough away for the head, shoulders, elbows, wrists, and hands to remain visible.
* Keep the body centred and facing directly forward.
* Keep both arms fully visible without either hand leaving the camera frame.
* Remove bulky outerwear that obscures the shoulders, elbows, or wrists.
* Ensure the room is adequately lit.
* Avoid strong backlighting.
* Ensure that no second person is visible in the assessment area.

Recommended initial guidance:

“Place your device upright on a stable surface. Face the camera directly and move backwards until your head, shoulders, arms, and hands are clearly visible.”

The application should use an on-screen silhouette or positioning guide showing the required body placement.

---

# 6. Test Position

The application shall instruct the subject to:

1. Face the camera directly.
2. Sit or stand upright.
3. Raise both arms straight forward.
4. Keep both arms approximately at shoulder level.
5. Fully extend both elbows without forcefully locking them.
6. Keep the arms approximately parallel.
7. Turn both palms upward.
8. Spread or comfortably extend the fingers.
9. Keep both hands visible to the camera.
10. Hold the position steadily.
11. Close the eyes only after the application confirms that the position is correct.

The application shall not begin the timed assessment until an acceptable starting position has been detected.

---

# 7. Application Workflow

## 7.1 Welcome Screen

Display:

* Application name.
* Brief description.
* “Start Assessment” button.
* “How It Works” button.
* “About This Test” information panel.
* Privacy notice.
* Medical screening disclaimer.

Suggested primary wording:

“Use your camera to complete a guided 30-second upper-limb movement screening.”

Suggested disclaimer:

“This application provides a computer-vision-based screening observation. It does not provide a diagnosis and does not replace assessment by a qualified healthcare professional.”

---

## 7.2 Pre-Test Safety Screen

Before continuing, ask the user to confirm:

* They can safely sit or stand for the assessment.
* They have enough clear space around them.
* Their device is placed securely.
* They are not experiencing pain when raising their arms.
* They understand that they should stop if they feel unwell, dizzy, unstable, or uncomfortable.

Provide a seated-test recommendation for users who may have difficulty maintaining balance.

Suggested wording:

“For safety, conduct the test while seated if you are uncertain about your balance.”

Include:

* “I am ready” button.
* “Exit Assessment” button.

---

## 7.3 Camera Setup

The application shall:

* Request camera permission.
* Open the live camera preview.
* Check image brightness.
* Check whether one person is visible.
* Check whether the subject is centred.
* Check whether the shoulders, elbows, wrists, and hands are visible.
* Check whether the subject is facing approximately forward.
* Check whether the camera is reasonably stable.

Display real-time positioning feedback such as:

* “Move backwards.”
* “Move slightly to your left.”
* “Centre your body.”
* “Raise the camera slightly.”
* “Both hands must be visible.”
* “Improve the lighting.”
* “Only one person should be visible.”
* “Place your device on a stable surface.”

---

## 7.4 Instruction and Demonstration

Present a short animation, illustration, or silhouette demonstrating:

* Arms straight forward.
* Palms facing upward.
* Elbows extended.
* Body facing directly forward.
* Eyes closing only after the start instruction.

Provide both written and spoken instructions.

Suggested spoken instruction:

“Stand or sit facing the camera. Raise both arms straight in front of you at shoulder level. Keep your elbows straight and turn both palms upward.”

---

## 7.5 Starting-Position Validation

The computer-vision system shall validate the following before enabling the assessment:

### Body position

* One subject is detected.
* Torso is facing approximately forward.
* Both shoulders are visible.
* Subject is sufficiently centred.

### Arm position

* Both upper limbs are detected.
* Both elbows are extended within an acceptable tolerance.
* Both wrists are approximately at shoulder height.
* Both arms are directed primarily forward.
* Neither arm is resting against the body or an object.

### Hand position

* Both hands are visible.
* Palm orientation is likely to be upward.
* Hand-landmark confidence exceeds the minimum threshold.

### Stability

* The starting pose is held continuously for approximately 2 to 3 seconds.
* Excessive body movement is not present.

Display a progress indicator such as:

“Hold this position while we check your alignment.”

When valid:

“Position confirmed.”

When invalid, identify the most important correction rather than showing multiple simultaneous warnings.

---

# 8. Calibration Stage

Before the subject closes their eyes, capture a baseline lasting approximately 2 to 3 seconds.

Calculate baseline values separately for the left and right sides:

* Shoulder coordinates.
* Elbow coordinates.
* Wrist coordinates.
* Normalised wrist height.
* Elbow extension angle.
* Shoulder-to-wrist vector.
* Wrist-to-hand vector.
* Palm orientation estimate.
* Hand rotation estimate.
* Arm length.
* Left-right wrist height difference.
* Torso lean angle.
* Shoulder-line angle.
* Pose and hand-landmark confidence.

Measurements should be normalised to body dimensions, such as shoulder width or upper-limb length, to reduce the effect of distance from the camera.

Do not assume that both arms start at exactly identical heights. Compare subsequent movement with each arm’s own baseline.

---

# 9. Timed Assessment

## 9.1 Start Sequence

Once the starting position is valid, provide the following spoken sequence:

“Your position is correct. Keep both arms still and palms facing upward. When instructed, close your eyes.”

Pause briefly.

“Close your eyes now. The assessment is starting.”

Start the 30-second timer after this instruction.

An optional audible tone may mark the beginning of the test.

---

## 9.2 Active Monitoring

Throughout the 30-second assessment, analyse camera frames continuously.

The application shall monitor:

* Left wrist vertical displacement.
* Right wrist vertical displacement.
* Left elbow vertical displacement.
* Right elbow vertical displacement.
* Elbow flexion.
* Forearm or palm rotation.
* Finger or wrist flexion where detectable.
* Shoulder lowering.
* Torso leaning.
* Whole-body movement.
* Hands leaving the frame.
* Landmark-confidence loss.
* Camera movement.
* Temporary occlusion.

The system shall distinguish probable arm drift from apparent movement caused by:

* Torso leaning.
* Shoulder rotation.
* The subject stepping forwards or backwards.
* Camera movement.
* Hands being temporarily hidden.
* Poor lighting.
* Low landmark confidence.
* The subject deliberately resetting their arm position.

---

## 9.3 Spoken Countdown

During the assessment, provide verbal time cues without requiring the subject to open their eyes.

Recommended countdown:

* At 25 seconds remaining: “25 seconds remaining.”
* At 20 seconds remaining: “20 seconds remaining.”
* At 15 seconds remaining: “15 seconds remaining.”
* At 10 seconds remaining: “10 seconds remaining.”
* During the final five seconds: “5, 4, 3, 2, 1.”

Use a calm, clear, neutral voice.

Do not provide performance feedback while the subject’s eyes are closed. For example, do not say that one arm is dropping during the assessment because this may cause the subject to correct their position and affect the result.

---

## 9.4 Test Completion

At the end of 30 seconds, provide an audible completion tone and say:

“The assessment is complete. You may open your eyes, lower your arms, and relax.”

The result should only appear after this instruction.

---

# 10. Computer Vision Requirements

## 10.1 Pose Estimation

Use an upper-body pose-estimation model capable of tracking, at minimum:

* Nose or face centre.
* Left and right shoulders.
* Left and right elbows.
* Left and right wrists.
* Torso reference points.

The pose model must return:

* Landmark coordinates.
* Landmark visibility or confidence scores.
* Frame timestamp.

## 10.2 Hand Analysis

Use a hand-landmark model or separate palm-orientation classifier capable of estimating:

* Left and right hand presence.
* Palm orientation.
* Wrist-to-hand direction.
* Hand rotation changes.
* Finger positions where technically reliable.

Standard shoulder, elbow, and wrist landmarks alone are insufficient for confidently identifying pronation. Hand-level analysis must therefore be included in the intended architecture.

## 10.3 Temporal Analysis

Do not classify drift from a single frame.

Use a time-series analysis window that:

* Smooths landmark jitter.
* Tracks progressive movement.
* Identifies sustained changes.
* Rejects short, isolated tracking errors.
* Records the onset and maximum extent of movement.
* Compares each side with its own baseline.
* Compares the two sides for asymmetry.

Possible approaches include:

* Moving median or moving-average filtering.
* Exponential smoothing.
* Kalman filtering.
* Temporal landmark confidence weighting.
* Sustained threshold logic.
* A trained time-series classifier in later versions.

## 10.4 Downward-Drift Measurement

For each arm, calculate downward drift using the wrist position relative to:

* Its baseline position.
* The ipsilateral shoulder.
* The shoulder line.
* Normalised arm length.
* Torso orientation.

A drift event should require:

* Downward movement above a configurable threshold.
* Persistence above the threshold for a configurable duration.
* Adequate landmark confidence.
* No corresponding torso or camera movement sufficient to explain the change.

Do not hard-code final clinical thresholds without validation data.

Initial prototype thresholds must be configurable and clearly labelled as experimental.

## 10.5 Pronation Measurement

Possible pronation shall be estimated from:

* Changes in palm-facing direction.
* Hand-landmark geometry.
* Wrist-to-knuckle vectors.
* Visibility changes in palm versus dorsal hand features.
* Forearm and hand rotation relative to baseline.

Because a single front-facing RGB camera has limitations in estimating axial forearm rotation, the app shall report:

* “Possible pronation detected”

rather than:

* “Pronation confirmed”

unless the measurement method has been clinically validated.

## 10.6 Combined Drift Pattern

For each arm, calculate separate indicators:

* Downward drift score.
* Possible pronation score.
* Elbow-flexion score.
* Hand or finger-flexion score.
* Tracking-quality score.

A classical pronator drift pattern should require both:

* Sustained downward movement.
* Sustained probable pronation.

Downward movement without probable pronation must be shown as a separate observation.

---

# 11. Assessment Quality Control

The application shall produce an assessment-quality rating.

Possible quality categories:

* Good quality.
* Acceptable quality.
* Low quality.
* Unable to assess.

Quality shall consider:

* Percentage of valid frames.
* Pose-landmark confidence.
* Hand-landmark confidence.
* Lighting.
* Camera stability.
* Subject visibility.
* Amount of torso movement.
* Whether the arms remained within the frame.
* Whether the full 30 seconds were completed.
* Whether the starting pose was valid.

If quality is insufficient, the application must not present a normal or positive interpretation.

Instead display:

“Assessment could not be interpreted reliably.”

Provide the main reason and a “Repeat Assessment” button.

---

# 12. Result Categories

The system shall distinguish between **observations** and **possible interpretations**.

## 12.1 No Significant Drift Detected

Criteria:

* Neither arm demonstrates sustained downward drift above the configured threshold.
* No sustained probable pronation is detected.
* Assessment quality is acceptable.

Display:

“No significant arm drift was detected during this screening.”

Supporting text:

“Both arms remained relatively stable throughout the assessment.”

Do not display “Neurologically normal.”

---

## 12.2 Possible Left Pronator Drift Pattern

Criteria:

* Sustained downward movement of the left arm.
* Sustained probable pronation of the left hand or forearm.
* Movement is not adequately explained by body movement or tracking error.
* Assessment quality is acceptable.

Display:

“Possible pronator drift pattern detected on the left side.”

Supporting text:

“The left arm showed downward movement together with possible inward palm rotation.”

Clinical-context wording:

“A unilateral pronator drift pattern can be associated with weakness involving motor pathways on the opposite side of the nervous system. This screening result is not diagnostic and should be interpreted by a qualified healthcare professional.”

---

## 12.3 Possible Right Pronator Drift Pattern

Use the equivalent logic and wording for the right side.

Display:

“Possible pronator drift pattern detected on the right side.”

---

## 12.4 Bilateral Drift Observed

Criteria:

* Sustained downward movement is detected in both arms.
* The pattern is not adequately explained by torso movement, fatigue, camera movement, or tracking error.
* Assessment quality is acceptable.

Display:

“Downward movement was observed in both arms.”

Supporting text:

“Bilateral movement can have several possible explanations, including difficulty maintaining the test position. This result requires professional interpretation.”

The application must not automatically state that bilateral drift proves bilateral upper motor neuron dysfunction or diffuse neurological impairment.

---

## 12.5 Downward Drift Without Clear Pronation

Criteria:

* One or both arms move downward.
* Reliable pronation is not detected.

Display:

“Arm drift was observed without clear palm rotation.”

Supporting text:

“This is not the classical pronator drift pattern. Other factors, including fatigue, discomfort, positioning, or non-neurological causes, may affect the result.”

---

## 12.6 Possible Pronation Without Significant Arm Drop

Criteria:

* Probable palm rotation is detected.
* Downward displacement remains below threshold.

Display:

“Possible palm rotation was observed without significant downward arm movement.”

This should be reported as an observation, not a positive pronator drift result.

---

## 12.7 Unable to Assess

Possible reasons:

* Hands left the camera frame.
* Poor lighting.
* Camera moved.
* Multiple people were detected.
* Landmark confidence was too low.
* Subject did not maintain the starting position.
* Test ended early.
* Excessive torso movement.
* Palm orientation could not be estimated reliably.

Display:

“We could not obtain a reliable result. Please adjust your setup and repeat the assessment.”

---

# 13. Result Screen

The result screen shall include:

* Overall observation.
* Side affected, where applicable.
* Test quality.
* Maximum left-arm drift.
* Maximum right-arm drift.
* Possible left pronation.
* Possible right pronation.
* A simple timeline or movement graph.
* Plain-language explanation.
* Medical disclaimer.
* “Repeat Assessment” button.
* “Return Home” button.
* Optional “View Details” panel.

Do not overwhelm the primary result screen with technical values.

Place technical measurements inside an expandable section titled:

“View Movement Details”

---

# 14. Visual Movement Summary

Where sufficient data exists, display:

* A baseline arm-position outline.
* A final or maximum-drift arm-position outline.
* Left and right movement traces.
* The time at which drift began.
* Maximum normalised vertical displacement.
* Estimated palm-orientation change.
* Confidence and quality indicators.

Do not display a red alarm solely because a small movement occurred.

Use neutral language and graded visual severity.

---

# 15. Voice and Audio Requirements

The application shall use browser-based text-to-speech or pre-recorded audio.

Required spoken messages include:

* Camera-positioning instructions.
* Arm-position instructions.
* Position-confirmed message.
* Eyes-closed instruction.
* Assessment start.
* Five-second interval countdowns.
* Final five-second countdown.
* Test-complete instruction.
* Permission to open eyes and relax.
* Error or restart instruction when the test cannot continue.

Provide:

* Volume control.
* Replay-instruction button before the assessment.
* Mute option.
* Captions for every spoken instruction.

The mute option must include a warning that audio is recommended because the user will close their eyes.

---

# 16. User Interface and Visual Design

## 16.1 Design Direction

Create a high-technology, clinical TRON-inspired interface.

Visual characteristics:

* Dark navy or near-black background.
* Cyan, electric blue, and turquoise luminous accents.
* Thin geometric grid lines.
* Circular scanning indicators.
* Subtle animated body-tracking overlays.
* Glowing borders used sparingly.
* Clean, modern typography.
* High contrast and strong readability.
* Smooth transitions.
* Minimal visual clutter.
* Clinical rather than gaming-oriented presentation.

Avoid:

* Flashing effects.
* Rapidly pulsing animations.
* Excessive neon glow.
* Small text.
* Decorative elements that obscure the camera feed.
* Aggressive warning visuals that may cause anxiety.

## 16.2 Camera Overlay

The live camera screen may include:

* Body-centre guide.
* Shoulder-level guide.
* Left and right arm target zones.
* Hand-visibility zones.
* Pose skeleton.
* Palm-up indicators.
* Alignment status.
* Test timer.
* Tracking-quality indicator.

During the eyes-closed assessment, the visual interface may remain active for an observer, but the system must rely on audio for subject instructions.

---

# 17. Supplementary Educational Content

Provide an optional, non-intrusive “About the Test” section.

Use collapsible information cards for:

## Physiological Basis

“Pronator drift can occur when the muscles responsible for keeping the forearm supinated are less able to oppose the muscles that pronate the forearm. This may make subtle weakness more visible when visual feedback is removed.”

## Clinical Use

“The test may help clinicians identify subtle upper-limb weakness that is not obvious during routine observation. It forms only one part of a complete neurological examination.”

## Why the Eyes Are Closed

“Closing the eyes removes visual feedback. This makes it harder to consciously correct small changes in arm position.”

## Why Camera Position Matters

“A direct front view helps compare the height and movement of both arms. Clear visibility of the hands is also needed to estimate palm rotation.”

## Important Limitation

“Pain, fatigue, limited shoulder movement, poor positioning, visual or sensory problems, and difficulty understanding the instructions may influence the result.”

These sections should not interrupt the assessment workflow.

---

# 18. Safety and Medical Messaging

Display the following principles throughout the application:

* This is a screening tool, not a diagnostic tool.
* A normal result does not exclude neurological disease.
* An abnormal result does not confirm a particular diagnosis.
* Results must be interpreted in clinical context.
* Users with concerning symptoms should obtain appropriate medical assessment.
* The application must not delay urgent medical evaluation.

Suggested result disclaimer:

“This computer-vision assessment is experimental and is not a medical diagnosis. Movement detected during this test may have neurological or non-neurological explanations. Consult a qualified healthcare professional for interpretation.”

Suggested urgent-symptom message:

“If you or someone nearby has sudden weakness, facial drooping, speech difficulty, severe loss of balance, or other sudden neurological symptoms, stop using this application and seek emergency medical assistance immediately.”

Do not provide reassurance based solely on a negative app result.

---

# 19. Privacy and Data Protection

The first version should follow a privacy-first architecture.

Requirements:

* Process video frames on-device where feasible.
* Do not save raw video by default.
* Do not transmit video to a server without explicit consent.
* Clearly state whether any image, video, or landmark data leaves the device.
* Allow users to complete the assessment without creating an account.
* Store only the minimum data required.
* Provide a “Delete Assessment Data” option where data is retained.
* Do not use captured footage for model training without separate, explicit consent.
* Do not perform face recognition or identity matching.
* Do not infer age, ethnicity, emotion, or other unrelated personal characteristics.

If results are stored, use a random assessment identifier rather than the user’s name.

---

# 20. Suggested Technical Architecture

## Frontend

Recommended:

* React or Next.js.
* TypeScript in strict mode.
* Responsive portrait-first layout.
* Progressive Web App support where practical.
* Web Speech API or pre-recorded audio.
* Web Workers for computer-vision processing where supported.
* Canvas or WebGL overlay for landmarks and movement visualisation.

## Computer Vision

Use browser-compatible models for:

* Full-body or upper-body pose estimation.
* Hand landmark detection.
* Palm-orientation estimation.
* Person-count detection.
* Temporal movement tracking.

Potential implementation options may include browser-compatible pose and hand-landmark frameworks. Select the final framework based on:

* Mobile browser performance.
* Model size.
* Landmark accuracy.
* Licensing.
* WebGPU or WebGL support.
* Device compatibility.
* Local-processing capability.

## Backend

The initial prototype should avoid requiring a backend for core testing.

A backend may later support:

* Consented result storage.
* Research dashboards.
* Configuration management.
* Model-version tracking.
* Threshold updates.
* Audit logs.
* Clinician review.
* Anonymised research exports.

---

# 21. Data Model

Create an assessment result object containing at least:

```typescript
interface PronatorDriftAssessment {
  assessmentId: string;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  deviceType: "mobile" | "tablet" | "desktop";
  orientation: "portrait";
  modelVersions: {
    poseModel: string;
    handModel: string;
    classifier?: string;
  };
  quality: {
    overall: "good" | "acceptable" | "low" | "unable_to_assess";
    validFramePercentage: number;
    poseConfidence: number;
    leftHandConfidence: number;
    rightHandConfidence: number;
    cameraStability: number;
    excessiveTorsoMovement: boolean;
    handsRemainedVisible: boolean;
    reasons: string[];
  };
  leftArm: ArmAssessment;
  rightArm: ArmAssessment;
  overallClassification:
    | "no_significant_drift"
    | "possible_left_pronator_drift"
    | "possible_right_pronator_drift"
    | "possible_bilateral_drift"
    | "drift_without_clear_pronation"
    | "possible_pronation_without_drift"
    | "unable_to_assess";
}
```

```typescript
interface ArmAssessment {
  baselineWristHeight: number;
  maximumDownwardDriftNormalised: number;
  driftDurationMilliseconds: number;
  driftOnsetSeconds: number | null;
  maximumElbowFlexionChangeDegrees: number;
  estimatedPalmRotationChangeDegrees: number | null;
  possiblePronation: boolean;
  sustainedDownwardDrift: boolean;
  confidence: number;
}
```

Do not present estimated rotation degrees clinically until the measurement has been validated.

---

# 22. Configurable Detection Parameters

Store experimental thresholds in a configuration object rather than embedding them throughout the application.

Include:

* Minimum pose confidence.
* Minimum hand confidence.
* Required starting-pose duration.
* Permitted shoulder-height difference.
* Permitted elbow-flexion range.
* Minimum downward-drift threshold.
* Required drift persistence.
* Minimum possible-pronation change.
* Maximum acceptable torso lean.
* Maximum camera movement.
* Minimum valid-frame percentage.
* Occlusion grace period.
* Smoothing-window duration.

Clearly label these values as prototype settings requiring validation.

---

# 23. Failure Handling

The test shall pause or terminate safely when:

* Both hands are lost for longer than the grace period.
* Either arm leaves the frame for a prolonged period.
* Camera access is interrupted.
* The browser tab becomes inactive.
* Device orientation changes.
* More than one person enters the frame.
* Camera movement invalidates the baseline.
* Tracking confidence becomes persistently inadequate.
* The user presses stop.

Spoken interruption message:

“We have lost a clear view of your arms. You may open your eyes and relax.”

Then display the reason and offer to repeat the test.

---

# 24. Accessibility Requirements

The application shall support:

* Large readable text.
* High visual contrast.
* Screen-reader-friendly controls.
* Keyboard navigation.
* Captions for spoken instructions.
* Adjustable audio volume.
* Reduced-motion preference.
* Clear focus indicators.
* Buttons with large touch targets.
* Plain-language instructions.
* Optional repeat-audio controls.
* Seated-test instructions.

Avoid relying on colour alone to communicate assessment status.

---

# 25. Testing Requirements

## 25.1 Functional Tests

Test:

* Camera permission granted and denied.
* Portrait-orientation enforcement.
* Subject too close or too far.
* One hand outside frame.
* Both arms correctly positioned.
* Elbows bent.
* Palms not facing upward.
* Arms at different starting heights.
* Left-arm downward movement.
* Right-arm downward movement.
* Bilateral downward movement.
* Palm rotation without arm drop.
* Arm drop without palm rotation.
* Torso lean that resembles arm drift.
* Camera movement.
* Poor lighting.
* Multiple people.
* Interrupted assessment.
* Successful 30-second assessment.
* Audio countdown timing.
* Final instruction to open eyes and relax.

## 25.2 Device Tests

Test on:

* Current Chrome desktop.
* Current Edge desktop.
* Current Safari on iPhone.
* Current Chrome on Android.
* Different camera resolutions.
* Lower-performance mobile devices.
* Different screen sizes.

## 25.3 Algorithm Tests

Create synthetic and recorded test cases representing:

* No drift.
* Mild unilateral drift.
* Pronator drift pattern.
* Bilateral fatigue-related lowering.
* Elbow flexion.
* Shoulder lowering.
* Torso lean.
* Tracking jitter.
* Partial occlusion.
* Different skin tones.
* Different clothing.
* Different lighting.
* Different arm lengths.
* Mobility limitations.

Algorithm performance must be evaluated separately for:

* Downward-drift detection.
* Palm-orientation detection.
* Side classification.
* Assessment-quality rejection.
* False-positive rate.
* False-negative rate.

---

# 26. Acceptance Criteria for the Initial Prototype

The initial prototype is complete when:

1. It runs in supported desktop and mobile browsers.
2. It enforces or strongly guides portrait orientation.
3. It provides written and spoken instructions.
4. It detects whether the subject is correctly positioned.
5. It requires both shoulders, elbows, wrists, and hands to be visible.
6. It records a stable starting baseline.
7. It performs continuous monitoring for 30 seconds.
8. It speaks the countdown at five-second intervals.
9. It performs the final “5, 4, 3, 2, 1” countdown.
10. It instructs the user to open their eyes and relax after completion.
11. It calculates left and right arm displacement separately.
12. It attempts to estimate palm rotation using hand landmarks.
13. It identifies insufficient-quality assessments.
14. It displays screening observations using non-diagnostic language.
15. It supports repeating the assessment.
16. It does not save or transmit raw camera video by default.
17. It includes unit, integration, and browser-level tests.
18. It uses a polished TRON-inspired clinical interface.

---

# 27. Development Phases

## Phase 1: Guided Prototype

Build:

* Welcome and safety screens.
* Camera setup.
* Pose detection.
* Starting-position checks.
* Spoken instructions.
* 30-second countdown.
* Wrist-height tracking.
* Basic result display.
* Local-only processing.

## Phase 2: Hand and Pronation Analysis

Add:

* Hand-landmark tracking.
* Palm-orientation estimation.
* Possible-pronation detection.
* Combined downward-drift and pronation logic.
* Improved quality control.

## Phase 3: Algorithm Validation

Conduct:

* Clinician review of recorded test examples.
* Threshold calibration.
* Comparison against clinician ratings.
* Inter-rater reliability analysis.
* Sensitivity and specificity analysis.
* Device and demographic subgroup evaluation.

## Phase 4: Research or Clinical Pilot

Add only after appropriate governance:

* Consent workflow.
* Secure assessment storage.
* Clinician dashboard.
* Research export.
* Model-version tracking.
* Audit trail.
* Formal usability testing.
* Clinical-risk management documentation.

---

# 28. Instructions to Kiro

Use a specification-driven development workflow.

Create:

1. A requirements document.
2. A technical design document.
3. A sequenced implementation plan.
4. User stories with acceptance criteria.
5. Frontend component architecture.
6. Computer-vision processing architecture.
7. Typed data models.
8. Configurable detection thresholds.
9. Unit tests.
10. Integration tests.
11. End-to-end browser tests.
12. Accessibility tests.
13. Privacy and security documentation.
14. A README with installation and local-run instructions.

Use TypeScript strict mode.

Prioritise:

* Privacy.
* Local camera processing.
* Clear failure handling.
* Mobile performance.
* Accessibility.
* Maintainable modular code.
* Experimental-threshold configuration.
* Separation between measured observations and medical interpretation.

Do not describe the application as diagnosing neurological disease.

Where a clinical detection threshold has not been supplied, create a configurable placeholder, document the assumption, and mark it as requiring validation. Do not invent a clinically validated threshold.

Begin by generating the requirements, design, and implementation task documents before generating production code.