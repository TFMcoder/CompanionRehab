import { useEffect, useRef, useState } from 'react';
import type { PromptItem } from '../shared/local-day-contracts';

export interface ReminderClientService {claim():Promise<PromptItem|null>;ack(id:string,token:string,channel:'in_app'|'speech'|'notification'):Promise<unknown>}
/** Foreground delivery only. Opening Nancy never grants microphone or notification permission. */
export function ReminderDelivery({service,scopeKey,conversationActive,onTalk,onActivity,voiceEligible}:{service:ReminderClientService;scopeKey:string;conversationActive:boolean;onTalk:()=>void;onActivity:(active:boolean)=>void;voiceEligible:boolean}) {
 const [prompt,setPrompt]=useState<PromptItem|null>(null),[issue,setIssue]=useState(''),[soundReady,setSoundReady]=useState(false);
 const audio=useRef<AudioContext|null>(null),source=useRef<AudioBufferSourceNode|null>(null),flight=useRef<AbortController|null>(null),generation=useRef(0),busy=useRef(false),latest=useRef({conversationActive,onActivity,voiceEligible});latest.current={conversationActive,onActivity,voiceEligible};
 function stop(){flight.current?.abort();try{source.current?.stop();}catch{/* The sound may already have ended. */}source.current=null;latest.current.onActivity(false);}
 async function enableSound(){try{const context=audio.current??new AudioContext();audio.current=context;await context.resume();setSoundReady(context.state==='running');setIssue('');}catch{setIssue('Sound is unavailable here. Reminders will appear on screen.');}}
 useEffect(()=>{if(conversationActive){stop();setPrompt(null);}},[conversationActive]);
 useEffect(()=>{
  const epoch=++generation.current;setPrompt(null);setIssue('');let closed=false;
  async function poll(){
   if(closed||busy.current||document.visibilityState!=='visible'||latest.current.conversationActive)return;
   busy.current=true;
   try{const item=await service.claim();if(!item||closed||epoch!==generation.current||document.visibilityState!=='visible'||latest.current.conversationActive)return;
    setPrompt(item);let channel:'in_app'|'speech'|'notification'='in_app',interrupted=false;
    if(item.browser_notifications&&!item.delivery_uncertain&&typeof Notification!=='undefined'&&Notification.permission==='granted'){
     try{new Notification('Nancy',{body:item.message,tag:item.id});channel='notification';}catch{/* Safari without notifications keeps the in-app reminder. */}
    }
    if(item.foreground_speech&&!item.delivery_uncertain&&latest.current.voiceEligible&&audio.current?.state==='running'){
     latest.current.onActivity(true);const controller=new AbortController();flight.current=controller;
     try{const response=await fetch(`/api/prompts/${encodeURIComponent(item.id)}/speech`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({claim_token:item.claim_token}),signal:controller.signal});
      if(!response.ok)throw new Error('Reminder sound was unavailable.');const bytes=await response.arrayBuffer(),buffer=await audio.current.decodeAudioData(bytes);
      if(closed||controller.signal.aborted||latest.current.conversationActive||document.visibilityState!=='visible'||epoch!==generation.current)return;
      const node=audio.current.createBufferSource();node.buffer=buffer;node.connect(audio.current.destination);source.current=node;
      await new Promise<void>((resolve,reject)=>{node.onended=()=>controller.signal.aborted?reject(new Error('Interrupted')):resolve();node.start();});channel='speech';
     }catch{interrupted=controller.signal.aborted;if(closed||epoch!==generation.current)return;/* Text remains useful after an audio failure. */}
     finally{source.current=null;flight.current=null;latest.current.onActivity(false);}
    }
    if(!closed&&!interrupted&&epoch===generation.current&&document.visibilityState==='visible'&&!latest.current.conversationActive)await service.ack(item.id,item.claim_token!,channel);
   }catch{if(!closed)setIssue('Reminders could not refresh. Your plan is still available.');}finally{busy.current=false;}
  }
  const visibility=()=>{if(document.visibilityState!=='visible'){stop();setPrompt(null);}else void poll();};
  const timer=window.setInterval(()=>void poll(),15000);document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',stop);void poll();
  return()=>{closed=true;generation.current++;window.clearInterval(timer);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',stop);stop();};
 },[scopeKey,service]);
 useEffect(()=>()=>{void audio.current?.close();audio.current=null;},[]);
 return <aside aria-label="Reminders">{prompt&&<div role="status"><p>{prompt.message}</p>{prompt.delivery_uncertain&&<p>This reminder may have appeared earlier. Check it here.</p>}<button onClick={()=>{stop();onTalk();}}>Talk to Nancy</button><button onClick={()=>{stop();setPrompt(null);}}>Dismiss</button></div>}
  <details><summary>Reminder sound</summary><p>While this page is open, reminders can be read aloud after you enable sound here and save your reminder choices.</p>{voiceEligible&&<button onClick={()=>void enableSound()}>{soundReady?'Sound enabled':'Enable reminder sound'}</button>}
   {typeof Notification!=='undefined'&&typeof Notification.requestPermission==='function'&&Notification.permission==='default'&&<button onClick={()=>{void Notification.requestPermission().catch(()=>setIssue('Device notifications are unavailable.'));}}>Allow device notifications</button>}
   {issue&&<p role="status">{issue}</p>}
  </details>
 </aside>;
}
