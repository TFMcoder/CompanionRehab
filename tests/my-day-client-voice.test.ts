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
    vi.spyOn(api, 'conversationReceived').mockResolvedValue({ok:true});
    vi.spyOn(api, 'conversationEnd').mockResolvedValue({ ok: true });
    vi.spyOn(api, 'conversationInterrupt').mockResolvedValue({ ok: true });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it.each([{status:401,code:'unauthorized',event:'nancy:session-expired'},{status:403,code:'scope_changed',event:'nancy:scope-changed'}])('stops microphone and conversation on speech $status',async({status,code,event})=>{
    const states:string[]=[],notify=vi.fn();window.addEventListener(event,notify);
    const starting=startLocalVoice({onState:s=>states.push(s),onTranscript:vi.fn(),onChange:vi.fn(),onNavigate:vi.fn()});
    await vi.waitFor(()=>expect(context.source).toBeDefined());context.source!.onended?.();const handle=await starting;
    vi.spyOn(api,'conversationTurn').mockResolvedValue({text:'Saved reply',reply_id:'r2'});
    vi.mocked(fetch).mockResolvedValueOnce({ok:false,status,json:async()=>({error:{code}})} as Response);
    await handle.sendText('Check my activity');
    expect(notify).toHaveBeenCalledTimes(1);expect(stopTrack).toHaveBeenCalledTimes(1);expect(api.conversationEnd).toHaveBeenCalledWith('s1');
    expect(states.at(-1)).not.toBe('listening');window.removeEventListener(event,notify);
  });

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

  it('reports numeric playback scheduling once without treating it as observed audibility', async () => {
    const starting = startLocalVoice({onState:vi.fn(),onTranscript:vi.fn(),onChange:vi.fn(),onNavigate:vi.fn()});
    await vi.waitFor(()=>expect(context.source).toBeDefined());
    const timingCalls=vi.mocked(fetch).mock.calls.filter(([url])=>String(url).endsWith('/timing'));
    expect(timingCalls).toHaveLength(1);
    const payload=JSON.parse(String(timingCalls[0][1]?.body));
    expect(payload).toMatchObject({reply_id:'r1',input_mode:'opening',session_phase:'first_reply',audible_response_ms:null,
      endpointing_ms:null,speech_end_to_playback_start_ms:null,reported_output_latency_ms:null});
    expect(payload.input_to_playback_start_ms).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(payload)).not.toContain('Good morning');
    context.source!.onended?.();const handle=await starting;await handle.stop();
  });

  it('continues audio when the optional metric transport fails synchronously', async () => {
    vi.mocked(fetch).mockImplementation((url)=>{if(String(url).endsWith('/timing'))throw new Error('Diagnostic offline');
      return Promise.resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)} as Response);});
    const states:string[]=[];
    const starting=startLocalVoice({onState:s=>states.push(s),onTranscript:vi.fn(),onChange:vi.fn(),onNavigate:vi.fn()});
    await vi.waitFor(()=>expect(context.source).toBeDefined());context.source!.onended?.();const handle=await starting;
    expect(states.at(-1)).toBe('listening');expect(api.conversationPlayed).toHaveBeenCalledTimes(1);await handle.stop();
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

  it('acknowledges a saved result after retaining its text without waiting for audio or the acknowledgement response',async()=>{
    const events:string[]=[];
    const starting=startLocalVoice({onState:vi.fn(),onTranscript:(_speaker,text)=>events.push('text:'+text),onChange:vi.fn(),onNavigate:vi.fn()});
    await vi.waitFor(()=>expect(context.source).toBeDefined());context.source!.onended?.();const handle=await starting;
    const previous=context.source;let finishAck!:(value:{ok:true})=>void;
    vi.mocked(api.conversationReceived).mockImplementationOnce(()=>{events.push('received');return new Promise(resolve=>{finishAck=resolve;});});
    vi.spyOn(api,'conversationTurn').mockResolvedValue({text:'Your activity is recorded.',reply_id:'r2',acknowledgement_required:true,changed:true});
    const turn=handle.sendText('save this change');
    await vi.waitFor(()=>expect(context.source).not.toBe(previous));
    expect(events.indexOf('text:Your activity is recorded.')).toBeLessThan(events.indexOf('received'));
    expect(api.conversationReceived).toHaveBeenCalledWith('s1','r2',expect.any(AbortSignal));
    expect(api.conversationPlayed).toHaveBeenCalledTimes(1);
    context.source!.onended?.();await turn;
    expect(api.conversationPlayed).toHaveBeenCalledTimes(2);
    finishAck({ok:true});await handle.stop();
  });

  it('continues speaking a retained saved result after a lost acknowledgement request',async()=>{
    const states:string[]=[];
    const starting=startLocalVoice({onState:s=>states.push(s),onTranscript:vi.fn(),onChange:vi.fn(),onNavigate:vi.fn()});
    await vi.waitFor(()=>expect(context.source).toBeDefined());context.source!.onended?.();const handle=await starting;
    const previous=context.source;
    vi.mocked(api.conversationReceived).mockRejectedValueOnce(new Error('Synthetic acknowledgement connection loss'));
    vi.spyOn(api,'conversationTurn').mockResolvedValue({text:'Your activity is recorded.',reply_id:'r2',acknowledgement_required:true});
    const turn=handle.sendText('save this change');await vi.waitFor(()=>expect(context.source).not.toBe(previous));
    context.source!.onended?.();await turn;
    expect(api.conversationReceived).toHaveBeenCalledTimes(1);expect(states.at(-1)).toBe('listening');await handle.stop();
  });

  it('does not acknowledge an empty result or one that the UI could not retain',async()=>{
    const transcript=vi.fn();
    const starting=startLocalVoice({onState:vi.fn(),onTranscript:transcript,onChange:vi.fn(),onNavigate:vi.fn()});
    await vi.waitFor(()=>expect(context.source).toBeDefined());context.source!.onended?.();const handle=await starting;
    const turn=vi.spyOn(api,'conversationTurn');
    turn.mockResolvedValueOnce({text:'',reply_id:'r2',acknowledgement_required:true});await handle.sendText('save this change');
    turn.mockResolvedValueOnce({text:'Your activity is recorded.',reply_id:'r3',acknowledgement_required:true});
    transcript.mockImplementation((speaker,text)=>{if(speaker==='nancy'&&text==='Your activity is recorded.')throw new Error('Synthetic render failure');});
    await handle.sendText('retry this activity save');
    expect(api.conversationReceived).not.toHaveBeenCalled();await handle.stop();
  });

  it('prefetches one following sentence and acknowledges only after the final sentence drains', async () => {
    vi.mocked(api.conversationStart).mockResolvedValue({ session_id: 's1', text: 'One sentence. Two sentences.', reply_id: 'r1', speech_parts: 2 } as never);
    const starting = startLocalVoice({ onState: vi.fn(), onTranscript: vi.fn(), onChange: vi.fn(), onNavigate: vi.fn() });
    await vi.waitFor(() => expect(context.source).toBeDefined());
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([url])=>String(url).includes('/speech?'))).toHaveLength(2));
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
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([url])=>String(url).includes('/speech?'))).toHaveLength(2));
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
    await expect(starting).rejects.toThrow('Conversation ended.');
    expect(context.close).toHaveBeenCalledTimes(1);
    release({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream);
    await vi.waitFor(() => expect(stopTrack).toHaveBeenCalledTimes(1));
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(api.conversationStart).not.toHaveBeenCalled();
  });

  it('settles Stop while browser audio unlock remains pending', async () => {
    let grantUnlock!: () => void;
    vi.stubGlobal('AudioContext', class extends FakeAudioContext { constructor() {
      super(); context = this;
      this.resume.mockReturnValue(new Promise<undefined>(resolve => { grantUnlock = () => resolve(undefined); }));
    } });
    const controller = new AbortController();
    const onState = vi.fn();
    const starting = startLocalVoice({ signal: controller.signal, onState, onTranscript: vi.fn(), onChange: vi.fn(), onNavigate: vi.fn() });
    // Microphone resolves first; AudioContext.resume remains pending.
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(starting).rejects.toThrow('Conversation ended.');
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(api.conversationStart).not.toHaveBeenCalled();
    grantUnlock();
    await Promise.resolve();
    expect(api.conversationStart).not.toHaveBeenCalled();
  });

  it('stops a granted microphone when audio unlock itself times out', async () => {
    vi.stubGlobal('AudioContext', class extends FakeAudioContext { constructor() {
      super(); context = this;
      this.resume.mockReturnValue(new Promise<undefined>(() => undefined));
    } });
    vi.useFakeTimers();
    const starting = startLocalVoice({ onState: vi.fn(), onTranscript: vi.fn(), onChange: vi.fn(), onNavigate: vi.fn() });
    const settled = starting.then(() => null, error => error as Error);
    // Let the microphone grant settle while audio unlock remains pending.
    await Promise.resolve();
    await Promise.resolve();
    expect(stopTrack).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await settled)?.message).toContain('permission did not finish within 20 seconds');
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(api.conversationStart).not.toHaveBeenCalled();
  });

  it('times out a pending browser permission and closes a later microphone grant', async () => {
    let grant!: (stream: MediaStream) => void;
    const lateStream = new Promise<MediaStream>(resolve => { grant = resolve; });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => lateStream } });
    vi.useFakeTimers();
    const onState = vi.fn();
    const starting = startLocalVoice({ onState, onTranscript: vi.fn(), onChange: vi.fn(), onNavigate: vi.fn() });
    const settled = starting.then(() => null, error => error as Error);
    expect(onState).toHaveBeenCalledWith('connecting', expect.stringContaining('Allow microphone'));
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await settled)?.message).toContain('permission did not finish within 20 seconds');
    expect(onState).toHaveBeenLastCalledWith('error', expect.stringContaining('permission did not finish'));
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(api.conversationStart).not.toHaveBeenCalled();
    grant({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream);
    await Promise.resolve();
    expect(stopTrack).toHaveBeenCalledTimes(1);
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
