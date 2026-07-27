import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkCompatibility, SUPPORTED_BROWSERS } from './BrowserCompatibility';

describe('BrowserCompatibility', () => {
  // Store original values so we can restore them
  let originalMediaDevices: MediaDevices | undefined;
  let originalSpeechSynthesis: SpeechSynthesis | undefined;

  beforeEach(() => {
    originalMediaDevices = navigator.mediaDevices;
    originalSpeechSynthesis = window.speechSynthesis;
  });

  afterEach(() => {
    // Restore original values
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'speechSynthesis', {
      value: originalSpeechSynthesis,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  describe('checkCompatibility', () => {
    it('should return compatible: true when all features are supported', () => {
      // jsdom provides speechSynthesis and we can mock mediaDevices + WebGL
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn() },
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, 'speechSynthesis', {
        value: {},
        writable: true,
        configurable: true,
      });

      // Mock canvas getContext to return a truthy WebGL context
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);

      const result = checkCompatibility();
      expect(result.compatible).toBe(true);
      expect(result.missingFeatures).toHaveLength(0);
    });

    it('should detect missing getUserMedia', () => {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, 'speechSynthesis', {
        value: {},
        writable: true,
        configurable: true,
      });
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);

      const result = checkCompatibility();
      expect(result.compatible).toBe(false);
      expect(result.missingFeatures).toContain('Camera Access (getUserMedia)');
    });

    it('should detect missing getUserMedia function on mediaDevices', () => {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {},
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, 'speechSynthesis', {
        value: {},
        writable: true,
        configurable: true,
      });
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);

      const result = checkCompatibility();
      expect(result.compatible).toBe(false);
      expect(result.missingFeatures).toContain('Camera Access (getUserMedia)');
    });

    it('should detect missing WebGL support', () => {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn() },
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, 'speechSynthesis', {
        value: {},
        writable: true,
        configurable: true,
      });
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

      const result = checkCompatibility();
      expect(result.compatible).toBe(false);
      expect(result.missingFeatures).toContain('WebGL (required for MediaPipe)');
    });

    it('should detect missing Web Speech API', () => {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn() },
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, 'speechSynthesis', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);

      const result = checkCompatibility();
      expect(result.compatible).toBe(false);
      expect(result.missingFeatures).toContain('Web Speech API (speechSynthesis)');
    });

    it('should detect multiple missing features', () => {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, 'speechSynthesis', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

      const result = checkCompatibility();
      expect(result.compatible).toBe(false);
      expect(result.missingFeatures).toHaveLength(3);
      expect(result.missingFeatures).toContain('Camera Access (getUserMedia)');
      expect(result.missingFeatures).toContain('WebGL (required for MediaPipe)');
      expect(result.missingFeatures).toContain('Web Speech API (speechSynthesis)');
    });

    it('should handle WebGL context creation throwing an error', () => {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn() },
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, 'speechSynthesis', {
        value: {},
        writable: true,
        configurable: true,
      });
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
        throw new Error('WebGL not supported');
      });

      const result = checkCompatibility();
      expect(result.compatible).toBe(false);
      expect(result.missingFeatures).toContain('WebGL (required for MediaPipe)');
    });
  });

  describe('SUPPORTED_BROWSERS', () => {
    it('should include Chrome, Edge, Firefox, and Safari', () => {
      expect(SUPPORTED_BROWSERS).toContain('Google Chrome (desktop & Android)');
      expect(SUPPORTED_BROWSERS).toContain('Microsoft Edge');
      expect(SUPPORTED_BROWSERS).toContain('Mozilla Firefox');
      expect(SUPPORTED_BROWSERS).toContain('Safari (macOS & iOS)');
    });

    it('should have exactly 4 entries', () => {
      expect(SUPPORTED_BROWSERS).toHaveLength(4);
    });
  });
});
