import type { LocalSpeechReadiness } from './local-speech.js';

interface SpeechWarmupOptions { retryMs?: number; maxRetryMs?: number; healthCheckMs?: number }

/** Recover only the selected local workers. Backoff bounds work during an outage. */
export function startSpeechWarmup(
  speech: { primeNavigation(): Promise<void>; readiness(): LocalSpeechReadiness },
  observe: (ready: boolean) => void,
  warn: () => void,
  { retryMs = 15000, maxRetryMs = 300000, healthCheckMs = 30000 }: SpeechWarmupOptions = {},
) {
  let stopped = false, delay = retryMs, reported: boolean | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const report = (ready: boolean) => {
    if (reported === ready) return;
    reported = ready;
    observe(ready);
    if (!ready) warn();
  };
  const schedule = (milliseconds: number) => {
    if (stopped) return;
    timer = setTimeout(() => void check(), milliseconds);
    timer.unref?.();
  };
  const check = async () => {
    if (stopped) return;
    const state = speech.readiness();
    // Do not occupy a healthy synthesis worker to re-prime cached phrases.
    if (reported !== undefined && state.kokoro === 'ready' && state.asr === 'ready') {
      report(true); delay = retryMs; schedule(healthCheckMs); return;
    }
    try {
      await speech.primeNavigation();
      if (stopped) return;
      report(true); delay = retryMs; schedule(healthCheckMs);
    } catch {
      if (stopped) return;
      report(false); schedule(delay); delay = Math.min(delay * 2, maxRetryMs);
    }
  };
  void check();
  return () => { stopped = true; clearTimeout(timer); };
}
