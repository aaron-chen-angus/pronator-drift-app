import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { SpeechSystem, createSpeechSystem } from './SpeechSystem';

/**
 * Property 4: Speech-to-Caption Synchronization
 *
 * **Validates: Requirements 4.4**
 *
 * Property statement: "For any spoken instruction produced by the Speech System
 * during any workflow stage, a corresponding visible text caption shall be emitted
 * simultaneously, and the caption text shall match the spoken text."
 */

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

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 4: Speech-to-Caption Synchronization', () => {
  let mockSpeechSynthesis: {
    speak: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    getVoices: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSpeechSynthesis = {
      speak: vi.fn((utterance: MockUtterance) => {
        // Simulate onstart immediately, then onend in a microtask
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
      ]),
      addEventListener: vi.fn(),
    };

    Object.defineProperty(window, 'speechSynthesis', {
      value: mockSpeechSynthesis,
      writable: true,
      configurable: true,
    });

    (globalThis as unknown as Record<string, unknown>).SpeechSynthesisUtterance = MockUtterance;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as Record<string, unknown>).SpeechSynthesisUtterance;
  });

  it('caption matches spoken text for any arbitrary string', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        async (text) => {
          const system = createSpeechSystem();
          const captionChanges: (string | null)[] = [];
          system.onCaptionChange((caption) => captionChanges.push(caption));

          await system.speak(text);

          // The caption change callback must have been called with the exact spoken text
          expect(captionChanges).toContain(text);
          // The first caption emitted must match the spoken text exactly
          const firstCaption = captionChanges.find((c) => c !== null);
          expect(firstCaption).toBe(text);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('caption is cleared (null) after speech completes for any text', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        async (text) => {
          const system = createSpeechSystem();
          const captionChanges: (string | null)[] = [];
          system.onCaptionChange((caption) => captionChanges.push(caption));

          await system.speak(text);

          // After speech completes, the last caption change must be null (cleared)
          const lastCaption = captionChanges[captionChanges.length - 1];
          expect(lastCaption).toBeNull();
          // getCurrentCaption should also be null after completion
          expect(system.getCurrentCaption()).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('caption change sequence is [text, null] for any spoken text', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        async (text) => {
          const system = createSpeechSystem();
          const captionChanges: (string | null)[] = [];
          system.onCaptionChange((caption) => captionChanges.push(caption));

          await system.speak(text);

          // The exact sequence should be: text shown, then cleared
          expect(captionChanges.length).toBe(2);
          expect(captionChanges[0]).toBe(text);
          expect(captionChanges[1]).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});
