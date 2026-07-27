/**
 * Tests for useOrientationEnforcement hook
 *
 * Validates:
 * - Landscape detection via matchMedia
 * - ORIENTATION_CHANGED dispatch during active assessment
 * - No dispatch when assessment is not active
 * - Blocking state (isLandscape) for UI progression
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOrientationEnforcement } from './useOrientationEnforcement';
import type { AppEvent } from '../types/index';

// ─── Test Helpers ────────────────────────────────────────────────────────────

type MediaQueryListener = (e: MediaQueryListEvent) => void;

function createMockMatchMedia(initialLandscape: boolean) {
  let currentMatches = initialLandscape;
  const listeners: MediaQueryListener[] = [];

  const mql = {
    matches: currentMatches,
    media: '(orientation: landscape)',
    addEventListener: (type: string, listener: MediaQueryListener) => {
      if (type === 'change') {
        listeners.push(listener);
      }
    },
    removeEventListener: (type: string, listener: MediaQueryListener) => {
      if (type === 'change') {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      }
    },
    dispatchEvent: () => true,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
  };

  const trigger = (landscape: boolean) => {
    currentMatches = landscape;
    mql.matches = landscape;
    for (const listener of listeners) {
      listener({ matches: landscape } as MediaQueryListEvent);
    }
  };

  return { mql, trigger, getListenerCount: () => listeners.length };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useOrientationEnforcement', () => {
  let mockMatchMedia: ReturnType<typeof createMockMatchMedia>;
  let originalMatchMedia: typeof window.matchMedia;
  let screenOrientationListeners: ((e: Event) => void)[];

  beforeEach(() => {
    mockMatchMedia = createMockMatchMedia(false); // Start in portrait
    originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue(mockMatchMedia.mql);
    screenOrientationListeners = [];

    // Mock screen.orientation
    Object.defineProperty(window.screen, 'orientation', {
      value: {
        type: 'portrait-primary',
        addEventListener: (_type: string, listener: (e: Event) => void) => {
          screenOrientationListeners.push(listener);
        },
        removeEventListener: (_type: string, listener: (e: Event) => void) => {
          const idx = screenOrientationListeners.indexOf(listener);
          if (idx >= 0) screenOrientationListeners.splice(idx, 1);
        },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it('reports portrait (isLandscape=false) when matchMedia says portrait', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useOrientationEnforcement(dispatch));

    expect(result.current.isLandscape).toBe(false);
  });

  it('reports landscape (isLandscape=true) when matchMedia says landscape', () => {
    mockMatchMedia = createMockMatchMedia(true); // Start in landscape
    window.matchMedia = vi.fn().mockReturnValue(mockMatchMedia.mql);

    // Mock screen.orientation to landscape
    Object.defineProperty(window.screen, 'orientation', {
      value: {
        type: 'landscape-primary',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      writable: true,
      configurable: true,
    });

    const dispatch = vi.fn();
    const { result } = renderHook(() => useOrientationEnforcement(dispatch));

    expect(result.current.isLandscape).toBe(true);
  });

  it('updates isLandscape when orientation changes', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useOrientationEnforcement(dispatch));

    expect(result.current.isLandscape).toBe(false);

    act(() => {
      mockMatchMedia.trigger(true);
    });

    expect(result.current.isLandscape).toBe(true);

    act(() => {
      mockMatchMedia.trigger(false);
    });

    expect(result.current.isLandscape).toBe(false);
  });

  it('dispatches ORIENTATION_CHANGED when landscape detected during active assessment', () => {
    const dispatch = vi.fn<(event: AppEvent) => void>();
    const { result } = renderHook(() => useOrientationEnforcement(dispatch));

    // Set assessment as active
    act(() => {
      result.current.setAssessmentActive(true);
    });

    // Trigger landscape
    act(() => {
      mockMatchMedia.trigger(true);
    });

    expect(dispatch).toHaveBeenCalledWith({ type: 'ORIENTATION_CHANGED' });
  });

  it('does NOT dispatch ORIENTATION_CHANGED when landscape detected outside assessment', () => {
    const dispatch = vi.fn<(event: AppEvent) => void>();
    const { result } = renderHook(() => useOrientationEnforcement(dispatch));

    // Assessment is not active (default)
    expect(result.current.isAssessmentActive).toBe(false);

    // Trigger landscape
    act(() => {
      mockMatchMedia.trigger(true);
    });

    // Should NOT dispatch - just set isLandscape for blocking
    expect(dispatch).not.toHaveBeenCalled();
    expect(result.current.isLandscape).toBe(true);
  });

  it('provides setAssessmentActive to toggle assessment state', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useOrientationEnforcement(dispatch));

    expect(result.current.isAssessmentActive).toBe(false);

    act(() => {
      result.current.setAssessmentActive(true);
    });

    expect(result.current.isAssessmentActive).toBe(true);

    act(() => {
      result.current.setAssessmentActive(false);
    });

    expect(result.current.isAssessmentActive).toBe(false);
  });

  it('cleans up listeners on unmount', () => {
    const dispatch = vi.fn();
    const { unmount } = renderHook(() => useOrientationEnforcement(dispatch));

    unmount();

    // After unmount, triggering orientation change should have no effect
    // (no errors thrown from stale listeners)
    act(() => {
      mockMatchMedia.trigger(true);
    });
  });
});
