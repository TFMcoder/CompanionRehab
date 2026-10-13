import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ZodError } from 'zod';
import { ApiError, unavailable } from './errors.js';
import type { Session } from './session.js';
import { canonicalJson, localAuthority, localTransaction, lockParticipant, type LocalDb, type LocalAuthority } from './local-authority.js';
import { dateInZone } from '../shared/contracts.js';
import { progressArchetypes, progressCommandSchema, progressFields, progressRangeSchema,
  type ProgressCommand, type ProgressDay, type ProgressField, type ProgressKind, type ProgressRange,
  type ProgressReceipt, type ProgressSource, type ProgressWorkspace, type ScoringRules } from '../shared/progress-contracts.js';

type Scope = LocalAuthority & { canRead: boolean; canExport: boolean; canApprove: boolean; fields: ProgressField[]; maxDays: number; accessRevision: number };
type Plan = { tasks?: Array<{ id: string; title: string; category?: string }>; meals?: Array<{ option_id: string; slot: string; name: string }> };
type Fact = { id: string; kind: string; source_id: string | null; meal_slot: string | null; title: string; status: string;
  revision: number; last_action: string; scheduled_at: string | Date | null; local_date: string };
type Run = { id: string; kind: string; title: string; status: string; version_id: string;
  steps: Array<{ id: string; title: string; optional: boolean }>; results: Array<{ step_id: string; outcome: string; revision: number }> };
export interface ProgressCalculationInput {
  local_date: string; time_zone: string; plan_id: string; plan_version: number; plan: Plan;
  rules: ScoringRules; rule_version: number; activities: Fact[];
  appointments: Array<{ id: string; title: string }>;
  runs: Run[];
}
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const dayCount = (from: string, to: string) => Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000) + 1;
function days(from: string, to: string) { const result: string[] = []; for (let time = Date.parse(from + 'T12:00:00Z'); time <= Date.parse(to + 'T12:00:00Z'); time += 86400000) result.push(new Date(time).toISOString().slice(0, 10)); return result; }
function fail(status: number, code: string, message: string): never { throw new ApiError(status, code, message); }
function mapError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (error instanceof ZodError) fail(400, 'invalid_input', 'Check the progress details and try again.');
  const code = (error as { code?: string })?.code;
  if (['23505', '40001', '40P01'].includes(code ?? '')) fail(409, 'conflict', 'Progress changed. Refresh and review again.');
  if (['23503', '23514', '22P02', '22023'].includes(code ?? '')) fail(400, 'invalid_input', 'Check the progress details and try again.');
  throw unavailable();
}
function weightFor(rules: ScoringRules, kind: ProgressKind) { return rules.weights.find(item => item.kind === kind)?.weight ?? 0; }

