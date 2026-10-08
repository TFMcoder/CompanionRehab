import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ZodError } from 'zod';
import { dateInZone, type AppRole, type AcceptedPlan } from '../shared/contracts.js';
import { localDateTimeWithOffset } from '../shared/local-time.js';
import { taskRequestCommandSchema, taskRequestDraftSchema, type RequestCapability, type TaskRequestCommand, type TaskRequestDraft,
  type TaskRequestReceipt, type TaskRequestReview, type TaskRequestWorkspace, type TaskRequestItem } from '../shared/task-request-contracts.js';
import { ApiError, unavailable } from './errors.js';
import { activityId } from './activity-ledger.js';
import type { Session } from './session.js';

type Db = Pick<PoolClient, 'query'>;
type Context = { actor: string; participant: string; role: AppRole; capabilities: RequestCapability[]; grant: string };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
function fail(code: string, message: string, status = 409): never { throw new ApiError(status, code, message); }
function mapError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (error instanceof ZodError) return fail('invalid_input', 'Check the request details and try again.', 400);
  const code = (error as { code?: string })?.code;
  if (['23505', '23503', '40001', '40P01'].includes(code ?? '')) return fail('conflict', 'The saved details changed. Refresh and review again.');
  if (['23514', '22P02', '22023'].includes(code ?? '')) return fail('invalid_input', 'Check the request details and try again.', 400);
  throw unavailable();
}
const iso = (value: Date|string|null) => value ? new Date(value).toISOString() : null;

