import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Session } from './session.js';
import { ApiError } from './errors.js';
import { dateInZone, type Plan, type Task, type MealSlot, type Today } from '../shared/contracts.js';
import { activityDate } from '../shared/activity-contracts.js';
import { activityId } from './activity-ledger.js';
import {effectiveAppointments} from './effective-schedule.js';
import { localDateTimeWithOffset } from '../shared/local-time.js';
import { localDayCommandSchema, retainedLocalDayCommandTypes, type LocalDayCommand, type LocalDayReceipt, type LocalDayWorkspace, type CarryoverItem, type CarryoverHistoryItem, type PromptPreferences, type PromptItem, type SignificantHandoff, type DailyPreparation } from '../shared/local-day-contracts.js';
import { localAuthority, requireClient, lockParticipant, localTransaction, previousLocalCommand, saveLocalCommand, canonicalJson, type LocalDb, type LocalAuthority } from './local-authority.js';
import { dailyContext, dailyRhythm } from '../shared/daily-context.js';
import { currentNutritionReference } from './nutrition-reference.js';
import { foodCheckSource, suppressMealPrompt, type IntakePromptFact, type PromptSource } from './food-prompts.js';
import { focusOptions,taskFocus } from './task-focus.js';
import type { TaskFocus } from '../shared/local-day-contracts.js';
import { readIntakeTiming } from './intake-timing.js';
import type { IntakeTiming } from '../shared/intake-timing.js';

export const defaultPromptPreferences:PromptPreferences={revision:0,enabled:false,food_check_ins:false,meal_times:{breakfast:null,lunch:null,dinner:null},appointment_lead_minutes:30,quiet_start:'21:00',quiet_end:'08:00',foreground_speech:false,browser_notifications:false};
function conflict(message:string):never{throw new ApiError(409,'conflict',message);}
const iso=(value:Date|string)=>new Date(value).toISOString();
const nullableIso=(value:Date|string|null)=>value?iso(value):null;
const handoff=(row:any):SignificantHandoff=>({id:row.id,summary:row.summary,occurred_at:iso(row.occurred_at),source:row.source,source_actor_id:row.source_actor_id,
 recorded_at:iso(row.recorded_at),revision:row.revision,status:row.status,reviewed_at:nullableIso(row.reviewed_at),reviewed_by:row.reviewed_by,resolved_at:nullableIso(row.resolved_at),resolution_note:row.resolution_note});
const preparation=(row:any):DailyPreparation|null=>row?{local_date:String(row.local_date).slice(0,10),prepared_at:iso(row.prepared_at),context_version:row.context_version,trigger:row.trigger,status:row.status,source_revisions:row.source_revisions}:null;
export interface LocalDayOptions {dayContext?:(participantId:string,localDate:string)=>Promise<Today>}
function preferences(row:any):PromptPreferences{return row?{revision:row.revision,enabled:row.enabled,food_check_ins:row.food_check_ins??false,meal_times:row.meal_times,appointment_lead_minutes:row.appointment_lead_minutes,
 quiet_start:String(row.quiet_start).slice(0,5),quiet_end:String(row.quiet_end).slice(0,5),foreground_speech:row.foreground_speech,browser_notifications:row.browser_notifications}:{...defaultPromptPreferences};}
