import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { OperationsCommand, OperationsQuery, OperationsReceipt, OperationsWorkspace } from '../shared/operations-contracts';

export interface OperationsClientService {
  workspace(query?:OperationsQuery):Promise<OperationsWorkspace>;
  command(command:OperationsCommand):Promise<OperationsReceipt>;
  receipt(key:string):Promise<OperationsReceipt|null>;
}
export interface OperationsProps {service:OperationsClientService;scopeKey:string;onTalk():void;onChanged?():void;refreshVersion?:number;
  onOpenConfig?:(destination:'programs'|'meals'|'scoring')=>void}
const errorText=(error:unknown)=>error instanceof Error?error.message:'Could not load operations. Check again.';
const displayTime=(value:string|null)=>value?new Date(value).toLocaleString():'No saved change yet';
export function Operations({service,scopeKey,onTalk,onChanged,refreshVersion=0,onOpenConfig}:OperationsProps) {
  const [view,setView]=useState<OperationsWorkspace|null>(null),[date,setDate]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [issue,setIssue]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState<OperationsCommand|null>(null);
  const [grants,setGrants]=useState<Record<string,{view:boolean;manage:boolean;audit:boolean}>>({});
  const [notes,setNotes]=useState<Record<string,string>>({});const epoch=useRef(0);
  async function load(token=epoch.current,selectedDate=date||undefined) {
    setLoading(true);
    try{const next=await service.workspace(selectedDate?{date:selectedDate}:{});if(epoch.current!==token)return;
      setView(next);setDate(next.local_date);setIssue('');setGrants(Object.fromEntries(next.operators.map(o=>[o.actor_id,{view:o.can_view,manage:o.can_manage_local_issues,audit:o.can_view_audit}])));}
    catch(error){if(epoch.current===token){setView(null);setIssue(errorText(error));}}
    finally{if(epoch.current===token)setLoading(false);}
  }
  useEffect(()=>{const token=++epoch.current;setView(null);setDate('');setPending(null);void load(token,undefined);return()=>{epoch.current++;};},[service,scopeKey,refreshVersion]);
  async function save(command:OperationsCommand,message:string) {
    setBusy(true);setPending(command);setIssue('');setNotice('');
    try{await service.command(command);setPending(null);setNotice(message);onChanged?.();await load();}
    catch(error){setIssue(errorText(error));}
    finally{setBusy(false);}
  }
  async function checkPending() {
    if(!pending)return;setBusy(true);
    try{const found=await service.receipt(pending.idempotency_key);setPending(null);
      setNotice(found?'The change was saved.':'No saved change was found. Review the current view before trying again.');
      if(found)onChanged?.();await load();}
    catch(error){setIssue(errorText(error));}finally{setBusy(false);}
  }
  async function more() {
    if(!view?.next_cursor)return;setBusy(true);
    try{const next=await service.workspace({date:view.local_date,cursor:view.next_cursor});
      setView(current=>current?{...current,held_intents:[...current.held_intents,...next.held_intents],next_cursor:next.next_cursor}:next);setIssue('');}
    catch(error){setIssue(errorText(error));}finally{setBusy(false);}
  }
  function saveGrant(actor:string,revision:number) {
    const choice=grants[actor];if(!choice)return;
    void save({type:'set_operations_access',idempotency_key:crypto.randomUUID(),actor_id:actor,expected_revision:revision,
      can_view:choice.view,can_manage_local_issues:choice.manage,can_view_audit:choice.audit},'Operator access updated.');
  }
  function review(event:FormEvent,intentId:string,revision:number,status:'open'|'resolved') {
    event.preventDefault();const note=notes[intentId]??'';
    void save(status==='resolved'?{type:'resolve_held_intent_review',idempotency_key:crypto.randomUUID(),intent_id:intentId,expected_revision:revision,note}
      :{type:'note_held_intent',idempotency_key:crypto.randomUUID(),intent_id:intentId,expected_revision:revision,note},
      status==='resolved'?'Local review closed. The external intent remains held.':'Review note saved.');
  }
  const locked=busy||!!pending;
  return <section aria-label="Administrator operations"><button type="button" onClick={onTalk}>Talk to Nancy</button><h2>Operations</h2>
    {loading&&<p role="status">Loading local records…</p>}{issue&&<p role="alert">{issue}</p>}{notice&&<p role="status">{notice}</p>}
    {pending&&<p role="status">The save result is uncertain. <button type="button" disabled={busy} onClick={()=>void checkPending()}>Check saved result</button></p>}
    {view?.role==='client'&&<section><h3>Choose program operators</h3><p>Only administrator accounts already linked to your care scope appear here. Issue review and audit access are separate choices.</p>
      {view.operators.length===0&&<p>No linked administrator accounts.</p>}
      {view.operators.map(o=>{const selected=grants[o.actor_id]??{view:false,manage:false,audit:false};return <div key={o.actor_id}><h4>{o.label}</h4>
        <label><input type="checkbox" checked={selected.view} onChange={e=>setGrants({...grants,[o.actor_id]:{...selected,view:e.target.checked,
          manage:e.target.checked&&selected.manage,audit:e.target.checked&&selected.audit}})} />View operations</label>
        <label><input type="checkbox" disabled={!selected.view} checked={selected.manage} onChange={e=>setGrants({...grants,[o.actor_id]:{...selected,manage:e.target.checked}})} />Review local issues</label>
        <label><input type="checkbox" disabled={!selected.view} checked={selected.audit} onChange={e=>setGrants({...grants,[o.actor_id]:{...selected,audit:e.target.checked}})} />View audit timeline</label>
        <button type="button" disabled={locked} onClick={()=>saveGrant(o.actor_id,o.revision)}>Save operator access</button>
        <button type="button" disabled={locked} onClick={()=>void save({type:'set_operations_access',idempotency_key:crypto.randomUUID(),actor_id:o.actor_id,
          expected_revision:o.revision,can_view:false,can_manage_local_issues:false,can_view_audit:false},'Operator access removed.')}>Remove access</button></div>;})}</section>}
    {view?.role==='administrator'&&<><label>Day <input type="date" value={date} onChange={e=>setDate(e.target.value)} /></label>
      <button type="button" disabled={busy} onClick={()=>void load(epoch.current,date)}>Show day</button>
      <h3>Today’s local program</h3>{view.day&&<><p>Accepted plan: {view.day.accepted_plan_version??'None'} · Planned tasks: {view.day.planned_tasks} · Planned meals: {view.day.planned_meals}</p>
        <p>Completed tasks: {view.day.completed_tasks} · Meals reported: {view.day.completed_meals} · Deferred tasks: {view.day.deferred_tasks} · Deferred meals: {view.day.deferred_meals}</p>
        <p>Local appointments: {view.day.appointments_scheduled} · Source updated: {displayTime(view.day.source_as_of)}</p></>}
      <h3>Connector status</h3>{view.connector&&<><p>Not connected. No external send or retry is available.</p>
        <p>Held intents: {view.connector.held_intents} · Prepared targets: {view.connector.targets} · Resource links: {view.connector.linked_resources}</p>
        <p>Last sync: none recorded · Failed syncs: unknown</p></>}
      <h3>Held local issues</h3><p>Notes and review state stay local. Closing a review does not send or cancel the held intent.</p>
      {view.held_intents.length===0&&<p>No held intents to review.</p>}
      {view.held_intents.map(i=><article key={i.id}><h4>{i.system} · {i.operation} · {i.provider}</h4>
        <p>Held since {displayTime(i.created_at)} · Review: {i.review_status}</p>{i.review_note&&<p>Local note: {i.review_note}</p>}
        {view.can_manage_local_issues&&<form onSubmit={e=>review(e,i.id,i.review_revision,'open')}>
          <input aria-label={`Review note for ${i.id}`} required maxLength={500} value={notes[i.id]??''} onChange={e=>setNotes({...notes,[i.id]:e.target.value})} placeholder="Local review note" />
          <button type="submit" disabled={locked}>Save note</button>
          {i.review_revision>0&&<button type="button" disabled={locked||!(notes[i.id]??'').trim()} onClick={e=>review(e as unknown as FormEvent,i.id,i.review_revision,'resolved')}>Close local review</button>}
        </form>}</article>)}
      {view.next_cursor&&<button type="button" disabled={busy} onClick={()=>void more()}>More held intents</button>}
      {onOpenConfig&&<section><h3>Configuration</h3><p>Each section checks its own permissions before allowing a change.</p>
        <button type="button" onClick={()=>onOpenConfig('programs')}>Programs</button><button type="button" onClick={()=>onOpenConfig('meals')}>Meals</button>
        <button type="button" onClick={()=>onOpenConfig('scoring')}>Scoring</button></section>}
      <h3>Audit timeline</h3>{!view.audit_available?<p>Audit access is not granted to this account.</p>:<>{view.audit.length===0&&<p>No care events to show.</p>}
        {view.audit.map(item=><p key={item.id}>{item.event_type} · {displayTime(item.created_at)}</p>)}</>}
    </>}
  </section>;
}
