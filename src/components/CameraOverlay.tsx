/**
 * CameraOverlay Component
 *
 * Canvas-based overlay that renders positioning guides, pose skeleton,
 * hand orientation indicators, tracking quality, and remaining time
 * on top of the camera feed.
 *
 * Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6, 23.7
 */

import React, { useRef, useEffect, useCallback } from 'react';
import type { NormalizedLandmark } from '../types';

export interface CameraOverlayProps {
  /** Width of the overlay canvas in pixels */
  width: number;
  /** Height of the overlay canvas in pixels */
  height: number;
  /** Current overlay mode */
  mode: 'positioning' | 'tracking' | 'assessment';
  /** Single person's pose landmarks (33 MediaPipe pose landmarks) */
  poseLandmarks?: NormalizedLandmark[] | null;
  /** Up to 2 hands, each with 21 landmarks */
  handLandmarks?: NormalizedLandmark[][] | null;
  /** Current tracking quality level */
  trackingQuality?: 'good' | 'acceptable' | 'low';
  /** Seconds remaining during assessment */
  timeRemaining?: number;
  /** Confidence threshold below which landmarks are shown as lost */
  minConfidence?: number;
}

// ─── MediaPipe Pose Landmark Indices ─────────────────────────────────────────

const POSE = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
} as const;

// ─── Colors ──────────────────────────────────────────────────────────────────

const COLORS = {
  guide: 'rgba(0, 229, 255, 0.4)',
  guideFill: 'rgba(0, 229, 255, 0.06)',
  skeleton: 'rgba(0, 229, 255, 0.85)',
  skeletonJoint: 'rgba(0, 229, 255, 1.0)',
  palmUp: 'rgba(0, 255, 136, 0.8)',
  palmNotUp: 'rgba(255, 170, 0, 0.8)',
  lost: 'rgba(255, 100, 100, 0.5)',
  timerText: 'rgba(255, 255, 255, 0.9)',
  timerShadow: 'rgba(0, 0, 0, 0.6)',
  qualityGood: '#00e676',
  qualityAcceptable: '#ffca28',
  qualityLow: '#ff9100',
} as const;

// ─── Quality Indicator Labels ────────────────────────────────────────────────

const QUALITY_LABELS: Record<'good' | 'acceptable' | 'low', string> = {
  good: 'Good',
  acceptable: 'OK',
  low: 'Low',
};

// ─── Skeleton Connections ────────────────────────────────────────────────────

const SKELETON_CONNECTIONS: [number, number][] = [
  [POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER],
  [POSE.LEFT_SHOULDER, POSE.LEFT_ELBOW],
  [POSE.LEFT_ELBOW, POSE.LEFT_WRIST],
  [POSE.RIGHT_SHOULDER, POSE.RIGHT_ELBOW],
  [POSE.RIGHT_ELBOW, POSE.RIGHT_WRIST],
  [POSE.LEFT_SHOULDER, POSE.LEFT_HIP],
  [POSE.RIGHT_SHOULDER, POSE.RIGHT_HIP],
  [POSE.LEFT_HIP, POSE.RIGHT_HIP],
];

/**
 * Canvas overlay component for tracking visualization on the camera feed.
 *
 * Draws positioning guides in 'positioning' mode, full pose skeleton in
 * 'tracking' mode, and minimal skeleton + timer in 'assessment' mode.
 * All overlay elements use semi-transparent rendering to ensure the camera
 * feed remains visible (≤30% area coverage).
 */
export const CameraOverlay: React.FC<CameraOverlayProps> = ({
  width,
  height,
  mode,
  poseLandmarks,
  handLandmarks,
  trackingQuality,
  timeRemaining,
  minConfidence = 0.5,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    if (mode === 'positioning') {
      drawPositioningGuides(ctx, width, height);
    }

    if (mode === 'tracking' || mode === 'assessment') {
      if (poseLandmarks && poseLandmarks.length > 0) {
        drawPoseSkeleton(ctx, width, height, poseLandmarks, minConfidence, mode);
      }
      if (handLandmarks && handLandmarks.length > 0) {
        drawPalmIndicators(ctx, width, height, handLandmarks, minConfidence);
      }
    }

    if (mode === 'assessment' && timeRemaining !== undefined) {
      drawTimeRemaining(ctx, width, height, timeRemaining);
    }

    if (
      (mode === 'tracking' || mode === 'assessment') &&
      trackingQuality !== undefined
    ) {
      drawQualityIndicator(ctx, width, height, trackingQuality);
    }
  }, [width, height, mode, poseLandmarks, handLandmarks, trackingQuality, timeRemaining, minConfidence]);

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