export function isQuiet(now:Date,zone:string,start:string,end:string){
 const time=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
 return start===end?false:start<end?time>=start&&time<end:time>=start||time<end;
}
/** Extends daily_checkins; proposals still require the existing exact-plan acceptance. */
export class LocalDayService {
 static readonly participantsPerTick=8;
 static readonly jobsPerReconciliation=64;
 static readonly appointmentsPerReconciliation=64;
 constructor(private pool:Pool,private clock=()=>new Date(),private options:LocalDayOptions={}){}
 async holdHandoff(session:Session,input:LocalDayCommand):Promise<void>{
  const command=localDayCommandSchema.parse(input);
  if(!retainedLocalDayCommandTypes.includes(command.type))throw new ApiError(400,'invalid_input','Choose a reviewed day change.');
  await localTransaction(this.pool,async db=>{
   const ctx=await localAuthority(db,session,this.clock(),true);requireClient(ctx);await lockParticipant(db,ctx);
   const old=(await db.query('select * from companion_local.pending_handoff_commands where participant_id=$1 and actor_id=$2 for update',[ctx.participant,ctx.actor])).rows[0];
   if(old){if(old.command_id!==command.idempotency_key||old.grant_fingerprint!==ctx.grant||canonicalJson(old.command)!==canonicalJson(command))conflict('Check the previous day change before making another change.');return;}
   await db.query('insert into companion_local.pending_handoff_commands(participant_id,actor_id,command_id,command,grant_fingerprint,confirmed_at) values($1,$2,$3,$4,$5,$6)',[ctx.participant,ctx.actor,command.idempotency_key,JSON.stringify(command),ctx.grant,this.clock()]);
  });
 }
 async pendingHandoff(session:Session):Promise<{command:LocalDayCommand;scope_matches:boolean}|null>{
  const ctx=await localAuthority(this.pool,session,this.clock());requireClient(ctx);
  const row=(await this.pool.query('select command,grant_fingerprint from companion_local.pending_handoff_commands where participant_id=$1 and actor_id=$2',[ctx.participant,ctx.actor])).rows[0];
  if(canonicalJson(await localAuthority(this.pool,session,this.clock()))!==canonicalJson(ctx))throw new ApiError(403,'scope_changed','Your access changed. Refresh the day.');
  return row?{command:localDayCommandSchema.parse(row.command),scope_matches:row.grant_fingerprint===ctx.grant}:null;
 }
 async acknowledgeHandoff(session:Session,key:string):Promise<boolean>{
  return localTransaction(this.pool,async db=>{const ctx=await localAuthority(db,session,this.clock(),true);requireClient(ctx);await lockParticipant(db,ctx);
   const receipt=(await db.query("select 1 from companion_local.append_only_mutations where participant_id=$1 and actor_id=$2 and command_id=$3 and event_type=any($4::text[])",[ctx.participant,ctx.actor,key,retainedLocalDayCommandTypes.map(type=>'LocalDay'+type)])).rows[0];
   if(!receipt)return false;
   await db.query('delete from companion_local.pending_handoff_commands where participant_id=$1 and actor_id=$2 and command_id=$3',[ctx.participant,ctx.actor,key]);return true;});
 }
 async discardPendingHandoff(session:Session,key:string):Promise<boolean>{
  return localTransaction(this.pool,async db=>{const ctx=await localAuthority(db,session,this.clock(),true);requireClient(ctx);await lockParticipant(db,ctx);
   const receipt=(await db.query("select 1 from companion_local.append_only_mutations where participant_id=$1 and actor_id=$2 and command_id=$3",[ctx.participant,ctx.actor,key])).rows[0];if(receipt)return false;
   await db.query('delete from companion_local.pending_handoff_commands where participant_id=$1 and actor_id=$2 and command_id=$3',[ctx.participant,ctx.actor,key]);return true;});
 }
 /** Current active notes are always read afresh; a preparation marker is never care context. */
 async activeHandoffs(session:Session):Promise<SignificantHandoff[]>{
  const ctx=await localAuthority(this.pool,session,this.clock());requireClient(ctx);
  const result=(await this.pool.query("select * from companion_local.significant_handoffs where participant_id=$1 and status='active' order by occurred_at,id limit 20",[ctx.participant])).rows.map(handoff);
  if(canonicalJson(await localAuthority(this.pool,session,this.clock()))!==canonicalJson(ctx))throw new ApiError(403,'scope_changed','Your access changed. Refresh the day.');
  return result;
 }
 private async validFocus(db:LocalDb,participant:string,row:any):Promise<boolean>{
  if(!row||!['active','paused'].includes(row.state))return false;
  const choices=await focusOptions(db,participant,String(row.local_date).slice(0,10),this.clock());
  return choices.some(choice=>choice.activity_id===row.activity_id&&choice.source_version===row.source_version);
 }
 async activeFocus(session:Session):Promise<TaskFocus|null>{
  const ctx=await localAuthority(this.pool,session,this.clock());requireClient(ctx);
  const row=(await this.pool.query("select *,local_date::text as local_date from companion_local.task_focus_sessions where participant_id=$1 and state in ('active','paused') limit 1",[ctx.participant])).rows[0];
  const result=await this.validFocus(this.pool,ctx.participant,row)?taskFocus(row):null;
  if(canonicalJson(await localAuthority(this.pool,session,this.clock()))!==canonicalJson(ctx))throw new ApiError(403,'scope_changed','Your access changed. Refresh the day.');
  return result;
 }
 async prepare(session:Session,trigger:'open'|'startup'='open'):Promise<DailyPreparation|null>{
  const ctx=await localAuthority(this.pool,session,this.clock());requireClient(ctx);
  const result=await this.quietPreparation(ctx.participant,trigger);
  if(canonicalJson(await localAuthority(this.pool,session,this.clock()))!==canonicalJson(ctx))throw new ApiError(403,'scope_changed','Your access changed. Refresh the day.');
  return result;
 }
 private async quietPreparation(participant:string,trigger:DailyPreparation['trigger']):Promise<DailyPreparation|null>{
  try{return await this.prepareParticipant(participant,trigger);}catch{console.error('Quiet day preparation could not finish; it will retry.');return null;}
 }
 private async prepareParticipant(participant:string,trigger:DailyPreparation['trigger']):Promise<DailyPreparation|null>{
  if(!this.options.dayContext)return null;
  const profile=(await this.pool.query('select time_zone,revision from companion_local.participant_profiles where id=$1',[participant])).rows[0];if(!profile)return null;
  const now=this.clock(),date=dateInZone(now,profile.time_zone);
  const old=(await this.pool.query('select *,local_date::text as local_date from companion_local.daily_preparations where participant_id=$1 and local_date=$2',[participant,date])).rows[0];if(old)return preparation(old);
  const time=new Intl.DateTimeFormat('en-CA',{timeZone:profile.time_zone,hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).format(now);
  if(time<dailyRhythm.morning_start)return null;
  if(!(await this.pool.query(`select 1 from companion_local.role_grants g join companion_local.accounts a on a.id=g.actor_id where g.participant_id=$1 and g.role='client' and g.revoked_at is null and a.disabled_at is null limit 1`,[participant])).rows.length)return null;
  // The loader is outside a held transaction: it reuses the care service's
  // authorized internal read path, and cannot deadlock a single-connection pool.
  const facts=await this.options.dayContext(participant,date),context=dailyContext(facts,this.clock());
  if(facts.profile?.id!==participant||facts.profile.time_zone!==profile.time_zone||!context.facts_are_current_day||context.local_date!==date)return null;
  currentNutritionReference();
  await this.pool.query("select id,revision from companion_local.significant_handoffs where participant_id=$1 and status='active' order by occurred_at,id limit 20",[participant]);
  return localTransaction(this.pool,async db=>{
   const current=(await db.query('select time_zone,revision from companion_local.participant_profiles where id=$1 for update',[participant])).rows[0];
   if(!current||current.time_zone!==profile.time_zone||current.revision!==facts.profile!.revision||dateInZone(this.clock(),current.time_zone)!==date)return null;
   const permitted=(await db.query(`select g.id from companion_local.role_grants g join companion_local.accounts a on a.id=g.actor_id where g.participant_id=$1 and g.role='client' and g.revoked_at is null and a.disabled_at is null for share of g,a`,[participant])).rows.length>0;if(!permitted)return null;
   const inserted=(await db.query(`insert into companion_local.daily_preparations(participant_id,local_date,prepared_at,context_version,trigger,source_revisions,status)
    values($1,$2,$3,'daily-context-v1',$4,$5,'prepared') on conflict(participant_id,local_date) do nothing returning *,local_date::text as local_date`,
    [participant,date,this.clock(),trigger,JSON.stringify({profile:facts.profile!.revision,checkin:facts.checkin?.revision??0})])).rows[0];
   return preparation(inserted??(await db.query('select *,local_date::text as local_date from companion_local.daily_preparations where participant_id=$1 and local_date=$2',[participant,date])).rows[0]);
  });
 }
 private async carryovers(db:LocalDb,ctx:LocalAuthority,before:string):Promise<{items:CarryoverItem[];history:CarryoverHistoryItem[];truncated:boolean;nextBefore:string|null}>{
  const days=(await db.query(`select c.local_date::text,a.plan from companion_local.daily_checkins c
   join companion_local.accepted_day_plan_versions a on a.checkin_id=c.id and a.version=c.accepted_version
   where c.participant_id=$1 and c.local_date<$2 order by c.local_date desc limit 32`,[ctx.participant,before])).rows;
   const page=days.slice(0,31),oldest=page.at(-1)?.local_date;
   if(!oldest)return {items:[],history:[],truncated:false,nextBefore:null};
   const pageTaskIds=[...new Set(page.flatMap(day=>(day.plan.tasks as Task[]).map(task=>task.id)))];
   const pageActivityIds=page.flatMap(day=>(day.plan.tasks as Task[]).map(task=>activityId(ctx.participant,day.local_date,'task',task.id)));
   if(!pageActivityIds.length)return {items:[],history:[],truncated:days.length>31,nextBefore:days.length>31?oldest:null};
   const saved=(await db.query(`select id,status,revision,scheduled_at from companion_local.activity_records where participant_id=$1 and kind='task' and id=any($2::uuid[])`,[ctx.participant,pageActivityIds])).rows;
  const savedById=new Map(saved.map(r=>[r.id,r]));
   const decisions=(await db.query(`select distinct on (d.source_activity_id,d.source_plan_id) d.source_activity_id,d.source_plan_id,d.source_date::text as source_date,d.target_date::text as target_date,d.decision,d.note,d.created_at,d.proposal_id,t.title as task_title,exists(select 1 from companion_local.accepted_day_plan_versions a where a.participant_id=d.participant_id and a.proposal_id=d.proposal_id) as accepted
     from companion_local.carryover_decisions d join companion_local.task_definitions t on t.id=d.source_task_id where d.participant_id=$1 and d.source_activity_id=any($2::uuid[])
     order by d.source_activity_id,d.source_plan_id,d.created_at desc,d.id desc`,[ctx.participant,pageActivityIds])).rows;
   const latest=new Map<string,any>();for(const d of decisions)latest.set(`${d.source_activity_id}:${d.source_plan_id}`,d);
   const later=(await db.query(`select task.value->>'id' as task_id,max(c.local_date)::text as latest_date from companion_local.daily_checkins c
     join companion_local.accepted_day_plan_versions a on a.checkin_id=c.id and a.version=c.accepted_version
     cross join lateral jsonb_array_elements(a.plan->'tasks') as task(value)
     where c.participant_id=$1 and c.local_date<$2 and task.value->>'id'=any($3::text[]) group by task.value->>'id'`,[ctx.participant,dateInZone(this.clock(),ctx.zone),pageTaskIds])).rows;
   const latestDay=new Map<string,string>(later.map(r=>[r.task_id,r.latest_date]));
   const current=dateInZone(this.clock(),ctx.zone),items:CarryoverItem[]=[],history:CarryoverHistoryItem[]=decisions.map(d=>({source_date:String(d.source_date).slice(0,10),source_plan_id:d.source_plan_id,activity_id:d.source_activity_id,task_title:d.task_title,decision:d.decision,note:d.note,target_date:String(d.target_date).slice(0,10),created_at:iso(d.created_at),proposal_id:d.proposal_id,accepted:d.accepted}));
   for(const day of page)for(const task of day.plan.tasks as Task[]){
    const id=activityId(ctx.participant,day.local_date,'task',task.id),record=savedById.get(id);
    const currentDecision=latest.get(`${id}:${day.plan.id}`);
    if(latestDay.get(task.id)!==day.local_date)continue;
   if(record?.status==='completed'||record?.status==='voided')continue;
   if(record?.scheduled_at&&dateInZone(new Date(record.scheduled_at),ctx.zone)>=current)continue;
    if(currentDecision&&(currentDecision.accepted||['cancel','help'].includes(currentDecision.decision)))continue;
    items.push({source_date:day.local_date,source_plan_id:day.plan.id,activity_id:id,revision:record?.revision??0,task,decision:currentDecision?.decision??null,note:currentDecision?.note??'',proposal_id:currentDecision?.proposal_id??null,accepted:false});
  }
   return {items,history,truncated:days.length>31,nextBefore:days.length>31?oldest:null};
 }
 async workspace(session:Session,before?:string):Promise<LocalDayWorkspace>{
  const ctx=await localAuthority(this.pool,session,this.clock());requireClient(ctx);
  const prepared=await this.prepare(session);
  const day=dateInZone(this.clock(),ctx.zone);if(before)activityDate.parse(before);
  const carry=await this.carryovers(this.pool,ctx,before&&before<day?before:day);
  const pref=preferences((await this.pool.query('select * from companion_local.prompt_preferences where participant_id=$1',[ctx.participant])).rows[0]);
  const intake_timing=await readIntakeTiming(this.pool,ctx.participant);
  const routine=(await this.pool.query('select revision,selections from companion_local.routine_choices where participant_id=$1',[ctx.participant])).rows[0]??null;
  const weekday=new Date(`${day}T12:00:00Z`).getUTCDay();
  const tasks=(await this.pool.query('select id from companion_local.task_definitions where participant_id=$1 and active',[ctx.participant])).rows;
  const meals=(await this.pool.query('select id,slots from companion_local.meal_options where participant_id=$1 and active',[ctx.participant])).rows;
  const proposed=routine?.selections.weekdays.includes(weekday)?routine.selections:{task_ids:[],meals:[]};
  const dayRevision=(await this.pool.query('select revision from companion_local.daily_checkins where participant_id=$1 and local_date=$2',[ctx.participant,day])).rows[0]?.revision??0;
  const prompts=(await this.pool.query(`select id,message,due_at,expires_at,state,response_revision,response,snoozed_until from companion_local.prompt_jobs where participant_id=$1 and due_at>$2::timestamptz-interval '2 days' order by due_at desc limit 30`,[ctx.participant,this.clock()])).rows.map(r=>({...r,due_at:iso(r.due_at),expires_at:iso(r.expires_at),snoozed_until:nullableIso(r.snoozed_until)}));
  const handoffs=(await this.pool.query("select * from companion_local.significant_handoffs where participant_id=$1 and status='active' order by occurred_at,id limit 20",[ctx.participant])).rows.map(handoff);
  const handoff_history=(await this.pool.query("select * from companion_local.significant_handoffs where participant_id=$1 and status='resolved' order by resolved_at desc,id limit 20",[ctx.participant])).rows.map(handoff);
  const focus=await this.activeFocus(session),focus_options=await focusOptions(this.pool,ctx.participant,day,this.clock());
  if(canonicalJson(await localAuthority(this.pool,session,this.clock()))!==canonicalJson(ctx))throw new ApiError(403,'scope_changed','Your access changed. Refresh the day.');
   return {local_date:day,time_zone:ctx.zone,day_revision:dayRevision,carryover:carry.items,carryover_history:carry.history,history_truncated:carry.truncated,next_carryover_before:carry.nextBefore,preferences:pref,intake_timing,routine,prompts,preparation:prepared,handoffs,handoff_history,focus,focus_options,
   routine_suggestions:{task_ids:proposed.task_ids.filter((id:string)=>tasks.some(t=>t.id===id)),meals:proposed.meals.filter((m:{slot:MealSlot;option_id:string})=>meals.some(o=>o.id===m.option_id&&o.slots.includes(m.slot)))}};
 }
 async receipt(session:Session,key:string):Promise<LocalDayReceipt|null>{
  const ctx=await localAuthority(this.pool,session,this.clock());requireClient(ctx);
  const receipt=(await this.pool.query("select result from companion_local.append_only_mutations where participant_id=$1 and actor_id=$2 and command_id=$3 and event_type like 'LocalDay%'",[ctx.participant,ctx.actor,key])).rows[0]?.result??null;
  if(canonicalJson(await localAuthority(this.pool,session,this.clock()))!==canonicalJson(ctx))throw new ApiError(403,'scope_changed','Your access changed. Refresh the day.');
  return receipt;
 }
 async command(session:Session,input:LocalDayCommand):Promise<LocalDayReceipt>{
  return this.executeCommand(session,input,false);
 }
 async commitHeldHandoff(session:Session,input:LocalDayCommand):Promise<LocalDayReceipt>{
  if(!retainedLocalDayCommandTypes.includes(input.type))throw new ApiError(400,'invalid_input','Choose a reviewed day change.');
  return this.executeCommand(session,input,true);
 }
 private async executeCommand(session:Session,input:LocalDayCommand,requireHeldHandoff:boolean):Promise<LocalDayReceipt>{
  const command=localDayCommandSchema.parse(input);
  return localTransaction(this.pool,async db=>{
   const ctx=await localAuthority(db,session,this.clock(),true);requireClient(ctx);await lockParticipant(db,ctx);
   const prior=await previousLocalCommand(db,ctx,command.idempotency_key,command,'LocalDay');if(prior)return prior;
   if(requireHeldHandoff){const held=(await db.query('select command_id,command,grant_fingerprint from companion_local.pending_handoff_commands where participant_id=$1 and actor_id=$2 for update',[ctx.participant,ctx.actor])).rows[0];
    if(!held||held.command_id!==command.idempotency_key||held.grant_fingerprint!==ctx.grant||canonicalJson(held.command)!==canonicalJson(command))conflict('This day-change confirmation is no longer current. Review it again.');}
   const today=dateInZone(this.clock(),ctx.zone);let revision=0,proposal:Plan|null=null,handoffId:string|undefined,handoffChange:unknown,focusId:string|undefined,focusChange:unknown,intakeTiming:IntakeTiming|undefined;
   if(command.type==='add_client_task'){
    if(ctx.profileRevision!==command.expected_profile_revision)conflict('Your task choices changed. Review the new task again.');
    if(command.scheduled_time&&!localDateTimeWithOffset(command.scheduled_date+'T'+command.scheduled_time,ctx.zone).ok)throw new ApiError(400,'invalid_input','That local time is ambiguous or unavailable. Choose a clear time.');
    revision=ctx.profileRevision+1;
    await db.query("insert into companion_local.task_definitions(participant_id,title,time_hint,urgency,scheduled_date,scheduled_time,category,duration_minutes,setup_revision) values($1,$2,null,$3,$4,$5,'task',$6,$7)",[ctx.participant,command.title,command.urgency,command.scheduled_date,command.scheduled_time,command.duration_minutes,revision]);
    await db.query('update companion_local.participant_profiles set revision=$2,updated_at=$3 where id=$1',[ctx.participant,revision,this.clock()]);
   }else if(command.type==='add_local_appointment'){
    await db.query('insert into companion_local.appointments(participant_id,title,starts_at,created_by) values($1,$2,$3,$4)',[ctx.participant,command.title,command.starts_at,ctx.actor]);revision=1;
   }else if(command.type==='set_intake_timing'){
    const current=await readIntakeTiming(db,ctx.participant);
    if(current.revision!==command.expected_revision)conflict('Food timing choices changed. Review them again.');
    revision=current.revision+1;intakeTiming={...command.preferences,revision};
   }else if(command.type==='start_task_focus'||command.type==='pause_task_focus'||command.type==='resume_task_focus'||command.type==='finish_task_focus'){
    const now=this.clock();
    const previous=(await db.query("select *,local_date::text as local_date from companion_local.task_focus_sessions where participant_id=$1 and state in ('active','paused') limit 1 for update",[ctx.participant])).rows[0];
    const valid=await this.validFocus(db,ctx.participant,previous);
    if(command.type==='start_task_focus'){
     if(previous&&valid)conflict('Finish the current focus session before starting another task.');
     const target=(await focusOptions(db,ctx.participant,today,now)).find(option=>option.activity_id===command.activity_id);
     if(!target||target.activity_revision!==command.expected_activity_revision||target.source_version!==command.expected_activity_version)conflict('This task changed. Review its current occurrence before starting.');
     const pref=preferences((await db.query("select p.* from companion_local.prompt_preferences p where p.participant_id=$1 and exists(select 1 from companion_local.role_grants g join companion_local.accounts a on a.id=g.actor_id where g.participant_id=p.participant_id and g.actor_id=p.consent_actor and g.role='client' and g.revoked_at is null and a.disabled_at is null)",[ctx.participant])).rows[0]);
     if(!pref.enabled)conflict('Enable your reminder choices before agreeing to a focus check-in.');
     if(previous)await db.query("update companion_local.task_focus_sessions set state='finished',revision=revision+1,finished_at=$2,end_reason='activity_changed',updated_by=$3,updated_at=$2 where id=$1",[previous.id,now,ctx.actor]);
     focusId=randomUUID();revision=1;
     await db.query(`insert into companion_local.task_focus_sessions(id,participant_id,activity_id,task_id,title,local_date,activity_revision,source_version,state,revision,interval_minutes,started_at,last_started_at,check_due_at,source_actor_id,updated_by,updated_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,'active',1,$9,$10,$10,$11,$12,$12,$10)`,[focusId,ctx.participant,target.activity_id,target.task_id,target.title,today,target.activity_revision,target.source_version,command.interval_minutes,now,new Date(now.getTime()+command.interval_minutes*60000),ctx.actor]);
    }else{
     if(!previous||previous.id!==command.focus_id||previous.revision!==command.expected_revision)conflict('This focus session changed. Review it again.');
     if(command.type!=='finish_task_focus'&&!valid)conflict('The task changed or was reported complete. Review its current activity first.');
     if(command.type==='pause_task_focus'&&previous.state!=='active'||command.type==='resume_task_focus'&&previous.state!=='paused')conflict('Choose an action for the current focus state.');
     focusId=previous.id;revision=previous.revision+1;
     if(command.type==='resume_task_focus'){
      const pref=preferences((await db.query("select p.* from companion_local.prompt_preferences p where p.participant_id=$1 and exists(select 1 from companion_local.role_grants g join companion_local.accounts a on a.id=g.actor_id where g.participant_id=p.participant_id and g.actor_id=p.consent_actor and g.role='client' and g.revoked_at is null and a.disabled_at is null)",[ctx.participant])).rows[0]);if(!pref.enabled)conflict('Enable your reminder choices before resuming a focus check-in.');
      await db.query("update companion_local.task_focus_sessions set state='active',revision=$2,interval_minutes=$3,last_started_at=$4,paused_at=null,check_due_at=$5,updated_by=$6,updated_at=$4 where id=$1",[focusId,revision,command.interval_minutes,now,new Date(now.getTime()+command.interval_minutes*60000),ctx.actor]);
     }else await db.query("update companion_local.task_focus_sessions set state=$2,revision=$3,paused_at=$4,finished_at=$5,end_reason=$6,updated_by=$7,updated_at=$8 where id=$1",[focusId,command.type==='pause_task_focus'?'paused':'finished',revision,command.type==='pause_task_focus'?now:previous.paused_at,command.type==='finish_task_focus'?now:null,command.type==='finish_task_focus'?'client_finished':null,ctx.actor,now]);
    }
    const saved=(await db.query('select *,local_date::text as local_date from companion_local.task_focus_sessions where id=$1',[focusId])).rows[0];focusChange={before:previous?taskFocus(previous):null,after:taskFocus(saved)};
    await this.reconcilePrompts(ctx.participant,undefined,db);
   }else if(command.type==='respond_prompt'){
    await this.reconcilePrompts(ctx.participant,command.prompt_id,db);
    const prompt=(await db.query('select * from companion_local.prompt_jobs where participant_id=$1 and id=$2 for update',[ctx.participant,command.prompt_id])).rows[0];
    const pref=preferences((await db.query('select * from companion_local.prompt_preferences where participant_id=$1',[ctx.participant])).rows[0]);
    if(!pref.enabled||!prompt||prompt.preference_revision!==pref.revision||prompt.response_revision!==command.expected_revision||!['pending','claimed','delivered'].includes(prompt.state)||prompt.response==='declined'||new Date(prompt.expires_at)<=this.clock())conflict('This reminder changed. Review it again.');
    revision=prompt.response_revision+1;
    if(command.decision==='snooze'){
     if(command.snooze_minutes===null)throw new ApiError(400,'invalid_input','Choose how many minutes to wait.');
     const due=new Date(this.clock().getTime()+command.snooze_minutes*60000);
     if(dateInZone(due,ctx.zone)!==today||isQuiet(due,ctx.zone,pref.quiet_start,pref.quiet_end))conflict('Choose a time today outside your quiet hours.');
     await db.query("update companion_local.prompt_jobs set state='pending',response='snoozed',response_revision=$2,snoozed_until=$3,due_at=$3,expires_at=$4,claim_token=null,claimed_at=null,claimed_by=null,delivery_uncertain=false where id=$1",[prompt.id,revision,due,new Date(due.getTime()+600000)]);
    }else{
     if(command.snooze_minutes!==null)throw new ApiError(400,'invalid_input','Declining does not need a delay.');
     await db.query("update companion_local.prompt_jobs set state='cancelled',response='declined',response_revision=$2,claim_token=null,claimed_at=null,claimed_by=null where id=$1",[prompt.id,revision]);
    }
    await this.promptEvent(db,ctx.participant,prompt.id,command.decision==='snooze'?'snoozed':'declined',ctx.actor,{revision,minutes:command.snooze_minutes});
   }else if(command.type==='record_significant_handoff'||command.type==='correct_significant_handoff'||command.type==='review_significant_handoff'){
    const previous=command.type==='record_significant_handoff'?null:(await db.query('select * from companion_local.significant_handoffs where participant_id=$1 and id=$2 for update',[ctx.participant,command.handoff_id])).rows[0];
    if(command.type!=='record_significant_handoff'&&(!previous||previous.revision!==command.expected_revision))conflict('This note changed. Review it again before saving.');
    if('occurred_at' in command&&Date.parse(command.occurred_at)>this.clock().getTime()+60_000)throw new ApiError(400,'invalid_occurrence_time','Use the time this actually happened, not a future time.');
    if(command.type==='record_significant_handoff'||command.type==='review_significant_handoff'&&command.decision==='still_relevant'&&previous.status==='resolved'){
     const active=(await db.query("select count(*)::int as count from companion_local.significant_handoffs where participant_id=$1 and status='active'",[ctx.participant])).rows[0].count;
     if(active>=20)conflict('Review existing carry-forward notes before adding another.');
    }
    handoffId=previous?.id??randomUUID();revision=(previous?.revision??0)+1;const now=this.clock();
    if(command.type==='record_significant_handoff')await db.query(`insert into companion_local.significant_handoffs(id,participant_id,summary,occurred_at,source_actor_id,recorded_at,revision,status,updated_at,updated_by)
     values($1,$2,$3,$4,$5,$6,$7,'active',$6,$5)`,[handoffId,ctx.participant,command.summary,command.occurred_at,ctx.actor,now,revision]);
    else if(command.type==='correct_significant_handoff')await db.query(`update companion_local.significant_handoffs set summary=$3,occurred_at=$4,revision=$5,reviewed_at=null,reviewed_by=null,updated_at=$6,updated_by=$7 where participant_id=$1 and id=$2`,[ctx.participant,handoffId,command.summary,command.occurred_at,revision,now,ctx.actor]);
    else await db.query(`update companion_local.significant_handoffs set status=$3,revision=$4,reviewed_at=$5,reviewed_by=$6,resolved_at=$7,resolution_note=$8,updated_at=$5,updated_by=$6 where participant_id=$1 and id=$2`,
     [ctx.participant,handoffId,command.decision==='resolved'?'resolved':'active',revision,now,ctx.actor,command.decision==='resolved'?now:null,command.note]);
    const saved=(await db.query('select * from companion_local.significant_handoffs where participant_id=$1 and id=$2',[ctx.participant,handoffId])).rows[0];
    handoffChange={before:previous?handoff(previous):null,after:handoff(saved),...('reason' in command?{correction_reason:command.reason}:{})};
   }else if(command.type==='set_prompt_preferences'){
    const existing=(await db.query('select revision from companion_local.prompt_preferences where participant_id=$1',[ctx.participant])).rows[0];
    if((existing?.revision??0)!==command.expected_revision)conflict('Reminder choices changed. Review them again.');
    const p=command.preferences;revision=command.expected_revision+1;
    await db.query(`insert into companion_local.prompt_preferences(participant_id,revision,enabled,meal_times,appointment_lead_minutes,quiet_start,quiet_end,foreground_speech,browser_notifications,consent_actor,food_check_ins)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(participant_id) do update set revision=excluded.revision,enabled=excluded.enabled,meal_times=excluded.meal_times,
      appointment_lead_minutes=excluded.appointment_lead_minutes,quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,foreground_speech=excluded.foreground_speech,browser_notifications=excluded.browser_notifications,consent_actor=excluded.consent_actor,food_check_ins=excluded.food_check_ins,updated_at=now()`,
      [ctx.participant,revision,p.enabled,JSON.stringify(p.meal_times),p.appointment_lead_minutes,p.quiet_start,p.quiet_end,p.foreground_speech,p.browser_notifications,ctx.actor,p.food_check_ins??false]);
    // Editing enabled preferences must not erase an explicitly requested snooze.
    // Revalidate its source against the new preferences at delivery, and never
    // replay a claim whose previous delivery outcome could be uncertain.
    if(p.enabled){const carried=(await db.query(`update companion_local.prompt_jobs set preference_revision=$2,state='pending',delivery_uncertain=delivery_uncertain or state='claimed',claim_token=null,claimed_at=null,claimed_by=null
      where participant_id=$1 and response='snoozed' and state in ('pending','claimed') returning id`,[ctx.participant,revision])).rows;
     for(const job of carried)await this.promptEvent(db,ctx.participant,job.id,'snooze_preferences_refreshed',ctx.actor,{from_revision:command.expected_revision,to_revision:revision});}
    await db.query("update companion_local.prompt_jobs set state='cancelled' where participant_id=$1 and preference_revision<>$2 and state in ('pending','claimed')",[ctx.participant,revision]);
   }else if(command.type==='set_routine_choices'){
    const existing=(await db.query('select revision from companion_local.routine_choices where participant_id=$1',[ctx.participant])).rows[0];
    if((existing?.revision??0)!==command.expected_revision)conflict('Your repeat-day choices changed. Review them again.');
    for(const id of command.selections.task_ids)if(!(await db.query('select 1 from companion_local.task_definitions where id=$1 and participant_id=$2 and active',[id,ctx.participant])).rows.length)throw new ApiError(400,'invalid_input','Choose a current task.');
    for(const m of command.selections.meals)if(!(await db.query('select 1 from companion_local.meal_options where id=$1 and participant_id=$2 and active and $3=any(slots)',[m.option_id,ctx.participant,m.slot])).rows.length)throw new ApiError(400,'invalid_input','Choose a current meal.');
    revision=command.expected_revision+1;
    await db.query(`insert into companion_local.routine_choices(participant_id,revision,selections,updated_by) values($1,$2,$3,$4)
     on conflict(participant_id) do update set revision=excluded.revision,selections=excluded.selections,updated_by=excluded.updated_by,updated_at=now()`,[ctx.participant,revision,JSON.stringify(command.selections),ctx.actor]);
   }else{
    if(command.target_date!==today||command.source_date>=today)conflict('Review unfinished work for the current day.');
    const sourceEnd=new Date(`${command.source_date}T12:00:00Z`);sourceEnd.setUTCDate(sourceEnd.getUTCDate()+1);
    const item=(await this.carryovers(db,ctx,sourceEnd.toISOString().slice(0,10))).items.find(i=>i.activity_id===command.source_activity_id&&i.source_date===command.source_date);
    if(!item||item.revision!==command.source_revision||item.source_plan_id!==command.source_plan_id)conflict('This activity changed or was already resolved. Review its history.');
    if(command.decision==='help'&&!command.note)throw new ApiError(400,'invalid_input','Say what help would be useful.');
    revision=command.expected_day_revision;
    if(['keep','reschedule'].includes(command.decision)){
     const check=(await db.query(`select c.*,p.plan as proposal,a.plan as accepted from companion_local.daily_checkins c
      left join companion_local.day_plan_proposals p on p.id=c.current_proposal_id
      left join companion_local.accepted_day_plan_versions a on a.checkin_id=c.id and a.version=c.accepted_version where c.participant_id=$1 and c.local_date=$2 for update of c`,[ctx.participant,today])).rows[0];
     if(!check||check.revision!==command.expected_day_revision)conflict('Start today’s plan and review its latest version first.');
     const base=check.proposal??check.accepted;
     if(!base||base.meals.length!==3)conflict('Choose today’s meals before adding this task to the plan.');
     if(!(await db.query('select 1 from companion_local.task_definitions where id=$1 and participant_id=$2 and active',[item.task.id,ctx.participant])).rows.length)conflict('This task is no longer an active choice.');
     if((await db.query("select 1 from companion_local.task_requests where participant_id=$1 and task_id=$2 and status='accepted'",[ctx.participant,item.task.id])).rows.length)conflict('Reschedule this accepted request in Activity so capacity can be checked.');
     if(command.scheduled_time){const time=localDateTimeWithOffset(`${today}T${command.scheduled_time}`,ctx.zone);if(!time.ok||Date.parse(time.value)<this.clock().getTime())conflict('Choose a clear future time today, or leave the task unscheduled.');}
     const task={...item.task,scheduled_date:today,scheduled_time:command.scheduled_time,urgency:command.urgency,duration_minutes:command.duration_minutes};
     const tasks=[...base.tasks.filter((t:Task)=>t.id!==task.id),task];if(tasks.length>20)conflict('Review today’s workload before adding another task.');
     revision=check.revision+1;proposal={id:randomUUID(),task_ids:tasks.map((t:Task)=>t.id),tasks,meals:base.meals,created_at:this.clock().toISOString()};
     await db.query('insert into companion_local.day_plan_proposals(id,checkin_id,participant_id,setup_revision,checkin_revision,plan) values($1,$2,$3,$4,$5,$6)',[proposal.id,check.id,ctx.participant,ctx.profileRevision,revision,JSON.stringify(proposal)]);
     await db.query('update companion_local.daily_checkins set revision=$2,current_proposal_id=$3,updated_at=now() where id=$1',[check.id,revision,proposal.id]);
    }
     await db.query(`insert into companion_local.carryover_decisions(id,participant_id,source_date,source_activity_id,source_task_id,source_plan_id,target_date,decision,source_revision,proposal_id,note,actor_id,command_id,created_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[randomUUID(),ctx.participant,command.source_date,item.activity_id,item.task.id,item.source_plan_id,today,command.decision,item.revision,proposal?.id??null,command.note,ctx.actor,command.idempotency_key,this.clock()]);
   }
   const result:LocalDayReceipt={command_id:command.idempotency_key,type:command.type,revision,result:proposal?'proposed':'saved',proposal,...(handoffId?{handoff_id:handoffId}:{}),...(focusId?{focus_id:focusId}:{}),...(intakeTiming?{intake_timing:intakeTiming}:{}),replayed:false};
   await saveLocalCommand(db,ctx,command,result,'LocalDay'+command.type,today,{type:command.type,revision,proposal_id:proposal?.id??null,...(handoffChange?{handoff:handoffChange}:{}),...(focusChange?{focus:focusChange}:{})});return result;
  });
 }
 /** A bounded, restart-safe local scheduler. It never invokes a model or microphone. */
 async tick(trigger:'scheduler'|'startup'='scheduler'):Promise<void>{
  const people=await localTransaction(this.pool,async db=>{
   await db.query('insert into companion_local.prompt_scheduler_cursor(id) values(true) on conflict(id) do nothing');
   const cursor=(await db.query('select last_participant_id from companion_local.prompt_scheduler_cursor where id=true for update')).rows[0];
   const selected=(await db.query(`select p.id as participant_id from companion_local.participant_profiles p where exists(select 1 from companion_local.prompt_preferences r where r.participant_id=p.id and r.enabled)
     or ($3::boolean and exists(select 1 from companion_local.role_grants g join companion_local.accounts a on a.id=g.actor_id where g.participant_id=p.id and g.role='client' and g.revoked_at is null and a.disabled_at is null))
     order by (p.id <= coalesce($1::uuid,'00000000-0000-0000-0000-000000000000'::uuid)),p.id limit $2`,
     [cursor?.last_participant_id??null,LocalDayService.participantsPerTick,!!this.options.dayContext])).rows;
   if(selected.length)await db.query('update companion_local.prompt_scheduler_cursor set last_participant_id=$1 where id=true',[selected.at(-1).participant_id]);
   return selected;
  });
  for(const person of people){await this.quietPreparation(person.participant_id,trigger);await this.reconcilePrompts(person.participant_id);}
 }
 private async reconcilePrompts(participant:string,focusJobId?:string,existingDb?:LocalDb){
  const reconcile=async(db:LocalDb)=>{
   const profile=(await db.query('select time_zone from companion_local.participant_profiles where id=$1 for update',[participant])).rows[0];if(!profile)return;
   const row=(await db.query('select * from companion_local.prompt_preferences where participant_id=$1',[participant])).rows[0];if(!row)return;
   const permitted=(await db.query(`select 1 from companion_local.role_grants g join companion_local.accounts a on a.id=g.actor_id where g.participant_id=$1 and g.actor_id=$2 and g.role='client' and g.revoked_at is null and a.disabled_at is null`,[participant,row.consent_actor])).rows.length>0;
   const now=this.clock(),p=preferences(row),day=dateInZone(now,profile.time_zone);
   if(!p.enabled||!permitted){await db.query("update companion_local.prompt_jobs set state='cancelled' where participant_id=$1 and (state in ('pending','claimed') or id=$2)",[participant,focusJobId??null]);return;}
   const intakes=(await db.query(`select distinct on (intake_kind) id,revision,occurred_at,intake_kind from companion_local.activity_records where participant_id=$1 and kind='meal' and status='completed' and occurred_at<=$2 order by intake_kind,occurred_at desc,id limit 3`,[participant,now])).rows as IntakePromptFact[];
   const desired:PromptSource[]=[];
   const timing=await readIntakeTiming(db,participant);
   const food=p.food_check_ins?foodCheckSource(now,profile.time_zone,intakes,timing):null;if(food)desired.push(food);
   const focus=(await db.query("select *,local_date::text as local_date from companion_local.task_focus_sessions where participant_id=$1 and state='active' limit 1",[participant])).rows[0];
   if(focus&&await this.validFocus(db,participant,focus)){
    const stillPermitted=(await db.query("select 1 from companion_local.role_grants g join companion_local.accounts a on a.id=g.actor_id where g.participant_id=$1 and g.actor_id=$2 and g.role='client' and g.revoked_at is null and a.disabled_at is null",[participant,focus.source_actor_id])).rows.length;
    if(stillPermitted)desired.push({key:`focus:${focus.id}`,version:`${focus.revision}:${iso(focus.check_due_at)}`,due:new Date(focus.check_due_at),text:`You asked for a check-in on ${focus.title}. Are you still working on it, or would a break help?`});
   }
   const accepted=(await db.query(`select a.plan,c.accepted_version from companion_local.daily_checkins c join companion_local.accepted_day_plan_versions a on a.checkin_id=c.id and a.version=c.accepted_version where c.participant_id=$1 and c.local_date=$2`,[participant,day])).rows[0];
   if(accepted)for(const m of accepted.plan.meals as {slot:MealSlot;name:string;option_id:string}[]){
    const time=p.meal_times[m.slot];if(!time)continue;
    const instant=localDateTimeWithOffset(`${day}T${time}`,profile.time_zone);if(!instant.ok)continue;
    // Reaccepting the same food creates a new plan version, not a new meal
    // occurrence. Match the ledger's stable food/slot identity, including rows
    // saved with earlier IDs, so reviewed timing and deferrals survive.
    const actual=(await db.query(`select status,scheduled_at from companion_local.activity_records where participant_id=$1
      and kind='meal' and not unplanned and local_date=$2 and meal_slot=$3 and source_id=$4 and title=$5 order by updated_at desc,id desc limit 1`,[participant,day,m.slot,m.option_id,m.name])).rows[0];
    if(actual?.status==='deferred')continue;
    const due=actual?.scheduled_at?new Date(actual.scheduled_at):new Date(instant.value);
    if(dateInZone(due,profile.time_zone)!==day)continue;
    const already=(await db.query("select 1 from companion_local.activity_records where participant_id=$1 and local_date=$2 and kind='meal' and meal_slot=$3 and status='completed'",[participant,day,m.slot])).rows.length;
    if(!already&&!suppressMealPrompt(new Date(Math.max(+now,+due)),intakes,timing))desired.push({key:`meal:${day}:${m.slot}`,version:`${m.option_id}:${m.name}:${due.toISOString()}`,due,text:`It’s around ${m.slot} time. Your plan has ${m.name}. Would you like to talk about it?`});
   }
   const appointments=await effectiveAppointments(db,participant,{from:new Date(now.getTime()-3*3600000),to:new Date(now.getTime()+24*3600000),limit:LocalDayService.appointmentsPerReconciliation});
   for(const a of appointments)desired.push({key:`appointment:${a.id}`,version:`${iso(a.starts_at)}:${a.title}`,due:new Date(new Date(a.starts_at).getTime()-p.appointment_lead_minutes*60000),text:`You have ${a.title} at ${new Intl.DateTimeFormat('en-CA',{timeZone:profile.time_zone,hour:'numeric',minute:'2-digit'}).format(new Date(a.starts_at))}. Would you like to review your plan?`});
   const jobs=(await db.query(`select * from companion_local.prompt_jobs where participant_id=$1 and (state in ('pending','claimed') or id=$3)
     order by case when id=$3 then 0 when due_at<=$2 and expires_at>$2 then 1 else 2 end,due_at,id limit $4`,
     [participant,now,focusJobId??null,LocalDayService.jobsPerReconciliation])).rows;
   for(const job of jobs){
    let valid=job.preference_revision===p.revision&&desired.some(d=>d.key===job.source_key&&d.version===job.source_version);
    // An appointment beyond this tick's source cap can still own an earlier
    // pending claim. Validate that one source exactly before invalidating it.
    if(!valid&&job.preference_revision===p.revision&&String(job.source_key).startsWith('appointment:')){
     const appointmentId=String(job.source_key).slice('appointment:'.length);
     const exact=(await effectiveAppointments(db,participant,{id:appointmentId,limit:1}))[0];
     valid=!!exact&&job.source_version===`${iso(exact.starts_at)}:${exact.title}`;
    }
    const expired=job.state!=='delivered'&&new Date(job.expires_at).getTime()<now.getTime();
    if(!valid||expired){const state=valid?'missed':'cancelled';await db.query('update companion_local.prompt_jobs set state=$2 where id=$1',[job.id,state]);await this.promptEvent(db,participant,job.id,state,null,{});}
     else if(job.state==='claimed'&&job.claimed_at&&new Date(job.claimed_at).getTime()+90_000<now.getTime()){
      await db.query("update companion_local.prompt_jobs set state='pending',claim_token=null,claimed_by=null,claimed_at=null,delivery_uncertain=true where id=$1",[job.id]);
      await this.promptEvent(db,participant,job.id,'delivery_uncertain',null,{reason:'claim_timeout'});
     }
   }
   for(const d of desired){
    // Re-saving consent or reminder preferences must not repeat an already delivered reminder.
    if((await db.query("select 1 from companion_local.prompt_jobs where participant_id=$1 and source_key=$2 and (response='declined' and (source_key not like 'focus:%' or source_version=$3) or source_version=$3 and (state='delivered' or response='snoozed'))",[participant,d.key,d.version])).rows.length)continue;
    const expires=new Date(d.due.getTime()+10*60000),quiet=isQuiet(d.due,profile.time_zone,p.quiet_start,p.quiet_end);
    const state=quiet?'cancelled':expires<now?'missed':'pending';
    const inserted=(await db.query(`insert into companion_local.prompt_jobs(id,participant_id,source_key,source_version,preference_revision,due_at,expires_at,message,state)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(participant_id,source_key,source_version,preference_revision) do nothing returning id`,[randomUUID(),participant,d.key,d.version,p.revision,d.due,expires,d.text,state])).rows[0];
    if(inserted)await this.promptEvent(db,participant,inserted.id,state,null,{quiet});
   }
  };if(existingDb)await reconcile(existingDb);else await localTransaction(this.pool,reconcile);
 }
 private async promptEvent(db:LocalDb,participant:string,id:string,type:string,actor:string|null,data:unknown){await db.query('insert into companion_local.prompt_delivery_events(id,participant_id,prompt_id,event_type,actor_id,data,created_at) values($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),participant,id,type,actor,JSON.stringify(data),this.clock()]);}
 async claimPrompt(session:Session):Promise<PromptItem|null>{
  return localTransaction(this.pool,async db=>{
   const ctx=await localAuthority(db,session,this.clock(),true);requireClient(ctx);await lockParticipant(db,ctx);
   await this.reconcilePrompts(ctx.participant,undefined,db);
   const p=preferences((await db.query('select * from companion_local.prompt_preferences where participant_id=$1',[ctx.participant])).rows[0]);
   if(!p.enabled||isQuiet(this.clock(),ctx.zone,p.quiet_start,p.quiet_end))return null;
   if((await db.query("select 1 from companion_local.prompt_jobs where participant_id=$1 and state='claimed' and expires_at>$2 limit 1",[ctx.participant,this.clock()])).rows.length)return null;
   const job=(await db.query(`select * from companion_local.prompt_jobs where participant_id=$1 and state='pending' and preference_revision=$2 and due_at<=$3 and expires_at>$3 order by due_at,id limit 1 for update`,[ctx.participant,p.revision,this.clock()])).rows[0];if(!job)return null;
   const token=randomUUID();await db.query("update companion_local.prompt_jobs set state='claimed',claimed_by=$2,claim_token=$3,claimed_at=$4 where id=$1",[job.id,ctx.actor,token,this.clock()]);
   await this.promptEvent(db,ctx.participant,job.id,'claimed',ctx.actor,{});
    return {id:job.id,message:job.message,due_at:iso(job.due_at),expires_at:iso(job.expires_at),state:'claimed',claim_token:token,foreground_speech:p.foreground_speech&&!job.delivery_uncertain,browser_notifications:p.browser_notifications&&!job.delivery_uncertain,delivery_uncertain:job.delivery_uncertain,response_revision:job.response_revision,response:job.response,snoozed_until:nullableIso(job.snoozed_until)};
  });
 }
 async currentPrompt(session:Session,id:string):Promise<boolean>{
  const ctx=await localAuthority(this.pool,session,this.clock());requireClient(ctx);await this.reconcilePrompts(ctx.participant,id);
  const row=(await this.pool.query(`select p.quiet_start,p.quiet_end from companion_local.prompt_jobs j join companion_local.prompt_preferences p on p.participant_id=j.participant_id where j.id=$1 and j.participant_id=$2 and j.state in ('claimed','delivered') and j.expires_at>$3 and p.enabled and p.revision=j.preference_revision and j.response is distinct from 'declined'`,[id,ctx.participant,this.clock()])).rows[0];
  if(canonicalJson(await localAuthority(this.pool,session,this.clock()))!==canonicalJson(ctx))throw new ApiError(403,'scope_changed','Your access changed. Refresh the day.');
  return !!row&&!isQuiet(this.clock(),ctx.zone,String(row.quiet_start).slice(0,5),String(row.quiet_end).slice(0,5));
 }
 /** Reopening may recover visible text, but is never another delivery or spoken attempt. */
 async resumePrompt(session:Session):Promise<PromptItem|null>{
  const ctx=await localAuthority(this.pool,session,this.clock());requireClient(ctx);
  const row=(await this.pool.query("select * from companion_local.prompt_jobs where participant_id=$1 and claimed_by=$2 and state='delivered' and response is distinct from 'declined' and expires_at>$3 order by delivered_at desc,id limit 1",[ctx.participant,ctx.actor,this.clock()])).rows[0];
  if(!row||!await this.currentPrompt(session,row.id))return null;
  if(canonicalJson(await localAuthority(this.pool,session,this.clock()))!==canonicalJson(ctx))throw new ApiError(403,'scope_changed','Your access changed. Refresh the day.');
  return {id:row.id,message:row.message,due_at:iso(row.due_at),expires_at:iso(row.expires_at),state:'delivered',restored:true,foreground_speech:false,browser_notifications:false,response_revision:row.response_revision,response:row.response,snoozed_until:nullableIso(row.snoozed_until)};
 }
 async promptText(session:Session,id:string,token:string):Promise<string>{
   const ctx=await localAuthority(this.pool,session,this.clock());requireClient(ctx);await this.reconcilePrompts(ctx.participant,id);
   const row=(await this.pool.query(`select j.message,p.foreground_speech,p.quiet_start,p.quiet_end from companion_local.prompt_jobs j join companion_local.prompt_preferences p on p.participant_id=j.participant_id
     where j.id=$1 and j.participant_id=$2 and j.claimed_by=$3 and j.claim_token=$4 and j.state='claimed' and j.expires_at>$5 and p.enabled and p.revision=j.preference_revision and not j.delivery_uncertain`,[id,ctx.participant,ctx.actor,token,this.clock()])).rows[0];
   if(!row||!row.foreground_speech||isQuiet(this.clock(),ctx.zone,String(row.quiet_start).slice(0,5),String(row.quiet_end).slice(0,5)))throw new ApiError(403,'prompt_unavailable','This spoken reminder is no longer available.');return row.message;
 }
 async beginPromptSpeech(session:Session,id:string,token:string):Promise<string>{
  return localTransaction(this.pool,async db=>{
   const ctx=await localAuthority(db,session,this.clock(),true);requireClient(ctx);await lockParticipant(db,ctx);
   await this.reconcilePrompts(ctx.participant,id,db);
   const row=(await db.query(`select j.message,j.response_revision,p.foreground_speech,p.quiet_start,p.quiet_end from companion_local.prompt_jobs j join companion_local.prompt_preferences p on p.participant_id=j.participant_id
    where j.id=$1 and j.participant_id=$2 and j.claimed_by=$3 and j.claim_token=$4 and j.state='claimed' and j.expires_at>$5 and p.enabled and p.revision=j.preference_revision and not j.delivery_uncertain`,[id,ctx.participant,ctx.actor,token,this.clock()])).rows[0];
   if(!row||!row.foreground_speech||isQuiet(this.clock(),ctx.zone,String(row.quiet_start).slice(0,5),String(row.quiet_end).slice(0,5)))throw new ApiError(403,'prompt_unavailable','This spoken reminder is no longer available.');
   if((await db.query("select 1 from companion_local.prompt_delivery_events where participant_id=$1 and prompt_id=$2 and event_type='speech_dispatch_attempt' and coalesce((data->>'response_revision')::integer,0)=$3",[ctx.participant,id,row.response_revision])).rows.length)throw new ApiError(409,'speech_already_requested','This reminder was already requested. Please use its text on screen.');
   // A crash or lost audio response cannot establish whether it played. Leave
   // a durable marker before synthesis; recovery is text-only, never a replay.
   await this.promptEvent(db,ctx.participant,id,'speech_dispatch_attempt',ctx.actor,{response_revision:row.response_revision});return row.message;
  });
 }
 async acknowledgePrompt(session:Session,id:string,token:string,channel:'in_app'|'speech'|'notification'){
  return localTransaction(this.pool,async db=>{
   const ctx=await localAuthority(db,session,this.clock(),true);requireClient(ctx);await lockParticipant(db,ctx);
   await this.reconcilePrompts(ctx.participant,id,db);
    const row=(await db.query(`select j.*,p.enabled,p.revision as pref_revision,p.foreground_speech,p.browser_notifications,p.quiet_start,p.quiet_end from companion_local.prompt_jobs j join companion_local.prompt_preferences p on p.participant_id=j.participant_id where j.id=$1 and j.participant_id=$2 and j.claimed_by=$3 and j.claim_token=$4 for update of j`,[id,ctx.participant,ctx.actor,token])).rows[0];
   if(!row||!row.enabled||row.preference_revision!==row.pref_revision||!['claimed','delivered'].includes(row.state))conflict('This reminder is no longer current.');
    if(row.state==='claimed'&&isQuiet(this.clock(),ctx.zone,String(row.quiet_start).slice(0,5),String(row.quiet_end).slice(0,5)))conflict('Quiet hours started. Review the reminder later.');
    if(channel==='speech'&&(!row.foreground_speech||row.delivery_uncertain)||channel==='notification'&&(!row.browser_notifications||row.delivery_uncertain))throw new ApiError(403,'forbidden','This reminder channel is not enabled.');
   if(row.state==='delivered')return {ok:true,replayed:true};
   if(new Date(row.expires_at)<this.clock())conflict('This reminder has expired.');
   await db.query("update companion_local.prompt_jobs set state='delivered',delivered_at=$2,channel=$3 where id=$1",[id,this.clock(),channel]);await this.promptEvent(db,ctx.participant,id,'delivered',ctx.actor,{channel});return {ok:true,replayed:false};
  });
 }
}
