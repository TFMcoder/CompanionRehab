import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { ZodError } from 'zod';
import { dateInZone } from '../shared/contracts.js';
import { operationsCommandSchema, operationsQuerySchema, type OperationsCommand, type OperationsQuery, type OperationsReceipt,
  type OperationsWorkspace, type OperationsDay, type ConnectorHealth, type HeldIntentReview } from '../shared/operations-contracts.js';
import { ApiError, unavailable } from './errors.js';
import { canonicalJson, localAuthority, localTransaction, lockParticipant, previousLocalCommand, saveLocalCommand,
  type LocalAuthority, type LocalDb } from './local-authority.js';
import type { Session } from './session.js';

type Access={revision:number;can_view:boolean;can_manage_local_issues:boolean;can_view_audit:boolean}|null;
const digest=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const iso=(value:Date|string|null)=>value?new Date(value).toISOString():null;
const conflict=(message='This operation changed. Refresh and review again.'):never=>{throw new ApiError(409,'conflict',message);};
function mapError(error:unknown):never {
  if(error instanceof ApiError)throw error;
  if(error instanceof ZodError)throw new ApiError(400,'invalid_input','Check the operation details and try again.');
  const code=(error as {code?:string})?.code;
  if(['23505','23503','40001','40P01'].includes(code??''))return conflict();
  if(['23514','22P02','22023'].includes(code??''))throw new ApiError(400,'invalid_input','Check the operation details and try again.');
  throw unavailable();
}
function validDay(date:string) {if(dateInZone(new Date(`${date}T12:00:00Z`),'UTC')!==date)throw new ApiError(400,'invalid_input','Choose a real date.');}
function parseCursor(input:string|undefined,scope:string) {
  if(!input)return null;
  try{const value=JSON.parse(Buffer.from(input,'base64url').toString('utf8'));
    if(value?.scope!==scope||typeof value.at!=='string'||typeof value.id!=='string'||!Number.isFinite(Date.parse(value.at)))throw Error();
    return {at:value.at as string,id:value.id as string};
  }catch{throw new ApiError(409,'conflict','This view changed. Refresh before continuing.');}
}
function nextCursor(scope:string,at:string,id:string) {return Buffer.from(JSON.stringify({scope,at,id})).toString('base64url');}

