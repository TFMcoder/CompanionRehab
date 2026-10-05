import { api, type ConversationReply } from './api';

export type LocalVoiceState = 'connecting' | 'thinking' | 'listening' | 'speaking' | 'closing' | 'stopped' | 'error';
export interface LocalVoiceOptions {
  signal?: AbortSignal;
  onState: (state: LocalVoiceState, message?: string) => void;
  onTranscript: (speaker: 'you' | 'nancy', text: string) => void;
  onChange: () => void;
  onNavigate: (view: string) => void;
}
export interface LocalVoiceHandle { stop: () => Promise<void>; sendText: (text: string) => Promise<void> }

const speechThreshold = 0.018;
const endSilenceMs = 1200;
const idleMs = 30_000;
const graceMs = 10_000;
const maxUtteranceMs = 45_000;

function resample(input: Float32Array, sourceRate: number, targetRate = 16_000): Float32Array {
  if (sourceRate === targetRate) return input;
  const length = Math.max(1, Math.round(input.length * targetRate / sourceRate));
  const output = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const position = index * sourceRate / targetRate;
    const before = Math.min(input.length - 1, Math.floor(position));
    const after = Math.min(input.length - 1, before + 1);
    output[index] = input[before] + (input[after] - input[before]) * (position - before);
  }
  return output;
}
export function wavPcm16(chunks: Float32Array[], sourceRate: number): Uint8Array {
  const total = chunks.reduce((count, chunk) => count + chunk.length, 0);
  const joined = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  const samples = resample(joined, sourceRate);
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const label = (offset: number, value: string) => { for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index)); };
  label(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); label(8, 'WAVE'); label(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true); view.setUint32(28, 32_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  label(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767), true);
  }
  return bytes;
}
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export async function startLocalVoice(options: LocalVoiceOptions): Promise<LocalVoiceHandle> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioContext)
    throw new Error('Microphone and audio need HTTPS in a supported browser. You can still use the day views.');
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  // Called synchronously from the Talk button gesture, before the first await.
  const context = new AudioContext();
  const unlocked = context.resume();
  let closed = false;
  const streamPromise = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  void streamPromise.then(lateStream => { if (closed) lateStream.getTracks().forEach(track => track.stop()); }).catch(() => undefined);
  let stream: MediaStream | undefined, source: MediaStreamAudioSourceNode | undefined, processor: ScriptProcessorNode | undefined;
  let playback: AudioBufferSourceNode | undefined, playbackDone: (() => void) | undefined;
  let sessionId: string | undefined, listening = false, working = false;
  let monitor: ReturnType<typeof setInterval> | undefined;
  let chunks: Float32Array[] = [], utteranceStarted = 0, lastSound = 0, quietStarted = 0, graceStarted = 0;
  let generation = 0;

  const stop = async () => {
    if (closed) return;
    closed = true; generation++; controller.abort(); listening = false;
    clearInterval(monitor);
    processor?.disconnect(); source?.disconnect(); stream?.getTracks().forEach(track => track.stop());
    try { playback?.stop(); } catch { /* already ended */ }
    playbackDone?.(); playback = undefined;
    await context.close().catch(() => undefined);
    window.removeEventListener('pagehide', onLeave);
    options.signal?.removeEventListener('abort', onLeave);
    options.onState('stopped');
    if (sessionId) await api.conversationEnd(sessionId).catch(() => undefined);
  };
  const onLeave = () => { void stop(); };
  const assertOpen = () => { if (closed || signal.aborted) throw new Error('Conversation ended.'); };
  const startListening = (message = 'Nancy is listening. Speak normally, or type below.') => {
    if (closed) return;
    chunks = []; utteranceStarted = 0; lastSound = 0; graceStarted = 0;
    quietStarted = Date.now(); listening = true; working = false;
    options.onState('listening', message);
  };
  const speak = async (replyId: string, speechParts?: number) => {
    assertOpen();
    if (!replyId || !sessionId) throw new Error('Nancy did not return an audio reply.');
    options.onState('speaking', 'Nancy is speaking. Listening will resume afterward.');
    const count = speechParts ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 32) throw new Error('Nancy returned an invalid audio reply.');
    const getPart = async (part: number) => {
      const query = `turn_id=${encodeURIComponent(replyId)}${speechParts === undefined ? '' : `&part=${part}`}`;
      const response = await fetch(`/api/conversation/${encodeURIComponent(sessionId!)}/speech?${query}`, {
        credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
      });
      if (!response.ok) throw new Error('Nancy audio could not play. The reply is available as text.');
      const bytes = await response.arrayBuffer();
      assertOpen();
      return context.decodeAudioData(bytes);
    };
    let current = await getPart(0);
    for (let part = 0; part < count; part++) {
      assertOpen();
      // Fetch/decode exactly one following sentence while this one is playing.
      const next = part + 1 < count
        ? getPart(part + 1).then(audio => ({ audio }), error => ({ error }))
        : undefined;
      await new Promise<void>(resolve => {
        const node = context.createBufferSource(); playback = node; node.buffer = current; node.connect(context.destination);
        playbackDone = resolve;
        node.onended = () => { if (playback === node) playback = undefined; playbackDone = undefined; resolve(); };
        node.start();
      });
      assertOpen();
      if (next) {
        const fetched = await next;
        if ('error' in fetched) throw fetched.error;
        current = fetched.audio;
      }
    }
    await api.conversationPlayed(sessionId, replyId, signal);
    assertOpen();
  };
  const applyReply = async (reply: ConversationReply, ticket: number, typed = false) => {
    if (closed || ticket !== generation) return;
    if (reply.transcript && !typed) options.onTranscript('you', reply.transcript);
    if (reply.navigate) options.onNavigate(reply.navigate);
    if (reply.changed) options.onChange();
    if (typeof reply.text !== 'string' || !reply.text.trim()) throw new Error('Nancy returned an empty reply.');
    options.onTranscript('nancy', reply.text);
    await speak(reply.reply_id, (reply as ConversationReply & { speech_parts?: number }).speech_parts);
    if (!closed && ticket === generation) startListening();
  };
  const sendAudio = async () => {
    if (closed || !listening || working || !sessionId || !chunks.length) return;
    listening = false; working = true; graceStarted = 0;
    const ticket = ++generation;
    const audio = wavPcm16(chunks, context.sampleRate); chunks = [];
    options.onState('thinking', 'Nancy is thinking…');
    try {
      const reply = await api.conversationAudio(sessionId, base64(audio), crypto.randomUUID(), signal);
      await applyReply(reply, ticket);
    } catch (error) {
      if (!closed && ticket === generation) {
        startListening('That turn was not confirmed. Check the displayed plan before trying again.');
      }
    }
  };
  const sendText = async (text: string) => {
    const value = text.trim();
    if (!value || closed || working || !sessionId) return;
    listening = false; working = true; graceStarted = 0;
    const ticket = ++generation;
    options.onTranscript('you', value);
    options.onState('thinking', 'Nancy is thinking…');
    try { await applyReply(await api.conversationTurn(sessionId, value, crypto.randomUUID(), signal), ticket, true); }
    catch (error) {
      if (!closed && ticket === generation) {
        startListening('That turn was not confirmed. Check the displayed plan before trying again.');
      }
    }
  };
  // The permission prompt can remain open; Stop must work while it is pending.
  window.addEventListener('pagehide', onLeave);
  options.signal?.addEventListener('abort', onLeave, { once: true });
  try {
    options.onState('connecting', 'Starting Nancy…');
    await unlocked;
    stream = await streamPromise;
    assertOpen();
    const first = await api.conversationStart(signal);
    if (typeof first.session_id !== 'string' || !first.session_id) throw new Error('Nancy did not start a conversation.');
    sessionId = first.session_id;
    if (closed) { await api.conversationEnd(sessionId).catch(() => undefined); throw new Error('Conversation ended.'); }
    assertOpen();
    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(4096, 1, 1);
    const silent = context.createGain(); silent.gain.value = 0;
    source.connect(processor); processor.connect(silent); silent.connect(context.destination);
    processor.onaudioprocess = event => {
      if (!listening || closed || working) return;
      const input = event.inputBuffer.getChannelData(0);
      const chunk = new Float32Array(input);
      const rms = Math.sqrt(chunk.reduce((sum, sample) => sum + sample * sample, 0) / chunk.length);
      const now = Date.now();
      if (rms >= speechThreshold) {
        if (!utteranceStarted) utteranceStarted = now;
        lastSound = now; quietStarted = now; graceStarted = 0;
      }
      if (utteranceStarted) chunks.push(chunk);
      if (utteranceStarted && ((lastSound && now - lastSound >= endSilenceMs) || now - utteranceStarted >= maxUtteranceMs)) void sendAudio();
    };
    monitor = setInterval(() => {
      if (!listening || closed || working || utteranceStarted) return;
      const now = Date.now();
      if (!graceStarted && now - quietStarted >= idleMs) {
        graceStarted = now; options.onState('closing', 'Still there? Nancy will close in 10 seconds. Speak or type to continue.');
      } else if (graceStarted && now - graceStarted >= graceMs) void stop();
    }, 250);
    const ticket = generation;
    await applyReply(first, ticket); // Greeting is spoken before microphone processing begins.
    assertOpen();
    return { stop, sendText };
  } catch (error) {
    await stop();
    const permissionDenied = error !== null && typeof error === 'object' && 'name' in error && error.name === 'NotAllowedError';
    const message = permissionDenied ? 'Microphone permission was not granted. You can use the day views and try again.'
      : error instanceof Error ? error.message : 'Nancy could not start. You can use the day views.';
    options.onState('error', message);
    throw new Error(message);
  }
}
