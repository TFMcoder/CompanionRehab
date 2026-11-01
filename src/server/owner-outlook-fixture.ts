import {createHash} from 'node:crypto';
import type {LocalCare} from './local-care.js';
import {ownerTestSchema,type OwnerTestSettings} from './owner-test-config.js';
import type {Session} from './session.js';
import type {CareAuthority} from './care-access.js';
import {ApiError} from './errors.js';
import {dateInZone} from '../shared/contracts.js';
import {localDateTimeWithOffset} from '../shared/local-time.js';
import {microsoftReadRangeSchema,type MicrosoftReadRange,type MicrosoftStatus} from '../shared/microsoft-contracts.js';
import {recentInboxRange} from './microsoft/preparation.js';
import type {OutlookConversation} from './microsoft/conversation-port.js';
import type {OutlookReadScope} from './microsoft/fast-read.js';
import {mailSearchQuery} from './microsoft/mail-search.js';
import type {MicrosoftMailSearch} from '../shared/microsoft-contracts.js';

const calendar='owner-practice-calendar',folder='owner-practice-inbox',message='owner-practice-message';
const shift=(date:string,days:number)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
const denied=()=>new ApiError(403,'owner_outlook_fixture_scope','This source is limited to the exact owner practice account.');
type Authority=(session:Session)=>Promise<CareAuthority&{time_zone:string;profile_revision:number}>;