/** Local, scoped operations review. This class does not enable or call connectors. */
export class OperationsService {
  private readonly clock:()=>Date;
  constructor(private readonly pool:Pool,options:{clock?:()=>Date}={}) {this.clock=options.clock??(()=>new Date());}
  private async access(db:LocalDb,ctx:LocalAuthority):Promise<Access> {
    if(ctx.role!=='administrator')return null;
    return (await db.query('select revision,can_view,can_manage_local_issues,can_view_audit from companion_local.operations_access where participant_id=$1 and actor_id=$2 and role=$3',[ctx.participant,ctx.actor,ctx.role])).rows[0]??null;
  }
  private requireView(ctx:LocalAuthority,access:Access) {
    if(ctx.role!=='administrator'||!access?.can_view)throw new ApiError(403,'forbidden','Operations are not shared with this account.');
  }
  private requireManage(ctx:LocalAuthority,access:Access) {
    this.requireView(ctx,access);
    if(!access?.can_manage_local_issues)throw new ApiError(403,'forbidden','Local issue review is not shared with this account.');
  }
  private async operators(db:LocalDb,ctx:LocalAuthority) {
    if(ctx.role!=='client')return [];
    return (await db.query(`select g.actor_id,a.email label,coalesce(o.revision,0) revision,coalesce(o.can_view,false) can_view,
      coalesce(o.can_manage_local_issues,false) can_manage_local_issues,coalesce(o.can_view_audit,false) can_view_audit
      from companion_local.role_grants g join companion_local.accounts a on a.id=g.actor_id
      left join companion_local.operations_access o on o.participant_id=g.participant_id and o.actor_id=g.actor_id and o.role=g.role
      where g.participant_id=$1 and g.role='administrator' and g.revoked_at is null and a.disabled_at is null order by a.email`,[ctx.participant])).rows;
  }
  private async day(db:LocalDb,ctx:LocalAuthority,date:string):Promise<OperationsDay> {
    const [plan,actual,appointments]=await Promise.all([
      db.query(`select c.accepted_version,v.plan,v.accepted_at from companion_local.daily_checkins c
        left join companion_local.accepted_day_plan_versions v on v.checkin_id=c.id and v.version=c.accepted_version
        where c.participant_id=$1 and c.local_date=$2`,[ctx.participant,date]),
      db.query(`select kind,status,updated_at from companion_local.activity_records
        where participant_id=$1 and kind in ('task','meal') and
          ((status='completed' and (occurred_at at time zone $3)::date=$2)
            or (status<>'completed' and (local_date=$2 or (scheduled_at at time zone $3)::date=$2)))`,[ctx.participant,date,ctx.zone]),
      db.query(`select created_at from companion_local.appointments where participant_id=$1 and (starts_at at time zone $3)::date=$2`,[ctx.participant,date,ctx.zone]),
    ]);
    const saved=plan.rows[0],tasks=(saved?.plan?.tasks??[]) as unknown[],meals=(saved?.plan?.meals??[]) as unknown[];
    const count=(kind:string,status:string)=>actual.rows.filter(r=>r.kind===kind&&r.status===status).length;
    const stamps=[saved?.accepted_at,...actual.rows.map(r=>r.updated_at),...appointments.rows.map(r=>r.created_at)].filter(Boolean).map(v=>new Date(v).getTime());
    return {local_date:date,accepted_plan_version:saved?.accepted_version??null,planned_tasks:tasks.length,planned_meals:meals.length,
      completed_tasks:count('task','completed'),completed_meals:count('meal','completed'),
      deferred_tasks:count('task','deferred'),deferred_meals:count('meal','deferred'),appointments_scheduled:appointments.rows.length,
      source_as_of:stamps.length?new Date(Math.max(...stamps)).toISOString():null};
  }
  private async connector(db:LocalDb,ctx:LocalAuthority):Promise<ConnectorHealth> {
    const row=(await db.query(`select
      (select count(*)::int from companion_local.actuation_targets where participant_id=$1) targets,
      (select count(*)::int from companion_local.external_resource_links where participant_id=$1) linked_resources,
      (select count(*)::int from companion_local.actuation_intents where participant_id=$1 and state='held') held_intents`,[ctx.participant])).rows[0];
    return {state:'not_connected',targets:row.targets,linked_resources:row.linked_resources,held_intents:row.held_intents,failed_syncs:'unknown',last_sync_at:null};
  }
  async workspace(session:Session,raw:OperationsQuery={}):Promise<OperationsWorkspace> {
    try {
      const query=operationsQuerySchema.parse(raw),ctx=await localAuthority(this.pool,session,this.clock()),access=await this.access(this.pool,ctx);
      if(ctx.role!=='client')this.requireView(ctx,access);
      const date=query.date??dateInZone(this.clock(),ctx.zone);validDay(date);
      const operators=await this.operators(this.pool,ctx);
      if(ctx.role==='client'){
        const fresh=await localAuthority(this.pool,session,this.clock());
        if(fresh.grant!==ctx.grant)throw new ApiError(403,'forbidden','Client access changed. Refresh before continuing.');
        return {role:'client',local_date:date,can_view:false,can_manage_local_issues:false,can_view_audit:false,
          operators,day:null,connector:null,held_intents:[],next_cursor:null,audit:[],audit_available:false};
      }
      const scope=digest([ctx.grant,access?.revision,access?.can_view,access?.can_manage_local_issues,access?.can_view_audit,date]);
      const after=parseCursor(query.cursor,scope),limit=query.limit??20;
      const [day,connector,issues,audit]=await Promise.all([
        this.day(this.pool,ctx,date),this.connector(this.pool,ctx),
        this.pool.query(`select i.id,i.created_at,i.operation,i.state,t.system,t.provider,r.status review_status,r.revision review_revision,
          r.note review_note,r.updated_at reviewed_at from companion_local.actuation_intents i
          join companion_local.actuation_targets t on t.participant_id=i.participant_id and t.id=i.target_id
          left join companion_local.operations_issue_reviews r on r.participant_id=i.participant_id and r.intent_id=i.id
          where i.participant_id=$1 and ($2::timestamptz is null or (i.created_at,i.id)<($2::timestamptz,$3::uuid))
          order by i.created_at desc,i.id desc limit $4`,[ctx.participant,after?.at??null,after?.id??null,limit+1]),
        access?.can_view_audit?this.pool.query(`select id,event_type,created_at,actor_id,command_id from companion_local.domain_events
          where participant_id=$1 order by created_at desc,id desc limit 30`,[ctx.participant]):Promise.resolve({rows:[]}),
      ]);
      const latest=await localAuthority(this.pool,session,this.clock()),latestAccess=await this.access(this.pool,latest);
      if(latest.grant!==ctx.grant||digest(latestAccess)!==digest(access))throw new ApiError(403,'forbidden','Operator access changed. Refresh before continuing.');
      const selected=issues.rows.slice(0,limit);
      const held:HeldIntentReview[]=selected.map(r=>({id:r.id,created_at:iso(r.created_at)!,system:r.system,provider:r.provider,operation:r.operation,
        state:'held',review_status:r.review_status??'unreviewed',review_revision:r.review_revision??0,review_note:r.review_note??null,reviewed_at:iso(r.reviewed_at)}));
      const last=selected.at(-1);
      return {role:'administrator',local_date:date,can_view:true,can_manage_local_issues:!!access?.can_manage_local_issues,can_view_audit:!!access?.can_view_audit,
        operators:[],day,connector,held_intents:held,next_cursor:issues.rows.length>limit&&last?nextCursor(scope,iso(last.created_at)!,last.id):null,
        audit:audit.rows.map(r=>({id:r.id,event_type:r.event_type,created_at:iso(r.created_at)!,actor_id:r.actor_id,command_id:r.command_id})),
        audit_available:!!access?.can_view_audit};
    }catch(error){return mapError(error);}
  }
  async receipt(session:Session,key:string):Promise<OperationsReceipt|null> {
    try {
      const ctx=await localAuthority(this.pool,session,this.clock()),access=await this.access(this.pool,ctx);
      if(ctx.role!=='client')this.requireView(ctx,access);
      const row=(await this.pool.query(`select actor_id,result from companion_local.append_only_mutations where participant_id=$1 and command_id=$2 and event_type like 'Operations%'`,[ctx.participant,key])).rows[0];
      if(!row||row.actor_id!==ctx.actor)return null;
      const fresh=await localAuthority(this.pool,session,this.clock());
      if(fresh.grant!==ctx.grant||digest(await this.access(this.pool,fresh))!==digest(access))throw new ApiError(403,'forbidden','Operator access changed. Refresh before continuing.');
      return {command_id:key,result:row.result,replayed:true};
    }catch(error){return mapError(error);}
  }
  async command(session:Session,raw:OperationsCommand):Promise<OperationsReceipt> {
    try {
      const command=operationsCommandSchema.parse(raw);
      if(command.type==='set_operations_access'&&(!command.can_view&&(command.can_manage_local_issues||command.can_view_audit)))
        throw new ApiError(400,'invalid_input','Enable the operations view before granting issue or audit access.');
      return await localTransaction(this.pool,async db=>{
        const ctx=await localAuthority(db,session,this.clock(),true);await lockParticipant(db,ctx);
        const access=await this.access(db,ctx);
        if(command.type==='set_operations_access'){
          if(ctx.role!=='client')throw new ApiError(403,'forbidden','Only the client can grant operator access.');
        } else this.requireManage(ctx,access);
        const prior=await previousLocalCommand(db,ctx,command.idempotency_key,command,'Operations');
        if(prior){const {replayed:_ignored,...result}=prior;return {command_id:command.idempotency_key,result,replayed:true};}
        let result:Record<string,unknown>;let event:string;
        if(command.type==='set_operations_access') {
          if(ctx.role!=='client')throw new ApiError(403,'forbidden','Only the client can grant operator access.');
          const grant=(await db.query(`select 1 from companion_local.role_grants g join companion_local.accounts a on a.id=g.actor_id
            where g.participant_id=$1 and g.actor_id=$2 and g.role='administrator' and g.revoked_at is null and a.disabled_at is null for share of g,a`,[ctx.participant,command.actor_id])).rows[0];
          if(!grant)throw new ApiError(400,'invalid_input','Choose an active scoped administrator account.');
          const old=(await db.query("select revision from companion_local.operations_access where participant_id=$1 and actor_id=$2 and role='administrator' for update",[ctx.participant,command.actor_id])).rows[0];
          if((old?.revision??0)!==command.expected_revision)return conflict();
          const saved=(await db.query(`insert into companion_local.operations_access(participant_id,actor_id,role,can_view,can_manage_local_issues,can_view_audit,updated_at)
            values($1,$2,'administrator',$3,$4,$5,$6) on conflict(participant_id,actor_id,role) do update set can_view=excluded.can_view,
              can_manage_local_issues=excluded.can_manage_local_issues,can_view_audit=excluded.can_view_audit,
              revision=operations_access.revision+1,updated_at=excluded.updated_at returning revision`,
            [ctx.participant,command.actor_id,command.can_view,command.can_manage_local_issues,command.can_view_audit,this.clock()])).rows[0];
          result={actor_id:command.actor_id,revision:saved.revision,can_view:command.can_view,
            can_manage_local_issues:command.can_manage_local_issues,can_view_audit:command.can_view_audit};event='OperationsAccessChanged';
        } else {
          this.requireManage(ctx,access);
          const intent=(await db.query(`select id,state from companion_local.actuation_intents where participant_id=$1 and id=$2 for share`,[ctx.participant,command.intent_id])).rows[0];
          if(!intent||intent.state!=='held')throw new ApiError(404,'not_found','That held local issue is unavailable.');
          const old=(await db.query('select revision from companion_local.operations_issue_reviews where participant_id=$1 and intent_id=$2 for update',[ctx.participant,command.intent_id])).rows[0];
          if((old?.revision??0)!==command.expected_revision)return conflict();
          if(command.type==='resolve_held_intent_review'&&!old)return conflict();
          const status=command.type==='resolve_held_intent_review'?'resolved':'open';
          const saved=(await db.query(`insert into companion_local.operations_issue_reviews(participant_id,intent_id,status,note,updated_by,updated_at)
            values($1,$2,$3,$4,$5,$6) on conflict(participant_id,intent_id) do update set status=excluded.status,note=excluded.note,
              revision=operations_issue_reviews.revision+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at returning revision`,
            [ctx.participant,command.intent_id,status,command.note,ctx.actor,this.clock()])).rows[0];
          result={intent_id:command.intent_id,review_status:status,revision:saved.revision,intent_state:'held'};
          event=command.type==='resolve_held_intent_review'?'OperationsLocalReviewResolved':'OperationsLocalReviewNoted';
        }
        await saveLocalCommand(db,ctx,command,result,event,dateInZone(this.clock(),ctx.zone),result);
        return {command_id:command.idempotency_key,result,replayed:false};
      });
    }catch(error){return mapError(error);}
  }
}
