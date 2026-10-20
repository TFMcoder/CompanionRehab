import {useEffect,useRef,useState} from 'react';
import {localDateTimeWithOffset} from '../shared/local-time';
import type {MicrosoftAction,MicrosoftActionReview,MicrosoftActionReceipt} from '../shared/microsoft-contracts';

export interface MicrosoftActionClient {
 prepare(input:{idempotency_key:string;action:MicrosoftAction}):Promise<MicrosoftActionReview>;
 confirm(input:{action_id:string;review_token:string}):Promise<MicrosoftActionReceipt>;
 actions():Promise<MicrosoftActionReceipt[]>;
 receipt(id:string):Promise<MicrosoftActionReceipt>;
 review(id:string):Promise<MicrosoftActionReview>;
}
export function MicrosoftActions({service,localDate,timeZone}:{service:MicrosoftActionClient;localDate:string;timeZone:string}){
 const [kind,setKind]=useState<MicrosoftAction['kind']>('send_mail'),[to,setTo]=useState(''),[subject,setSubject]=useState(''),[body,setBody]=useState('');
 const [start,setStart]=useState(localDate+'T18:00'),[end,setEnd]=useState(localDate+'T18:15');
 const [review,setReview]=useState<MicrosoftActionReview|null>(null),[receipts,setReceipts]=useState<MicrosoftActionReceipt[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const generation=useRef(0),pending=useRef<{json:string;key:string}|null>(null);
 useEffect(()=>{const run=++generation.current;void service.actions().then(rows=>{if(run===generation.current)setReceipts(rows);}).catch(()=>{if(run===generation.current)setNotice('Recent Outlook results are unavailable.');});return()=>{generation.current++;};},[service]);
 async function act(work:(current:()=>boolean)=>Promise<void>){if(busy)return;const run=generation.current;setBusy(true);setNotice('');try{await work(()=>run===generation.current);}catch(error){if(run===generation.current)setNotice(error instanceof Error?error.message:'Outlook could not finish. Check the action results before sending again.');}finally{if(run===generation.current)setBusy(false);}}
 function input():MicrosoftAction{
  const addresses=to.split(/[,;]+/).map(v=>v.trim()).filter(Boolean);
  if(kind==='send_mail')return {kind,to:addresses,subject,body};
  const from=localDateTimeWithOffset(start,timeZone),until=localDateTimeWithOffset(end,timeZone);
  if(!from.ok||!until.ok)throw new Error('Choose an unambiguous start and end time in '+timeZone+'.');
  return {kind,subject,start:from.value,end:until.value,attendees:addresses};
 }
 const prepare=()=>act(async current=>{const action=input(),json=JSON.stringify(action);if(pending.current?.json!==json)pending.current={json,key:crypto.randomUUID()};const result=await service.prepare({idempotency_key:pending.current.key,action});if(current())setReview(result);});
 const confirm=()=>act(async current=>{
  if(!review)return;const prepared=review;setReview(null);
  try{const receipt=await service.confirm({action_id:prepared.action_id,review_token:prepared.review_token});if(current()){setReceipts(rows=>[receipt,...rows.filter(r=>r.action_id!==receipt.action_id)]);setNotice(receipt.message);pending.current=null;}}
  catch{if(current()){setNotice('The Outlook result is unconfirmed. Check recent results before preparing another action.');setReceipts(await service.actions());}}
 });
 const date=(value:string,zone:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,dateStyle:'full',timeStyle:'short'}).format(new Date(value));
 return <section aria-label="Outlook actions"><h3>Email and invitations</h3><p>Review every detail before sending from your connected Outlook account.</p>
  {notice&&<p role="status">{notice}</p>}
  {!review?<form onSubmit={event=>{event.preventDefault();void prepare();}}><fieldset disabled={busy}>
   <legend>Prepare an Outlook action</legend>
   <label>Action<select value={kind} onChange={e=>setKind(e.target.value as MicrosoftAction['kind'])}><option value="send_mail">Send email</option><option value="create_event">Create calendar invitation</option></select></label>
   <label>{kind==='send_mail'?'To':'Invite'}<input required value={to} onChange={e=>setTo(e.target.value)} placeholder="Email addresses separated by commas" maxLength={3300}/></label>
   <label>{kind==='send_mail'?'Subject':'Event title'}<input required value={subject} onChange={e=>setSubject(e.target.value)} maxLength={200}/></label>
   {kind==='send_mail'?<label>Message<textarea required value={body} onChange={e=>setBody(e.target.value)} maxLength={5000}/></label>:<><p>Times are in {timeZone}.</p><label>Starts<input required type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label><label>Ends<input required type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}/></label></>}
   <button type="submit">Review {kind==='send_mail'?'email':'invitation'}</button>
  </fieldset></form>:<article className="review-card" aria-label="Review Outlook action"><h4>Review before sending</h4><p>From: {review.account}</p>
   {review.action.kind==='send_mail'?<><p>To: {review.action.to.join(', ')}</p><p>Subject: {review.action.subject}</p><p style={{whiteSpace:'pre-wrap'}}>{review.action.body}</p></>:<><p>Calendar: {review.calendar_name}</p><p>Event: {review.action.subject}</p><p>{date(review.action.start,review.time_zone)} – {date(review.action.end,review.time_zone)} ({review.time_zone})</p><p>Invite: {review.action.attendees.join(', ')}</p></>}
   <button disabled={busy} onClick={()=>void confirm()}>{review.action.kind==='send_mail'?'Send this email':'Create this event and send invitation'}</button><button disabled={busy} onClick={()=>setReview(null)}>Back to details</button>
  </article>}
  <h3>Recent Outlook results</h3><button disabled={busy} onClick={()=>void act(async current=>{const rows=await service.actions();if(current())setReceipts(rows);})}>Refresh recent results</button>
  {receipts.map(row=><article key={row.action_id}><p>{row.kind==='send_mail'?'Email':'Calendar invitation'} · {row.state}</p><p>{row.message}</p>
   {row.state==='prepared'?<button disabled={busy} onClick={()=>void act(async current=>{const value=await service.review(row.action_id);if(current())setReview(value);})}>Review prepared details</button>:<button disabled={busy} onClick={()=>void act(async current=>{const value=await service.receipt(row.action_id);if(current())setReceipts(rows=>rows.map(r=>r.action_id===value.action_id?value:r));})}>Check result</button>}
  </article>)}
 </section>;
}
