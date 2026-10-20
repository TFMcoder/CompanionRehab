import {useEffect,useRef,useState} from 'react';
import {preferenceCategoryLabels,preferenceReview,type ClientPreference,type PreferenceCommand,type PreferenceReceipt,type PreferenceWorkspace} from '../shared/preference-contracts';

export interface PreferenceClientService {
  workspace():Promise<PreferenceWorkspace>;
  command(command:PreferenceCommand):Promise<PreferenceReceipt>;
  retry(key:string):Promise<PreferenceReceipt>;
  acknowledge(key:string):Promise<{ok:true}>;
  discard(key:string):Promise<{discarded:boolean}>;
}
const blank=()=>({id:null as string|null,revision:0,category:'meals' as ClientPreference['category'],text:'',duration:'lasting' as ClientPreference['duration']});
/** A small optional details panel, never a prerequisite for talking to Nancy. */
export function Preferences({service,scopeKey,onChange}:{service:PreferenceClientService;scopeKey:string;onChange?:()=>void}){
  const epoch=useRef(0),[view,setView]=useState<PreferenceWorkspace|null>(null),[draft,setDraft]=useState(blank),[review,setReview]=useState<PreferenceCommand|null>(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  useEffect(()=>{const current=++epoch.current;setView(null);setDraft(blank());setReview(null);setBusy(false);setMessage('');setError('');
    void service.workspace().then(value=>{if(epoch.current===current)setView(value);}).catch(e=>{if(epoch.current===current)setError(e instanceof Error?e.message:'Preferences could not load.');});
    return()=>{++epoch.current;};
  },[service,scopeKey]);
  const refresh=async(current:number)=>{const next=await service.workspace();if(epoch.current===current)setView(next);};
  const run=async(action:()=>Promise<PreferenceReceipt|void>,success:string)=>{
    if(busy)return;const current=epoch.current;setBusy(true);setError('');setMessage('');
    try{const receipt=await action();if(epoch.current!==current)return;
      if(receipt){setMessage(receipt.result==='removed'?'Preference removed.':'Preference saved.');setReview(null);setDraft(blank());onChange?.();
        // A lost acknowledgement does not change the known save result. The
        // server keeps it visible on the next workspace read until acknowledged.
        await service.acknowledge(receipt.command_id).catch(()=>undefined);
      }else setMessage(success);
    }catch(e){if(epoch.current===current)setError(e instanceof Error?e.message:'This preference change is unconfirmed. Check saved preferences.');}
    finally{if(epoch.current===current){await refresh(current).catch(()=>undefined);if(epoch.current===current)setBusy(false);}}
  };
  const edit=(item:ClientPreference)=>{setDraft({id:item.id,revision:item.revision,category:item.category,text:item.text,duration:item.duration});setReview(null);setMessage('');};
  const pending=view?.pending;
  let reviewText:string|null=null;
  if(review&&view){try{reviewText=preferenceReview(review,view.items);}catch{/* A concurrent correction requires a fresh review. */}}
  return <details className="workflow-panel preferences"><summary>What Nancy should remember</summary>
    <p>Save an ordinary preference for future days or today only. This does not change approved care instructions.</p>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {!view&&<p>Loading preferences…</p>}
    {view&&<>
      {view.items.length===0&&<p>No preferences have been saved here yet.</p>}
      <ul>{view.items.map(item=><li key={item.id}><span>{item.text} · {item.duration==='lasting'?'Future days':'Today only'} · version {item.revision}</span>{' '}
        <button type="button" disabled={busy||!!pending} onClick={()=>edit(item)}>Change</button>{' '}
        <button type="button" disabled={busy||!!pending} onClick={()=>setReview({type:'remove_preference',preference_id:item.id,expected_revision:item.revision,idempotency_key:crypto.randomUUID(),confirmed:true})}>Remove</button>
      </li>)}</ul>
      {pending?<div aria-label="Preference save recovery">
        <p>{pending.receipt?'Your preference change was saved. Review it above before continuing.':pending.scope_matches?'A reviewed preference save is unconfirmed. Check its saved state before continuing.':'Access changed. Cancel the old unconfirmed request and review it again.'}</p>
        <p>{pending.command.type==='save_preference'?pending.command.text:'Removal of a saved preference'}</p>
        {pending.receipt?<button type="button" disabled={busy} onClick={()=>void run(async()=>{await service.acknowledge(pending.command.idempotency_key);},'Saved preference confirmed.')}>Continue</button>:<>
          {pending.scope_matches&&<button type="button" disabled={busy} onClick={()=>void run(()=>service.retry(pending.command.idempotency_key),'')}>Retry reviewed preference</button>}
          <button type="button" disabled={busy} onClick={()=>void run(async()=>{const result=await service.discard(pending.command.idempotency_key);if(!result.discarded)throw new Error('This preference was saved. Review the saved result before continuing.');setReview(null);},'Unconfirmed request cancelled.')}>Cancel unconfirmed request</button>
        </>}
        <button type="button" disabled={busy} onClick={()=>void run(async()=>{},'Saved preferences refreshed.')}>Check saved preferences</button>
      </div>:review?<div aria-label="Review preference change">
        <p>{reviewText??'This preference changed. Go back and review its current value.'}</p>
        <button type="button" disabled={busy||!reviewText} onClick={()=>void run(()=>service.command(review),'')}>Save reviewed preference</button>
        <button type="button" disabled={busy} onClick={()=>setReview(null)}>Back</button>
      </div>:<form onSubmit={event=>{event.preventDefault();if(!draft.text.trim())return;
        setReview({type:'save_preference',preference_id:draft.id,expected_revision:draft.revision,category:draft.category,text:draft.text.trim(),duration:draft.duration,local_date:draft.duration==='today'?view.local_date:null,idempotency_key:crypto.randomUUID(),confirmed:true});
      }}>
        <label>About<select value={draft.category} onChange={e=>setDraft({...draft,category:e.target.value as ClientPreference['category']})}>{Object.entries(preferenceCategoryLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>My preference<input required maxLength={240} value={draft.text} onChange={e=>setDraft({...draft,text:e.target.value})}/></label>
        <label>Remember for<select value={draft.duration} onChange={e=>setDraft({...draft,duration:e.target.value as ClientPreference['duration']})}><option value="lasting">Future days</option><option value="today">Today only</option></select></label>
        <button type="submit" disabled={busy||!draft.text.trim()}>Review preference</button>
        {draft.id&&<button type="button" disabled={busy} onClick={()=>setDraft(blank())}>Cancel change</button>}
      </form>}
    </>}
  </details>;
}
