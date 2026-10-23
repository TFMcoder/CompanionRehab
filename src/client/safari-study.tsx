import {useEffect,useRef,useState} from 'react';
import {api,type SessionInfo} from './api';
import {startLocalVoice,type LocalVoiceHandle,type LocalVoiceState,type VoiceObservation} from './local-voice';
import {safariScenarios,type SafariRunInput,type SafariSample,type SafariRating} from '../shared/safari-study';

type StoredSample=SafariSample&{rating?:SafariRating};
type Result={id:string;setup:SafariRunInput;samples:StoredSample[];events:Array<{kind:string;scenario_id:string}>;completed:boolean};
const defaults:SafariRating={heard_after_detected_end_ms:null,heard_after_input_ms:null,transcript:'not_sure',answer:'not_sure',responsiveness:'noticeable_wait',problem:'none'};
const runKey='nancy-safari-study-v1';
const seconds=(ms:number|null)=>ms===null?'Not measured':`${(ms/1000).toFixed(2)} seconds`;

export function SafariStudyPage(){
  const [session,setSession]=useState<SessionInfo|null>(null),[loading,setLoading]=useState(true),[issue,setIssue]=useState('');
  const [password,setPassword]=useState(''),[run,setRun]=useState<Result|null>(null),[step,setStep]=useState(0),[busy,setBusy]=useState(false);
  const [network,setNetwork]=useState<SafariRunInput['network']>('wifi'),[audio,setAudio]=useState<SafariRunInput['audio']>('phone_speaker');
  const [browser,setBrowser]=useState<SafariRunInput['browser']>('safari'),[condition,setCondition]=useState<SafariRunInput['condition']>('new_page');
  const [voiceState,setVoiceState]=useState<LocalVoiceState>('stopped'),[voiceMessage,setVoiceMessage]=useState(''),[transcript,setTranscript]=useState(''),[reply,setReply]=useState('');
  const [sample,setSample]=useState<StoredSample|null>(null),[rating,setRating]=useState<SafariRating>(defaults),[saved,setSaved]=useState(false);
  const voice=useRef<LocalVoiceHandle|null>(null),controller=useRef<AbortController|null>(null),active=useRef(false),observation=useRef<VoiceObservation|null>(null);
  const latest=useRef({session,run,step});latest.current={session,run,step};
  const observations=useRef(new Map<string,Promise<unknown>>()),failed=useRef(new Map<string,StoredSample>());
  const phase=useRef<LocalVoiceState>('stopped'),scenarioAtRequest=useRef(0);
  const scenario=safariScenarios[step];
  function updateRating(patch:Partial<SafariRating>){setSaved(false);setRating(r=>({...r,...patch}));}
  async function request<T>(path:string,body?:unknown):Promise<T>{
    const scope=latest.current.session?.scope_key;
    const res=await fetch('/api/safari-study'+path,{credentials:'same-origin',cache:'no-store',method:body===undefined?'GET':'POST',
      headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(scope?{'X-Nancy-Scope':scope}:{})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(8000)});
    if(!res.ok)throw new Error(res.status===401?'Sign in to the test account again.':res.status===403?'Your account view changed. Start a new pass.':'The test observation was not saved. Retry while this conversation is open.');
    return res.json() as Promise<T>;
  }
  async function load(){
    try{const current=await api.session();if(!current.voice_eligible)throw Error('Voice is unavailable for this login. Use the existing owner test account.');
      latest.current.session=current;setSession(current);await request('');
      const prior=sessionStorage.getItem(runKey);if(prior){try{const found=await request<Result>('/'+prior);setRun(found);setNetwork(found.setup.network);setStep(0);}catch{sessionStorage.removeItem(runKey);}}
    }catch(error){setIssue(error instanceof Error?error.message:'Please sign in to the test account.');}finally{setLoading(false);}
  }
  async function stop(){controller.current?.abort();await voice.current?.stop();voice.current=null;active.current=false;}
  const event=(kind:'page_hidden'|'page_visible'|'no_reply'|'permission_error'|'voice_error'|'unexpected_navigation')=>{
    const current=latest.current;if(!current.run||current.run.completed)return;
    void request('/'+current.run.id+'/event',{id:crypto.randomUUID(),scenario_id:safariScenarios[current.step].id,kind})
      .catch(()=>setIssue('A test event could not be saved. Your voice conversation can continue.'));
  };
  useEffect(()=>{
    void load();
    const visibility=()=>event(document.visibilityState==='hidden'?'page_hidden':'page_visible');
    const expired=()=>{void stop();latest.current.session=null;latest.current.run=null;setSession(null);setRun(null);setSample(null);setTranscript('');setReply('');sessionStorage.removeItem(runKey);setIssue('Your login or account view changed. Sign in and start a new pass.');};
    document.addEventListener('visibilitychange',visibility);window.addEventListener('nancy:session-expired',expired);window.addEventListener('nancy:scope-changed',expired);
    return()=>{void stop();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('nancy:session-expired',expired);window.removeEventListener('nancy:scope-changed',expired);};
  },[]);
  async function createPass(){setBusy(true);setIssue('');try{
    await stop();const setup={id:crypto.randomUUID(),network,browser,audio,condition};await request('',setup);
    const result=await request<Result>('/'+setup.id);observations.current.clear();failed.current.clear();latest.current.run=result;setRun(result);setStep(0);setSample(null);setTranscript('');setReply('');setRating(defaults);setSaved(false);sessionStorage.setItem(runKey,setup.id);
  }catch(e){setIssue(e instanceof Error?e.message:'Could not start this pass.');}finally{setBusy(false);}}
  function observe(value:VoiceObservation){
    const current=latest.current;if(!current.run||current.run.completed)return;
    const item:StoredSample={id:crypto.randomUUID(),scenario_id:safariScenarios[scenarioAtRequest.current].id,conversation_id:value.conversation_id,turn_id:value.turn_id,metric:value.metric,detail:value.detail};
    observation.current=value;setSample(item);setRating({...defaults});setSaved(false);
    const saving=request('/'+current.run.id+'/sample',item).then(()=>{failed.current.delete(item.id);setRun(r=>r?{...r,samples:[...r.samples,item]}:r);})
      .catch(()=>{failed.current.set(item.id,item);setIssue('This timing has not been saved. Use Save rating to retry; do not repeat your question just to save timings.');});
    observations.current.set(item.id,saving);
  }
  async function talk(){if(active.current)return;active.current=true;scenarioAtRequest.current=latest.current.step;setIssue('');controller.current=new AbortController();
    try{await startLocalVoice({signal:controller.current.signal,onReady:h=>{voice.current=h;},
      onState:(state,message)=>{if(state==='thinking'&&phase.current==='listening')scenarioAtRequest.current=latest.current.step;
        if(state==='thinking'){setSample(null);observation.current=null;setRating(defaults);setSaved(false);}
        phase.current=state;setVoiceState(state);setVoiceMessage(message??'');if(state==='stopped'||state==='error')active.current=false;},
      onTranscript:(speaker,text)=>speaker==='you'?setTranscript(text):setReply(text),onChange:()=>{},onNavigate:()=>event('unexpected_navigation'),onObservation:observe});
    }catch(error){active.current=false;const message=error instanceof Error?error.message:'Voice did not start.';setIssue(message);event(/permission/i.test(message)?'permission_error':'voice_error');}}
  function heard(){const seen=observation.current;if(!seen||!sample)return;const at=performance.now(),elapsed=(from:number|null)=>from===null||at<from||at-from>300_000?null:Math.round(at-from);
    setSaved(false);setRating(r=>({...r,heard_after_detected_end_ms:elapsed(seen.speech_ended_at),heard_after_input_ms:elapsed(seen.input_at)}));}
  async function saveRating(next:boolean){if(!run||!sample)return;setBusy(true);setIssue('');try{
    await observations.current.get(sample.id);
    if(failed.current.has(sample.id)){await request('/'+run.id+'/sample',failed.current.get(sample.id));failed.current.delete(sample.id);}
    await request('/'+run.id+'/rating',{sample_id:sample.id,rating});setSaved(true);setRun(r=>r?{...r,samples:r.samples.map(s=>s.id===sample.id?{...s,rating}:s)}:r);
    if(next&&step<safariScenarios.length-1){setStep(step+1);setSample(null);observation.current=null;setTranscript('');setReply('');setRating(defaults);setSaved(false);}
  }catch(e){setIssue(e instanceof Error?e.message:'The rating was not saved.');}finally{setBusy(false);}}
  async function finish(){if(!run)return;if(sample&&!saved&&!failed.current.has(sample.id)){setIssue('Save the current rating before finishing this pass.');return;}setBusy(true);try{await Promise.all(observations.current.values());
    for(const [id,missing]of failed.current){
      await request('/'+run.id+'/event',{id,scenario_id:missing.scenario_id,kind:'timing_save_failed'});failed.current.delete(id);
    }
    await request('/'+run.id+'/finish',{});await stop();setRun(await request<Result>('/'+run.id));
  }catch(e){setIssue(e instanceof Error?e.message:'Could not finish this pass.');}finally{setBusy(false);}}
  function download(){if(!run)return;void request<Result>('/'+run.id).then(result=>{const blob=new Blob([JSON.stringify(result,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`nancy-${run.setup.network}-${run.id.slice(0,8)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}).catch(()=>setIssue('Could not download the results.'));}
  if(loading)return <main className="study"><p>Opening the phone test…</p></main>;
  return <main className="study">
    <header className="study-head"><p>Nancy · Your practice copy</p><h1>Phone voice test</h1><p>Heart voice · Your existing plan · Practice data</p>
      {session&&run&&!run.completed&&<button className="primary" disabled={busy} onClick={()=>void (active.current?stop():talk())}>{['stopped','error'].includes(voiceState)?'Talk to Nancy':'Stop Nancy'}</button>}
      {session&&run&&!run.completed&&<button className="primary heard" disabled={!sample||rating.heard_after_input_ms!==null} onClick={heard}>I hear her answer</button>}
      <p role="status">{voiceMessage}</p></header>
    {issue&&<p role="alert" className="issue">{issue}</p>}
    {!session?<section><h2>Sign in to your test copy</h2><p>Use your existing tester password. This is separate from Dad’s account.</p>
      <form onSubmit={e=>{e.preventDefault();setBusy(true);void api.login('tester@nancy.local',password,true).then(()=>{setPassword('');setIssue('');return load();}).catch(()=>setIssue('The test login did not work. Check the existing tester password.')).finally(()=>setBusy(false));}}>
        <label>Email<input readOnly value="tester@nancy.local" autoComplete="username"/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password"/></label>
        <p>This test remembers this device using the existing 30-day sign-in option.</p><button className="primary" disabled={busy||!password}>Sign in</button></form></section>:
      <>
      {(!run||run.completed)&&<section><h2>{run?'Start the next pass':'Before you start'}</h2><p>Use Safari on your phone. Keep the same volume and audio device for both passes. Choose the network yourself; Nancy cannot reliably verify it.</p>
        <label>Connection<select value={network} onChange={e=>setNetwork(e.target.value as typeof network)}><option value="wifi">Wi-Fi</option><option value="cellular">Cellular — Wi-Fi turned off in Settings</option></select></label>
        <label>Browser<select value={browser} onChange={e=>setBrowser(e.target.value as typeof browser)}><option value="safari">Safari</option><option value="other">Another browser</option><option value="unknown">Not sure</option></select></label>
        <label>Sound<select value={audio} onChange={e=>setAudio(e.target.value as typeof audio)}><option value="phone_speaker">Phone speaker</option><option value="headphones">Wired headphones</option><option value="bluetooth">Bluetooth</option></select></label>
        <label>Page condition<select value={condition} onChange={e=>setCondition(e.target.value as typeof condition)}><option value="new_page">Just opened or reloaded the page</option><option value="repeat">Repeating without reloading</option></select></label>
        <p>Only timings and your button choices are saved. Records expire after 14 days; expired files are removed within an hour while this test service is running. Audio and conversation text are not saved by this test sheet. Normal Nancy processing uses the existing connection.</p>
        <button className="primary" disabled={busy} onClick={()=>void createPass()}>Start {network==='wifi'?'Wi-Fi':'cellular'} pass</button></section>}
      {run&&!run.completed&&<>
        <section><p>Test {step+1} of {safariScenarios.length} · {run.setup.network==='wifi'?'Wi-Fi':'Cellular'}</p><h2>{scenario.title}</h2><p className="say">{scenario.say}</p><p>{scenario.check}</p>
          <p>Wait for “Nancy is listening” before each question. The current conversation does not capture speech while she is thinking or speaking.</p>
          <p>Tap as soon as you hear the answer. This includes your reaction time; it is separate from automatic playback timing.</p>
          <button onClick={()=>{event('no_reply');setIssue('No reply recorded. Wait or use Stop Nancy, then Talk to Nancy. You can move to the next test.');}}>No reply / I can’t hear her</button>
          <button disabled={step===safariScenarios.length-1||busy||!['listening','stopped','error'].includes(voiceState)} onClick={()=>{setStep(step+1);setSample(null);observation.current=null;setRating(defaults);setTranscript('');setReply('');}}>Next test without a rating</button>
        </section>
        <section><h2>What happened?</h2><p><strong>You said:</strong> {transcript||'Your words will appear here for checking.'}</p><p><strong>Nancy:</strong> {reply||'Her reply will appear here.'}</p><p>This text stays on this page and is not included in the test results.</p>
          {sample&&<><dl><dt>Detected speech end → scheduled playback</dt><dd>{seconds(sample.metric.speech_end_to_playback_start_ms)}</dd><dt>Your “I hear her” tap</dt><dd>{seconds(rating.heard_after_detected_end_ms??rating.heard_after_input_ms)}{sample.metric.input_mode==='opening'?' from Talk tap':''}</dd></dl>
            <label>Did Nancy hear you correctly?<select value={rating.transcript} onChange={e=>updateRating({transcript:e.target.value as SafariRating['transcript']})}><option value="not_sure">Not sure / greeting</option><option value="correct">Yes</option><option value="partly_wrong">Partly</option><option value="wrong">No</option></select></label>
            <label>Was the answer right?<select value={rating.answer} onChange={e=>updateRating({answer:e.target.value as SafariRating['answer']})}><option value="not_sure">Not sure</option><option value="correct">Yes</option><option value="partly_wrong">Partly</option><option value="wrong">No</option></select></label>
            <label>How did the wait feel?<select value={rating.responsiveness} onChange={e=>updateRating({responsiveness:e.target.value as SafariRating['responsiveness']})}><option value="comfortable">Comfortable</option><option value="noticeable_wait">Noticeable wait</option><option value="too_slow">Too slow</option><option value="no_audio">No sound</option></select></label>
            <label>Any problem?<select value={rating.problem} onChange={e=>updateRating({problem:e.target.value as SafariRating['problem']})}><option value="none">None</option><option value="cut_me_off">Cut me off</option><option value="missed_words">Missed my words</option><option value="lost_context">Lost the conversation</option><option value="audio_gap">Gap in the audio</option><option value="permission">Microphone permission</option><option value="lock_resume">Lock / return problem</option><option value="other">Something else</option></select></label>
            <button disabled={busy} onClick={()=>void saveRating(false)}>{saved?'Rating saved':'Save rating'}</button><button disabled={busy||step===safariScenarios.length-1} onClick={()=>void saveRating(true)}>Save rating and next test</button></>}
        </section><section><button disabled={busy} onClick={()=>void finish()}>Finish this pass</button><p>You may finish early. Missing tests remain unmeasured.</p></section>
      </>}
      {run&&<section><h2>{run.completed?'Pass saved':'Results so far'}</h2><p>{run.samples.length} playback observations saved. {run.samples.filter(s=>s.rating).length} rated. This does not establish that the phone experience passed.</p><p>Test code: <strong>{run.id.slice(0,8)}</strong></p><button onClick={download}>Download timing results</button><a href="/">Back to your practice Nancy</a></section>}
      </>}
  </main>;
}
