import { useEffect, useRef, useState } from 'react';
import { foregroundWakeSupported, startForegroundWake, type ForegroundWakeHandle, type WakeStatus } from './foreground-wake';

export interface WakeControlProps {
  scopeKey: string;
  enabled: boolean;
  conversationActive: boolean;
  onWake: () => void | Promise<void>;
}

/** Consent is only for the current visible page and authenticated scope. */
export function WakeControl({ scopeKey, enabled, conversationActive, onWake }: WakeControlProps) {
  const [status, setStatus] = useState<WakeStatus>('stopped');
  const [message, setMessage] = useState('Hey Nancy is off.');
  const [supported, setSupported] = useState(false);
  const handle = useRef<ForegroundWakeHandle | null>(null);
  const controller = useRef<AbortController | null>(null);
  const attempt = useRef(0);
  const latestWake = useRef(onWake);
  latestWake.current = onWake;

  const stop = () => {
    attempt.current++;
    controller.current?.abort(); controller.current = null;
    const current = handle.current; handle.current = null;
    void current?.stop();
    setStatus('stopped'); setMessage('Hey Nancy is off.');
  };
  useEffect(() => { setSupported(foregroundWakeSupported()); }, []);
  useEffect(() => {
    stop();
    return () => { attempt.current++; controller.current?.abort(); void handle.current?.stop(); handle.current = null; };
  }, [scopeKey, enabled, conversationActive]);

  const start = () => {
    if (!enabled || conversationActive || !supported || controller.current) return;
    const id = ++attempt.current, abort = new AbortController();
    controller.current = abort;
    const current = () => attempt.current === id && !abort.signal.aborted;
    setStatus('starting'); setMessage('Requesting microphone for foreground wake…');
    void startForegroundWake({ signal: abort.signal,
      onStatus: (next, detail) => {
        if (!current()) return;
        setStatus(next); setMessage(detail);
        if (next === 'stopped' || next === 'error') { handle.current = null; controller.current = null; }
      },
      onWake: async () => {
        // A successful match closes its own microphone before this callback.
        if (attempt.current !== id) return;
        handle.current = null; controller.current = null;
        setStatus('stopped'); setMessage('Hey Nancy heard you. Opening the conversation…');
        await latestWake.current();
      },
    }).then(next => {
      if (!current()) { void next.stop(); return; }
      handle.current = next;
    }).catch(error => {
      if (!current()) return;
      controller.current = null; handle.current = null;
      setStatus('error');
      setMessage(error instanceof Error && error.name === 'NotAllowedError' ? 'Microphone permission was not granted. Use Talk to Nancy or try again.' :
        error instanceof Error ? error.message : 'Foreground wake could not start. Use Talk to Nancy.');
    });
  };

  if (!enabled) return null;
  return <section className="wake-control" aria-label="Foreground Hey Nancy">
    <p>Optional “Hey Nancy” listens only while this page is open. Short speech clips are checked by the local server and discarded. The microphone stops when you leave the page or start a conversation.</p>
    <p role="status" aria-live="polite">Microphone: {status === 'listening' ? 'on' : status === 'starting' ? 'starting' : status === 'checking' ? 'checking' : 'off'}. {message}</p>
    {!supported ? <p>Foreground wake is unavailable in this browser or without HTTPS. Use Talk to Nancy.</p> :
      status === 'listening' || status === 'starting' || status === 'checking' ?
        <button type="button" className="stop-button" onClick={stop}>Stop Hey Nancy</button> :
        <button type="button" className="secondary-button" onClick={start} disabled={conversationActive}>Enable Hey Nancy</button>}
  </section>;
}
