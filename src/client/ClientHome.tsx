import {useEffect,useRef,useState,type ReactNode} from 'react';
import {api,ApiError} from './api';
import {startLocalVoice,type LocalVoiceHandle,type LocalVoiceState} from './local-voice';
import {startVoice} from './voice';
import {clientTabs,clientDestinations,type ConversationPurpose} from '../shared/client-navigation';
import type {AppConfig,ClientView,Today} from '../shared/contracts';
import {localDateTimeWithOffset} from '../shared/local-time';
import {Progress} from './Progress';
import {initialClientLayout,useFocusDock} from './client-layout';
import './client-home.css';

export interface ClientHomeProps {
 today:Today;scopeKey:string;localFeaturesAvailable:boolean;microsoftAvailable:boolean;voiceEligible:boolean;voiceAvailable:boolean;voiceTransport?:AppConfig['voice_transport'];
 onCheckVoice():Promise<AppConfig>;onRefresh():Promise<Today>;onLogout():Promise<void>;
 renderTasks(onTalk:()=>void):ReactNode;renderMeals(onTalk:()=>void):ReactNode;renderDay(calendar:CalendarState):ReactNode;
 reminders(active:boolean,onTalk:()=>void,onActivity:(active:boolean)=>void):ReactNode;pending?:ReactNode;
}
export interface CalendarState {events:Array<{id:string;subject:string;start:string;end:string;isAllDay:boolean;isCancelled:boolean}>;state:'off'|'loading'|'fresh'|'partial'|'unavailable';fetchedAt:string|null}
function dayRange(date:string,zone:string){const next=new Date(date+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);const start=localDateTimeWithOffset(date+'T00:00',zone),end=localDateTimeWithOffset(next.toISOString().slice(0,10)+'T00:00',zone);if(!start.ok||!end.ok)throw Error('Day unavailable.');return {start:start.value,end:end.value};}
const faq=[
 ['How do I start?','Tap Talk to Nancy and say what you need. You do not need to open a tab first.'],
 ['How can Nancy help me plan?','Try “Let’s plan today” or “What’s next?” Nancy can look at your tasks, meals and selected Outlook calendar. You choose what goes into your plan.'],
 ['How do I record something I did?','Tell Nancy what you actually did or ate. She will read the details back and ask you to confirm before saving. A plan is different from something you have done.'],
 ['How do I change my plan or grocery list?','Say what you want to change, such as “Move laundry to tomorrow” or “Add milk to my groceries.” Nancy will help you review the change.'],
 ['What does Ask for Help do?','Tell Nancy what you are finding difficult. She can break a task into steps, help you think through options, or discuss who could help. Opening this page does not call or message anyone.'],
 ['Can Nancy send an email or invitation?','Ask Nancy for the exact email or event you want. She reviews the account, recipients, message and times with you before you confirm. Nothing is sent just by discussing it.'],
 ['When is my microphone on?','Talk to Nancy turns on the microphone for the conversation. Stop voice ends it. Closing the page also stops it. Nancy does not listen with the page closed.'],
 ['How do I suggest an improvement?','Open Suggestions for Nancy and tell her what could work better. She reads your suggestion back; say “save this suggestion” to save it for your caregiver to review.'],
];
export function NancySuggestionsPanel({onTalk,scopeKey,refreshVersion=0,administrator=false,canTalk=true}:{onTalk?:()=>void;scopeKey:string;refreshVersion?:number;administrator?:boolean;canTalk?:boolean}){
 const [items,setItems]=useState<Array<{id:string;suggestion:string;created_at:string}>>([]),[issue,setIssue]=useState('');
 useEffect(()=>{let current=true;setItems([]);setIssue('');void api.nancySuggestions().then(data=>{if(current)setItems(data.items);}).catch(()=>{if(current)setIssue('Saved suggestions are unavailable right now.');});return()=>{current=false;};},[scopeKey,refreshVersion]);
 return <section className="client-card" aria-label="Suggestions for Nancy"><h2>Suggestions for Nancy</h2>{!administrator&&<><p>What would make Nancy easier or more useful for you?</p><button className="primary-button" disabled={!canTalk} onClick={onTalk}>Tell Nancy my suggestion</button></>}{issue&&<p role="status">{issue}</p>}{items.length>0&&<><h3>Saved suggestions</h3><ul>{items.map(item=><li key={item.id}>{item.suggestion}</li>)}</ul></>}</section>;
}
function ClientGroceries({local,scopeKey,refreshVersion}:{local:boolean;scopeKey:string;refreshVersion:number}){
 const [items,setItems]=useState<Array<{id:string;name:string;quantity:string;acquired:boolean}>>([]),[issue,setIssue]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{let current=true;setItems([]);setIssue('');setLoading(true);void (local?api.mealGroceryWorkspace().then(w=>w.groceries.map(g=>({id:g.id,name:g.name,quantity:g.amount!==null?`${g.amount} ${g.unit??''}`.trim():g.legacy_quantity??'',acquired:!!g.acquired_at}))):api.groceries().then(w=>(Array.isArray(w)?w:w.items).map(g=>({...g,quantity:g.quantity??'',acquired:false})))).then(rows=>{if(current)setItems(rows);}).catch(()=>{if(current)setIssue('Your grocery list could not refresh.');}).finally(()=>{if(current)setLoading(false);});return()=>{current=false;};},[local,scopeKey,refreshVersion]);
 return <section className="client-card" aria-label="Groceries"><h2>Groceries</h2>{loading?<p role="status">Loading your list…</p>:issue?<p role="status">{issue}</p>:items.length?<ul className="client-groceries">{items.map(item=><li key={item.id}><span>{item.name}</span><span>{[item.quantity,item.acquired?'Acquired':null].filter(Boolean).join(' · ')}</span></li>)}</ul>:<p>Your grocery list is empty.</p>}</section>;
}
export function ClientHome(props:ClientHomeProps){
 const {today,scopeKey,voiceEligible,voiceAvailable,voiceTransport}=props;
 const [layout]=useState(initialClientLayout),focus=layout==='focus';
 const dock=useRef<HTMLElement|null>(null);
 useFocusDock(focus,dock);
 const [view,setView]=useState<ClientView>('my_day'),[voice,setVoice]=useState<LocalVoiceState>('stopped'),[voiceMessage,setVoiceMessage]=useState<string>(),[active,setActive]=useState(false),[reminderActive,setReminderActive]=useState(false);
 const [transcript,setTranscript]=useState<Array<{speaker:'you'|'nancy';text:string}>>([]),[issue,setIssue]=useState(''),[refreshVersion,setRefreshVersion]=useState(0);
 const [calendar,setCalendar]=useState<CalendarState>({events:[],state:'off',fetchedAt:null});
 const handle=useRef<Pick<LocalVoiceHandle,'stop'|'interrupt'|'sendText'>|null>(null),controller=useRef<AbortController|null>(null),epoch=useRef(0),mounted=useRef(true),callback=useRef<Promise<unknown>|null>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;controller.current?.abort();void handle.current?.stop();handle.current=null;};},[]);
 useEffect(()=>{
  let current=true;setCalendar({events:[],state:props.microsoftAvailable?'loading':'off',fetchedAt:null});if(!props.microsoftAvailable)return;
  void api.microsoftCalendar(dayRange(today.local_date,today.profile!.time_zone)).then(data=>{if(current)setCalendar({events:data.calendars.flatMap(c=>c.result.items),state:data.calendars.some(c=>!c.result.complete)?'partial':'fresh',fetchedAt:data.fetched_at});}).catch(()=>{if(current)setCalendar({events:[],state:'unavailable',fetchedAt:null});});return()=>{current=false;};
 },[scopeKey,today.local_date,today.profile!.time_zone,props.microsoftAvailable,refreshVersion]);
 useEffect(()=>{const marker=new URL(window.location.href).searchParams.get('microsoft');if(!marker)return;let current=true;
  if(marker==='finish')callback.current??=api.microsoftFinish();else callback.current??=Promise.reject(new Error('Outlook sign-in was not completed.'));
  void callback.current.then(()=>{if(current)setRefreshVersion(v=>v+1);}).catch(()=>{if(current)setIssue('Outlook could not reconnect. Ask your caregiver to help.');}).finally(()=>{if(current){const url=new URL(window.location.href);url.searchParams.delete('microsoft');window.history.replaceState(null,'',url.pathname+url.search+url.hash);}});return()=>{current=false;};
 },[scopeKey]);
 async function refresh(){try{await props.onRefresh();if(mounted.current){setIssue('');setRefreshVersion(v=>v+1);}}catch{if(mounted.current)setIssue('Your day could not refresh. Your last saved information is still shown.');}}
 async function start(purpose:ConversationPurpose='general'){
  if(!voiceEligible)return;
  if(handle.current){if(purpose!=='general'&&voice!=='thinking'&&voice!=='speaking')void handle.current.sendText(purpose==='help'?'I would like help with something.':'I would like to suggest an improvement to Nancy.');return;}
  if(voice==='connecting')return;const run=++epoch.current;let reportedError:string|undefined;controller.current?.abort();const abort=new AbortController();controller.current=abort;setVoice('connecting');setVoiceMessage('Starting Nancy…');
  try{const ready=voiceAvailable?{voice_available:true,voice_transport:voiceTransport}:await props.onCheckVoice();if(!mounted.current||run!==epoch.current)return;if(!ready.voice_available){setVoice('stopped');setVoiceMessage('Nancy is warming up. Please try again in a moment.');return;}
   const options={signal:abort.signal,purpose,onState:(state:LocalVoiceState,message?:string)=>{if(!mounted.current||run!==epoch.current)return;if(state==='error'&&message?.trim())reportedError=message;setVoice(state);setVoiceMessage(message);if(state==='stopped'||state==='error'){handle.current=null;setActive(false);}},onReady:(value:LocalVoiceHandle)=>{if(!mounted.current||run!==epoch.current){void value.stop();return;}handle.current=value;setActive(true);},onTranscript:(speaker:'you'|'nancy',text:string)=>{if(mounted.current&&run===epoch.current)setTranscript(rows=>[...rows.slice(-7),{speaker,text}]);},onChange:()=>{if(mounted.current&&run===epoch.current)void refresh();},onNavigate:(destination:string)=>{if(mounted.current&&run===epoch.current)setView(clientDestinations.includes(destination as ClientView)?destination as ClientView:'my_day');}};
   const result=await (ready.voice_transport==='local'?startLocalVoice(options):startVoice(options));if(!mounted.current||run!==epoch.current){await result.stop();return;}handle.current=result as LocalVoiceHandle;setActive(true);
  }catch(error){if(mounted.current&&run===epoch.current){handle.current=null;setActive(false);setVoice('error');setVoiceMessage(reportedError??(error instanceof ApiError?error.message:'Nancy could not start. Please try again.'));}}
 }
 async function stop(){epoch.current++;controller.current?.abort();controller.current=null;const prior=handle.current;handle.current=null;setActive(false);setVoice('stopped');setVoiceMessage(undefined);await prior?.stop();}
 const heading=voice==='thinking'?'Nancy is thinking':voice==='speaking'?'Nancy is speaking':voice==='listening'?'Nancy is listening':voice==='connecting'?'Starting Nancy':voice==='closing'?'Nancy is waiting':voice==='error'?'Nancy needs a moment':!voiceAvailable?'Nancy is warming up':'Ready when you are';
 return <main className={'today-shell client-home'+(focus?' client-focus':'')}><header className="client-header"><button className="client-brand" aria-label="Nancy home" onClick={()=>setView('my_day')}>Nancy</button><button className="client-suggestions-button" onClick={()=>setView('suggestions')}>Suggestions for Nancy</button></header>
  <section ref={dock} className={'voice-panel'+(focus?' focus-voice-dock':'')} aria-label="Talk to Nancy"><div><h1 id={focus?'focus-voice-status':undefined} aria-live="polite">{heading}</h1>{(!focus||voiceMessage||!voiceEligible||!voiceAvailable)&&<p>{voiceMessage??(!voiceEligible?'Nancy’s voice is not connected for this account yet.':!voiceAvailable?'Nancy’s voice is warming up. Please try Talk to Nancy in a moment.':'Ask Nancy about your day, meals, or anything you need help with.')}</p>}</div><div className="voice-actions">{focus&&<button className="talk-button" aria-describedby="focus-voice-status" disabled={!voiceEligible||active||voice==='connecting'} onClick={()=>void start()}>Talk to Nancy</button>}{active||voice==='connecting'?<>{active&&['thinking','speaking'].includes(voice)&&handle.current?.interrupt&&<button className="interrupt-button" onClick={()=>handle.current?.interrupt()}>Interrupt Nancy</button>}<button className="stop-button" onClick={()=>void stop()}>Stop voice</button></>:!focus&&<button className="talk-button" disabled={!voiceEligible} onClick={()=>void start()}>Talk to Nancy</button>}</div></section>
  <nav className="client-tabs" aria-label="My Day views">{clientTabs.map(([id,label])=><button key={id} aria-current={view===id?'page':undefined} onClick={()=>setView(id)}>{label}</button>)}</nav>
  {issue&&<p role="status">{issue}</p>}
  {props.reminders(active||voice==='connecting',()=>void start(),setReminderActive)}
  {transcript.length>0&&<section className="transcript" aria-label="Recent conversation" aria-live="polite">{transcript.length>3&&<details><summary>Earlier conversation</summary>{transcript.slice(0,-3).map((row,i)=><p key={i}><strong>{row.speaker==='nancy'?'Nancy':'You'}</strong>{row.text}</p>)}</details>}{transcript.slice(-3).map((row,i)=><p key={i} className={row.speaker}><strong>{row.speaker==='nancy'?'Nancy':'You'}</strong>{row.text}</p>)}</section>}
  {view==='my_day'&&props.renderDay(calendar)}
  {view==='tasks'&&props.renderTasks(()=>void start())}
  {view==='meals'&&props.renderMeals(()=>void start())}
  {view==='groceries'&&<ClientGroceries local={props.localFeaturesAvailable} scopeKey={scopeKey} refreshVersion={refreshVersion}/>}
  {view==='progress'&&(props.localFeaturesAvailable?<Progress key={refreshVersion} scopeKey={scopeKey} localDate={today.local_date} visible readOnly/>:<section className="client-card"><h2>Progress</h2><p>{today.activity_ledger?`${today.activity_ledger.summary.tasks_completed} tasks done · ${today.activity_ledger.summary.meals_eaten} meals reported`:'No activity has been reported yet.'}</p></section>)}
  {view==='ask_for_help'&&<section className="client-card"><h2>Ask for Help</h2><p>What would you like a hand with?</p><button className="primary-button" disabled={!voiceEligible} onClick={()=>void start('help')}>Talk to Nancy about help</button></section>}
  {view==='suggestions'&&<NancySuggestionsPanel scopeKey={scopeKey} refreshVersion={refreshVersion} onTalk={()=>void start('suggestions')} canTalk={voiceEligible}/>}
  {view==='ways_to_use'&&<section className="client-card" aria-label="Ways to use Nancy"><h2>Ways to use Nancy</h2>{faq.map(([question,answer])=><details className="client-faq" key={question}><summary>{question}</summary><p>{answer}</p></details>)}</section>}
  {props.pending}
  <footer className="client-footer"><button onClick={()=>setView('ways_to_use')}>Ways to use Nancy</button><button className="text-button" onClick={()=>void stop().then(props.onLogout)}>Sign out</button></footer>
 </main>;
}
