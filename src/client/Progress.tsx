import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { progressArchetypes, progressFields, progressKinds, type ProgressCommand, type ProgressField,
  type ProgressKind, type ProgressReceipt, type ProgressWorkspace } from '../shared/progress-contracts';

export interface ProgressProps { scopeKey: string; localDate: string; visible: boolean;
  commandAction?: (input: ProgressCommand) => Promise<ProgressReceipt> }
type Save = { kind: 'idle' | 'saving' | 'saved' | 'error' | 'unconfirmed'; message: string; key?: string };
const newKey = () => crypto.randomUUID();
const earlier = (day: string, count: number) => {
  const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-count);return date.toISOString().slice(0,10);
};
async function request<T>(url:string, options:RequestInit={}, signal?:AbortSignal):Promise<T>{
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options,
    signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30_000)]):AbortSignal.timeout(30_000)});
  if(response.status===401)window.dispatchEvent(new Event('nancy:session-expired'));
  if(!response.ok){
    const body=await response.json().catch(()=>null) as {error?:{message?:string}}|null;
    throw new Error(body?.error?.message??'Progress is unavailable. Try refreshing the view.');
  }
  return response.json() as Promise<T>;
}
const label=(field:string)=>field.replaceAll('_',' ');

/** Compact, typed UI for client progress and explicitly scoped clinical views. */
export function Progress({scopeKey,localDate,visible,commandAction}:ProgressProps){
  const [from,setFrom]=useState(earlier(localDate,6)),[to,setTo]=useState(localDate);
  const [archetype,setArchetype]=useState<typeof progressArchetypes[number]['id']|''>('');
  const [data,setData]=useState<ProgressWorkspace|null>(null);
  const [loading,setLoading]=useState(false),[issue,setIssue]=useState<string|null>(null);
  const [save,setSave]=useState<Save>({kind:'idle',message:''});
  const [approvalRef,setApprovalRef]=useState(''),[deferral,setDeferral]=useState<''|'exempt'|'count_as_not_done'>('');
  const [weights,setWeights]=useState<Partial<Record<ProgressKind,string>>>({});
  const [awards,setAwards]=useState<Array<{key:string;label:string;min_percent:string}>>([]);
  const [exportFields,setExportFields]=useState<ProgressField[]>(['local_date','status']);
  const [exportFormat,setExportFormat]=useState<'json'|'csv'>('csv');
  const [accessActor,setAccessActor]=useState(''),[accessFields,setAccessFields]=useState<ProgressField[]>(['local_date','status']);
  const [accessRead,setAccessRead]=useState(false),[accessExport,setAccessExport]=useState(false),[accessApprove,setAccessApprove]=useState(false);
  const [accessDays,setAccessDays]=useState('31');
  const [configTitle,setConfigTitle]=useState(''),[configFields,setConfigFields]=useState<ProgressField[]>(['local_date','status']);
  const [configRef,setConfigRef]=useState('');
  const generation=useRef(0);
  const currentGrant=data?.access_grants.find(grant=>`${grant.role}:${grant.actor_id}`===accessActor);
  useEffect(()=>{if(!visible)return;const id=++generation.current,controller=new AbortController();
    setLoading(true);setIssue(null);
    const params=new URLSearchParams({from,to});if(archetype)params.set('archetype',archetype);
    void request<ProgressWorkspace>(`/api/progress?${params}`,{},controller.signal).then(result=>{
      if(id===generation.current){setData(result);setLoading(false);}
    }).catch(error=>{if(id===generation.current){setIssue(error instanceof Error?error.message:'Progress is unavailable.');setLoading(false);}});
    return()=>{generation.current++;controller.abort();};
  },[scopeKey,localDate,visible,from,to,archetype]);
  useLayoutEffect(()=>{setFrom(earlier(localDate,6));setTo(localDate);setData(null);setSave({kind:'idle',message:''});},[scopeKey,localDate]);
  useEffect(()=>{const rules=data?.active_rules?.rules;if(!rules)return;
    setWeights(Object.fromEntries(rules.weights.map(item=>[item.kind,String(item.weight)])));
    setDeferral(rules.deferral_treatment);
    setAwards(rules.achievements.map(item=>({key:item.key,label:item.label,min_percent:String(item.min_percent)})));
  },[data?.active_rules?.version]);
  useEffect(()=>{const config=data?.clinical_config;if(!config)return;
    setConfigTitle(config.title);setConfigFields(config.fields);
  },[data?.clinical_config?.version,data?.clinical_config?.archetype]);
  useEffect(()=>{if(!currentGrant)return;
    setAccessRead(currentGrant.can_read);setAccessExport(currentGrant.can_export);setAccessApprove(currentGrant.can_approve_rules);
    setAccessFields(currentGrant.allowed_fields.length?currentGrant.allowed_fields:['local_date','status']);setAccessDays(String(currentGrant.max_days));
  },[accessActor,currentGrant?.revision]);

  const refresh=async()=>{
    const id=++generation.current;setLoading(true);setIssue(null);
    const params=new URLSearchParams({from,to});if(archetype)params.set('archetype',archetype);
    try{const result=await request<ProgressWorkspace>(`/api/progress?${params}`);if(id===generation.current)setData(result);}
    catch(error){if(id===generation.current)setIssue(error instanceof Error?error.message:'Progress is unavailable.');}
    finally{if(id===generation.current)setLoading(false);}
  };
  const command=async(input:ProgressCommand,download?:{format:'json'|'csv'})=>{
    setSave({kind:'saving',message:'Saving…'});
    try{
      const receipt=commandAction?await commandAction(input):await request<ProgressReceipt>('/api/progress/commands',
        {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
      if(download&&receipt.export_content){
        const file=new Blob([receipt.export_content],{type:download.format==='csv'?'text/csv;charset=utf-8':'application/json'});
        const url=URL.createObjectURL(file),anchor=document.createElement('a');anchor.href=url;anchor.download=`nancy-progress-${from}-to-${to}.${download.format}`;
        anchor.click();setTimeout(()=>URL.revokeObjectURL(url),0);
      }
      setSave({kind:'saved',message:download?'Export prepared and audited.':'Saved. Progress is ready for review.'});
      await refresh();
    }catch(error){
      const message=error instanceof Error?error.message:'Progress action is unconfirmed. Check its receipt before retrying.';
      setSave({kind:'unconfirmed',message:`${message} If the connection was interrupted, check the receipt before trying again.`,key:input.idempotency_key});
    }
  };
  const checkReceipt=async()=>{
    if(!save.key)return;
    try{const receipt=await request<ProgressReceipt>(`/api/progress/receipts/${encodeURIComponent(save.key)}`);
      setSave({kind:'saved',message:`Saved ${receipt.type.replaceAll('_',' ')}. Refreshing progress.`});await refresh();}
    catch{setSave(current=>({...current,message:'Still unconfirmed. Refresh progress and check before retrying.'}));}
  };
  const toggle=(items:ProgressField[],value:ProgressField,set:(next:ProgressField[])=>void)=>set(items.includes(value)?items.filter(item=>item!==value):[...items,value]);
  const approveRules=()=>{
    const selected=progressKinds.flatMap(kind=>{
      const value=weights[kind]?.trim();return value?[{kind,weight:Number(value)}]:[];
    });
    if(!selected.length||!deferral||!approvalRef.trim()){setSave({kind:'error',message:'Choose eligible activities, deferral treatment and an approval note.'});return;}
    const achievements=awards.map(item=>({key:item.key.trim(),label:item.label.trim(),min_percent:Number(item.min_percent)}));
    void command({type:'approve_scoring_rules',idempotency_key:newKey(),expected_rule_version:data?.active_rules?.version??0,
      rules:{weights:selected,deferral_treatment:deferral,achievements},approval_ref:approvalRef.trim()});
  };
  const saveAccess=()=>{
    if(!currentGrant)return;
    void command({type:'set_progress_access',idempotency_key:newKey(),actor_id:currentGrant.actor_id,role:currentGrant.role,
      expected_revision:currentGrant.revision,can_read:accessRead,can_export:accessExport,can_approve_rules:accessApprove,
      allowed_fields:accessRead?accessFields:[],max_days:Number(accessDays)});
  };
  const saveConfig=()=>{
    if(!archetype||!configTitle.trim()||!configRef.trim())return;
    void command({type:'approve_clinical_config',idempotency_key:newKey(),archetype,expected_version:data?.clinical_config?.version??0,
      title:configTitle.trim(),fields:configFields,approval_ref:configRef.trim()});
  };
  if(!visible)return null;
  return <section className="request-panel" aria-label="Progress">
    <h2>Progress</h2><p>These numbers describe reported activity under approved household rules. They are not a clinical outcome.</p>
    <div className="inline-fields"><label>From <input type="date" value={from} max={to} onChange={event=>setFrom(event.target.value)}/></label>
      <label>To <input type="date" value={to} min={from} onChange={event=>setTo(event.target.value)}/></label>
      <label>View <select value={archetype} onChange={event=>setArchetype(event.target.value as typeof archetype)}><option value="">Daily progress</option>
        {progressArchetypes.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <button type="button" className="secondary-button" onClick={()=>void refresh()} disabled={loading}>Refresh</button></div>
    {loading&&<p role="status">Loading progress…</p>}{issue&&<p role="alert">{issue}</p>}
    {data&&<p>{data.trend.days_with_accepted_plan} of {data.trend.days_in_range} days have an accepted plan.
      {data.trend.average_reported_percent!==null?` Average of days with reported eligible outcomes: ${data.trend.average_reported_percent}%.`:''}
      {data.trend.days_with_missing_reports!==null?` ${data.trend.days_with_missing_reports} days have missing reports.`:''}
      {data.trend.corrected_days?` ${data.trend.corrected_days} days include corrections.`:''}</p>}
    {data?.clinical_config&&<p>Approved {data.clinical_config.title}, version {data.clinical_config.version}. This view only shows fields shared with this account.</p>}
    {data?.days.map(day=><article key={day.local_date} className="day-card"><h3>{day.local_date}</h3>
      {day.status==='no_plan'?<p>No accepted plan for this day.</p>:day.status==='unconfigured'?<p>Progress rules have not been approved for this day.</p>:
        <><p>{day.score_percent===null?'No reported eligible result yet.':`${day.score_percent}% of reported eligible activity`}
          {day.missing_count!==null&&` · ${day.missing_count} without a report`}
          {day.deferred_count!==null&&` · ${day.deferred_count} deferred`}
          {day.exempt_count!==null&&` · ${day.exempt_count} exempt`}</p>
          <p>Plan version {day.plan_version??'not shared'} · rule version {day.rule_version??'not shared'}
            {day.protocol_versions.length?` · ${day.protocol_versions.length} approved program version${day.protocol_versions.length===1?'':'s'}`:''}
            {day.corrected_count?` · ${day.corrected_count} corrected`:''}{day.stale?' · Needs recalculation':''}</p>
          {day.achievements.filter(item=>item.active).map(item=><p key={item.key}>★ {item.label}</p>)}
          {day.sources.length>0&&<details><summary>How this was calculated</summary><ul>{day.sources.map(source=><li key={source.source_id}>
            {source.title}: {source.state}. {source.explanation}{source.corrected?' Corrected report.':''}</li>)}</ul></details>}
          {data.role==='client'&&<button type="button" className="secondary-button" disabled={save.kind==='saving'}
            onClick={()=>void command({type:'recalculate_score',idempotency_key:newKey(),local_date:day.local_date})}>Recalculate this day</button>}
        </>}
    </article>)}
    {data?.can_approve_rules&&<details><summary>Approve progress rules</summary><p>Choose only activities and wording reviewed by the scoring owner. No points are active until approval.</p>
      <div className="inline-fields">{progressKinds.map(kind=><label key={kind}>{label(kind)} weight <input type="number" min="1" max="100" value={weights[kind]??''}
        placeholder="Not eligible" onChange={event=>setWeights(current=>({...current,[kind]:event.target.value}))}/></label>)}</div>
      <label>Deferred activities <select value={deferral} onChange={event=>setDeferral(event.target.value as typeof deferral)}>
        <option value="">Choose treatment</option><option value="exempt">Exempt from score</option><option value="count_as_not_done">Count as reported not done</option></select></label>
      <p>Optional achievements require every eligible result to be reported before an award is earned.</p>
      {awards.map((award,index)=><div className="inline-fields" key={index}><label>Key <input value={award.key}
        onChange={event=>setAwards(current=>current.map((item,i)=>i===index?{...item,key:event.target.value}:item))} placeholder="day_reviewed"/></label>
        <label>Encouragement <input value={award.label} onChange={event=>setAwards(current=>current.map((item,i)=>i===index?{...item,label:event.target.value}:item))}/></label>
        <label>Minimum reported percent <input type="number" min="1" max="100" value={award.min_percent}
          onChange={event=>setAwards(current=>current.map((item,i)=>i===index?{...item,min_percent:event.target.value}:item))}/></label>
        <button type="button" className="text-button" onClick={()=>setAwards(current=>current.filter((_,i)=>i!==index))}>Remove achievement</button></div>)}
      <button type="button" className="secondary-button" onClick={()=>setAwards(current=>current.length>=8?current:[...current,{key:'',label:'',min_percent:''}])}>Add achievement</button>
      <label>Approval reference <input value={approvalRef} onChange={event=>setApprovalRef(event.target.value)} maxLength={200}/></label>
      <button type="button" className="secondary-button" onClick={approveRules} disabled={save.kind==='saving'}>Approve rule version {1+(data.active_rules?.version??0)}</button>
    </details>}
    {data?.role==='client'&&data.access_grants.length>0&&<details><summary>Share a scoped progress view</summary>
      <label>Person <select value={accessActor} onChange={event=>setAccessActor(event.target.value)}><option value="">Choose a current grant</option>
        {data.access_grants.map(grant=><option key={`${grant.role}:${grant.actor_id}`} value={`${grant.role}:${grant.actor_id}`}>
          {grant.role} · {grant.actor_id.slice(0,8)}</option>)}</select></label>
      {currentGrant&&<><label><input type="checkbox" checked={accessRead} onChange={event=>setAccessRead(event.target.checked)}/> Read progress</label>
        <label><input type="checkbox" checked={accessExport} onChange={event=>setAccessExport(event.target.checked)}/> Export permitted fields</label>
        <label><input type="checkbox" checked={accessApprove} onChange={event=>setAccessApprove(event.target.checked)}/> Approve rules/configurations</label>
        <label>Maximum days <input type="number" min="1" max="90" value={accessDays} onChange={event=>setAccessDays(event.target.value)}/></label>
        <fieldset><legend>Permitted fields</legend>{progressFields.map(field=><label key={field}><input type="checkbox" checked={accessFields.includes(field)}
          onChange={()=>toggle(accessFields,field,setAccessFields)}/>{label(field)}</label>)}</fieldset>
        <button type="button" className="secondary-button" disabled={save.kind==='saving'} onClick={saveAccess}>Save sharing</button></>}
    </details>}
    {data?.can_approve_rules&&archetype&&<details><summary>Approve {progressArchetypes.find(item=>item.id===archetype)?.label} view definition</summary>
      <p>This selects visible measures. It adds no clinical threshold or access.</p><label>Title <input value={configTitle} onChange={event=>setConfigTitle(event.target.value)}/></label>
      <fieldset><legend>Measures</legend>{progressFields.map(field=><label key={field}><input type="checkbox" checked={configFields.includes(field)}
        onChange={()=>toggle(configFields,field,setConfigFields)}/>{label(field)}</label>)}</fieldset>
      <label>Clinical review reference <input value={configRef} onChange={event=>setConfigRef(event.target.value)}/></label>
      <button type="button" className="secondary-button" disabled={save.kind==='saving'} onClick={saveConfig}>Approve view version {1+(data.clinical_config?.version??0)}</button>
    </details>}
    {data?.can_export&&<details><summary>Export permitted progress</summary><p>The selected range, fields and version context are recorded in an audit receipt.</p>
      <fieldset><legend>Fields</legend>{data.allowed_fields.map(field=><label key={field}><input type="checkbox" checked={exportFields.includes(field)}
        onChange={()=>toggle(exportFields,field,setExportFields)}/>{label(field)}</label>)}</fieldset>
      <label>Format <select value={exportFormat} onChange={event=>setExportFormat(event.target.value as 'json'|'csv')}><option value="csv">CSV</option><option value="json">JSON</option></select></label>
      <button type="button" className="secondary-button" disabled={save.kind==='saving'||!exportFields.length}
        onClick={()=>void command({type:'request_data_export',idempotency_key:newKey(),from,to,format:exportFormat,fields:exportFields,archetype:archetype||undefined},{format:exportFormat})}>Export this range</button>
    </details>}
    {save.kind!=='idle'&&<p role={save.kind==='error'?'alert':'status'}>{save.message}{save.kind==='unconfirmed'&&save.key&&
      <button type="button" className="secondary-button" onClick={()=>void checkReceipt()}>Check receipt</button>}</p>}
  </section>;
}
