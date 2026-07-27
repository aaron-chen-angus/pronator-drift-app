/**
 * Speech System - Manages text-to-speech and caption synchronization.
 *
 * Selects a neutral English voice from speechSynthesis.getVoices(),
 * maps 130-160 WPM to SpeechSynthesisUtterance.rate (~0.85-1.05),
 * emits caption events synchronized with onstart/onend,
 * and falls back to on-screen-only captions if speechSynthesis is unavailable.
 *
 * Implements retry logic: on speech failure, retry once, then fallback to text-only.
 */

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface SpeechOptions {
  /** Speech rate in WPM (130-160), mapped to SpeechSynthesis rate (~0.85-1.05) */
  rate?: number;
  /** Volume from 0.0 to 1.0 */
  volume?: number;
  /** Called when speech starts */
  onStart?: () => void;
  /** Called when speech ends */
  onEnd?: () => void;
  /** Called on speech error */
  onError?: (error: SpeechSynthesisErrorEvent) => void;
}

export interface ISpeechSystem {
  speak(text: string, options?: SpeechOptions): Promise<void>;
  cancel(): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  isAvailable(): boolean;
  getCurrentCaption(): string | null;
  onCaptionChange(callback: (caption: string | null) => void): void;
}

// ─── Types ───────────────────────────────────────────────────────────────────

type CaptionChangeCallback = (caption: string | null) => void;

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Maps WPM to SpeechSynthesis rate.
 * 130 WPM ≈ rate 0.85
 * 150 WPM ≈ rate 1.0 (default)
 * 160 WPM ≈ rate 1.05
 */
const MIN_WPM = 130;
const MAX_WPM = 160;
const MIN_RATE = 0.85;
const MAX_RATE = 1.05;
const DEFAULT_WPM = 150;


// ─── Utility Functions ───────────────────────────────────────────────────────

/**
 * Maps a WPM value (130-160) to a SpeechSynthesis rate (0.85-1.05).
 * Values outside range are clamped.
 */
export function wpmToRate(wpm: number): number {
  const clampedWpm = Math.max(MIN_WPM, Math.min(MAX_WPM, wpm));
  const normalized = (clampedWpm - MIN_WPM) / (MAX_WPM - MIN_WPM);
  return MIN_RATE + normalized * (MAX_RATE - MIN_RATE);
}

/**
 * Estimates the duration (ms) to display a caption at the given WPM.
 * Used for fallback mode when speech synthesis is unavailable.
 */
export function estimateCaptionDurationMs(text: string, wpm: number = DEFAULT_WPM): number {
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount === 0) return 1000; // minimum 1 second for empty/whitespace
  const minutes = wordCount / wpm;
  const ms = minutes * 60 * 1000;
  // Minimum 1 second, maximum 30 seconds
  return Math.max(1000, Math.min(30000, ms));
}

/**
 * Selects a neutral English voice from available system voices.
 * Prefers voices that don't use exaggerated intonation (avoids novelty voices).
 */
function selectNeutralVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;

  // Filter English voices
  const englishVoices = voices.filter(
    (v) => v.lang.startsWith('en-') || v.lang === 'en'
  );

  if (englishVoices.length === 0) {
    // Fall back to any available voice
    return voices[0] ?? null;
  }

  // Prefer non-novelty voices: avoid names containing keywords that suggest novelty
  const noveltyKeywords = [
    'whisper', 'singing', 'novelty', 'cartoon', 'robotic',
    'alien', 'monster', 'child', 'kid', 'zarvox', 'trinoids',
    'hysterical', 'bells', 'boing', 'bad news', 'good news',
    'bubbles', 'cellos', 'deranged', 'pipe organ', 'whisper',
  ];

  const neutralVoices = englishVoices.filter((v) => {
    const nameLower = v.name.toLowerCase();
    return !noveltyKeywords.some((keyword) => nameLower.includes(keyword));
  });

  // Prefer default voice if it's neutral and English
  const defaultNeutral = neutralVoices.find((v) => v.default);
  if (defaultNeutral) return defaultNeutral;

  // Prefer US/GB English
  const preferredLocales = ['en-US', 'en-GB', 'en-AU'];
  for (const locale of preferredLocales) {
    const match = neutralVoices.find((v) => v.lang === locale);
    if (match) return match;
  }

  // Return first neutral English voice
  return neutralVoices[0] ?? englishVoices[0] ?? null;
}

// ─── SpeechSystem Implementation ────────────────────────────────────────────

export class SpeechSystem implements ISpeechSystem {
  private _volume: number = 1.0;
  private _muted: boolean = false;
  private _currentCaption: string | null = null;
  private _captionListeners: CaptionChangeCallback[] = [];
  private _selectedVoice: SpeechSynthesisVoice | null = null;
  private _voiceLoaded: boolean = false;
  private _currentUtterance: SpeechSynthesisUtterance | null = null;

  constructor() {
    this._initVoice();
  }

