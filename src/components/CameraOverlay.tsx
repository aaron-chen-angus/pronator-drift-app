/**
 * CameraOverlay Component — Side-View Design
 *
 * Canvas-based overlay for the SIDE VIEW one-arm-at-a-time pronator drift test.
 * The camera captures a profile view of one extended arm. This overlay draws:
 *   - Positioning guides (silhouette, shoulder-height line, target zone)
 *   - The detected POSE skeleton (shoulders → elbows → wrists)
 *   - The full 21-point HAND landmark skeleton (including every finger joint)
 *   - Drift indicator and countdown timer
 *
 * Coordinate mapping:
 *   MediaPipe returns normalized (0..1) landmarks in the *video frame* space.
 *   The <video> element is displayed with a CSS object-fit. To keep the drawn
 *   markers aligned with what the user sees, this component maps normalized
 *   coordinates into the displayed canvas box using the same fit math.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import type { NormalizedLandmark } from '../types';

export type TestArm = 'left' | 'right';

export interface CameraOverlayProps {
  /** Displayed width of the overlay canvas in CSS pixels */
  width: number;
  /** Displayed height of the overlay canvas in CSS pixels */
  height: number;
  /** Native video frame width (pixels). Used for object-fit mapping. */
  videoWidth?: number;
  /** Native video frame height (pixels). Used for object-fit mapping. */
  videoHeight?: number;
  /** How the underlying <video> is fitted into the box (default 'contain'). */
  objectFit?: 'contain' | 'cover';
  /** Whether the video is mirrored (front camera selfie view). */
  mirrored?: boolean;
  /** Current overlay mode */
  mode: 'positioning' | 'tracking' | 'assessment';
  /** Which arm is being tested (affects side/instruction text) */
  testArm?: TestArm;
  /** Up to 2 hands, each with 21 landmarks */
  handLandmarks?: NormalizedLandmark[][] | null;
  /** Pose landmarks (33 per person, MediaPipe Pose) */
  poseLandmarks?: NormalizedLandmark[][] | null;
  /** Current tracking quality level */
  trackingQuality?: 'good' | 'acceptable' | 'low';
  /** Seconds remaining during assessment */
  timeRemaining?: number;
  /** Confidence threshold below which landmarks are shown as lost */
  minConfidence?: number;
  /** Current drift amount (normalized, 0=no drift, positive=downward) */
  currentDrift?: number;
}

// ─── Colors ──────────────────────────────────────────────────────────────────

const COLORS = {
  guideDash: 'rgba(0, 229, 255, 0.7)',
  targetZone: 'rgba(0, 255, 136, 0.15)',
  targetBorder: 'rgba(0, 255, 136, 0.7)',
  handPoint: 'rgba(0, 255, 136, 0.95)',
  handBone: 'rgba(0, 255, 136, 0.75)',
  handLost: 'rgba(255, 100, 100, 0.6)',
  poseBone: 'rgba(0, 200, 255, 0.85)',
  posePoint: 'rgba(255, 255, 255, 0.95)',
  timerText: 'rgba(255, 255, 255, 0.95)',
  timerShadow: 'rgba(0, 0, 0, 0.6)',
  qualityGood: '#00e676',
  qualityAcceptable: '#ffca28',
  qualityLow: '#ff9100',
  silhouette: 'rgba(255, 255, 255, 0.12)',
  driftWarning: 'rgba(255, 170, 0, 0.85)',
  instructionText: 'rgba(255, 255, 255, 0.9)',
  subtitleText: 'rgba(255, 255, 255, 0.6)',
} as const;

const QUALITY_LABELS: Record<'good' | 'acceptable' | 'low', string> = {
  good: 'Good',
  acceptable: 'OK',
  low: 'Low',
};

// ─── Landmark connection maps ──────────────────────────────────────────────

/** MediaPipe Hand connections (21 landmarks): palm + 5 fingers. */
const HAND_CONNECTIONS: ReadonlyArray<[number, number]> = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle
  [5, 9], [9, 10], [10, 11], [11, 12],
  // Ring
  [9, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/** Pose landmark indices we care about for the arm skeleton. */
const POSE = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
} as const;

/** Upper-body pose connections drawn as the skeleton trace. */
const POSE_CONNECTIONS: ReadonlyArray<[number, number]> = [
  [POSE.leftShoulder, POSE.rightShoulder],
  [POSE.leftShoulder, POSE.leftElbow],
  [POSE.leftElbow, POSE.leftWrist],
  [POSE.rightShoulder, POSE.rightElbow],
  [POSE.rightElbow, POSE.rightWrist],
];

// ─── Coordinate mapping ──────────────────────────────────────────────────────

interface FitTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  drawW: number;
  drawH: number;
}

/**
 * Compute how the native video frame is placed inside the displayed box for a
 * given object-fit, so normalized landmarks map onto exactly what's visible.
 */
