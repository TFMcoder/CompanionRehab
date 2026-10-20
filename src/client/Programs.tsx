import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ProgramCapability, ProgramCommand, ProgramDraft, ProgramReceipt, ProgramRun, ProgramStep, ProgramWorkspace } from '../shared/program-contracts';

export interface ProgramClientService {
  workspace(): Promise<ProgramWorkspace>;
  command(command: ProgramCommand): Promise<ProgramReceipt>;
  receipt(key: string): Promise<ProgramReceipt>;
}
const emptyDraft = (kind: ProgramDraft['kind']): ProgramDraft => ({title:'',kind,steps:[],protected_start:null,protected_end:null,rest_minutes:0});
const blankStep = (): ProgramStep => ({id:'',title:'',instruction:'',optional:false,depends_on:[],estimated_minutes:5});
const accessOptions: ProgramCapability[] = ['read_routine','edit_routine','read_rehab','edit_rehab','approve_rehab'];
type StepReportInput = { key:string; skipReason:string; difficulty:string; assistance:string; notes:string };
const blankReport = (key=''):StepReportInput => ({key,skipReason:'',difficulty:'',assistance:'',notes:''});

/** Focused client guide and scoped input; Nancy voice may call the same typed service. */
export function Programs({service,scopeKey,onTalk,onPlan}: {service:ProgramClientService;scopeKey:string;onTalk:()=>void;onPlan?:()=>void}) {
  const scopeEpoch=useRef(0);
  const [view,setView]=useState<ProgramWorkspace|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [pending,setPending]=useState<ProgramCommand|null>(null);
  const [draft,setDraft]=useState<ProgramDraft|null>(null);
  const [revising,setRevising]=useState<{id:string;version:number}|null>(null);
  const [step,setStep]=useState<ProgramStep>(blankStep);
  const [approval,setApproval]=useState('');
  const [stepInput,setStepInput]=useState<StepReportInput>(blankReport);
  const [pauseInput,setPauseInput]=useState({key:'',value:''});
  const [endInput,setEndInput]=useState({key:'',value:''});
  const [reviewedConflicts,setReviewedConflicts]=useState<string|null>(null);
  const [access,setAccess]=useState<Record<string,ProgramCapability[]>>({});
  const [correction,setCorrection]=useState<{run_id:string;step_id:string;revision:number;outcome:'completed'|'skipped';reason:string;difficulty:string;assistance:string;notes:string;correction_reason:string}|null>(null);
  useEffect(()=>{let live=true;++scopeEpoch.current;setView(null);setError('');setReviewedConflicts(null);
    setBusy(false);setPending(null);setDraft(null);setRevising(null);setApproval('');setAccess({});setCorrection(null);
    setStepInput(blankReport());setPauseInput({key:'',value:''});setEndInput({key:'',value:''});
    void service.workspace().then(value=>{if(live)setView(value);}).catch(e=>{if(live)setError(e instanceof Error?e.message:'Programs could not load.');});
    return()=>{live=false;};},[service,scopeKey]);
  const refresh=async(epoch:number)=>{const value=await service.workspace();if(epoch!==scopeEpoch.current)return;setView(value);setReviewedConflicts(null);};
  useEffect(()=>{
    const deadline=view?.runs.filter(r=>r.status==='active'&&!r.obsolete&&r.rest_until).map(r=>Date.parse(r.rest_until!)).filter(Number.isFinite).sort((a,b)=>a-b)[0];
    if(deadline===undefined)return;
    const epoch=scopeEpoch.current;let live=true,timer:ReturnType<typeof setTimeout>;
    const check=async()=>{try{await refresh(epoch);}catch(e){if(live&&epoch===scopeEpoch.current){setError(e instanceof Error?e.message:'Guidance could not refresh.');timer=setTimeout(()=>void check(),5000);}}};
    timer=setTimeout(()=>void check(),Math.min(60000,Math.max(1000,deadline-Date.now()+100)));
    return()=>{live=false;clearTimeout(timer);};
  },[view,service,scopeKey]);
  const clearConfirmed=(command:ProgramCommand)=>{
    if(command.type==='report_program_step'||command.type==='correct_program_step')setStepInput(blankReport());
    if(command.type==='correct_program_step')setCorrection(null);
    if(command.type==='pause_program')setPauseInput({key:'',value:''});
    if(command.type==='end_program')setEndInput({key:'',value:''});
    if(command.type==='approve_program')setApproval('');
    if(command.type==='create_program'||command.type==='revise_program'){setDraft(null);setRevising(null);}
  };
  const run=async(command:ProgramCommand)=>{if(busy||pending)return;const epoch=scopeEpoch.current;setBusy(true);setError('');setPending(command);
    try{await service.command(command);if(epoch!==scopeEpoch.current)return;await refresh(epoch);if(epoch!==scopeEpoch.current)return;setPending(null);clearConfirmed(command);}
    catch(e){if(epoch===scopeEpoch.current)setError(e instanceof Error?e.message:'The change could not be confirmed.');}
    finally{if(epoch===scopeEpoch.current)setBusy(false);}};
  const checkPending=async()=>{if(!pending)return;const epoch=scopeEpoch.current;setBusy(true);setError('');
    try{await service.receipt(pending.idempotency_key);if(epoch!==scopeEpoch.current)return;await refresh(epoch);if(epoch!==scopeEpoch.current)return;setPending(null);clearConfirmed(pending);}
    catch(e){if(epoch===scopeEpoch.current)setError(e instanceof Error?e.message:'This save is still unconfirmed.');}
    finally{if(epoch===scopeEpoch.current)setBusy(false);}};
  const key=()=>crypto.randomUUID();
  const conflicts=view?.conflicts.map(item=>item.id)??[];
  const active=view?.runs.find(item=>item.status==='active'||item.status==='paused');
  const reportKey=`${scopeKey}:${active?.id??''}:${active?.current_step?.id??''}`;
  const reportInput=stepInput.key===reportKey?stepInput:blankReport(reportKey);
  const updateReport=(change:Partial<Omit<StepReportInput,'key'>>)=>setStepInput(old=>({...old.key===reportKey?old:blankReport(reportKey),...change}));
  const runKey=`${scopeKey}:${active?.id??''}`;
  const pauseReason=pauseInput.key===runKey?pauseInput.value:'';
  const endReason=endInput.key===runKey?endInput.value:'';
  const canActOnConflict=!conflicts.length||reviewedConflicts===active?.version_id;
  const currentVersion=view?.versions.find(item=>item.id===active?.version_id);
  const currentName=active?.title??currentVersion?.title??(active?'Your saved program':'');
  const updateDraft=(change:Partial<ProgramDraft>)=>setDraft(old=>old?{...old,...change}:old);
  const saveDraft=(event:FormEvent)=>{event.preventDefault();if(!draft||!draft.steps.length)return;
    const common={idempotency_key:key(),confirmed:true as const};
    void run(revising?{...common,type:'revise_program',definition_id:revising.id,expected_version:revising.version,draft}
      :{...common,type:'create_program',draft});};
  const report=(item:ProgramRun,outcome:'completed'|'skipped')=>{
    if(!item.current_step)return;
    void run({type:'report_program_step',idempotency_key:key(),run_id:item.id,expected_revision:item.revision,step_id:item.current_step.id,
      outcome,reason:outcome==='skipped'?reportInput.skipReason.trim():'',difficulty:currentVersion?.kind==='rehab'?reportInput.difficulty.trim():'',
      assistance:currentVersion?.kind==='rehab'?reportInput.assistance.trim():'',notes:currentVersion?.kind==='rehab'?reportInput.notes.trim():'',
      acknowledged_conflicts:conflicts,confirmed:true});
  };
  const conflictTime=(instant:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:view!.time_zone,hour:'numeric',minute:'2-digit'}).format(new Date(instant));
  return <section className="programs" aria-label="Morning and rehab programs">
    <button className="primary-button" type="button" onClick={onTalk}>Talk to Nancy</button>
    <h2>Morning and rehab guidance</h2>
    <button type="button" disabled={busy||!!pending} onClick={()=>void refresh(scopeEpoch.current).catch(e=>setError(e instanceof Error?e.message:'Guidance could not refresh.'))}>Refresh guidance</button>
    {!view&&<p>Loading your approved guidance…</p>}
    {view?.role==='client'&&<p>Each step is recorded only when you report it. Starting a program does not mark a task done.</p>}
    {error&&<p role="alert">{error}</p>}
    {pending&&<button type="button" disabled={busy} onClick={()=>void checkPending()}>Check saved receipt</button>}
    {view?.role==='client'&&<>
      {active&&<section aria-label="Current program step">
        <h3>{currentName}</h3><p>{active.status==='paused'?'Paused':'In progress'} · {active.results.length} step results saved</p>
        {active.status==='paused'&&active.pause_reason&&<p>Paused because: {active.pause_reason}</p>}
        {active.obsolete?<p role="status">A newer approved version is available. End this run and review the new instructions before continuing.</p>
          :active.blocked_reason?<p role="status">{active.blocked_reason}</p>
          :active.current_step&&<><h4>{active.current_step.title}</h4><p>{active.current_step.instruction}</p>
            <p>Allow about {active.current_step.estimated_minutes} minutes{currentVersion?.rest_minutes?` and ${currentVersion.rest_minutes} minutes rest`:''}.</p></>}
        {conflicts.length>0&&<div className="request-panel"><h4>Appointment during protected time</h4>
          <p>Times are in {view.time_zone}.</p><ul>{view.conflicts.map(item=><li key={item.id}>{item.title} · {conflictTime(item.starts_at)}</li>)}</ul>
          <button type="button" onClick={()=>setReviewedConflicts(active.version_id)}>I reviewed this schedule</button></div>}
        {active.status==='active'&&!active.obsolete&&!active.blocked_reason&&active.current_step&&<>
          {currentVersion?.kind==='rehab'&&<div className="request-form"><label>Difficulty, if any<textarea value={reportInput.difficulty} onChange={e=>updateReport({difficulty:e.target.value})} maxLength={500}/></label>
            <label>Assistance, if any<textarea value={reportInput.assistance} onChange={e=>updateReport({assistance:e.target.value})} maxLength={500}/></label>
            <label>Private session note<textarea value={reportInput.notes} onChange={e=>updateReport({notes:e.target.value})} maxLength={1000}/></label></div>}
          <button type="button" disabled={busy||!!pending||!canActOnConflict} onClick={()=>report(active,'completed')}>I completed this step</button>
          {active.current_step.optional&&<><label>Why skip this optional step?<input value={reportInput.skipReason} onChange={e=>updateReport({skipReason:e.target.value})} maxLength={500}/></label>
            <button type="button" disabled={busy||!!pending||!reportInput.skipReason.trim()||!canActOnConflict} onClick={()=>report(active,'skipped')}>Skip with reason</button></>}
        </>}
        {active.status==='active'&&<><label>Why pause?<input value={pauseReason} onChange={e=>setPauseInput({key:runKey,value:e.target.value})} maxLength={500}/></label>
          <button type="button" disabled={busy||!!pending||!pauseReason.trim()} onClick={()=>void run({type:'pause_program',idempotency_key:key(),run_id:active.id,expected_revision:active.revision,reason:pauseReason.trim(),confirmed:true})}>Pause for rest or interruption</button></>}
        {active.status==='paused'&&!active.obsolete&&<button type="button" disabled={busy||!!pending||!canActOnConflict} onClick={()=>void run({type:'resume_program',idempotency_key:key(),run_id:active.id,expected_revision:active.revision,acknowledged_conflicts:conflicts,confirmed:true})}>Resume saved step</button>}
        <label>Reason for ending this run<input value={endReason} onChange={e=>setEndInput({key:runKey,value:e.target.value})} maxLength={500}/></label>
        <button type="button" disabled={busy||!!pending||!endReason.trim()} onClick={()=>void run({type:'end_program',idempotency_key:key(),run_id:active.id,expected_revision:active.revision,reason:endReason.trim(),confirmed:true})}>End this run</button>
      </section>}
      {!active&&view.versions.filter(v=>v.current).map(version=><section key={version.id}>
        <h3>{version.title}</h3><p>{version.kind==='rehab'?'Approved rehab protocol':'Approved morning routine'} · version {version.version}</p>
        {(view.conflicts_by_version[version.id]??[]).length>0&&<div className="request-panel"><p>An appointment falls in this program's protected time. Review it before starting.</p>
          <p>Times are in {view.time_zone}.</p><ul>{view.conflicts_by_version[version.id].map(item=><li key={item.id}>{item.title} · {conflictTime(item.starts_at)}</li>)}</ul>
          <button type="button" onClick={()=>setReviewedConflicts(version.id)}>I reviewed this schedule</button></div>}
        <button type="button" disabled={busy||((view.conflicts_by_version[version.id]??[]).length>0&&reviewedConflicts!==version.id)}
          onClick={()=>void run({type:'start_program',idempotency_key:key(),version_id:version.id,local_date:view.local_date,
            acknowledged_conflicts:(view.conflicts_by_version[version.id]??[]).map(item=>item.id),confirmed:true})}>Start {version.title}</button>
      </section>)}
      <section><h3>Plan the rest of your day</h3><p>{view.planning.task_count} tasks, {view.planning.meal_count} meal choices and {view.planning.appointment_count} appointments are available to review.</p>
        <p>{view.capacity?`You reported ${view.capacity.available_minutes} available minutes and ${view.capacity.rest_minutes} minutes of rest.`:'Your available capacity has not been reported today.'} A day plan still needs your acceptance.</p>
        {onPlan&&<button type="button" onClick={onPlan}>Review a proposed day</button>}</section>
    </>}
    {view&&<section aria-label="Saved program results"><h3>Saved program results</h3>
      {view.runs.every(r=>!r.results.length)&&<p>No step results have been reported.</p>}
      {view.runs.filter(r=>r.results.length).map(r=><section key={r.id}><h4>{r.title} · {r.local_date}</h4>
        {r.results.map(result=><div key={result.step_id}><p>{view.versions.find(v=>v.id===r.version_id)?.steps.find(s=>s.id===result.step_id)?.title??result.step_id}: {result.outcome} · {conflictTime(result.reported_at)}{result.revision>1?' · corrected':''}</p>
          {result.reason&&<p>Reason: {result.reason}</p>}{result.difficulty&&<p>Difficulty: {result.difficulty}</p>}{result.assistance&&<p>Assistance: {result.assistance}</p>}{result.notes&&<p>Session note: {result.notes}</p>}
          {view.role==='client'&&<button type="button" disabled={busy||!!pending} onClick={()=>setCorrection({run_id:r.id,step_id:result.step_id,revision:result.revision,outcome:result.outcome,reason:result.reason,difficulty:result.difficulty,assistance:result.assistance,notes:result.notes,correction_reason:''})}>Correct this step result</button>}
        </div>)}
      </section>)}
      {correction&&<form aria-label="Correct a program result" onSubmit={e=>{e.preventDefault();void run({type:'correct_program_step',idempotency_key:key(),run_id:correction.run_id,step_id:correction.step_id,expected_revision:correction.revision,outcome:correction.outcome,reason:correction.outcome==='skipped'?correction.reason.trim():'',difficulty:correction.difficulty.trim(),assistance:correction.assistance.trim(),notes:correction.notes.trim(),correction_reason:correction.correction_reason.trim(),confirmed:true});}}>
        <label>Corrected outcome<select value={correction.outcome} onChange={e=>setCorrection({...correction,outcome:e.target.value as 'completed'|'skipped'})}><option value="completed">Completed</option><option value="skipped" disabled={!view.versions.find(v=>v.id===view.runs.find(r=>r.id===correction.run_id)?.version_id)?.steps.find(s=>s.id===correction.step_id)?.optional}>Skipped</option></select></label>
        {correction.outcome==='skipped'&&<label>Reason for skipping<input value={correction.reason} maxLength={500} onChange={e=>setCorrection({...correction,reason:e.target.value})}/></label>}
        {view.versions.find(v=>v.id===view.runs.find(r=>r.id===correction.run_id)?.version_id)?.kind==='rehab'&&<>
          <label>Corrected difficulty<textarea value={correction.difficulty} maxLength={500} onChange={e=>setCorrection({...correction,difficulty:e.target.value})}/></label>
          <label>Corrected assistance<textarea value={correction.assistance} maxLength={500} onChange={e=>setCorrection({...correction,assistance:e.target.value})}/></label>
          <label>Corrected session note<textarea value={correction.notes} maxLength={1000} onChange={e=>setCorrection({...correction,notes:e.target.value})}/></label></>}
        <label>Why correct this result?<input required value={correction.correction_reason} maxLength={500} onChange={e=>setCorrection({...correction,correction_reason:e.target.value})}/></label>
        <button type="submit" disabled={busy||!!pending||!correction.correction_reason.trim()||correction.outcome==='skipped'&&!correction.reason.trim()}>Save reviewed correction</button>
        <button type="button" disabled={busy||!!pending} onClick={()=>setCorrection(null)}>Cancel correction</button>
      </form>}
    </section>}
    {view&&<section><h3>Approved and draft versions</h3>
      {view.versions.length===0&&<p>No approved program has been entered for this client.</p>}
      {view.versions.map(version=><div key={version.id}><strong>{version.title}</strong> · {version.kind} v{version.version} · {version.approved?'approved':'draft'}
        {version.approved&&<span> · approval reference {version.approval_ref}</span>}
        {(view.role==='client'&&version.kind==='routine'||view.capabilities.includes(version.kind==='rehab'?'edit_rehab':'edit_routine'))&&
          <button type="button" disabled={busy} onClick={()=>{setDraft({title:version.title,kind:version.kind,steps:version.steps,protected_start:version.protected_start,protected_end:version.protected_end,rest_minutes:version.rest_minutes});setRevising({id:version.definition_id,version:version.version});}}>Draft a revision</button>}
        {!version.approved&&(version.kind==='routine'&&(view.role==='client'||view.role==='administrator'&&view.capabilities.includes('edit_routine'))||
          version.kind==='rehab'&&['administrator','clinician'].includes(view.role)&&view.capabilities.includes('approve_rehab'))&&
          <div><label>Human approval reference<input value={approval} onChange={e=>setApproval(e.target.value)} maxLength={500}/></label>
            <button type="button" disabled={busy||!approval.trim()} onClick={()=>void run({type:'approve_program',idempotency_key:key(),version_id:version.id,approval_ref:approval.trim(),confirmed:true})}>Approve this exact version</button></div>}
      </div>)}
    </section>}
    {view&&(view.role==='client'||view.capabilities.includes('edit_routine')||view.capabilities.includes('edit_rehab'))&&<section>
      <h3>Enter approved instructions</h3><p>Enter only instructions supplied by the routine or protocol owner. Rehab guidance requires separate human approval before use.</p>
      {!draft&&<div><button type="button" onClick={()=>{setDraft(emptyDraft('routine'));setRevising(null);}}>Draft routine</button>
        {(view.capabilities.includes('edit_rehab'))&&<button type="button" onClick={()=>{setDraft(emptyDraft('rehab'));setRevising(null);}}>Draft rehab protocol</button>}</div>}
      {draft&&<form onSubmit={saveDraft} className="request-form"><label>Program title<input required value={draft.title} maxLength={160} onChange={e=>updateDraft({title:e.target.value})}/></label>
        <label>Protected start<input type="time" value={draft.protected_start??''} onChange={e=>updateDraft({protected_start:e.target.value||null})}/></label>
        <label>Protected end<input type="time" value={draft.protected_end??''} onChange={e=>updateDraft({protected_end:e.target.value||null})}/></label>
        <label>Rest minutes<input type="number" min="0" max="240" value={draft.rest_minutes} onChange={e=>updateDraft({rest_minutes:Number(e.target.value)})}/></label>
        <ol>{draft.steps.map(item=><li key={item.id}>{item.title} · {item.instruction} {item.optional?'(optional)':''}</li>)}</ol>
        <fieldset><legend>Add a step</legend><label>Step ID<input value={step.id} onChange={e=>setStep({...step,id:e.target.value})}/></label>
          <label>Step title<input value={step.title} onChange={e=>setStep({...step,title:e.target.value})}/></label>
          <label>Exact instruction<textarea value={step.instruction} onChange={e=>setStep({...step,instruction:e.target.value})}/></label>
          <label>Estimated minutes<input type="number" min="1" max="180" value={step.estimated_minutes} onChange={e=>setStep({...step,estimated_minutes:Number(e.target.value)})}/></label>
          <label><input type="checkbox" checked={step.optional} onChange={e=>setStep({...step,optional:e.target.checked})}/> Optional</label>
          <label>Depends on earlier step<select value={step.depends_on[0]??''} onChange={e=>setStep({...step,depends_on:e.target.value?[e.target.value]:[]})}><option value="">None</option>{draft.steps.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <button type="button" disabled={!step.id||!step.title||!step.instruction||draft.steps.some(item=>item.id===step.id)} onClick={()=>{updateDraft({steps:[...draft.steps,step]});setStep(blankStep());}}>Add step</button></fieldset>
        <button type="submit" disabled={busy||!draft.steps.length}>Save version as draft</button><button type="button" onClick={()=>{setDraft(null);setRevising(null);}}>Cancel</button>
      </form>}
    </section>}
    {view?.role==='client'&&view.sharing.length>0&&<details><summary>Program sharing</summary>{view.sharing.map(person=>{
      const selected=access[person.actor_id]??person.capabilities;
      return <div key={person.actor_id}><h4>{person.label}</h4><p>{person.role}</p>
        {accessOptions.filter(option=>person.role!=='family_friend'||option==='read_routine').filter(option=>person.role!=='clinician'||option!=='edit_routine').map(option=><label key={option}><input type="checkbox" checked={selected.includes(option)} onChange={e=>setAccess(old=>({...old,[person.actor_id]:e.target.checked?[...selected,option]:selected.filter(value=>value!==option)}))}/>{option.replaceAll('_',' ')}</label>)}
        <button type="button" disabled={busy} onClick={()=>void run({type:'set_program_access',idempotency_key:key(),actor_id:person.actor_id,role:person.role,expected_revision:person.revision,capabilities:selected,confirmed:true})}>Save access</button></div>})}</details>}
  </section>;
}
