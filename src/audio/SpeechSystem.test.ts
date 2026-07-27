import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SpeechSystem,
  wpmToRate,
  estimateCaptionDurationMs,
  createSpeechSystem,
} from './SpeechSystem';

// ─── Mock SpeechSynthesisUtterance ───────────────────────────────────────────

class MockUtterance {
  text: string;
  rate = 1;
  volume = 1;
  pitch = 1;
  lang = '';
  voice: SpeechSynthesisVoice | null = null;
  onstart: ((ev: SpeechSynthesisEvent) => void) | null = null;
  onend: ((ev: SpeechSynthesisEvent) => void) | null = null;
  onerror: ((ev: SpeechSynthesisErrorEvent) => void) | null = null;
  onpause: ((ev: SpeechSynthesisEvent) => void) | null = null;
  onresume: ((ev: SpeechSynthesisEvent) => void) | null = null;
  onmark: ((ev: SpeechSynthesisEvent) => void) | null = null;
  onboundary: ((ev: SpeechSynthesisEvent) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }

  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return false; }
}

// ─── Unit Tests for Utility Functions ────────────────────────────────────────

describe('wpmToRate', () => {
  it('maps 130 WPM to rate 0.85', () => {
    expect(wpmToRate(130)).toBeCloseTo(0.85, 5);
  });

  it('maps 160 WPM to rate 1.05', () => {
    expect(wpmToRate(160)).toBeCloseTo(1.05, 5);
  });

  it('maps 150 WPM to approximately rate 1.0 (midpoint bias toward upper)', () => {
    const result = wpmToRate(150);
    expect(result).toBeGreaterThanOrEqual(0.85);
    expect(result).toBeLessThanOrEqual(1.05);
  });

  it('clamps values below 130 to rate 0.85', () => {
    expect(wpmToRate(100)).toBeCloseTo(0.85, 5);
  });

  it('clamps values above 160 to rate 1.05', () => {
    expect(wpmToRate(200)).toBeCloseTo(1.05, 5);
  });

  it('maps 145 WPM to an intermediate rate', () => {
    const rate = wpmToRate(145);
    expect(rate).toBeGreaterThan(0.85);
    expect(rate).toBeLessThan(1.05);
  });
});

describe('estimateCaptionDurationMs', () => {
  it('returns at least 1000ms for any input', () => {
    expect(estimateCaptionDurationMs('')).toBeGreaterThanOrEqual(1000);
    expect(estimateCaptionDurationMs('hi')).toBeGreaterThanOrEqual(1000);
  });

  it('returns a longer duration for more words', () => {
    const short = estimateCaptionDurationMs('hello world');
    const long = estimateCaptionDurationMs('the quick brown fox jumps over the lazy dog multiple times');
    expect(long).toBeGreaterThan(short);
  });

  it('returns shorter duration at higher WPM', () => {
    const text = 'this is a sentence with several words in it';
    const slow = estimateCaptionDurationMs(text, 130);
    const fast = estimateCaptionDurationMs(text, 160);
    expect(slow).toBeGreaterThan(fast);
  });

  it('caps at 30 seconds maximum', () => {
    const longText = Array(1000).fill('word').join(' ');
    expect(estimateCaptionDurationMs(longText)).toBeLessThanOrEqual(30000);
  });
});

// ─── SpeechSystem Tests ──────────────────────────────────────────────────────

