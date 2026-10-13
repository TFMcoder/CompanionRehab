import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ZodError } from 'zod';
import { dateInZone } from '../shared/contracts.js';
import { localDateTimeWithOffset } from '../shared/local-time.js';
import { programCommandSchema, type ProgramCapability, type ProgramCommand, type ProgramDraft, type ProgramReceipt,
  type ProgramResult, type ProgramRun, type ProgramStep, type ProgramVersion, type ProgramWorkspace } from '../shared/program-contracts.js';
import { ApiError, unavailable } from './errors.js';
import { canonicalJson, localAuthority, localTransaction, lockParticipant, requireClient, type LocalAuthority, type LocalDb } from './local-authority.js';
import type { Session } from './session.js';

type Context = LocalAuthority & { capabilities: ProgramCapability[]; accessRevision: number };
const fail = (code: string, message: string, status = 409): never => { throw new ApiError(status, code, message); };
function mapError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (error instanceof ZodError) return fail('invalid_input', 'Check the program details and try again.', 400);
  const code = (error as {code?:string})?.code;
  if (['23505','23503','40001','40P01'].includes(code??'')) return fail('conflict','The saved program changed. Refresh and review again.');
  if (['23514','22P02','22023'].includes(code??'')) return fail('invalid_input','Check the program details and try again.',400);
  throw unavailable();
}
const iso = (value: Date|string|null) => value ? new Date(value).toISOString() : null;
const day = (value: Date|string) => typeof value === 'string' ? value.slice(0,10) : value.toISOString().slice(0,10);

