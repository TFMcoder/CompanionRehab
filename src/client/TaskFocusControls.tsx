import { useEffect,useRef,useState } from 'react';
import type { Today } from '../shared/contracts';
import type { LocalDayCommand,LocalDayWorkspace } from '../shared/local-day-contracts';
import type { LocalDayClientService } from './LocalDayPanel';

/** Relevant task support, without inferring work or reporting a task result. */
export function TaskFocusControls({service,scopeKey,today,onChanged,onReport}:{service:LocalDayClientService;scopeKey:string;today:Today;onChanged:()=>void|Promise<void>;onReport?:()=>void}){
 const [view,setView]=useState<LocalDayWorkspace|null>(null),[task,setTask]=useState(''),[interval,setInterval]=useState(''),[busy,setBusy]=useState(false),[issue,setIssue]=useState(''),[notice,setNotice]=useState('');
 const [review,setReview]=useState<{command:LocalDayCommand;text:string}|null>(null),epoch=useRef(0),loads=useRef(0);
 async function load(){const current=epoch.current,request=++loads.current;try{const data=await service.workspace();if(current===epoch.current&&request===loads.current){setView(data);if(data.focus)setInterval(String(data.focus.interval_minutes));}}catch{if(current===epoch.current&&request===loads.current)setIssue('Task support could not refresh. Your task list is still available.');}}
 useEffect(()=>{epoch.current++;loads.current++;setView(null);setReview(null);setBusy(false);setIssue('');setNotice('');setTask('');setInterval('');return()=>{epoch.current++;loads.current++;};},[scopeKey,service]);
 useEffect(()=>{void load();},[scopeKey,service,today]);
 const key=()=>({idempotency_key:crypto.randomUUID(),confirmed:true as const}),focus=view?.focus,minutes=Number(interval),validMinutes=Number.isInteger(minutes)&&minutes>=5&&minutes<=240;
 function prepare(action:'start'|'pause'|'resume'|'finish'){
  if(!view)return;let command:LocalDayCommand,text:string;
  if(action==='start'){
   const choice=view.focus_options?.find(item=>item.activity_id===task);if(!choice||!validMinutes)return;
   command={...key(),type:'start_task_focus',activity_id:choice.activity_id,expected_activity_revision:choice.activity_revision,expected_activity_version:choice.source_version,interval_minutes:minutes};
   text=`Start focusing on ${choice.title} and check in after ${minutes} minutes. Your reminder and quiet-hour choices apply.`;
  }else{
   if(!focus)return;
   if(action==='pause'){command={...key(),type:'pause_task_focus',focus_id:focus.id,expected_revision:focus.revision};text=`Pause focusing on ${focus.title} and stop its check-in.`;}
   else if(action==='resume'){if(!validMinutes)return;command={...key(),type:'resume_task_focus',focus_id:focus.id,expected_revision:focus.revision,interval_minutes:minutes};text=`Resume focusing on ${focus.title} and check in after ${minutes} minutes.`;}
   else{command={...key(),type:'finish_task_focus',focus_id:focus.id,expected_revision:focus.revision};text=`Stop focusing on ${focus.title}. This does not report the task complete.`;}
  }
  setReview({command,text});setIssue('');setNotice('');
 }
 async function save(){if(!review||busy)return;const current=epoch.current;setBusy(true);setIssue('');try{await service.command(review.command);if(current!==epoch.current)return;setNotice(review.command.type==='finish_task_focus'?'Focus stopped. You can report the task result separately.':'Saved.');setReview(null);await load();await onChanged();}catch{if(current===epoch.current)setIssue('This change is unconfirmed. Retry Save choice to check the same change.');}finally{if(current===epoch.current)setBusy(false);}}
 if(!view||!focus&&!view.focus_options?.length)return null;
 return <section className="workflow-panel task-focus" aria-label="Task focus"><h3>Work on a task</h3>{issue&&<p role="alert">{issue}</p>}{notice&&<p role="status">{notice}</p>}
  {focus?<><p>{focus.title} — {focus.state==='paused'?'paused':'focus started'}. A start time does not tell Nancy whether you are still working.</p>{focus.state==='active'?<button disabled={busy||!!review} onClick={()=>prepare('pause')}>Pause focus</button>:<><label>Check in after minutes<input aria-label="Focus interval minutes" type="number" min={5} max={240} value={interval} disabled={busy||!!review} onChange={event=>setInterval(event.target.value)}/></label><button disabled={busy||!!review||!validMinutes||!view.preferences.enabled} onClick={()=>prepare('resume')}>Resume focus</button></>}
   <button disabled={busy||!!review} onClick={()=>prepare('finish')}>Stop focusing</button></>:<><label>Task<select aria-label="Focus task" value={task} disabled={busy||!!review} onChange={event=>setTask(event.target.value)}><option value="">Choose a task</option>{view.focus_options?.map(option=><option key={option.activity_id} value={option.activity_id}>{option.title}</option>)}</select></label>
   <label>Check in after minutes<input aria-label="Focus interval minutes" type="number" min={5} max={240} value={interval} disabled={busy||!!review} onChange={event=>setInterval(event.target.value)}/></label><button disabled={busy||!!review||!task||!validMinutes||!view.preferences.enabled} onClick={()=>prepare('start')}>Start focus</button></>}
  {!view.preferences.enabled&&<p>Enable your chosen reminders in Day review before starting a check-in.</p>}
  {review&&<div><p>{review.text}</p><button disabled={busy} onClick={()=>void save()}>Save choice</button><button disabled={busy} onClick={()=>setReview(null)}>Back</button></div>}
  {onReport&&<button onClick={onReport}>Report task result</button>}
 </section>;
}
