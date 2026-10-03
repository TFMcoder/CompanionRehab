type State = 'connecting' | 'listening' | 'speaking' | 'stopped' | 'error';
interface Options {
  signal?: AbortSignal;
  onState: (state: State, message?: string) => void;
  onTranscript: (speaker: 'you' | 'nancy', text: string) => void;
  onChange: () => void;
}
export async function startVoice(options: Options): Promise<{ stop: () => Promise<void> }> {
  let stream: MediaStream | undefined, peer: RTCPeerConnection | undefined, sessionId: string | undefined;
  let closed = false, monitor: ReturnType<typeof setInterval> | undefined;
  const controller = new AbortController();
  const audio = new Audio(); audio.autoplay = true;
  const stop = async () => {
    if (closed) return;
    closed = true; controller.abort(); clearInterval(monitor);
    stream?.getTracks().forEach(track => track.stop()); peer?.close(); audio.pause(); audio.srcObject = null;
    window.removeEventListener('pagehide', onLeave);
    options.signal?.removeEventListener('abort', onLeave);
    options.onState('stopped'); options.onChange();
    if (sessionId) await fetch(`/api/voice/${sessionId}`, { method: 'DELETE', credentials: 'same-origin', keepalive: true, signal: AbortSignal.timeout(6000) }).catch(() => undefined);
  };
  const onLeave = () => { void stop(); };
  options.signal?.addEventListener('abort', onLeave, { once: true });
  try {
    options.onState('connecting');
    if (options.signal?.aborted) throw new Error('Voice was stopped.');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs HTTPS and a supported browser. You can use touch.');
    // Initiated by the Talk button, never at page load or by a timer.
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    if (closed || options.signal?.aborted) { stream.getTracks().forEach(track => track.stop()); throw new Error('Voice was stopped.'); }
    peer = new RTCPeerConnection();
    peer.ontrack = event => { audio.srcObject = event.streams[0]; void audio.play().catch(() => { void stop().then(() => options.onState('error', 'Audio playback was blocked. Check browser audio permissions, then try again.')); }); };
    peer.onconnectionstatechange = () => {
      if (closed) return;
      if (peer?.connectionState === 'connected') options.onState('listening');
      if (['failed', 'disconnected', 'closed'].includes(peer?.connectionState || '')) void stop().then(() => options.onState('error', 'The voice connection ended. Check the displayed plan; touch is still available.'));
    };
    stream.getTracks().forEach(track => peer!.addTrack(track, stream!));
    const channel = peer.createDataChannel('oai-events');
    channel.onopen = () => channel.send(JSON.stringify({ type: 'response.create' }));
    channel.onmessage = event => {
      if (closed) return;
      let message: Record<string, any>; try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'output_audio_buffer.started') options.onState('speaking');
      if (message.type === 'output_audio_buffer.stopped' || message.type === 'input_audio_buffer.speech_started') options.onState('listening');
      if (message.type === 'conversation.item.input_audio_transcription.completed') options.onTranscript('you', message.transcript);
      if (message.type === 'response.output_audio_transcript.done') options.onTranscript('nancy', message.transcript);
      if (message.type === 'response.done' || message.type === 'conversation.item.created' && message.item?.type === 'function_call_output') options.onChange();
      if (message.type === 'error') void stop().then(() => options.onState('error', 'Nancy could not continue. Check the displayed plan and use touch.'));
    };
    const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
    const response = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ sdp: offer.sdp }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(40000)]) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || 'Voice could not connect. You can use touch.');
    sessionId = result.session_id;
    if (closed) { await fetch(`/api/voice/${sessionId}`, { method: 'DELETE', credentials: 'same-origin', signal: AbortSignal.timeout(6000) }).catch(() => undefined); throw new Error('Voice was stopped.'); }
    await peer.setRemoteDescription({ type: 'answer', sdp: result.sdp });
    window.addEventListener('pagehide', onLeave);
    monitor = setInterval(() => {
      void fetch(`/api/voice/${sessionId}`, { credentials: 'same-origin', signal: AbortSignal.timeout(5000) })
        .then(async r => { if (!r.ok || !(await r.json()).active) throw new Error(); })
        .catch(() => { void stop().then(() => options.onState('error', 'The voice session ended. Your displayed plan can be refreshed and used by touch.')); });
    }, 5000);
    return { stop };
  } catch (error) {
    await stop();
    const permissionDenied = error !== null && typeof error === 'object' && 'name' in error && error.name === 'NotAllowedError';
    const message = permissionDenied ? 'Microphone permission was not granted. You can use touch or allow the microphone and try again.' : error instanceof Error ? error.message : 'Voice could not connect. You can use touch.';
    options.onState('error', message); throw new Error(message);
  }
}
