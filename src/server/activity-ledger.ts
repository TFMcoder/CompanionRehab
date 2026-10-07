import { createHash } from 'node:crypto';
import { dateInZone, type Today } from '../shared/contracts.js';
import type { ActivityEntry, ActivityKind, ActivityLedger, ActivityOption } from '../shared/activity-contracts.js';
import { localDateTimeWithOffset } from '../shared/local-time.js';

/** Stable per-participant occurrence identity shared by task and meal projections. */
export function activityId(participant: string, date: string, kind: ActivityKind, source: string) {
  const bytes = createHash('sha256').update(JSON.stringify(['nancy-activity-v1', participant, date, kind, source])).digest().subarray(0,16);
  bytes[6] = (bytes[6] & 15) | 0x50; bytes[8] = (bytes[8] & 63) | 0x80;
  const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export function activityRow(row: any): ActivityEntry {
  const iso=(value: Date|string|null)=>value ? new Date(value).toISOString() : null;
  return { id:row.id, kind:row.kind, title:row.title, local_date: typeof row.local_date==='string' ? row.local_date : dateInZone(row.local_date,'UTC'),
    source_id:row.source_id, meal_slot:row.meal_slot, plan_id:row.plan_id, unplanned:row.unplanned,
    scheduled_at:iso(row.scheduled_at), status:row.status, occurred_at:iso(row.occurred_at), notes:row.notes,
    portion:row.portion, revision:row.revision, last_action:row.last_action, recorded_at:iso(row.recorded_at)!, updated_at:iso(row.updated_at)! };
}
export function plannedActivities(today: Today, currentDate: string): ActivityOption[] {
  const profile=today.profile;if(!profile)return [];
  const day=today.local_date, plan=today.checkin?.accepted;
  const tasks=plan?.tasks ?? (day===currentDate ? today.tasks : []);
  const options:ActivityOption[]=[];
  const scheduled=(time:string|null|undefined) => {
    if(!time)return null;
    const value=localDateTimeWithOffset(`${day}T${time}`,profile.time_zone);
    return value.ok ? new Date(value.value).toISOString() : null;
  };
  for(const task of tasks) {
    if(task.scheduled_date && task.scheduled_date!==day && !plan)continue;
    options.push({id:activityId(profile.id,day,'task',task.id),kind:'task',title:task.title,local_date:day,source_id:task.id,
      meal_slot:null,plan_id:plan?.id??null,unplanned:false,scheduled_at:scheduled(task.scheduled_time),status:'pending',revision:0});
  }
  // A slot is not a food identity. Replacing its choice must invalidate an old
  // unsaved report, while reaccepting the same food still means one occurrence.
  for(const meal of plan?.meals??[])options.push({id:activityId(profile.id,day,'meal',JSON.stringify([meal.slot,meal.option_id,meal.name])),kind:'meal',title:meal.name,local_date:day,
    source_id:meal.option_id,meal_slot:meal.slot,plan_id:plan!.id,unplanned:false,scheduled_at:null,status:'pending',revision:0});
  for(const appointment of today.appointments??[]) {
    const date=dateInZone(new Date(appointment.starts_at),profile.time_zone);if(date!==day)continue;
    options.push({id:activityId(profile.id,date,'appointment',appointment.id),kind:'appointment',title:appointment.title,local_date:date,
      source_id:appointment.id,meal_slot:null,plan_id:null,unplanned:false,scheduled_at:appointment.starts_at,status:'pending',revision:0});
  }
  return options;
}
export function projectLedger(today:Today, saved:ActivityEntry[], currentDate:string):ActivityLedger {
  const zone=today.profile!.time_zone, day=today.local_date;
  const onDate=(instant:string|null)=>instant ? dateInZone(new Date(instant),zone) : null;
  const options=new Map(plannedActivities(today,currentDate).map(option=>[option.id,option]));
  for (const [id, option] of options) {
    const savedOccurrence = saved.find(entry => !entry.unplanned && entry.kind === option.kind && entry.source_id === option.source_id && (
      // Preserve earlier saved slot IDs without regenerating a pending copy.
      option.kind === 'meal' && entry.local_date === day && entry.meal_slot === option.meal_slot && entry.title === option.title
      // Keep an explicit move through intervening days too, including another
      // reschedule. A fresh definition must not reappear before its new date.
      || option.kind === 'task' && entry.local_date < day && (onDate(entry.scheduled_at) ?? '') >= day
    ));
    if (savedOccurrence && savedOccurrence.id !== id) {
      options.delete(id);
      options.set(savedOccurrence.id, savedOccurrence);
    }
  }
  for(const entry of saved) {
    // A moved occurrence keeps its original ID, and is available on the new scheduled day.
    if(options.has(entry.id)||onDate(entry.scheduled_at)===day||entry.local_date===day) options.set(entry.id,entry);
  }
  const entries=saved.filter(entry => entry.status==='completed' ? onDate(entry.occurred_at)===day
    : entry.local_date===day || onDate(entry.scheduled_at)===day);
  const count=(kind:ActivityKind)=>entries.filter(e=>e.kind===kind&&e.status==='completed').length;
  return {local_date:day,options:[...options.values()].sort((a,b)=>(a.scheduled_at??'z').localeCompare(b.scheduled_at??'z')||a.title.localeCompare(b.title)),
    entries:entries.sort((a,b)=>(b.occurred_at??b.updated_at).localeCompare(a.occurred_at??a.updated_at)),
    recent_entries:saved.filter(e=>e.local_date<=currentDate || (e.occurred_at&&onDate(e.occurred_at)!<=currentDate)).slice(0,100),
    summary:{tasks_completed:count('task'),meals_eaten:count('meal'),appointments_attended:count('appointment'),deferred:entries.filter(e=>e.status==='deferred').length}};
}
