// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {SafariStudyPage} from '../src/client/safari-study';
import {api} from '../src/client/api';
import {startLocalVoice,type LocalVoiceOptions} from '../src/client/local-voice';
import {voiceTimingMetric} from '../src/client/voice-timing';
vi.mock('../src/client/local-voice',()=>({startLocalVoice:vi.fn()}));
const runId='00000000-0000-4000-8000-000000000001',replyId='00000000-0000-4000-8000-000000000002';
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();sessionStorage.clear();});
describe('guided phone study',()=>{
 let setup:any,options:LocalVoiceOptions,stop:()=>Promise<void>,samples:any[],ratings:any[];
 beforeEach(()=>{
  setup=null;samples=[];ratings=[];stop=vi.fn(async()=>{});sessionStorage.clear();
  vi.spyOn(api,'session').mockResolvedValue({authenticated:true,role:'client',participant_id:runId,scope_key:'scope',voice_eligible:true});
  vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
   const body=init?.body?JSON.parse(String(init.body)):null;
   if(path==='/api/safari-study'&&body){setup=body;return{ok:true,json:async()=>({id:body.id})};}
   if(path.endsWith('/sample'))samples.push(body);
   if(path.endsWith('/rating'))ratings.push(body);
   if(path==='/api/safari-study')return{ok:true,json:async()=>({available:true})};
   return{ok:true,json:async()=>({id:setup?.id,setup,samples,events:[],completed:false})};
  }));
  vi.mocked(startLocalVoice).mockImplementation(async value=>{options=value;const handle={stop,sendText:vi.fn(async(_text:string)=>{}),interrupt:vi.fn()};value.onReady?.(handle);value.onState('listening','Nancy is listening.');return handle;});
 });
 it('requires a deliberate Talk tap, labels the selected network and saves manual ratings separately from automatic timing',async()=>{
  render(<SafariStudyPage/>);await screen.findByText('Before you start');expect(startLocalVoice).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Connection'),{target:{value:'cellular'}});fireEvent.click(screen.getByRole('button',{name:'Start cellular pass'}));
  await screen.findByRole('button',{name:'Talk to Nancy'});expect(setup.network).toBe('cellular');expect(startLocalVoice).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Talk to Nancy'}));await waitFor(()=>expect(startLocalVoice).toHaveBeenCalledTimes(1));
  await act(async()=>{options.onTranscript('you','Private phrase');options.onTranscript('nancy','Private answer');
    options.onObservation?.({conversation_id:runId,turn_id:runId,metric:voiceTimingMetric({inputMode:'speech',inputAt:0,speechEndedAt:0,requestAt:900,repliedAt:1000},{reply_id:replyId},1200,undefined),
    detail:{audio_headers_ms:100,audio_download_ms:50,audio_decode_ms:50,audio_preparation_server_ms:75,audio_bytes:10000,sample_rate:48000,context_state:'running'},input_at:0,speech_ended_at:0});});
  await waitFor(()=>expect(samples).toHaveLength(1));await screen.findByText('Private answer');
  fireEvent.click(screen.getByRole('button',{name:'I hear her answer'}));fireEvent.change(screen.getByLabelText('Was the answer right?'),{target:{value:'correct'}});
  fireEvent.click(screen.getByRole('button',{name:'Save rating'}));await waitFor(()=>expect(ratings).toHaveLength(1));
  expect(ratings[0].rating.heard_after_input_ms).toBeTypeOf('number');expect(samples[0].metric.audible_response_ms).toBeNull();
  expect(JSON.stringify({samples,ratings})).not.toContain('Private');expect(samples[0]).not.toHaveProperty('input_at');
 });
 it('clears private text and stops capture when the authenticated scope changes',async()=>{
  render(<SafariStudyPage/>);await screen.findByText('Before you start');fireEvent.click(screen.getByRole('button',{name:'Start Wi-Fi pass'}));
  fireEvent.click(await screen.findByRole('button',{name:'Talk to Nancy'}));await waitFor(()=>expect(startLocalVoice).toHaveBeenCalled());
  await act(async()=>{options.onTranscript('you','Private phrase');});await screen.findByText('Private phrase');await act(async()=>{window.dispatchEvent(new Event('nancy:scope-changed'));});
  await screen.findByText('Sign in to your test copy');expect(stop).toHaveBeenCalled();expect(screen.queryByText('Private phrase')).toBeNull();expect(sessionStorage.getItem('nancy-safari-study-v1')).toBeNull();
 });
});
