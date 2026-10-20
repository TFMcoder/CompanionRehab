import { afterEach, expect, it, vi } from 'vitest';
import { startSpeechWarmup } from '../src/server/speech-startup.js';
import type { LocalSpeechReadiness } from '../src/server/local-speech.js';

afterEach(() => vi.useRealTimers());

function worker() {
  let state: LocalSpeechReadiness = { kokoro: 'starting', asr: 'starting' };
  return {
    readiness: () => state,
    setReady: (ready: boolean) => { state = ready ? { kokoro: 'ready', asr: 'ready' } : { kokoro: 'unavailable', asr: 'ready' }; },
    primeNavigation: vi.fn<() => Promise<void>>(),
  };
}

it('recovers a transient startup failure, then leaves healthy workers available', async () => {
  vi.useFakeTimers();
  const speech = worker(), observe = vi.fn(), warn = vi.fn();
  speech.primeNavigation.mockRejectedValueOnce(new Error('Temporary startup failure')).mockImplementation(async () => speech.setReady(true));
  const stop = startSpeechWarmup(speech, observe, warn);
  await Promise.resolve(); expect(observe).toHaveBeenCalledWith(false);
  await vi.advanceTimersByTimeAsync(15000);
  expect(speech.primeNavigation).toHaveBeenCalledTimes(2);
  expect(observe).toHaveBeenLastCalledWith(true);
  await vi.advanceTimersByTimeAsync(120000);
  expect(speech.primeNavigation).toHaveBeenCalledTimes(2);
  expect(observe).toHaveBeenCalledTimes(2);
  stop();
});

it('caps retry frequency without giving up after three failures or flooding logs', async () => {
  vi.useFakeTimers();
  const speech = worker(), observe = vi.fn(), warn = vi.fn();
  speech.primeNavigation.mockRejectedValue(new Error('Unavailable'));
  const stop = startSpeechWarmup(speech, observe, warn, { retryMs: 10, maxRetryMs: 40, healthCheckMs: 20 });
  await vi.advanceTimersByTimeAsync(110); // attempts at 0, 10, 30, 70, 110
  expect(speech.primeNavigation).toHaveBeenCalledTimes(5);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(observe).toHaveBeenCalledTimes(1);
  speech.primeNavigation.mockImplementation(async () => speech.setReady(true));
  await vi.advanceTimersByTimeAsync(40);
  expect(observe).toHaveBeenLastCalledWith(true);
  stop();
});

it('recovers a worker that becomes unavailable after startup', async () => {
  vi.useFakeTimers();
  const speech = worker(), observe = vi.fn();
  speech.primeNavigation.mockImplementation(async () => speech.setReady(true));
  const stop = startSpeechWarmup(speech, observe, vi.fn());
  await Promise.resolve(); speech.setReady(false);
  await vi.advanceTimersByTimeAsync(30000);
  expect(speech.primeNavigation).toHaveBeenCalledTimes(2);
  expect(speech.readiness()).toEqual({ kokoro: 'ready', asr: 'ready' });
  stop();
});

it('cancels a pending retry and ignores completion after shutdown', async () => {
  vi.useFakeTimers();
  const failed = worker(); failed.primeNavigation.mockRejectedValue(new Error('Unavailable'));
  const close = startSpeechWarmup(failed, vi.fn(), vi.fn());
  await Promise.resolve(); close(); await vi.advanceTimersByTimeAsync(90000);
  expect(failed.primeNavigation).toHaveBeenCalledTimes(1);
  let finish!: () => void;
  const pending = worker(), observe = vi.fn();
  pending.primeNavigation.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const stop = startSpeechWarmup(pending, observe, vi.fn());
  stop(); finish(); await vi.advanceTimersByTimeAsync(90000);
  expect(observe).not.toHaveBeenCalled();
  expect(pending.primeNavigation).toHaveBeenCalledTimes(1);
});
