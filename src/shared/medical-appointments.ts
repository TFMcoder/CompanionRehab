import {dateInZone,type Today} from './contracts.js';

const medical=/\b(medical|doctor|clinic|hospital|dentist|dental|physio(?:therapy)?|rehab(?:ilitation)?|therap(?:y|ist)|specialist|radiology|optometrist|cardiologist|neurologist|oncologist|surgeon|mri|ultrasound|gp)\b/i;
const administration=/\b(appointments?|visits?|consultation|follow[ -]?up|referral|book(?:ing)?|schedul(?:e|ing)|confirm(?:ation)?|reschedul(?:e|ing)|cancel(?:lation)?|wait[ -]?list|sessions?|check[ -]?up|scan|test|transport|travel|prepar(?:e|ation))\b/i;
const marketing=/\b(newsletter|advertisement|discount|webinar|article)\b/i;
export const isMedicalAppointmentTask=(text:string)=>medical.test(text)&&administration.test(text)&&!marketing.test(text);
export const isMedicalAppointmentRequest=(text:string)=>isMedicalAppointmentTask(text)&&/\b(my|our|help|need|manage|book|confirm|reschedule|find|check|search|prepare|arrange|call)\b/i.test(text);
const record=(value:unknown):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
const array=(value:unknown):any[]=>Array.isArray(value)?value:[];
const text=(value:unknown,max=200)=>typeof value==='string'?value.slice(0,max):'';

/** Bounded administrative cues, never clinical urgency, a booking or an unanswered-mail claim. */
export function medicalAppointmentContext(today:Today,sources:unknown[],now:Date){
 const localDate=dateInZone(now,today.profile?.time_zone??'America/Toronto'),current=today.local_date===localDate;
 const zone=today.profile?.time_zone??'America/Toronto',until=new Date(localDate+'T12:00:00Z');until.setUTCDate(until.getUTCDate()+7);
 const within=(start:unknown)=>typeof start==='string'&&Number.isFinite(Date.parse(start))&&dateInZone(new Date(start),zone)>=localDate&&dateInZone(new Date(start),zone)<until.toISOString().slice(0,10);
 const calendar_entries:Array<Record<string,unknown>>=[],correspondence:Array<Record<string,unknown>>=[];
 if(current)for(const appointment of today.appointments??[]){
  const actual=today.activity_ledger?.options.find(item=>item.kind==='appointment'&&item.source_id===appointment.id&&!item.unplanned);
  if(['completed','deferred'].includes(actual?.status??'')||(today.activity_reports??[]).some(r=>r.target_id===appointment.id&&r.local_date===localDate&&['completed','deferred'].includes(r.status)))continue;
  const start=actual?.scheduled_at??appointment.starts_at;
  if(within(start)&&medical.test(appointment.title)&&!marketing.test(appointment.title))calendar_entries.push({source:'local_calendar',id:appointment.id,title:appointment.title.slice(0,200),start,attendance:'unknown'});
 }
 const seen=new Set<string>();
 for(const source of sources){const context=record(source);
  for(const calendar of array(context.calendars))for(const raw of array(record(calendar).events)){const event=record(raw),id=text(event.id,2048),key='calendar:'+text(calendar.id,2048)+':'+id;
   if(!id||seen.has(key)||event.cancelled===true||!within(event.start)||!medical.test(text(event.subject))||marketing.test(text(event.subject)))continue;seen.add(key);
   calendar_entries.push({source:'outlook_calendar',calendar_id:text(calendar.id,2048),id,title:text(event.subject),start:event.start,end:event.end,attendance:'unknown',source_checked_at:context.fetched_at??null});
  }
  for(const folder of array(context.mail_folders))for(const raw of array(record(folder).messages)){const message=record(raw),id=text(message.id,2048),key='mail:'+text(folder.id,2048)+':'+id,summary=text(message.subject)+' '+text(message.preview,500);
   if(!id||seen.has(key)||!isMedicalAppointmentTask(summary))continue;seen.add(key);
   correspondence.push({source:'outlook_email',folder_id:text(folder.id,2048),id,subject:text(message.subject),from:message.from??null,received_at:message.received_at??null,preview:text(message.preview,500),is_read:message.is_read??null,reply_status:'unknown',booking_status:'unverified',action_status:'needs_review',source_checked_at:context.fetched_at??null});
  }
 }
 calendar_entries.sort((a,b)=>Date.parse(String(a.start))-Date.parse(String(b.start)));
 const tasks=current?(today.checkin?.accepted?.tasks??today.tasks).filter(task=>{
  if(!isMedicalAppointmentTask(task.title)||task.scheduled_date&&task.scheduled_date>localDate)return false;
  const actual=today.activity_ledger?.options.find(item=>item.kind==='task'&&item.source_id===task.id&&!item.unplanned);
  return !['completed','deferred'].includes(actual?.status??'')&&(!actual?.scheduled_at||dateInZone(new Date(actual.scheduled_at),zone)===localDate)
   &&!(today.activity_reports??[]).some(r=>r.target_id===task.id&&r.local_date===localDate&&['completed','deferred'].includes(r.status));
 }).slice(0,6).map(task=>({id:task.id,title:task.title.slice(0,200),scheduled_date:task.scheduled_date??null,scheduled_time:task.scheduled_time??null,accepted_in_day_plan:!!today.checkin?.accepted})):[];
 return {purpose:'medical_appointment_administration',local_date:localDate,local_time:new Intl.DateTimeFormat('en-CA',{timeZone:zone,hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).format(now),local_facts_current:current,
  source_checks:sources.map(record).filter(s=>s.source==='microsoft').map(s=>({state:s.state??'unknown',checked_at:s.fetched_at??null,calendar_range:s.range??null,mail_range:s.mail_range??null,calendars_complete:array(s.calendars).length?array(s.calendars).every(c=>c.complete===true):null,mail_complete:array(s.mail_folders).length?array(s.mail_folders).every(f=>f.complete===true):null})),
  tasks,calendar_entries:calendar_entries.slice(0,6),correspondence:correspondence.slice(0,6),omitted_calendar_entries:Math.max(0,calendar_entries.length-6),omitted_correspondence:Math.max(0,correspondence.length-6),
  limitations:['Bounded source cues for client review, not a complete appointment system or evidence of clinical urgency.','An email may request, suggest, confirm or cancel something; inspect exact details before deciding the next action. Unread does not mean unanswered.','Calendar entries are separate from accepted care tasks and actual attendance. Client review and explicit approval remain required for saves or external communication.']};
}
