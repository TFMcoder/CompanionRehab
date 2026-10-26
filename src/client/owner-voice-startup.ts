/** Qualified only by the separate owner build; ordinary clients retain their startup. */
declare const __NANCY_OWNER_VOICE_STARTUP__: boolean;
export function ownerVoiceStartupEnabled(): boolean {
  return typeof __NANCY_OWNER_VOICE_STARTUP__ !== 'undefined' && __NANCY_OWNER_VOICE_STARTUP__ === true;
}

interface StartupOptions {
  context: AudioContext;
  stream: Promise<MediaStream>;
  initialResume: Promise<void>;
  signal: AbortSignal;
  onProgress(message: string): void;
  onAudioUnlock?(resume: (() => void) | null): void;
}

/** A pending resume promise is not the same as a suspended audio context.
 * Recheck actual state after the microphone grant, which can interrupt audio.
 * Keep an explicit gesture recovery; never open a server conversation early. */
export function waitForOwnerVoiceStartup(options: StartupOptions): Promise<MediaStream> {
  const {context, signal} = options;
  return new Promise((resolve, reject) => {
    let settled = false, microphone: MediaStream | undefined, probe: AudioBufferSourceNode | undefined;
    let audioTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(permissionTimer); clearTimeout(hintTimer); clearTimeout(audioTimer);
      context.removeEventListener('statechange', check);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
      signal.removeEventListener('abort', abort);
      options.onAudioUnlock?.(null);
      try { probe?.stop(); } catch { /* The one-sample silent unlock may have ended. */ }
      probe?.disconnect();
      if (error) reject(error); else resolve(microphone!);
    };
    const showUnlock = () => {
      if (settled || context.state === 'running') return;
      options.onProgress(microphone ? 'Microphone is ready. Tap Enable sound to hear Nancy.' : 'Allow the microphone in your browser. Tap Enable sound if audio is waiting.');
      options.onAudioUnlock?.(resume);
    };
    const resume = () => {
      if (settled || signal.aborted) return;
      // This function is called directly by a button gesture, without an await.
      try { void context.resume().then(check, showUnlock); } catch { showUnlock(); }
      check();
    };
    function check() {
      if (settled) return;
      if (context.state === 'closed') { finish(new Error('Audio closed before Nancy could start. Tap Talk to Nancy to try again.')); return; }
      if (context.state === 'running') {
        options.onAudioUnlock?.(null);
        if (microphone) finish();
        else options.onProgress(document.visibilityState !== 'visible' || !document.hasFocus()
          ? 'Audio is ready. Open this Nancy tab in the foreground so your browser can ask for the microphone.'
          : 'Audio is ready. Allow the microphone in your browser to start Nancy.');
      } else if (microphone) showUnlock();
    }
    const abort = () => finish(new Error('Conversation ended.'));
    const permissionTimer = setTimeout(() => finish(new Error(microphone
      ? 'Audio has not started. Tap Talk to Nancy again, then Enable sound. The microphone has been stopped.'
      : 'Microphone permission is still waiting. Allow it in your browser, then tap Talk to Nancy again.')), 60_000);
    const hintTimer = setTimeout(showUnlock, 750);
    context.addEventListener('statechange', check);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    signal.addEventListener('abort', abort, {once: true});
    // A real, silent audio node helps browsers unlock the output during the
    // original gesture. It is not a speech sample or an audibility assertion.
    try {
      probe = context.createBufferSource();
      probe.buffer = context.createBuffer(1, 1, context.sampleRate);
      probe.connect(context.destination); probe.onended = () => probe?.disconnect(); probe.start();
    } catch { /* State checks and the explicit gesture recovery remain available. */ }
    void options.initialResume.then(check, showUnlock);
    void options.stream.then(acquired => {
      if (settled) return; // The caller owns release of late grants.
      microphone = acquired;
      audioTimer = setTimeout(() => finish(new Error('The microphone is ready, but audio has not started. Tap Talk to Nancy again, then Enable sound. The microphone has been stopped.')), 20_000);
      // Granting capture can interrupt an earlier audio unlock on mobile.
      resume();
    }, error => finish(error ?? new Error('The microphone could not start. Check that it is available to this browser.')));
    if (signal.aborted) abort(); else check();
  });
}
