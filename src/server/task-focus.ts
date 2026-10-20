import { createHash } from 'node:crypto';
import { dateInZone,type Today } from '../shared/contracts.js';
import type { FocusOption,TaskFocus } from '../shared/local-day-contracts.js';
import type { LocalDb } from './local-authority.js';
import { activityRow,projectLedger } from './activity-ledger.js';
const instant=(value:Date|string|null)=>value?new Date(value).toISOString():null;
export const taskFocus=(row:any):TaskFocus=>({id:row.id,activity_id:row.activity_id,task_id:row.task_id,title:row.title,local_date:String(row.local_date).slice(0,10),revision:row.revision,state:row.state,interval_minutes:row.interval_minutes,started_at:instant(row.started_at)!,last_started_at:instant(row.last_started_at)!,paused_at:instant(row.paused_at),finished_at:instant(row.finished_at),check_due_at:instant(row.check_due_at)!});

/** Narrow ledger projection: task occurrence identity and corrections stay owned by the factual ledger. */
export async function focusOptions(db:LocalDb,participant:string,day:string,now:Date):Promise<FocusOption[]>{
 const profile=(await db.query('select id,display_name,time_zone,preferences,revision from companion_local.participant_profiles where id=$1',[participant])).rows[0];if(!profile)return [];
 const check=(await db.query(`select c.id,c.revision,a.plan as accepted from companion_local.daily_checkins c left join companion_local.accepted_day_plan_versions a on a.checkin_id=c.id and a.version=c.accepted_version where c.participant_id=$1 and c.local_date=$2`,[participant,day])).rows[0];
 const tasks=(await db.query(`select id,title,time_hint,scheduled_date::text as scheduled_date,to_char(scheduled_time,'HH24:MI') as scheduled_time from companion_local.task_definitions where participant_id=$1 and active order by id limit 20`,[participant])).rows;
 const today:Today={profile,local_date:day,tasks,meal_options:[],checkin:check?{id:check.id,local_date:day,revision:check.revision,accepted:check.accepted,proposal:null}:null};
 const saved=(await db.query(`select *,local_date::text as local_date from companion_local.activity_records where participant_id=$1 and kind='task' and (local_date=$2 or (scheduled_at at time zone $3)::date=$2 or (local_date<$2 and (scheduled_at at time zone $3)::date>=$2)) order by updated_at desc,id`,[participant,day,profile.time_zone])).rows.map(activityRow);
 return projectLedger(today,saved,dateInZone(now,profile.time_zone)).options.filter(option=>option.kind==='task'&&option.status==='pending'&&!!option.source_id&&!option.unplanned&&tasks.some(task=>task.id===option.source_id)&&(!option.scheduled_at||dateInZone(new Date(option.scheduled_at),profile.time_zone)===day)).slice(0,20).map(option=>({activity_id:option.id,task_id:option.source_id!,title:option.title,local_date:day,activity_revision:option.revision,source_version:createHash('sha256').update(JSON.stringify([option.id,option.source_id,option.title,option.revision,option.scheduled_at])).digest('hex')}));
}
