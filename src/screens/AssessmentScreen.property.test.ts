import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { COUNTDOWN_CUES } from './AssessmentScreen';

/**
 * Property 16: No Performance Speech During Assessment
 *
 * **Validates: Requirements 9.6**
 *
 * Property statement: "For any speech utterance produced while the 30-second
 * assessment timer is active, the utterance text shall contain only time-remaining
 * information (countdown numbers). It shall not contain words describing arm position,
 * movement, drift, pronation, or assessment performance."
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Words that must NEVER appear in countdown cues during assessment */
const FORBIDDEN_WORDS = [
  'drift',
  'pronation',
  'arm',
  'movement',
  'position',
  'performance',
  'good',
  'bad',
  'better',
  'worse',
];

/** Pattern matching only time-remaining content: numbers and the word "remaining" */
const TIME_REMAINING_PATTERN = /^[\d\s,remaining]+$/i;

/** The assessment duration in seconds */
const ASSESSMENT_DURATION = 30;

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 16: No Performance Speech During Assessment', () => {
  it('all COUNTDOWN_CUES contain only time-remaining content (numbers, "remaining")', () => {
    // Convert the ReadonlyMap entries to an array for property testing
    const cueEntries = Array.from(COUNTDOWN_CUES.entries());

    // Ensure we actually have cues to test
    expect(cueEntries.length).toBeGreaterThan(0);

    fc.assert(
      fc.property(
        fc.constantFrom(...cueEntries),
        ([elapsedSecond, cueText]) => {
          // Each cue text should match the time-remaining pattern
          expect(cueText).toMatch(TIME_REMAINING_PATTERN);
          // Confirm the text only contains digits, spaces, commas, and "remaining"
          const words = cueText.toLowerCase().split(/[\s,]+/).filter(Boolean);
          for (const word of words) {
            const isNumber = /^\d+$/.test(word);
            const isRemaining = word === 'remaining';
            expect(
              isNumber || isRemaining,
              `Unexpected word "${word}" in cue at elapsed second ${elapsedSecond}: "${cueText}"`
            ).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('no COUNTDOWN_CUES contain forbidden performance/drift/arm words', () => {
    const cueEntries = Array.from(COUNTDOWN_CUES.entries());

    expect(cueEntries.length).toBeGreaterThan(0);

    fc.assert(
      fc.property(
        fc.constantFrom(...cueEntries),
        fc.constantFrom(...FORBIDDEN_WORDS),
        ([_elapsedSecond, cueText], forbiddenWord) => {
          const lowerCue = cueText.toLowerCase();
          expect(
            lowerCue.includes(forbiddenWord),
            `Cue "${cueText}" must not contain forbidden word "${forbiddenWord}"`
          ).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('countdown cues are triggered at correct elapsed-second intervals within assessment', () => {
    const cueEntries = Array.from(COUNTDOWN_CUES.entries());

    expect(cueEntries.length).toBeGreaterThan(0);

    fc.assert(
      fc.property(
        fc.constantFrom(...cueEntries),
        ([elapsedSecond, _cueText]) => {
          // Elapsed second must be a positive integer within the assessment duration
          expect(Number.isInteger(elapsedSecond)).toBe(true);
          expect(elapsedSecond).toBeGreaterThan(0);
          expect(elapsedSecond).toBeLessThanOrEqual(ASSESSMENT_DURATION);

          // Verify the time-remaining value in the cue matches the expected remaining time
          const expectedRemaining = ASSESSMENT_DURATION - elapsedSecond;
          const cueText = COUNTDOWN_CUES.get(elapsedSecond)!;
          const numbersInCue = cueText.match(/\d+/g)?.map(Number) ?? [];

          // For milestone cues (5s, 10s, 15s, 20s elapsed), the number should be the remaining seconds
          // For final countdown (25-29s elapsed), numbers are 5,4,3,2,1
          if (numbersInCue.length === 1) {
            expect(numbersInCue[0]).toBe(expectedRemaining);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
