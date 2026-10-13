import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Session } from './session.js';
import { ApiError } from './errors.js';
import { dateInZone, type Plan, type Task, type MealSlot } from '../shared/contracts.js';
import { activityDate } from '../shared/activity-contracts.js';
import { activityId } from './activity-ledger.js';
import { localDateTimeWithOffset } from '../shared/local-time.js';
import { localDayCommandSchema, type LocalDayCommand, type LocalDayReceipt, type LocalDayWorkspace, type CarryoverItem, type CarryoverHistoryItem, type PromptPreferences, type PromptItem } from '../shared/local-day-contracts.js';
import { localAuthority, requireClient, lockParticipant, localTransaction, previousLocalCommand, saveLocalCommand, canonicalJson, type LocalDb, type LocalAuthority } from './local-authority.js';

export const defaultPromptPreferences:PromptPreferences={revision:0,enabled:false,meal_times:{breakfast:null,lunch:null,dinner:null},appointment_lead_minutes:30,quiet_start:'21:00',quiet_end:'08:00',foreground_speech:false,browser_notifications:false};
function conflict(message:string):never{throw new ApiError(409,'conflict',message);}
const iso=(value:Date|string)=>new Date(value).toISOString();
function preferences(row:any):PromptPreferences{return row?{revision:row.revision,enabled:row.enabled,meal_times:row.meal_times,appointment_lead_minutes:row.appointment_lead_minutes,
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
 constructor(private pool:Pool,private clock=()=>new Date()){}
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
  const day=dateInZone(this.clock(),ctx.zone);if(before)activityDate.parse(before);
  const carry=await this.carryovers(this.pool,ctx,before&&before<day?before:day);
  const pref=preferences((await this.pool.query('select * from companion_local.prompt_preferences where participant_id=$1',[ctx.participant])).rows[0]);
  const routine=(await this.pool.query('select revision,selections from companion_local.routine_choices where participant_id=$1',[ctx.participant])).rows[0]??null;
  const weekday=new Date(`${day}T12:00:00Z`).getUTCDay();
  const tasks=(await this.pool.query('select id from companion_local.task_definitions where participant_id=$1 and active',[ctx.participant])).rows;
  const meals=(await this.pool.query('select id,slots from companion_local.meal_options where participant_id=$1 and active',[ctx.participant])).rows;
  const proposed=routine?.selections.weekdays.includes(weekday)?routine.selections:{task_ids:[],meals:[]};
  const dayRevision=(await this.pool.query('select revision from companion_local.daily_checkins where participant_id=$1 and local_date=$2',[ctx.participant,day])).rows[0]?.revision??0;
  const prompts=(await this.pool.query(`select id,message,due_at,expires_at,state from companion_local.prompt_jobs where participant_id=$1 and due_at>$2::timestamptz-interval '2 days' order by due_at desc limit 30`,[ctx.participant,this.clock()])).rows.map(r=>({...r,due_at:iso(r.due_at),expires_at:iso(r.expires_at)}));
  if(canonicalJson(await localAuthority(this.pool,session,this.clock()))!==canonicalJson(ctx))throw new ApiError(403,'scope_changed','Your access changed. Refresh the day.');
   return {local_date:day,time_zone:ctx.zone,day_revision:dayRevision,carryover:carry.items,carryover_history:carry.history,history_truncated:carry.truncated,next_carryover_before:carry.nextBefore,preferences:pref,routine,prompts,
   routine_suggestions:{task_ids:proposed.task_ids.filter((id:string)=>tasks.some(t=>t.id===id)),meals:proposed.meals.filter((m:{slot:MealSlot;option_id:string})=>meals.some(o=>o.id===m.option_id&&o.slots.includes(m.slot)))}};
 }
 async receipt(session:Session,key:string):Promise<LocalDayReceipt|null>{
  const ctx=await localAuthority(this.pool,session,this.clock());requireClient(ctx);
  return (await this.pool.query("select result from companion_local.append_only_mutations where participant_id=$1 and actor_id=$2 and command_id=$3 and event_type like 'LocalDay%'",[ctx.participant,ctx.actor,key])).rows[0]?.result??null;
 }
 async command(session:Session,input:LocalDayCommand):Promise<LocalDayReceipt>{
  const command=localDayCommandSchema.parse(input);
  return localTransaction(this.pool,async db=>{
   const ctx=await localAuthority(db,session,this.clock(),true);requireClient(ctx);await lockParticipant(db,ctx);
   const prior=await previousLocalCommand(db,ctx,command.idempotency_key,command,'LocalDay');if(prior)return prior;
   const today=dateInZone(this.clock(),ctx.zone);let revision=0,proposal:Plan|null=null;
   if(command.type==='set_prompt_preferences'){
    const existing=(await db.query('select revision from companion_local.prompt_preferences where participant_id=$1',[ctx.participant])).rows[0];
    if((existing?.revision??0)!==command.expected_revision)conflict('Reminder choices changed. Review them again.');
    const p=command.preferences;revision=command.expected_revision+1;
    await db.query(`insert into companion_local.prompt_preferences(participant_id,revision,enabled,meal_times,appointment_lead_minutes,quiet_start,quiet_end,foreground_speech,browser_notifications,consent_actor)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict(participant_id) do update set revision=excluded.revision,enabled=excluded.enabled,meal_times=excluded.meal_times,
      appointment_lead_minutes=excluded.appointment_lead_minutes,quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,foreground_speech=excluded.foreground_speech,browser_notifications=excluded.browser_notifications,consent_actor=excluded.consent_actor,updated_at=now()`,
      [ctx.participant,revision,p.enabled,JSON.stringify(p.meal_times),p.appointment_lead_minutes,p.quiet_start,p.quiet_end,p.foreground_speech,p.browser_notifications,ctx.actor]);
    await db.query("update companion_local.prompt_jobs set state='cancelled' where participant_id=$1 and state in ('pending','claimed')",[ctx.participant]);
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
   const result:LocalDayReceipt={command_id:command.idempotency_key,type:command.type,revision,result:proposal?'proposed':'saved',proposal,replayed:false};
   await saveLocalCommand(db,ctx,command,result,'LocalDay'+command.type,today,{type:command.type,revision,proposal_id:proposal?.id??null});return result;
  });
 }
 /** A bounded, restart-safe local scheduler. It never invokes a model or microphone. */
 async tick():Promise<void>{
  const people=await localTransaction(this.pool,async db=>{
   await db.query('insert into companion_local.prompt_scheduler_cursor(id) values(true) on conflict(id) do nothing');
   const cursor=(await db.query('select last_participant_id from companion_local.prompt_scheduler_cursor where id=true for update')).rows[0];
   const selected=(await db.query(`select participant_id from companion_local.prompt_preferences where enabled
     order by (participant_id <= coalesce($1::uuid,'00000000-0000-0000-0000-000000000000'::uuid)),participant_id limit $2`,
     [cursor?.last_participant_id??null,LocalDayService.participantsPerTick])).rows;
   if(selected.length)await db.query('update companion_local.prompt_scheduler_cursor set last_participant_id=$1 where id=true',[selected.at(-1).participant_id]);
   return selected;
  });
  for(const person of people)await this.reconcilePrompts(person.participant_id);
 }
 private async reconcilePrompts(participant:string,focusJobId?:string){
  await localTransaction(this.pool,async db=>{
   const profile=(await db.query('select time_zone from companion_local.participant_profiles where id=$1 for update',[participant])).rows[0];if(!profile)return;
   const row=(await db.query('select * from companion_local.prompt_preferences where participant_id=$1',[participant])).rows[0];if(!row)return;
   const permitted=(await db.query(`select 1 from companion_local.role_grants g join companion_local.accounts a on a.id=g.actor_id where g.participant_id=$1 and g.actor_id=$2 and g.role='client' and g.revoked_at is null and a.disabled_at is null`,[participant,row.consent_actor])).rows.length>0;
   const now=this.clock(),p=preferences(row),day=dateInZone(now,profile.time_zone);
   if(!p.enabled||!permitted){await db.query("update companion_local.prompt_jobs set state='cancelled' where participant_id=$1 and state in ('pending','claimed')",[participant]);return;}
   const desired:{key:string;version:string;due:Date;text:string}[]=[];
   const accepted=(await db.query(`select a.plan,c.accepted_version from companion_local.daily_checkins c join companion_local.accepted_day_plan_versions a on a.checkin_id=c.id and a.version=c.accepted_version where c.participant_id=$1 and c.local_date=$2`,[participant,day])).rows[0];
   if(accepted)for(const m of accepted.plan.meals as {slot:MealSlot;name:string;option_id:string}[]){
    const time=p.meal_times[m.slot];if(!time)continue;
    const instant=localDateTimeWithOffset(`${day}T${time}`,profile.time_zone);if(!instant.ok)continue;
    const already=(await db.query("select 1 from companion_local.activity_records where participant_id=$1 and local_date=$2 and kind='meal' and meal_slot=$3 and status='completed'",[participant,day,m.slot])).rows.length;
    if(!already)desired.push({key:`meal:${day}:${m.slot}`,version:`${m.option_id}:${m.name}:${time}`,due:new Date(instant.value),text:`It’s around ${m.slot} time. Your plan has ${m.name}. Would you like to talk about it?`});
   }
   const appointments=(await db.query(`select id,title,starts_at from companion_local.appointments where participant_id=$1 and starts_at>=$2::timestamptz-interval '3 hours' and starts_at<=$2::timestamptz+interval '24 hours' order by starts_at,id limit $3`,[participant,now,LocalDayService.appointmentsPerReconciliation])).rows;
   for(const a of appointments)desired.push({key:`appointment:${a.id}`,version:`${iso(a.starts_at)}:${a.title}`,due:new Date(new Date(a.starts_at).getTime()-p.appointment_lead_minutes*60000),text:`You have ${a.title} at ${new Intl.DateTimeFormat('en-CA',{timeZone:profile.time_zone,hour:'numeric',minute:'2-digit'}).format(new Date(a.starts_at))}. Would you like to review your plan?`});
   const jobs=(await db.query(`select * from companion_local.prompt_jobs where participant_id=$1 and state in ('pending','claimed')
     order by case when id=$3 then 0 when due_at<=$2 and expires_at>$2 then 1 else 2 end,due_at,id limit $4`,
     [participant,now,focusJobId??null,LocalDayService.jobsPerReconciliation])).rows;
   for(const job of jobs){
    let valid=job.preference_revision===p.revision&&desired.some(d=>d.key===job.source_key&&d.version===job.source_version);
    // An appointment beyond this tick's source cap can still own an earlier
    // pending claim. Validate that one source exactly before invalidating it.
    if(!valid&&job.preference_revision===p.revision&&String(job.source_key).startsWith('appointment:')){
     const appointmentId=String(job.source_key).slice('appointment:'.length);
     const exact=(await db.query('select title,starts_at from companion_local.appointments where participant_id=$1 and id=$2',[participant,appointmentId])).rows[0];
     valid=!!exact&&job.source_version===`${iso(exact.starts_at)}:${exact.title}`;
    }
    const expired=new Date(job.expires_at).getTime()<now.getTime();
    if(!valid||expired){const state=valid?'missed':'cancelled';await db.query('update companion_local.prompt_jobs set state=$2 where id=$1',[job.id,state]);await this.promptEvent(db,participant,job.id,state,null,{});}
     else if(job.state==='claimed'&&job.claimed_at&&new Date(job.claimed_at).getTime()+90_000<now.getTime()){
      await db.query("update companion_local.prompt_jobs set state='pending',claim_token=null,claimed_by=null,claimed_at=null,delivery_uncertain=true where id=$1",[job.id]);
      await this.promptEvent(db,participant,job.id,'delivery_uncertain',null,{reason:'claim_timeout'});
     }
   }
   for(const d of desired){
    // Re-saving consent or reminder preferences must not repeat an already delivered reminder.
    if((await db.query("select 1 from companion_local.prompt_jobs where participant_id=$1 and source_key=$2 and source_version=$3 and state='delivered'",[participant,d.key,d.version])).rows.length)continue;
    const expires=new Date(d.due.getTime()+10*60000),quiet=isQuiet(d.due,profile.time_zone,p.quiet_start,p.quiet_end);
    const state=quiet?'cancelled':expires<now?'missed':'pending';
    const inserted=(await db.query(`insert into companion_local.prompt_jobs(id,participant_id,source_key,source_version,preference_revision,due_at,expires_at,message,state)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(participant_id,source_key,source_version,preference_revision) do nothing returning id`,[randomUUID(),participant,d.key,d.version,p.revision,d.due,expires,d.text,state])).rows[0];
    if(inserted)await this.promptEvent(db,participant,inserted.id,state,null,{quiet});
   }
  });
 }
 private async promptEvent(db:LocalDb,participant:string,id:string,type:string,actor:string|null,data:unknown){await db.query('insert into companion_local.prompt_delivery_events(id,participant_id,prompt_id,event_type,actor_id,data,created_at) values($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),participant,id,type,actor,JSON.stringify(data),this.clock()]);}
 async claimPrompt(session:Session):Promise<PromptItem|null>{
  const current=await localAuthority(this.pool,session,this.clock());requireClient(current);await this.reconcilePrompts(current.participant);
  return localTransaction(this.pool,async db=>{
   const ctx=await localAuthority(db,session,this.clock(),true);requireClient(ctx);await lockParticipant(db,ctx);
   const p=preferences((await db.query('select * from companion_local.prompt_preferences where participant_id=$1',[ctx.participant])).rows[0]);
   if(!p.enabled||isQuiet(this.clock(),ctx.zone,p.quiet_start,p.quiet_end))return null;
   const job=(await db.query(`select * from companion_local.prompt_jobs where participant_id=$1 and state='pending' and preference_revision=$2 and due_at<=$3 and expires_at>$3 order by due_at,id limit 1 for update`,[ctx.participant,p.revision,this.clock()])).rows[0];if(!job)return null;
   const token=randomUUID();await db.query("update companion_local.prompt_jobs set state='claimed',claimed_by=$2,claim_token=$3,claimed_at=$4 where id=$1",[job.id,ctx.actor,token,this.clock()]);
   await this.promptEvent(db,ctx.participant,job.id,'claimed',ctx.actor,{});
    return {id:job.id,message:job.message,due_at:iso(job.due_at),expires_at:iso(job.expires_at),state:'claimed',claim_token:token,foreground_speech:p.foreground_speech&&!job.delivery_uncertain,browser_notifications:p.browser_notifications&&!job.delivery_uncertain,delivery_uncertain:job.delivery_uncertain};
  });
 }
 async promptText(session:Session,id:string,token:string):Promise<string>{
   const ctx=await localAuthority(this.pool,session,this.clock());requireClient(ctx);await this.reconcilePrompts(ctx.participant,id);
   const row=(await this.pool.query(`select j.message,p.foreground_speech,p.quiet_start,p.quiet_end from companion_local.prompt_jobs j join companion_local.prompt_preferences p on p.participant_id=j.participant_id
     where j.id=$1 and j.participant_id=$2 and j.claimed_by=$3 and j.claim_token=$4 and j.state='claimed' and j.expires_at>$5 and p.enabled and p.revision=j.preference_revision and not j.delivery_uncertain`,[id,ctx.participant,ctx.actor,token,this.clock()])).rows[0];
   if(!row||!row.foreground_speech||isQuiet(this.clock(),ctx.zone,String(row.quiet_start).slice(0,5),String(row.quiet_end).slice(0,5)))throw new ApiError(403,'prompt_unavailable','This spoken reminder is no longer available.');return row.message;
 }
 async beginPromptSpeech(session:Session,id:string,token:string):Promise<string>{
  const current=await localAuthority(this.pool,session,this.clock());requireClient(current);await this.reconcilePrompts(current.participant,id);
  return localTransaction(this.pool,async db=>{
   const ctx=await localAuthority(db,session,this.clock(),true);requireClient(ctx);await lockParticipant(db,ctx);
   const row=(await db.query(`select j.message,p.foreground_speech,p.quiet_start,p.quiet_end from companion_local.prompt_jobs j join companion_local.prompt_preferences p on p.participant_id=j.participant_id
    where j.id=$1 and j.participant_id=$2 and j.claimed_by=$3 and j.claim_token=$4 and j.state='claimed' and j.expires_at>$5 and p.enabled and p.revision=j.preference_revision and not j.delivery_uncertain`,[id,ctx.participant,ctx.actor,token,this.clock()])).rows[0];
   if(!row||!row.foreground_speech||isQuiet(this.clock(),ctx.zone,String(row.quiet_start).slice(0,5),String(row.quiet_end).slice(0,5)))throw new ApiError(403,'prompt_unavailable','This spoken reminder is no longer available.');
   if((await db.query("select 1 from companion_local.prompt_delivery_events where participant_id=$1 and prompt_id=$2 and event_type='speech_dispatch_attempt'",[ctx.participant,id])).rows.length)throw new ApiError(409,'speech_already_requested','This reminder was already requested. Please use its text on screen.');
   // A crash or lost audio response cannot establish whether it played. Leave
   // a durable marker before synthesis; recovery is text-only, never a replay.
   await this.promptEvent(db,ctx.participant,id,'speech_dispatch_attempt',ctx.actor,{});return row.message;
  });
 }
 async acknowledgePrompt(session:Session,id:string,token:string,channel:'in_app'|'speech'|'notification'){
   const current=await localAuthority(this.pool,session,this.clock());requireClient(current);await this.reconcilePrompts(current.participant,id);
  return localTransaction(this.pool,async db=>{
   const ctx=await localAuthority(db,session,this.clock(),true);requireClient(ctx);await lockParticipant(db,ctx);
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
