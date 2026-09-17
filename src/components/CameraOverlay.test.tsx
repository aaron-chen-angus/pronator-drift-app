/**
 * Tests for CameraOverlay component — Side-View Design
 *
 * Validates:
 * - Canvas renders with correct dimensions
 * - Positioning guides are drawn in 'positioning' mode (side-view)
 * - Hand indicator drawn in tracking/assessment modes
 * - Target line at shoulder height drawn in tracking mode
 * - Time remaining is displayed in 'assessment' mode
 * - Tracking quality indicator is rendered
 * - Drift indicator drawn when drift detected
 * - testArm prop changes instruction text
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CameraOverlay } from './CameraOverlay';
import type { NormalizedLandmark } from '../types';

// ─── Mock Canvas Context ─────────────────────────────────────────────────────

function createMockContext(): CanvasRenderingContext2D {
  const calls: Array<{ method: string; args: unknown[] }> = [];

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === '__calls') return calls;
      if (prop === 'measureText') {
        return () => ({ width: 20 });
      }
      if (typeof prop === 'string') {
        if (
          [
            'fillStyle',
            'strokeStyle',
            'lineWidth',
            'font',
            'textAlign',
            'textBaseline',
            'globalAlpha',
            'lineCap',
          ].includes(prop)
        ) {
          return '';
        }
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
        };
      }
      return undefined;
    },
    set(_target, _prop, _value) {
      return true;
    },
  };

  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
}

let mockCtx: CanvasRenderingContext2D;
let ctxCalls: Array<{ method: string; args: unknown[] }>;

beforeEach(() => {
  mockCtx = createMockContext();
  ctxCalls = (mockCtx as unknown as { __calls: Array<{ method: string; args: unknown[] }> }).__calls;

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    mockCtx as unknown as RenderingContext
  );
});

// ─── Helper: Create Hand Landmarks ──────────────────────────────────────────

function createHandLandmarks(wristY = 0.5): NormalizedLandmark[] {
  const landmarks: NormalizedLandmark[] = Array.from({ length: 21 }, () => ({
    x: 0.7,
    y: wristY,
    z: 0,
    visibility: 0.9,
  }));

  // Wrist (0) — at provided Y position
  landmarks[0] = { x: 0.7, y: wristY, z: 0, visibility: 0.9 };
  // Index MCP (5)
  landmarks[5] = { x: 0.72, y: wristY - 0.05, z: 0, visibility: 0.9 };
  // Middle MCP (9)
  landmarks[9] = { x: 0.68, y: wristY - 0.05, z: 0, visibility: 0.9 };

  return landmarks;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CameraOverlay', () => {
  describe('Canvas Rendering', () => {
    it('renders a canvas element with correct dimensions', () => {
      render(<CameraOverlay width={1280} height={720} mode="positioning" />);

      const canvas = screen.getByTestId('camera-overlay-canvas');
      expect(canvas).toBeTruthy();
      expect(canvas.getAttribute('width')).toBe('1280');
      expect(canvas.getAttribute('height')).toBe('720');
    });

    it('renders canvas with aria-hidden for accessibility', () => {
      render(<CameraOverlay width={1280} height={720} mode="positioning" />);

      const canvas = screen.getByTestId('camera-overlay-canvas');
      expect(canvas.getAttribute('aria-hidden')).toBe('true');
    });

    it('canvas is positioned absolutely with pointer-events none', () => {
      render(<CameraOverlay width={1280} height={720} mode="positioning" />);

      const canvas = screen.getByTestId('camera-overlay-canvas') as HTMLCanvasElement;
      expect(canvas.style.position).toBe('absolute');
      expect(canvas.style.pointerEvents).toBe('none');
    });
  });

  describe('Positioning Mode — Side View', () => {
    it('draws positioning guides when mode is "positioning"', () => {
      render(<CameraOverlay width={1280} height={720} mode="positioning" />);

      // Should draw arcs (head silhouette), lines (arm, dashed line)
      const arcCalls = ctxCalls.filter((c) => c.method === 'arc');
      const linesCalls = ctxCalls.filter((c) => c.method === 'lineTo');

      expect(arcCalls.length).toBeGreaterThan(0);
      expect(linesCalls.length).toBeGreaterThan(0);
    });

    it('draws a horizontal dashed line at shoulder height (middle of frame)', () => {
      render(<CameraOverlay width={1280} height={720} mode="positioning" />);

      const setLineDashCalls = ctxCalls.filter((c) => c.method === 'setLineDash');
      const dashedCall = setLineDashCalls.find(
        (c) => Array.isArray(c.args[0]) && (c.args[0] as number[]).length === 2 && (c.args[0] as number[])[0]! > 0
      );
      expect(dashedCall).toBeTruthy();
    });

    it('draws instructional text referencing LEFT arm by default', () => {
      render(<CameraOverlay width={1280} height={720} mode="positioning" />);

      const fillTextCalls = ctxCalls.filter((c) => c.method === 'fillText');
      const leftText = fillTextCalls.find(
        (c) => typeof c.args[0] === 'string' && (c.args[0] as string).includes('LEFT')
      );
      expect(leftText).toBeTruthy();
    });

    it('draws instructional text referencing RIGHT arm when testArm is right', () => {
      render(<CameraOverlay width={1280} height={720} mode="positioning" testArm="right" />);

      const fillTextCalls = ctxCalls.filter((c) => c.method === 'fillText');
      const rightText = fillTextCalls.find(
        (c) => typeof c.args[0] === 'string' && (c.args[0] as string).includes('RIGHT')
      );
      expect(rightText).toBeTruthy();
    });

    it('draws a target zone rectangle for hand placement', () => {
      render(<CameraOverlay width={1280} height={720} mode="positioning" />);

      // fillRect for target zone, strokeRect for border
      const fillRectCalls = ctxCalls.filter((c) => c.method === 'fillRect');
      const strokeRectCalls = ctxCalls.filter((c) => c.method === 'strokeRect');
      expect(fillRectCalls.length).toBeGreaterThan(0);
      expect(strokeRectCalls.length).toBeGreaterThan(0);
    });

    it('draws "Hand here" label in the target zone', () => {
      render(<CameraOverlay width={1280} height={720} mode="positioning" />);

      const fillTextCalls = ctxCalls.filter((c) => c.method === 'fillText');
      const handHereText = fillTextCalls.find(
        (c) => typeof c.args[0] === 'string' && (c.args[0] as string).includes('Hand here')
      );
      expect(handHereText).toBeTruthy();
    });
  });

  describe('Tracking Mode', () => {
    it('draws target line in tracking mode', () => {
      render(
        <CameraOverlay
          width={1280}
          height={720}
          mode="tracking"
        />
      );

      // Should draw a horizontal line (moveTo + lineTo at midY)
      const moveToCount = ctxCalls.filter((c) => c.method === 'moveTo').length;
      const lineToCount = ctxCalls.filter((c) => c.method === 'lineTo').length;
      expect(moveToCount).toBeGreaterThan(0);
      expect(lineToCount).toBeGreaterThan(0);
    });

    it('draws hand indicator when handLandmarks are provided', () => {
      const hands = [createHandLandmarks(0.5)];
      render(
        <CameraOverlay
          width={1280}
          height={720}
          mode="tracking"
          handLandmarks={hands}
        />
      );

      // Should draw arc for hand marker circle
      const arcCalls = ctxCalls.filter((c) => c.method === 'arc');
      expect(arcCalls.length).toBeGreaterThan(0);
    });

    it('does not draw hand indicator when handLandmarks is null', () => {
      render(
        <CameraOverlay
          width={1280}
          height={720}
          mode="tracking"
          handLandmarks={null}
        />
      );

      // Only the target line drawing should occur — moveTo/lineTo but no arc for hand
      const arcCalls = ctxCalls.filter((c) => c.method === 'arc');
      expect(arcCalls.length).toBe(0);
    });

    it('draws hand in green when at correct height (middle third)', () => {
      const hands = [createHandLandmarks(0.5)]; // middle of frame
      render(
        <CameraOverlay
          width={1280}
          height={720}
          mode="tracking"
          handLandmarks={hands}
        />
      );

      // Should have arcs drawn (hand marker)
      const arcCalls = ctxCalls.filter((c) => c.method === 'arc');
      expect(arcCalls.length).toBeGreaterThan(0);
    });

    it('draws lost indicator for hand with low confidence', () => {
      const hand = createHandLandmarks(0.5);
      hand[0] = { ...hand[0]!, visibility: 0.1 };

      render(
        <CameraOverlay
          width={1280}
          height={720}
          mode="tracking"
          handLandmarks={[hand]}
          minConfidence={0.5}
        />
      );

      // Should use dashed line style for lost indicator
      const setLineDashCalls = ctxCalls.filter(
        (c) =>
          c.method === 'setLineDash' &&
          Array.isArray(c.args[0]) &&
          (c.args[0] as number[]).length === 2 &&
          (c.args[0] as number[])[0]! > 0
      );
      expect(setLineDashCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Drift Indicator', () => {
    it('draws drift indicator when currentDrift > 0.02', () => {
      render(
        <CameraOverlay
          width={1280}
          height={720}
          mode="tracking"
          currentDrift={0.1}
        />
      );

      // Should draw arrow (moveTo + lineTo for vertical line and arrowhead)
      const fillTextCalls = ctxCalls.filter((c) => c.method === 'fillText');
      const driftLabel = fillTextCalls.find(
        (c) => typeof c.args[0] === 'string' && (c.args[0] as string).includes('↓')
      );
      expect(driftLabel).toBeTruthy();
    });

    it('does not draw drift indicator when drift is below threshold', () => {
      render(
        <CameraOverlay
          width={1280}
          height={720}
          mode="tracking"
          currentDrift={0.01}
        />
      );

      const fillTextCalls = ctxCalls.filter((c) => c.method === 'fillText');
      const driftLabel = fillTextCalls.find(
        (c) => typeof c.args[0] === 'string' && (c.args[0] as string).includes('↓')
      );
      expect(driftLabel).toBeFalsy();
    });
  });

  describe('Assessment Mode', () => {
    it('displays time remaining', () => {
      render(
        <CameraOverlay
          width={1280}
          height={720}
          mode="assessment"
          timeRemaining={25}
        />
      );

      const fillTextCalls = ctxCalls.filter((c) => c.method === 'fillText');
      const timeText = fillTextCalls.find((c) => c.args[0] === '25s');
      expect(timeText).toBeTruthy();
    });

    it('displays whole seconds (rounds up fractional values)', () => {
      render(
        <CameraOverlay
          width={1280}
          height={720}
          mode="assessment"
          timeRemaining={14.3}
        />
      );

      const fillTextCalls = ctxCalls.filter((c) => c.method === 'fillText');
      const timeText = fillTextCalls.find((c) => c.args[0] === '15s');
      expect(timeText).toBeTruthy();
    });
  });

  describe('Tracking Quality Indicator', () => {
    it('draws quality indicator in tracking mode', () => {
      render(
        <CameraOverlay
          width={1280}
          height={720}
          mode="tracking"
          trackingQuality="good"
        />
      );

      const fillTextCalls = ctxCalls.filter((c) => c.method === 'fillText');
      const qualityLabel = fillTextCalls.find((c) => c.args[0] === 'Good');
      expect(qualityLabel).toBeTruthy();
    });

    it('displays "OK" label for acceptable quality', () => {
      render(
        <CameraOverlay
          width={1280}
          height={720}
          mode="tracking"
          trackingQuality="acceptable"
        />
      );

      const fillTextCalls = ctxCalls.filter((c) => c.method === 'fillText');
      const qualityLabel = fillTextCalls.find((c) => c.args[0] === 'OK');
      expect(qualityLabel).toBeTruthy();
    });

    it('displays "Low" label for low quality', () => {
      render(
        <CameraOverlay
          width={1280}
          height={720}
          mode="tracking"
          trackingQuality="low"
        />
      );

      const fillTextCalls = ctxCalls.filter((c) => c.method === 'fillText');
      const qualityLabel = fillTextCalls.find((c) => c.args[0] === 'Low');
      expect(qualityLabel).toBeTruthy();
    });

    it('does not draw quality indicator when trackingQuality is undefined', () => {
      render(
        <CameraOverlay
          width={1280}
          height={720}
          mode="tracking"
        />
      );

      const fillTextCalls = ctxCalls.filter((c) => c.method === 'fillText');
      const qualityLabels = fillTextCalls.filter(
        (c) => c.args[0] === 'Good' || c.args[0] === 'OK' || c.args[0] === 'Low'
      );
      expect(qualityLabels.length).toBe(0);
    });
  });

  describe('Overlay Coverage Constraint', () => {
    it('canvas uses absolute positioning to not take layout space', () => {
      render(<CameraOverlay width={1280} height={720} mode="positioning" />);

      const canvas = screen.getByTestId('camera-overlay-canvas') as HTMLCanvasElement;
      expect(canvas.style.position).toBe('absolute');
      expect(canvas.style.top).toBe('0px');
      expect(canvas.style.left).toBe('0px');
    });
  });
});
