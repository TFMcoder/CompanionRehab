export interface SpeechActivityResult {
  /** Near-end speech in this block (after removing a correlated playback component). */
  speech: boolean;
  /** One-shot edge after sustained near-end speech is detected while Nancy is responding. */
  interrupt: boolean;
  /** A playback-reference match was present in this block, even if near-end speech overlaps it. */
  echo: boolean;
}

const INTERRUPT_MS = 210;
const HANGOVER_MS = 90;
const INITIAL_NOISE_RMS = 0.004;
const ABSOLUTE_RMS_FLOOR = 0.016;
const ECHO_CORRELATION = 0.68;

/**
 * Small, bounded near-end speech gate for a two-channel microphone/playback-reference stream.
 * It only examines in-memory samples and emits block-level booleans; it does not retain audio.
 */
export class SpeechActivityGate {
  private readonly decimation: number;
  private readonly maxDelayFrames: number;
  private readonly referenceHistory: Float32Array;
  private historyWrite = 0;
  private phase = 0;
  private micAccumulator = 0;
  private referenceAccumulator = 0;
  private noiseRms = INITIAL_NOISE_RMS;
  private activeSpeechMs = 0;
  private quietMs = 0;
  private responding = false;
  private interruptLatched = false;

  constructor(private readonly sampleRate: number) {
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('Unsupported audio sample rate.');
    // About 2 kHz is enough for coarse echo matching and short-time voice activity statistics.
    this.decimation = Math.max(1, Math.round(sampleRate / 2000));
    this.maxDelayFrames = Math.ceil(sampleRate * 0.36 / this.decimation);
    this.referenceHistory = new Float32Array(this.maxDelayFrames + Math.ceil(sampleRate * 0.15 / this.decimation) + 512);
  }

  reset() {
    this.referenceHistory.fill(0);
    this.historyWrite = 0;
    this.phase = 0;
    this.micAccumulator = 0;
    this.referenceAccumulator = 0;
    this.noiseRms = INITIAL_NOISE_RMS;
    this.activeSpeechMs = 0;
    this.quietMs = 0;
    this.responding = false;
    this.interruptLatched = false;
  }

  observe(microphone: Float32Array, reference: Float32Array, responding: boolean): SpeechActivityResult {
    if (microphone.length !== reference.length) throw new RangeError('Microphone and playback-reference blocks must match.');
    if (!microphone.length) return { speech: false, interrupt: false, echo: false };
    if (responding !== this.responding) {
      this.responding = responding;
      this.activeSpeechMs = 0;
      this.quietMs = 0;
      this.interruptLatched = false;
    }

    const count = Math.floor((this.phase + microphone.length) / this.decimation);
    const near = new Float32Array(count);
    let index = 0;
    for (let i = 0; i < microphone.length; i++) {
      this.micAccumulator += clampSample(microphone[i]);
      this.referenceAccumulator += clampSample(reference[i]);
      this.phase++;
      if (this.phase === this.decimation) {
        near[index++] = this.micAccumulator / this.decimation;
        this.referenceHistory[this.historyWrite] = this.referenceAccumulator / this.decimation;
        this.historyWrite = (this.historyWrite + 1) % this.referenceHistory.length;
        this.phase = 0;
        this.micAccumulator = 0;
        this.referenceAccumulator = 0;
      }
    }

    const echoMatch = this.matchReference(near);
    const residual = near;
    if (echoMatch.echo) {
      for (let i = 0; i < near.length; i++) {
        residual[i] = near[i] - echoMatch.gain * this.referenceAt(echoMatch.start + i);
      }
    }
    const rms = rootMeanSquare(residual);
    const threshold = Math.max(ABSOLUTE_RMS_FLOOR, this.noiseRms * 2.8);
    const activity = this.voiceActivity(residual, threshold);

    // Track a capped low-level envelope so a steady background does not remain voice forever.
    // The cap prevents loud speech from quickly teaching itself as silence.
    const floorSample = Math.min(rms, 0.035);
    this.noiseRms = clamp(this.noiseRms * 0.985 + floorSample * 0.015, 0.002, 0.03);

    const blockMs = microphone.length * 1000 / this.sampleRate;
    const speech = activity.activeWindows >= activity.minimumWindows;
    if (speech) {
      this.activeSpeechMs += blockMs * activity.activeWindows / Math.max(1, activity.windowCount);
      this.quietMs = 0;
    } else {
      this.quietMs += blockMs;
      if (this.quietMs > HANGOVER_MS) this.activeSpeechMs = 0;
    }
    const interrupt = responding && !this.interruptLatched && this.activeSpeechMs >= INTERRUPT_MS;
    if (interrupt) this.interruptLatched = true;
    return { speech, interrupt, echo: echoMatch.echo };
  }