// ─── Drawing Functions ───────────────────────────────────────────────────────

/**
 * Draws positioning guide silhouette showing ideal head, shoulders, arms,
 * and hands placement before tracking starts.
 */
function drawPositioningGuides(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number
): void {
  const cx = w / 2;

  ctx.strokeStyle = COLORS.guide;
  ctx.fillStyle = COLORS.guideFill;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);

  // Head circle
  const headRadius = w * 0.06;
  const headY = h * 0.2;
  ctx.beginPath();
  ctx.arc(cx, headY, headRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Shoulder line
  const shoulderY = h * 0.32;
  const shoulderSpan = w * 0.25;
  ctx.beginPath();
  ctx.moveTo(cx - shoulderSpan, shoulderY);
  ctx.lineTo(cx + shoulderSpan, shoulderY);
  ctx.stroke();

  // Left arm outline (shoulder → elbow → wrist → hand)
  const elbowY = h * 0.42;
  const wristY = h * 0.42;
  const armExtension = w * 0.32;

  // Left arm
  ctx.beginPath();
  ctx.moveTo(cx - shoulderSpan, shoulderY);
  ctx.lineTo(cx - armExtension, elbowY);
  ctx.lineTo(cx - armExtension, wristY);
  ctx.stroke();

  // Right arm
  ctx.beginPath();
  ctx.moveTo(cx + shoulderSpan, shoulderY);
  ctx.lineTo(cx + armExtension, elbowY);
  ctx.lineTo(cx + armExtension, wristY);
  ctx.stroke();

  // Hand outlines (palm-up ovals)
  const handWidth = w * 0.04;
  const handHeight = w * 0.06;
  const handY = wristY;

  // Left hand
  ctx.beginPath();
  ctx.ellipse(cx - armExtension, handY + handHeight, handWidth, handHeight, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Right hand
  ctx.beginPath();
  ctx.ellipse(cx + armExtension, handY + handHeight, handWidth, handHeight, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Torso outline
  const hipY = h * 0.55;
  ctx.beginPath();
  ctx.moveTo(cx - shoulderSpan, shoulderY);
  ctx.lineTo(cx - shoulderSpan * 0.8, hipY);
  ctx.lineTo(cx + shoulderSpan * 0.8, hipY);
  ctx.lineTo(cx + shoulderSpan, shoulderY);
  ctx.stroke();

  ctx.setLineDash([]);
}

/**
 * Draws the pose skeleton connecting tracked landmarks.
 * In 'assessment' mode uses thinner lines and reduced opacity to stay ≤30% coverage.
 * Landmarks with confidence below minConfidence are drawn in a "lost" style.
 */
function drawPoseSkeleton(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  landmarks: NormalizedLandmark[],
  minConfidence: number,
  mode: 'tracking' | 'assessment'
): void {
  const lineWidth = mode === 'assessment' ? 1.5 : 2.5;
  const jointRadius = mode === 'assessment' ? 3 : 5;

  // Draw connections
  for (const [startIdx, endIdx] of SKELETON_CONNECTIONS) {
    const start = landmarks[startIdx];
    const end = landmarks[endIdx];
    if (!start || !end) continue;

    const isLost =
      start.visibility < minConfidence || end.visibility < minConfidence;

    ctx.beginPath();
    ctx.moveTo(start.x * w, start.y * h);
    ctx.lineTo(end.x * w, end.y * h);

    if (isLost) {
      ctx.strokeStyle = COLORS.lost;
      ctx.setLineDash([4, 4]);
    } else {
      ctx.strokeStyle = COLORS.skeleton;
      ctx.setLineDash([]);
    }
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  ctx.setLineDash([]);

  // Draw joints
  const jointIndices = [
    POSE.LEFT_SHOULDER,
    POSE.RIGHT_SHOULDER,
    POSE.LEFT_ELBOW,
    POSE.RIGHT_ELBOW,
    POSE.LEFT_WRIST,
    POSE.RIGHT_WRIST,
    POSE.LEFT_HIP,
    POSE.RIGHT_HIP,
  ];

  for (const idx of jointIndices) {
    const lm = landmarks[idx];
    if (!lm) continue;

    const isLost = lm.visibility < minConfidence;

    ctx.beginPath();
    ctx.arc(lm.x * w, lm.y * h, jointRadius, 0, Math.PI * 2);

    if (isLost) {
      ctx.fillStyle = COLORS.lost;
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = COLORS.lost;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.fillStyle = COLORS.skeletonJoint;
    }
    ctx.fill();
  }

  ctx.setLineDash([]);
}

/**
 * Draws palm-up/not-up indicators on detected hand landmarks.
 * Uses wrist (0), index MCP (5), and middle MCP (9) to estimate palm direction.
 */
function drawPalmIndicators(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  hands: NormalizedLandmark[][],
  minConfidence: number
): void {
  for (const hand of hands) {
    if (!hand || hand.length < 21) continue;

    const wrist = hand[0];
    const indexMcp = hand[5];
    const middleMcp = hand[9];

    if (!wrist || !indexMcp || !middleMcp) continue;

    // Skip if key landmarks have low confidence
    if (
      wrist.visibility < minConfidence ||
      indexMcp.visibility < minConfidence ||
      middleMcp.visibility < minConfidence
    ) {
      // Draw lost indicator at wrist position
      const cx = wrist.x * w;
      const cy = wrist.y * h;
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.lost;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }

    // Estimate palm orientation using cross product of two vectors
    // Vector A: wrist → index MCP
    const ax = indexMcp.x - wrist.x;
    const ay = indexMcp.y - wrist.y;
    const az = indexMcp.z - wrist.z;
    // Vector B: wrist → middle MCP
    const bx = middleMcp.x - wrist.x;
    const by = middleMcp.y - wrist.y;
    const bz = middleMcp.z - wrist.z;

    // Cross product gives palm normal
    const normalZ = ax * by - ay * bx;
    // When palm faces up (toward camera in image coords), normalZ is negative
    // in MediaPipe's coordinate system
    const isPalmUp = normalZ < 0;

    // Draw indicator near the palm center
    const palmCx = ((wrist.x + indexMcp.x + middleMcp.x) / 3) * w;
    const palmCy = ((wrist.y + indexMcp.y + middleMcp.y) / 3) * h;
    const indicatorRadius = 10;

    ctx.beginPath();
    ctx.arc(palmCx, palmCy, indicatorRadius, 0, Math.PI * 2);
    ctx.fillStyle = isPalmUp ? COLORS.palmUp : COLORS.palmNotUp;
    ctx.fill();

    // Arrow indicator: up arrow for palm-up, down arrow for not
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isPalmUp ? '↑' : '↓', palmCx, palmCy);
  }
}

/**
 * Draws the remaining time in large text during the assessment phase.
 * Positioned at the top center to minimize camera feed obstruction.
 */
function drawTimeRemaining(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seconds: number
): void {
  const displaySeconds = Math.ceil(seconds);
  const text = `${displaySeconds}`;

  const fontSize = Math.max(32, Math.min(w * 0.12, 64));
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const x = w / 2;
  const y = h * 0.04;

  // Shadow for readability
  ctx.fillStyle = COLORS.timerShadow;
  ctx.fillText(text, x + 2, y + 2);

  // Main text
  ctx.fillStyle = COLORS.timerText;
  ctx.fillText(text, x, y);

  // Label
  ctx.font = `${Math.max(12, fontSize * 0.35)}px sans-serif`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.fillText('seconds remaining', x, y + fontSize + 4);
}

/**
 * Draws a tracking quality indicator badge in the top-right corner.
 * Uses colored dots and a text label to communicate quality level
 * without relying on color alone (per accessibility requirements).
 */
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

  // Draw colored dot
  ctx.beginPath();
  ctx.arc(x - dotRadius, y, dotRadius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Draw text label
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(label, x - dotRadius * 2 - 6, y);

  // Draw three dots representing discrete levels
  const dotsX = x - dotRadius * 2 - 6 - ctx.measureText(label).width - 12;
  const dotsSpacing = 10;
  const levels = ['good', 'acceptable', 'low'] as const;
  const activeIndex = levels.indexOf(quality);

  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(dotsX - i * dotsSpacing, y, 3, 0, Math.PI * 2);
    if (i <= activeIndex) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const canvasStyles: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  pointerEvents: 'none',
};

export default CameraOverlay;
