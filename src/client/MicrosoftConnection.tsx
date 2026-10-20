import {useEffect,useRef,useState} from 'react';
import {ApiError} from './api';
import {localDateTimeWithOffset} from '../shared/local-time';
import type {MicrosoftContext,MicrosoftResources,MicrosoftSelection,MicrosoftStatus} from '../shared/microsoft-contracts';
import {MicrosoftActions,type MicrosoftActionClient} from './MicrosoftActions';

export interface MicrosoftClientService {
 status():Promise<MicrosoftStatus>;
 connect():Promise<{authorization_url:string}>;
 finish():Promise<MicrosoftStatus>;
 resources():Promise<MicrosoftResources>;
 select(input:MicrosoftSelection):Promise<MicrosoftStatus>;
 context(range:{start:string;end:string}):Promise<MicrosoftContext>;
 disconnect():Promise<MicrosoftStatus>;
 actionClient?:MicrosoftActionClient;
}
const message=(error:unknown)=>error instanceof ApiError?error.message:'Outlook could not finish that step. Check the connection and try again.';
export function microsoftDayRange(date:string,zone:string) {
 const next=new Date(date+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);
 const start=localDateTimeWithOffset(date+'T00:00',zone),end=localDateTimeWithOffset(next.toISOString().slice(0,10)+'T00:00',zone);
 if(!start.ok||!end.ok)throw new Error('The selected day cannot be read in this time zone.');
 return {start:start.value,end:end.value};
}
function displayTime(value:string|null,zone:string) {
 if(!value||!Number.isFinite(Date.parse(value)))return 'Time not available';
 return new Intl.DateTimeFormat('en-CA',{timeZone:zone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));
}
function clearCallbackMarker() {
 const url=new URL(window.location.href);url.searchParams.delete('microsoft');window.history.replaceState(null,'',url.pathname+url.search+url.hash);
}
export function MicrosoftConnection({service,scopeKey,localDate,timeZone,navigate=(url)=>window.location.assign(url)}:{
 service:MicrosoftClientService;scopeKey:string;localDate:string;timeZone:string;navigate?:(url:string)=>void;
}) {
 const [status,setStatus]=useState<MicrosoftStatus|null>(null),[resources,setResources]=useState<MicrosoftResources|null>(null);
 const [context,setContext]=useState<MicrosoftContext|null>(null),[calendars,setCalendars]=useState<string[]>([]),[folders,setFolders]=useState<string[]>([]);
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState<string|null>(null),[confirmDisconnect,setConfirmDisconnect]=useState(false);
 const generation=useRef(0),finishing=useRef<{scope:string;service:MicrosoftClientService;promise:Promise<MicrosoftStatus>}|null>(null);
 const apply=(value:MicrosoftStatus)=>{setStatus(value);setCalendars(value.selected_calendar_ids);setFolders(value.selected_mail_folder_ids);};
 useEffect(()=>{
  const run=++generation.current;setStatus(null);setResources(null);setContext(null);setNotice(null);setBusy(true);setConfirmDisconnect(false);
  const marker=new URL(window.location.href).searchParams.get('microsoft');
  if(marker==='finish'&&(!finishing.current||finishing.current.scope!==scopeKey||finishing.current.service!==service))finishing.current={scope:scopeKey,service,promise:service.finish()};
  const pending=marker==='finish'?finishing.current!.promise:service.status();
  void pending.then(value=>{if(generation.current===run){apply(value);if(marker==='finish'){setNotice('Outlook connected. Choose what to show.');clearCallbackMarker();}else if(marker==='failed'){setNotice('Microsoft sign-in was not completed. You can try again.');clearCallbackMarker();}}})
   .catch(async error=>{if(generation.current===run){setNotice(message(error));if(marker==='finish'){clearCallbackMarker();try{const value=await service.status();if(generation.current===run)apply(value);}catch{}}}})
   .finally(()=>{if(generation.current===run)setBusy(false);});
  return()=>{generation.current++;};
 },[service,scopeKey]);
 useEffect(()=>{setContext(null);},[localDate,timeZone]);
 async function act(work:(current:()=>boolean)=>Promise<void>) {
  if(busy)return;const run=generation.current;setBusy(true);setNotice(null);
  try{await work(()=>run===generation.current);}catch(error){if(run===generation.current){setContext(null);setResources(null);setNotice(message(error));if(error instanceof ApiError&&[403,409].includes(error.status)){try{const value=await service.status();if(run===generation.current)apply(value);}catch{}}}}
  finally{if(run===generation.current)setBusy(false);}
 }
 const connect=()=>act(async current=>{
  const result=await service.connect();if(!current())return;
  const url=new URL(result.authorization_url);
  if(url.protocol!=='https:'||url.hostname!=='login.microsoftonline.com'||url.username||url.password||url.port||!/^\/[0-9a-f-]{36}\/oauth2\/v2\.0\/authorize$/i.test(url.pathname))throw new Error('Invalid sign-in destination.');
  navigate(url.toString());
 });
 const choose=()=>act(async current=>{setContext(null);const result=await service.resources();if(current())setResources(result);});
 const save=()=>act(async current=>{
  if(!status)return;setContext(null);
  const result=await service.select({expected_revision:status.revision,calendar_ids:calendars,mail_folder_ids:folders});
  if(current()){apply(result);setResources(null);setNotice('Outlook choices saved.');}
 });
 const read=()=>act(async current=>{
  setContext(null);const result=await service.context(microsoftDayRange(localDate,timeZone));
  if(current())setContext(result);
 });
 const disconnect=()=>act(async current=>{
  setContext(null);setResources(null);const result=await service.disconnect();
  if(current()){apply(result);setConfirmDisconnect(false);setNotice('Outlook disconnected from Nancy.');}
 });
 const toggle=(id:string,values:string[],set:(values:string[])=>void)=>set(values.includes(id)?values.filter(v=>v!==id):[...values,id]);
 const partial=!!context&&[...context.calendars,...context.mail_folders].some(source=>!source.result.complete);
 return <section className="request-panel outlook-panel" aria-label="Outlook connection" aria-busy={busy}>
  <h2>Outlook</h2><p>Choose which calendars and mail folders to view with your day.</p>
  {notice&&<p role="status">{notice}</p>}
  {!status&&<><p>{busy?'Checking your Outlook connection…':'Connection details are unavailable.'}</p>{!busy&&<button onClick={()=>void act(async current=>{const value=await service.status();if(current())apply(value);})}>Reload connection details</button>}</>}
  {status&&(!status.available?<p>Outlook setup is not ready yet. Your local day is still available.</p>:!status.eligible?<p>Outlook is not enabled for this Nancy account.</p>:<>
   <p><strong>{status.state==='connected'?'Connected':status.state==='reconnect_required'?'Sign in again to reconnect Outlook':'Not connected'}</strong></p>
   <p>{status.model_disclosure_enabled?'Nancy can use your selected calendars and Inbox in conversations to help plan your day.':'Items shown here stay out of Nancy’s conversation in this initial connection step.'}</p>
   {status.state!=='connected'?<button className="primary-button" disabled={busy} onClick={()=>void connect()}>Connect Outlook</button>:<>
    <div className="header-actions"><button disabled={busy} onClick={()=>void choose()}>Choose calendars and folders</button>
     <button disabled={busy||(!status.selected_calendar_ids.length&&!status.selected_mail_folder_ids.length)} onClick={()=>void read()}>Show today’s Outlook items</button>
     <button disabled={busy} onClick={()=>setConfirmDisconnect(true)}>Disconnect Outlook</button></div>
    {!status.selected_calendar_ids.length&&!status.selected_mail_folder_ids.length&&<p>Choose a calendar or folder before reading Outlook items.</p>}
   </>}
   {status.state==='reconnect_required'&&<button disabled={busy} onClick={()=>setConfirmDisconnect(true)}>Disconnect Outlook</button>}
   {confirmDisconnect&&<div className="review-card"><p>Disconnect Outlook from Nancy? Your local day and your Outlook records will stay as they are.</p><button disabled={busy} onClick={()=>void disconnect()}>Confirm disconnect</button><button disabled={busy} onClick={()=>setConfirmDisconnect(false)}>Keep connection</button></div>}
   {resources&&<form onSubmit={event=>{event.preventDefault();void save();}}>
    <fieldset disabled={busy}><legend>Calendars</legend>{resources.calendars.items.map(calendar=><label key={calendar.id} className="outlook-choice"><input type="checkbox" checked={calendars.includes(calendar.id)} disabled={!calendars.includes(calendar.id)&&calendars.length>=5} onChange={()=>toggle(calendar.id,calendars,setCalendars)}/>{calendar.name}</label>)}{!resources.calendars.items.length&&<p>No calendars are available.</p>}</fieldset>
    <fieldset disabled={busy}><legend>Mail folders</legend>{resources.mail_folders.items.map(folder=><label key={folder.id} className="outlook-choice"><input type="checkbox" checked={folders.includes(folder.id)} disabled={!folders.includes(folder.id)&&folders.length>=5} onChange={()=>toggle(folder.id,folders,setFolders)}/>{folder.displayName}</label>)}{!resources.mail_folders.items.length&&<p>No mail folders are available.</p>}</fieldset>
    {(!resources.calendars.complete||!resources.mail_folders.complete)&&<p role="status">Only part of the resource list is available. Unlisted resources have not been added.</p>}
    <button type="submit" disabled={busy}>Save Outlook choices</button><button type="button" disabled={busy} onClick={()=>{setResources(null);setCalendars(status.selected_calendar_ids);setFolders(status.selected_mail_folder_ids);}}>Cancel choices</button>
   </form>}
   {context&&<div aria-label="Today’s Outlook items"><p>Read from Outlook at {displayTime(context.fetched_at,timeZone)}. Refresh to check for changes.</p>{partial&&<p role="status">This is a partial result. More items may exist in Outlook.</p>}
    <h3>Appointments</h3>{context.calendars.flatMap(source=>source.result.items.map(event=><article key={source.id+':'+event.id}><h4>{event.subject||'Untitled appointment'}</h4><p>{event.isCancelled?'Cancelled · ':''}{event.isAllDay?'All day · ':''}{displayTime(event.start,timeZone)} – {displayTime(event.end,timeZone)}</p>{event.location&&<p>{event.location}</p>}</article>))}
    {!context.calendars.some(source=>source.result.items.length)&&<p>{partial?'No appointments in the returned results.':'No appointments were returned for the selected calendars today.'}</p>}
    <h3>Messages received today</h3>{context.mail_folders.flatMap(source=>source.result.items.map(mail=><article key={source.id+':'+mail.id}><h4>{mail.subject||'Untitled message'}</h4><p>{mail.from?.name||mail.from?.address||'Sender unavailable'} · {displayTime(mail.receivedAt,timeZone)}</p><p>{mail.preview}</p></article>))}
    {!context.mail_folders.some(source=>source.result.items.length)&&<p>{partial?'No messages in the returned results.':'No messages were returned for the selected folders today.'}</p>}
   </div>}
   {status.state==='connected'&&status.reviewed_writes_enabled&&service.actionClient&&<MicrosoftActions key={scopeKey+':'+status.revision} service={service.actionClient} localDate={localDate} timeZone={timeZone}/>}
  </>)}
 </section>;
}
