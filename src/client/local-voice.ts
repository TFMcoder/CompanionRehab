import { api, type ConversationReply } from './api';
import { SpeechActivityGate } from './speech-activity';

export type LocalVoiceState = 'connecting' | 'thinking' | 'listening' | 'speaking' | 'closing' | 'stopped' | 'error';
export interface LocalVoiceOptions {
  signal?: AbortSignal;
  onReady?: (handle: LocalVoiceHandle) => void;
  onState: (state: LocalVoiceState, message?: string) => void;
  onTranscript: (speaker: 'you' | 'nancy', text: string) => void;
  onChange: () => void;
  onNavigate: (view: string) => void;
}
export interface LocalVoiceHandle { stop: () => Promise<void>; sendText: (text: string) => Promise<void>; interrupt: () => void }

const endSilenceMs = 900;
const idleMs = 30_000;
const graceMs = 10_000;
// Leave room for the buffered onset below inside the server's 45-second WAV bound.
const maxUtteranceMs = 44_000;

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
  // Unlock audio and request the microphone directly from the button gesture.
  const context = new AudioContext();
  const unlocked = context.resume();
  let closed = false;
  const streamPromise = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  void streamPromise.then(late => { if (closed) late.getTracks().forEach(track => track.stop()); }).catch(() => undefined);
  let stream: MediaStream | undefined, source: MediaStreamAudioSourceNode | undefined, processor: ScriptProcessorNode | undefined;
  let merger: ChannelMergerNode | undefined, silent: GainNode | undefined;
  let playback: AudioBufferSourceNode | undefined, playbackDone: (() => void) | undefined;
  let sessionId: string | undefined, listening = false, working = false, automaticInterrupt = false;
  let monitor: ReturnType<typeof setInterval> | undefined;
  let chunks: Float32Array[] = [], preRoll: Float32Array[] = [], utteranceStarted = 0, lastSound = 0, quietStarted = 0, graceStarted = 0;
  let generation = 0, replyController = new AbortController();
  let interruptBarrier: Promise<void> = Promise.resolve();  let interruptionFailed = false;
  const activity = new SpeechActivityGate(context.sampleRate);

  const stopPlayback = () => {
    const node = playback; playback = undefined;
    const done = playbackDone; playbackDone = undefined;
    try { node?.stop(); } catch { /* already ended */ }
    node?.disconnect(); done?.();
  };
  const stop = async () => {
    if (closed) return;
    closed = true; generation++; controller.abort(); replyController.abort(); listening = false;
    clearInterval(monitor); stopPlayback();
    processor?.disconnect(); source?.disconnect(); merger?.disconnect(); silent?.disconnect();
    stream?.getTracks().forEach(track => track.stop()); chunks = []; preRoll = [];
    await context.close().catch(() => undefined);
    window.removeEventListener('pagehide', onLeave);
    options.signal?.removeEventListener('abort', onLeave);
    options.onState('stopped');
    if (sessionId) await api.conversationEnd(sessionId).catch(() => undefined);
  };
  const onLeave = () => { void stop(); };
  const assertOpen = () => { if (closed || signal.aborted) throw new Error('Conversation ended.'); };
  const assertTurn = (ticket: number) => {
    assertOpen();
    if (ticket !== generation) throw new DOMException('Reply interrupted.', 'AbortError');
  };
  const startListening = (message = 'Nancy is listening. Speak normally, or type below.') => {
    if (closed) return;
    chunks = []; utteranceStarted = 0; lastSound = 0; graceStarted = 0;
    quietStarted = Date.now(); listening = true; working = false;
    options.onState('listening', message);
  };
  const interrupt = () => {
    if (closed || !sessionId || !working) return;
    generation++; replyController.abort(); stopPlayback();    interruptionFailed = false;
    startListening('Go ahead, Nancy is listening.');
    // New speech may be captured immediately, but no next command goes out until
    // the server has invalidated the old reply/review and cancelled its turn.
    interruptBarrier = api.conversationInterrupt(sessionId, signal).then(() => { options.onChange(); });
    void interruptBarrier.catch(() => {
      if (!closed) { interruptionFailed = true; listening = false; working = false; options.onState('error', 'Nancy could not confirm the interruption. End the conversation and reopen it; check My Day for saved changes.'); }
    });
  };
  const handle: LocalVoiceHandle = { stop, sendText: text => sendText(text), interrupt };
  const speak = async (replyId: string, speechParts: number | undefined, ticket: number, opening: boolean) => {
    assertTurn(ticket);
    if (!replyId || !sessionId) throw new Error('Nancy did not return an audio reply.');
    options.onState(opening ? 'connecting' : 'thinking', opening ? 'Preparing Nancy’s greeting…' : 'Preparing Nancy’s reply…');
    const count = speechParts ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 32) throw new Error('Nancy returned an invalid audio reply.');
    const turnSignal = AbortSignal.any([signal, replyController.signal]);
    const getPart = async (part: number) => {
      const query = `turn_id=${encodeURIComponent(replyId)}${speechParts === undefined ? '' : `&part=${part}`}`;
      const response = await fetch(`/api/conversation/${encodeURIComponent(sessionId!)}/speech?${query}`, {
        credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([turnSignal, AbortSignal.timeout(60_000)]),
      });
      if (!response.ok) throw new Error('Nancy audio could not play. The reply is available as text.');
      const bytes = await response.arrayBuffer(); assertTurn(ticket);
      const audio = await context.decodeAudioData(bytes); assertTurn(ticket); return audio;
    };
    let current = await getPart(0);
    for (let part = 0; part < count; part++) {
      assertTurn(ticket);
      const next = part + 1 < count ? getPart(part + 1).then(audio => ({ audio }), error => ({ error })) : undefined;
      await new Promise<void>(resolve => {
        const node = context.createBufferSource(); playback = node; node.buffer = current;
        node.connect(context.destination); if (merger) node.connect(merger, 0, 1);
        playbackDone = resolve;
        node.onended = () => {
          if (playback === node) { playback = undefined; playbackDone = undefined; }
          node.disconnect(); resolve();
        };
        options.onState('speaking', automaticInterrupt ? 'Nancy is speaking. Speak to interrupt, or tap Interrupt Nancy.' : 'Nancy is speaking. Tap Interrupt Nancy to take your turn.');
        node.start();
      });
      assertTurn(ticket);
      if (next) { const fetched = await next; if ('error' in fetched) throw fetched.error; current = fetched.audio; }
    }
    assertTurn(ticket);
    await api.conversationPlayed(sessionId, replyId, turnSignal); assertTurn(ticket);
  };
  const applyReply = async (reply: ConversationReply, ticket: number, typed = false, opening = false) => {
    if (closed || ticket !== generation) return;
    if (reply.transcript && !typed) options.onTranscript('you', reply.transcript);
    if (reply.navigate) options.onNavigate(reply.navigate);
    if (reply.changed) options.onChange();
    if (typeof reply.text !== 'string' || !reply.text.trim()) throw new Error('Nancy returned an empty reply.');
    options.onTranscript('nancy', reply.text);
    try { await speak(reply.reply_id, reply.speech_parts, ticket, opening); }
    catch (error) { if (closed || ticket === generation) throw error; return; }
    if (!closed && ticket === generation) startListening();
  };
  const sendAudio = async () => {
    if (closed || !listening || working || !sessionId || !chunks.length) return;
    listening = false; working = true; graceStarted = 0;
    const ticket = ++generation; replyController = new AbortController();
    const turnSignal = AbortSignal.any([signal, replyController.signal]);
    const audio = wavPcm16(chunks, context.sampleRate); chunks = []; preRoll = [];
    options.onState('thinking', 'Nancy is thinking…');
    try {
      await interruptBarrier; assertTurn(ticket);
      const reply = await api.conversationAudio(sessionId, base64(audio), crypto.randomUUID(), turnSignal);
      await applyReply(reply, ticket);
    } catch {
      if (!closed && !interruptionFailed && ticket === generation) startListening('That turn was not confirmed. Check the displayed plan before trying again.');
    }
  };
  const sendText = async (text: string) => {
    const value = text.trim(); if (!value || closed || !sessionId) return;
    if (working) interrupt();
    listening = false; working = true; graceStarted = 0;
    const ticket = ++generation; replyController = new AbortController();
    const turnSignal = AbortSignal.any([signal, replyController.signal]);
    options.onTranscript('you', value); options.onState('thinking', 'Nancy is thinking…');
    try {
      await interruptBarrier; assertTurn(ticket);
      await applyReply(await api.conversationTurn(sessionId, value, crypto.randomUUID(), turnSignal), ticket, true);
    } catch {
      if (!closed && !interruptionFailed && ticket === generation) startListening('That turn was not confirmed. Check the displayed plan before trying again.');
    }
  };
  window.addEventListener('pagehide', onLeave);
  options.signal?.addEventListener('abort', onLeave, { once: true });
  try {
    options.onState('connecting', 'Starting Nancy…');
    await unlocked; stream = await streamPromise; assertOpen();
    // Only enable acoustic interruption when the browser confirms AEC is active.
    automaticInterrupt = stream.getAudioTracks?.()[0]?.getSettings?.().echoCancellation === true;
    const first = await api.conversationStart(signal);
    if (typeof first.session_id !== 'string' || !first.session_id) throw new Error('Nancy did not start a conversation.');
    sessionId = first.session_id;
    if (closed) { await api.conversationEnd(sessionId).catch(() => undefined); throw new Error('Conversation ended.'); }
    assertOpen();
    source = context.createMediaStreamSource(stream);
    merger = context.createChannelMerger(2);
    processor = context.createScriptProcessor(2048, 2, 1);
    silent = context.createGain(); silent.gain.value = 0;
    source.connect(merger, 0, 0); merger.connect(processor); processor.connect(silent); silent.connect(context.destination);
    processor.onaudioprocess = event => {
      if (closed || (!listening && !working)) return;
      const chunk = new Float32Array(event.inputBuffer.getChannelData(0));
      const reference = event.inputBuffer.numberOfChannels > 1 ? event.inputBuffer.getChannelData(1) : new Float32Array(chunk.length);
      const detected = activity.observe(chunk, reference, working);
      const now = Date.now();
      preRoll.push(chunk);
      while (preRoll.reduce((n, c) => n + c.length, 0) > context.sampleRate * (working ? 0.8 : 0.25)) preRoll.shift();
      if (working) {
        if (!automaticInterrupt || !detected.interrupt) return;
        const lead = preRoll.slice(); interrupt();
        chunks = lead; utteranceStarted = now; lastSound = now; preRoll = []; return;
      }
      if (detected.speech) {
        if (!utteranceStarted) { utteranceStarted = now; chunks.push(...preRoll.slice(0, -1)); }
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
    working = true;
    options.onReady?.(handle);
    const ticket = generation;
    await applyReply(first, ticket, false, true); assertOpen();
    return handle;
  } catch (error) {
    await stop();
    const permissionDenied = error !== null && typeof error === 'object' && 'name' in error && error.name === 'NotAllowedError';
    const message = permissionDenied ? 'Microphone permission was not granted. You can use the day views and try again.'
      : error instanceof Error ? error.message : 'Nancy could not start. You can use the day views.';
    options.onState('error', message); throw new Error(message);
  }
}
