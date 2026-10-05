import { describe, expect, it } from 'vitest';
import { firstCompleteSpeechPart, splitSpeechParts } from '../src/shared/speech-parts.js';

describe('splitSpeechParts', () => {
  it('keeps short replies whole and preserves sentence marks and spacing exactly', () => {
    const text = 'Good morning, Nancy. “How are you?” I can help!';
    expect(splitSpeechParts(text)).toEqual(['Good morning, Nancy. ', '“How are you?” I can help!']);
    const longer = `${'First sentence ends here. '.repeat(9)}Last sentence!`;
    const parts = splitSpeechParts(longer, 40);
    expect(parts.join('')).toBe(longer);
    expect(parts.every(part => part.length <= 40)).toBe(true);
    expect(parts[0]).toBe('First sentence ends here. ');
  });

  it('keeps each complete sentence as its own part even when several would fit together', () => {
    const text = 'Yes. Okay! What next?';
    expect(splitSpeechParts(text, 120)).toEqual(['Yes. ', 'Okay! What next?']);
    expect(splitSpeechParts(text, 120).join('')).toBe(text);
  });

  it('returns only a stable first complete part from partial provider text', () => {
    expect(firstCompleteSpeechPart('A complete sentence.')).toBeUndefined();
    expect(firstCompleteSpeechPart('A complete sentence. ')).toBe('A complete sentence. ');
    expect(firstCompleteSpeechPart('A complete sentence. Next sentence')).toBe('A complete sentence. ');
    expect(firstCompleteSpeechPart('A complete sentence. Next sentence.')).toBe('A complete sentence. ');
    expect(firstCompleteSpeechPart('Ask J. ')).toBeUndefined();
    expect(firstCompleteSpeechPart('Ask J. Smith about lunch. ')).toBe('Ask J. Smith about lunch. ');
    expect(firstCompleteSpeechPart('This is an unfinished sentence with no boundary')).toBeUndefined();

    const long = `${'word '.repeat(24)}unfinished`;
    const first = firstCompleteSpeechPart(long, 40);
    expect(first).toBe(splitSpeechParts(`${long}.`, 40)[0]);
    expect(first?.length).toBeLessThanOrEqual(40);
  });

  it('does not mistake decimals, initials, common abbreviations, or times for sentence boundaries', () => {
    const text = 'Dr. Smith has 3.14 points at 10:30 a.m. J. Jones agrees. Then we go.';
    expect(splitSpeechParts(text)).toEqual(['Dr. Smith has 3.14 points at 10:30 a.m. J. Jones agrees. ', 'Then we go.']);
    expect(firstCompleteSpeechPart('Dr. Smith is here. Next')).toBe('Dr. Smith is here. ');
    expect(firstCompleteSpeechPart('It costs 3.14 dollars. Next')).toBe('It costs 3.14 dollars. ');
  });

  it('word-wraps long sentences and splits unbroken text without dropping characters', () => {
    const text = `${'A thoughtful sentence that continues, '.repeat(20)}${'x'.repeat(90)}`;
    const parts = splitSpeechParts(text, 50);
    expect(parts.join('')).toBe(text);
    expect(parts.every(part => part.length <= 50)).toBe(true);
    expect(parts.join('')).toContain('continues, ');
  });

  it('rejects blank text and invalid part limits', () => {
    expect(() => splitSpeechParts('  ')).toThrow(RangeError);
    expect(() => splitSpeechParts('hello', 0)).toThrow(RangeError);
  });
});
