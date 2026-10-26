import { api, ApiError, notifyAuthorizationFailure, type ConversationReply } from './api';
import { SpeechActivityGate } from './speech-activity';
import { reportVoiceTiming, voiceTimingMetric, type VoiceTiming } from './voice-timing';
import type {ConversationPurpose} from '../shared/client-navigation';
import {keepConversationAwake} from './conversation-awake';
import type {ClientVoiceMetric} from '../shared/client-voice-metrics';
import type {SafariDetail} from '../shared/safari-study';
import {ownerVoiceStartupEnabled,waitForOwnerVoiceStartup} from './owner-voice-startup';

export interface VoiceObservation {
  conversation_id:string;turn_id:string|null;metric:ClientVoiceMetric;detail:SafariDetail;
  input_at:number;speech_ended_at:number|null;
}

export type LocalVoiceState = 'connecting' | 'thinking' | 'listening' | 'speaking' | 'closing' | 'stopped' | 'error';
export interface LocalVoiceOptions {
  purpose?:ConversationPurpose;
  signal?: AbortSignal;
  onReady?: (handle: LocalVoiceHandle) => void;
  onState: (state: LocalVoiceState, message?: string) => void;
  onTranscript: (speaker: 'you' | 'nancy', text: string) => void;
  onChange: () => void;
  onNavigate: (view: string) => void;
  /** Optional owner-study observer; failure must never hold up or cancel voice. No text/audio. */
  onObservation?: (observation:VoiceObservation) => void;
  /** Owner test build only: explicit browser gesture recovery for audio unlock. */
  onAudioUnlock?: (resume: (() => void) | null) => void;
}
export interface LocalVoiceHandle { stop: () => Promise<void>; sendText: (text: string) => Promise<void>; interrupt: () => void }