  /**
   * Initialize voice selection. Voices may load asynchronously in some browsers.
   */
  private _initVoice(): void {
    if (!this.isAvailable()) return;

    const synth = window.speechSynthesis;
    const voices = synth.getVoices();
    if (voices.length > 0) {
      this._selectedVoice = selectNeutralVoice(voices);
      this._voiceLoaded = true;
    } else if (typeof synth.addEventListener === 'function') {
      // Voices load asynchronously in some browsers (Chrome)
      synth.addEventListener('voiceschanged', () => {
        const loadedVoices = synth.getVoices();
        this._selectedVoice = selectNeutralVoice(loadedVoices);
        this._voiceLoaded = true;
      }, { once: true });
    }
  }

  /**
   * Speak the given text with optional configuration.
   * Returns a promise that resolves when speech completes.
   * Falls back to caption-only mode if speech synthesis is unavailable.
   * Implements retry logic: retry once on failure, then fall back to text-only.
   */
  async speak(text: string, options?: SpeechOptions): Promise<void> {
    // If speech synthesis is not available, use caption-only fallback
    if (!this.isAvailable()) {
      return this._captionOnlyFallback(text, options);
    }

    // If muted, use caption-only fallback
    if (this._muted) {
      return this._captionOnlyFallback(text, options);
    }

    try {
      await this._attemptSpeak(text, options);
    } catch (_firstError) {
      // Retry once on failure
      try {
        await this._attemptSpeak(text, options);
      } catch (_retryError) {
        // Both attempts failed - fall back to caption-only
        await this._captionOnlyFallback(text, options);
      }
    }
  }

  /**
   * Attempt to speak using Web Speech API.
   * Rejects the promise on error.
   */
  private _attemptSpeak(text: string, options?: SpeechOptions): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      this._currentUtterance = utterance;

      // Set voice
      if (this._selectedVoice) {
        utterance.voice = this._selectedVoice;
      }

      // Map WPM to rate
      const wpm = options?.rate ?? DEFAULT_WPM;
      utterance.rate = wpmToRate(wpm);

      // Set volume
      utterance.volume = options?.volume ?? this._volume;

      // Synchronized caption events
      utterance.onstart = () => {
        this._setCaption(text);
        options?.onStart?.();
      };

      utterance.onend = () => {
        this._setCaption(null);
        this._currentUtterance = null;
        options?.onEnd?.();
        resolve();
      };

      utterance.onerror = (event) => {
        // 'canceled' is not a real failure - it happens when cancel() is called
        if (event.error === 'canceled') {
          this._setCaption(null);
          this._currentUtterance = null;
          resolve();
          return;
        }
        this._setCaption(null);
        this._currentUtterance = null;
        options?.onError?.(event);
        reject(event);
      };

      window.speechSynthesis.speak(utterance);
    });
  }

  /**
   * Caption-only fallback when speech is unavailable or has failed.
   * Shows the caption for a calculated duration based on WPM, then clears it.
   */
  private _captionOnlyFallback(text: string, options?: SpeechOptions): Promise<void> {
    return new Promise<void>((resolve) => {
      const wpm = options?.rate ?? DEFAULT_WPM;
      const duration = estimateCaptionDurationMs(text, wpm);

      this._setCaption(text);
      options?.onStart?.();

      setTimeout(() => {
        this._setCaption(null);
        options?.onEnd?.();
        resolve();
      }, duration);
    });
  }

  /**
   * Cancel any ongoing speech.
   */
  cancel(): void {
    if (this.isAvailable()) {
      window.speechSynthesis.cancel();
    }
    this._setCaption(null);
    this._currentUtterance = null;
  }

  /**
   * Set the volume for subsequent speech (0.0 - 1.0).
   */
  setVolume(volume: number): void {
    this._volume = Math.max(0, Math.min(1, volume));
  }

  /**
   * Set the muted state.
   */
  setMuted(muted: boolean): void {
    this._muted = muted;
    if (muted) {
      this.cancel();
    }
  }

  /**
   * Returns whether audio is currently muted.
   */
  isMuted(): boolean {
    return this._muted;
  }

  /**
   * Returns whether the Web Speech API is available in the current browser.
   */
  isAvailable(): boolean {
    return typeof window !== 'undefined' &&
      typeof window.speechSynthesis !== 'undefined' &&
      window.speechSynthesis !== null &&
      typeof SpeechSynthesisUtterance !== 'undefined';
  }

  /**
   * Returns the current caption text, or null if no caption is active.
   */
  getCurrentCaption(): string | null {
    return this._currentCaption;
  }

  /**
   * Register a callback for caption change events.
   */
  onCaptionChange(callback: CaptionChangeCallback): void {
    this._captionListeners.push(callback);
  }

  /**
   * Internal: update the current caption and notify listeners.
   */
  private _setCaption(caption: string | null): void {
    this._currentCaption = caption;
    for (const listener of this._captionListeners) {
      listener(caption);
    }
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Creates a new SpeechSystem instance.
 */
export function createSpeechSystem(): SpeechSystem {
  return new SpeechSystem();
}
