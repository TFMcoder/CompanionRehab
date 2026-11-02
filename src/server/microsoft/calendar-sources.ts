import {createHash} from 'node:crypto';
import type {Session} from '../session.js';
import type {MicrosoftService} from './service.js';
import type {OutlookConversation,OutlookContext} from './conversation-port.js';
import type {PreparedMicrosoftContext} from './preparation.js';
import type {MicrosoftReadRange} from '../../shared/microsoft-contracts.js';
import type {OutlookReadScope} from './fast-read.js';
import {preparationFreshMs} from './preparation.js';

type Context=OutlookContext;
type Source=Pick<MicrosoftService,'status'|'authorityRevision'|'preparedContext'|'conversationContext'|'calendarContext'>;
type Ready=Omit<PreparedMicrosoftContext,'state'>&{state:string};
function ready(value:Context,range:MicrosoftReadRange,now:Date):value is Ready{
 if(!('calendars' in value)||!value.calendars||!('range' in value)||!value.range||!('fetched_at' in value)||!value.fetched_at)return false;
 const age=now.getTime()-Date.parse(value.fetched_at);
 return ['fresh','prepared'].includes(value.state)&&Number.isFinite(age)&&age>=0&&age<preparationFreshMs
  &&Date.parse(value.range.start)<=Date.parse(range.start)&&Date.parse(value.range.end)>=Date.parse(range.end);
}
const sourceNames=['primary Outlook account','additional calendar account'] as const;
/** Two exact approved identities. Mail and all provider writes remain on primary. */
export class MicrosoftCalendarSources implements OutlookConversation {
 constructor(private primary:MicrosoftService,private secondary:Source,private clock:()=>Date=()=>new Date()){}
 async authorityRevision(session:Session){
  const revisions=await Promise.all([this.primary.authorityRevision(session),this.secondary.authorityRevision(session)]);
  return createHash('sha256').update(JSON.stringify(revisions)).digest('hex');
 }
 async status(session:Session){
  const [primary,secondary]=await Promise.all([this.primary.status(session),this.secondary.status(session)]);
  const readable=[primary,secondary].some(s=>s.eligible&&s.state==='connected'&&s.model_disclosure_enabled);
  return {...primary,available:primary.available||secondary.available,eligible:primary.eligible&&secondary.eligible,
   state:readable?'connected' as const:primary.state,model_disclosure_enabled:readable,
   // Write selections and authorization always describe the unchanged primary.
   reviewed_writes_enabled:primary.reviewed_writes_enabled===true};
 }
 private async context(session:Session,range:MicrosoftReadRange,scope:OutlookReadScope,refresh:boolean):Promise<Context>{
  if(scope==='inbox')return refresh?this.primary.conversationContext(session,range,scope):this.primary.preparedContext(session,range,scope);
  const method=refresh?'conversationContext':'preparedContext';
  // Authorization errors intentionally propagate; never turn revoked care access into a partial read.
  const [primary,secondary]=await Promise.all([this.primary[method](session,range,scope),this.secondary[method](session,range,'calendar')]);
  const values=[primary,secondary],now=this.clock();
  const available=values.map(value=>ready(value,range,now)&&value.calendars.length>0);
  const coverage=values.map((value,index)=>({source_key:index===0?'primary':'secondary',label:sourceNames[index],state:value.state,available:available[index]}));
  const usable=values.filter(value=>ready(value,range,now));
  if(!usable.length)return {...primary,calendar_coverage:coverage,coverage_complete:false};
  const base=usable[0];
  const calendars=values.flatMap((value,index)=>ready(value,range,now)?value.calendars.map(calendar=>({...calendar,source_key:index===0?'primary':'secondary',source_label:sourceNames[index]})):[]);
  const fetched=usable.map(value=>value.fetched_at).sort()[0];
  const result={...base,source:'microsoft',state:refresh?'fresh':'prepared',range,requested_range:range,fetched_at:fetched,
   ...(scope!=='both'?{source_scope:scope}:{}),calendars,mail_folders:ready(primary,range,now)?primary.mail_folders:[],
   calendar_coverage:coverage,coverage_complete:available.every(Boolean),
   limitations:[...new Set(usable.flatMap(value=>value.limitations)),
    'Calendar coverage requires both approved accounts. A disconnected, unselected or failed account is unknown, never empty. Mail and reviewed writes use only the primary account.']};
  return result;
 }
 preparedContext(session:Session,range:MicrosoftReadRange,scope:OutlookReadScope='both'){return this.context(session,range,scope,false);}
 conversationContext(session:Session,range:MicrosoftReadRange,scope:OutlookReadScope='both'){return this.context(session,range,scope,true);}
 async calendarContext(session:Session,range:MicrosoftReadRange){
  const sources=[this.primary,this.secondary];
  const reads=await Promise.all(sources.map(async(source,index)=>{
   const status=await source.status(session);
   const missing={id:`unavailable-source-${index}`,source_key:index===0?'primary':'secondary',source_label:sourceNames[index],result:{items:[],complete:false,truncation:null,fetchedAt:this.clock().toISOString()}};
   if(!status.eligible||status.state!=='connected'||!status.selected_calendar_ids.length)return [missing];
   try{const result=await source.calendarContext(session,range);return result.calendars.length?result.calendars.map(calendar=>({...calendar,source_key:index===0?'primary':'secondary',source_label:sourceNames[index]})):[missing];}
   catch(error){if(error&&typeof error==='object'&&'status' in error&&[401,403].includes(Number(error.status)))throw error;return [missing];}
  }));
  return {source:'microsoft' as const,fetched_at:this.clock().toISOString(),calendars:reads.flat()};
 }
 conversationMessage(...args:Parameters<MicrosoftService['conversationMessage']>){return this.primary.conversationMessage(...args);}
 conversationMailSearch(...args:Parameters<MicrosoftService['conversationMailSearch']>){return this.primary.conversationMailSearch(...args);}
 prepareAction(...args:Parameters<MicrosoftService['prepareAction']>){return this.primary.prepareAction(...args);}
 confirmAction(...args:Parameters<MicrosoftService['confirmAction']>){return this.primary.confirmAction(...args);}
 actionReceipt(...args:Parameters<MicrosoftService['actionReceipt']>){return this.primary.actionReceipt(...args);}
}
