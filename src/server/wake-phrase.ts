/** Foreground wake recognition is deliberately a short, exact utterance. */
export const MAX_WAKE_WAV_BYTES = 160_044; // five seconds, mono PCM16 at 16 kHz
export const MIN_WAKE_WAV_BYTES = 3_244; // at least 100 ms of audio
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isHeyNancyPhrase(transcript: string): boolean {
  if (typeof transcript !== 'string' || transcript.length > 48) return false;
  // ASR may add terminal punctuation. Do not match a phrase embedded in speech.
  return /^hey[\s,!.?]+nancy[\s,!.?]*$/i.test(transcript.trim());
}

export interface WakeRecognitionRequest { wav: string; consent_token: string }

/** Validate before decoding so oversized base64 never becomes a large Buffer. */
export function parseWakeRecognitionRequest(value: unknown): { audio: Buffer; consentToken: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RangeError('Invalid wake audio request.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 2 || typeof input.consent_token !== 'string' || !TOKEN.test(input.consent_token) ||
      typeof input.wav !== 'string' || input.wav.length > Math.ceil(MAX_WAKE_WAV_BYTES / 3) * 4 + 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.wav)) {
    throw new RangeError('Invalid wake audio request.');
  }
  const audio = Buffer.from(input.wav, 'base64');
  if (audio.length < MIN_WAKE_WAV_BYTES || audio.length > MAX_WAKE_WAV_BYTES ||
      audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE' ||
      audio.toString('ascii', 12, 16) !== 'fmt ' || audio.readUInt32LE(16) !== 16 ||
      audio.readUInt16LE(20) !== 1 || audio.readUInt16LE(22) !== 1 ||
      audio.readUInt32LE(24) !== 16_000 || audio.readUInt32LE(28) !== 32_000 ||
      audio.readUInt16LE(32) !== 2 || audio.readUInt16LE(34) !== 16 ||
      audio.toString('ascii', 36, 40) !== 'data' || audio.readUInt32LE(40) !== audio.length - 44 ||
      audio.readUInt32LE(4) !== audio.length - 8) {
    throw new RangeError('Wake audio must be a short 16 kHz mono PCM WAV.');
  }
  return { audio, consentToken: input.consent_token };
}