function computeFit(
  boxW: number,
  boxH: number,
  vidW: number,
  vidH: number,
  fit: 'contain' | 'cover'
): FitTransform {
  if (vidW <= 0 || vidH <= 0) {
    return { scale: 1, offsetX: 0, offsetY: 0, drawW: boxW, drawH: boxH };
  }
  const scaleContain = Math.min(boxW / vidW, boxH / vidH);
  const scaleCover = Math.max(boxW / vidW, boxH / vidH);
  const scale = fit === 'cover' ? scaleCover : scaleContain;
  const drawW = vidW * scale;
  const drawH = vidH * scale;
  return {
    scale,
    drawW,
    drawH,
    offsetX: (boxW - drawW) / 2,
    offsetY: (boxH - drawH) / 2,
  };
}

/** Map a normalized landmark to canvas pixel coordinates. */
function toCanvas(
  lm: { x: number; y: number },
  t: FitTransform,
  mirrored: boolean,
  boxW: number
): { x: number; y: number } {
  const x = t.offsetX + lm.x * t.drawW;
  const y = t.offsetY + lm.y * t.drawH;
  return { x: mirrored ? boxW - x : x, y };
}

/**
 * Canvas overlay component for the side-view pronator drift test.
 */
export const CameraOverlay: React.FC<CameraOverlayProps> = ({
  width,
  height,
  videoWidth = 0,
  videoHeight = 0,
  objectFit = 'contain',
  mirrored = false,
  mode,
  testArm = 'left',
  handLandmarks,
  poseLandmarks,
  trackingQuality,
  timeRemaining,
  minConfidence = 0.5,
  currentDrift,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const fit = computeFit(width, height, videoWidth, videoHeight, objectFit);

    if (mode === 'positioning') {
      drawSideViewPositioningGuide(ctx, width, height, testArm);
    } else {
      drawTargetLine(ctx, width, height);
    }

    // Draw the pose skeleton (shoulders → elbows → wrists) — the "trace".
    if (poseLandmarks && poseLandmarks.length > 0) {
      drawPoseSkeleton(ctx, poseLandmarks[0]!, fit, mirrored, width, minConfidence);
    }

    // Draw full hand skeleton (all 21 points incl. fingers).
    if (handLandmarks && handLandmarks.length > 0) {
      drawHandSkeletons(ctx, handLandmarks, fit, mirrored, width, minConfidence);
    }

    if ((mode === 'tracking' || mode === 'assessment') &&
        currentDrift !== undefined && currentDrift > 0.02) {
      drawDriftIndicator(ctx, width, height, currentDrift);
    }

    if (mode === 'assessment' && timeRemaining !== undefined) {
      drawTimeRemaining(ctx, width, height, timeRemaining);
    }

    if ((mode === 'tracking' || mode === 'assessment') && trackingQuality !== undefined) {
      drawQualityIndicator(ctx, width, height, trackingQuality);
    }
  }, [width, height, videoWidth, videoHeight, objectFit, mirrored, mode, testArm,
      handLandmarks, poseLandmarks, trackingQuality, timeRemaining, minConfidence, currentDrift]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      data-testid="camera-overlay-canvas"
      aria-hidden="true"
      style={canvasStyles}
    />
  );
};

// ─── Skeleton drawing ────────────────────────────────────────────────────────

/**
 * Draw the upper-body pose skeleton with joint markers at shoulders, elbows
 * and wrists. This is the visible "trace" of the arm during the test.
 */
function drawPoseSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  fit: FitTransform,
  mirrored: boolean,
  boxW: number,
  minConfidence: number
): void {
  if (!landmarks || landmarks.length < 17) return;

  const visible = (i: number) => {
    const lm = landmarks[i];
    return !!lm && (lm.visibility === undefined || lm.visibility >= minConfidence);
  };

  // Bones
  ctx.lineWidth = Math.max(3, boxW * 0.006);
  ctx.lineCap = 'round';
  ctx.strokeStyle = COLORS.poseBone;
  for (const [a, b] of POSE_CONNECTIONS) {
    if (!visible(a) || !visible(b)) continue;
    const pa = toCanvas(landmarks[a]!, fit, mirrored, boxW);
    const pb = toCanvas(landmarks[b]!, fit, mirrored, boxW);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }

  // Joints
  const joints = [
    POSE.leftShoulder, POSE.rightShoulder,
    POSE.leftElbow, POSE.rightElbow,
    POSE.leftWrist, POSE.rightWrist,
  ];
  const r = Math.max(5, boxW * 0.009);
  for (const i of joints) {
    if (!visible(i)) continue;
    const p = toCanvas(landmarks[i]!, fit, mirrored, boxW);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.posePoint;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.poseBone;
    ctx.stroke();
  }
}

/**
 * Draw all detected hands with their full 21-point skeleton, including every
 * finger joint and the connecting bones.
 */
