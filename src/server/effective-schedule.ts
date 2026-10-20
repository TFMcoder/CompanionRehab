import type {LocalDb} from './local-authority.js';

/** One occurrence projection shared by reminders and protected-time review. */
export async function effectiveAppointments(db:LocalDb,participant:string,options:{from?:Date|string;to?:Date|string;id?:string;limit?:number}={}) {
  return (await db.query(`select id,title,starts_at from (
    select a.id,a.title,coalesce(r.scheduled_at,a.starts_at) as starts_at,coalesce(r.status,'pending') as status
    from companion_local.appointments a left join lateral (
      select scheduled_at,status from companion_local.activity_records
      where participant_id=a.participant_id and kind='appointment' and source_id=a.id
      order by updated_at desc,id desc limit 1
    ) r on true where a.participant_id=$1 and ($4::uuid is null or a.id=$4)
  ) effective where status not in ('completed','deferred')
    and ($2::timestamptz is null or starts_at>=$2) and ($3::timestamptz is null or starts_at<$3)
  order by starts_at,id limit $5`,[participant,options.from??null,options.to??null,options.id??null,options.limit??200])).rows as Array<{id:string;title:string;starts_at:Date}>;
}