/** No credentials, network, provider adapter, durable fixture rows or shared cache. */
export class OwnerOutlookFixture implements OutlookConversation {
 readonly sourceMode='owner_fixture' as const;
 readonly settings:OwnerTestSettings;
 constructor(settings:OwnerTestSettings,private authority:Authority,private clock=()=>new Date()){
  this.settings=ownerTestSchema.parse(settings);
 }
 private async scope(session:Session){
  const scope=await this.authority(session);
  if(scope.actor_id!==session.user_id||scope.login_session_id!==session.session_id||scope.actor_id!==this.settings.owner_actor_id||scope.client_id!==this.settings.participant_id||scope.active_role!=='client')throw denied();
  return scope;
 }
 async authorityRevision(session:Session){const scope=await this.scope(session);return createHash('sha256').update(JSON.stringify(['owner-outlook-fixture-v1',scope, this.settings.origin])).digest('hex');}
 async status(session:Session):Promise<MicrosoftStatus>{await this.scope(session);return{available:true,eligible:true,state:'connected',revision:1,selected_calendar_ids:[calendar],selected_mail_folder_ids:[folder],last_read_at:null,last_error:null,model_disclosure_enabled:true,reviewed_writes_enabled:false};}
 private data(zone:string){
  const now=this.clock(),today=dateInZone(now,zone),tomorrow=shift(today,1),weekday=new Date(today+'T12:00:00Z').getUTCDay();
  const wednesday=shift(today,(3-weekday+7)%7),nextMonday=shift(today,((8-weekday)%7)||7),nextTuesday=shift(nextMonday,1);
  const at=(date:string,time:string)=>{const result=localDateTimeWithOffset(date+'T'+time,zone);if(!result.ok)throw Error('Practice fixture time is unavailable');return result.value;};
  const event=(id:string,date:string,time:string,end:string,subject:string)=>({id,subject,start:at(date,time),end:at(date,end),cancelled:false,location:null});
  return{now,today,tomorrow,events:[event('practice-clinic-'+tomorrow,tomorrow,'14:00','15:00','Practice clinic visit'),event('practice-library-'+wednesday,wednesday,'10:00','11:00','Practice library visit'),event('practice-followup-'+nextTuesday,nextTuesday,'14:00','15:00','Practice follow-up')],preview:`Practice only: Could we meet on ${tomorrow} at 14:30 ${zone}? This is a suggestion, not a confirmed booking.`};
 }
 async preparedContext(session:Session,input:MicrosoftReadRange,_scope:OutlookReadScope='both'){
  await this.scope(session);return{source:'microsoft',state:'not_prepared',requested_range:microsoftReadRangeSchema.parse(input)};
 }
 async conversationContext(session:Session,input:MicrosoftReadRange,scope:OutlookReadScope='both'){
  const authority=await this.scope(session),range=microsoftReadRangeSchema.parse(input),data=this.data(authority.time_zone),fetched_at=data.now.toISOString();
  const result={source:'microsoft' as const,source_mode:this.sourceMode,state:'fresh' as const,fetched_at,range,mail_range:recentInboxRange(data.now),...(scope!=='both'?{source_scope:scope}:{}),
   calendars:scope==='inbox'?[]:[{id:calendar,fetched_at,complete:true,omitted:0,truncation:null,events:data.events.filter(e=>Date.parse(e.start)<Date.parse(range.end)&&Date.parse(e.end)>Date.parse(range.start))}],
   mail_folders:scope==='calendar'?[]:[{id:folder,fetched_at,complete:true,omitted:0,truncation:null,messages:[{id:message,subject:'Practice appointment suggestion',from:{name:'Practice sender',address:'practice@example.invalid'},received_at:new Date(data.now.getTime()-15*60000).toISOString(),is_read:false,reply_status:'unknown' as const,preview:data.preview}]}],
   limitations:['Synthetic owner practice fixtures, not a real Microsoft connection.','Read status does not establish whether a message was answered. No Sent mail or complete reply thread check.']};
  const after=await this.scope(session);if(JSON.stringify(after)!==JSON.stringify(authority))throw denied();return result;
 }
 async conversationMessage(session:Session,folderId:string,messageId:string){
  const authority=await this.scope(session);if(folderId!==folder||![message,message+'-older'].includes(messageId))throw denied();
  const data=this.data(authority.time_zone),older=messageId.endsWith('-older');return{source:'microsoft',source_mode:this.sourceMode,fetched_at:data.now.toISOString(),id:messageId,subject:older?'Practice clinic appointment follow-up':'Practice appointment suggestion',from:{name:'Practice sender',address:'practice@example.invalid'},to:[],body_text:older?'Practice only: Contact the practice clinic to arrange a follow-up. This is a scheduling request, not a confirmed booking.':data.preview,body_truncated:false};
 }
 async conversationMailSearch(session:Session,input:MicrosoftMailSearch){
  const before=await this.scope(session),data=this.data(before.time_zone),search=mailSearchQuery(input,data.now);
  const candidates=[{id:message,subject:'Practice appointment suggestion',from:{name:'Practice sender',address:'practice@example.invalid'},received_at:new Date(data.now.getTime()-15*60000).toISOString(),is_read:false,reply_status:'unknown' as const,preview:data.preview},
   {id:message+'-older',subject:'Practice clinic appointment follow-up',from:{name:'Practice sender',address:'practice@example.invalid'},received_at:new Date(data.now.getTime()-45*86400000).toISOString(),is_read:true,reply_status:'unknown' as const,preview:'Practice only: Contact the practice clinic to arrange a follow-up. This is a scheduling request, not a confirmed booking.'}];
  const terms=search.query.query?.match(/[\p{L}\p{N}]+/gu)??[],messages=candidates.filter(m=>Date.parse(m.received_at)>=Date.parse(search.range.start)&&Date.parse(m.received_at)<Date.parse(search.range.end)&&(!search.query.from||m.from.address===search.query.from.toLowerCase())&&terms.every(term=>(m.subject+' '+m.preview+' '+m.from.address).toLowerCase().includes(term.toLowerCase())));
  const after=await this.scope(session);if(JSON.stringify(before)!==JSON.stringify(after))throw denied();
  return {source:'microsoft' as const,source_mode:this.sourceMode,state:'fresh' as const,range:undefined,source_scope:'inbox' as const,operation:'mail_search' as const,fetched_at:data.now.toISOString(),search:{...search.query,...search.range},mail_range:search.range,calendars:[],mail_folders:[{id:folder,fetched_at:data.now.toISOString(),complete:true,omitted:0,truncation:null,messages}],limitations:['Synthetic owner practice search, not a real Microsoft mailbox.','Read status is not reply status. An appointment email is not a confirmed booking.']};
 }
 async prepareAction():Promise<never>{throw new ApiError(403,'owner_outlook_fixture_read_only','Practice Outlook sources cannot send or create anything.');}
 async confirmAction():Promise<never>{return this.prepareAction();}
 async actionReceipt():Promise<never>{return this.prepareAction();}
 async description(session:Session){const scope=await this.scope(session),data=this.data(scope.time_zone);return{enabled:true,synthetic:true,read_only:true,profile:'gpt-6-sol low',time_zone:scope.time_zone,local_date:data.today,events:data.events,mail_subject:'Practice appointment suggestion',sample_questions:['What appointments do I have tomorrow?','What appointments do I have next week?','Read my Inbox']};}
}

export async function createOwnerOutlookFixture(settings:OwnerTestSettings,care:LocalCare){
 ownerTestSchema.parse(settings);
 const actual=(await care.pool.query('select current_database() db,current_user role')).rows[0];
 if(actual.db!==settings.database_name||actual.role!==settings.database_role)throw denied();
 return new OwnerOutlookFixture(settings,async session=>{
  const scope=await care.authority(session);
  if(scope.actor_id!==settings.owner_actor_id||scope.client_id!==settings.participant_id||scope.active_role!=='client')throw denied();
  const profile=(await care.pool.query('select time_zone,revision from companion_local.participant_profiles where id=$1',[scope.client_id])).rows[0];
  if(!profile)throw denied();return {...scope,time_zone:profile.time_zone,profile_revision:profile.revision};
 });
}