function drawHandSkeletons(
  ctx: CanvasRenderingContext2D,
  hands: NormalizedLandmark[][],
  fit: FitTransform,
  mirrored: boolean,
  boxW: number,
  minConfidence: number
): void {
  for (const hand of hands) {
    if (!hand || hand.length < 21) continue;

    const wrist = hand[0];
    const lost = !!wrist && wrist.visibility !== undefined && wrist.visibility < minConfidence;
    const pointColor = lost ? COLORS.handLost : COLORS.handPoint;
    const boneColor = lost ? COLORS.handLost : COLORS.handBone;

    // Bones (fingers + palm)
    ctx.lineWidth = Math.max(2, boxW * 0.004);
    ctx.lineCap = 'round';
    ctx.strokeStyle = boneColor;
    for (const [a, b] of HAND_CONNECTIONS) {
      const la = hand[a];
      const lb = hand[b];
      if (!la || !lb) continue;
      const pa = toCanvas(la, fit, mirrored, boxW);
      const pb = toCanvas(lb, fit, mirrored, boxW);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    // Landmark points (fingertips slightly larger)
    for (let i = 0; i < hand.length; i++) {
      const lm = hand[i]!;
      const p = toCanvas(lm, fit, mirrored, boxW);
      const isTip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
      const isWrist = i === 0;
      const radius = isWrist
        ? Math.max(6, boxW * 0.011)
        : isTip
          ? Math.max(4, boxW * 0.007)
          : Math.max(3, boxW * 0.005);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = pointColor;
      ctx.fill();
    }
  }
}

// ─── Positioning guide ───────────────────────────────────────────────────────

function drawSideViewPositioningGuide(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  testArm: TestArm
): void {
  const midY = h * 0.5;

  // A single shoulder-height reference line. No silhouette or "hand here" box —
  // the live pose skeleton (drawn separately) is the real guide.
  ctx.beginPath();
  ctx.setLineDash([12, 8]);
  ctx.moveTo(0, midY);
  ctx.lineTo(w, midY);
  ctx.strokeStyle = COLORS.guideDash;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = COLORS.subtitleText;
  ctx.font = `${Math.max(11, w * 0.02)}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('shoulder height', 8, midY - 12);

  ctx.fillStyle = COLORS.instructionText;
  ctx.font = `bold ${Math.max(14, w * 0.03)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('Face the camera with both arms raised', w / 2, h * 0.04);

  ctx.fillStyle = COLORS.subtitleText;
  ctx.font = `${Math.max(12, w * 0.022)}px sans-serif`;
  ctx.fillText(
    'Hold both arms out in front at shoulder height, palms up',
    w / 2,
    h * 0.04 + Math.max(14, w * 0.03) + 6
  );

  ctx.fillStyle = COLORS.subtitleText;
  ctx.font = `${Math.max(11, w * 0.02)}px sans-serif`;
  ctx.textBaseline = 'bottom';
  ctx.fillText('Make sure your shoulder is in view — the test starts automatically', w / 2, h * 0.95);
}

function drawTargetLine(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const midY = h * 0.5;
  ctx.beginPath();
  ctx.setLineDash([8, 6]);
  ctx.moveTo(0, midY);
  ctx.lineTo(w, midY);
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.3)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawDriftIndicator(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  drift: number
): void {
  const x = w * 0.05;
  const midY = h * 0.5;
  const driftPixels = drift * h;
  const arrowEndY = midY + Math.min(driftPixels, h * 0.3);

  ctx.beginPath();
  ctx.moveTo(x, midY);
  ctx.lineTo(x, arrowEndY);
  ctx.strokeStyle = COLORS.driftWarning;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, arrowEndY);
  ctx.lineTo(x - 5, arrowEndY - 8);
  ctx.lineTo(x + 5, arrowEndY - 8);
  ctx.closePath();
  ctx.fillStyle = COLORS.driftWarning;
  ctx.fill();

  const driftPercent = Math.round(drift * 100);
  ctx.fillStyle = COLORS.driftWarning;
  ctx.font = `bold ${Math.max(11, w * 0.02)}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`↓ ${driftPercent}%`, x + 10, (midY + arrowEndY) / 2);
}

function drawTimeRemaining(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seconds: number
): void {
  const displaySeconds = Math.ceil(seconds);
  const text = `${displaySeconds}s`;
  const fontSize = Math.max(28, Math.min(w * 0.08, 52));
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const x = w * 0.03;
  const y = h * 0.04;
  ctx.fillStyle = COLORS.timerShadow;
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = COLORS.timerText;
  ctx.fillText(text, x, y);
}

function drawQualityIndicator(
  ctx: CanvasRenderingContext2D,
  w: number,
  _h: number,
  quality: 'good' | 'acceptable' | 'low'
): void {
  const colorMap = {
    good: COLORS.qualityGood,
    acceptable: COLORS.qualityAcceptable,
    low: COLORS.qualityLow,
  };
  const color = colorMap[quality];
  const label = QUALITY_LABELS[quality];
  const dotRadius = 5;
  const padding = 12;
  const x = w - padding;
  const y = padding + dotRadius;
  ctx.beginPath();
  ctx.arc(x - dotRadius, y, dotRadius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(label, x - dotRadius * 2 - 6, y);
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const canvasStyles: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
};

export default CameraOverlay;
