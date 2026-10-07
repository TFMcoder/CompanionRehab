// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/client/api';
import { startLocalVoice, wavPcm16, type LocalVoiceHandle } from '../src/client/local-voice';

class FakeAudioContext {
  sampleRate = 48_000;
  destination = {};
  gain = { value: 1 };
  source: { onended?: () => void; stop: () => void } | undefined;
  processor = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null as ((event: AudioProcessingEvent) => void) | null };
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  decodeAudioData = vi.fn(async () => ({}));
  createMediaStreamSource() { return { connect: vi.fn(), disconnect: vi.fn() }; }
  createScriptProcessor() { return this.processor; }
  createChannelMerger() { return { connect: vi.fn(), disconnect: vi.fn() }; }
  createGain() { return { gain: this.gain, connect: vi.fn(), disconnect: vi.fn() }; }
  createBufferSource() {
    const source = { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(() => source.onended?.()), onended: undefined as (() => void) | undefined };
    this.source = source;
    return source;
  }
}

describe('local Nancy voice', () => {
  let context: FakeAudioContext;
  let stopTrack: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    context = new FakeAudioContext();
    stopTrack = vi.fn();
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    vi.stubGlobal('AudioContext', class extends FakeAudioContext { constructor() { super(); context = this; } });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }], getAudioTracks: () => [{ getSettings: () => ({echoCancellation:true}) }] })) } });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
    vi.spyOn(api, 'conversationStart').mockResolvedValue({ session_id: 's1', text: 'Good morning.', reply_id: 'r1' });
    vi.spyOn(api, 'conversationPlayed').mockResolvedValue({ ok: true });
    vi.spyOn(api, 'conversationEnd').mockResolvedValue({ ok: true });
    vi.spyOn(api, 'conversationInterrupt').mockResolvedValue({ ok: true });
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
    expect(states).not.toContain('listening');
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

  it('interrupts the first greeting without ending the session or acknowledging unheard review', async () => {
    let early!: LocalVoiceHandle;
    const states: string[] = [];
    const starting = startLocalVoice({ onReady: h => { early = h; }, onState: s => states.push(s), onTranscript: vi.fn(), onChange: vi.fn(), onNavigate: vi.fn() });
    await vi.waitFor(() => expect(context.source).toBeDefined());
    const audio = context.source!; early.interrupt();
    expect(audio.stop).toHaveBeenCalled(); expect(states.at(-1)).toBe('listening');
    const handle = await starting;
    expect(api.conversationInterrupt).toHaveBeenCalledWith('s1', expect.any(AbortSignal));
    expect(api.conversationPlayed).not.toHaveBeenCalled(); expect(api.conversationEnd).not.toHaveBeenCalled();
    await handle.stop();
  });
  it('allows sustained near-end microphone speech to interrupt playback when echo cancellation is active', async () => {
    const starting = startLocalVoice({ onState: vi.fn(), onTranscript: vi.fn(), onChange: vi.fn(), onNavigate: vi.fn() });
    await vi.waitFor(() => expect(context.source).toBeDefined());
    const audio = context.source!;
    for (let n=0;n<12;n++) {
      const mic=Float32Array.from({length:2048},(_,i)=>0.12*Math.sin((i+n*2048)*0.037)+0.07*Math.sin((i+n*2048)*0.051));
      context.processor.onaudioprocess?.({inputBuffer:{numberOfChannels:2,getChannelData:(channel:number)=>channel===0?mic:new Float32Array(2048)}} as unknown as AudioProcessingEvent);
    }
    await vi.waitFor(() => expect(audio.stop).toHaveBeenCalled());
    expect(api.conversationPlayed).not.toHaveBeenCalled(); expect(api.conversationInterrupt).toHaveBeenCalledTimes(1);
    const handle=await starting; await handle.stop();
  });
  it('waits for interrupt confirmation before sending the next typed turn and drops late speech', async () => {
    let early!: LocalVoiceHandle, confirm!: (value:{ok:true})=>void;
    vi.mocked(api.conversationInterrupt).mockReturnValue(new Promise(resolve=>{confirm=resolve;}));
    vi.spyOn(api,'conversationTurn').mockResolvedValue({text:'Next answer.',reply_id:'r2'});
    const starting = startLocalVoice({ onReady:h=>{early=h;},onState:vi.fn(),onTranscript:vi.fn(),onChange:vi.fn(),onNavigate:vi.fn() });
    await vi.waitFor(()=>expect(context.source).toBeDefined());
    const first=context.source;early.interrupt();const next=early.sendText('Different topic');
    await starting;expect(api.conversationTurn).not.toHaveBeenCalled();confirm({ok:true});
    await vi.waitFor(()=>expect(context.source).not.toBe(first));context.source!.onended?.();await next;
    expect(api.conversationPlayed).toHaveBeenCalledTimes(1);expect(api.conversationPlayed).toHaveBeenCalledWith('s1','r2',expect.any(AbortSignal));await early.stop();
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

  it('closes microphone and audio before reporting an unconfirmed interruption', async () => {
    const states: string[] = [];
    const onState = (state: string) => {
      states.push(state);
      if (state === 'error') {
        expect(stopTrack).toHaveBeenCalledTimes(1);
        expect(context.close).toHaveBeenCalledTimes(1);
      }
    };
    const starting = startLocalVoice({ onState, onTranscript: vi.fn(), onChange: vi.fn(), onNavigate: vi.fn() });
    await vi.waitFor(() => expect(context.source).toBeDefined());
    context.source!.onended?.();
    const handle = await starting;
    vi.spyOn(api, 'conversationTurn').mockImplementation((_id, _text, _turnId, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    }));
    vi.mocked(api.conversationInterrupt).mockRejectedValue(new Error('Connection lost'));
    const turn = handle.sendText('Tell me about my day');
    await vi.waitFor(() => expect(api.conversationTurn).toHaveBeenCalled());
    handle.interrupt();
    await vi.waitFor(() => expect(states.at(-1)).toBe('error'));
    await turn;
    expect(api.conversationEnd).toHaveBeenCalledTimes(1);
    await handle.stop();
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('cleans up an interruption failure during the opening greeting without acknowledging it', async () => {
    let handle!: LocalVoiceHandle;
    vi.mocked(api.conversationInterrupt).mockRejectedValue(new Error('Connection lost'));
    const starting = startLocalVoice({ onReady: value => { handle = value; }, onState: vi.fn(), onTranscript: vi.fn(), onChange: vi.fn(), onNavigate: vi.fn() });
    const result = starting.then(() => null, error => error as Error);
    await vi.waitFor(() => expect(context.source).toBeDefined());
    handle.interrupt();
    const error = await result;
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain('could not confirm the interruption');
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(api.conversationPlayed).not.toHaveBeenCalled();
    expect(api.conversationEnd).toHaveBeenCalledTimes(1);
  });

  it('does not replace a completed Stop with an error from a late interruption failure', async () => {
    let handle!: LocalVoiceHandle;
    let rejectInterrupt!: (error: Error) => void;
    const states: string[] = [];
    vi.mocked(api.conversationInterrupt).mockReturnValue(new Promise((_resolve, reject) => { rejectInterrupt = reject; }));
    const starting = startLocalVoice({ onReady: value => { handle = value; }, onState: state => states.push(state), onTranscript: vi.fn(), onChange: vi.fn(), onNavigate: vi.fn() });
    await vi.waitFor(() => expect(context.source).toBeDefined());
    handle.interrupt();
    await starting;
    await handle.stop();
    rejectInterrupt(new Error('Connection lost'));
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)).toBe('stopped');
    expect(states).not.toContain('error');
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
  });
});
