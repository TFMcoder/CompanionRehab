import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_TEXT_CHARS = 1500;
const MAX_WAV_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 45;
const MAX_WORKER_LINE = 14 * 1024 * 1024;
const STARTUP_TIMEOUT_MS = 120_000;
const SYNTHESIS_TIMEOUT_MS = 60_000;
const TRANSCRIPTION_TIMEOUT_MS = 30_000;
const GREETING_CACHE_MAX_ENTRIES = 8;
const GREETING_CACHE_MAX_BYTES = 2 * 1024 * 1024;
const GREETING_CACHE_TTL_MS = 5 * 60_000;

export type LocalSpeechReadiness = { kokoro: 'starting' | 'ready' | 'unavailable'; asr: 'starting' | 'ready' | 'unavailable' };

type ChildSpec = { executable: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv };
type Pending = { id: string; resolve: (value: string) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout; abort?: () => void; signal?: AbortSignal; settled: boolean; drained: Promise<void>; releaseDrain: () => void };

function abortError() { return Object.assign(new Error('Speech request cancelled.'), { name: 'AbortError' }); }
function timeoutError() { return Object.assign(new Error('Speech request timed out.'), { name: 'TimeoutError' }); }

/** One warm, line-oriented child with at most one active request. */
class WarmWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending: Pending | null = null;
  private waiting = false;
  private claimed = false;
  private state: LocalSpeechReadiness['kokoro'] = 'starting';
  private startup: Promise<void>;
  private resolveStartup!: () => void;
  private rejectStartup!: (error: Error) => void;

  constructor(private readonly spec: ChildSpec) {
    this.startup = new Promise<void>((resolveStartup, rejectStartup) => {
      this.resolveStartup = resolveStartup;
      this.rejectStartup = rejectStartup;
    });
    this.launch();
  }

  readiness() { return this.state; }
  ready() { return this.startup; }

  private resetStartup() {
    this.startup = new Promise<void>((resolveStartup, rejectStartup) => {
      this.resolveStartup = resolveStartup;
      this.rejectStartup = rejectStartup;
    });
  }

  async close() {
    const child = this.child;
    this.child = null;
    this.state = 'unavailable';
    if (this.pending) {
      const pending = this.pending;
      this.finishPending();
      pending.reject(new Error('Local speech service is closed.'));
    }
    const exited = child ? new Promise<void>(resolveExit => {
      if (child.exitCode !== null || child.signalCode !== null) { resolveExit(); return; }
      const timer = setTimeout(resolveExit, 2000);
      const done = () => { clearTimeout(timer); resolveExit(); };
      child.once('exit', done);
      child.once('error', done);
      child.kill();
    }) : Promise.resolve();
    this.rejectStartup(new Error('Local speech service is closed.'));
    await exited;
  }

  private launch() {
    this.state = 'starting';
    const child = spawn(this.spec.executable, this.spec.args, {
      cwd: this.spec.cwd, env: this.spec.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    let started = false;
    const startupTimer = setTimeout(() => {
      if (this.child === child && !started) {
        this.state = 'unavailable';
        this.rejectStartup(new Error('Local speech worker did not become ready.'));
        child.kill();
      }
    }, STARTUP_TIMEOUT_MS);
    lines.on('line', line => {
      if (this.child !== child || line.length > MAX_WORKER_LINE) return;
      let message: any;
      try { message = JSON.parse(line); } catch { return; }
      if (message?.type === 'ready') {
        if (started) return;
        started = true;
        clearTimeout(startupTimer);
        this.state = 'ready';
        this.resolveStartup();
        return;
      }
      const pending = this.pending;
      if (!pending || message?.id !== pending.id) return;
      this.finishPending();
      if (pending.settled) return;
      if (message.type === 'result' && typeof message.value === 'string') pending.resolve(message.value);
      else pending.reject(new Error('Local speech worker could not complete the request.'));
    });
    // Worker diagnostics can include paths or input details. Never forward or retain them.
    child.stderr.on('data', () => undefined);
    child.stdin.on('error', () => this.workerFailed(child, startupTimer, started));
    child.on('error', () => this.workerFailed(child, startupTimer, started));
    child.on('exit', () => this.workerFailed(child, startupTimer, started));
  }

  private workerFailed(child: ChildProcessWithoutNullStreams, startupTimer: NodeJS.Timeout, hadStarted: boolean) {
    if (this.child !== child) return;
    clearTimeout(startupTimer);
    this.child = null;
    this.state = 'unavailable';
    const pending = this.pending;
    if (pending) {
      this.finishPending();
      pending.reject(new Error('Local speech worker became unavailable.'));
    }
    if (hadStarted) {
      this.resetStartup();
      this.launch();
    } else this.rejectStartup(new Error('Local speech worker became unavailable.'));
  }

  private finishPending() {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.abort && pending.signal?.removeEventListener('abort', pending.abort);
    this.pending = null;
    pending.releaseDrain();
  }

  private async waitUntilReady(signal?: AbortSignal) {
    if (!signal) return this.ready();
    if (signal.aborted) throw abortError();
    let onAbort: (() => void) | undefined;
    try {
      await Promise.race([this.ready(), new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
      })]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  async request(payload: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal) {
    await this.waitUntilReady(signal);
    let claimedHere = false;
    try {
      if (this.pending) {
        const draining = this.pending;
        if (!draining.settled || this.waiting || this.claimed) throw new Error('Local speech worker is busy.');
        this.waiting = true;
        try { await this.waitForDrain(draining, timeoutMs, signal); }
        finally { this.waiting = false; }
        if (signal?.aborted) throw abortError();
        this.claimed = true;
        claimedHere = true;
        await this.waitUntilReady(signal);
      } else {
        if (this.waiting || this.claimed) throw new Error('Local speech worker is busy.');
        this.claimed = true;
        claimedHere = true;
      }
      if (signal?.aborted) throw abortError();
      if (!this.child || this.state !== 'ready') throw new Error('Local speech worker is unavailable.');
      if (this.pending) throw new Error('Local speech worker is busy.');
      return await this.sendRequest(payload, timeoutMs, signal);
    } finally { if (claimedHere) this.claimed = false; }
  }

  private waitForDrain(pending: Pending, timeoutMs: number, signal?: AbortSignal) {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise<void>((resolveDrain, rejectDrain) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        if (signal && abort) signal.removeEventListener('abort', abort);
        if (error) rejectDrain(error); else resolveDrain();
      };
      const timer = setTimeout(() => finish(timeoutError()), timeoutMs);
      const abort = signal ? () => finish(abortError()) : undefined;
      if (abort) signal!.addEventListener('abort', abort, { once: true });
      pending.drained.then(() => finish());
    });
  }

  private sendRequest(payload: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal) {
    const child = this.child;
    if (!child) return Promise.reject(new Error('Local speech worker is unavailable.'));
    const id = randomUUID();
    return new Promise<string>((resolveRequest, rejectRequest) => {
      let releaseDrain!: () => void;
      const pending: Pending = {
        id, resolve: resolveRequest, reject: rejectRequest,
        timer: setTimeout(() => this.interrupt(child, pending, timeoutError()), timeoutMs),
        signal, settled: false, drained: new Promise<void>(resolve => { releaseDrain = resolve; }), releaseDrain: () => releaseDrain(),
      };
      if (signal) {
        pending.abort = () => this.cancelRequest(child, pending, abortError());
        signal.addEventListener('abort', pending.abort, { once: true });
      }
      this.pending = pending;
      try { child.stdin.write(`${JSON.stringify({ ...payload, id })}\n`); }
      catch { this.interrupt(child, pending, new Error('Local speech worker became unavailable.')); }
    });
  }

  private interrupt(child: ChildProcessWithoutNullStreams, pending: Pending & { signal?: AbortSignal }, error: Error) {
    if (this.child !== child || this.pending !== pending) return;
    this.finishPending();
    pending.reject(error);
    // Kill the in-flight worker so a late result cannot be associated with a later request.
    this.child = null;
    this.state = 'unavailable';
    child.kill();
    this.resetStartup();
    this.launch();
  }

  private cancelRequest(child: ChildProcessWithoutNullStreams, pending: Pending, error: Error) {
    if (this.child !== child || this.pending !== pending || pending.settled) return;
    pending.settled = true;
    pending.abort && pending.signal?.removeEventListener('abort', pending.abort);
    // Model inference cannot stop mid-call; suppress its output and retain the warm worker.
    try { child.stdin.write(`${JSON.stringify({ type: 'cancel', id: pending.id })}\n`); }
    catch { this.interrupt(child, pending, error); return; }
    pending.reject(error);
  }
}

