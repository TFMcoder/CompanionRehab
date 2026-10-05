import { describe, expect, it } from 'vitest';
import { splitSpeechParts } from '../src/shared/speech-parts.js';

describe('splitSpeechParts', () => {
  it('keeps short replies whole and preserves sentence marks and spacing exactly', () => {
    const text = 'Good morning, Nancy. “How are you?” I can help!';
    expect(splitSpeechParts(text)).toEqual([text]);
    const longer = `${'First sentence ends here. '.repeat(9)}Last sentence!`;
    const parts = splitSpeechParts(longer, 40);
    expect(parts.join('')).toBe(longer);
    expect(parts.every(part => part.length <= 40)).toBe(true);
    expect(parts[0]).toBe('First sentence ends here. ');
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