describe('SpeechSystem', () => {
  let lastUtterance: MockUtterance | null = null;

  let mockSpeechSynthesis: {
    speak: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    getVoices: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    lastUtterance = null;

    mockSpeechSynthesis = {
      speak: vi.fn((utterance: MockUtterance) => {
        lastUtterance = utterance;
        // Simulate start/end via microtask
        Promise.resolve().then(() => {
          utterance.onstart?.(new Event('start') as unknown as SpeechSynthesisEvent);
          Promise.resolve().then(() => {
            utterance.onend?.(new Event('end') as unknown as SpeechSynthesisEvent);
          });
        });
      }),
      cancel: vi.fn(),
      getVoices: vi.fn().mockReturnValue([
        { name: 'Google US English', lang: 'en-US', default: true } as unknown as SpeechSynthesisVoice,
        { name: 'Google UK English', lang: 'en-GB', default: false } as unknown as SpeechSynthesisVoice,
      ]),
      addEventListener: vi.fn(),
    };

    Object.defineProperty(window, 'speechSynthesis', {
      value: mockSpeechSynthesis,
      writable: true,
      configurable: true,
    });

    // Mock SpeechSynthesisUtterance globally
    (globalThis as unknown as Record<string, unknown>).SpeechSynthesisUtterance = MockUtterance;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete (globalThis as unknown as Record<string, unknown>).SpeechSynthesisUtterance;
  });

  it('creates a SpeechSystem instance via factory', () => {
    const system = createSpeechSystem();
    expect(system).toBeInstanceOf(SpeechSystem);
  });

  it('isAvailable returns true when speechSynthesis and SpeechSynthesisUtterance exist', () => {
    const system = new SpeechSystem();
    expect(system.isAvailable()).toBe(true);
  });

  it('isAvailable returns false when speechSynthesis is not defined', () => {
    Object.defineProperty(window, 'speechSynthesis', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const system = new SpeechSystem();
    expect(system.isAvailable()).toBe(false);
  });

  it('isAvailable returns false when SpeechSynthesisUtterance is not defined', () => {
    delete (globalThis as unknown as Record<string, unknown>).SpeechSynthesisUtterance;
    const system = new SpeechSystem();
    expect(system.isAvailable()).toBe(false);
  });

  it('speak resolves and sets/clears caption', async () => {
    const system = new SpeechSystem();
    const captionChanges: (string | null)[] = [];
    system.onCaptionChange((caption) => captionChanges.push(caption));

    await system.speak('Hello world');

    expect(captionChanges).toContain('Hello world');
    expect(captionChanges[captionChanges.length - 1]).toBeNull();
    expect(system.getCurrentCaption()).toBeNull();
  });

  it('speak calls onStart and onEnd callbacks', async () => {
    const system = new SpeechSystem();
    const onStart = vi.fn();
    const onEnd = vi.fn();

    await system.speak('Test', { onStart, onEnd });

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('cancel clears the current caption', () => {
    const system = new SpeechSystem();
    system['_setCaption']('Active caption');
    expect(system.getCurrentCaption()).toBe('Active caption');

    system.cancel();
    expect(system.getCurrentCaption()).toBeNull();
    expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
  });

  it('setVolume clamps between 0 and 1', () => {
    const system = new SpeechSystem();
    system.setVolume(0.5);
    expect(system['_volume']).toBe(0.5);

    system.setVolume(-1);
    expect(system['_volume']).toBe(0);

    system.setVolume(2);
    expect(system['_volume']).toBe(1);
  });

  it('setMuted and isMuted work correctly', () => {
    const system = new SpeechSystem();
    expect(system.isMuted()).toBe(false);

    system.setMuted(true);
    expect(system.isMuted()).toBe(true);

    system.setMuted(false);
    expect(system.isMuted()).toBe(false);
  });

  it('setMuted(true) cancels ongoing speech', () => {
    const system = new SpeechSystem();
    system.setMuted(true);
    expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
  });

  it('speak uses caption-only fallback when muted', async () => {
    vi.useFakeTimers();
    const system = new SpeechSystem();
    system.setMuted(true);

    const captionChanges: (string | null)[] = [];
    system.onCaptionChange((caption) => captionChanges.push(caption));

    const speakPromise = system.speak('Muted text');

    expect(system.getCurrentCaption()).toBe('Muted text');

    vi.runAllTimers();
    await speakPromise;

    expect(system.getCurrentCaption()).toBeNull();
    // speak should not have been called for the utterance (only cancel was called from setMuted)
    expect(mockSpeechSynthesis.speak).not.toHaveBeenCalled();
  });

  it('speak uses caption-only fallback when speechSynthesis unavailable', async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'speechSynthesis', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const system = new SpeechSystem();

    const onStart = vi.fn();
    const onEnd = vi.fn();

    const speakPromise = system.speak('Fallback text', { onStart, onEnd });

    expect(system.getCurrentCaption()).toBe('Fallback text');
    expect(onStart).toHaveBeenCalledTimes(1);

    vi.runAllTimers();
    await speakPromise;

    expect(system.getCurrentCaption()).toBeNull();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('speak retries once on error then falls back to caption-only', async () => {
    vi.useFakeTimers();
    let callCount = 0;
    mockSpeechSynthesis.speak.mockImplementation((utterance: MockUtterance) => {
      callCount++;
      Promise.resolve().then(() => {
        const errorEvent = new Event('error') as unknown as SpeechSynthesisErrorEvent;
        Object.defineProperty(errorEvent, 'error', { value: 'synthesis-failed' });
        utterance.onerror?.(errorEvent);
      });
    });

    const system = new SpeechSystem();
    const onEnd = vi.fn();

    const speakPromise = system.speak('Retry text', { onEnd });

    // Flush microtasks for first error, retry, second error
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    // Flush the fallback timeout
    vi.runAllTimers();
    await speakPromise;

    // Should have attempted speak twice (original + retry)
    expect(callCount).toBe(2);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('onCaptionChange notifies multiple listeners', () => {
    const system = new SpeechSystem();
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    system.onCaptionChange(listener1);
    system.onCaptionChange(listener2);

    system['_setCaption']('test');
    expect(listener1).toHaveBeenCalledWith('test');
    expect(listener2).toHaveBeenCalledWith('test');
  });

  it('getCurrentCaption returns null when no speech is active', () => {
    const system = new SpeechSystem();
    expect(system.getCurrentCaption()).toBeNull();
  });

  it('speak passes correct rate to utterance', async () => {
    const system = new SpeechSystem();
    await system.speak('Rate test', { rate: 130 });

    expect(lastUtterance).not.toBeNull();
    expect(lastUtterance!.rate).toBeCloseTo(0.85, 2);
  });

  it('speak passes correct volume to utterance', async () => {
    const system = new SpeechSystem();
    await system.speak('Volume test', { volume: 0.5 });

    expect(lastUtterance).not.toBeNull();
    expect(lastUtterance!.volume).toBe(0.5);
  });

  it('speak uses system volume when no volume option provided', async () => {
    const system = new SpeechSystem();
    system.setVolume(0.7);
    await system.speak('Default volume');

    expect(lastUtterance).not.toBeNull();
    expect(lastUtterance!.volume).toBe(0.7);
  });

  it('speak selects neutral English voice', async () => {
    const system = new SpeechSystem();
    await system.speak('Voice test');

    expect(lastUtterance).not.toBeNull();
    // Should have selected the default US English voice
    expect(lastUtterance!.voice).toEqual(
      expect.objectContaining({ name: 'Google US English', lang: 'en-US' })
    );
  });
});