export interface LocalSpeechOptions {
  /** Test seam for a fake line worker; production callers should use the pinned defaults. */
  workerSpecs?: { kokoro: ChildSpec; asr: ChildSpec };
}

export function validateSpeechText(text: string) {
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > MAX_TEXT_CHARS) {
    throw new RangeError(`Speech text must contain 1–${MAX_TEXT_CHARS} characters.`);
  }
  return text.trim();
}

/** A synthesis-only pronunciation alias; displayed text, transcript, and care data remain unchanged. */
export function kokoroPronunciationInput(text: string) {
  return text.replace(/\brehab\b/gi, match => match === match.toUpperCase() ? 'REEHAB' :
    match[0] === match[0].toUpperCase() ? 'Reehab' : 'reehab');
}

export function validateWav(wav: Buffer) {
  if (!Buffer.isBuffer(wav) || wav.length < 44 || wav.length > MAX_WAV_BYTES ||
      wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new RangeError('Speech audio must be a WAV file no larger than 10 MiB.');
  }
}

function defaultWorkerSpecs(): { kokoro: ChildSpec; asr: ChildSpec } {
  const root = resolve(process.cwd());
  const runtime = resolve(root, '.local/speech/kokoro-runtime');
  const python = resolve(root, '.local/speech/runtime/venv/Scripts/python.exe');
  const commonEnv: NodeJS.ProcessEnv = {
    SystemRoot: process.env.SystemRoot,
    PATH: process.env.PATH,
    TEMP: process.env.TEMP,
    HF_HUB_OFFLINE: '1',
    HF_HUB_DISABLE_IMPLICIT_TOKEN: '1',
    HF_HUB_DISABLE_TELEMETRY: '1',
    PYTHONUNBUFFERED: '1',
    OMP_NUM_THREADS: '4', OPENBLAS_NUM_THREADS: '4', MKL_NUM_THREADS: '4',
  };
  return {
    kokoro: { executable: process.execPath, args: [resolve(root, 'scripts/local-speech-worker.mjs'), 'kokoro'], cwd: root,
      env: { ...commonEnv, KOKORO_RUNTIME: runtime, KOKORO_CACHE: resolve(root, '.local/speech/kokoro-cache') } },
    asr: { executable: python, args: [resolve(root, 'scripts/local-speech-worker.py'), 'asr'], cwd: root,
      env: { ...commonEnv, HF_HOME: resolve(root, '.local/speech/runtime/model-cache'), HF_HUB_OFFLINE: '1' } },
  };
}

