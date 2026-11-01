import {useEffect,useRef,useState,type ReactNode} from 'react';
import {api,ApiError,type ConversationReply} from './api';
import {startLocalVoice,type LocalVoiceHandle,type LocalVoiceState} from './local-voice';
import {startVoice} from './voice';
import {clientTabs,clientDestinations,type ConversationPurpose} from '../shared/client-navigation';
import type {AppConfig,ClientView,Today} from '../shared/contracts';
import {localDateTimeWithOffset} from '../shared/local-time';
import {Progress} from './Progress';
import {ConversationArchivePanel} from './ConversationArchive';
import {initialClientLayout,useFocusDock} from './client-layout';
import './client-home.css';
import {MicrosoftConnection,type MicrosoftClientService} from './MicrosoftConnection';
const outlookSetupService:MicrosoftClientService={status:api.microsoftStatus,connect:api.microsoftConnect,finish:api.microsoftFinish,resources:api.microsoftResources,select:api.microsoftSelect,context:api.microsoftContext,disconnect:api.microsoftDisconnect};

export interface ClientHomeProps {
 today:Today;scopeKey:string;localFeaturesAvailable:boolean;microsoftAvailable:boolean;voiceEligible:boolean;voiceAvailable:boolean;voiceTransport?:AppConfig['voice_transport'];
 onCheckVoice():Promise<AppConfig>;onRefresh():Promise<Today>;onLogout():Promise<void>;
 renderTasks(onTalk:()=>void):ReactNode;renderMeals(onTalk:()=>void):ReactNode;renderDay(calendar:CalendarState):ReactNode;
 reminders(active:boolean,onTalk:()=>void,onActivity:(active:boolean)=>void):ReactNode;pending?:ReactNode;
}
export interface CalendarState {events:Array<{id:string;subject:string;start:string;end:string;isAllDay:boolean;isCancelled:boolean}>;state:'off'|'loading'|'fresh'|'partial'|'unavailable';fetchedAt:string|null}
function dayRange(date:string,zone:string){const next=new Date(date+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);const start=localDateTimeWithOffset(date+'T00:00',zone),end=localDateTimeWithOffset(next.toISOString().slice(0,10)+'T00:00',zone);if(!start.ok||!end.ok)throw Error('Day unavailable.');return {start:start.value,end:end.value};}
const faq=[
 ['How do I start?','Tap Talk to Nancy and say what you need. You do not need to open a tab first. If speaking is difficult, choose Type to Nancy and send a message instead. Nancy still replies aloud.'],
 ['How can Nancy help me plan?','Try “Let’s plan today” or “What’s next?” Nancy can look at your tasks, meals and selected Outlook calendar. You choose what goes into your plan.'],
 ['How do I record something I did?','Tell Nancy what you actually did or ate. She will read the details back and ask you to confirm before saving. A plan is different from something you have done.'],
 ['How do I change my plan or grocery list?','Say what you want to change, such as “Move laundry to tomorrow” or “Add milk to my groceries.” Nancy will help you review the change.'],
 ['What does Ask for Help do?','Tell Nancy what you are finding difficult. She can break a task into steps, help you think through options, or discuss who could help. Opening this page does not call or message anyone.'],
 ['Can Nancy send an email or invitation?','Ask Nancy for the exact email or event you want. She reviews the account, recipients, message and times with you before you confirm. Nothing is sent just by discussing it.'],
 ['When is my microphone on?','Talk to Nancy turns on the microphone for the conversation. Starting with Type to Nancy does not turn it on. You can also type during a voice conversation; its microphone stays on until Stop voice. Closing the page stops the conversation. Nancy does not listen with the page closed.'],
 ['How do I stop repeated microphone questions on my iPhone?','In Safari, open Nancy’s page menu, choose Website Settings, then set Microphone to Allow for this website. Use a normal tab. Your browser controls this permission.'],
 ['Can I lock my phone while talking?','Nancy tries to keep your screen awake during a conversation. A manual lock, low battery or switching apps can still pause voice. Keep Nancy open while talking, and use Stop voice when finished.'],
 ['How do I suggest an improvement?','Open Suggestions for Nancy and tell her what could work better. She reads your suggestion back; say “save this suggestion” to save it for your caregiver to review.'],
];
export function NancySuggestionsPanel({onTalk,onSave,canSave=false,scopeKey,refreshVersion=0,administrator=false,canTalk=true}:{onTalk?:()=>void;onSave?:()=>void;canSave?:boolean;scopeKey:string;refreshVersion?:number;administrator?:boolean;canTalk?:boolean}){
 const [items,setItems]=useState<Array<{id:string;suggestion:string;created_at:string}>>([]),[issue,setIssue]=useState('');
 useEffect(()=>{let current=true;setItems([]);setIssue('');void api.nancySuggestions().then(data=>{if(current)setItems(data.items);}).catch(()=>{if(current)setIssue('Saved suggestions are unavailable right now.');});return()=>{current=false;};},[scopeKey,refreshVersion]);
 return <section className="client-card" aria-label="Suggestions for Nancy"><h2>Suggestions for Nancy</h2>{!administrator&&<><p>Tell Nancy what could work better, a meal preference, or something you want her to remember about you. She will review it with you before saving.</p><button className="primary-button" disabled={!canTalk} onClick={onTalk}>Tell Nancy my suggestion</button><button className="primary-button" disabled={!canSave} onClick={onSave}>Save Suggestions</button><p>Save becomes available after Nancy has read your suggestion back.</p></>}{issue&&<p role="status">{issue}</p>}{items.length>0&&<><h3>Saved suggestions</h3><ul>{items.map(item=><li key={item.id}>{item.suggestion}</li>)}</ul></>}</section>;
}
function ClientGroceries({local,scopeKey,refreshVersion}:{local:boolean;scopeKey:string;refreshVersion:number}){
 const [items,setItems]=useState<Array<{id:string;name:string;quantity:string;acquired:boolean}>>([]),[issue,setIssue]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{let current=true;setItems([]);setIssue('');setLoading(true);void (local?api.mealGroceryWorkspace().then(w=>w.groceries.map(g=>({id:g.id,name:g.name,quantity:g.amount!==null?`${g.amount} ${g.unit??''}`.trim():g.legacy_quantity??'',acquired:!!g.acquired_at}))):api.groceries().then(w=>(Array.isArray(w)?w:w.items).map(g=>({...g,quantity:g.quantity??'',acquired:false})))).then(rows=>{if(current)setItems(rows);}).catch(()=>{if(current)setIssue('Your grocery list could not refresh.');}).finally(()=>{if(current)setLoading(false);});return()=>{current=false;};},[local,scopeKey,refreshVersion]);
 return <section className="client-card" aria-label="Groceries"><h2>Groceries</h2>{loading?<p role="status">Loading your list…</p>:issue?<p role="status">{issue}</p>:items.length?<ul className="client-groceries">{items.map(item=><li key={item.id}><span>{item.name}</span><span>{[item.quantity,item.acquired?'Acquired':null].filter(Boolean).join(' · ')}</span></li>)}</ul>:<p>Your grocery list is empty.</p>}</section>;
}
export function ClientHome(props:ClientHomeProps){
 const {today,scopeKey,voiceEligible,voiceAvailable,voiceTransport}=props;
 const [layout]=useState(initialClientLayout),focus=layout==='focus';
 const [outlookSetup,setOutlookSetup]=useState(()=>new URL(window.location.href).searchParams.get('setup')==='outlook');
 const dock=useRef<HTMLElement|null>(null);
 useFocusDock(focus,dock);
 const [view,setView]=useState<ClientView>('my_day'),[voice,setVoice]=useState<LocalVoiceState>('stopped'),[voiceMessage,setVoiceMessage]=useState<string>(),[active,setActive]=useState(false),[reminderActive,setReminderActive]=useState(false);
 const [transcript,setTranscript]=useState<Array<{speaker:'you'|'nancy';text:string}>>([]),[issue,setIssue]=useState(''),[refreshVersion,setRefreshVersion]=useState(0);
 const [calendar,setCalendar]=useState<CalendarState>({events:[],state:'off',fetchedAt:null});
 const [review,setReview]=useState<ConversationReply['suggestion_review']|null>(null),[recipes,setRecipes]=useState<NonNullable<ConversationReply['recipes']>>([]);
 const handle=useRef<Pick<LocalVoiceHandle,'stop'|'interrupt'|'sendText'|'setTyping'>|null>(null),controller=useRef<AbortController|null>(null),epoch=useRef(0),mounted=useRef(true);
 const [audioUnlock,setAudioUnlock]=useState<(()=>void)|null>(null);
 const [archiveOpen,setArchiveOpen]=useState(false),[archiveStatus,setArchiveStatus]=useState<'saving'|'off'|'unavailable'>('off');
 const [textOpen,setTextOpen]=useState(false),[typedOnly,setTypedOnly]=useState(false),[draft,setDraft]=useState(''),[sending,setSending]=useState(false),[textIssue,setTextIssue]=useState('');
 const textInput=useRef<HTMLTextAreaElement|null>(null),submission=useRef(false);
 useEffect(()=>{handle.current?.setTyping?.(textOpen);},[textOpen,active]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;controller.current?.abort();void handle.current?.stop();handle.current=null;};},[]);
 useEffect(()=>{
  let current=true;setCalendar({events:[],state:props.microsoftAvailable?'loading':'off',fetchedAt:null});if(!props.microsoftAvailable)return;
  void api.microsoftCalendar(dayRange(today.local_date,today.profile!.time_zone)).then(data=>{if(current)setCalendar({events:data.calendars.flatMap(c=>c.result.items),state:data.calendars.some(c=>!c.result.complete)?'partial':'fresh',fetchedAt:data.fetched_at});}).catch(()=>{if(current)setCalendar({events:[],state:'unavailable',fetchedAt:null});});return()=>{current=false;};
 },[scopeKey,today.local_date,today.profile!.time_zone,props.microsoftAvailable,refreshVersion]);
 useEffect(()=>{const marker=new URL(window.location.href).searchParams.get('microsoft');if(!marker)return;
  if(props.microsoftAvailable)setOutlookSetup(true);else setIssue('Outlook is not available for this account.');
 },[scopeKey]);
 async function refresh(){try{await props.onRefresh();if(mounted.current){setIssue('');setRefreshVersion(v=>v+1);}}catch{if(mounted.current)setIssue('Your day could not refresh. Your last saved information is still shown.');}}
 async function start(purpose:ConversationPurpose='general',inputMode:'speech'|'typed'='speech'){
  if(!voiceEligible)return;
  if(handle.current){if(purpose!=='general'&&voice!=='thinking'&&voice!=='speaking')void handle.current.sendText(purpose==='help'?'I would like help with something.':'I would like to suggest an improvement to Nancy.');return;}
  if(voice==='connecting')return;const run=++epoch.current;let reportedError:string|undefined;controller.current?.abort();const abort=new AbortController();controller.current=abort;setTypedOnly(inputMode==='typed');setVoice('connecting');setVoiceMessage('Starting Nancy…');
  try{const ready=voiceAvailable?{voice_available:true,voice_transport:voiceTransport}:await props.onCheckVoice();if(!mounted.current||run!==epoch.current)return;if(!ready.voice_available){setVoice('stopped');setVoiceMessage('Nancy is warming up. Please try again in a moment.');return;}
   if(inputMode==='typed'&&ready.voice_transport!=='local')throw new ApiError(503,'typed_unavailable','Typing is unavailable for this connection. Please try again later.');
   const options={onArchiveStatus:(status:"saving"|"off"|"unavailable")=>{if(mounted.current&&run===epoch.current)setArchiveStatus(status);},onReview:(value:ConversationReply['suggestion_review']|null)=>{if(mounted.current&&run===epoch.current)setReview(value);},onRecipes:(value:NonNullable<ConversationReply['recipes']>)=>{if(mounted.current&&run===epoch.current)setRecipes(value);},signal:abort.signal,purpose,inputMode,onAudioUnlock:(resume:(()=>void)|null)=>{if(mounted.current&&run===epoch.current)setAudioUnlock(()=>resume);},onState:(state:LocalVoiceState,message?:string)=>{if(!mounted.current||run!==epoch.current)return;if(state==='error'&&message?.trim())reportedError=message;setVoice(state);setVoiceMessage(message);if(state==='stopped'||state==='error')setReview(null);if(state==='stopped'||state==='error'){handle.current=null;setActive(false);setAudioUnlock(null);}},onReady:(value:LocalVoiceHandle)=>{if(!mounted.current||run!==epoch.current){void value.stop();return;}handle.current=value;setActive(true);},onTranscript:(speaker:'you'|'nancy',text:string)=>{if(mounted.current&&run===epoch.current)setTranscript(rows=>[...rows.slice(-7),{speaker,text}]);},onChange:()=>{if(mounted.current&&run===epoch.current)void refresh();},onNavigate:(destination:string)=>{if(mounted.current&&run===epoch.current)setView(clientDestinations.includes(destination as ClientView)?destination as ClientView:'my_day');}};
   const result=await (ready.voice_transport==='local'?startLocalVoice(options):startVoice(options));if(!mounted.current||run!==epoch.current){await result.stop();return;}handle.current=result as LocalVoiceHandle;setActive(true);
  }catch(error){if(mounted.current&&run===epoch.current){handle.current=null;setActive(false);setVoice('error');setVoiceMessage(reportedError??(error instanceof ApiError?error.message:'Nancy could not start. Please try again.'));}}
 }
 async function stop(){setReview(null);epoch.current++;controller.current?.abort();controller.current=null;const prior=handle.current;handle.current=null;submission.current=false;setSending(false);setAudioUnlock(null);setActive(false);setVoice('stopped');setVoiceMessage(undefined);await prior?.stop();}
 function openText(){setTextOpen(true);textInput.current?.focus();void start('general','typed');}
 async function sendTyped(){
  const value=draft.trim(),current=handle.current;if(!value||value.length>2000||!current||submission.current||voice==='thinking'||voice==='speaking'||voice==='connecting')return;
  const run=epoch.current;submission.current=true;setSending(true);setTextIssue('');
  try{const received=await current.sendText(value);if(!mounted.current||run!==epoch.current)return;if(received===false)setTextIssue('This message was not confirmed. Check My Day before sending it again.');else setDraft(previous=>previous.trim()===value?'':previous);}
  catch{if(mounted.current&&run===epoch.current)setTextIssue('This message was not confirmed. Check My Day before sending it again.');}
  finally{if(mounted.current&&run===epoch.current){submission.current=false;setSending(false);textInput.current?.focus();}}
 }
 const textBusy=sending||!active||voice==='thinking'||voice==='speaking'||voice==='connecting';
 async function saveSuggestions(){
  const current=handle.current,pending=review;if(!pending||!current||submission.current||voice!=='listening')return;
  const run=epoch.current;submission.current=true;setSending(true);setReview(null);
  try{const received=await current.sendText(pending.confirmation_text,pending.reply_id);if(received===false&&mounted.current&&run===epoch.current)setTextIssue('That save is unconfirmed. Ask Nancy to check it before trying again.');}
  catch{if(mounted.current&&run===epoch.current)setTextIssue('That save is unconfirmed. Ask Nancy to check it before trying again.');}
  finally{if(mounted.current&&run===epoch.current){submission.current=false;setSending(false);}}
 }
 const heading=voice==='thinking'?'Nancy is thinking':voice==='speaking'?'Nancy is speaking':voice==='listening'?(typedOnly?'Ready for your message':'Nancy is listening'):voice==='connecting'?'Starting Nancy':voice==='closing'?'Nancy is waiting':voice==='error'?'Nancy needs a moment':!voiceAvailable?'Nancy is warming up':'Ready when you are';
 return <main className={'today-shell client-home'+(focus?' client-focus':'')}><header className="client-header"><button className="client-brand" aria-label="Nancy home" onClick={()=>setView('my_day')}>Nancy</button><button className="client-suggestions-button" onClick={()=>setView('suggestions')}>Suggestions for Nancy</button></header>
  <section ref={dock} className={'voice-panel persistent-voice-panel'+(focus?' focus-voice-dock':'')} aria-label="Talk to Nancy">
   <div><h1 id="nancy-voice-status" aria-live="polite">{heading}</h1><p>{voiceMessage??(!voiceEligible?'Nancy’s voice is not connected for this account yet.':!voiceAvailable?'Nancy’s voice is warming up. Please try Talk to Nancy in a moment.':'Ask Nancy about your day, meals, or anything you need help with.')}</p></div>
   <div className="voice-actions"><button className="talk-button" aria-describedby="nancy-voice-status" disabled={!voiceEligible||active||voice==='connecting'} onClick={()=>void start()}>Talk to Nancy</button><button className="type-button" aria-expanded={textOpen} aria-controls="nancy-text-composer" disabled={!voiceEligible||voiceTransport!=='local'} onClick={openText}>Type to Nancy</button>{audioUnlock&&voice==='connecting'&&<button className="primary-button" onClick={audioUnlock}>Enable sound</button>}{(active||voice==='connecting')&&<button className="stop-button" onClick={()=>void stop()}>{typedOnly?'End conversation':'Stop voice'}</button>}</div>
  </section>
  {textOpen&&<form id="nancy-text-composer" className="client-text-composer" aria-label="Message Nancy" onSubmit={event=>{event.preventDefault();void sendTyped();}}>
   <label htmlFor="nancy-typed-message">Your message to Nancy</label><p id="nancy-text-help">Type instead of speaking. Nancy will reply aloud and show her reply below. Changes still need your confirmation.</p>
   <textarea ref={textInput} autoFocus id="nancy-typed-message" aria-describedby="nancy-text-help nancy-text-count" value={draft} maxLength={2000} rows={3} onChange={event=>{setDraft(event.target.value);setTextIssue('');}}/>
   <div className="client-text-actions"><small id="nancy-text-count">{draft.length}/2000</small><button type="button" className="text-button" onClick={()=>setTextOpen(false)}>Hide typing</button><button type="submit" className="primary-button" disabled={!draft.trim()||textBusy}>Send message</button></div>
   {textIssue&&<p role="alert">{textIssue}</p>}
  </form>}
  {outlookSetup&&props.microsoftAvailable&&<section className="client-card" aria-label="Outlook setup"><h2>Outlook connection</h2><p>Use the approved Microsoft account and select its calendar and Inbox. Your caregiver can help with this step.</p><MicrosoftConnection service={outlookSetupService} scopeKey={scopeKey} localDate={today.local_date} timeZone={today.profile!.time_zone}/><button className="secondary-button" onClick={()=>{setOutlookSetup(false);setRefreshVersion(v=>v+1);const url=new URL(window.location.href);url.searchParams.delete('setup');url.searchParams.delete('microsoft');window.history.replaceState(null,'',url.pathname+url.search+url.hash);}}>Done with Outlook setup</button></section>}
  <nav className="client-tabs" aria-label="My Day views">{clientTabs.map(([id,label])=><button key={id} aria-current={view===id?'page':undefined} onClick={()=>setView(id)}>{label}</button>)}</nav>
  {issue&&<p role="status">{issue}</p>}
  {active&&archiveStatus==='saving'&&<p role="status">This conversation’s text is being saved on this computer for later review.</p>}
  {archiveStatus==='unavailable'&&<p role="alert">Conversation text could not be saved. Your meal, task or email result is unchanged. Check Saved conversation text in Ways to use Nancy.</p>}
  {props.reminders(active||voice==='connecting',()=>void start(),setReminderActive)}
  {transcript.length>0&&<section className="transcript" aria-label="Recent conversation" aria-live="polite">{transcript.length>3&&<details><summary>Earlier conversation</summary>{transcript.slice(0,-3).map((row,i)=><p key={i}><strong>{row.speaker==='nancy'?'Nancy':'You'}</strong>{row.text}</p>)}</details>}{transcript.slice(-3).map((row,i)=><p key={i} className={row.speaker}><strong>{row.speaker==='nancy'?'Nancy':'You'}</strong>{row.text}</p>)}</section>}
  {view==='my_day'&&props.renderDay(calendar)}
  {recipes.length>0&&<section className="client-card" aria-label="Suggested recipes"><h2>Suggested recipes</h2>{recipes.map(recipe=><article key={recipe.id}><h3><a href={recipe.href} target="_blank" rel="noopener noreferrer">{recipe.title}</a></h3><p>Makes {recipe.servings} serving{recipe.servings===1?'':'s'}. Quantities are for the whole recipe.</p><ul>{recipe.ingredients.map(item=><li key={item.name}>{item.amount} {item.unit} {item.name}</li>)}</ul><details><summary>Preparation steps</summary><ol>{recipe.steps.map((step,index)=><li key={index}>{step}</li>)}</ol></details><p>Ask Nancy to add the missing ingredients to your list or email this recipe to you.</p></article>)}</section>}
  {review&&view!=='suggestions'&&<button className="primary-button" disabled={textBusy} onClick={()=>void saveSuggestions()}>Save Suggestions</button>}
  {view==='tasks'&&props.renderTasks(()=>void start())}
  {view==='meals'&&props.renderMeals(()=>void start())}
  {view==='groceries'&&<ClientGroceries local={props.localFeaturesAvailable} scopeKey={scopeKey} refreshVersion={refreshVersion}/>}
  {view==='progress'&&(props.localFeaturesAvailable?<Progress key={refreshVersion} scopeKey={scopeKey} localDate={today.local_date} visible readOnly/>:<section className="client-card"><h2>Progress</h2><p>{today.activity_ledger?`${today.activity_ledger.summary.tasks_completed} tasks done · ${today.activity_ledger.summary.meals_eaten} meals reported`:'No activity has been reported yet.'}</p></section>)}
  {view==='ask_for_help'&&<section className="client-card"><h2>Ask for Help</h2><p>What would you like a hand with?</p><button className="primary-button" disabled={!voiceEligible} onClick={()=>void start('help')}>Talk to Nancy about help</button></section>}
  {view==='suggestions'&&<NancySuggestionsPanel scopeKey={scopeKey} refreshVersion={refreshVersion} onTalk={()=>void start('suggestions')} onSave={()=>void saveSuggestions()} canSave={!!review&&!textBusy} canTalk={voiceEligible}/>}
  {view==='ways_to_use'&&<section className="client-card" aria-label="Ways to use Nancy"><h2>Ways to use Nancy</h2>{faq.map(([question,answer])=><details className="client-faq" key={question}><summary>{question}</summary><p>{answer}</p></details>)}<details className="client-faq" onToggle={event=>setArchiveOpen(event.currentTarget.open)}><summary>Save and review conversation text</summary>{archiveOpen&&<ConversationArchivePanel scopeKey={scopeKey} onChoice={()=>setArchiveStatus('off')}/>}</details>{props.microsoftAvailable&&<details className="client-faq"><summary>How do I reconnect Outlook?</summary><p>Your caregiver can help sign in with the approved Microsoft account and choose its calendar and Inbox.</p><button className="secondary-button" onClick={()=>setOutlookSetup(true)}>Open Outlook connection</button></details>}</section>}
  {props.pending}
  <footer className="client-footer"><button onClick={()=>setView('ways_to_use')}>Ways to use Nancy</button><button className="text-button" onClick={()=>void stop().then(props.onLogout)}>Sign out</button></footer>
 </main>;
}
