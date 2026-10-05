import { describe, expect, it } from 'vitest';
import { SpeechActivityGate } from '../src/client/speech-activity.js';

const rate = 48_000;
const blockSize = 4096;
function tone(length: number, startSample: number, frequency = 210, amplitude = 0.16) {
  const block = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = startSample + i;
    block[i] = amplitude * (0.7 * Math.sin(2 * Math.PI * frequency * t / rate) + 0.3 * Math.sin(2 * Math.PI * (frequency * 2.1) * t / rate));
  }
  return block;
}
function richReference(length: number, startSample: number) {
  const block = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = startSample + i;
    // Bounded deterministic broadband-like playback gives delay search unambiguous landmarks.
    const modulation = 0.65 + 0.35 * Math.sin(2 * Math.PI * 2.3 * t / rate);
    block[i] = modulation * 0.15 * (Math.sin(2 * Math.PI * 283 * t / rate) + 0.47 * Math.sin(2 * Math.PI * 719 * t / rate) + 0.23 * Math.sin(2 * Math.PI * 1327 * t / rate));
  }
  return block;
}
function shifted(input: Float32Array, offset: number, delay: number, gain: number) {
  const output = new Float32Array(input.length);
  for (let i = 0; i < output.length; i++) {
    const previous = offset + i - delay;
    if (previous >= 0) output[i] = gain * referenceSample(previous);
  }
  return output;
}
function referenceSample(t: number) {
  const modulation = 0.65 + 0.35 * Math.sin(2 * Math.PI * 2.3 * t / rate);
  return modulation * 0.15 * (Math.sin(2 * Math.PI * 283 * t / rate) + 0.47 * Math.sin(2 * Math.PI * 719 * t / rate) + 0.23 * Math.sin(2 * Math.PI * 1327 * t / rate));
}
function broadbandSample(t: number) {
  // Deterministic, speech-like broadband envelope with a short moving-average low-pass.
  const noise = (n: number) => {
    let value = (n * 1664525 + 1013904223) >>> 0;
    value = (value ^ (value >>> 15)) >>> 0;
    return value / 0xffffffff * 2 - 1;
  };
  const envelope = 0.52 + 0.48 * Math.sin(2 * Math.PI * 2.7 * t / rate) ** 2;
  return envelope * 0.17 * (noise(t) + noise(t - 1) + noise(t - 2) + noise(t - 3)) / 4;
}
function broadband(length: number, offset: number) {
  return Float32Array.from({ length }, (_, i) => broadbandSample(offset + i));
}

describe('SpeechActivityGate', () => {
  it('keeps silence quiet and does not mark it as echo or interruption', () => {
    const gate = new SpeechActivityGate(rate);
    const silence = new Float32Array(blockSize);
    for (let i = 0; i < 5; i++) expect(gate.observe(silence, silence, true)).toEqual({ speech: false, interrupt: false, echo: false });
  });

  it('does not interrupt for an isolated click or a short speech burst', () => {
    const gate = new SpeechActivityGate(rate);
    const silence = new Float32Array(blockSize);
    const click = new Float32Array(blockSize); click[Math.floor(blockSize / 2)] = 0.9;
    expect(gate.observe(click, silence, true).interrupt).toBe(false);
    gate.reset();
    expect(gate.observe(tone(blockSize, 0), silence, true).interrupt).toBe(false);
    expect(gate.observe(tone(blockSize, blockSize), silence, true).interrupt).toBe(false);
    expect(gate.observe(silence, silence, true).interrupt).toBe(false);
  });

  it('interrupts once after sustained near-end speech while responding', () => {
    const gate = new SpeechActivityGate(rate);
    const silence = new Float32Array(blockSize);
    const results = Array.from({ length: 7 }, (_, block) => gate.observe(tone(blockSize, block * blockSize), silence, true));
    expect(results.some(result => result.speech)).toBe(true);
    expect(results.filter(result => result.interrupt)).toHaveLength(1);
    expect(results.at(-1)?.interrupt).toBe(false);
  });

  it('does not treat direct or delayed scaled playback as barge-in', () => {
    const directGate = new SpeechActivityGate(rate);
    for (let block = 0; block < 7; block++) {
      const reference = richReference(blockSize, block * blockSize);
      const microphone = Float32Array.from(reference, sample => sample * 0.62);
      const result = directGate.observe(microphone, reference, true);
      expect(result.interrupt).toBe(false);
      if (block > 0) expect(result.echo).toBe(true);
    }

    const delayedGate = new SpeechActivityGate(rate);
    const delay = rate * 0.25;
    let sawEcho = false;
    for (let block = 0; block < 12; block++) {
      const offset = block * blockSize;
      const reference = richReference(blockSize, offset);
      const microphone = shifted(reference, offset, delay, 0.58);
      const result = delayedGate.observe(microphone, reference, true);
      sawEcho ||= result.echo;
      expect(result.interrupt).toBe(false);
    }
    expect(sawEcho).toBe(true);
  });

  it('rejects broadband feedback at non-round delays after low-pass decimation', () => {
    for (const { delayMs, gain } of [{ delayMs: 173, gain: 0.72 }, { delayMs: 173, gain: 0.34 }, { delayMs: 249, gain: 0.52 }]) {
      const gate = new SpeechActivityGate(rate);
      let sawEcho = false;
      for (let block = 0; block < 12; block++) {
        const offset = block * blockSize;
        const reference = broadband(blockSize, offset);
        const microphone = new Float32Array(blockSize);
        const delay = Math.round(rate * delayMs / 1000);
        for (let i = 0; i < microphone.length; i++) microphone[i] = (offset + i - delay >= 0) ? gain * broadbandSample(offset + i - delay) : 0;
        const result = gate.observe(microphone, reference, true);
        sawEcho ||= result.echo;
        expect(result.interrupt).toBe(false);
      }
      expect(sawEcho).toBe(true);
    }
  });

  it('detects near-end speech layered over delayed residual playback', () => {
    const gate = new SpeechActivityGate(rate);
    const delay = rate * 0.18;
    const results = [];
    for (let block = 0; block < 9; block++) {
      const offset = block * blockSize;
      const reference = richReference(blockSize, offset);
      const echo = shifted(reference, offset, delay, 0.42);
      const nearSpeech = tone(blockSize, offset, 196, 0.09);
      const microphone = Float32Array.from(echo, (sample, i) => sample + nearSpeech[i]);
      results.push(gate.observe(microphone, reference, true));
    }
    expect(results.some(result => result.echo && result.speech)).toBe(true);
    expect(results.filter(result => result.interrupt)).toHaveLength(1);
  });

  it('supports non-interrupting normal listening and a clean reset', () => {
    const gate = new SpeechActivityGate(rate);
    const speech = tone(blockSize, 0);
    expect(gate.observe(speech, new Float32Array(blockSize), false).interrupt).toBe(false);
    gate.reset();
    expect(gate.observe(new Float32Array(blockSize), new Float32Array(blockSize), true).speech).toBe(false);
  });
});
