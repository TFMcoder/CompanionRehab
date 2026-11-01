import type {MicrosoftContext,MicrosoftReadRange} from '../../shared/microsoft-contracts.js';
import type {OutlookReadScope} from './fast-read.js';
export const preparationFreshMs=5*60_000;
/** Inbox recency is independent of the date of the calendar being discussed. */
export const recentInboxRange=(now:Date):MicrosoftReadRange=>({start:new Date(now.getTime()-7*86400000).toISOString(),end:now.toISOString()});
export function compactMicrosoftContext(context:MicrosoftContext,range:MicrosoftReadRange,mailRange:MicrosoftReadRange,scope:OutlookReadScope='both',messageLimit:12|20=12){
 let eventsLeft=20,messagesLeft:number=messageLimit;
 return {source:'microsoft' as const,state:'fresh' as const,fetched_at:context.fetched_at,range,mail_range:mailRange,...(scope!=='both'?{source_scope:scope}:{}),
  calendars:context.calendars.map(({id,result})=>{const items=result.items.slice(0,eventsLeft);eventsLeft-=items.length;return {id,fetched_at:result.fetchedAt,complete:result.complete&&result.items.length===items.length,omitted:result.items.length-items.length,truncation:result.truncation,events:items.map(e=>({id:e.id,subject:e.subject.slice(0,200),start:e.start,end:e.end,cancelled:e.isCancelled,location:e.location?.slice(0,200)??null}))};}),
  mail_folders:context.mail_folders.map(({id,result})=>{const items=result.items.slice(0,messagesLeft);messagesLeft-=items.length;return {id,fetched_at:result.fetchedAt,complete:result.complete&&result.items.length===items.length,omitted:result.items.length-items.length,truncation:result.truncation,messages:items.map(m=>({id:m.id,subject:m.subject.slice(0,200),from:m.from,received_at:m.receivedAt,is_read:m.isRead,reply_status:'unknown' as const,preview:m.preview.slice(0,500)}))};}),
  limitations:['Only selected calendars and Inbox folders. Read status does not establish whether a message was answered. No Sent mail or complete reply thread check.'],
 };
}
export type PreparedMicrosoftContext=ReturnType<typeof compactMicrosoftContext>;
export function usablePreparedContext(context:PreparedMicrosoftContext,requested:MicrosoftReadRange,now:Date,scope:OutlookReadScope='both'){
 const age=now.getTime()-Date.parse(context.fetched_at);
 return (!context.source_scope||context.source_scope===scope)&&Number.isFinite(age)&&age>=0&&age<preparationFreshMs&&Date.parse(context.range.start)<=Date.parse(requested.start)&&Date.parse(context.range.end)>=Date.parse(requested.end);
}
