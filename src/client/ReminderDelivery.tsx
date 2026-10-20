import { useEffect, useRef, useState } from 'react';
import type { LocalDayCommand, PromptItem } from '../shared/local-day-contracts';

export interface ReminderClientService {claim():Promise<PromptItem|null>;ack(id:string,token:string,channel:'in_app'|'speech'|'notification'):Promise<unknown>;respond?(command:Extract<LocalDayCommand,{type:'respond_prompt'}>):Promise<unknown>;current?(id:string):Promise<boolean>;resume?():Promise<PromptItem|null>}
/** Foreground delivery only. Opening Nancy never grants microphone or notification permission. */
export function ReminderDelivery({service,scopeKey,conversationActive,onTalk,onActivity,voiceEligible,voiceOnly=false}:{service:ReminderClientService;scopeKey:string;conversationActive:boolean;onTalk:()=>void;onActivity:(active:boolean)=>void;voiceEligible:boolean;voiceOnly?:boolean}) {
 const [prompt,setPrompt]=useState<PromptItem|null>(null),[issue,setIssue]=useState(''),[soundReady,setSoundReady]=useState(false),[responding,setResponding]=useState(false),[delay,setDelay]=useState(15);
 const shown=useRef<PromptItem|null>(null),response=useRef<Extract<LocalDayCommand,{type:'respond_prompt'}>|null>(null);
 function show(item:PromptItem|null){shown.current=item;setPrompt(item);if(!item)response.current=null;}
 const audio=useRef<AudioContext|null>(null),source=useRef<AudioBufferSourceNode|null>(null),flight=useRef<AbortController|null>(null),generation=useRef(0),deliveryEpoch=useRef(0),latest=useRef({conversationActive,onActivity,voiceEligible});latest.current={conversationActive,onActivity,voiceEligible};
 function stop(){deliveryEpoch.current++;flight.current?.abort();try{source.current?.stop();}catch{/* The sound may already have ended. */}source.current=null;latest.current.onActivity(false);}
 async function enableSound(){try{const context=audio.current??new AudioContext();audio.current=context;await context.resume();setSoundReady(context.state==='running');setIssue('');}catch{setIssue('Sound is unavailable here. Reminders will appear on screen.');}}
 useEffect(()=>{if(conversationActive){stop();show(null);}},[conversationActive]);
 async function respond(decision:'snooze'|'decline'){
  if(!shown.current||!service.respond||responding)return;stop();const epoch=generation.current;setResponding(true);setIssue('');
  const prior=response.current;
  const command=prior??{type:'respond_prompt' as const,idempotency_key:crypto.randomUUID(),confirmed:true as const,prompt_id:shown.current.id,expected_revision:shown.current.response_revision??0,decision,snooze_minutes:decision==='snooze'?delay:null};response.current=command;
  try{await service.respond(command);if(epoch===generation.current)show(null);}catch{if(epoch===generation.current)setIssue('That choice is unconfirmed. Retry the same choice to check it.');}finally{if(epoch===generation.current)setResponding(false);}
 }
 useEffect(()=>{
  const epoch=++generation.current;show(null);setResponding(false);setIssue('');let closed=false,recoveryChecked=false,busy=false;
  async function poll(){
   if(closed||busy||document.visibilityState!=='visible'||latest.current.conversationActive)return;
   busy=true;const delivery=deliveryEpoch.current;
   const current=()=>!closed&&epoch===generation.current&&delivery===deliveryEpoch.current&&document.visibilityState==='visible'&&!latest.current.conversationActive;
   try{if(shown.current){const id=shown.current.id;if(service.current&&!await service.current(id)&&current()&&shown.current?.id===id){stop();show(null);}return;}
    if(!recoveryChecked&&service.resume){const restored=await service.resume();if(!current())return;recoveryChecked=true;if(restored){show(restored);return;}}
    const item=await service.claim();if(!item||!current())return;
    if(service.current&&(!await service.current(item.id)||!current()))return;
    show(item);let channel:'in_app'|'speech'|'notification'='in_app',interrupted=false;
    if(item.browser_notifications&&!item.delivery_uncertain&&typeof Notification!=='undefined'&&Notification.permission==='granted'){
     try{new Notification('Nancy',{body:item.message,tag:item.id});channel='notification';}catch{/* Safari without notifications keeps the in-app reminder. */}
    }
    if(item.foreground_speech&&!item.delivery_uncertain&&latest.current.voiceEligible&&audio.current?.state==='running'){
     latest.current.onActivity(true);const controller=new AbortController();flight.current=controller;
     try{const response=await fetch(`/api/prompts/${encodeURIComponent(item.id)}/speech`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({claim_token:item.claim_token}),signal:controller.signal});
      if(!response.ok)throw new Error('Reminder sound was unavailable.');const bytes=await response.arrayBuffer(),buffer=await audio.current.decodeAudioData(bytes);
      if(!current()||controller.signal.aborted||!latest.current.voiceEligible)return;
      if(service.current&&(!await service.current(item.id)||!current())){if(current())show(null);return;}
      const node=audio.current.createBufferSource();node.buffer=buffer;node.connect(audio.current.destination);source.current=node;
      await new Promise<void>((resolve,reject)=>{node.onended=()=>controller.signal.aborted?reject(new Error('Interrupted')):resolve();node.start();});channel='speech';
     }catch{interrupted=controller.signal.aborted;if(closed||epoch!==generation.current)return;/* Text remains useful after an audio failure. */}
     finally{if(flight.current===controller){source.current=null;flight.current=null;latest.current.onActivity(false);}}
    }
    if(current()&&!interrupted)await service.ack(item.id,item.claim_token!,channel);
   }catch{if(current())setIssue('Reminders could not refresh. Your plan is still available.');}finally{busy=false;}
  }
  const visibility=()=>{if(document.visibilityState!=='visible'){stop();show(null);recoveryChecked=false;}else void poll();};
  const hide=()=>{stop();show(null);recoveryChecked=false;};
  const timer=window.setInterval(()=>void poll(),15000);document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',hide);void poll();
  return()=>{closed=true;generation.current++;window.clearInterval(timer);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',hide);stop();};
 },[scopeKey,service]);
 useEffect(()=>()=>{void audio.current?.close();audio.current=null;},[]);
 if(voiceOnly)return prompt?<aside aria-label="Reminders"><p>{prompt.message}</p><button onClick={()=>{stop();onTalk();}}>Talk to Nancy about this</button></aside>:null;
 return <aside aria-label="Reminders">{prompt&&<div role="status"><p>{prompt.message}</p>{prompt.delivery_uncertain&&<p>This reminder may have appeared earlier. Check it here.</p>}<button onClick={()=>{stop();onTalk();}}>Talk to Nancy</button>{service.respond?<><label>Remind me in<select aria-label="Snooze minutes" disabled={responding||!!response.current} value={delay} onChange={event=>setDelay(Number(event.target.value))}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>1 hour</option></select></label><button disabled={responding||response.current?.decision==='decline'} onClick={()=>void respond('snooze')}>Snooze</button><button disabled={responding||response.current?.decision==='snooze'} onClick={()=>void respond('decline')}>No more for this check</button></>:<button onClick={()=>{stop();show(null);}}>Dismiss</button>}</div>}
  <details><summary>Reminder sound</summary><p>While this page is open, reminders can be read aloud after you enable sound here and save your reminder choices.</p>{voiceEligible&&<button onClick={()=>void enableSound()}>{soundReady?'Sound enabled':'Enable reminder sound'}</button>}
   {typeof Notification!=='undefined'&&typeof Notification.requestPermission==='function'&&Notification.permission==='default'&&<button onClick={()=>{void Notification.requestPermission().catch(()=>setIssue('Device notifications are unavailable.'));}}>Allow device notifications</button>}
   {issue&&<p role="status">{issue}</p>}
  </details>
 </aside>;
}
