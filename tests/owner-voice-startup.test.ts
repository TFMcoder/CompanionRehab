// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ownerVoiceStartupEnabled,waitForOwnerVoiceStartup} from '../src/client/owner-voice-startup';

class Audio extends EventTarget {
  state='suspended'; sampleRate=48_000; destination={};
  node={buffer:null as unknown,connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn(),onended:null as unknown};
  resume=vi.fn(async()=>{});
  createBufferSource(){return this.node;}
  createBuffer(){return {};}
  running(){this.state='running';this.dispatchEvent(new Event('statechange'));}
}
function fixture(){
 const context=new Audio(),controller=new AbortController(),onProgress=vi.fn(),onAudioUnlock=vi.fn();
 let grant!:(stream:MediaStream)=>void;
 const stream=new Promise<MediaStream>(resolve=>{grant=resolve;});
 const microphone={getTracks:()=>[]} as unknown as MediaStream;
 const initialResume=new Promise<void>(()=>{});
 const ready=waitForOwnerVoiceStartup({context:context as unknown as AudioContext,stream,initialResume,signal:controller.signal,onProgress,onAudioUnlock});
 return{context,controller,onProgress,onAudioUnlock,grant,microphone,ready};
}
beforeEach(()=>{vi.useFakeTimers();vi.spyOn(document,'hasFocus').mockReturnValue(true);});afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('owner microphone/audio startup',()=>{
 it('is disabled in ordinary builds',()=>{expect(ownerVoiceStartupEnabled()).toBe(false);vi.stubGlobal('__NANCY_OWNER_VOICE_STARTUP__',true);expect(ownerVoiceStartupEnabled()).toBe(true);});
 it('uses the real running state when the first resume promise stays pending',async()=>{
  const f=fixture();f.context.running();f.grant(f.microphone);
  await expect(f.ready).resolves.toBe(f.microphone);expect(f.context.resume).toHaveBeenCalledOnce();
  expect(f.context.node.start).toHaveBeenCalledOnce();expect(f.context.node.disconnect).toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
 it('retries audio after microphone capture interrupts its first unlock',async()=>{
  const f=fixture();f.context.resume.mockImplementation(async()=>{f.context.running();});f.grant(f.microphone);
  await expect(f.ready).resolves.toBe(f.microphone);expect(f.context.resume).toHaveBeenCalledOnce();
 });
 it('offers an explicit gesture recovery and waits for both microphone and audio',async()=>{
  const f=fixture();let settled=false;void f.ready.then(()=>{settled=true;});f.grant(f.microphone);await Promise.resolve();
  expect(settled).toBe(false);expect(f.onProgress).toHaveBeenLastCalledWith('Microphone is ready. Tap Enable sound to hear Nancy.');
  const resume=f.onAudioUnlock.mock.calls.at(-1)![0] as ()=>void;
  f.context.resume.mockImplementation(async()=>{f.context.running();});resume();
  expect(f.context.resume).toHaveBeenCalledTimes(2);await expect(f.ready).resolves.toBe(f.microphone);expect(f.onAudioUnlock).toHaveBeenLastCalledWith(null);
 });
 it('distinguishes an ignored microphone prompt from an audio failure',async()=>{
  const f=fixture(),result=f.ready.then(()=>{throw new Error('Expected timeout');},e=>e as Error);f.context.running();await vi.advanceTimersByTimeAsync(20_000);
  expect(f.onProgress).toHaveBeenLastCalledWith('Audio is ready. Allow the microphone in your browser to start Nancy.');
  await vi.advanceTimersByTimeAsync(40_000);expect((await result).message).toContain('Microphone permission is still waiting');expect(vi.getTimerCount()).toBe(0);
 });
 it('identifies background focus and updates the instruction when the page returns',async()=>{
  vi.mocked(document.hasFocus).mockReturnValue(false);const f=fixture();f.context.running();
  expect(f.onProgress).toHaveBeenLastCalledWith('Audio is ready. Open this Nancy tab in the foreground so your browser can ask for the microphone.');
  vi.mocked(document.hasFocus).mockReturnValue(true);window.dispatchEvent(new Event('focus'));
  expect(f.onProgress).toHaveBeenLastCalledWith('Audio is ready. Allow the microphone in your browser to start Nancy.');
  f.grant(f.microphone);await expect(f.ready).resolves.toBe(f.microphone);
 });
 it('bounds stalled audio after a microphone grant and clears the recovery action',async()=>{
  const f=fixture(),result=f.ready.then(()=>{throw new Error('Expected timeout');},e=>e as Error);f.grant(f.microphone);await vi.advanceTimersByTimeAsync(20_000);
  expect((await result).message).toContain('microphone is ready, but audio has not started');expect(f.onAudioUnlock).toHaveBeenLastCalledWith(null);expect(vi.getTimerCount()).toBe(0);
 });
 it('cancels without reviving a stale retry or late grant',async()=>{
  const f=fixture(),result=f.ready.then(()=>{throw new Error('Expected cancellation');},e=>e as Error);await vi.advanceTimersByTimeAsync(750);const resume=f.onAudioUnlock.mock.calls.at(-1)![0] as ()=>void;
  f.controller.abort();expect((await result).message).toBe('Conversation ended.');resume();f.grant(f.microphone);f.context.running();await Promise.resolve();
  expect(f.context.resume).not.toHaveBeenCalled();expect(f.onAudioUnlock).toHaveBeenLastCalledWith(null);expect(vi.getTimerCount()).toBe(0);
 });
 it('preserves microphone denial and removes all startup timers',async()=>{
  const context=new Audio(),denied=new DOMException('Denied','NotAllowedError');
  await expect(waitForOwnerVoiceStartup({context:context as unknown as AudioContext,stream:Promise.reject(denied),initialResume:Promise.resolve(),signal:new AbortController().signal,onProgress:vi.fn()})).rejects.toBe(denied);
  expect(vi.getTimerCount()).toBe(0);
 });
});
