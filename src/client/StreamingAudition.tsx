import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import catalogue from '../shared/voice-evaluation.json';

type Sample = (typeof catalogue.samples)[number];
type Voice = 'alba' | 'anna';
type StaticVoice = Voice | 'af_heart' | 'serena';
type StaticModel = 'pocket' | 'kokoro' | 'nano' | 'qwen';
type SetupTimings = Record<string, number | string>;
type StreamMessage = Record<string, unknown> & { type: string };
type Metrics = {
  trace: string; sample: string; voice: Voice; startedAt: string;
  firstTextDispatchMs: 0; acceptedMs?: number; firstAudioReceivedMs?: number; firstDecodedMs?: number;
  firstEnqueuedMs?: number; firstRenderedWorkletProxyMs?: number; generationCompleteArrivalMs?: number;
  cancellationTapToSilenceAckMs?: number; serverFirstChunkMs?: number; serverGenerationMs?: number;
  audioChunks?: number; queuedFrames?: number; underruns?: number; bufferCapSeconds: 60;
};
type Props = { onPlaybackStart?: () => void };

const sampleEntries = catalogue.samples as Sample[];
const maxFrames = 24_000 * 60;
const setupStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end', margin: '14px 0' };
const fieldStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', minWidth: 0, maxWidth: '100%', gap: 4, fontSize: 16 };
const selectStyle: React.CSSProperties = { minWidth: 0, maxWidth: '100%', minHeight: 44, fontSize: 16 };
const buttonStyle: React.CSSProperties = { minHeight: 44, padding: '8px 14px', fontSize: 16 };

export function isCurrentTrace(active: string | null, candidate: unknown): candidate is string {
  return active !== null && typeof candidate === 'string' && candidate === active;
}

export function decodePcmFloat32LE(value: string): Float32Array {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4_000_000 || value.length % 4 !== 0) throw new Error('Invalid audio chunk.');
  const binary = atob(value);
  if (binary.length === 0 || binary.length % 4 !== 0) throw new Error('Invalid audio chunk.');
  const view = new DataView(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) view.setUint8(index, binary.charCodeAt(index));
  const pcm = new Float32Array(binary.length / 4);
  const values = new DataView(view.buffer);
  for (let index = 0; index < pcm.length; index++) {
    const sample = values.getFloat32(index * 4, true);
    if (!Number.isFinite(sample) || sample < -1 || sample > 1) throw new Error('Audio chunk contains an invalid sample.');
    pcm[index] = sample;
  }
  return pcm;
}

export function streamingSampleUrl(model: StaticModel, voice: StaticVoice, sample: string) {
  return `/preview/voice-eval/${model}/${voice}/${encodeURIComponent(sample)}.wav`;
}

function elapsed(start: number): number { return Number(Math.max(0, performance.now() - start).toFixed(1)); }