/** All delivery is durable in-app state. This service never invokes inference or sends messages. */
export class TaskRequestService {
  private readonly clock: () => Date;
  constructor(private readonly pool: Pool, options: { clock?: () => Date } = {}) { this.clock = options.clock ?? (() => new Date()); }
  private async transaction<T>(work: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try { await db.query('begin'); const result = await work(db); await db.query('commit'); return result; }
    catch (error) { await db.query('rollback').catch(() => {}); return mapError(error); }
    finally { db.release(); }
  }
  private async context(db: Db, session: Session, lock = false): Promise<Context> {
    const row = (await db.query(`select s.actor_id,s.participant_id,s.role,g.id as grant_id,g.granted_at
      from companion_local.sessions s join companion_local.accounts a on a.id=s.actor_id
      join companion_local.role_grants g on g.participant_id=s.participant_id and g.actor_id=s.actor_id and g.role=s.role
      where s.id=$1 and s.access_hash=$2 and s.expires_at>$3 and s.revoked_at is null and a.disabled_at is null and g.revoked_at is null
      ${lock ? 'for share of s,a,g' : ''}`, [session.session_id, Buffer.from(digest(session.access_token), 'hex'), this.clock()])).rows[0];
    if (!row || row.actor_id !== session.user_id) fail('unauthorized', 'Please sign in again.', 401);
    const access = (await db.query(`select capabilities,revision from companion_local.request_access where participant_id=$1 and actor_id=$2 and role=$3 ${lock ? 'for share' : ''}`, [row.participant_id, row.actor_id, row.role])).rows[0];
    return { actor: row.actor_id, participant: row.participant_id, role: row.role, capabilities: access?.capabilities ?? [],
      grant: digest(canonical([row.grant_id,row.granted_at,access?.revision ?? 0,access?.capabilities ?? []])) };
  }
  private requireClient(ctx: Context) { if (ctx.role !== 'client') fail('forbidden', 'Only the client can make this choice.', 403); }
  private require(ctx: Context, capability: RequestCapability) {
    if (!ctx.capabilities.includes(capability)) fail('forbidden', 'This action is not shared with this account.', 403);
    if (capability === 'request_tasks' && !['family_friend','administrator'].includes(ctx.role)
      || capability === 'help_requests' && ctx.role !== 'family_friend'
      || capability === 'review_request_flags' && ctx.role !== 'administrator') fail('forbidden', 'This action is not available for this role.', 403);
  }
  private authorizeCommand(ctx: Context, command: TaskRequestCommand) {
    if (['accept_request','reject_request','set_day_capacity','set_request_access'].includes(command.type)) this.requireClient(ctx);
    else if (command.type === 'submit_request' || command.type === 'withdraw_request') this.require(ctx, 'request_tasks');
    else if (command.type === 'acknowledge_flag') this.require(ctx, 'review_request_flags');
    else if (command.type === 'volunteer_help') this.require(ctx, 'help_requests');
    else if (command.type === 'resolve_help' && ctx.role !== 'client') this.require(ctx, ctx.role === 'administrator' ? 'review_request_flags' : 'help_requests');
  }
  async authorityRevision(session: Session): Promise<string> {
    try { return (await this.context(this.pool,session)).grant; } catch(error) { return mapError(error); }
  }
  async workspace(session: Session): Promise<TaskRequestWorkspace> {
    try {
      const ctx = await this.context(this.pool, session);
      const p = (await this.pool.query('select id,display_name,time_zone from companion_local.participant_profiles where id=$1', [ctx.participant])).rows[0];
      const local_date = dateInZone(this.clock(),p.time_zone);
      const canRead = ctx.role === 'client' || ctx.capabilities.includes('read_requests');
      const requests = canRead ? (await this.pool.query(`select r.*,requester.email as requester_label,
        exists(select 1 from companion_local.role_grants g join companion_local.accounts a on a.id=g.actor_id
          join companion_local.request_access x on x.participant_id=g.participant_id and x.actor_id=g.actor_id and x.role=g.role
          where g.participant_id=r.participant_id and g.actor_id=r.requester_id and g.role=r.requester_role
            and g.revoked_at is null and a.disabled_at is null and 'request_tasks'=any(x.capabilities)) as requester_active
        from companion_local.task_requests r join companion_local.accounts requester on requester.id=r.requester_id
        where r.participant_id=$1 ${ctx.role === 'client' ? '' : 'and r.requester_id=$2'} order by r.created_at desc limit 200`, ctx.role === 'client' ? [ctx.participant] : [ctx.participant,ctx.actor])).rows.map(r => this.item(r,ctx)) : [];
      const mayHelp = ctx.role === 'client' || ctx.capabilities.includes('help_requests') && ctx.role === 'family_friend' || ctx.capabilities.includes('review_request_flags') && ctx.role === 'administrator';
      const helps = mayHelp ? (await this.pool.query(`select h.*,r.draft,r.reason,r.requester_id,
        (select count(*)::int from companion_local.request_access x join companion_local.role_grants g on g.participant_id=x.participant_id and g.actor_id=x.actor_id and g.role=x.role
          join companion_local.accounts a on a.id=x.actor_id where x.participant_id=h.participant_id and x.role='family_friend'
          and 'help_requests'=any(x.capabilities) and g.revoked_at is null and a.disabled_at is null and x.actor_id<>r.requester_id) as helper_count,
        exists(select 1 from companion_local.request_access x join companion_local.role_grants g on g.participant_id=x.participant_id and g.actor_id=x.actor_id and g.role=x.role
          join companion_local.accounts a on a.id=x.actor_id where x.participant_id=h.participant_id and x.actor_id=h.volunteer_id and x.role='family_friend'
          and 'help_requests'=any(x.capabilities) and g.revoked_at is null and a.disabled_at is null) as volunteer_active
        from companion_local.request_help h join companion_local.task_requests r on r.id=h.request_id where h.participant_id=$1
        ${ctx.role === 'family_friend' ? 'and r.requester_id<>$2' : ''} order by h.updated_at desc limit 200`, ctx.role === 'family_friend' ? [ctx.participant,ctx.actor] : [ctx.participant])).rows : [];
      const help_requests = helps.map(h => ({ id:h.id,request_id:h.request_id,revision:h.revision,task_name:h.draft.task_name,reason:h.reason,draft:h.draft,
        status: h.status === 'volunteered' && !h.volunteer_active ? 'unassigned' as const : h.status,
        volunteer_id:h.volunteer_active ? h.volunteer_id : null,resolution:h.resolution,eligible_helper_count:h.helper_count,
        can_volunteer:ctx.role === 'family_friend' && ctx.capabilities.includes('help_requests') && (h.status === 'unassigned' || h.status === 'volunteered' && !h.volunteer_active),
        can_resolve:h.status !== 'resolved' && (ctx.role === 'client' || ctx.role === 'administrator' && ctx.capabilities.includes('review_request_flags') || h.volunteer_id === ctx.actor && h.volunteer_active) }));
      const administrator_flags = ctx.role === 'administrator' && ctx.capabilities.includes('review_request_flags') ? (await this.pool.query(`select f.*,r.draft,r.reason from companion_local.request_flags f join companion_local.task_requests r on r.id=f.request_id
        where f.participant_id=$1 order by f.updated_at desc limit 200`, [ctx.participant])).rows.map(f => ({ id:f.id,request_id:f.request_id,help_id:f.help_id,revision:f.revision,task_name:f.draft.task_name,reason:f.reason,draft:f.draft,status:f.status,can_acknowledge:f.status === 'open' })) : [];
      const capacity = ctx.role === 'client' ? (await this.pool.query('select local_date::text,revision,available_minutes,rest_minutes from companion_local.request_day_capacity where participant_id=$1 and local_date=$2', [ctx.participant,local_date])).rows[0] ?? null : null;
      const sharing = ctx.role === 'client' ? (await this.pool.query(`select g.actor_id,g.role,a.email as label,coalesce(x.revision,0) as revision,coalesce(x.capabilities,'{}'::text[]) as capabilities
        from companion_local.role_grants g join companion_local.accounts a on a.id=g.actor_id
        left join companion_local.request_access x on x.participant_id=g.participant_id and x.actor_id=g.actor_id and x.role=g.role
        where g.participant_id=$1 and g.role in ('family_friend','administrator') and g.revoked_at is null and a.disabled_at is null order by a.email,g.role`, [ctx.participant])).rows : [];
      const current=await this.context(this.pool,session);
      if(canonical(current)!==canonical(ctx))fail('forbidden','Sharing changed. Refresh before continuing.',403);
      return { actor_id:ctx.actor,role:ctx.role,participant:p,local_date,capabilities:ctx.capabilities,requests,help_requests,administrator_flags,capacity,sharing };
    } catch(error) { return mapError(error); }
  }
  private item(row: any, ctx: Context): TaskRequestItem {
    return { id:row.id,revision:row.revision,requester_id:row.requester_id,requester_role:row.requester_role,
      requester_label:row.requester_label,draft:row.draft,status:row.status,
      requested_at:iso(row.requested_at)!,accepted_draft:row.accepted_draft,accepted_at:iso(row.accepted_at),task_id:row.task_id,activity_id:row.activity_id,
      reason:row.reason,created_at:iso(row.created_at)!,updated_at:iso(row.updated_at)!,
      can_accept:ctx.role === 'client' && row.status === 'pending' && row.requester_active,
      can_reject:ctx.role === 'client' && row.status === 'pending',
      can_withdraw:row.requester_id === ctx.actor && row.requester_role === ctx.role && ctx.capabilities.includes('request_tasks') && row.status === 'pending' };
  }
  async review(session: Session, input: TaskRequestDraft): Promise<TaskRequestReview> {
    try { const ctx = await this.context(this.pool,session); if(ctx.role !== 'client') this.require(ctx,'request_tasks');
      const review=await this.reviewFor(this.pool,ctx,taskRequestDraftSchema.parse(input));
      if(canonical(await this.context(this.pool,session))!==canonical(ctx))fail('forbidden','Sharing changed. Refresh before continuing.',403);
      return review; } catch(error) { return mapError(error); }
  }
  private async reviewFor(db: Db, ctx: Context, draft: TaskRequestDraft, exclude?: {request_id:string;task_id:string;activity_id:string;capacity_credit:number}): Promise<TaskRequestReview> {
    const profile = (await db.query('select revision,time_zone from companion_local.participant_profiles where id=$1', [ctx.participant])).rows[0];
    if(profile.time_zone !== draft.participant_time_zone) fail('conflict','The client time zone changed. Refresh and review again.');
    const local = localDateTimeWithOffset(`${draft.requested_date}T${draft.requested_time}`,profile.time_zone);
    if(!local.ok) fail('invalid_input','Choose an unambiguous date and time in the client time zone.',400);
    const start = Date.parse(local.value), blockers:string[]=[], warnings:string[]=[];
    if(start < this.clock().getTime()) blockers.push('Choose a time that has not already passed.');
    const check = (await db.query(`select c.revision,c.accepted_version,a.plan from companion_local.daily_checkins c
      left join companion_local.accepted_day_plan_versions a on a.checkin_id=c.id and a.version=c.accepted_version
      where c.participant_id=$1 and c.local_date=$2`, [ctx.participant,draft.requested_date])).rows[0];
    if(exclude&&check?.plan)check.plan={...check.plan,tasks:check.plan.tasks.filter((t:{id:string})=>t.id!==exclude.task_id)};
    const capacity = (await db.query('select local_date::text,revision,available_minutes,rest_minutes from companion_local.request_day_capacity where participant_id=$1 and local_date=$2', [ctx.participant,draft.requested_date])).rows[0];
    if(capacity&&exclude)capacity.available_minutes+=exclude.capacity_credit;
    const constraints = (await db.query('select * from companion_local.request_constraints where participant_id=$1', [ctx.participant])).rows[0];
    const appointments = (await db.query(`select id,starts_at from companion_local.appointments where participant_id=$1 and (starts_at at time zone $3)::date=$2`, [ctx.participant,draft.requested_date,profile.time_zone])).rows;
    const records = (await db.query(`select a.id,a.source_id,a.kind,a.status,a.scheduled_at,a.revision,t.duration_minutes from companion_local.activity_records a
      left join companion_local.task_definitions t on t.id=a.source_id and t.participant_id=a.participant_id
      where a.participant_id=$1 and (a.local_date=$2 or (a.scheduled_at at time zone $3)::date=$2) order by a.id`, [ctx.participant,draft.requested_date,profile.time_zone])).rows.filter(r=>r.id!==exclude?.activity_id);
    const spent = (await db.query(`select coalesce(sum((r.accepted_draft->>'estimated_duration_minutes')::int+(r.accepted_draft->>'travel_minutes')::int),0)::int as minutes
      from companion_local.task_requests r left join companion_local.activity_records a on a.participant_id=r.participant_id and a.id=r.activity_id
      where r.participant_id=$1 and r.status='accepted' and ($4::uuid is null or r.id<>$4) and coalesce(((case when a.status='completed' then a.occurred_at else a.scheduled_at end) at time zone $3)::date::text,r.accepted_draft->>'requested_date')=$2`, [ctx.participant,draft.requested_date,profile.time_zone,exclude?.request_id??null])).rows[0].minutes;
    const duration = draft.estimated_duration_minutes, total = (duration ?? 0)+draft.travel_minutes;
    const end = start+(duration ?? 1)*60000+(capacity?.rest_minutes ?? 0)*60000;
    const travelStart = start-draft.travel_minutes*60000;
    if(dateInZone(new Date(travelStart),profile.time_zone)!==draft.requested_date||dateInZone(new Date(end-1),profile.time_zone)!==draft.requested_date)
      blockers.push('Keep this task, travel and rest within the same day. Choose another time.');
    if(duration === null) warnings.push('Ask the client how long this task and any assistance will take before accepting.');
    if(!capacity) warnings.push('Ask the client how much additional activity feels manageable that day. Free time does not establish capacity.');
    if(capacity && duration !== null && total > capacity.available_minutes) blockers.push('This needs more time or effort than the client currently wants to take on. Offer less work, another day or help.');
    if(constraints?.max_task_minutes != null && duration != null && total > constraints.max_task_minutes) blockers.push('This conflicts with an approved task limit. Offer less work or help.');
    if(constraints?.max_daily_request_minutes != null && duration != null && total+spent > constraints.max_daily_request_minutes) blockers.push('This conflicts with an approved daily limit. Offer another day or help.');
    for(const window of constraints?.blocked_windows ?? []) {
      if(typeof window?.starts_at !== 'string' || typeof window?.ends_at !== 'string' || !Number.isFinite(Date.parse(window.starts_at)) || !Number.isFinite(Date.parse(window.ends_at))) {
        blockers.push('An approved timing limit needs clarification before accepting.'); continue;
      }
      if(travelStart < Date.parse(window.ends_at) && end > Date.parse(window.starts_at)) blockers.push('This conflicts with an approved rest or timing limit. Choose another time.');
    }
    let schedule_review_required = appointments.length > 0 || !!check?.plan?.meals?.length;
    for(const appointment of appointments) {
      const report=records.find(r=>r.kind==='appointment'&&r.source_id===appointment.id);
      if(report?.status==='completed'||report?.status==='voided')continue;
      const scheduled = Date.parse(report?.scheduled_at ?? appointment.starts_at);
      if(travelStart <= scheduled && end > scheduled) blockers.push('This overlaps another planned commitment. Choose another time.');
    }
    for(const task of check?.plan?.tasks ?? []) {
      const report=records.find(r=>r.kind==='task'&&r.source_id===task.id);
      if(report?.status==='completed'||report?.status==='voided')continue;
      const when=report?.scheduled_at ? {ok:true as const,value:new Date(report.scheduled_at).toISOString()} : task.scheduled_time ? localDateTimeWithOffset(`${draft.requested_date}T${task.scheduled_time}`,profile.time_zone) : null;
      if(!when?.ok || !task.duration_minutes) schedule_review_required=true;
      if(when?.ok && travelStart < Date.parse(when.value)+(task.duration_minutes ?? 1)*60000+(capacity?.rest_minutes ?? 0)*60000 && end > Date.parse(when.value)) blockers.push('This overlaps another planned commitment. Choose another time.');
    }
    // Persisted accepted/moved occurrences remain commitments even if a later
    // day-plan version omitted them. They must participate in feasibility.
    const planTaskIds=new Set((check?.plan?.tasks??[]).map((t:{id:string})=>t.id));
    for(const record of records) {
      if(record.kind!=='task'||planTaskIds.has(record.source_id)||!record.scheduled_at||record.status==='completed'||record.status==='voided')continue;
      if(!record.duration_minutes)schedule_review_required=true;
      if(travelStart<Date.parse(record.scheduled_at)+(record.duration_minutes??1)*60000+(capacity?.rest_minutes??0)*60000&&end>Date.parse(record.scheduled_at))blockers.push('This overlaps another planned commitment. Choose another time.');
    }
    if(schedule_review_required) warnings.push('The client should review meals, travel, assistance and commitments whose full timing is not recorded before accepting.');
    const review_token=digest(canonical({ctx,draft,profile,check,capacity:capacity??null,constraints:constraints??null,appointments,records,spent}));
    return {draft,review_token,profile_revision:profile.revision,day_revision:check?.revision??0,capacity_revision:capacity?.revision??0,
      warnings:[...new Set(warnings)],blockers:[...new Set(blockers)],can_accept:!!capacity&&duration!==null&&!blockers.length,capacity_known:!!capacity,schedule_review_required,
      capacity:ctx.role==='client'?capacity??null:null};
  }
  async receipt(session: Session, key: string): Promise<TaskRequestReceipt|null> {
    try { const ctx=await this.context(this.pool,session);
      if(!/^[0-9a-f-]{36}$/i.test(key)) fail('invalid_input','Invalid receipt identifier.',400);
      const row=(await this.pool.query('select command,result from companion_local.request_receipts where participant_id=$1 and actor_id=$2 and command_id=$3',[ctx.participant,ctx.actor,key])).rows[0];
      if(!row)return null; this.authorizeCommand(ctx,taskRequestCommandSchema.parse(row.command));
      if(canonical(await this.context(this.pool,session))!==canonical(ctx))fail('forbidden','Sharing changed. Refresh before continuing.',403);
      return row.result;
    }catch(error){return mapError(error);}
  }
  async command(session: Session, input: TaskRequestCommand): Promise<TaskRequestReceipt> {
    try {
      const command=taskRequestCommandSchema.parse(input);
      return await this.transaction(async db=>{
        const ctx=await this.context(db,session,true);this.authorizeCommand(ctx,command);
        // All existing care mutations use this same participant lock. A review is rederived under it.
        await db.query('select id from companion_local.participant_profiles where id=$1 for update',[ctx.participant]);
        const prior=(await db.query('select actor_id,command,result from companion_local.request_receipts where participant_id=$1 and command_id=$2',[ctx.participant,command.idempotency_key])).rows[0];
        if(prior){if(prior.actor_id!==ctx.actor||canonical(prior.command)!==canonical(command))fail('conflict','This receipt key belongs to a different change.');return {...prior.result,replayed:true};}
        const collision=(await db.query(`select 1 from companion_local.command_receipts where participant_id=$1 and command_id=$2
          union all select 1 from companion_local.append_only_mutations where participant_id=$1 and command_id=$2`,[ctx.participant,command.idempotency_key])).rowCount;
        if(collision)fail('conflict','This receipt key belongs to another change.');
        const now=this.clock();let result:TaskRequestReceipt={command_id:command.idempotency_key,type:command.type,request_id:null,help_id:null,flag_id:null,task_id:null,activity_id:null,revision:1,result:command.type,replayed:false};
        if(command.type==='set_day_capacity') {
          const p=(await db.query('select time_zone from companion_local.participant_profiles where id=$1',[ctx.participant])).rows[0];
          if(command.local_date<dateInZone(now,p.time_zone))fail('invalid_input','Choose today or a future day.',400);
          const row=(await db.query('select revision from companion_local.request_day_capacity where participant_id=$1 and local_date=$2',[ctx.participant,command.local_date])).rows[0];
          if((row?.revision??0)!==command.expected_revision)fail('conflict','The capacity statement changed. Refresh before saving.');
          result.revision=command.expected_revision+1;
          await db.query(`insert into companion_local.request_day_capacity(participant_id,local_date,available_minutes,rest_minutes,revision,stated_by,updated_at)
            values($1,$2,$3,$4,$5,$6,$7) on conflict(participant_id,local_date) do update set available_minutes=$3,rest_minutes=$4,revision=$5,stated_by=$6,updated_at=$7`,[ctx.participant,command.local_date,command.available_minutes,command.rest_minutes,result.revision,ctx.actor,now]);
        } else if(command.type==='set_request_access') {
          if(command.role==='family_friend'&&command.capabilities.includes('review_request_flags')||command.role==='administrator'&&command.capabilities.includes('help_requests'))fail('invalid_input','Choose permissions available for this role.',400);
          const grant=(await db.query(`select g.id from companion_local.role_grants g join companion_local.accounts a on a.id=g.actor_id where g.participant_id=$1 and g.actor_id=$2 and g.role=$3 and g.revoked_at is null and a.disabled_at is null for share of g,a`,[ctx.participant,command.actor_id,command.role])).rows[0];
          if(!grant)fail('forbidden','This person has no active access to this client.',403);
          const old=(await db.query('select revision from companion_local.request_access where participant_id=$1 and actor_id=$2 and role=$3',[ctx.participant,command.actor_id,command.role])).rows[0];
          if((old?.revision??0)!==command.expected_revision)fail('conflict','Sharing changed. Refresh before saving.');
          result.revision=command.expected_revision+1;
          await db.query(`insert into companion_local.request_access(participant_id,actor_id,role,capabilities,revision,granted_by,updated_at) values($1,$2,$3,$4,$5,$6,$7)
            on conflict(participant_id,actor_id,role) do update set capabilities=$4,revision=$5,granted_by=$6,updated_at=$7`,[ctx.participant,command.actor_id,command.role,command.capabilities,result.revision,ctx.actor,now]);
        } else if(command.type==='submit_request') {
          const review=await this.reviewFor(db,ctx,command.draft);this.checkReview(command.review_token,review,false);
          const when=localDateTimeWithOffset(`${command.draft.requested_date}T${command.draft.requested_time}`,command.draft.participant_time_zone);if(!when.ok)fail('invalid_input','Choose a valid time.',400);
          result.request_id=randomUUID();
          await db.query(`insert into companion_local.task_requests(id,participant_id,requester_id,requester_role,revision,draft,requested_at,status,submission_review,created_at,updated_at)
            values($1,$2,$3,$4,1,$5,$6,'pending',$7,$8,$8)`,[result.request_id,ctx.participant,ctx.actor,ctx.role,JSON.stringify(command.draft),when.value,JSON.stringify(review),now]);
        } else if(command.type==='accept_request'||command.type==='reject_request'||command.type==='withdraw_request') {
          const row=(await db.query('select * from companion_local.task_requests where id=$1 and participant_id=$2 for update',[command.request_id,ctx.participant])).rows[0];
          if(!row)fail('not_found','This request is not available.',404);
          if(row.revision!==command.expected_revision||row.status!=='pending')fail('conflict','This request changed or has already been decided.');
          result.request_id=row.id;result.revision=row.revision+1;
          if(command.type==='withdraw_request') {
            if(row.requester_id!==ctx.actor||row.requester_role!==ctx.role)fail('forbidden','Only the requester can withdraw this request.',403);
            await db.query(`update companion_local.task_requests set status='withdrawn',revision=$2,decided_by=$3,updated_at=$4 where id=$1`,[row.id,result.revision,ctx.actor,now]);
          } else if(command.type==='reject_request') {
            result.help_id=randomUUID();result.flag_id=randomUUID();
            await db.query(`update companion_local.task_requests set status='rejected',reason=$2,revision=$3,decided_by=$4,updated_at=$5 where id=$1`,[row.id,command.reason,result.revision,ctx.actor,now]);
            await db.query(`insert into companion_local.request_help(id,participant_id,request_id,revision,status,updated_at) values($1,$2,$3,1,'unassigned',$4)`,[result.help_id,ctx.participant,row.id,now]);
            await db.query(`insert into companion_local.request_flags(id,participant_id,request_id,help_id,revision,status,updated_at) values($1,$2,$3,$4,1,'open',$5)`,[result.flag_id,ctx.participant,row.id,result.help_id,now]);
          } else {
            const active=(await db.query(`select g.id from companion_local.role_grants g join companion_local.accounts a on a.id=g.actor_id
              join companion_local.request_access x on x.participant_id=g.participant_id and x.actor_id=g.actor_id and x.role=g.role
              where g.participant_id=$1 and g.actor_id=$2 and g.role=$3 and g.revoked_at is null and a.disabled_at is null and 'request_tasks'=any(x.capabilities) for share of g,a,x`,[ctx.participant,row.requester_id,row.requester_role])).rows[0];
            if(!active)fail('forbidden','The requester no longer has permission. This request cannot be accepted.',403);
            if(command.draft.task_name!==row.draft.task_name||command.draft.notes!==row.draft.notes)fail('invalid_input','A different task needs a new request.',400);
            const review=await this.reviewFor(db,ctx,command.draft);this.checkReview(command.review_token,review,true);
            const linkage=await this.accept(db,ctx,command.draft,review,now,command.idempotency_key);result.task_id=linkage.task_id;result.activity_id=linkage.activity_id;
            await db.query(`update companion_local.task_requests set status='accepted',accepted_draft=$2,accepted_at=$3,decision_review=$4,revision=$5,decided_by=$6,task_id=$7,activity_id=$8,accepted_plan_id=$9,updated_at=$3 where id=$1`,
              [row.id,JSON.stringify(command.draft),now,JSON.stringify(review),result.revision,ctx.actor,linkage.task_id,linkage.activity_id,linkage.accepted_plan_id]);
          }
        } else if(command.type==='acknowledge_flag') {
          const flag=(await db.query('select * from companion_local.request_flags where id=$1 and participant_id=$2 for update',[command.flag_id,ctx.participant])).rows[0];
          if(!flag)fail('not_found','This flag is not available.',404);
          if(flag.revision!==command.expected_revision||flag.status!=='open')fail('conflict','This flag has changed. Refresh before continuing.');
          result.flag_id=flag.id;result.request_id=flag.request_id;result.help_id=flag.help_id;result.revision=flag.revision+1;
          await db.query(`update companion_local.request_flags set status='acknowledged',revision=$2,acknowledged_by=$3,updated_at=$4 where id=$1`,[flag.id,result.revision,ctx.actor,now]);
        } else {
          const help=(await db.query(`select h.*,r.requester_id from companion_local.request_help h join companion_local.task_requests r on r.id=h.request_id where h.id=$1 and h.participant_id=$2 for update of h`,[command.help_id,ctx.participant])).rows[0];
          if(!help)fail('not_found','This help request is not available.',404);
          if(help.revision!==command.expected_revision||help.status==='resolved')fail('conflict','This help request changed. Refresh before continuing.');
          result.help_id=help.id;result.request_id=help.request_id;result.revision=help.revision+1;
          if(command.type==='volunteer_help') {
            if(help.requester_id===ctx.actor)fail('forbidden','This help request is offered to other family members.',403);
            const oldHelper=help.volunteer_id?(await db.query(`select 1 from companion_local.request_access x join companion_local.role_grants g on g.participant_id=x.participant_id and g.actor_id=x.actor_id and g.role=x.role
              join companion_local.accounts a on a.id=x.actor_id where x.participant_id=$1 and x.actor_id=$2 and x.role='family_friend' and 'help_requests'=any(x.capabilities) and g.revoked_at is null and a.disabled_at is null`,[ctx.participant,help.volunteer_id])).rows[0]:null;
            if(help.status==='volunteered'&&oldHelper)fail('conflict','Someone has already volunteered.');
            await db.query(`update companion_local.request_help set status='volunteered',volunteer_id=$2,revision=$3,updated_at=$4 where id=$1`,[help.id,ctx.actor,result.revision,now]);
          } else {
            if(ctx.role==='family_friend'&&(help.volunteer_id!==ctx.actor||help.requester_id===ctx.actor))fail('forbidden','Only the volunteering helper can resolve this.',403);
            await db.query(`update companion_local.request_help set status='resolved',resolution=$2,revision=$3,updated_at=$4 where id=$1`,[help.id,command.resolution,result.revision,now]);
            const flag=(await db.query(`update companion_local.request_flags set status='resolved',revision=revision+1,updated_at=$2 where help_id=$1 returning id`,[help.id,now])).rows[0];result.flag_id=flag?.id??null;
          }
        }
        // Accepted occurrences use the existing ledger provenance foreign key.
        // Keep its immutable receipt alongside the actor-scoped request receipt.
        if(command.type==='accept_request')await db.query(`insert into companion_local.append_only_mutations(participant_id,actor_id,command_id,command,result,event_type,created_at) values($1,$2,$3,$4,$5,$6,$7)`,
          [ctx.participant,ctx.actor,command.idempotency_key,JSON.stringify(command),JSON.stringify(result),'TaskRequestAccepted',now]);
        await db.query(`insert into companion_local.request_receipts(participant_id,actor_id,command_id,command,result,created_at) values($1,$2,$3,$4,$5,$6)`,[ctx.participant,ctx.actor,command.idempotency_key,JSON.stringify(command),JSON.stringify(result),now]);
        await db.query(`insert into companion_local.domain_events(participant_id,actor_id,command_id,event_type,data,created_at) values($1,$2,$3,$4,$5,$6)`,[ctx.participant,ctx.actor,command.idempotency_key,`TaskRequest:${command.type}`,JSON.stringify(result),now]);
        return result;
      });
    } catch(error) { return mapError(error); }
  }
  private checkReview(token: string, review: TaskRequestReview, accepting: boolean) {
    if(token!==review.review_token)fail('conflict','The schedule, permissions or capacity changed. Review again.');
    if(review.blockers.length)fail('capacity_conflict',review.blockers[0]);
    if(accepting&&!review.can_accept)fail('capacity_unknown','Review the task duration and state what feels manageable before accepting.');
  }
  private async accept(db: Db, ctx: Context, draft: TaskRequestDraft, review: TaskRequestReview, now: Date, commandId:string) {
    const task_id=randomUUID(),proposal_id=randomUUID(),stamp=now.toISOString();
    let check=(await db.query('select * from companion_local.daily_checkins where participant_id=$1 and local_date=$2',[ctx.participant,draft.requested_date])).rows[0];
    if(!check)check=(await db.query('insert into companion_local.daily_checkins(participant_id,local_date) values($1,$2) returning *',[ctx.participant,draft.requested_date])).rows[0];
    const old=(await db.query('select plan from companion_local.accepted_day_plan_versions where checkin_id=$1 and version=$2',[check.id,check.accepted_version])).rows[0]?.plan as AcceptedPlan|undefined;
    if((old?.tasks.length??0)>=20)fail('capacity_conflict','The day already has many tasks. Review the existing plan before adding another.');
    const version=(check.accepted_version??0)+1, profileRevision=review.profile_revision+1;
    const task={id:task_id,title:draft.task_name,time_hint:null,urgency:draft.priority,scheduled_date:draft.requested_date,scheduled_time:draft.requested_time,category:'task' as const,duration_minutes:draft.estimated_duration_minutes};
    const plan={id:proposal_id,task_ids:[...(old?.task_ids??[]),task_id],tasks:[...(old?.tasks??[]),task],meals:old?.meals??[],created_at:stamp,version,accepted_at:stamp};
    await db.query(`insert into companion_local.task_definitions(id,participant_id,title,urgency,scheduled_date,scheduled_time,category,duration_minutes,setup_revision)
      values($1,$2,$3,$4,$5,$6,'task',$7,$8)`,[task_id,ctx.participant,draft.task_name,draft.priority,draft.requested_date,draft.requested_time,draft.estimated_duration_minutes,profileRevision]);
    await db.query('update companion_local.participant_profiles set revision=$2,updated_at=$3 where id=$1',[ctx.participant,profileRevision,now]);
    await db.query(`insert into companion_local.day_plan_proposals(id,checkin_id,participant_id,setup_revision,checkin_revision,plan) values($1,$2,$3,$4,$5,$6)`,[proposal_id,check.id,ctx.participant,profileRevision,check.revision+1,JSON.stringify(plan)]);
    const accepted=(await db.query(`insert into companion_local.accepted_day_plan_versions(checkin_id,participant_id,version,proposal_id,plan,accepted_at) values($1,$2,$3,$4,$5,$6) returning id`,[check.id,ctx.participant,version,proposal_id,JSON.stringify(plan),now])).rows[0];
    await db.query('update companion_local.daily_checkins set revision=revision+1,current_proposal_id=$2,accepted_version=$3,updated_at=$4 where id=$1',[check.id,proposal_id,version,now]);
    await db.query(`update companion_local.request_day_capacity set available_minutes=available_minutes-$3,revision=revision+1,updated_at=$4 where participant_id=$1 and local_date=$2`,[ctx.participant,draft.requested_date,draft.estimated_duration_minutes!+draft.travel_minutes,now]);
    const activity_id=activityId(ctx.participant,draft.requested_date,'task',task_id);
    const scheduled=localDateTimeWithOffset(`${draft.requested_date}T${draft.requested_time}`,draft.participant_time_zone);
    if(!scheduled.ok)fail('invalid_input','Choose a valid time.',400);
    await db.query(`insert into companion_local.activity_records(id,participant_id,local_date,kind,title,source_id,plan_id,unplanned,scheduled_at,status,occurred_at,notes,revision,last_action,recorded_at,updated_at,last_actor_id,last_command_id)
      values($1,$2,$3,'task',$4,$5,$6,false,$7,'pending',null,'',1,'accepted',$8,$8,$9,$10)`,[activity_id,ctx.participant,draft.requested_date,draft.task_name,task_id,proposal_id,scheduled.value,now,ctx.actor,commandId]);
    return {task_id,activity_id,accepted_plan_id:accepted.id};
  }
  /** Called only inside the care service's existing participant transaction.
   * Rechecks current constraints and reconciles reserved client-stated capacity.
   * The activity command owns the schedule write and its idempotent receipt. */
  async reconcileReschedule(db: PoolClient,session:Session,activityId:string,scheduledAt:string):Promise<{request_id:string;previous_date:string;review:TaskRequestReview;capacity_transfer_minutes:number}|null> {
    if(!(await db.query("select to_regclass('companion_local.task_requests') as name")).rows[0]?.name)return null;
    const ctx=await this.context(db,session,true);this.requireClient(ctx);
    const request=(await db.query(`select r.*,a.scheduled_at from companion_local.task_requests r
      join companion_local.activity_records a on a.id=r.activity_id and a.participant_id=r.participant_id
      where r.participant_id=$1 and r.activity_id=$2 and r.status='accepted' for update of r`,[ctx.participant,activityId])).rows[0];
    if(!request)return null;
    const profile=(await db.query('select time_zone from companion_local.participant_profiles where id=$1',[ctx.participant])).rows[0];
    const instant=new Date(scheduledAt),day=dateInZone(instant,profile.time_zone);
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:profile.time_zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant);
    const values=Object.fromEntries(parts.map(p=>[p.type,p.value]));
    const draft:TaskRequestDraft={...request.accepted_draft,requested_date:day,requested_time:`${values.hour}:${values.minute}`,participant_time_zone:profile.time_zone};
    const previousDay=dateInZone(new Date(request.scheduled_at),profile.time_zone),effort=draft.estimated_duration_minutes!+draft.travel_minutes;
    const review=await this.reviewFor(db,ctx,draft,{request_id:request.id,task_id:request.task_id,activity_id:activityId,capacity_credit:day===previousDay?effort:0});
    if(review.blockers.length)fail('capacity_conflict',review.blockers[0]);
    if(!review.can_accept)fail('capacity_unknown','State what feels manageable on the new day before moving this accepted request.');
    if(day!==previousDay) {
      await db.query(`update companion_local.request_day_capacity set available_minutes=least(960,available_minutes+$3),revision=revision+1,updated_at=$4 where participant_id=$1 and local_date=$2`,[ctx.participant,previousDay,effort,this.clock()]);
      await db.query(`update companion_local.request_day_capacity set available_minutes=available_minutes-$3,revision=revision+1,updated_at=$4 where participant_id=$1 and local_date=$2`,[ctx.participant,day,effort,this.clock()]);
    }
    return {request_id:request.id,previous_date:previousDay,review,capacity_transfer_minutes:day===previousDay?0:effort};
  }
}