/** Pure scorer: only a reported outcome enters the known denominator. */
export function calculateProgressDay(input: ProgressCalculationInput): ProgressDay {
  const sources: ProgressSource[] = [];
  const add = (source_id: string, kind: ProgressKind, title: string, fact?: Fact | null, explicit?: 'completed' | 'deferred' | 'missing', revision?: number | null) => {
    const weight = weightFor(input.rules, kind); if (!weight) return;
    let state: ProgressSource['state'] = explicit ?? (fact?.status === 'completed' ? 'completed' : fact?.status === 'deferred' ? 'deferred' : fact?.status === 'voided' ? 'voided' : 'missing');
    let explanation = state === 'completed' ? 'Reported as completed.' : state === 'deferred' ? 'Reported as deferred.' :
      state === 'voided' ? 'A correction voided this report.' : 'No factual outcome has been reported.';
    if (fact?.scheduled_at && dateInZone(new Date(fact.scheduled_at), input.time_zone) !== input.local_date && state !== 'completed') {
      state = 'exempt'; explanation = 'Moved to another local day.';
    } else if (state === 'deferred' && input.rules.deferral_treatment === 'exempt') {
      state = 'exempt'; explanation = 'A reported deferral is exempt under this approved rule version.';
    }
    sources.push({ source_id, kind, title, state, weight, activity_revision: revision ?? fact?.revision ?? null,
      corrected: (revision ?? fact?.revision ?? 0) > 1 || fact?.last_action === 'corrected', explanation });
  };
  for (const task of input.plan.tasks ?? []) {
    const kind = task.category === 'exercise' ? 'exercise' : task.category === 'rehab' ? 'rehab' : 'task';
    const fact = input.activities.filter(a => a.kind === 'task' && a.source_id === task.id).sort((a,b)=>b.revision-a.revision)[0];
    add(task.id, kind, task.title, fact);
  }
  for (const meal of input.plan.meals ?? []) {
    const fact = input.activities.filter(a => a.kind === 'meal' && a.source_id === meal.option_id && a.meal_slot === meal.slot).sort((a,b)=>b.revision-a.revision)[0];
    add(`${meal.slot}:${meal.option_id}`, 'meal', `${meal.slot}: ${meal.name}`, fact);
  }
  for (const appointment of input.appointments) {
    const fact = input.activities.filter(a => a.kind === 'appointment' && a.source_id === appointment.id).sort((a,b)=>b.revision-a.revision)[0];
    add(appointment.id, 'appointment', appointment.title, fact);
  }
  for (const run of input.runs) for (const step of run.steps) {
    if (step.optional) continue;
    const result = run.results.find(item => item.step_id === step.id);
    const kind = run.kind === 'rehab' ? 'rehab_step' : 'routine_step';
    add(`${run.id}:${step.id}`, kind, `${run.title}: ${step.title}`, null,
      result?.outcome === 'completed' ? 'completed' : result?.outcome === 'skipped' ? 'deferred' : 'missing', result?.revision ?? null);
  }
  sources.sort((a,b)=>a.kind.localeCompare(b.kind)||a.source_id.localeCompare(b.source_id));
  const completed_weight = sources.filter(source=>source.state==='completed').reduce((n,source)=>n+source.weight,0);
  const known_weight = sources.filter(source=>source.state==='completed'||source.state==='deferred').reduce((n,source)=>n+source.weight,0);
  return { local_date: input.local_date, status: 'ready', time_zone: input.time_zone, plan_id: input.plan_id,
    plan_version: input.plan_version, rule_version: input.rule_version,
    protocol_versions:[...new Set(input.runs.map(run=>run.version_id))].sort(),
    score_percent: known_weight ? Math.round(100*completed_weight/known_weight) : null,
    completed_weight, known_weight, missing_count: sources.filter(s=>s.state==='missing').length,
    deferred_count: sources.filter(s=>s.state==='deferred'||s.state==='exempt'&&s.explanation.includes('deferral')).length,
    exempt_count: sources.filter(s=>s.state==='exempt'||s.state==='voided').length,
    corrected_count: sources.filter(s=>s.corrected).length, sources,
    source_digest: hash({ plan:input.plan, plan_id:input.plan_id, plan_version:input.plan_version, rules:input.rules,
      rule_version:input.rule_version, zone:input.time_zone, activities:input.activities, appointments:input.appointments, runs:input.runs }),
    snapshot_generation: null, stale: true, achievements: [] };
}

function emptyDay(date: string, zone: string, status: 'no_plan' | 'unconfigured', plan?: {id:string;version:number}): ProgressDay {
  return {local_date:date,status,time_zone:zone,plan_id:plan?.id??null,plan_version:plan?.version??null,rule_version:null,
    protocol_versions:[],
    score_percent:null,completed_weight:null,known_weight:null,missing_count:null,deferred_count:null,exempt_count:null,
    corrected_count:null,sources:[],source_digest:null,snapshot_generation:null,stale:false,achievements:[]};
}
function csvCell(value: unknown): string {
  const plain = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  const safe = /^[\s\uFEFF]*[=+\-@]/u.test(plain) ? `'${plain}` : plain;
  return `"${safe.replaceAll('"','""')}"`;
}
export function renderProgressCsv(rows: Record<string,unknown>[], fields: ProgressField[]): string {
  return [fields.map(csvCell).join(','), ...rows.map(row=>fields.map(field=>csvCell(row[field])).join(','))].join('\r\n') + '\r\n';
}

