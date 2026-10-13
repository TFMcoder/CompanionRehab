import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SupportCommand, SupportReceipt, SupportShare, SupportWorkspace, SupportWorkspaceQuery } from '../shared/support-contracts';

export interface SupportTeamClientService {
  workspace(query?:SupportWorkspaceQuery):Promise<SupportWorkspace>;
  command(command:SupportCommand):Promise<SupportReceipt>;
  receipt(key:string):Promise<SupportReceipt|null>;
}
export interface SupportTeamProps {service:SupportTeamClientService;scopeKey:string;onTalk():void;onChanged?():void;refreshVersion?:number}
const errorMessage=(error:unknown)=>error instanceof Error?error.message:'Could not reach Support Team. Check again.';
const emptyPrefs=(zone:string,revision=0)=>({revision,task_completion:false,meal_completion:false,task_reschedule:false,meal_reschedule:false,
  quiet_start:null as string|null,quiet_end:null as string|null,time_zone:zone});
function when(value:string|null) {return value?new Date(value).toLocaleString():'Time not set';}
export function SupportTeam({service,scopeKey,onTalk,onChanged,refreshVersion=0}:SupportTeamProps) {
  const [view,setView]=useState<SupportWorkspace|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [issue,setIssue]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState<SupportCommand|null>(null);
  const [prefs,setPrefs]=useState(emptyPrefs(Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Toronto'));
  const [edits,setEdits]=useState<Record<string,{tasks:boolean;meals:boolean;progress:boolean}>>({});
  const epoch=useRef(0);
  async function load(token=epoch.current) {
    setLoading(true);
    try {const current=await service.workspace();if(epoch.current!==token)return;
      setView(current);setIssue('');setPrefs(current.preferences??emptyPrefs(Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Toronto'));
      setEdits(Object.fromEntries(current.shares.map(s=>[`${s.actor_id}:${s.role}`,{tasks:s.share_tasks,meals:s.share_meals,progress:s.share_progress}])));
    }catch(error){if(epoch.current===token){setView(null);setIssue(errorMessage(error));}}
    finally{if(epoch.current===token)setLoading(false);}
  }
  useEffect(()=>{const token=++epoch.current;setView(null);setPending(null);void load(token);return()=>{epoch.current++;};},[service,scopeKey,refreshVersion]);
  async function save(command:SupportCommand,message:string) {
    setBusy(true);setIssue('');setNotice('');setPending(command);
    try{await service.command(command);setPending(null);setNotice(message);onChanged?.();await load();}
    catch(error){setIssue(errorMessage(error));}
    finally{setBusy(false);}
  }
  async function checkPending() {
    if(!pending)return;setBusy(true);
    try{const found=await service.receipt(pending.idempotency_key);setPending(null);
      setNotice(found?'The change was saved.':'No saved change was found. Review the current view before trying again.');
      if(found)onChanged?.();await load();}
    catch(error){setIssue(errorMessage(error));}finally{setBusy(false);}
  }
  async function more(kind:'items'|'notifications') {
    if(!view)return;const cursor=kind==='items'?view.next_items_cursor:view.next_notifications_cursor;if(!cursor)return;
    setBusy(true);try{const page=await service.workspace(kind==='items'?{date:view.local_date,items_cursor:cursor}:{date:view.local_date,notifications_cursor:cursor});
      setView(current=>current?{...current,
        items:kind==='items'?[...current.items,...page.items]:current.items,next_items_cursor:kind==='items'?page.next_items_cursor:current.next_items_cursor,
        notifications:kind==='notifications'?[...current.notifications,...page.notifications]:current.notifications,
        next_notifications_cursor:kind==='notifications'?page.next_notifications_cursor:current.next_notifications_cursor}:page);setIssue('');}
    catch(error){setIssue(errorMessage(error));}finally{setBusy(false);}
  }
  function saveShare(share:SupportShare) {
    const selected=edits[`${share.actor_id}:${share.role}`];if(!selected)return;
    void save({type:'set_support_share',idempotency_key:crypto.randomUUID(),actor_id:share.actor_id,role:share.role,
      expected_revision:share.revision,share_tasks:selected.tasks,share_meals:selected.meals,share_progress:selected.progress},'Sharing updated.');
  }
  function savePrefs(event:FormEvent) {
    event.preventDefault();void save({type:'set_support_notifications',idempotency_key:crypto.randomUUID(),expected_revision:prefs.revision,
      task_completion:prefs.task_completion,meal_completion:prefs.meal_completion,task_reschedule:prefs.task_reschedule,
      meal_reschedule:prefs.meal_reschedule,quiet_start:prefs.quiet_start||null,quiet_end:prefs.quiet_end||null,time_zone:prefs.time_zone},'Alert choices saved.');
  }
  const locked=busy||!!pending;
  return <section aria-label="Support Team"><button type="button" onClick={onTalk}>Talk to Nancy</button><h2>Support Team</h2>
    {loading&&<p role="status">Loading shared information…</p>}{issue&&<p role="alert">{issue}</p>}{notice&&<p role="status">{notice}</p>}
    {pending&&<p role="status">The save result is uncertain. <button type="button" disabled={busy} onClick={()=>void checkPending()}>Check saved result</button></p>}
    {view?.role==='client'&&<section><h3>Choose what to share</h3><p>Only linked accounts appear here. You can change or remove access at any time.</p>
      {view.shares.length===0&&<p>No linked Support Team accounts yet.</p>}
      {view.shares.map(s=>{const id=`${s.actor_id}:${s.role}`,selection=edits[id]??{tasks:false,meals:false,progress:false};return <div key={id}>
        <h4>{s.label} · {s.role.replace('_',' ')}</h4>
        <label><input type="checkbox" checked={selection.tasks} onChange={e=>setEdits({...edits,[id]:{...selection,tasks:e.target.checked}})} />Tasks</label>
        <label><input type="checkbox" checked={selection.meals} onChange={e=>setEdits({...edits,[id]:{...selection,meals:e.target.checked}})} />Meals</label>
        <label><input type="checkbox" checked={selection.progress} onChange={e=>setEdits({...edits,[id]:{...selection,progress:e.target.checked}})} />Progress when available</label>
        <button type="button" disabled={locked} onClick={()=>saveShare(s)}>Save sharing</button>
        <button type="button" disabled={locked} onClick={()=>void save({type:'set_support_share',idempotency_key:crypto.randomUUID(),actor_id:s.actor_id,role:s.role,
          expected_revision:s.revision,share_tasks:false,share_meals:false,share_progress:false},'Sharing removed.')}>Remove sharing</button>
      </div>;})}</section>}
    {view&&<><h3>{view.role==='client'?'Today’s tasks and meals':'Shared tasks and meals'}</h3>
      {!view.can_view_tasks&&!view.can_view_meals&&<p>No tasks or meals are shared with this account.</p>}
      {view.items.length===0&&(view.can_view_tasks||view.can_view_meals)&&<p>No shared items for this day.</p>}
      {view.items.map(i=><article key={i.id}><strong>{i.title}</strong><p>{i.kind==='meal'?`${i.meal_slot??'Meal'} · `:''}{i.status==='completed'?'Completed':i.status==='deferred'?'Deferred':i.status==='planned'?'Planned':'Pending'} · {when(i.scheduled_at)}</p>
        {i.kind==='task'&&i.urgency&&<p>{i.urgency} priority</p>}</article>)}
      {view.next_items_cursor&&<button type="button" disabled={busy} onClick={()=>void more('items')}>More items</button>}
      <h3>Progress</h3><p>Progress sharing is not available yet.</p>
      {view.role!=='client'&&<><h3>In-app alerts</h3>{view.notifications_quiet&&<p>Quiet hours are on. Alerts will appear afterward.</p>}
        {!view.notifications_quiet&&view.notifications.length===0&&<p>No alerts to show.</p>}
        {view.notifications.map(n=><div key={n.id}><strong>{n.title}</strong><span> · {n.type==='completed'?'Completed':'Rescheduled'} · {when(n.created_at)}{n.read_at?' · Read':''}</span>
          {!n.read_at&&<button type="button" disabled={locked} onClick={()=>void save({type:'mark_support_notification_read',idempotency_key:crypto.randomUUID(),notification_id:n.id},'Alert marked read.')}>Mark read</button>}</div>)}
        {view.next_notifications_cursor&&<button type="button" disabled={busy} onClick={()=>void more('notifications')}>More alerts</button>}
        <h4>Alert choices</h4><p>These choices apply only to your account. Alerts stay in this app.</p>
        <form onSubmit={savePrefs}>
          <label><input type="checkbox" checked={prefs.task_completion} onChange={e=>setPrefs({...prefs,task_completion:e.target.checked})} />Task completed</label>
          <label><input type="checkbox" checked={prefs.meal_completion} onChange={e=>setPrefs({...prefs,meal_completion:e.target.checked})} />Meal completed</label>
          <label><input type="checkbox" checked={prefs.task_reschedule} onChange={e=>setPrefs({...prefs,task_reschedule:e.target.checked})} />Task rescheduled</label>
          <label><input type="checkbox" checked={prefs.meal_reschedule} onChange={e=>setPrefs({...prefs,meal_reschedule:e.target.checked})} />Meal rescheduled</label>
          <label>Quiet from <input type="time" value={prefs.quiet_start??''} onChange={e=>setPrefs({...prefs,quiet_start:e.target.value||null})} /></label>
          <label>Until <input type="time" value={prefs.quiet_end??''} onChange={e=>setPrefs({...prefs,quiet_end:e.target.value||null})} /></label>
          <label>Time zone <input value={prefs.time_zone} onChange={e=>setPrefs({...prefs,time_zone:e.target.value})} /></label>
          <button type="submit" disabled={locked}>Save alert choices</button>
        </form></>}
    </>}
  </section>;
}
