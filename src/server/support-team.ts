import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ZodError } from 'zod';
import { dateInZone } from '../shared/contracts.js';
import { supportCommandSchema, supportWorkspaceQuerySchema, type SupportCommand, type SupportNotification,
  type SupportReceipt, type SupportWorkspace, type SupportWorkspaceQuery, type SharedItem } from '../shared/support-contracts.js';
import { activityId } from './activity-ledger.js';
import { localDateTimeWithOffset } from '../shared/local-time.js';
import { ApiError, unavailable } from './errors.js';
import { canonicalJson, localAuthority, localTransaction, lockParticipant, previousLocalCommand, saveLocalCommand, type LocalAuthority, type LocalDb } from './local-authority.js';
import type { Session } from './session.js';

type Access={share_tasks:boolean;share_meals:boolean;share_progress:boolean;revision:number;updated_at:Date}|null;
type Preferences={revision:number;task_completion:boolean;meal_completion:boolean;task_reschedule:boolean;meal_reschedule:boolean;quiet_start:string|null;quiet_end:string|null;time_zone:string;updated_at:Date}|null;
const digest=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const conflict=(message='The saved details changed. Refresh and review again.'):never=>{throw new ApiError(409,'conflict',message);};
function mapError(error:unknown):never {
  if(error instanceof ApiError)throw error;
  if(error instanceof ZodError)throw new ApiError(400,'invalid_input','Check the sharing details and try again.');
  const code=(error as {code?:string})?.code;
  if(['23505','23503','40001','40P01'].includes(code??''))return conflict();
  if(['23514','22P02','22023'].includes(code??''))throw new ApiError(400,'invalid_input','Check the sharing details and try again.');
  throw unavailable();
}
function validZone(zone:string) {try{new Intl.DateTimeFormat('en',{timeZone:zone});return true;}catch{return false;}}
function isQuiet(pref:Preferences,now:Date) {
  if(!pref?.quiet_start||!pref.quiet_end)return false;
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:pref.time_zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const time=`${parts.find(p=>p.type==='hour')?.value}:${parts.find(p=>p.type==='minute')?.value}`;
  const start=pref.quiet_start.slice(0,5),end=pref.quiet_end.slice(0,5);
  return start<end?time>=start&&time<end:time>=start||time<end;
}
function decodeCursor(text:string|undefined,kind:'items'|'notifications') {
  if(!text)return null;
  try{const value=JSON.parse(Buffer.from(text,'base64url').toString('utf8'));
    if(value?.kind!==kind||typeof value.hash!=='string'||typeof value.pos!=='string'||value.pos.length>200)throw Error();
    return value as {kind:string;hash:string;pos:string};
  }catch{throw new ApiError(400,'invalid_cursor','Refresh this view before continuing.');}
}
const cursor=(kind:'items'|'notifications',hash:string,pos:string)=>Buffer.from(JSON.stringify({kind,hash,pos})).toString('base64url');
const iso=(value:Date|string|null)=>value?new Date(value).toISOString():null;
function ensureValidDate(date:string) {if(dateInZone(new Date(`${date}T12:00:00Z`),'UTC')!==date)throw new ApiError(400,'invalid_input','Choose a real date.');}