export class ProgressService {
  private readonly clock: () => Date;
  constructor(private readonly pool: Pool, options: { clock?: () => Date } = {}) { this.clock=options.clock??(()=>new Date()); }
  private async scope(db: LocalDb, session: Session, lock=false): Promise<Scope> {
    const authority = await localAuthority(db, session, this.clock(), lock);
    if (authority.role === 'client') return {...authority,canRead:true,canExport:true,canApprove:true,fields:[...progressFields],maxDays:90,accessRevision:0};
    if (authority.role === 'family_friend') {
      const share=(await db.query(`select share_progress,revision from companion_local.support_shares where participant_id=$1 and actor_id=$2 and role=$3 ${lock?'for share':''}`,
        [authority.participant,authority.actor,authority.role])).rows[0];
      if (!share?.share_progress) fail(403,'forbidden','Progress is not shared with this account.');
      return {...authority,canRead:true,canExport:false,canApprove:false,
        fields:['local_date','status','score_percent','missing_count','deferred_count','exempt_count','corrected_count','plan_version','rule_version','time_zone'],maxDays:31,accessRevision:share.revision};
    }
    const access=(await db.query(`select can_read,can_export,can_approve_rules,allowed_fields,max_days,revision from companion_local.progress_access
      where participant_id=$1 and actor_id=$2 and role=$3 ${lock?'for share':''}`,[authority.participant,authority.actor,authority.role])).rows[0];
    if (!access?.can_read) fail(403,'forbidden','This progress view is not shared with this account.');
    if(!access.allowed_fields.includes('local_date')||!access.allowed_fields.includes('status'))fail(403,'forbidden','This progress view has no valid approved field scope.');
    return {...authority,canRead:true,canExport:access.can_export,canApprove:access.can_approve_rules,
      fields:access.allowed_fields,maxDays:access.max_days,accessRevision:access.revision};
  }
  private async facts(db: LocalDb, participant: string, from: string, to: string) {
    const [plans,activities,appointments,runs,results,snapshots,awards] = await Promise.all([
      db.query(`select c.local_date::text local_date,v.id,v.version,v.plan from companion_local.daily_checkins c
        join companion_local.accepted_day_plan_versions v on v.checkin_id=c.id and v.version=c.accepted_version
        where c.participant_id=$1 and c.local_date between $2 and $3`,[participant,from,to]),
      db.query(`select id,local_date::text local_date,kind,source_id,meal_slot,title,status,revision,last_action,scheduled_at
        from companion_local.activity_records where participant_id=$1 and local_date between $2 and $3 order by id`,[participant,from,to]),
      db.query(`select a.id,a.title,(a.starts_at at time zone p.time_zone)::date::text local_date from companion_local.appointments a
        join companion_local.participant_profiles p on p.id=a.participant_id
        where a.participant_id=$1 and (a.starts_at at time zone p.time_zone)::date between $2 and $3`,[participant,from,to]),
      db.query(`select r.id,r.local_date::text local_date,r.status,v.id version_id,v.steps,d.kind,d.title
        from companion_local.program_runs r join companion_local.program_versions v on v.id=r.version_id and v.approved_at is not null
        join companion_local.program_definitions d on d.id=r.definition_id and d.participant_id=r.participant_id
        where r.participant_id=$1 and r.local_date between $2 and $3`,[participant,from,to]),
      db.query(`select s.run_id,s.step_id,s.outcome,s.revision from companion_local.program_step_results s
        join companion_local.program_runs r on r.id=s.run_id where s.participant_id=$1 and r.local_date between $2 and $3`,[participant,from,to]),
      db.query(`select distinct on (local_date) local_date::text local_date,generation,source_digest,rule_version,plan_id,result
        from companion_local.progress_snapshots where participant_id=$1 and local_date between $2 and $3 order by local_date,generation desc`,[participant,from,to]),
      db.query(`select local_date::text local_date,rule_set_id,achievement_key key,label,active from companion_local.progress_awards
        where participant_id=$1 and local_date between $2 and $3`,[participant,from,to]),
    ]);
    return {plans:plans.rows,activities:activities.rows,appointments:appointments.rows,runs:runs.rows,results:results.rows,snapshots:snapshots.rows,awards:awards.rows};
  }
  private async daysFor(db: LocalDb, scope: Scope, from: string, to: string) {
    const rule=(await db.query('select id,version,rules,approval_ref from companion_local.progress_rule_sets where participant_id=$1 order by version desc limit 1',[scope.participant])).rows[0];
    const facts=await this.facts(db,scope.participant,from,to);
    const all=days(from,to).map(date=>{
      const plan=facts.plans.find(p=>p.local_date===date);
      if(!plan)return emptyDay(date,scope.zone,'no_plan');
      if(!rule)return emptyDay(date,scope.zone,'unconfigured',plan);
      const input:ProgressCalculationInput={local_date:date,time_zone:scope.zone,plan_id:plan.id,plan_version:plan.version,plan:plan.plan,
        rules:rule.rules,rule_version:rule.version,activities:facts.activities.filter(a=>a.local_date===date),
        appointments:facts.appointments.filter(a=>a.local_date===date),
        runs:facts.runs.filter(r=>r.local_date===date).map(r=>({...r,steps:r.steps,
          results:facts.results.filter(result=>result.run_id===r.id)}))};
      const calculated=calculateProgressDay(input);
      const snapshot=facts.snapshots.find(s=>s.local_date===date);
      calculated.snapshot_generation=snapshot?.generation??null;
      calculated.stale=!snapshot||snapshot.source_digest!==calculated.source_digest||snapshot.rule_version!==rule.version||snapshot.plan_id!==plan.id;
      calculated.achievements=facts.awards.filter(a=>a.local_date===date&&a.rule_set_id===rule.id)
        .map(a=>({key:a.key,label:a.label,active:a.active}));
      return calculated;
    });
    return {all,rule};
  }
  private project(day:ProgressDay,scope:Scope):ProgressDay {
    if(scope.role==='client')return day;
    const has=(field:ProgressField)=>scope.fields.includes(field);
    return {...day,plan_id:null,source_digest:null,
      score_percent:has('score_percent')?day.score_percent:null,
      completed_weight:has('completed_weight')?day.completed_weight:null,known_weight:has('known_weight')?day.known_weight:null,
      missing_count:has('missing_count')?day.missing_count:null,deferred_count:has('deferred_count')?day.deferred_count:null,
      exempt_count:has('exempt_count')?day.exempt_count:null,corrected_count:has('corrected_count')?day.corrected_count:null,
      plan_version:has('plan_version')?day.plan_version:null,rule_version:has('rule_version')?day.rule_version:null,
      protocol_versions:has('protocol_versions')?day.protocol_versions:[],
      sources:has('sources')?day.sources:[],achievements:scope.role==='family_friend'?day.achievements:[]};
  }
  async workspace(session:Session, rangeInput:ProgressRange):Promise<ProgressWorkspace> {
    try {
      const range=progressRangeSchema.parse(rangeInput),scope=await this.scope(this.pool,session);
      if(dayCount(range.from,range.to)>scope.maxDays) fail(400,'invalid_range','Choose a shorter date range.');
      const {all,rule}=await this.daysFor(this.pool,scope,range.from,range.to);
      const config=range.archetype&&scope.role!=='family_friend'?(await this.pool.query(`select archetype,version,title,fields from companion_local.progress_clinical_configs
        where participant_id=$1 and archetype=$2 order by version desc limit 1`,[scope.participant,range.archetype])).rows[0]:null;
      const grants=scope.role==='client'?(await this.pool.query(`select g.actor_id,g.role,coalesce(x.revision,0) revision,
        coalesce(x.can_read,false) can_read,coalesce(x.can_export,false) can_export,coalesce(x.can_approve_rules,false) can_approve_rules,
        coalesce(x.allowed_fields,'{}') allowed_fields,coalesce(x.max_days,31) max_days
        from companion_local.role_grants g join companion_local.accounts a on a.id=g.actor_id
        left join companion_local.progress_access x on x.participant_id=g.participant_id and x.actor_id=g.actor_id and x.role=g.role
        where g.participant_id=$1 and g.role in ('administrator','clinician') and g.revoked_at is null and a.disabled_at is null order by g.role,g.actor_id`,[scope.participant])).rows:[];
      const current=await this.scope(this.pool,session);
      if(hash([scope.grant,scope.accessRevision,scope.fields])!==hash([current.grant,current.accessRevision,current.fields])) fail(403,'forbidden','Sharing changed. Refresh before continuing.');
      const projected=all.map(day=>this.project(day,scope));
      const measured=projected.filter(day=>day.score_percent!==null);
      const includes=(field:ProgressField)=>scope.fields.includes(field);
      return {role:scope.role,time_zone:scope.zone,from:range.from,to:range.to,days:projected,
        trend:{days_in_range:projected.length,days_with_accepted_plan:projected.filter(day=>day.status!=='no_plan').length,
          days_without_accepted_plan:projected.filter(day=>day.status==='no_plan').length,
          days_with_reported_outcome:includes('known_weight')?projected.filter(day=>(day.known_weight??0)>0).length:null,
          days_with_missing_reports:includes('missing_count')?projected.filter(day=>(day.missing_count??0)>0).length:null,
          average_reported_percent:includes('score_percent')&&measured.length?Math.round(measured.reduce((sum,day)=>sum+day.score_percent!,0)/measured.length):null,
          corrected_days:includes('corrected_count')?projected.filter(day=>(day.corrected_count??0)>0).length:null,
          plan_versions:includes('plan_version')?[...new Set(projected.flatMap(day=>day.plan_version===null?[]:[day.plan_version]))].sort((a,b)=>a-b):[],
          rule_versions:includes('rule_version')?[...new Set(projected.flatMap(day=>day.rule_version===null?[]:[day.rule_version]))].sort((a,b)=>a-b):[]},
        active_rules:scope.canApprove&&rule?{version:rule.version,rules:rule.rules,approval_ref:rule.approval_ref}:null,
        archetypes:progressArchetypes,clinical_config:config?{archetype:config.archetype,version:config.version,title:config.title,
          fields:config.fields.filter((field:ProgressField)=>scope.fields.includes(field))}:null,
        allowed_fields:scope.fields,can_approve_rules:scope.canApprove,can_export:scope.canExport,access_grants:grants};
    } catch(error){return mapError(error);}
  }
  async receipt(session:Session,key:string):Promise<ProgressReceipt|null> {
    try {
      const scope=await this.scope(this.pool,session);
      const row=(await this.pool.query('select actor_id,command,result from companion_local.progress_receipts where participant_id=$1 and command_id=$2',[scope.participant,key])).rows[0];
      if(!row)return null;
      if(row.actor_id!==scope.actor) fail(403,'forbidden','This receipt belongs to another person.');
      const command=progressCommandSchema.parse(row.command);
      this.authorize(scope,command);
      return {...row.result,replayed:true,export_content:null};
    }catch(error){return mapError(error);}
  }
  private authorize(scope:Scope,command:ProgressCommand){
    if(command.type==='set_progress_access'&&scope.role!=='client')fail(403,'forbidden','Only the client can set progress sharing.');
    if((command.type==='approve_scoring_rules'||command.type==='approve_clinical_config')&&!scope.canApprove)fail(403,'forbidden','Rule approval is not granted to this account.');
    if(command.type==='recalculate_score'&&scope.role!=='client'&&!scope.canApprove)fail(403,'forbidden','Recalculation is not granted to this account.');
    if(command.type==='request_data_export'&&!scope.canExport)fail(403,'forbidden','Export is not granted to this account.');
  }
  async command(session:Session,input:ProgressCommand):Promise<ProgressReceipt> {
    try {
      const command=progressCommandSchema.parse(input);
      return await localTransaction(this.pool,async db=>{
        const scope=await this.scope(db,session,true);this.authorize(scope,command);
        await lockParticipant(db,scope);
        const prior=(await db.query('select actor_id,command,result from companion_local.progress_receipts where participant_id=$1 and command_id=$2',
          [scope.participant,command.idempotency_key])).rows[0];
        if(prior){if(prior.actor_id!==scope.actor||canonicalJson(prior.command)!==canonicalJson(command))fail(409,'conflict','This request key belongs to another change.');
          return {...prior.result,replayed:true,export_content:null};}
        const other=(await db.query(`select 1 from companion_local.append_only_mutations where participant_id=$1 and command_id=$2
          union all select 1 from companion_local.command_receipts where participant_id=$1 and command_id=$2
          union all select 1 from companion_local.request_receipts where participant_id=$1 and command_id=$2`,[scope.participant,command.idempotency_key])).rows[0];
        if(other)fail(409,'conflict','This request key belongs to another change.');
        const now=this.clock();let revision=1;let result:Record<string,unknown>={};let export_content:string|null|undefined;
        if(command.type==='approve_scoring_rules') {
          const old=(await db.query('select coalesce(max(version),0)::int version from companion_local.progress_rule_sets where participant_id=$1',[scope.participant])).rows[0];
          if(old.version!==command.expected_rule_version)fail(409,'conflict','Rules changed. Refresh before approving.');
          revision=old.version+1;const id=randomUUID();
          await db.query(`insert into companion_local.progress_rule_sets(id,participant_id,version,rules,approved_by,approval_ref,approved_at)
            values($1,$2,$3,$4,$5,$6,$7)`,[id,scope.participant,revision,JSON.stringify(command.rules),scope.actor,command.approval_ref,now]);
          result={rule_set_id:id,rule_version:revision};
        } else if(command.type==='set_progress_access') {
          const target=(await db.query(`select 1 from companion_local.role_grants g join companion_local.accounts a on a.id=g.actor_id
            where g.participant_id=$1 and g.actor_id=$2 and g.role=$3 and g.revoked_at is null and a.disabled_at is null for share of g,a`,
            [scope.participant,command.actor_id,command.role])).rows[0];
          if(!target)fail(400,'invalid_input','Choose an account with active access to this client.');
          const old=(await db.query(`select revision from companion_local.progress_access where participant_id=$1 and actor_id=$2 and role=$3 for update`,
            [scope.participant,command.actor_id,command.role])).rows[0];
          if((old?.revision??0)!==command.expected_revision)fail(409,'conflict','Progress sharing changed. Refresh before saving.');
          revision=command.expected_revision+1;
          await db.query(`insert into companion_local.progress_access(participant_id,actor_id,role,can_read,can_export,can_approve_rules,allowed_fields,max_days,revision,granted_by,updated_at)
            values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(participant_id,actor_id,role)
            do update set can_read=$4,can_export=$5,can_approve_rules=$6,allowed_fields=$7,max_days=$8,revision=$9,granted_by=$10,updated_at=$11`,
            [scope.participant,command.actor_id,command.role,command.can_read,command.can_export,command.can_approve_rules,
              command.allowed_fields,command.max_days,revision,scope.actor,now]);
          result={actor_id:command.actor_id,role:command.role,access_revision:revision};
        } else if(command.type==='approve_clinical_config') {
          if(!command.fields.every(field=>scope.fields.includes(field)))fail(403,'forbidden','The dashboard definition includes a field outside this account’s scope.');
          const old=(await db.query(`select coalesce(max(version),0)::int version from companion_local.progress_clinical_configs
            where participant_id=$1 and archetype=$2`,[scope.participant,command.archetype])).rows[0];
          if(old.version!==command.expected_version)fail(409,'conflict','Dashboard configuration changed. Refresh before approving.');
          revision=old.version+1;const id=randomUUID();
          await db.query(`insert into companion_local.progress_clinical_configs(id,participant_id,archetype,version,title,fields,approval_ref,approved_by,approved_at)
            values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id,scope.participant,command.archetype,revision,command.title,command.fields,command.approval_ref,scope.actor,now]);
          result={config_id:id,config_version:revision,archetype:command.archetype};
        } else if(command.type==='recalculate_score') {
          const {all,rule}=await this.daysFor(db,scope,command.local_date,command.local_date);
          const day=all[0];if(!rule||day.status!=='ready'||!day.plan_id||!day.source_digest)fail(409,'not_ready','Accept a plan and approve rules before calculating progress.');
          const existing=(await db.query(`select id,generation from companion_local.progress_snapshots where participant_id=$1 and local_date=$2
            and rule_set_id=$3 and plan_id=$4 and source_digest=$5`,[scope.participant,command.local_date,rule.id,day.plan_id,day.source_digest])).rows[0];
          if(existing){revision=existing.generation;result={snapshot_id:existing.id,generation:revision,unchanged:true};}
          else {
            revision=(await db.query(`select coalesce(max(generation),0)::int generation from companion_local.progress_snapshots
              where participant_id=$1 and local_date=$2`,[scope.participant,command.local_date])).rows[0].generation+1;
            const id=randomUUID();
            await db.query(`insert into companion_local.progress_snapshots(id,participant_id,local_date,generation,rule_set_id,rule_version,plan_id,plan_version,time_zone,source_digest,result,calculated_by,calculated_at)
              values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[id,scope.participant,command.local_date,revision,rule.id,rule.version,day.plan_id,day.plan_version,
                scope.zone,day.source_digest,JSON.stringify(day),scope.actor,now]);
            // An unknown outcome is not a failure, but cannot silently satisfy an award.
            const earned=rule.rules.achievements.filter((a:{min_percent:number})=>day.score_percent!==null&&day.missing_count===0&&day.score_percent>=a.min_percent);
            const oldAwards=(await db.query(`select id,achievement_key,active from companion_local.progress_awards where participant_id=$1 and local_date=$2 and rule_set_id=$3 for update`,
              [scope.participant,command.local_date,rule.id])).rows;
            for(const achievement of earned){
              const previous=oldAwards.find(a=>a.achievement_key===achievement.key);
              if(!previous) {
                await db.query(`insert into companion_local.progress_awards(id,participant_id,local_date,rule_set_id,achievement_key,label,active,first_snapshot_id,last_snapshot_id,awarded_at,updated_at)
                  values($1,$2,$3,$4,$5,$6,true,$7,$7,$8,$8)`,[randomUUID(),scope.participant,command.local_date,rule.id,achievement.key,achievement.label,id,now]);
                await this.event(db,scope,null,'AchievementAwarded',command.local_date,{key:achievement.key,snapshot_id:id,command_id:command.idempotency_key});
              } else if(!previous.active) {
                await db.query('update companion_local.progress_awards set active=true,last_snapshot_id=$2,updated_at=$3 where id=$1',[previous.id,id,now]);
                await this.event(db,scope,null,'AchievementRestored',command.local_date,{key:achievement.key,snapshot_id:id,command_id:command.idempotency_key});
              }
            }
            for(const previous of oldAwards)if(previous.active&&!earned.some((a:{key:string})=>a.key===previous.achievement_key)){
              await db.query('update companion_local.progress_awards set active=false,last_snapshot_id=$2,updated_at=$3 where id=$1',[previous.id,id,now]);
              await this.event(db,scope,null,'AchievementRevoked',command.local_date,{key:previous.achievement_key,snapshot_id:id,command_id:command.idempotency_key});
            }
            result={snapshot_id:id,generation:revision,unchanged:false,score_percent:day.score_percent};
          }
        } else if(command.type==='request_data_export') {
          if(dayCount(command.from,command.to)>scope.maxDays)fail(400,'invalid_range','Choose a shorter export range.');
          if(!command.fields.every(field=>scope.fields.includes(field)))fail(403,'forbidden','One or more export fields are not shared.');
          const config=command.archetype?(await db.query(`select version,fields from companion_local.progress_clinical_configs
            where participant_id=$1 and archetype=$2 order by version desc limit 1`,[scope.participant,command.archetype])).rows[0]:null;
          if(command.archetype&&!config)fail(409,'not_ready','This dashboard definition has not been approved.');
          if(config&&!command.fields.every(field=>config.fields.includes(field)))fail(403,'forbidden','A field is outside this approved dashboard.');
          const {all}=await this.daysFor(db,scope,command.from,command.to);
          const rows=all.map(day=>{const permitted=this.project(day,scope) as unknown as Record<string,unknown>;
            return Object.fromEntries(command.fields.map(field=>[field,permitted[field]]));});
          export_content=command.format==='json'?JSON.stringify({time_zone:scope.zone,from:command.from,to:command.to,fields:command.fields,rows}):renderProgressCsv(rows,command.fields);
          const id=randomUUID(),contentHash=createHash('sha256').update(export_content).digest('hex');
          const sourceDigest=hash(rows);
          await db.query(`insert into companion_local.progress_exports(id,participant_id,actor_id,actor_role,command_id,from_date,to_date,time_zone,format,fields,archetype,config_version,source_digest,content_sha256,row_count,created_at)
            values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,[id,scope.participant,scope.actor,scope.role,command.idempotency_key,
              command.from,command.to,scope.zone,command.format,command.fields,command.archetype??null,config?.version??null,sourceDigest,contentHash,rows.length,now]);
          result={export_id:id,format:command.format,row_count:rows.length,fields:command.fields,time_zone:scope.zone,
            content_sha256:contentHash,source_digest:sourceDigest,config_version:config?.version??null};
        }
        const receipt:ProgressReceipt={command_id:command.idempotency_key,type:command.type,revision,replayed:false,result};
        await db.query(`insert into companion_local.progress_receipts(participant_id,command_id,actor_id,command,result,created_at) values($1,$2,$3,$4,$5,$6)`,
          [scope.participant,command.idempotency_key,scope.actor,JSON.stringify(command),JSON.stringify(receipt),now]);
        await db.query(`insert into companion_local.append_only_mutations(participant_id,command_id,actor_id,command,result,event_type)
          values($1,$2,$3,$4,$5,$6)`,[scope.participant,command.idempotency_key,scope.actor,JSON.stringify(command),JSON.stringify(receipt),`Progress:${command.type}`]);
        const event=command.type==='approve_scoring_rules'?'ScoringRulesApproved':command.type==='recalculate_score'?(revision===1?'ScoreCalculated':'ScoreRecalculated'):
          command.type==='request_data_export'?'DataExportRequested':command.type==='approve_clinical_config'?'ClinicalDashboardApproved':'ProgressAccessChanged';
        await this.event(db,scope,command.idempotency_key,event,command.type==='recalculate_score'?command.local_date:null,result);
        return {...receipt,export_content};
      });
    }catch(error){return mapError(error);}
  }
  private async event(db:LocalDb,scope:Scope,key:string|null,event_type:string,local_date:string|null,data:unknown){
    await db.query(`insert into companion_local.domain_events(participant_id,actor_id,command_id,event_type,local_date,data)
      values($1,$2,$3,$4,$5,$6)`,[scope.participant,scope.actor,key,event_type,local_date,JSON.stringify(data)]);
  }
}
