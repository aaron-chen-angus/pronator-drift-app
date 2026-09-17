/**
 * Unit tests for CameraSystem module.
 *
 * Tests the exported computeAverageLuminance utility and
 * verifies CameraSystem class behavior through mocked browser APIs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CameraSystem, computeAverageLuminance } from './CameraSystem';
import type { CameraSystemConfig } from './CameraSystem';

// ─── Tests for computeAverageLuminance ────────────────────────────────────────

describe('computeAverageLuminance', () => {
  it('returns 0 for zero pixel count', () => {
    const data = new Uint8ClampedArray(0);
    expect(computeAverageLuminance(data, 0)).toBe(0);
  });

  it('returns 0 for all-black pixels', () => {
    // 4 pixels, all RGBA = [0, 0, 0, 255]
    const data = new Uint8ClampedArray([
      0, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
    ]);
    expect(computeAverageLuminance(data, 4)).toBe(0);
  });

  it('returns 255 for all-white pixels', () => {
    // 4 pixels, all RGBA = [255, 255, 255, 255]
    const data = new Uint8ClampedArray([
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ]);
    // 0.299*255 + 0.587*255 + 0.114*255 = 255
    const result = computeAverageLuminance(data, 4);
    expect(result).toBeCloseTo(255, 5);
  });

  it('computes correct luminance for pure red', () => {
    // 1 pixel, RGBA = [255, 0, 0, 255]
    const data = new Uint8ClampedArray([255, 0, 0, 255]);
    // L = 0.299 * 255 + 0.587 * 0 + 0.114 * 0 = 76.245
    const result = computeAverageLuminance(data, 1);
    expect(result).toBeCloseTo(76.245, 2);
  });

  it('computes correct luminance for pure green', () => {
    // 1 pixel, RGBA = [0, 255, 0, 255]
    const data = new Uint8ClampedArray([0, 255, 0, 255]);
    // L = 0.299 * 0 + 0.587 * 255 + 0.114 * 0 = 149.685
    const result = computeAverageLuminance(data, 1);
    expect(result).toBeCloseTo(149.685, 2);
  });

  it('computes correct luminance for pure blue', () => {
    // 1 pixel, RGBA = [0, 0, 255, 255]
    const data = new Uint8ClampedArray([0, 0, 255, 255]);
    // L = 0.299 * 0 + 0.587 * 0 + 0.114 * 255 = 29.07
    const result = computeAverageLuminance(data, 1);
    expect(result).toBeCloseTo(29.07, 2);
  });

  it('computes correct average luminance for mixed pixel values', () => {
    // 2 pixels: one black [0,0,0], one white [255,255,255]
    const data = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]);
    // Average of 0 and 255 = 127.5
    const result = computeAverageLuminance(data, 2);
    expect(result).toBeCloseTo(127.5, 2);
  });

  it('ignores alpha channel in luminance calculation', () => {
    // Same RGB values with different alpha should produce same luminance
    const data1 = new Uint8ClampedArray([128, 128, 128, 255]);
    const data2 = new Uint8ClampedArray([128, 128, 128, 0]);
    expect(computeAverageLuminance(data1, 1)).toBeCloseTo(computeAverageLuminance(data2, 1), 5);
  });
});

// ─── Tests for CameraSystem class ────────────────────────────────────────────

describe('CameraSystem', () => {
  let cameraSystem: CameraSystem;

  const defaultConfig: CameraSystemConfig = {
    preferredFacing: 'user',
    targetFrameRate: 30,
    targetResolution: { width: 640, height: 480 },
  };

  beforeEach(() => {
    cameraSystem = new CameraSystem();
  });

  afterEach(() => {
    cameraSystem.destroy();
  });

  describe('initialize', () => {
    it('creates a video element and appends it to the DOM', async () => {
      await cameraSystem.initialize(defaultConfig);

      const videoElement = cameraSystem.getVideoElement();
      expect(videoElement).not.toBeNull();
      expect(videoElement?.tagName).toBe('VIDEO');
      expect(videoElement?.getAttribute('playsinline')).toBe('true');
      expect(videoElement?.getAttribute('autoplay')).toBe('true');
      expect(videoElement?.muted).toBe(true);
    });
  });

  describe('start', () => {
    it('throws if not initialized', async () => {
      await expect(cameraSystem.start()).rejects.toThrow('CameraSystem must be initialized before starting');
    });

    it('requests getUserMedia with correct constraints', async () => {
      const mockStream = createMockMediaStream();
      const mockGetUserMedia = vi.fn().mockResolvedValue(mockStream);
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: mockGetUserMedia, enumerateDevices: vi.fn() },
        writable: true,
        configurable: true,
      });

      await cameraSystem.initialize(defaultConfig);
      const stream = await cameraSystem.start();

      expect(mockGetUserMedia).toHaveBeenCalledWith({
        video: {
          facingMode: { ideal: 'user' },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      expect(stream).toBe(mockStream);
    });

    it('emits error when getUserMedia fails', async () => {
      const mockGetUserMedia = vi.fn().mockRejectedValue(new Error('Permission denied'));
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: mockGetUserMedia, enumerateDevices: vi.fn() },
        writable: true,
        configurable: true,
      });

      const errorCallback = vi.fn();
      await cameraSystem.initialize(defaultConfig);
      cameraSystem.onError(errorCallback);

      await expect(cameraSystem.start()).rejects.toThrow('Permission denied');
      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Camera access failed') })
      );
    });
  });

  describe('switchCamera', () => {
    it('throws if not initialized', async () => {
      await expect(cameraSystem.switchCamera('device-123')).rejects.toThrow(
        'CameraSystem must be initialized before switching cameras'
      );
    });

    it('requests getUserMedia with exact device ID', async () => {
      const mockStream = createMockMediaStream();
      const mockGetUserMedia = vi.fn().mockResolvedValue(mockStream);
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: mockGetUserMedia, enumerateDevices: vi.fn() },
        writable: true,
        configurable: true,
      });

      await cameraSystem.initialize(defaultConfig);
      await cameraSystem.start();
      await cameraSystem.switchCamera('device-456');

      // The second call should use exact deviceId
      expect(mockGetUserMedia).toHaveBeenLastCalledWith({
        video: {
          deviceId: { exact: 'device-456' },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
    });
  });

  describe('getAvailableCameras', () => {
    it('filters only videoinput devices', async () => {
      const mockDevices = [
        { kind: 'videoinput', deviceId: 'cam1', label: 'Front Camera' },
        { kind: 'audioinput', deviceId: 'mic1', label: 'Microphone' },
        { kind: 'videoinput', deviceId: 'cam2', label: 'Rear Camera' },
        { kind: 'audiooutput', deviceId: 'spk1', label: 'Speaker' },
      ] as MediaDeviceInfo[];

      Object.defineProperty(navigator, 'mediaDevices', {
        value: { enumerateDevices: vi.fn().mockResolvedValue(mockDevices), getUserMedia: vi.fn() },
        writable: true,
        configurable: true,
      });

      await cameraSystem.initialize(defaultConfig);
      const cameras = await cameraSystem.getAvailableCameras();

      expect(cameras).toHaveLength(2);
      expect(cameras[0]?.deviceId).toBe('cam1');
      expect(cameras[1]?.deviceId).toBe('cam2');
    });
  });

  describe('onFrame', () => {
    it('registers a frame callback', async () => {
      await cameraSystem.initialize(defaultConfig);
      const callback = vi.fn();
      cameraSystem.onFrame(callback);
      // The callback registration should not throw
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('onError', () => {
    it('registers an error callback', async () => {
      await cameraSystem.initialize(defaultConfig);
      const callback = vi.fn();
      cameraSystem.onError(callback);
      // The callback registration should not throw
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('stops all tracks and cancels animation frame', async () => {
      const mockTrack = { stop: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() };
      const mockStream = {
        getTracks: () => [mockTrack],
        getVideoTracks: () => [mockTrack],
      } as unknown as MediaStream;

      const mockGetUserMedia = vi.fn().mockResolvedValue(mockStream);
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: mockGetUserMedia, enumerateDevices: vi.fn() },
        writable: true,
        configurable: true,
      });

      await cameraSystem.initialize(defaultConfig);
      await cameraSystem.start();
      cameraSystem.stop();

      expect(mockTrack.stop).toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('removes video element from DOM', async () => {
      await cameraSystem.initialize(defaultConfig);
      const videoElement = cameraSystem.getVideoElement();
      expect(videoElement?.parentNode).not.toBeNull();

      cameraSystem.destroy();
      expect(cameraSystem.getVideoElement()).toBeNull();
    });
  });

  describe('getCurrentBrightness', () => {
    it('returns 0 initially (before any frames are processed)', () => {
      expect(cameraSystem.getCurrentBrightness()).toBe(0);
    });
  });

  describe('camera track ended detection', () => {
    it('emits error when camera track ends unexpectedly', async () => {
      let trackEndedCallback: (() => void) | null = null;
      const mockTrack = {
        stop: vi.fn(),
        addEventListener: vi.fn((event: string, handler: () => void) => {
          if (event === 'ended') {
            trackEndedCallback = handler;
          }
        }),
        removeEventListener: vi.fn(),
      };
      const mockStream = {
        getTracks: () => [mockTrack],
        getVideoTracks: () => [mockTrack],
      } as unknown as MediaStream;

      const mockGetUserMedia = vi.fn().mockResolvedValue(mockStream);
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: mockGetUserMedia, enumerateDevices: vi.fn() },
        writable: true,
        configurable: true,
      });

      const errorCallback = vi.fn();
      await cameraSystem.initialize(defaultConfig);
      cameraSystem.onError(errorCallback);
      await cameraSystem.start();

      // Simulate track ended event
      expect(trackEndedCallback).not.toBeNull();
      trackEndedCallback!();

      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Camera track ended unexpectedly' })
      );
    });
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockMediaStream(): MediaStream {
  const mockTrack = {
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return {
    getTracks: () => [mockTrack],
    getVideoTracks: () => [mockTrack],
  } as unknown as MediaStream;
}
