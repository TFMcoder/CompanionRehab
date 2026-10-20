import { useEffect, useState, useRef } from 'react';
import type { Today, MealSlot } from '../shared/contracts';
import type { LocalDayCommand,LocalDayReceipt,LocalDayWorkspace,CarryoverItem,PromptPreferences,RoutineChoices,SignificantHandoff } from '../shared/local-day-contracts';
import { localDateTimeWithOffset } from '../shared/local-time';
import { IntakeTimingControls } from './IntakeTimingControls';

export interface LocalDayClientService {workspace(before?:string):Promise<LocalDayWorkspace>;command(command:LocalDayCommand):Promise<LocalDayReceipt>;receipt(key:string):Promise<LocalDayReceipt>}
export interface RoutinePlanSelection {task_ids:string[];meals:{slot:MealSlot;option_id:string}[]}
export function LocalDayPanel({service,scopeKey,today,onTalk,onChanged,onProposeRoutine}:{service:LocalDayClientService;scopeKey:string;today:Today;onTalk:()=>void;onChanged:()=>void|Promise<void>;onProposeRoutine?:(selection:RoutinePlanSelection)=>Promise<unknown>}) {
 const [view,setView]=useState<LocalDayWorkspace|null>(null),[issue,setIssue]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[before,setBefore]=useState<string>();
 const [prefs,setPrefs]=useState<PromptPreferences|null>(null),[routine,setRoutine]=useState<RoutineChoices>({task_ids:[],meals:[],weekdays:[0,1,2,3,4,5,6]});
 const generation=useRef(0);
 async function reload(){const current=generation.current;try{const next=await service.workspace(before);if(current!==generation.current)return;setView(next);setPrefs(next.preferences);if(next.routine)setRoutine(next.routine.selections);}catch(e){if(current===generation.current)setIssue(e instanceof Error?e.message:'Could not load the day.');}}
 useEffect(()=>{setBefore(undefined);},[scopeKey]);
 useEffect(()=>{generation.current++;setView(null);setIssue('');setNotice('');setBusy(false);void reload();return()=>{generation.current++;};},[scopeKey,before,service]);
 async function save(command:LocalDayCommand){if(busy)return false;const current=generation.current;setBusy(true);setIssue('');try{const result=await service.command(command);if(current!==generation.current)return false;setNotice(result.proposal?'Review and accept the updated plan in My Day.':'Saved.');await reload();await onChanged();return true;}catch(e){if(current===generation.current)setIssue(e instanceof Error?e.message:'Save unconfirmed. Check your saved changes.');return false;}finally{if(current===generation.current)setBusy(false);}}
 async function proposeRoutine(selection:RoutinePlanSelection){if(busy||!onProposeRoutine)return;const current=generation.current;setBusy(true);setIssue('');try{await onProposeRoutine(selection);if(current!==generation.current)return;setNotice('Review and accept this plan in My Day.');await onChanged();await reload();}catch(e){if(current===generation.current)setIssue(e instanceof Error?e.message:'Could not prepare this plan. Refresh and review your choices.');}finally{if(current===generation.current)setBusy(false);}}
 const routinePlan=makeRoutinePlan(today,view);
 const key=()=>({idempotency_key:crypto.randomUUID(),confirmed:true as const});
 return <section aria-label="Day review"><h2>Plan another day</h2><button type="button" onClick={onTalk}>Talk to Nancy</button>
  {issue&&<p role="alert">{issue}</p>}{notice&&<p role="status">{notice}</p>}{!view&&<p>Loading your day…</p>}
  {view&&<><details><summary>Keep in mind for next time</summary><p>Save a short note about something important you want Nancy to remember. It stays relevant until you review or resolve it.</p>
   {(view.handoffs??[]).map(item=><HandoffEditor key={item.id} item={item} zone={view.time_zone} busy={busy} onSave={save}/>)}
   <HandoffEditor key={`new:${scopeKey}`} zone={view.time_zone} busy={busy} onSave={save}/>
   {!!view.handoff_history?.length&&<details><summary>Resolved notes</summary>{view.handoff_history.map(item=><HandoffEditor key={item.id} item={item} zone={view.time_zone} busy={busy} onSave={save}/>)}</details>}
  </details><h3>Unfinished tasks</h3><p>Choose what still matters. Moving a task needs your approval of the updated plan.</p>
   {!view.carryover.length&&<p>No unfinished tasks in this part of your history.</p>}
   {view.carryover.map(item=><CarryoverReview key={item.activity_id} item={item} busy={busy} onSave={(decision,time,urgency,duration,note)=>void save({...key(),type:'decide_carryover',source_date:item.source_date,source_plan_id:item.source_plan_id,source_activity_id:item.activity_id,source_revision:item.revision,target_date:view.local_date,decision,expected_day_revision:view.day_revision,scheduled_time:time,urgency,duration_minutes:duration,note})}/>)}
   {view.carryover_history.length>0&&<details><summary>Past choices</summary><ul>{view.carryover_history.map(item=><li key={`${item.activity_id}:${item.source_plan_id}`}>{item.task_title} from {item.source_date}: {item.decision==='cancel'?'No longer needed':item.decision==='help'?'Asked for help':item.decision==='keep'?'Keep for today':item.decision==='reschedule'?'Chose a new time':'Decide later'}{item.note?` — ${item.note}`:''}{item.proposal_id&&!item.accepted?' (plan still needs approval)':''}</li>)}</ul></details>}
   {view.next_carryover_before&&<button onClick={()=>setBefore(view.next_carryover_before!)}>Earlier days</button>}{before&&<button onClick={()=>setBefore(undefined)}>Recent days</button>}
   <details><summary>Repeat-day choices</summary><p>These are suggestions for your next plan. You decide each day.</p>
    {today.tasks.map(t=><label key={t.id}><input type="checkbox" checked={routine.task_ids.includes(t.id)} onChange={e=>setRoutine({...routine,task_ids:e.target.checked?[...routine.task_ids,t.id]:routine.task_ids.filter(id=>id!==t.id)})}/>{t.title}</label>)}
    {(['breakfast','lunch','dinner'] as const).map(slot=><label key={slot}>{slot}<select value={routine.meals.find(m=>m.slot===slot)?.option_id??''} onChange={e=>setRoutine({...routine,meals:[...routine.meals.filter(m=>m.slot!==slot),...(e.target.value?[{slot,option_id:e.target.value}]:[])]})}><option value="">Choose each day</option>{today.meal_options.filter(m=>m.slots.includes(slot)).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>)}
    <p>Days to suggest these choices</p>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((label,day)=><label key={day}><input type="checkbox" checked={routine.weekdays.includes(day)} onChange={e=>setRoutine({...routine,weekdays:e.target.checked?[...routine.weekdays,day]:routine.weekdays.filter(v=>v!==day)})}/>{label}</label>)}
    <button disabled={busy||!routine.weekdays.length} onClick={()=>void save({...key(),type:'set_routine_choices',expected_revision:view.routine?.revision??0,selections:routine})}>Save repeat choices</button>
    {onProposeRoutine&&<div><p>Use saved choices for today only. Check all three meals and the tasks before you accept the plan.</p>{!today.checkin&&<p>Start today’s check-in in My Day first.</p>}{!routinePlan&&<p>Save choices for today and choose all three meals, or start from an existing plan.</p>}<button disabled={busy||!today.checkin||!routinePlan} onClick={()=>{if(routinePlan)void proposeRoutine(routinePlan);}}>Propose these choices for today</button></div>}
   </details>
   <IntakeTimingControls value={view.intake_timing} busy={busy} onSave={save}/>
   {prefs&&<details><summary>Reminders</summary><p>Optional reminders appear while Nancy is open. Nothing starts the microphone automatically.</p>
    <label><input type="checkbox" checked={prefs.enabled} onChange={e=>setPrefs({...prefs,enabled:e.target.checked})}/>Enable my chosen reminders</label>
    <label><input type="checkbox" checked={prefs.food_check_ins??false} onChange={e=>setPrefs({...prefs,food_check_ins:e.target.checked})}/>Check with me when there is no recent food report</label><p>This asks what you have eaten; a missing report does not mean you missed food.</p>
    {(['breakfast','lunch','dinner'] as const).map(slot=><label key={slot}>{slot}<input type="time" value={prefs.meal_times[slot]??''} onChange={e=>setPrefs({...prefs,meal_times:{...prefs.meal_times,[slot]:e.target.value||null}})}/></label>)}
    <label>Minutes before appointments<input type="number" min="0" max="180" value={prefs.appointment_lead_minutes} onChange={e=>setPrefs({...prefs,appointment_lead_minutes:Number(e.target.value)})}/></label>
    <label>Quiet from<input type="time" value={prefs.quiet_start} onChange={e=>setPrefs({...prefs,quiet_start:e.target.value})}/></label><label>Until<input type="time" value={prefs.quiet_end} onChange={e=>setPrefs({...prefs,quiet_end:e.target.value})}/></label>
    <label><input type="checkbox" checked={prefs.foreground_speech} onChange={e=>setPrefs({...prefs,foreground_speech:e.target.checked})}/>Read reminders aloud when this page is open</label>
    <label><input type="checkbox" checked={prefs.browser_notifications} onChange={e=>setPrefs({...prefs,browser_notifications:e.target.checked})}/>Also use device notifications when supported</label>
    <button disabled={busy} onClick={()=>{const {revision,...preferences}=prefs;void save({...key(),type:'set_prompt_preferences',expected_revision:revision,preferences});}}>Save reminder choices</button>
    {!!view.prompts.length&&<ul>{view.prompts.map(p=><li key={p.id}>{p.message} — {p.state==='missed'?'Not delivered':p.state==='delivered'?'Delivered':p.state==='cancelled'?'Cancelled':'Waiting'}</li>)}</ul>}
   </details>}
  </>}
 </section>;
}
function localInput(instant:string,zone:string){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant)).map(part=>[part.type,part.value]));return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;}
function HandoffEditor({item,zone,busy,onSave}:{item?:SignificantHandoff;zone:string;busy:boolean;onSave:(command:LocalDayCommand)=>Promise<boolean>}){
 const [editing,setEditing]=useState(!item),[summary,setSummary]=useState(item?.summary??''),[when,setWhen]=useState<'now'|'earlier'>(item?'earlier':'now'),[time,setTime]=useState(item?localInput(item.occurred_at,zone):''),[reason,setReason]=useState(''),[issue,setIssue]=useState('');
 const [review,setReview]=useState<{command:LocalDayCommand;text:string}|null>(null);
 useEffect(()=>{setSummary(item?.summary??'');setTime(item?localInput(item.occurred_at,zone):'');setReview(null);setReason('');setEditing(!item);},[item?.id,item?.revision,zone]);
 const key=()=>({idempotency_key:crypto.randomUUID(),confirmed:true as const});
 function reviewEdit(){
  setIssue('');let instant=new Date().toISOString();
  if(when==='earlier'){
   if(item&&time===localInput(item.occurred_at,zone))instant=item.occurred_at;
   else {const parsed=localDateTimeWithOffset(time,zone);if(!parsed.ok){setIssue('Choose a valid, unambiguous local time.');return;}instant=parsed.value;}
  }
  if(!summary.trim()||item&&!reason.trim()){setIssue('Enter the note and, for a correction, its reason.');return;}
  const command:LocalDayCommand=item?{...key(),type:'correct_significant_handoff',handoff_id:item.id,expected_revision:item.revision,summary:summary.trim(),occurred_at:instant,reason:reason.trim()}:{...key(),type:'record_significant_handoff',summary:summary.trim(),occurred_at:instant};
  setReview({command,text:`${item?'Correct':'Keep in mind'}: ${summary.trim()} Happened ${new Date(instant).toLocaleString('en-CA',{timeZone:zone})}.${item?` Correction reason: ${reason.trim()}`:''}`});
 }
 function reviewState(decision:'still_relevant'|'resolved'){
  if(!item)return;
  setReview({command:{...key(),type:'review_significant_handoff',handoff_id:item.id,expected_revision:item.revision,decision,note:''},text:decision==='resolved'?`Resolve this note so Nancy no longer includes it in active context: ${item.summary}`:`Keep this note active for future conversations: ${item.summary}`});
 }
 return <article aria-label={item?'Saved context note':'New context note'}>
  {item&&<><p>{item.summary}</p><p>Reported for {new Date(item.occurred_at).toLocaleString('en-CA',{timeZone:zone})}{item.reviewed_at?' · Reviewed':''}{item.status==='resolved'?' · Resolved':''}</p>
   {!editing&&!review&&<><button type="button" disabled={busy} onClick={()=>setEditing(true)}>Correct note</button><button type="button" disabled={busy} onClick={()=>reviewState('still_relevant')}>{item.status==='resolved'?'Keep in mind again':'Still relevant'}</button>{item.status==='active'&&<button type="button" disabled={busy} onClick={()=>reviewState('resolved')}>Resolve note</button>}</>}
  </>}
  {editing&&!review&&<form onSubmit={e=>{e.preventDefault();reviewEdit();}}>
   <label>Important context to remember<textarea required maxLength={300} value={summary} onChange={e=>setSummary(e.target.value)}/></label>
   <label>When did this happen?<select value={when} onChange={e=>setWhen(e.target.value as typeof when)}><option value="now">Just now</option><option value="earlier">Choose a time</option></select></label>
   {when==='earlier'&&<label>Time in {zone}<input required type="datetime-local" value={time} onChange={e=>setTime(e.target.value)}/></label>}
   {item&&<label>Correction reason<input required maxLength={300} value={reason} onChange={e=>setReason(e.target.value)}/></label>}
   <button disabled={busy}>Review note</button>{item&&<button type="button" disabled={busy} onClick={()=>setEditing(false)}>Cancel</button>}
  </form>}
  {review&&<div role="group" aria-label="Review context change"><p>{review.text}</p><button type="button" disabled={busy} onClick={()=>{void onSave(review.command).then(saved=>{if(saved){setReview(null);if(!item)setSummary('');setEditing(!item);}});}}>Save note</button><button type="button" disabled={busy} onClick={()=>setReview(null)}>Go back</button></div>}
  {issue&&<p role="alert">{issue}</p>}
 </article>;
}
export function makeRoutinePlan(today:Today,view:LocalDayWorkspace|null):RoutinePlanSelection|null{
 if(!view||today.local_date!==view.local_date)return null;
 const suggested=view.routine_suggestions,base=today.checkin?.proposal??today.checkin?.accepted;
 if(!suggested.task_ids.length&&!suggested.meals.length)return null;
 const tasks=[...new Set([...(base?.task_ids??[]),...suggested.task_ids])];if(tasks.length>20)return null;
 const slots:MealSlot[]=['breakfast','lunch','dinner'];
 const meals=slots.map(slot=>suggested.meals.find(m=>m.slot===slot)??base?.meals.find(m=>m.slot===slot));
 if(meals.some(m=>!m))return null;
 return {task_ids:tasks,meals:meals.map(m=>({slot:m!.slot,option_id:m!.option_id}))};
}
function CarryoverReview({item,busy,onSave}:{item:CarryoverItem;busy:boolean;onSave:(decision:'keep'|'reschedule'|'cancel'|'help'|'unresolved',time:string|null,urgency:'high'|'medium'|'low',duration:number|null,note:string)=>void}) {
 const [decision,setDecision]=useState<'keep'|'reschedule'|'cancel'|'help'|'unresolved'>('keep'),[time,setTime]=useState(''),[urgency,setUrgency]=useState<'high'|'medium'|'low'>(item.task.urgency??'medium'),[duration,setDuration]=useState(''),[note,setNote]=useState('');
 return <form onSubmit={e=>{e.preventDefault();onSave(decision,time||null,urgency,duration?Number(duration):null,note);}}><h4>{item.task.title}</h4><p>From {item.source_date}</p>{item.proposal_id&&<p>A move is proposed. Review the current plan before making another change.</p>}
  <label>What next?<select value={decision} onChange={e=>setDecision(e.target.value as typeof decision)}><option value="keep">Keep for today</option><option value="reschedule">Choose a time today</option><option value="cancel">No longer needed</option><option value="help">I need help</option><option value="unresolved">Decide later</option></select></label>
  {['keep','reschedule'].includes(decision)&&<><label>Time<input type="time" value={time} onChange={e=>setTime(e.target.value)}/></label><label>Priority<select value={urgency} onChange={e=>setUrgency(e.target.value as typeof urgency)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><label>Minutes<input type="number" min="1" max="480" value={duration} onChange={e=>setDuration(e.target.value)}/></label></>}
  <label>{decision==='help'?'What help would be useful?':'Note (optional)'}<input maxLength={500} required={decision==='help'} value={note} onChange={e=>setNote(e.target.value)}/></label><button disabled={busy}>Save choice</button>
 </form>;
}