const endSilenceMs = 900;
const idleMs = 30_000;
const graceMs = 10_000;
const startupPermissionMs = 20_000;
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
  const openingAt = performance.now();
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioContext)
    throw new Error('Microphone and audio need HTTPS in a supported browser. You can still use the day views.');
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  // Unlock audio and request the microphone directly from the button gesture.
  const context = new AudioContext();
  const unlocked = context.resume();
  const ownerLifecycle = ownerVoiceStartupEnabled();
  let closed = false;
  let stream: MediaStream | undefined, source: MediaStreamAudioSourceNode | undefined, processor: ScriptProcessorNode | undefined;
  const streamPromise = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  // Keep the microphone handle as soon as it is granted. AudioContext.resume()
  // can remain pending independently, so Stop must release this early grant.
  void streamPromise.then(acquired => {
    if (closed) acquired.getTracks().forEach(track => track.stop());
    else stream = acquired;
  }).catch(() => undefined);
  let merger: ChannelMergerNode | undefined, silent: GainNode | undefined;
  let playback: AudioBufferSourceNode | undefined, playbackDone: (() => void) | undefined;
  let sessionId: string | undefined, listening = false, working = false;
  const releaseScreen=keepConversationAwake();
  let monitor: ReturnType<typeof setInterval> | undefined;
  let chunks: Float32Array[] = [], preRoll: Float32Array[] = [], utteranceStarted = 0, lastSound = 0, quietStarted = 0, graceStarted = 0;
  let lastSoundAt: number | null = null;
  let generation = 0, replyController = new AbortController();
  let interruptBarrier: Promise<void> = Promise.resolve();  let interruptionFailed = false;
  let terminalError: string | undefined;
  let detachLifecycle = () => {};
  const activity = new SpeechActivityGate(context.sampleRate);

  const stopPlayback = () => {
    const node = playback; playback = undefined;
    const done = playbackDone; playbackDone = undefined;
    try { node?.stop(); } catch { /* already ended */ }
    node?.disconnect(); done?.();
  };
  const stop = async (errorMessage?: string) => {
    if (closed) return;
    terminalError = errorMessage;
    closed = true; generation++; controller.abort(); replyController.abort(); listening = false;
    detachLifecycle();
    clearInterval(monitor); stopPlayback(); releaseScreen();
    processor?.disconnect(); source?.disconnect(); merger?.disconnect(); silent?.disconnect();
    stream?.getTracks().forEach(track => track.stop()); chunks = []; preRoll = [];
    // The browser may leave audio unlock pending while a permission prompt is open.
    // Closing is initiated immediately, but must not hold Stop or startup cancellation.
    void context.close().catch(() => undefined);
    window.removeEventListener('pagehide', onLeave);
    window.removeEventListener('nancy:session-expired',onLeave);
    window.removeEventListener('nancy:scope-changed',onLeave);
    options.signal?.removeEventListener('abort', onLeave);
    options.onState(errorMessage ? 'error' : 'stopped', errorMessage);
    if (sessionId) await api.conversationEnd(sessionId).catch(() => undefined);
  };
  const onLeave = () => { void stop(); };
  const assertOpen = () => { if (closed || signal.aborted) throw new Error(terminalError ?? 'Conversation ended.'); };
  const assertTurn = (ticket: number) => {
    assertOpen();
    if (ticket !== generation) throw new DOMException('Reply interrupted.', 'AbortError');
  };
  const startListening = (message = 'Nancy is listening. Speak normally, or type below.') => {
    if (closed) return;
    chunks = []; preRoll = []; activity.reset(); utteranceStarted = 0; lastSound = 0; graceStarted = 0;
    lastSoundAt = null;
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
      if (!closed) {
        interruptionFailed = true;
        void stop('Nancy could not confirm the interruption. The conversation is closed. Check My Day for saved changes, then reopen Nancy.');
      }
    });
  };
  const handle: LocalVoiceHandle = { stop, sendText: text => sendText(text), interrupt };
  const speak = async (replyId: string, speechParts: number | undefined, ticket: number, opening: boolean, onPlayback?: (detail:SafariDetail) => void) => {
    assertTurn(ticket);
    if (!replyId || !sessionId) throw new Error('Nancy did not return an audio reply.');
    options.onState(opening ? 'connecting' : 'thinking', opening ? 'Preparing Nancy’s greeting…' : 'Preparing Nancy’s reply…');
    const count = speechParts ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 32) throw new Error('Nancy returned an invalid audio reply.');
    const turnSignal = AbortSignal.any([signal, replyController.signal]);
    let firstDetail:SafariDetail={audio_headers_ms:null,audio_download_ms:null,audio_decode_ms:null,audio_preparation_server_ms:null,audio_bytes:null,
      sample_rate:context.sampleRate,context_state:'unknown'};
    const getPart = async (part: number) => {
      const fetchAt=performance.now();
      const query = `turn_id=${encodeURIComponent(replyId)}${speechParts === undefined ? '' : `&part=${part}`}`;
      const response = await fetch(`/api/conversation/${encodeURIComponent(sessionId!)}/speech?${query}`, {
        credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([turnSignal, AbortSignal.timeout(60_000)]),
      });
      if (!response.ok) {
        const body=await response.json().catch(()=>({}));
        notifyAuthorizationFailure(response.status,body.error?.code);
        throw new ApiError(response.status,body.error?.code??'audio_unavailable','Nancy audio could not play. The reply is available as text.');
      }
      const headersAt=performance.now();
      const bytes = await response.arrayBuffer(); assertTurn(ticket);
      const receivedAt=performance.now();
      const audio = await context.decodeAudioData(bytes); assertTurn(ticket);
      const serverTiming=response.headers?.get('Server-Timing')?.match(/(?:^|,)\s*nancy_audio;dur=([0-9]+(?:\.[0-9]+)?)(?:,|$)/);
      if(part===0)firstDetail={audio_headers_ms:Math.round(headersAt-fetchAt),audio_download_ms:Math.round(receivedAt-headersAt),audio_preparation_server_ms:serverTiming?Number(serverTiming[1]):null,
        audio_decode_ms:Math.round(performance.now()-receivedAt),audio_bytes:bytes.byteLength,sample_rate:context.sampleRate,
        context_state:['running','suspended','interrupted','closed'].includes(context.state)?context.state as SafariDetail['context_state']:'unknown'};
      return audio;
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
        options.onState('speaking', 'Nancy is speaking. Your turn is next.');
        node.start();
        if (part === 0) onPlayback?.(firstDetail);
      });
      assertTurn(ticket);
      if (next) { const fetched = await next; if ('error' in fetched) throw fetched.error; current = fetched.audio; }
    }
    assertTurn(ticket);
    await api.conversationPlayed(sessionId, replyId, turnSignal); assertTurn(ticket);
  };
  const applyReply = async (reply: ConversationReply, ticket: number, typed = false, opening = false, timing?: VoiceTiming) => {
    if (closed || ticket !== generation) return;
    if (timing && timing.repliedAt === undefined) timing.repliedAt = performance.now();
    if (reply.transcript && !typed) options.onTranscript('you', reply.transcript);
    if (reply.navigate) options.onNavigate(reply.navigate);
    if (reply.changed) options.onChange();
    if (typeof reply.text !== 'string' || !reply.text.trim()) throw new Error('Nancy returned an empty reply.');
    options.onTranscript('nancy', reply.text);
    // The saved result is now retained by the UI. Receipt acknowledgement is
    // independent of audio, and must not delay speech or fail the conversation.
    // A lost request leaves the server's exact command available for recovery.
    if(reply.acknowledgement_required&&sessionId)
      void api.conversationReceived(sessionId,reply.reply_id,signal).catch(()=>undefined);
    try { await speak(reply.reply_id, reply.speech_parts, ticket, opening, timing ? detail => {
      const metric=voiceTimingMetric(timing,reply,performance.now(),context.outputLatency);
      if (sessionId) {
        reportVoiceTiming(sessionId,metric,signal);
        try{options.onObservation?.({conversation_id:sessionId,turn_id:timing.turnId??null,metric,detail,input_at:timing.inputAt,speech_ended_at:timing.speechEndedAt});}catch{/* Study observations cannot interrupt voice. */}
      }
    } : undefined); }
    catch (error) { if (closed || ticket === generation) throw error; return; }
    if (!closed && ticket === generation) startListening();
  };
  const sendAudio = async () => {
    if (closed || !listening || working || !sessionId || !chunks.length) return;
    listening = false; working = true; graceStarted = 0;
    const ticket = ++generation; replyController = new AbortController();
    const turnSignal = AbortSignal.any([signal, replyController.signal]);
    const timing: VoiceTiming = {inputMode: 'speech', inputAt: lastSoundAt ?? performance.now(), speechEndedAt: lastSoundAt, requestAt: performance.now()};
    const audio = wavPcm16(chunks, context.sampleRate); chunks = []; preRoll = [];
    options.onState('thinking', 'Nancy is thinking…');
    try {
      await interruptBarrier; assertTurn(ticket);
      timing.turnId=crypto.randomUUID();
      const reply = await api.conversationAudio(sessionId, base64(audio), timing.turnId, turnSignal);
      await applyReply(reply, ticket, false, false, timing);
    } catch {
      if (!closed && !interruptionFailed && ticket === generation) startListening('That turn was not confirmed. Check the displayed plan before trying again.');
    }
  };
  const sendText = async (text: string) => {
    const value = text.trim(); if (!value || closed || !sessionId) return;
    if (working) return;
    listening = false; working = true; graceStarted = 0;
    const ticket = ++generation; replyController = new AbortController();
    const turnSignal = AbortSignal.any([signal, replyController.signal]);
    const timing: VoiceTiming = {inputMode: 'typed', inputAt: performance.now(), speechEndedAt: null, requestAt: performance.now()};
    options.onTranscript('you', value); options.onState('thinking', 'Nancy is thinking…');
    try {
      await interruptBarrier; assertTurn(ticket);
      timing.turnId=crypto.randomUUID();
      await applyReply(await api.conversationTurn(sessionId, value, timing.turnId, turnSignal), ticket, true, false, timing);
    } catch {
      if (!closed && !interruptionFailed && ticket === generation) startListening('That turn was not confirmed. Check the displayed plan before trying again.');
    }
  };
  window.addEventListener('pagehide', onLeave);
  window.addEventListener('nancy:session-expired',onLeave);
  window.addEventListener('nancy:scope-changed',onLeave);
  options.signal?.addEventListener('abort', onLeave, { once: true });
  const waitForStartup = () => new Promise<MediaStream>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, ready?: MediaStream) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(ready!);
    };
    const onAbort = () => finish(new Error('Conversation ended.'));
    const timer = setTimeout(() => finish(new Error('Microphone or audio permission did not finish within 20 seconds. Check your browser’s permission prompt, then try Talk to Nancy again.')), startupPermissionMs);
    signal.addEventListener('abort', onAbort, { once: true });
    void Promise.all([unlocked, streamPromise]).then(([, ready]) => finish(undefined, ready), error => finish(error));
    if (signal.aborted) onAbort();
  });
  try {
    options.onState('connecting', 'Allow microphone and audio access in your browser to start Nancy…');
    stream = await (ownerLifecycle ? waitForOwnerVoiceStartup({context,stream:streamPromise,initialResume:unlocked,signal,
      onProgress:message=>options.onState('connecting',message),onAudioUnlock:options.onAudioUnlock}) : waitForStartup()); assertOpen();
    if (ownerLifecycle) {
      // Once playback starts, a suspended audio clock may never emit onended.
      // End this conversation rather than acknowledging an unheard review or
      // resuming it later without a new explicit Talk gesture.
      const audioEnded = () => {
        if (!closed && context.state !== 'running')
          void stop('Nancy’s audio paused, so voice stopped. Check My Day for saved changes, then tap Talk to Nancy again.');
      };
      const microphoneEnded = () => {
        if (!closed) void stop('The microphone disconnected, so voice stopped. Check My Day for saved changes, then tap Talk to Nancy again.');
      };
      const tracks = stream.getAudioTracks();
      context.addEventListener('statechange', audioEnded);
      tracks.forEach(track => track.addEventListener('ended', microphoneEnded));
      detachLifecycle = () => {
        context.removeEventListener('statechange', audioEnded);
        tracks.forEach(track => track.removeEventListener('ended', microphoneEnded));
      };
      audioEnded();
      if (tracks.some(track => track.readyState === 'ended')) microphoneEnded();
      assertOpen();
    }
    const openingTiming: VoiceTiming = {inputMode: 'opening', inputAt: openingAt, speechEndedAt: null, requestAt: performance.now()};
    const first = options.purpose&&options.purpose!=='general'?await api.conversationStart(signal,options.purpose):await api.conversationStart(signal);
    openingTiming.repliedAt = performance.now();
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
      // Do not capture, queue or interpret speech while a reply is being prepared
      // or played. A waiting client must never accidentally cancel that reply.
      if (closed || !listening || working) return;
      const chunk = new Float32Array(event.inputBuffer.getChannelData(0));
      const reference = event.inputBuffer.numberOfChannels > 1 ? event.inputBuffer.getChannelData(1) : new Float32Array(chunk.length);
      const detected = activity.observe(chunk, reference, false);
      const now = Date.now();
      preRoll.push(chunk);
      while (preRoll.reduce((n, c) => n + c.length, 0) > context.sampleRate * 0.25) preRoll.shift();
      if (detected.speech) {
        if (!utteranceStarted) { utteranceStarted = now; chunks.push(...preRoll.slice(0, -1)); }
        lastSound = now; quietStarted = now; graceStarted = 0;
        lastSoundAt = performance.now();
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
    await applyReply(first, ticket, false, true, openingTiming); assertOpen();
    return handle;
  } catch (error) {
    await stop();
    const permissionDenied = error !== null && typeof error === 'object' && 'name' in error && error.name === 'NotAllowedError';
    const message = permissionDenied ? 'Microphone permission was not granted. Check your browser’s permission prompt or settings, then try Talk to Nancy again.'
      : error instanceof Error ? error.message : 'Nancy could not start. You can use the day views.';
    options.onState('error', message); throw new Error(message);
  }
}
