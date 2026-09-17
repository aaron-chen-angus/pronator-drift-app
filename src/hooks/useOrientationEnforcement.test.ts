/**
 * Tests for useOrientationEnforcement hook
 *
 * Updated for the side-view approach where LANDSCAPE is preferred.
 * Validates:
 * - Landscape detection via matchMedia
 * - isPortrait flag (non-preferred orientation)
 * - ORIENTATION_CHANGED dispatch when switching to PORTRAIT during active assessment
 * - No dispatch when assessment is not active
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

  beforeEach(() => {
    mockMatchMedia = createMockMatchMedia(false); // Start in portrait
    originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue(mockMatchMedia.mql);

    // Mock screen.orientation
    Object.defineProperty(window.screen, 'orientation', {
      value: {
        type: 'portrait-primary',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it('reports isLandscape=false and isPortrait=true when matchMedia says portrait', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useOrientationEnforcement(dispatch));

    expect(result.current.isLandscape).toBe(false);
    expect(result.current.isPortrait).toBe(true);
  });

  it('reports isLandscape=true and isPortrait=false when matchMedia says landscape', () => {
    mockMatchMedia = createMockMatchMedia(true);
    window.matchMedia = vi.fn().mockReturnValue(mockMatchMedia.mql);

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
    expect(result.current.isPortrait).toBe(false);
  });

  it('updates isLandscape and isPortrait when orientation changes', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useOrientationEnforcement(dispatch));

    expect(result.current.isLandscape).toBe(false);
    expect(result.current.isPortrait).toBe(true);

    act(() => {
      mockMatchMedia.trigger(true);
    });

    expect(result.current.isLandscape).toBe(true);
    expect(result.current.isPortrait).toBe(false);

    act(() => {
      mockMatchMedia.trigger(false);
    });

    expect(result.current.isLandscape).toBe(false);
    expect(result.current.isPortrait).toBe(true);
  });

  it('dispatches ORIENTATION_CHANGED when PORTRAIT detected during active assessment', () => {
    // Start in landscape (preferred orientation)
    mockMatchMedia = createMockMatchMedia(true);
    window.matchMedia = vi.fn().mockReturnValue(mockMatchMedia.mql);

    Object.defineProperty(window.screen, 'orientation', {
      value: {
        type: 'landscape-primary',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      writable: true,
      configurable: true,
    });

    const dispatch = vi.fn<(event: AppEvent) => void>();
    const { result } = renderHook(() => useOrientationEnforcement(dispatch));

    // Set assessment as active
    act(() => {
      result.current.setAssessmentActive(true);
    });

    // Trigger portrait (non-preferred) — this should dispatch warning
    act(() => {
      mockMatchMedia.trigger(false);
    });

    expect(dispatch).toHaveBeenCalledWith({ type: 'ORIENTATION_CHANGED' });
  });

  it('does NOT dispatch ORIENTATION_CHANGED when portrait detected outside assessment', () => {
    // Start in landscape
    mockMatchMedia = createMockMatchMedia(true);
    window.matchMedia = vi.fn().mockReturnValue(mockMatchMedia.mql);

    const dispatch = vi.fn<(event: AppEvent) => void>();
    const { result } = renderHook(() => useOrientationEnforcement(dispatch));

    // Assessment is not active (default)
    expect(result.current.isAssessmentActive).toBe(false);

    // Trigger portrait
    act(() => {
      mockMatchMedia.trigger(false);
    });

    // Should NOT dispatch — just sets isPortrait
    expect(dispatch).not.toHaveBeenCalled();
    expect(result.current.isPortrait).toBe(true);
  });

  it('does NOT dispatch when switching TO landscape during assessment (landscape is fine)', () => {
    const dispatch = vi.fn<(event: AppEvent) => void>();
    const { result } = renderHook(() => useOrientationEnforcement(dispatch));

    // Set assessment as active
    act(() => {
      result.current.setAssessmentActive(true);
    });

    // Trigger landscape (preferred) — no dispatch needed
    act(() => {
      mockMatchMedia.trigger(true);
    });

    expect(dispatch).not.toHaveBeenCalled();
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
    act(() => {
      mockMatchMedia.trigger(true);
    });
  });
});
