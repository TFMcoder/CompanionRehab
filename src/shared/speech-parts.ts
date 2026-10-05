const sentenceEnd = new Set(['.', '!', '?', '…']);
const closingMark = new Set(['"', "'", '”', '’', ')', ']', '}', '»']);

function splitLongSentence(text: string, maximum: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const hardEnd = Math.min(start + maximum, text.length);
    if (hardEnd === text.length) { chunks.push(text.slice(start)); break; }
    let end = hardEnd;
    // Keep whole words together where possible, carrying their original space with the previous part.
    while (end > start && !/\s/.test(text[end - 1])) end--;
    if (end === start) end = hardEnd; // An unbroken long word must still make progress.
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

/** Split speech at sentence ends first, then word boundaries without changing any source text. */
export function splitSpeechParts(text: string, maximum = 120): string[] {
  if (typeof text !== 'string' || !text.trim()) throw new RangeError('Speech text cannot be empty.');
  if (!Number.isInteger(maximum) || maximum < 1) throw new RangeError('Maximum speech-part length must be a positive integer.');

  const sentences: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (!sentenceEnd.has(text[index]!)) continue;
    let end = index + 1;
    while (end < text.length && closingMark.has(text[end]!)) end++;
    if (end < text.length && !/\s/.test(text[end]!)) continue;
    while (end < text.length && /\s/.test(text[end]!)) end++;
    sentences.push(text.slice(start, end));
    start = end;
    index = end - 1;
  }
  if (start < text.length) sentences.push(text.slice(start));

  const parts: string[] = [];
  let current = '';
  const flush = () => { if (current) parts.push(current); current = ''; };
  for (const sentence of sentences) {
    if (sentence.length > maximum) {
      flush();
      parts.push(...splitLongSentence(sentence, maximum));
    } else if (current.length + sentence.length <= maximum) current += sentence;
    else { flush(); current = sentence; }
  }
  flush();
  if (parts.some(part => part.length === 0) || parts.join('') !== text) throw new Error('Speech splitting failed to preserve source text.');
  return parts;
}