/** Warm, bounded, local Kokoro Heart synthesis and faster-whisper small.en transcription. */
export class LocalSpeech {
  private readonly kokoro: WarmWorker;
  private readonly asr: WarmWorker;
  private readonly greetingAudio = new Map<string, { wav: Buffer; expiresAt: number }>();

  constructor(options: LocalSpeechOptions = {}) {
    const specs = options.workerSpecs ?? defaultWorkerSpecs();
    this.kokoro = new WarmWorker(specs.kokoro);
    this.asr = new WarmWorker(specs.asr);
  }

  async ready() { await Promise.all([this.kokoro.ready(), this.asr.ready()]); }
  readiness(): LocalSpeechReadiness { return { kokoro: this.kokoro.readiness(), asr: this.asr.readiness() }; }

  async synthesize(text: string, signal?: AbortSignal): Promise<Buffer> {
    const clean = validateSpeechText(text);
    if (isGreetingForCache(clean)) {
      const cached = this.getCachedGreeting(clean);
      if (cached) {
        if (signal?.aborted) throw abortError();
        return Buffer.from(cached);
      }
    }
    const encoded = await this.kokoro.request({ type: 'synthesize', text: kokoroPronunciationInput(clean) }, SYNTHESIS_TIMEOUT_MS, signal);
    if (signal?.aborted) throw abortError();
    if (encoded.length > Math.ceil(MAX_WAV_BYTES * 4 / 3) + 8 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new Error('Local speech worker returned invalid audio.');
    }
    const wav = Buffer.from(encoded, 'base64');
    validateWav(wav);
    if (isGreetingForCache(clean) && wav.length <= GREETING_CACHE_MAX_BYTES) this.cacheGreeting(clean, wav);
    return wav;
  }

  async transcribe(wav: Buffer, signal?: AbortSignal): Promise<string> {
    validateWav(wav);
    const text = await this.asr.request({ type: 'transcribe', wav: wav.toString('base64') }, TRANSCRIPTION_TIMEOUT_MS, signal);
    if (text.length > 4000) throw new RangeError('Transcription result is too long.');
    return text;
  }

  async close() {
    this.greetingAudio.clear();
    await Promise.all([this.kokoro.close(), this.asr.close()]);
  }

  private getCachedGreeting(text: string) {
    const now = Date.now();
    for (const [key, entry] of this.greetingAudio) if (entry.expiresAt <= now) this.greetingAudio.delete(key);
    const entry = this.greetingAudio.get(text);
    if (!entry) return undefined;
    this.greetingAudio.delete(text);
    this.greetingAudio.set(text, entry); // bounded LRU
    return entry.wav;
  }

  private cacheGreeting(text: string, wav: Buffer) {
    this.greetingAudio.delete(text);
    while (this.greetingAudio.size >= GREETING_CACHE_MAX_ENTRIES ||
      [...this.greetingAudio.values()].reduce((total, item) => total + item.wav.length, 0) + wav.length > GREETING_CACHE_MAX_BYTES) {
      const oldest = this.greetingAudio.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      this.greetingAudio.delete(oldest);
    }
    this.greetingAudio.set(text, { wav: Buffer.from(wav), expiresAt: Date.now() + GREETING_CACHE_TTL_MS });
  }
}

function isGreetingForCache(text: string) {
  return /^Hi [^,\r\n]{1,80}, what can I help with\?$/i.test(text);
}
