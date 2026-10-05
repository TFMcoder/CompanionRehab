const sentenceEnd = new Set(['.', '!', '?', '…']);
const closingMark = new Set(['"', "'", '”', '’', ')', ']', '}', '»']);
const abbreviations = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'eg', 'ie', 'am', 'pm',
  'approx', 'dept', 'inc', 'ltd', 'no', 'fig', 'vol', 'mt', 'capt', 'gen', 'gov', 'rev',
  'sen', 'rep', 'hon', 'sgt', 'cpl', 'pvt', 'us', 'uk',
]);

function isAbbreviation(text: string, period: number, after: number) {
  const token = text.slice(0, period + 1).match(/(?:^|\s)([A-Za-z](?:\.?[A-Za-z])*)\.$/)?.[1];
  if (!token) return false;
  const normalized = token.replaceAll('.', '').toLowerCase();
  if (abbreviations.has(normalized)) return true;
  // Keep a person's initial with their following name (e.g. "J. Smith").
  if (normalized.length === 1) {
    let next = after;
    while (next < text.length && /\s/.test(text[next]!)) next++;
    // A streamed delta ending after "J. " may still continue with the surname.
    if (next === text.length) return true;
    if (next < text.length && /[A-Z]/.test(text[next]!)) return true;
  }
  return false;
}

function sentenceEnds(text: string, allowEndOfText: boolean) {
  const ends: number[] = [];
  for (let index = 0; index < text.length; index++) {
    if (!sentenceEnd.has(text[index]!)) continue;
    if (text[index] === '.') {
      if (/\d/.test(text[index - 1] ?? '') && /\d/.test(text[index + 1] ?? '')) continue; // Decimal.
      if (isAbbreviation(text, index, index + 1)) continue;
      // The first period in "e.g." and similar forms is followed by a letter.
      if (/[A-Za-z]/.test(text[index + 1] ?? '')) continue;
    }
    let end = index + 1;
    while (end < text.length && closingMark.has(text[end]!)) end++;
    if (end < text.length && !/\s/.test(text[end]!)) continue;
    if (end === text.length && !allowEndOfText) continue;
    while (end < text.length && /\s/.test(text[end]!)) end++;
    ends.push(end);
    index = end - 1;
  }
  return ends;
}

function splitLongSentence(text: string, maximum: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const hardEnd = Math.min(start + maximum, text.length);
    if (hardEnd === text.length) { chunks.push(text.slice(start)); break; }
    let end = hardEnd;
    // Keep whole words together where possible, carrying their original space with the previous part.
    while (end > start && !/\s/.test(text[end - 1]!)) end--;
    if (end === start) end = hardEnd; // An unbroken long word must still make progress.
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

function firstPartOfSentence(sentence: string, maximum: number) {
  return sentence.length > maximum ? splitLongSentence(sentence, maximum)[0] : sentence;
}

/** Return the first part that cannot change as more provider text arrives. */
export function firstCompleteSpeechPart(text: string, maximum = 120): string | undefined {
  if (typeof text !== 'string' || !Number.isInteger(maximum) || maximum < 1) return undefined;
  const firstEnd = sentenceEnds(text, false)[0];
  if (firstEnd !== undefined) return firstPartOfSentence(text.slice(0, firstEnd), maximum);
  // A long unfinished sentence also has a stable first word-bounded part once it exceeds the limit.
  if (text.length > maximum) return splitLongSentence(text, maximum)[0];
  return undefined;
}

/** Split at sentence ends first, then word boundaries, preserving every source character. */
export function splitSpeechParts(text: string, maximum = 120): string[] {
  if (typeof text !== 'string' || !text.trim()) throw new RangeError('Speech text cannot be empty.');
  if (!Number.isInteger(maximum) || maximum < 1) throw new RangeError('Maximum speech-part length must be a positive integer.');

  const sentences: string[] = [];
  let start = 0;
  for (const end of sentenceEnds(text, true)) {
    sentences.push(text.slice(start, end));
    start = end;
  }
  if (start < text.length) sentences.push(text.slice(start));

  const parts: string[] = [];
  const firstSentence = sentences[0];
  if (firstSentence) parts.push(...(firstSentence.length > maximum ? splitLongSentence(firstSentence, maximum) : [firstSentence]));
  let current = '';
  const flush = () => { if (current) parts.push(current); current = ''; };
  for (const sentence of sentences.slice(1)) {
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
