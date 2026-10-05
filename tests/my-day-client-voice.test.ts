// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/client/api';
import { startLocalVoice, wavPcm16 } from '../src/client/local-voice';

class FakeAudioContext {
  sampleRate = 48_000;
  destination = {};
  gain = { value: 1 };
  source: { onended?: () => void; stop: () => void } | undefined;
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  decodeAudioData = vi.fn(async () => ({}));
  createMediaStreamSource() { return { connect: vi.fn(), disconnect: vi.fn() }; }
  createScriptProcessor() { return { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null }; }
  createGain() { return { gain: this.gain, connect: vi.fn() }; }
  createBufferSource() {
    const source = { buffer: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn(() => source.onended?.()), onended: undefined as (() => void) | undefined };
    this.source = source;
    return source;
  }
}

describe('local Nancy voice', () => {
  let context: FakeAudioContext;
  beforeEach(() => {
    context = new FakeAudioContext();
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    vi.stubGlobal('AudioContext', class extends FakeAudioContext { constructor() { super(); context = this; } });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) } });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
    vi.spyOn(api, 'conversationStart').mockResolvedValue({ session_id: 's1', text: 'Good morning.', reply_id: 'r1' });
    vi.spyOn(api, 'conversationPlayed').mockResolvedValue({ ok: true });
    vi.spyOn(api, 'conversationEnd').mockResolvedValue({ ok: true });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('encodes a mono 16 kHz PCM WAV from microphone samples', () => {
    const wav = wavPcm16([new Float32Array([0, 1, -1, 0])], 16_000);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
  });

  it('acknowledges a reply only after playback ends', async () => {
    const states: string[] = [];
    const starting = startLocalVoice({ onState: state => states.push(state), onTranscript: vi.fn(), onChange: vi.fn(), onNavigate: vi.fn() });
    await vi.waitFor(() => expect(context.source).toBeDefined());
    expect(fetch).toHaveBeenCalledWith('/api/conversation/s1/speech?turn_id=r1', expect.any(Object));
    expect(api.conversationPlayed).not.toHaveBeenCalled();
    context.source!.onended?.();
    const handle = await starting;
    expect(api.conversationPlayed).toHaveBeenCalledWith('s1', 'r1', expect.any(AbortSignal));
    expect(states).toContain('listening');
    await handle.stop();
  });

  it('prefetches one following sentence and acknowledges only after the final sentence drains', async () => {
    vi.mocked(api.conversationStart).mockResolvedValue({ session_id: 's1', text: 'One sentence. Two sentences.', reply_id: 'r1', speech_parts: 2 } as never);
    const starting = startLocalVoice({ onState: vi.fn(), onTranscript: vi.fn(), onChange: vi.fn(), onNavigate: vi.fn() });
    await vi.waitFor(() => expect(context.source).toBeDefined());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/conversation/s1/speech?turn_id=r1&part=0', expect.any(Object));
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/conversation/s1/speech?turn_id=r1&part=1', expect.any(Object));
    expect(api.conversationPlayed).not.toHaveBeenCalled();
    const first = context.source!;
    first.onended?.();
    await vi.waitFor(() => expect(context.source).not.toBe(first));
    expect(api.conversationPlayed).not.toHaveBeenCalled();
    context.source!.onended?.();
    const handle = await starting;
    expect(api.conversationPlayed).toHaveBeenCalledTimes(1);
    await handle.stop();
  });

  it('aborts prefetched speech and does not acknowledge a cancelled multipart reply', async () => {
    vi.mocked(api.conversationStart).mockResolvedValue({ session_id: 's1', text: 'One sentence. Two sentences.', reply_id: 'r1', speech_parts: 2 } as never);
    const controller = new AbortController();
    const starting = startLocalVoice({ signal: controller.signal, onState: vi.fn(), onTranscript: vi.fn(), onChange: vi.fn(), onNavigate: vi.fn() });
    await vi.waitFor(() => expect(context.source).toBeDefined());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const fetchCalls = vi.mocked(fetch).mock.calls;
    const nextSignal = (fetchCalls[1]?.[1] as RequestInit).signal as AbortSignal;
    expect(nextSignal.aborted).toBe(false);
    controller.abort();
    await expect(starting).rejects.toThrow();
    expect(nextSignal.aborted).toBe(true);
    expect(api.conversationPlayed).not.toHaveBeenCalled();
  });

  it('does not acknowledge interrupted playback', async () => {
    const controller = new AbortController();
    const starting = startLocalVoice({ signal: controller.signal, onState: vi.fn(), onTranscript: vi.fn(), onChange: vi.fn(), onNavigate: vi.fn() });
    await vi.waitFor(() => expect(context.source).toBeDefined());
    controller.abort();
    context.source!.onended?.();
    await expect(starting).rejects.toThrow();
    expect(api.conversationPlayed).not.toHaveBeenCalled();
  });

  it('releases audio immediately when stopped during a pending microphone prompt', async () => {
    let release!: (stream: MediaStream) => void;
    const pendingStream = new Promise<MediaStream>(resolve => { release = resolve; });
    const stopTrack = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => pendingStream } });
    const controller = new AbortController();
    const starting = startLocalVoice({ signal: controller.signal, onState: vi.fn(), onTranscript: vi.fn(), onChange: vi.fn(), onNavigate: vi.fn() });
    controller.abort();
    await vi.waitFor(() => expect(context.close).toHaveBeenCalledTimes(1));
    release({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream);
    await expect(starting).rejects.toThrow('Conversation ended.');
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(api.conversationStart).not.toHaveBeenCalled();
  });
});
