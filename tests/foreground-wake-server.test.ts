import { describe, expect, it } from 'vitest';
import { isHeyNancyPhrase, parseWakeRecognitionRequest } from '../src/server/wake-phrase';

function wav(samples = 2_000) {
  const audio = Buffer.alloc(44 + samples * 2);
  audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16_000, 24); audio.writeUInt32LE(32_000, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write('data', 36); audio.writeUInt32LE(samples * 2, 40);
  return audio;
}
const consent_token = 'bc8e3486-42ed-4d58-9b66-ad77084ef425';

describe('short local wake phrase', () => {
  it.each(['Hey Nancy', 'hey, nancy!', 'HEY NANCY.', ' hey nancy? '])('accepts %s', phrase => {
    expect(isHeyNancyPhrase(phrase)).toBe(true);
  });
  it.each(['Did you say Hey Nancy?', 'Hey Nancy please plan my day', 'I heard “Hey Nancy”', 'Hey, Nancy and Rob', 'Hi Nancy', 'Hey Nancy Hey Nancy'])('rejects embedded or different speech %s', phrase => {
    expect(isHeyNancyPhrase(phrase)).toBe(false);
  });
  it('accepts only a bounded PCM WAV and a fresh-form consent token', () => {
    const audio = wav();
    expect(parseWakeRecognitionRequest({ wav: audio.toString('base64'), consent_token })).toEqual({ audio, consentToken: consent_token });
    expect(() => parseWakeRecognitionRequest({ wav: audio.toString('base64'), consent_token, extra: true })).toThrow();
    expect(() => parseWakeRecognitionRequest({ wav: audio.toString('base64'), consent_token: 'owner' })).toThrow();
    expect(() => parseWakeRecognitionRequest({ wav: wav(90_000).toString('base64'), consent_token })).toThrow();
    const wrongRate = wav(); wrongRate.writeUInt32LE(48_000, 24);
    expect(() => parseWakeRecognitionRequest({ wav: wrongRate.toString('base64'), consent_token })).toThrow();
  });
});
