// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startForegroundWake } from '../src/client/foreground-wake';

const activity = vi.hoisted(() => ({ speech: true }));
vi.mock('../src/client/speech-activity', () => ({ SpeechActivityGate: class { observe() { return { speech: activity.speech }; } } }));

let processAudio: ((event: unknown) => void) | null;
const close = vi.fn().mockResolvedValue(undefined);
const trackStop = vi.fn();
const connect = vi.fn();
const disconnect = vi.fn();
const consentToken = 'bc8e3486-42ed-4d58-9b66-ad77084ef425';
const consentResponse = () => ({ ok: true, status: 200, json: async () => ({ consent_token: consentToken }) } as Response);
class AudioContextDouble {
  sampleRate = 16_000;
  destination = {};
  resume = vi.fn().mockResolvedValue(undefined);
  close = close;
  createMediaStreamSource() { return { connect, disconnect }; }
  createGain() { return { gain: { value: 1 }, connect, disconnect }; }
  createScriptProcessor() {
    const node = { connect, disconnect, set onaudioprocess(callback: (event: unknown) => void) { processAudio = callback; } };
    return node;
  }
}
function frame() {
  processAudio?.({ inputBuffer: { getChannelData: () => new Float32Array(2_048).fill(0.1) } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  processAudio = null; activity.speech = true;
  vi.stubGlobal('AudioContext', AudioContextDouble);
  vi.stubGlobal('isSecureContext', true);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: trackStop }] }) } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); trackStop.mockClear(); close.mockClear(); });

describe('foreground microphone lifecycle', () => {
  it('releases the microphone on hidden page without submitting audio', async () => {
    const fetch = vi.fn().mockResolvedValue(consentResponse()); vi.stubGlobal('fetch', fetch);
    const onWake = vi.fn();
    await startForegroundWake({ onStatus: vi.fn(), onWake });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(trackStop).toHaveBeenCalledTimes(1));
    expect(close).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.map(call => call[0])).toEqual(['/api/wake/consent', '/api/wake/consent/revoke']);
    expect(fetch.mock.calls[1][1]).toMatchObject({ keepalive: true });
    expect(onWake).not.toHaveBeenCalled();
  });
  it('stops a late microphone grant after cancellation', async () => {
    const fetch = vi.fn().mockResolvedValue(consentResponse()); vi.stubGlobal('fetch', fetch);
    const grant = deferred<MediaStream>();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockReturnValue(grant.promise) } });
    const abort = new AbortController();
    const pending = startForegroundWake({ signal: abort.signal, onStatus: vi.fn(), onWake: vi.fn() });
    abort.abort();
    grant.resolve({ getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream);
    await expect(pending).rejects.toThrow('stopped');
    expect(trackStop).toHaveBeenCalled();
    expect(fetch.mock.calls.map(call => call[0])).toContain('/api/wake/consent/revoke');
  });
  it('ignores an aborted recognition response and never opens Nancy', async () => {
    const reply = deferred<Response>();
    const fetch = vi.fn((url: string) => url === '/api/wake/recognize' ? reply.promise : Promise.resolve(consentResponse())); vi.stubGlobal('fetch', fetch);
    const onWake = vi.fn();
    const handle = await startForegroundWake({ onStatus: vi.fn(), onWake });
    vi.spyOn(Date, 'now').mockReturnValue(1_000); frame();
    vi.spyOn(Date, 'now').mockReturnValue(1_700); activity.speech = false; frame();
    await vi.waitFor(() => expect(fetch.mock.calls.some(call => call[0] === '/api/wake/recognize')).toBe(true));
    await handle.stop();
    reply.resolve({ ok: true, status: 200, json: async () => ({ detected: true }) } as Response);
    await Promise.resolve(); await Promise.resolve();
    expect(onWake).not.toHaveBeenCalled(); expect(trackStop).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.map(call => call[0])).toContain('/api/wake/consent/revoke');
  });
  it('revokes a consent response that arrives after Stop and never sends audio', async () => {
    const late = deferred<Response>();
    const fetch = vi.fn((url: string) => url === '/api/wake/consent' ? late.promise : Promise.resolve({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    const abort = new AbortController(), onWake = vi.fn();
    const pending = startForegroundWake({ signal: abort.signal, onStatus: vi.fn(), onWake });
    abort.abort();
    late.resolve(consentResponse());
    await expect(pending).rejects.toThrow('stopped');
    await vi.waitFor(() => expect(fetch.mock.calls.map(call => call[0])).toContain('/api/wake/consent/revoke'));
    expect(fetch.mock.calls.some(call => call[0] === '/api/wake/recognize')).toBe(false);
    expect(onWake).not.toHaveBeenCalled();
  });
});