  private voiceActivity(samples: Float32Array, threshold: number) {
    const windowSamples = Math.max(12, Math.round(this.sampleRate / this.decimation * 0.01));
    const windowCount = Math.ceil(samples.length / windowSamples);
    let activeWindows = 0;
    for (let start = 0; start < samples.length; start += windowSamples) {
      const end = Math.min(samples.length, start + windowSamples);
      let energy = 0, crossings = 0, peak = 0;
      for (let i = start; i < end; i++) {
        const value = samples[i];
        energy += value * value;
        peak = Math.max(peak, Math.abs(value));
        if (i > start && (value >= 0) !== (samples[i - 1] >= 0)) crossings++;
      }
      const length = end - start;
      const windowRms = Math.sqrt(energy / Math.max(1, length));
      const crossingRate = crossings / Math.max(1, length - 1);
      if (windowRms >= threshold && peak >= threshold * 1.5 && crossingRate >= 0.015 && crossingRate <= 0.48) activeWindows++;
    }
    return { activeWindows, windowCount, minimumWindows: Math.max(2, Math.ceil(windowCount * 0.4)) };
  }

  private matchReference(near: Float32Array) {
    let nearEnergy = 0;
    for (let i = 0; i < near.length; i++) nearEnergy += near[i] * near[i];
    if (nearEnergy < 1e-7 || near.length < 12) return { echo: false, gain: 0, start: 0 };

    let bestCorrelation = 0, bestGain = 0, bestLag = -1;
    for (let lag = 0; lag <= this.maxDelayFrames; lag++) {
      const result = this.correlationAt(near, nearEnergy, lag);
      if (result.correlation > bestCorrelation) {
        bestCorrelation = result.correlation; bestGain = result.gain; bestLag = lag;
      }
    }
    const echo = bestCorrelation >= ECHO_CORRELATION;
    // start is the absolute circular-buffer position of the matching reference window.
    const start = mod(this.historyWrite - near.length - Math.max(0, bestLag), this.referenceHistory.length);
    return { echo, gain: clamp(bestGain, -4, 4), start };
  }

  private correlationAt(near: Float32Array, nearEnergy: number, lag: number) {
    const start = mod(this.historyWrite - near.length - lag, this.referenceHistory.length);
    let dot = 0, referenceEnergy = 0;
    for (let i = 0; i < near.length; i++) {
      const reference = this.referenceAt(start + i);
      dot += near[i] * reference;
      referenceEnergy += reference * reference;
    }
    if (referenceEnergy < 1e-7) return { correlation: 0, gain: 0 };
    return { correlation: Math.abs(dot) / Math.sqrt(nearEnergy * referenceEnergy), gain: dot / referenceEnergy };
  }

  private referenceAt(index: number) { return this.referenceHistory[mod(index, this.referenceHistory.length)]; }
}

function clampSample(value: number) { return Number.isFinite(value) ? clamp(value, -1, 1) : 0; }
function rootMeanSquare(samples: Float32Array) {
  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
  return Math.sqrt(energy / Math.max(1, samples.length));
}
function mod(value: number, divisor: number) { return (value % divisor + divisor) % divisor; }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