/** S10 in-app sharing. No external sender and no model inference. */
export class SupportTeamService {
  static readonly participantsPerTick=8;
  static readonly eventsPerParticipant=20;
  private readonly clock:()=>Date;
  constructor(private readonly pool:Pool,options:{clock?:()=>Date}={}) {this.clock=options.clock??(()=>new Date());}
  private async access(db:LocalDb,ctx:LocalAuthority):Promise<{share:Access;pref:Preferences}> {
    if(ctx.role==='client')return {share:null,pref:null};
    const [share,pref]=await Promise.all([
      db.query('select share_tasks,share_meals,share_progress,revision,updated_at from companion_local.support_shares where participant_id=$1 and actor_id=$2 and role=$3',[ctx.participant,ctx.actor,ctx.role]),
      db.query('select revision,task_completion,meal_completion,task_reschedule,meal_reschedule,quiet_start::text,quiet_end::text,time_zone,updated_at from companion_local.support_notification_preferences where participant_id=$1 and actor_id=$2 and role=$3',[ctx.participant,ctx.actor,ctx.role]),
    ]);
    return {share:share.rows[0]??null,pref:pref.rows[0]??null};
  }
  private async requireNotificationShare(db:LocalDb,ctx:LocalAuthority,id:string) {
    const share=(await this.access(db,ctx)).share;
    const row=(await db.query(`select activity_kind from companion_local.support_notifications
      where id=$1 and participant_id=$2 and recipient_id=$3 and recipient_role=$4`,
      [id,ctx.participant,ctx.actor,ctx.role])).rows[0];
    if(!row || !(row.activity_kind==='task' ? share?.share_tasks : row.activity_kind==='meal' && share?.share_meals))
      throw new ApiError(403,'forbidden','This activity alert is no longer shared with this account.');
  }
  private async guarded(db:LocalDb,session:Session) {
    const ctx=await localAuthority(db,session,this.clock());
    const access=await this.access(db,ctx);
    return {ctx,...access,hash:digest([ctx.grant,access.share,access.pref])};
  }
  private async sharesForClient(db:LocalDb,ctx:LocalAuthority) {
    if(ctx.role!=='client')return [];
    const {rows}=await db.query(`select g.actor_id,g.role,a.email label,coalesce(sh.share_tasks,false) share_tasks,
      coalesce(sh.share_meals,false) share_meals,coalesce(sh.share_progress,false) share_progress,coalesce(sh.revision,0) revision
      from companion_local.role_grants g join companion_local.accounts a on a.id=g.actor_id
      left join companion_local.support_shares sh on sh.participant_id=g.participant_id and sh.actor_id=g.actor_id and sh.role=g.role
      where g.participant_id=$1 and g.role in ('family_friend','administrator','clinician') and g.revoked_at is null and a.disabled_at is null order by a.email,g.role`,[ctx.participant]);
    return rows;
  }
  private async items(db:LocalDb,ctx:LocalAuthority,date:string,tasks:boolean,meals:boolean):Promise<SharedItem[]> {
    if(!tasks&&!meals)return [];
    const check=(await db.query(`select v.plan from companion_local.daily_checkins c
      join companion_local.accepted_day_plan_versions v on v.checkin_id=c.id and v.version=c.accepted_version
      where c.participant_id=$1 and c.local_date=$2`,[ctx.participant,date])).rows[0];
    const plan=check?.plan as {tasks?:Array<{id:string;title:string;urgency?:string;scheduled_time?:string|null}>;meals?:Array<{slot:'breakfast'|'lunch'|'dinner';option_id:string;name:string}>}|undefined;
    const output=new Map<string,SharedItem>();
    if(tasks)for(const t of plan?.tasks??[]) {
      const id=activityId(ctx.participant,date,'task',t.id);
      const scheduled=t.scheduled_time?localDateTimeWithOffset(`${date}T${t.scheduled_time}`,ctx.zone):null;
      output.set(id,{id,kind:'task',title:t.title,local_date:date,scheduled_at:scheduled?.ok?scheduled.value:null,
        urgency:t.urgency==='high'||t.urgency==='low'?t.urgency:'medium',meal_slot:null,status:'planned',occurred_at:null});
    }
    if(meals)for(const m of plan?.meals??[]) {
      const id=activityId(ctx.participant,date,'meal',JSON.stringify([m.slot,m.option_id,m.name]));
      output.set(id,{id,kind:'meal',title:m.name,local_date:date,scheduled_at:null,urgency:null,meal_slot:m.slot,status:'planned',occurred_at:null});
    }
    const rows=(await db.query(`select a.id,a.kind,a.title,a.local_date::text,a.meal_slot,a.scheduled_at,a.status,a.occurred_at,
      t.urgency from companion_local.activity_records a left join companion_local.task_definitions t
      on t.id=a.source_id and t.participant_id=a.participant_id
      where a.participant_id=$1 and (a.local_date=$2 or (a.scheduled_at at time zone $3)::date=$2)
      and a.kind in ('task','meal') order by a.updated_at desc,a.id`,[ctx.participant,date,ctx.zone])).rows;
    for(const r of rows) {
      if(r.kind==='task'&&!tasks||r.kind==='meal'&&!meals)continue;
      if(r.status==='voided'){output.delete(r.id);continue;}
      output.set(r.id,{id:r.id,kind:r.kind,title:r.title,local_date:r.local_date,scheduled_at:iso(r.scheduled_at),
        urgency:r.kind==='task'?(r.urgency??'medium'):null,meal_slot:r.kind==='meal'?r.meal_slot:null,
        status:r.status,occurred_at:iso(r.occurred_at)});
    }
    return [...output.values()].sort((a,b)=>(a.scheduled_at??'z').localeCompare(b.scheduled_at??'z')||a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
  }
  private async notifications(db:LocalDb,ctx:LocalAuthority,share:Access,pref:Preferences,limit:number,after:string|null):Promise<{items:SupportNotification[];nextPos:string|null}> {
    if(!share||!pref||!(share.share_tasks||share.share_meals))return {items:[],nextPos:null};
    const parts=after?.split('|')??[];
    if(after&&(parts.length!==2||!Number.isFinite(Date.parse(parts[0]))||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parts[1])))throw new ApiError(400,'invalid_cursor','Refresh this view before continuing.');
    const args:unknown[]=[ctx.participant,ctx.actor,ctx.role,share.share_tasks,share.share_meals,
      pref.task_completion,pref.meal_completion,pref.task_reschedule,pref.meal_reschedule,share.updated_at,pref.updated_at];
    const afterSql=after?`and (n.created_at,n.id)>($12::timestamptz,$13::uuid)`:'';
    if(after)args.push(parts[0],parts[1]);
    args.push(limit+1);
    const {rows}=await db.query(`select n.id,n.event_id,n.activity_id,n.activity_kind,n.event_type,n.created_at,n.read_at,a.title
      from companion_local.support_notifications n join companion_local.domain_events e on e.id=n.event_id
      join companion_local.activity_records a on a.participant_id=n.participant_id and a.id=n.activity_id
      where n.participant_id=$1 and n.recipient_id=$2 and n.recipient_role=$3 and a.last_command_id=e.command_id
      and ((n.activity_kind='task' and $4 and ((n.event_type='ActivityReported' and $6) or (n.event_type='ActivityRescheduled' and $8)))
        or (n.activity_kind='meal' and $5 and ((n.event_type='ActivityReported' and $7) or (n.event_type='ActivityRescheduled' and $9))))
      and ((n.event_type='ActivityReported' and a.status='completed') or (n.event_type='ActivityRescheduled' and a.status='pending'))
      and e.created_at >= $10 and e.created_at >= $11
      ${afterSql} order by n.created_at,n.id limit $${args.length}`,args);
    const page=rows.slice(0,limit),last=page.at(-1);
    return {items:page.map(r=>({id:r.id,event_id:r.event_id,activity_id:r.activity_id,kind:r.activity_kind,
      type:r.event_type==='ActivityReported'?'completed':'rescheduled',title:r.title,created_at:iso(r.created_at)!,read_at:iso(r.read_at)})),
      nextPos:rows.length>limit&&last?`${iso(last.created_at)}|${last.id}`:null};
  }
  async workspace(session:Session,raw:SupportWorkspaceQuery={}):Promise<SupportWorkspace> {
    try {
      const query=supportWorkspaceQuerySchema.parse(raw),state=await this.guarded(this.pool,session);
      const {ctx,share,pref}=state;
      const date=query.date??dateInZone(this.clock(),ctx.zone);ensureValidDate(date);
      const canTasks=ctx.role==='client'||!!share?.share_tasks,canMeals=ctx.role==='client'||!!share?.share_meals;
      const limit=query.limit??20;
      const quiet=ctx.role!=='client'&&isQuiet(pref,this.clock());
      const notificationHash=digest([state.hash,ctx.actor,ctx.participant]);
      const notificationCursor=decodeCursor(query.notifications_cursor,'notifications');
      if(notificationCursor&&notificationCursor.hash!==notificationHash)return conflict('Notification access changed. Refresh this view.');
      const [allItems,notificationPage,shares]=await Promise.all([
        this.items(this.pool,ctx,date,canTasks,canMeals),
        ctx.role==='client'||quiet?Promise.resolve({items:[] as SupportNotification[],nextPos:null}):this.notifications(this.pool,ctx,share,pref,limit,notificationCursor?.pos??null),
        this.sharesForClient(this.pool,ctx),
      ]);
      const itemHash=digest([state.hash,date,allItems]);
      const itemCursor=decodeCursor(query.items_cursor,'items');
      if(itemCursor&&itemCursor.hash!==itemHash)return conflict('The shared day changed. Refresh this view.');
      const start=itemCursor?Number(itemCursor.pos):0;
      if(!Number.isSafeInteger(start)||start<0||start>allItems.length)throw new ApiError(400,'invalid_cursor','Refresh this view before continuing.');
      const selected=allItems.slice(start,start+limit);
      const fresh=await this.guarded(this.pool,session);
      if(fresh.hash!==state.hash)throw new ApiError(403,'forbidden','Sharing changed. Refresh before continuing.');
      return {role:ctx.role,local_date:date,can_view_tasks:canTasks,can_view_meals:canMeals,progress_status:'unavailable',shares,
        preferences:ctx.role==='client'?null:pref?{revision:pref.revision,task_completion:pref.task_completion,meal_completion:pref.meal_completion,
          task_reschedule:pref.task_reschedule,meal_reschedule:pref.meal_reschedule,quiet_start:pref.quiet_start?.slice(0,5)??null,
          quiet_end:pref.quiet_end?.slice(0,5)??null,time_zone:pref.time_zone}:null,
        items:selected,next_items_cursor:start+limit<allItems.length?cursor('items',itemHash,String(start+limit)):null,
        notifications:notificationPage.items,next_notifications_cursor:notificationPage.nextPos?cursor('notifications',notificationHash,notificationPage.nextPos):null,
        notifications_quiet:quiet};
    }catch(error){return mapError(error);}
  }
  async receipt(session:Session,key:string):Promise<SupportReceipt|null> {
    try {
      const ctx=await localAuthority(this.pool,session,this.clock());
      const row=(await this.pool.query(`select actor_id,event_type,command,result from companion_local.append_only_mutations
        where participant_id=$1 and command_id=$2 and event_type like 'Support%'`,[ctx.participant,key])).rows[0];
      if(!row||row.actor_id!==ctx.actor)return null;
      const saved=supportCommandSchema.parse(row.command);
      if(saved.type==='mark_support_notification_read')await this.requireNotificationShare(this.pool,ctx,saved.notification_id);
      const current=await localAuthority(this.pool,session,this.clock());
      if(current.grant!==ctx.grant)throw new ApiError(403,'forbidden','Access changed. Refresh before continuing.');
      return {command_id:key,result:row.result,replayed:true};
    }catch(error){return mapError(error);}
  }
  async command(session:Session,raw:SupportCommand):Promise<SupportReceipt> {
    try {
      const command=supportCommandSchema.parse(raw);
      if(command.type==='set_support_notifications'&&!validZone(command.time_zone))throw new ApiError(400,'invalid_input','Choose a valid time zone.');
      if(command.type==='set_support_notifications'&&command.quiet_start===command.quiet_end&&command.quiet_start!==null)throw new ApiError(400,'invalid_input','Choose different quiet-hour start and end times.');
      return await localTransaction(this.pool,async db=>{
        const ctx=await localAuthority(db,session,this.clock(),true);await lockParticipant(db,ctx);
        const event=command.type==='set_support_share'?'SupportSharingChanged':command.type==='set_support_notifications'?'SupportNotificationPreferencesChanged':'SupportNotificationRead';
        if(command.type==='mark_support_notification_read')await this.requireNotificationShare(db,ctx,command.notification_id);
        const prior=await previousLocalCommand(db,ctx,command.idempotency_key,command,'Support');
        if(prior){const {replayed:_ignored,...result}=prior;return {command_id:command.idempotency_key,result,replayed:true};}
        let result:Record<string,unknown>;
        if(command.type==='set_support_share') {
          if(ctx.role!=='client')throw new ApiError(403,'forbidden','Only the client can share this view.');
          const granted=(await db.query(`select 1 from companion_local.role_grants g join companion_local.accounts a on a.id=g.actor_id
            where g.participant_id=$1 and g.actor_id=$2 and g.role=$3 and g.revoked_at is null and a.disabled_at is null for share of g,a`,[ctx.participant,command.actor_id,command.role])).rows[0];
          if(!granted)throw new ApiError(400,'invalid_input','Choose an active account already linked to this client.');
          const old=(await db.query('select revision from companion_local.support_shares where participant_id=$1 and actor_id=$2 and role=$3 for update',[ctx.participant,command.actor_id,command.role])).rows[0];
          if((old?.revision??0)!==command.expected_revision)return conflict();
          const saved=(await db.query(`insert into companion_local.support_shares(participant_id,actor_id,role,share_tasks,share_meals,share_progress,updated_at)
            values($1,$2,$3,$4,$5,$6,$7) on conflict(participant_id,actor_id,role) do update
            set share_tasks=excluded.share_tasks,share_meals=excluded.share_meals,share_progress=excluded.share_progress,
              revision=support_shares.revision+1,updated_at=excluded.updated_at returning revision`,[ctx.participant,command.actor_id,command.role,
              command.share_tasks,command.share_meals,command.share_progress,this.clock()])).rows[0];
          result={actor_id:command.actor_id,revision:saved.revision,share_tasks:command.share_tasks,share_meals:command.share_meals,share_progress:command.share_progress};
        } else if(command.type==='set_support_notifications') {
          if(ctx.role==='client')throw new ApiError(403,'forbidden','Notification choices belong to each recipient.');
          const old=(await db.query('select revision from companion_local.support_notification_preferences where participant_id=$1 and actor_id=$2 and role=$3 for update',[ctx.participant,ctx.actor,ctx.role])).rows[0];
          if((old?.revision??0)!==command.expected_revision)return conflict();
          const saved=(await db.query(`insert into companion_local.support_notification_preferences(participant_id,actor_id,role,task_completion,meal_completion,
            task_reschedule,meal_reschedule,quiet_start,quiet_end,time_zone,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            on conflict(participant_id,actor_id,role) do update set task_completion=excluded.task_completion,meal_completion=excluded.meal_completion,
              task_reschedule=excluded.task_reschedule,meal_reschedule=excluded.meal_reschedule,quiet_start=excluded.quiet_start,
              quiet_end=excluded.quiet_end,time_zone=excluded.time_zone,revision=support_notification_preferences.revision+1,
              updated_at=excluded.updated_at returning revision`,[ctx.participant,ctx.actor,ctx.role,command.task_completion,command.meal_completion,
              command.task_reschedule,command.meal_reschedule,command.quiet_start,command.quiet_end,command.time_zone,this.clock()])).rows[0];
          result={revision:saved.revision};
        } else {
          const share=(await this.access(db,ctx)).share;
          if(!share?.share_tasks&&!share?.share_meals)throw new ApiError(403,'forbidden','No activity is shared with this account.');
          const row=(await db.query(`update companion_local.support_notifications n set read_at=coalesce(read_at,$4)
            from companion_local.activity_records a,companion_local.domain_events e
            where n.id=$1 and n.participant_id=$2 and n.recipient_id=$3 and n.recipient_role=$5
              and a.id=n.activity_id and a.participant_id=n.participant_id and e.id=n.event_id and a.last_command_id=e.command_id
              and ((n.activity_kind='task' and $6) or (n.activity_kind='meal' and $7)) returning n.id`,
            [command.notification_id,ctx.participant,ctx.actor,this.clock(),ctx.role,share.share_tasks,share.share_meals])).rows[0];
          if(!row)throw new ApiError(404,'not_found','That alert is no longer available.');
          result={notification_id:row.id,read:true};
        }
        await saveLocalCommand(db,ctx,command,result,event,dateInZone(this.clock(),ctx.zone),result);
        return {command_id:command.idempotency_key,result,replayed:false};
      });
    }catch(error){return mapError(error);}
  }
  /** Idempotently materialize only current, consented, actual activity events. Safe to call after ledger commits or on a local worker tick. */
  async refreshNotifications():Promise<number> {
    try {
      return await localTransaction(this.pool,async db=>{
       await db.query('insert into companion_local.support_notification_scan_cursor(id) values(true) on conflict(id) do nothing');
       const cursorRow=(await db.query('select last_participant_id from companion_local.support_notification_scan_cursor where id=true for update')).rows[0];
       const participants=(await db.query(`select id from companion_local.participant_profiles
         order by (id <= coalesce($1::uuid,'00000000-0000-0000-0000-000000000000'::uuid)),id limit $2`,
         [cursorRow?.last_participant_id??null,SupportTeamService.participantsPerTick])).rows;
       let delivered=0;
       for(const person of participants){
        const row=await db.query(`with pending as materialized (
        select e.* from companion_local.domain_events e
        where e.participant_id=$2 and e.event_type in ('ActivityReported','ActivityRescheduled')
          and not exists(select 1 from companion_local.support_notification_scanned s where s.event_id=e.id)
        order by e.created_at,e.id limit $3
      ), created as (
        insert into companion_local.support_notifications(participant_id,recipient_id,recipient_role,event_id,activity_id,activity_kind,event_type,activity_revision,created_at)
        select e.participant_id,sh.actor_id,sh.role,e.id,a.id,a.kind,e.event_type,a.revision,$1
        from pending e
        join companion_local.activity_records a on a.participant_id=e.participant_id and a.id::text=e.data->>'activity_id'
          and a.last_command_id=e.command_id and a.revision::text=e.data->'after'->>'revision'
        join companion_local.support_shares sh on sh.participant_id=e.participant_id
        join companion_local.role_grants g on g.participant_id=sh.participant_id and g.actor_id=sh.actor_id and g.role=sh.role and g.revoked_at is null
        join companion_local.accounts ac on ac.id=sh.actor_id and ac.disabled_at is null
        join companion_local.support_notification_preferences p on p.participant_id=sh.participant_id and p.actor_id=sh.actor_id and p.role=sh.role
        where e.created_at>=sh.updated_at and e.created_at>=p.updated_at
          and a.kind in ('task','meal') and ((e.event_type='ActivityReported' and a.status='completed') or (e.event_type='ActivityRescheduled' and a.status='pending'))
          and ((a.kind='task' and sh.share_tasks and ((e.event_type='ActivityReported' and p.task_completion) or (e.event_type='ActivityRescheduled' and p.task_reschedule)))
            or (a.kind='meal' and sh.share_meals and ((e.event_type='ActivityReported' and p.meal_completion) or (e.event_type='ActivityRescheduled' and p.meal_reschedule))))
        on conflict(event_id,recipient_id,recipient_role) do nothing returning id
      ), scanned as (
        insert into companion_local.support_notification_scanned(event_id,scanned_at)
        select id,$1 from pending on conflict(event_id) do nothing returning event_id
      ) select (select count(*)::int from created) as delivered,(select count(*)::int from scanned) as scanned`,[this.clock(),person.id,SupportTeamService.eventsPerParticipant]);
        delivered+=row.rows[0]?.delivered??0;
       }
       if(participants.length)await db.query('update companion_local.support_notification_scan_cursor set last_participant_id=$1 where id=true',[participants.at(-1).id]);
       return delivered;
      });
    }catch(error){return mapError(error);}
  }
}