export class ProgramService {
  private clock: () => Date;
  constructor(private pool: Pool, options: {clock?: () => Date} = {}) { this.clock = options.clock ?? (() => new Date()); }
  private async context(db: LocalDb, session: Session, lock = false): Promise<Context> {
    const base = await localAuthority(db, session, this.clock(), lock);
    const access = (await db.query(`select capabilities,revision from companion_local.program_access
      where participant_id=$1 and actor_id=$2 and role=$3 ${lock?'for share':''}`,[base.participant,base.actor,base.role])).rows[0];
    return {...base,capabilities:access?.capabilities??[],accessRevision:access?.revision??0};
  }
  private permit(ctx: Context, capability: ProgramCapability) {
    if(ctx.role !== 'client' && !ctx.capabilities.includes(capability)) fail('forbidden','This program is not shared with this account.',403);
  }
  private viewKind(ctx: Context, kind: string) { this.permit(ctx,kind==='rehab'?'read_rehab':'read_routine'); }
  private editKind(ctx: Context, kind: string) {
    if(kind==='rehab') {
      if(!['administrator','clinician'].includes(ctx.role) || !ctx.capabilities.includes('edit_rehab')) fail('forbidden','Only a granted protocol editor can enter rehab instructions.',403);
    } else if(ctx.role!=='client') this.permit(ctx,'edit_routine');
  }
  private approveKind(ctx: Context, kind: string) {
    if(kind==='rehab') {
      if(!['administrator','clinician'].includes(ctx.role) || !ctx.capabilities.includes('approve_rehab')) fail('forbidden','A granted human protocol owner must approve rehab instructions.',403);
    } else if(ctx.role!=='client' && (ctx.role!=='administrator'||!ctx.capabilities.includes('edit_routine'))) fail('forbidden','The routine owner must approve this version.',403);
  }
  private async version(db: LocalDb, ctx: Context, id: string, lock = false): Promise<any> {
    const row=(await db.query(`select v.*,d.kind,d.current_version,d.latest_version from companion_local.program_versions v
      join companion_local.program_definitions d on d.id=v.definition_id and d.participant_id=v.participant_id
      where v.id=$1 and v.participant_id=$2 ${lock?'for update of v':''}`,[id,ctx.participant])).rows[0];
    if(!row) fail('not_found','This program version is not available.',404);
    return row;
  }
  private versionView(row:any): ProgramVersion { return {id:row.id,definition_id:row.definition_id,kind:row.kind,title:row.title,
    version:row.version,steps:row.steps,protected_start:row.protected_start?.slice(0,5)??null,protected_end:row.protected_end?.slice(0,5)??null,
    rest_minutes:row.rest_minutes,approved:!!row.approved_at,approval_ref:row.approval_ref??null,current:row.current_version===row.version}; }
  private async appointmentConflicts(db:LocalDb,ctx:Context,version:any,localDate:string) {
    if(!version.protected_start||!version.protected_end)return [];
    const start=localDateTimeWithOffset(`${localDate}T${String(version.protected_start).slice(0,5)}`,ctx.zone);
    const end=localDateTimeWithOffset(`${localDate}T${String(version.protected_end).slice(0,5)}`,ctx.zone);
    if(!start.ok) return fail('conflict','The protected window is ambiguous on this day. Review the schedule.');
    if(!end.ok) return fail('conflict','The protected window is ambiguous on this day. Review the schedule.');
    const rows=(await db.query(`select id,title,starts_at from companion_local.appointments where participant_id=$1 and starts_at >= $2 and starts_at < $3 order by starts_at,id`,
      [ctx.participant,start.value,end.value])).rows;
    return rows.map(r=>({id:r.id,title:r.title,starts_at:iso(r.starts_at)!}));
  }
  private async checkConflicts(db:LocalDb,ctx:Context,version:any,localDate:string,acknowledged:string[]) {
    const conflicts=await this.appointmentConflicts(db,ctx,version,localDate);
    const ids=conflicts.map(item=>item.id).sort();
    if(canonicalJson(ids)!==canonicalJson([...acknowledged].sort())) fail('schedule_review','An appointment affects this protected time. Review the current schedule before continuing.');
  }
  private async run(db:LocalDb,ctx:Context,id:string,lock=false):Promise<any> {
    const row=(await db.query(`select r.*,d.kind,d.current_version,v.version,v.title,v.steps,v.protected_start,v.protected_end,v.rest_minutes
      from companion_local.program_runs r join companion_local.program_definitions d on d.id=r.definition_id
      join companion_local.program_versions v on v.id=r.version_id
      where r.id=$1 and r.participant_id=$2 ${lock?'for update of r':''}`,[id,ctx.participant])).rows[0];
    if(!row)fail('not_found','This program run is not available.',404);
    this.viewKind(ctx,row.kind);
    return row;
  }
  private async results(db:LocalDb,ctx:Context,runId:string):Promise<ProgramResult[]> {
    const rows=(await db.query(`select step_id,outcome,reason,difficulty,assistance,notes,revision,reported_at from companion_local.program_step_results
      where participant_id=$1 and run_id=$2 order by reported_at,id`,[ctx.participant,runId])).rows;
    return rows.map(r=>({...r,reported_at:iso(r.reported_at)!}));
  }
  private runView(row:any,results:ProgramResult[],zone:string):ProgramRun {
    const steps=row.steps as ProgramStep[];
    results.sort((a,b)=>steps.findIndex(step=>step.id===a.step_id)-steps.findIndex(step=>step.id===b.step_id));
    const done=new Map(results.map(item=>[item.step_id,item]));
    const next=steps.find(step=>!done.has(step.id))??null;
    const blocked=next?.depends_on.find(id=>done.get(id)?.outcome!=='completed');
    const last=results.at(-1);
    const restUntil=last&&row.rest_minutes>0?Date.parse(last.reported_at)+row.rest_minutes*60_000:0;
    return {id:row.id,definition_id:row.definition_id,version_id:row.version_id,title:row.title,local_date:day(row.local_date),status:row.status,
      revision:row.revision,current_step:blocked||restUntil>this.clock().getTime()?null:next,obsolete:row.current_version!==row.version,results,
      pause_reason:row.pause_reason??null,
      blocked_reason:blocked?`Step ${next!.title} depends on a step that was skipped. Review this run.`
        :restUntil>this.clock().getTime()?`Rest until ${new Date(restUntil).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:zone})}.`:null};
  }
  async authorityRevision(session:Session):Promise<string> {
    try {const c=await this.context(this.pool,session);return canonicalJson([c.grant,c.accessRevision,c.capabilities]);}catch(error){return mapError(error);}
  }
  async workspace(session:Session):Promise<ProgramWorkspace> {
    try {
      const ctx=await this.context(this.pool,session);
      const localDate=dateInZone(this.clock(),ctx.zone);
      const versions=(await this.pool.query(`select v.*,d.kind,d.current_version from companion_local.program_versions v
        join companion_local.program_definitions d on d.id=v.definition_id where v.participant_id=$1 order by d.created_at,v.version`,[ctx.participant])).rows
        .filter(r=>r.kind==='routine' ? ctx.role==='client'||ctx.capabilities.includes('read_routine')||ctx.capabilities.includes('edit_routine')
          : ctx.role==='client'||ctx.capabilities.includes('read_rehab')||ctx.capabilities.includes('edit_rehab')||ctx.capabilities.includes('approve_rehab'))
        .filter(r=>r.approved_at || r.kind==='routine'&&(ctx.role==='client'||ctx.role==='administrator'&&ctx.capabilities.includes('edit_routine'))
          || r.kind==='rehab'&&['administrator','clinician'].includes(ctx.role)&&(ctx.capabilities.includes('edit_rehab')||ctx.capabilities.includes('approve_rehab')));
      const runs=ctx.role==='client'||ctx.capabilities.includes('read_rehab')||ctx.capabilities.includes('read_routine')
        ? (await this.pool.query(`select r.*,d.kind,d.current_version,v.version,v.title,v.steps,v.rest_minutes from companion_local.program_runs r
          join companion_local.program_definitions d on d.id=r.definition_id join companion_local.program_versions v on v.id=r.version_id
          where r.participant_id=$1 and r.local_date >= $2::date - interval '7 days' order by r.started_at desc limit 50`,[ctx.participant,localDate])).rows : [];
      const views:ProgramRun[]=[];
      for(const row of runs) if(row.kind==='routine' ? ctx.role==='client'||ctx.capabilities.includes('read_routine')
        : ctx.role==='client'||ctx.capabilities.includes('read_rehab')) views.push(this.runView(row,await this.results(this.pool,ctx,row.id),ctx.zone));
      const sharing=ctx.role==='client'?(await this.pool.query(`select g.actor_id,g.role,a.email label,coalesce(p.revision,0) revision,coalesce(p.capabilities,'{}'::text[]) capabilities
        from companion_local.role_grants g join companion_local.accounts a on a.id=g.actor_id
        left join companion_local.program_access p on p.participant_id=g.participant_id and p.actor_id=g.actor_id and p.role=g.role
        where g.participant_id=$1 and g.role in ('administrator','family_friend','clinician') and g.revoked_at is null and a.disabled_at is null order by a.email`,[ctx.participant])).rows:[];
      const capacity=ctx.role==='client'?(await this.pool.query('select available_minutes,rest_minutes from companion_local.request_day_capacity where participant_id=$1 and local_date=$2',[ctx.participant,localDate])).rows[0]??null:null;
      const counts=ctx.role==='client'?(await this.pool.query(`select
        (select count(*)::int from companion_local.task_definitions where participant_id=$1 and active and (scheduled_date is null or scheduled_date=$2)) task_count,
        (select count(*)::int from companion_local.meal_options where participant_id=$1 and active) meal_count,
        (select count(*)::int from companion_local.appointments where participant_id=$1 and (starts_at at time zone $3)::date=$2) appointment_count`,[ctx.participant,localDate,ctx.zone])).rows[0]:{task_count:0,meal_count:0,appointment_count:0};
      const conflictsByVersion:ProgramWorkspace['conflicts_by_version']={};
      if(ctx.role==='client')for(const version of versions.filter(v=>v.current_version===v.version))
        conflictsByVersion[version.id]=await this.appointmentConflicts(this.pool,ctx,version,localDate);
      const currentRun=views.find(r=>r.status==='active'||r.status==='paused');
      const conflicts=currentRun?conflictsByVersion[currentRun.version_id]??[]:[];
      if(canonicalJson(await this.context(this.pool,session))!==canonicalJson(ctx))fail('forbidden','Sharing changed. Refresh before continuing.',403);
      return {role:ctx.role,capabilities:ctx.capabilities,local_date:localDate,time_zone:ctx.zone,versions:versions.map(r=>this.versionView(r)),runs:views,sharing,
        capacity,planning:{...counts,requires_acceptance:true},conflicts,conflicts_by_version:conflictsByVersion};
    }catch(error){return mapError(error);}
  }
  async receipt(session:Session,key:string):Promise<ProgramReceipt|null> {
    try {const ctx=await this.context(this.pool,session);const row=(await this.pool.query('select actor_id,command,result from companion_local.program_receipts where participant_id=$1 and command_id=$2',[ctx.participant,key])).rows[0];
      if(!row||row.actor_id!==ctx.actor)return null;
      const command=programCommandSchema.parse(row.command);
      if(command.type==='create_program'||command.type==='revise_program')this.editKind(ctx,command.draft.kind);
      else if(command.type==='approve_program')this.approveKind(ctx,(await this.version(this.pool,ctx,command.version_id)).kind);
      else if(command.type==='set_program_access'||command.type==='start_program'||command.type==='pause_program'||command.type==='resume_program'||command.type==='end_program'||command.type==='report_program_step'||command.type==='correct_program_step')requireClient(ctx);
      if(canonicalJson(await this.context(this.pool,session))!==canonicalJson(ctx))fail('forbidden','Sharing changed. Refresh before continuing.',403);
      return {...row.result,replayed:true};
    }catch(error){return mapError(error);}
  }
  async command(session:Session,input:ProgramCommand):Promise<ProgramReceipt> {
    try {const cmd=programCommandSchema.parse(input);return await localTransaction(this.pool,async db=>{
      const ctx=await this.context(db,session,true);await lockParticipant(db,ctx);
      const old=(await db.query(`select 'program' family,actor_id,command,result from companion_local.program_receipts where participant_id=$1 and command_id=$2
        union all select 'mutation',actor_id,command,result from companion_local.append_only_mutations where participant_id=$1 and command_id=$2
        union all select 'plan',null::uuid,command,result from companion_local.command_receipts where participant_id=$1 and command_id=$2
        union all select 'request',actor_id,command,result from companion_local.request_receipts where participant_id=$1 and command_id=$2
        union all select 'meal_grocery',actor_id,command,result from companion_local.meal_grocery_receipts where participant_id=$1 and command_id=$2`,[ctx.participant,cmd.idempotency_key])).rows;
      if(old.length) {
        const program=old.find(row=>row.family==='program');
        if(!program||old.length>2||old.some(row=>!['program','mutation'].includes(row.family)||row.actor_id!==ctx.actor||canonicalJson(row.command)!==canonicalJson(cmd)||canonicalJson(row.result)!==canonicalJson(program.result)))fail('conflict','This receipt key belongs to a different change.');
        await this.authorizeCommand(db,ctx,cmd);return {...program!.result,replayed:true};
      }
      await this.authorizeCommand(db,ctx,cmd);
      const now=this.clock();let result:ProgramReceipt={command_id:cmd.idempotency_key,result:cmd.type,definition_id:null,version_id:null,run_id:null,step_id:null,revision:1,replayed:false};
      let event='';let detail:Record<string,unknown>={};
      if(cmd.type==='set_program_access') {
        if(cmd.role==='family_friend'&&cmd.capabilities.some(c=>c.includes('rehab')||c==='edit_routine') ||
          cmd.role==='clinician'&&cmd.capabilities.includes('edit_routine'))fail('invalid_input','Choose permissions available for this role.',400);
        const grant=(await db.query(`select g.id from companion_local.role_grants g join companion_local.accounts a on a.id=g.actor_id
          where g.participant_id=$1 and g.actor_id=$2 and g.role=$3 and g.revoked_at is null and a.disabled_at is null for share of g,a`,
          [ctx.participant,cmd.actor_id,cmd.role])).rows[0];
        if(!grant)fail('forbidden','This person has no active access to the client.',403);
        const previous=(await db.query('select revision from companion_local.program_access where participant_id=$1 and actor_id=$2 and role=$3',[ctx.participant,cmd.actor_id,cmd.role])).rows[0];
        if((previous?.revision??0)!==cmd.expected_revision)fail('conflict','Program sharing changed. Review it again.');
        result.revision=cmd.expected_revision+1;
        await db.query(`insert into companion_local.program_access(participant_id,actor_id,role,capabilities,revision,granted_by,updated_at)
          values($1,$2,$3,$4,$5,$6,$7) on conflict(participant_id,actor_id,role) do update set capabilities=$4,revision=$5,granted_by=$6,updated_at=$7`,
          [ctx.participant,cmd.actor_id,cmd.role,cmd.capabilities,result.revision,ctx.actor,now]);
        event='ProgramAccessChanged';detail={target_actor:cmd.actor_id,capabilities:cmd.capabilities};
      } else if(cmd.type==='create_program'||cmd.type==='revise_program') {
        let id:string,version:number;
        if(cmd.type==='create_program'){id=randomUUID();version=1;
          await db.query('insert into companion_local.program_definitions(id,participant_id,kind,title,created_by) values($1,$2,$3,$4,$5)',[id,ctx.participant,cmd.draft.kind,cmd.draft.title,ctx.actor]);
        } else {const old=(await db.query('select * from companion_local.program_definitions where id=$1 and participant_id=$2 for update',[cmd.definition_id,ctx.participant])).rows[0];
          if(!old||old.kind!==cmd.draft.kind||old.latest_version!==cmd.expected_version)fail('conflict','The program version changed. Review the latest instructions.');
          id=old.id;version=old.latest_version+1;
          await db.query('update companion_local.program_definitions set latest_version=$2 where id=$1',[id,version]);
        }
        const versionId=randomUUID();
        await db.query(`insert into companion_local.program_versions(id,definition_id,participant_id,version,title,steps,protected_start,protected_end,rest_minutes,created_by)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[versionId,id,ctx.participant,version,cmd.draft.title,JSON.stringify(cmd.draft.steps),cmd.draft.protected_start,cmd.draft.protected_end,cmd.draft.rest_minutes,ctx.actor]);
        result={...result,definition_id:id,version_id:versionId,revision:version};event='ProgramVersionDrafted';detail={definition_id:id,version_id:versionId,kind:cmd.draft.kind,version};
      } else if(cmd.type==='approve_program') {
        const version=await this.version(db,ctx,cmd.version_id,true);
        if(version.approved_at)fail('conflict','This version is already approved.');
        if(version.version!==version.latest_version)fail('conflict','A newer draft exists. Review it before approval.');
        await db.query('update companion_local.program_versions set approved_by=$2,approval_ref=$3,approved_at=$4 where id=$1',[version.id,ctx.actor,cmd.approval_ref,now]);
        await db.query('update companion_local.program_definitions set current_version=$2,title=$3 where id=$1',[version.definition_id,version.version,version.title]);
        result={...result,definition_id:version.definition_id,version_id:version.id,revision:version.version};
        event=version.kind==='rehab'?'RehabProtocolApproved':'RoutineApproved';detail={definition_id:version.definition_id,version_id:version.id,approval_ref:cmd.approval_ref};
      } else if(cmd.type==='start_program') {
        const version=await this.version(db,ctx,cmd.version_id);
        if(!version.approved_at||version.current_version!==version.version)fail('conflict','This is not the current approved program. Review the latest version.');
        if(cmd.local_date!==dateInZone(now,ctx.zone))fail('invalid_input','Start only today’s program.',400);
        await this.checkConflicts(db,ctx,version,cmd.local_date,cmd.acknowledged_conflicts);
        const existing=(await db.query(`select id from companion_local.program_runs where participant_id=$1 and definition_id=$2 and local_date=$3 and status in ('active','paused')`,[ctx.participant,version.definition_id,cmd.local_date])).rows[0];
        if(existing)fail('conflict','This program is already in progress. Resume its saved run.');
        const id=randomUUID();await db.query(`insert into companion_local.program_runs(id,participant_id,definition_id,version_id,local_date,status,started_by,started_at,updated_at)
          values($1,$2,$3,$4,$5,'active',$6,$7,$7)`,[id,ctx.participant,version.definition_id,version.id,cmd.local_date,ctx.actor,now]);
        result={...result,definition_id:version.definition_id,version_id:version.id,run_id:id};event='ProgramStarted';detail={run_id:id,version_id:version.id};
      } else {
        const row=await this.run(db,ctx,cmd.run_id,true);result={...result,definition_id:row.definition_id,version_id:row.version_id,run_id:row.id};
        if(cmd.type==='correct_program_step') {
          const old=(await db.query('select * from companion_local.program_step_results where participant_id=$1 and run_id=$2 and step_id=$3 for update',[ctx.participant,row.id,cmd.step_id])).rows[0];
          if(!old||old.revision!==cmd.expected_revision)fail('conflict','This step result changed. Review its current report.');
          const step=(row.steps as ProgramStep[]).find(s=>s.id===cmd.step_id);if(!step)return fail('not_found','Step not found.',404);
          if(cmd.outcome==='skipped'&&!step.optional||cmd.outcome==='skipped'&&!cmd.reason)fail('invalid_input','Only optional steps may be skipped with a reason.',400);
          if(row.kind==='routine'&&(cmd.difficulty||cmd.assistance||cmd.notes))fail('invalid_input','Routine results do not include clinical notes.',400);
          if(old.outcome==='completed'&&cmd.outcome==='skipped') {
            const later=(await db.query('select step_id from companion_local.program_step_results where run_id=$1 and step_id<>$2',[row.id,step.id])).rows;
            if(later.some(r=>(row.steps as ProgramStep[]).find(s=>s.id===r.step_id)?.depends_on.includes(step.id)))fail('conflict','A later step depends on this result. Review the run with the protocol owner.');
          }
          await db.query(`update companion_local.program_step_results set outcome=$2,reason=$3,difficulty=$4,assistance=$5,notes=$6,revision=revision+1,updated_at=$7
            where id=$1`,[old.id,cmd.outcome,cmd.reason,cmd.difficulty,cmd.assistance,cmd.notes,now]);
          result={...result,step_id:step.id,revision:old.revision+1};event='ProgramStepCorrected';detail={run_id:row.id,step_id:step.id,from:old.outcome,to:cmd.outcome,correction_reason:cmd.correction_reason};
        } else {
          if(row.revision!==cmd.expected_revision)fail('conflict','This run changed. Refresh before continuing.');
          if(cmd.type==='pause_program') {
            if(row.status!=='active')fail('conflict','Only an active run can pause.');
            await db.query("update companion_local.program_runs set status='paused',pause_reason=$3,paused_at=$2,revision=revision+1,updated_at=$2 where id=$1",[row.id,now,cmd.reason]);
            event='ProgramPaused';detail={run_id:row.id,reason:cmd.reason};
          } else if(cmd.type==='end_program') {
            if(!['active','paused'].includes(row.status))fail('conflict','This run has already ended.');
            await db.query("update companion_local.program_runs set status='ended',end_reason=$2,ended_at=$3,revision=revision+1,updated_at=$3 where id=$1",[row.id,cmd.reason,now]);
            event='ProgramEnded';detail={run_id:row.id,reason:cmd.reason};
          } else {
            if(row.current_version!==row.version)fail('obsolete_version','A newer approved version exists. End this run and review the new instructions.');
            if(cmd.type==='resume_program') {
              if(row.status!=='paused')fail('conflict','Only a paused run can resume.');
              await this.checkConflicts(db,ctx,row,day(row.local_date),cmd.acknowledged_conflicts);
              await db.query("update companion_local.program_runs set status='active',revision=revision+1,updated_at=$2 where id=$1",[row.id,now]);
              event='ProgramResumed';detail={run_id:row.id};
            } else if(cmd.type==='report_program_step') {
              if(row.status!=='active')fail('conflict','Resume this run before recording a step.');
              await this.checkConflicts(db,ctx,row,day(row.local_date),cmd.acknowledged_conflicts);
              const previous=await this.results(db,ctx,row.id),view=this.runView(row,previous,ctx.zone);
              if(!view.current_step||view.current_step.id!==cmd.step_id)return fail('conflict','This is not the current eligible step. Review the run.');
              if(cmd.outcome==='skipped'&&(!view.current_step.optional||!cmd.reason))fail('invalid_input','Only optional steps may be skipped with a reason.',400);
              if(row.kind==='routine'&&(cmd.difficulty||cmd.assistance||cmd.notes))fail('invalid_input','Routine results do not include clinical notes.',400);
              if(cmd.outcome==='completed'&&cmd.reason)fail('invalid_input','A completion does not need a skip reason.',400);
              await db.query(`insert into companion_local.program_step_results(id,participant_id,run_id,step_id,outcome,reason,difficulty,assistance,notes,reported_by,reported_at,updated_at)
                values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,[randomUUID(),ctx.participant,row.id,cmd.step_id,cmd.outcome,cmd.reason,cmd.difficulty,cmd.assistance,cmd.notes,ctx.actor,now]);
              const finished=previous.length+1===(row.steps as ProgramStep[]).length;
              await db.query(`update companion_local.program_runs set status=$2,revision=revision+1,updated_at=$3,ended_at=case when $2='completed' then $3 else ended_at end where id=$1`,
                [row.id,finished?'completed':'active',now]);
              result.step_id=cmd.step_id;event=cmd.outcome==='skipped'?'ProgramStepSkipped':'ProgramStepReported';detail={run_id:row.id,step_id:cmd.step_id,outcome:cmd.outcome,reason:cmd.reason};
            }
          }
          result.revision=row.revision+1;
        }
      }
      await db.query(`insert into companion_local.program_receipts(participant_id,command_id,actor_id,command,result,event_type)
        values($1,$2,$3,$4,$5,$6)`,[ctx.participant,cmd.idempotency_key,ctx.actor,JSON.stringify(cmd),JSON.stringify(result),event]);
      // The common command index also prevents a program key being reused by
      // care, activity, requests or another local workflow after a lost reply.
      await db.query(`insert into companion_local.append_only_mutations(participant_id,command_id,actor_id,event_type,command,result)
        values($1,$2,$3,$4,$5,$6)`,[ctx.participant,cmd.idempotency_key,ctx.actor,event,JSON.stringify(cmd),JSON.stringify(result)]);
      await db.query(`insert into companion_local.domain_events(participant_id,actor_id,command_id,event_type,local_date,data)
        values($1,$2,$3,$4,$5,$6)`,[ctx.participant,ctx.actor,cmd.idempotency_key,event,dateInZone(now,ctx.zone),JSON.stringify(detail)]);
      return result;
    });}catch(error){return mapError(error);}
  }
  private async authorizeCommand(db:LocalDb,ctx:Context,cmd:ProgramCommand) {
    if(cmd.type==='set_program_access'||cmd.type==='start_program'||cmd.type==='pause_program'||cmd.type==='resume_program'||cmd.type==='end_program'||cmd.type==='report_program_step'||cmd.type==='correct_program_step')requireClient(ctx);
    if(cmd.type==='create_program'||cmd.type==='revise_program')this.editKind(ctx,cmd.draft.kind);
    if(cmd.type==='approve_program')this.approveKind(ctx,(await this.version(db,ctx,cmd.version_id)).kind);
  }
}
