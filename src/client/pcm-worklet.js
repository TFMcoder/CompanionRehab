class NancyPcmQueue extends AudioWorkletProcessor {
  constructor() {
    super();
    this.trace = null;
    this.queue = [];
    this.queuedFrames = 0;
    this.targetFrames = 3840;
    this.maxFrames = 24_000 * 60;
    this.started = false;
    this.complete = false;
    this.underruns = 0;
    this.firstNonzeroReported = false;
    this.metricsCounter = 0;
    this.totalRenderedFrames = 0;
    this.pendingSilenceTraces = [];
    this.pendingStart = null;
    this.port.onmessage = event => this.onMessage(event.data);
  }

  begin(message) {
    this.trace = message.trace;
    this.queue = [];
    this.queuedFrames = 0;
    this.targetFrames = Number.isInteger(message.targetFrames) ? Math.max(1, Math.min(message.targetFrames, 24_000)) : 3840;
    this.maxFrames = Number.isInteger(message.maxFrames) ? Math.max(this.targetFrames, Math.min(message.maxFrames, 24_000 * 60)) : 24_000 * 60;
    this.started = false;
    this.complete = false;
    this.underruns = 0;
    this.firstNonzeroReported = false;
    this.metricsCounter = 0;
    this.totalRenderedFrames = 0;
    this.port.postMessage({ type: 'started', trace: this.trace });
  }

  onMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'start' && typeof message.trace === 'string') {
      if (this.pendingSilenceTraces.length) this.pendingStart = message;
      else this.begin(message);
      return;
    }
    if (message.type === 'cancel' && this.pendingStart?.trace === message.trace) {
      this.pendingStart = null;
      this.pendingSilenceTraces.push(message.trace);
      return;
    }
    if (message.trace !== this.trace) return;
    if (message.type === 'chunk') {
      if (!(message.pcm instanceof Float32Array) || message.pcm.length === 0 || this.queuedFrames + message.pcm.length > this.maxFrames) {
        this.port.postMessage({ type: 'error', trace: this.trace, code: 'buffer_limit' });
        return;
      }
      this.queue.push({ pcm: message.pcm, offset: 0, seq: message.seq });
      this.queuedFrames += message.pcm.length;
      this.port.postMessage({ type: 'enqueued', trace: this.trace, seq: message.seq, frames: message.pcm.length, queuedFrames: this.queuedFrames });
      return;
    }
    if (message.type === 'complete') {
      this.complete = true;
      if (!this.started && this.queuedFrames === 0) {
        const trace = this.trace;
        this.trace = null;
        this.port.postMessage({ type: 'drained', trace, underruns: this.underruns });
      }
      return;
    }
    if (message.type === 'cancel') {
      const trace = this.trace;
      this.queue = [];
      this.queuedFrames = 0;
      this.started = false;
      this.complete = true;
      this.trace = null;
      this.pendingSilenceTraces.push(trace);
    }
  }

  process(_inputs, outputs) {
    const channels = outputs[0];
    if (!channels?.length) return true;
    const frames = channels[0].length;
    for (const channel of channels) channel.fill(0);
    if (this.pendingSilenceTraces.length) {
      for (const trace of this.pendingSilenceTraces.splice(0)) this.port.postMessage({ type: 'silence', trace, queuedFrames: 0 });
      if (this.pendingStart) { const next = this.pendingStart; this.pendingStart = null; this.begin(next); }
      return true;
    }
    if (!this.trace) return true;
    if (!this.started && (this.queuedFrames >= this.targetFrames || (this.complete && this.queuedFrames > 0))) {
      this.started = true;
      this.port.postMessage({ type: 'playback_started', trace: this.trace, queuedFrames: this.queuedFrames });
    }
    if (this.started) {
      let destination = 0;
      let firstNonzeroFrame = -1;
      while (destination < frames && this.queue.length > 0) {
        const current = this.queue[0];
        const count = Math.min(frames - destination, current.pcm.length - current.offset);
        for (let index = 0; index < count; index++) {
          const value = current.pcm[current.offset + index];
          if (firstNonzeroFrame < 0 && Math.abs(value) > 1e-4) firstNonzeroFrame = destination + index;
          for (const channel of channels) channel[destination + index] = value;
        }
        current.offset += count;
        destination += count;
        this.queuedFrames -= count;
        if (current.offset >= current.pcm.length) this.queue.shift();
      }
      if (firstNonzeroFrame >= 0 && !this.firstNonzeroReported) {
        this.firstNonzeroReported = true;
        this.port.postMessage({ type: 'first_nonzero_rendered', trace: this.trace, frameOffset: firstNonzeroFrame, queueFrames: this.queuedFrames, renderedFrames: this.totalRenderedFrames + firstNonzeroFrame });
      }
      if (destination < frames && !this.complete) this.underruns++;
      this.totalRenderedFrames += destination;
      this.metricsCounter++;
      if (this.metricsCounter >= 10 || (this.complete && this.queuedFrames === 0)) {
        this.metricsCounter = 0;
        this.port.postMessage({ type: 'metrics', trace: this.trace, renderedFrames: this.totalRenderedFrames, queueFrames: this.queuedFrames, underruns: this.underruns });
      }
      if (this.complete && this.queuedFrames === 0) {
        const trace = this.trace;
        this.trace = null;
        this.started = false;
        this.port.postMessage({ type: 'drained', trace, underruns: this.underruns });
      }
    }
    return true;
  }
}

registerProcessor('nancy-pcm-queue', NancyPcmQueue);
