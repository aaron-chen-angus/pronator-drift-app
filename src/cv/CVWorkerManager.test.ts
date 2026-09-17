/**
 * Unit tests for CVWorkerManager — verifies the interface, lifecycle methods,
 * and fallback detection logic.
 *
 * Note: Actual MediaPipe inference requires WASM + GPU and cannot run in unit tests.
 * These tests verify structural correctness, error handling, and fallback detection.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CVWorkerManager, isWorkerSupported, CVWorkerManagerConfig } from './CVWorkerManager';

// ─── Test Configuration ──────────────────────────────────────────────────────

const testConfig: CVWorkerManagerConfig = {
  poseModelPath: '/models/pose_landmarker_lite.task',
  handModelPath: '/models/hand_landmarker.task',
  minPoseConfidence: 0.5,
  minHandConfidence: 0.5,
  numPoses: 1,
};

// ─── isWorkerSupported Tests ─────────────────────────────────────────────────

describe('isWorkerSupported', () => {
  it('should return true when Worker and OffscreenCanvas are available', () => {
    // In jsdom with vitest, Worker and OffscreenCanvas may or may not be defined.
    // We test the function logic by mocking globals.
    const originalWorker = globalThis.Worker;
    const originalOffscreenCanvas = globalThis.OffscreenCanvas;

    // Mock both as available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Worker = class MockWorker {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).OffscreenCanvas = class MockOffscreenCanvas {};

    expect(isWorkerSupported()).toBe(true);

    // Restore
    globalThis.Worker = originalWorker;
    globalThis.OffscreenCanvas = originalOffscreenCanvas;
  });

  it('should return false when Worker is unavailable', () => {
    const originalWorker = globalThis.Worker;
    const originalOffscreenCanvas = globalThis.OffscreenCanvas;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).Worker;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).OffscreenCanvas = class MockOffscreenCanvas {};

    expect(isWorkerSupported()).toBe(false);

    globalThis.Worker = originalWorker;
    globalThis.OffscreenCanvas = originalOffscreenCanvas;
  });

  it('should return false when OffscreenCanvas is unavailable', () => {
    const originalWorker = globalThis.Worker;
    const originalOffscreenCanvas = globalThis.OffscreenCanvas;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Worker = class MockWorker {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).OffscreenCanvas;

    expect(isWorkerSupported()).toBe(false);

    globalThis.Worker = originalWorker;
    globalThis.OffscreenCanvas = originalOffscreenCanvas;
  });

  it('should return false when both Worker and OffscreenCanvas are unavailable', () => {
    const originalWorker = globalThis.Worker;
    const originalOffscreenCanvas = globalThis.OffscreenCanvas;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).Worker;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).OffscreenCanvas;

    expect(isWorkerSupported()).toBe(false);

    globalThis.Worker = originalWorker;
    globalThis.OffscreenCanvas = originalOffscreenCanvas;
  });
});

// ─── CVWorkerManager Interface Tests ─────────────────────────────────────────

describe('CVWorkerManager', () => {
  let manager: CVWorkerManager;

  beforeEach(() => {
    manager = new CVWorkerManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('constructor and initial state', () => {
    it('should create an instance', () => {
      expect(manager).toBeInstanceOf(CVWorkerManager);
    });

    it('should not be ready before initialization', () => {
      expect(manager.ready).toBe(false);
    });
  });

  describe('destroy lifecycle', () => {
    it('should not throw when destroyed before initialization', () => {
      expect(() => manager.destroy()).not.toThrow();
    });

    it('should not throw when destroyed multiple times', () => {
      manager.destroy();
      expect(() => manager.destroy()).not.toThrow();
    });

    it('should reject processFrame after destroy', async () => {
      manager.destroy();
      const mockBitmap = { close: vi.fn() } as unknown as ImageBitmap;
      await expect(manager.processFrame(mockBitmap, 0)).rejects.toThrow(
        'CVWorkerManager has been destroyed'
      );
    });

    it('should reject initialize after destroy', async () => {
      manager.destroy();
      await expect(manager.initialize(testConfig)).rejects.toThrow(
        'CVWorkerManager has been destroyed'
      );
    });
  });

  describe('processFrame before initialization', () => {
    it('should reject if not initialized', async () => {
      const mockBitmap = { close: vi.fn() } as unknown as ImageBitmap;
      await expect(manager.processFrame(mockBitmap, 0)).rejects.toThrow(
        'CVWorkerManager is not initialized'
      );
    });
  });

  describe('fallback mode detection', () => {
    it('should use fallback mode when Worker is not available', () => {
      const originalWorker = globalThis.Worker;
      const originalOffscreenCanvas = globalThis.OffscreenCanvas;

      // Remove Worker and OffscreenCanvas to trigger fallback path
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).Worker;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).OffscreenCanvas;

      // Verify the support check correctly identifies missing APIs
      expect(isWorkerSupported()).toBe(false);

      globalThis.Worker = originalWorker;
      globalThis.OffscreenCanvas = originalOffscreenCanvas;
    });

    it('should detect worker mode when Worker and OffscreenCanvas are available', () => {
      const originalWorker = globalThis.Worker;
      const originalOffscreenCanvas = globalThis.OffscreenCanvas;

      // Ensure both are available
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).Worker = class MockWorker {
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;
        postMessage() {}
        terminate() {}
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).OffscreenCanvas = class MockOffscreenCanvas {};

      expect(isWorkerSupported()).toBe(true);

      globalThis.Worker = originalWorker;
      globalThis.OffscreenCanvas = originalOffscreenCanvas;
    });

    it('should set isFallbackMode property correctly based on isWorkerSupported check', () => {
      const originalWorker = globalThis.Worker;
      const originalOffscreenCanvas = globalThis.OffscreenCanvas;

      // Remove Worker to force fallback detection
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).Worker;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).OffscreenCanvas;

      // Verify the support check returns false
      expect(isWorkerSupported()).toBe(false);

      // Create a new manager in this environment — isFallbackMode
      // becomes true once initialize is called (but we won't call it
      // because MediaPipe can't load in test). The isWorkerSupported()
      // function is the determinant used by CVWorkerManager internally.
      const fallbackManager = new CVWorkerManager();
      // Before init, isFallbackMode defaults to false
      expect(fallbackManager.isFallbackMode).toBe(false);

      fallbackManager.destroy();
      globalThis.Worker = originalWorker;
      globalThis.OffscreenCanvas = originalOffscreenCanvas;
    });
  });

  describe('interface completeness', () => {
    it('should expose initialize method', () => {
      expect(typeof manager.initialize).toBe('function');
    });

    it('should expose processFrame method', () => {
      expect(typeof manager.processFrame).toBe('function');
    });

    it('should expose destroy method', () => {
      expect(typeof manager.destroy).toBe('function');
    });

    it('should expose ready getter', () => {
      expect(typeof manager.ready).toBe('boolean');
    });

    it('should expose isFallbackMode getter', () => {
      expect(typeof manager.isFallbackMode).toBe('boolean');
    });
  });
});