export function StreamingAudition({ onPlaybackStart }: Props) {
  const [voice, setVoice] = useState<Voice>('alba');
  const [sampleId, setSampleId] = useState<string>(sampleEntries[0]?.id || 'water');
  const [staticChoice, setStaticChoice] = useState<'pocket-alba' | 'pocket-anna' | 'kokoro-heart' | 'nano-alba' | 'qwen-serena'>('pocket-alba');
  const [connection, setConnection] = useState<'offline' | 'connecting' | 'ready' | 'error'>('offline');
  const [status, setStatus] = useState('Connect to begin. Audio is synthetic and is sent only to the local preview server.');
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [streamActive, setStreamActive] = useState(false);
  const [setupTimings, setSetupTimings] = useState<SetupTimings>({});
  const [audioError, setAudioError] = useState('');
  const socketRef = useRef<WebSocket | null>(null);
  const staticAudioRef = useRef<HTMLAudioElement>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const activeTraceRef = useRef<string | null>(null);
  const cancelRequestedTraceRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const cancelAtRef = useRef<number | null>(null);
  const expectedSeqRef = useRef(0);
  const receivedFramesRef = useRef(0);
  const chunkCountRef = useRef(0);
  const currentMetricsRef = useRef<Metrics | null>(null);
  const isUnmountingRef = useRef(false);
  const connectionEpochRef = useRef(0);
  const selectedSample = useMemo(() => sampleEntries.find(item => item.id === sampleId) || sampleEntries[0], [sampleId]);
  const staticParts = staticChoice === 'kokoro-heart'
    ? { model: 'kokoro' as const, voice: 'af_heart' as const }
    : staticChoice === 'nano-alba' ? { model: 'nano' as const, voice: 'alba' as const }
      : staticChoice === 'qwen-serena' ? { model: 'qwen' as const, voice: 'serena' as const }
        : { model: 'pocket' as const, voice: staticChoice === 'pocket-anna' ? 'anna' as const : 'alba' as const };
  const staticUrl = selectedSample ? streamingSampleUrl(staticParts.model, staticParts.voice, selectedSample.id) : '';

  const updateMetric = useCallback((change: Partial<Metrics>) => {
    const current = currentMetricsRef.current;
    if (!current) return;
    const next = { ...current, ...change };
    currentMetricsRef.current = next;
    setMetrics(next);
  }, []);

  const announceStreaming = useCallback((active: boolean) => {
    setStreamActive(active);
    window.dispatchEvent(new CustomEvent('nancy:stream-audition-active', { detail: { active } }));
  }, []);

  const cancelTurn = useCallback((announce = true) => {
    const trace = activeTraceRef.current;
    if (!trace || cancelRequestedTraceRef.current === trace) return;
    cancelAtRef.current = performance.now();
    cancelRequestedTraceRef.current = trace;
    try { if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: 'cancel', trace })); } catch { /* Local stop still clears queued audio. */ }
    workletRef.current?.port.postMessage({ type: 'cancel', trace });
    if (announce) setStatus('Stopping the current sample…');
  }, []);

  const teardown = useCallback((closeSocket: boolean) => {
    connectionEpochRef.current++;
    isUnmountingRef.current = true;
    const trace = activeTraceRef.current;
    if (trace) {
      window.dispatchEvent(new CustomEvent('nancy:stream-audition-active', { detail: { active: false } }));
      try { if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: 'cancel', trace })); } catch { /* Closing below releases the connection. */ }
      workletRef.current?.port.postMessage({ type: 'cancel', trace });
    }
    if (closeSocket) { socketRef.current?.close(); socketRef.current = null; }
    workletRef.current?.disconnect(); workletRef.current = null;
    const context = contextRef.current; contextRef.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    activeTraceRef.current = null;
  }, []);

  useEffect(() => {
    const stopForOtherPreviewAudio = () => {
      cancelTurn(false);
      if (staticAudioRef.current) { staticAudioRef.current.pause(); staticAudioRef.current.currentTime = 0; }
    };
    const onPageHide = () => {
      teardown(true);
      setConnection('offline');
      setStreamActive(false);
      setStatus('The page was hidden. Connect again when you return.');
    };
    const onPageShow = () => { isUnmountingRef.current = false; };
    window.addEventListener('nancy:preview-stop-stream', stopForOtherPreviewAudio);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('nancy:preview-stop-stream', stopForOtherPreviewAudio);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      teardown(true);
    };
  }, [cancelTurn, teardown]);

  const handleWorkletMessage = useCallback((event: MessageEvent) => {
    const message = event.data as StreamMessage;
    if (!isCurrentTrace(activeTraceRef.current, message?.trace)) return;
    if (message.type === 'enqueued' && Number.isInteger(message.seq)) {
      const start = startedAtRef.current;
      if (start !== null && currentMetricsRef.current?.firstEnqueuedMs === undefined) updateMetric({ firstEnqueuedMs: elapsed(start) });
      updateMetric({ queuedFrames: Number(message.queuedFrames) || 0 });
    } else if (message.type === 'first_nonzero_rendered') {
      const start = startedAtRef.current;
      if (start !== null && currentMetricsRef.current?.firstRenderedWorkletProxyMs === undefined) updateMetric({ firstRenderedWorkletProxyMs: elapsed(start) });
      updateMetric({ queuedFrames: Number(message.queueFrames) || 0 });
      announceStreaming(true);
    } else if (message.type === 'metrics') {
      updateMetric({ queuedFrames: Number(message.queueFrames) || 0, underruns: Number(message.underruns) || 0 });
    } else if (message.type === 'silence') {
      const cancelAt = cancelAtRef.current;
      if (cancelAt !== null) updateMetric({ cancellationTapToSilenceAckMs: Number(Math.max(0, performance.now() - cancelAt).toFixed(1)), queuedFrames: 0 });
      activeTraceRef.current = null;
      cancelRequestedTraceRef.current = null;
      startedAtRef.current = null;
      cancelAtRef.current = null;
      setStreamActive(false);
      announceStreaming(false);
      if (!isUnmountingRef.current) setStatus('Stopped. You can play another sample.');
    } else if (message.type === 'drained') {
      updateMetric({ queuedFrames: 0, underruns: Number(message.underruns) || 0 });
      activeTraceRef.current = null;
      cancelRequestedTraceRef.current = null;
      startedAtRef.current = null;
      setStreamActive(false);
      announceStreaming(false);
      if (!isUnmountingRef.current) setStatus('Sample finished. You can play another sample.');
    } else if (message.type === 'error') {
      setAudioError('The local audio queue could not accept this sample. Stop and reconnect, then try again.');
      cancelTurn(false);
    }
  }, [announceStreaming, cancelTurn, updateMetric]);

  const connect = async () => {
    if (connection === 'connecting' || connection === 'ready') return;
    teardown(true);
    const epoch = connectionEpochRef.current;
    isUnmountingRef.current = false;
    setStreamActive(false);
    setAudioError('');
    setConnection('connecting');
    const setupStarted = performance.now();
    try {
      const context = new AudioContext({ sampleRate: 24_000 });
      contextRef.current = context;
      await context.resume();
      if (epoch !== connectionEpochRef.current || isUnmountingRef.current) return;
      const contextMs = elapsed(setupStarted);
      const workletStarted = performance.now();
      await context.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url));
      if (epoch !== connectionEpochRef.current || isUnmountingRef.current) return;
      const workletMs = elapsed(workletStarted);
      const node = new AudioWorkletNode(context, 'nancy-pcm-queue', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      node.port.onmessage = handleWorkletMessage;
      node.connect(context.destination);
      workletRef.current = node;
      if (context.sampleRate !== 24_000) throw new Error('This browser could not open 24 kHz audio.');
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}/preview/voice-stream`);
      socketRef.current = socket;
      const socketStarted = performance.now();
      socket.onopen = () => setSetupTimings({ audioContextAndUnlockMs: contextMs, workletModuleMs: workletMs,
        websocketHandshakeMs: elapsed(socketStarted), audioContextRateHz: context.sampleRate, audioContextState: context.state });
      socket.onmessage = event => {
        if (socketRef.current !== socket) return;
        let message: StreamMessage;
        try { message = JSON.parse(String(event.data)) as StreamMessage; }
        catch { setStatus('The local service sent an unreadable message.'); return; }
        const activeTrace = activeTraceRef.current;
        if (message.type === 'ready') {
          setSetupTimings(current => ({ ...current, serverReadyAfterSocketStartMs: elapsed(socketStarted) }));
          setConnection('ready');
          setStatus('Connected. Choose a short sample and voice, then play.');
          return;
        }
        if (message.type === 'warming') {
          setStatus('The local speech service is still preparing. This connection will become ready automatically.');
          return;
        }
        if (message.type === 'unavailable') {
          setConnection('error');
          setStatus('The local speech service is unavailable. Connect again after it is ready.');
          return;
        }
        if (!isCurrentTrace(activeTrace, message.trace)) return;
        if (cancelRequestedTraceRef.current === message.trace && !['cancelled', 'error'].includes(message.type)) return;
        const start = startedAtRef.current;
        if (message.type === 'accepted') {
          if (start !== null && typeof message.rate === 'number' && message.rate === 24_000) updateMetric({ acceptedMs: elapsed(start) });
          else if (message.rate !== 24_000) { setAudioError('The server selected an unsupported audio rate.'); cancelTurn(false); }
        } else if (message.type === 'audio') {
          if (start === null) return;
          if (!Number.isInteger(message.seq) || message.seq !== expectedSeqRef.current || typeof message.pcm !== 'string') {
            setAudioError('The audio stream arrived out of order. Please try the sample again.');
            cancelTurn(false); return;
          }
          try {
            const received = elapsed(start);
            if (currentMetricsRef.current?.firstAudioReceivedMs === undefined) updateMetric({ firstAudioReceivedMs: received });
            const pcm = decodePcmFloat32LE(message.pcm);
            receivedFramesRef.current += pcm.length;
            if (receivedFramesRef.current > maxFrames) throw new Error('Audio exceeded the one-minute buffer limit.');
            if (currentMetricsRef.current?.firstDecodedMs === undefined) updateMetric({ firstDecodedMs: elapsed(start) });
            expectedSeqRef.current++;
            chunkCountRef.current++;
            if (chunkCountRef.current === 1 && typeof message.model_elapsed_ms === 'number') updateMetric({ serverFirstChunkMs: message.model_elapsed_ms });
            workletRef.current?.port.postMessage({ type: 'chunk', trace: activeTrace, seq: message.seq, pcm }, [pcm.buffer]);
            updateMetric({ audioChunks: chunkCountRef.current });
          } catch (error) {
            setAudioError(error instanceof Error && error.message.includes('one-minute') ? error.message : 'The server sent an invalid audio chunk.');
            cancelTurn(false);
          }
        } else if (message.type === 'complete') {
          if (start !== null) updateMetric({ generationCompleteArrivalMs: elapsed(start),
            ...(typeof message.first_chunk_ms === 'number' ? { serverFirstChunkMs: message.first_chunk_ms } : {}),
            ...(typeof message.generation_ms === 'number' ? { serverGenerationMs: message.generation_ms } : {}),
            ...(Number.isInteger(message.chunks) ? { audioChunks: message.chunks as number } : {}) });
          workletRef.current?.port.postMessage({ type: 'complete', trace: activeTrace });
          setStatus('Audio generation finished; playing the buffered remainder.');
        } else if (message.type === 'cancelled') {
          setStatus('Stopped. You can play another sample.');
        } else if (message.type === 'error') {
          const safeCode = typeof message.code === 'string' && /^[a-z0-9_-]{1,40}$/i.test(message.code) ? message.code : 'stream_error';
          setAudioError(`The local voice stream stopped (${safeCode}).`);
          cancelTurn(false);
        }
      };
      socket.onerror = () => { if (socketRef.current === socket) { cancelTurn(false); setConnection('error'); setStatus('Could not connect to the local speech stream.'); } };
      socket.onclose = () => { if (socketRef.current === socket && !isUnmountingRef.current) { cancelTurn(false); setConnection('offline'); setStatus('Connection closed. Connect again to continue.'); } };
      setStatus('Preparing audio and connecting to the local service…');
    } catch (error) {
      if (epoch !== connectionEpochRef.current || isUnmountingRef.current) return;
      teardown(true);
      setConnection('error');
      setStatus(error instanceof Error ? error.message : 'Audio could not be prepared.');
    }
  };

  const play = async () => {
    if (connection !== 'ready' || !selectedSample || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN || streamActive) return;
    const context = contextRef.current;
    const resumeStarted = performance.now();
    try {
      if (context?.state === 'suspended') await context.resume();
      if (context?.state !== 'running') throw new Error('Audio is still paused. Tap Play again after allowing audio.');
      if (context) setSetupTimings(current => ({ ...current, audioResumeAfterUserGestureMs: elapsed(resumeStarted), audioContextStateAtPlay: context.state }));
    } catch {
      setAudioError('Audio could not resume. Tap Play again and check this browser’s audio permission.');
      return;
    }
    if (connection !== 'ready' || socketRef.current?.readyState !== WebSocket.OPEN || streamActive || activeTraceRef.current) return;
    onPlaybackStart?.();
    if (staticAudioRef.current) { staticAudioRef.current.pause(); staticAudioRef.current.currentTime = 0; }
    setAudioError('');
    const trace = crypto.randomUUID();
    const start = performance.now();
    activeTraceRef.current = trace;
    startedAtRef.current = start;
    expectedSeqRef.current = 0;
    receivedFramesRef.current = 0;
    chunkCountRef.current = 0;
    cancelAtRef.current = null;
    cancelRequestedTraceRef.current = null;
    const initial: Metrics = { trace, sample: selectedSample.id, voice, startedAt: new Date().toISOString(), firstTextDispatchMs: 0, audioChunks: 0, queuedFrames: 0, underruns: 0, bufferCapSeconds: 60 };
    currentMetricsRef.current = initial;
    setMetrics(initial);
    workletRef.current?.port.postMessage({ type: 'start', trace, targetFrames: 3_840, maxFrames });
    announceStreaming(true);
    setStatus(`Playing “${selectedSample.label}” with ${voice === 'alba' ? 'Alba' : 'Anna'}…`);
    try { socketRef.current.send(JSON.stringify({ type: 'start', trace, sample: selectedSample.id, voice })); }
    catch { setAudioError('The connection closed before the sample started. Connect again to continue.'); cancelTurn(false); setConnection('offline'); }
  };

  const download = () => {
    if (!metrics) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const blob = new Blob([JSON.stringify({ kind: 'synthetic_voice_audition', origin: window.location.origin,
      transport: `${protocol}//${window.location.host}/preview/voice-stream`, measurement: 'browser monotonic timings; worklet render proxy is not a physical speaker measurement',
      connection_setup_excluded: setupTimings, result: metrics }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `voice-audition-${metrics.sample}-${metrics.voice}.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const onStaticPlay = () => {
    cancelTurn(false);
    onPlaybackStart?.();
  };

  return <section aria-labelledby="stream-audition-title" style={{ margin: '24px 0', padding: 20, border: '1px solid #c9d6df', borderRadius: 16, background: '#fff' }}>
    <p style={{ margin: 0, fontSize: 14, letterSpacing: '.06em', textTransform: 'uppercase' }}>Synthetic voice comparison</p>
    <h2 id="stream-audition-title" style={{ marginTop: 6 }}>Hear a live sample</h2>
    <p>These fixed test lines contain no personal information. Only the sample name and voice are sent to the local preview service; no microphone recording is sent. Listen for clear words, comfortable pauses, and natural emphasis.</p>
    <div style={setupStyle}>
      <label style={fieldStyle}>Sample line<select style={selectStyle} aria-label="Sample line" value={sampleId} onChange={event => setSampleId(event.target.value)} disabled={streamActive}>
        {sampleEntries.map(sample => <option key={sample.id} value={sample.id} disabled={staticChoice === 'qwen-serena' && !['water', 'long'].includes(sample.id)}>{sample.label}</option>)}
      </select></label>
      <label style={fieldStyle}>Streaming voice<select style={selectStyle} aria-label="Streaming voice" value={voice} onChange={event => setVoice(event.target.value as Voice)} disabled={streamActive}>
        <option value="alba">Alba — Pocket TTS</option><option value="anna">Anna — Pocket TTS</option>
      </select></label>
      <button type="button" style={buttonStyle} onClick={() => void connect()} disabled={connection === 'connecting' || connection === 'ready'}>Connect</button>
      <button type="button" style={buttonStyle} onClick={() => void play()} disabled={connection !== 'ready' || streamActive}>Play live sample</button>
      <button type="button" style={buttonStyle} onClick={() => cancelTurn()} disabled={!streamActive}>Stop</button>
    </div>
    <p role="status" aria-live="polite">{status}</p>
    {audioError && <p role="alert">{audioError}</p>}
    <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: '#f3f6f8' }}><strong>Sample script</strong><p style={{ marginBottom: 0 }}>{selectedSample?.text}</p></div>
    <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #dbe3e8' }}>
      <h3 style={{ margin: '0 0 8px' }}>Compare with a saved recording</h3>
      <p>These recordings use the same sample script. Choose one and press play.</p>
      <label style={fieldStyle}>Saved voice<select style={selectStyle} aria-label="Saved voice" value={staticChoice} onChange={event => {
        const next = event.target.value as typeof staticChoice;
        setStaticChoice(next);
        if (next === 'qwen-serena' && !['water', 'long'].includes(sampleId)) setSampleId('water');
      }}>
        <option value="pocket-alba">Pocket · Alba (Alba MacKenna, CC BY 4.0)</option>
        <option value="pocket-anna">Pocket · Anna (CSTR VCTK, CC BY 4.0)</option>
        <option value="kokoro-heart">Kokoro · Heart</option>
        <option value="nano-alba">Nano · Alba (Alba MacKenna, CC BY 4.0)</option>
        <option value="qwen-serena">Qwen · Serena (hosted demo; water and longer conversation only)</option>
      </select></label>
      <audio style={{ maxWidth: '100%' }} ref={staticAudioRef} controls preload="none" src={staticUrl} aria-label="Play saved voice sample" onPlay={onStaticPlay} />
      {staticChoice === 'qwen-serena' && <p>Qwen is a hosted demonstration recording for these two sample lines only; it is not part of the local streaming latency comparison.</p>}
      <p style={{ fontSize: 13 }}>Pocket TTS by Kyutai; Alba voice reference by Alba MacKenna; Anna reference from CSTR VCTK.
        {' '}<a href="https://huggingface.co/kyutai/tts-voices" target="_blank" rel="noreferrer">Voice credits</a>
        {' · '}<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>.
        {' '}The samples are synthesized derivatives; saved recordings use uniform loudness adjustment.</p>
    </div>
    <div style={{ marginTop: 20 }}>
      <h3 style={{ margin: '0 0 8px' }}>Timing record</h3>
      {metrics ? <>
        <pre aria-label="Timing metrics" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13, maxHeight: 300, overflow: 'auto' }}>{JSON.stringify({ ...metrics, connectionSetupExcluded: setupTimings, renderedIsNotPhysicalSpeaker: true }, null, 2)}</pre>
        <button type="button" style={buttonStyle} onClick={download}>Download timing record</button>
      </> : <pre aria-label="Timing metrics" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13 }}>{JSON.stringify({ sample: 'not started', firstTextDispatchMs: null, firstAudioReceivedMs: null, firstDecodedMs: null, firstEnqueuedMs: null, firstRenderedWorkletProxyMs: null, generationCompleteArrivalMs: null, cancellationTapToSilenceAckMs: null, queuedFrames: 0, underruns: 0, bufferCapSeconds: 60, connectionSetupExcluded: { websocketHandshakeMs: null, audioContextRateHz: null, audioContextState: null } }, null, 2)}</pre>}
      <p style={{ fontSize: 13 }}>Playback begins after about 160 ms of audio is buffered. The one-minute buffer limit is enforced. “First rendered worklet proxy” measures frames scheduled by the browser audio worklet; it does not measure when sound physically reaches a listener. A saved-voice preference has not been selected.</p>
    </div>
  </section>;
}
