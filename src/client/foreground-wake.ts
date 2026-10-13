import { wavPcm16 } from './local-voice';
import { SpeechActivityGate } from './speech-activity';

export type WakeStatus = 'starting' | 'listening' | 'checking' | 'stopped' | 'error';
export interface ForegroundWakeOptions {
  signal?: AbortSignal;
  onStatus: (status: WakeStatus, message: string) => void;
  onWake: () => void | Promise<void>;
}
export interface ForegroundWakeHandle { stop: () => Promise<void> }

const END_SILENCE_MS = 600;
const MAX_UTTERANCE_MS = 3_500;
const MAX_WAV_BYTES = 160_044;
const MIN_REQUEST_INTERVAL_MS = 1_500;

export function foregroundWakeSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === true &&
    !!navigator.mediaDevices?.getUserMedia && typeof window.AudioContext === 'function' &&
    typeof window.btoa === 'function';
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

/** Started only by an explicit user action. No audio or consent survives this handle. */
export async function startForegroundWake(options: ForegroundWakeOptions): Promise<ForegroundWakeHandle> {
  if (!foregroundWakeSupported()) throw new Error('Foreground wake needs HTTPS and microphone access in a supported browser. Use Talk to Nancy.');
  if (document.visibilityState !== 'visible') throw new Error('Open My Day to enable foreground wake.');
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  const context = new AudioContext();
  let consentToken: string | undefined;
  let closed = false, invalidated = false, stream: MediaStream | undefined, source: MediaStreamAudioSourceNode | undefined;
  let processor: ScriptProcessorNode | undefined, silent: GainNode | undefined;
  let chunks: Float32Array[] = [], preRoll: Float32Array[] = [];
  let startedAt = 0, lastSpeechAt = 0, nextAllowedAt = 0, checking = false;
  const gate = new SpeechActivityGate(context.sampleRate);
  const revoke = (token: string) => {
    // Keepalive lets pagehide and scope-change cleanup reach the local server.
    void fetch('/api/wake/consent/revoke', { method: 'POST', credentials: 'same-origin', cache: 'no-store', keepalive: true,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ consent_token: token }) }).catch(() => undefined);
  };
  const stop = async (reason: 'ordinary' | 'wake' | 'error' = 'ordinary', errorMessage?: string) => {
    if (reason !== 'wake') invalidated = true;
    if (closed) return;
    closed = true; controller.abort(); chunks = []; preRoll = [];
    if (consentToken) { revoke(consentToken); consentToken = undefined; }
    processor?.disconnect(); source?.disconnect(); silent?.disconnect();
    stream?.getTracks().forEach(track => track.stop());
    window.removeEventListener('pagehide', onLeave);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('nancy:session-expired', onLeave);
    window.removeEventListener('nancy:scope-changed', onLeave);
    options.signal?.removeEventListener('abort', onLeave);
    await context.close().catch(() => undefined);
    options.onStatus(reason === 'error' ? 'error' : 'stopped', errorMessage ?? 'Hey Nancy is off.');
  };
  const onLeave = () => { void stop(); };
  const onVisibility = () => { if (document.visibilityState !== 'visible') void stop(); };
  const handle: ForegroundWakeHandle = { stop: () => stop() };
  // The grant may resolve after Stop, navigation, or a scope change.
  const grant = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  void grant.then(late => { if (closed) late.getTracks().forEach(track => track.stop()); }).catch(() => undefined);
  // A token is minted only after this explicit start call. Keep this request
  // alive through Stop so a late success can be revoked instead of orphaned.
  const consent = fetch('/api/wake/consent', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) }).then(async response => {
    if (!response.ok) throw new Error('Foreground wake consent is unavailable. Use Talk to Nancy.');
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || !('consent_token' in value) ||
        typeof value.consent_token !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.consent_token))
      throw new Error('Foreground wake consent returned an invalid response.');
    if (closed || signal.aborted) { revoke(value.consent_token); throw new DOMException('Foreground wake stopped.', 'AbortError'); }
    consentToken = value.consent_token;
  });
  window.addEventListener('pagehide', onLeave);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('nancy:session-expired', onLeave);
  window.addEventListener('nancy:scope-changed', onLeave);
  options.signal?.addEventListener('abort', onLeave, { once: true });

  const check = async () => {
    if (closed || checking || !chunks.length) return;
    checking = true;
    const samples = chunks; chunks = []; preRoll = []; startedAt = 0; lastSpeechAt = 0;
    nextAllowedAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
    const audio = wavPcm16(samples, context.sampleRate);
    if (audio.length > MAX_WAV_BYTES || audio.length < 3_244) { checking = false; return; }
    options.onStatus('checking', 'Checking a short phrase on this computer…');
    try {
      const response = await fetch('/api/wake/recognize', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wav: base64(audio), consent_token: consentToken }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      });
      if (closed || signal.aborted) return;
      if (response.status === 401 || response.status === 403) {
        window.dispatchEvent(new Event(response.status === 401 ? 'nancy:session-expired' : 'nancy:scope-changed'));
        await stop(); return;
      }
      if (!response.ok) throw new Error('Local wake check is unavailable.');
      const result: unknown = await response.json();
      if (closed || signal.aborted) return;
      if (!result || typeof result !== 'object' || !('detected' in result) || typeof result.detected !== 'boolean')
        throw new Error('Local wake check returned an invalid response.');
      if (result.detected) { await stop('wake'); if (!invalidated) await options.onWake(); return; }
      options.onStatus('listening', 'Listening for “Hey Nancy” while this page is open.');
    } catch (error) {
      if (!closed && !signal.aborted) {
        await stop('error', error instanceof Error ? error.message : 'Local wake check is unavailable.');
      }
    } finally { checking = false; }
  };

  try {
    options.onStatus('starting', 'Requesting microphone for foreground wake…');
    await context.resume();
    [stream] = await Promise.all([grant, consent]);
    if (closed || signal.aborted || document.visibilityState !== 'visible') { await stop(); throw new DOMException('Foreground wake stopped.', 'AbortError'); }
    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(2048, 1, 1);
    silent = context.createGain(); silent.gain.value = 0;
    source.connect(processor); processor.connect(silent); silent.connect(context.destination);
    processor.onaudioprocess = event => {
      if (closed || checking || Date.now() < nextAllowedAt) return;
      const chunk = new Float32Array(event.inputBuffer.getChannelData(0));
      const now = Date.now();
      const speech = gate.observe(chunk, new Float32Array(chunk.length), false).speech;
      preRoll.push(chunk);
      // About 250 ms before detected onset; all other ambient samples are discarded.
      while (preRoll.reduce((total, part) => total + part.length, 0) > context.sampleRate / 4) preRoll.shift();
      if (speech) {
        if (!startedAt) { startedAt = now; chunks.push(...preRoll.slice(0, -1)); }
        lastSpeechAt = now;
      }
      if (startedAt) chunks.push(chunk);
      if (startedAt && (now - lastSpeechAt >= END_SILENCE_MS || now - startedAt >= MAX_UTTERANCE_MS)) void check();
    };
    options.onStatus('listening', 'Listening for “Hey Nancy” while this page is open.');
    return handle;
  } catch (error) {
    await stop();
    throw error;
  }
}
