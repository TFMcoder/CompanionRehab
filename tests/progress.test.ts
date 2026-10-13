import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { ProgressService, calculateProgressDay, renderProgressCsv } from '../src/server/progress.js';
import type { Session } from '../src/server/session.js';
import { pglitePool } from './helpers/pglite-pool.js';

const today='2026-10-13', now=new Date('2026-10-13T15:00:00Z');
const key=()=>randomUUID();
const rules={weights:[{kind:'task' as const,weight:2},{kind:'meal' as const,weight:1}],deferral_treatment:'exempt' as const,
  achievements:[{key:'day_reviewed',label:'You reviewed your day',min_percent:100}]};

describe('progress calculations',()=>{
  it('keeps missing, deferred, voided and corrected states distinct',()=>{
    const task=key(),meal=key(),planId=key();
    const base={local_date:today,time_zone:'America/Toronto',plan_id:planId,plan_version:2,rule_version:1,rules,
      plan:{tasks:[{id:task,title:'Set out laundry',category:'task'}],meals:[{option_id:meal,slot:'lunch',name:'Soup'}]},
      activities:[{id:key(),kind:'task',source_id:task,meal_slot:null,title:'Set out laundry',status:'completed',revision:2,
        last_action:'corrected',scheduled_at:null,local_date:today}],appointments:[],runs:[]};
    const first=calculateProgressDay(base);
    expect(first).toMatchObject({score_percent:100,known_weight:2,completed_weight:2,missing_count:1,corrected_count:1,plan_version:2,rule_version:1});
    const deferred=calculateProgressDay({...base,activities:[...base.activities,{id:key(),kind:'meal',source_id:meal,meal_slot:'lunch',title:'Soup',
      status:'deferred',revision:1,last_action:'reported',scheduled_at:null,local_date:today}]});
    expect(deferred).toMatchObject({score_percent:100,known_weight:2,deferred_count:1,exempt_count:1,missing_count:0});
    expect(deferred.source_digest).not.toBe(first.source_digest);
  });
  it('makes formula-like CSV content inert',()=>{
    expect(renderProgressCsv([{local_date:'=1+1',status:' +cmd'}],['local_date','status'])).toBe('"local_date","status"\r\n"\'=1+1","\' +cmd"\r\n');
  });
  it('counts approved program steps without treating optional or absent results as failures',()=>{
    const programRules={weights:[{kind:'rehab_step' as const,weight:3}],deferral_treatment:'exempt' as const,achievements:[]};
    const result=calculateProgressDay({local_date:today,time_zone:'America/Toronto',plan_id:key(),plan_version:1,
      plan:{tasks:[],meals:[]},rules:programRules,rule_version:1,activities:[],appointments:[],runs:[{
        id:key(),kind:'rehab',title:'Approved routine',status:'active',version_id:key(),steps:[
          {id:'one',title:'First step',optional:false},{id:'two',title:'Second step',optional:false},{id:'extra',title:'Optional',optional:true}],
        results:[{step_id:'one',outcome:'completed',revision:1}]}]});
    expect(result).toMatchObject({score_percent:100,known_weight:3,missing_count:1});
    expect(result.protocol_versions).toHaveLength(1);
    expect(result.sources).toHaveLength(2);
  });
});

describe('versioned progress and scoped export service',()=>{
  let db:PGlite,pool:Pool,service:ProgressService;
  let client:Session,family:Session,clinician:Session,other:Session;
  let participant:string,taskId:string,mealId:string,activityId:string;
  beforeAll(async()=>{
    db=new PGlite();pool=pglitePool(db) as unknown as Pool;
    for(const file of ['002_local_care.sql','003_activity_ledger.sql','004_client_readiness.sql','005_runtime_observability.sql',
      '006_family_task_requests.sql','007_meals_groceries.sql','008_local_day.sql','009_programs.sql','010_support_team.sql','011_progress.sql'])
      await db.exec(await readFile(new URL(`../db/${file}`,import.meta.url),'utf8'));
    service=new ProgressService(pool,{clock:()=>now});
    async function actor(role:'client'|'family_friend'|'clinician',shared?:string) {
      const id=key(),p=shared??id,token=key(),sessionId=key();
      await pool.query('insert into companion_local.accounts(id,email,password_salt,password_hash) values($1,$2,$3,$3)',[id,`${id}@example.invalid`,Buffer.from('synthetic')]);
      if(!shared)await pool.query("insert into companion_local.participant_profiles(id,display_name,time_zone,preferences) values($1,'Synthetic','America/Toronto','')",[p]);
      await pool.query('insert into companion_local.role_grants(participant_id,actor_id,role) values($1,$2,$3)',[p,id,role]);
      await pool.query('insert into companion_local.sessions(id,actor_id,participant_id,role,access_hash,refresh_hash,expires_at) values($1,$2,$3,$4,$5,$5,$6)',
        [sessionId,id,p,role,createHash('sha256').update(token).digest(),new Date(now.getTime()+3600000)]);
      return {session_id:sessionId,user_id:id,access_token:token,refresh_token:token,issued_at:now.getTime()/1000,expires_at:now.getTime()/1000+3600} satisfies Session;
    }
    client=await actor('client');participant=client.user_id;family=await actor('family_friend',participant);clinician=await actor('clinician',participant);other=await actor('client');
    taskId=key();mealId=key();activityId=key();const checkin=key(),proposal=key(),planId=key();
    await pool.query("insert into companion_local.task_definitions(id,participant_id,title,setup_revision) values($1,$2,'Laundry',1)",[taskId,participant]);
    await pool.query("insert into companion_local.meal_options(id,participant_id,name,slots,setup_revision) values($1,$2,'Soup',array['lunch'],1)",[mealId,participant]);
    await pool.query('insert into companion_local.daily_checkins(id,participant_id,local_date,revision) values($1,$2,$3,2)',[checkin,participant,today]);
    const plan={id:proposal,tasks:[{id:taskId,title:'Laundry',category:'task'}],meals:[{option_id:mealId,slot:'lunch',name:'Soup'}]};
    await pool.query('insert into companion_local.day_plan_proposals(id,checkin_id,participant_id,setup_revision,checkin_revision,plan) values($1,$2,$3,1,1,$4)',
      [proposal,checkin,participant,JSON.stringify(plan)]);
    await pool.query('insert into companion_local.accepted_day_plan_versions(id,checkin_id,participant_id,version,proposal_id,plan) values($1,$2,$3,1,$4,$5)',
      [planId,checkin,participant,proposal,JSON.stringify(plan)]);
    await pool.query('update companion_local.daily_checkins set accepted_version=1 where id=$1',[checkin]);
    await pool.query(`insert into companion_local.activity_records(id,participant_id,local_date,kind,title,source_id,plan_id,unplanned,status,occurred_at,revision,last_action,recorded_at,updated_at)
      values($1,$2,$3,'task','Laundry',$4,$5,false,'completed',$6,1,'reported',$6,$6)`,[activityId,participant,today,taskId,planId,now]);
    await pool.query(`insert into companion_local.activity_records(id,participant_id,local_date,kind,title,source_id,meal_slot,plan_id,unplanned,status,occurred_at,revision,last_action,recorded_at,updated_at)
      values($1,$2,$3,'meal','Soup',$4,'lunch',$5,false,'completed',$6,1,'reported',$6,$6)`,[key(),participant,today,mealId,planId,now]);
  });
  afterAll(async()=>{await db?.close();});


  it('starts unconfigured and requires explicit typed rule approval',async()=>{
    expect((await service.workspace(client,{from:today,to:today})).days[0].status).toBe('unconfigured');
    await expect(service.command(family,{type:'approve_scoring_rules',idempotency_key:key(),expected_rule_version:0,rules,approval_ref:'Synthetic fixture'}))
      .rejects.toMatchObject({status:403});
    const cmd={type:'approve_scoring_rules' as const,idempotency_key:key(),expected_rule_version:0,rules,approval_ref:'Synthetic owner approval'};
    expect((await service.command(client,cmd)).result).toMatchObject({rule_version:1});
    expect((await service.command(client,cmd)).replayed).toBe(true);
    await expect(service.command(client,{...cmd,idempotency_key:key(),rules:{...rules,achievements:[]}})).rejects.toMatchObject({status:409});
  });
  it('calculates only reported facts, dedupes awards and records corrected generations',async()=>{
    const initial=await service.workspace(client,{from:today,to:today});
    expect(initial.days[0]).toMatchObject({score_percent:100,known_weight:3,missing_count:0,stale:true});
    expect(initial.trend).toMatchObject({average_reported_percent:100,days_without_accepted_plan:0});
    const twoDays=await service.workspace(client,{from:'2026-10-12',to:today});
    expect(twoDays.days.map(day=>day.status)).toEqual(['no_plan','ready']);
    expect(twoDays.trend.days_without_accepted_plan).toBe(1);
    const recalc={type:'recalculate_score' as const,idempotency_key:key(),local_date:today};
    const first=await service.command(client,recalc);
    expect(first.result).toMatchObject({generation:1,score_percent:100});
    expect((await service.command(client,{...recalc,idempotency_key:key()})).result).toMatchObject({generation:1,unchanged:true});
    expect((await pool.query('select count(*)::int n from companion_local.progress_awards where participant_id=$1',[participant])).rows[0].n).toBe(1);
    await pool.query("update companion_local.activity_records set status='deferred',occurred_at=null,revision=2,last_action='corrected' where id=$1",[activityId]);
    await pool.query("update companion_local.activity_records set status='deferred',occurred_at=null,revision=2,last_action='corrected' where participant_id=$1 and kind='meal'",[participant]);
    const changed=await service.workspace(client,{from:today,to:today});
    expect(changed.days[0]).toMatchObject({score_percent:null,known_weight:0,corrected_count:2,stale:true});
    expect((await service.command(client,{...recalc,idempotency_key:key()})).result).toMatchObject({generation:2,score_percent:null});
    expect((await pool.query('select active from companion_local.progress_awards where participant_id=$1',[participant])).rows[0].active).toBe(false);
  });
  it('shows awards only under the approved rule version that earned them',async()=>{
    await pool.query("update companion_local.activity_records set status='completed',occurred_at=$2,revision=3,last_action='corrected' where participant_id=$1",[participant,now]);
    await service.command(client,{type:'recalculate_score',idempotency_key:key(),local_date:today});
    expect((await service.workspace(client,{from:today,to:today})).days[0].achievements).toEqual([{key:'day_reviewed',label:'You reviewed your day',active:true}]);
    await service.command(client,{type:'approve_scoring_rules',idempotency_key:key(),expected_rule_version:1,
      rules:{...rules,achievements:[]},approval_ref:'Synthetic rule revision without awards'});
    const current=(await service.workspace(client,{from:today,to:today})).days[0];
    expect(current.rule_version).toBe(2);
    expect(current.achievements).toEqual([]);
    expect((await pool.query('select count(*)::int n from companion_local.progress_awards where participant_id=$1 and active',[participant])).rows[0].n).toBe(1);
  });
  it('requires explicit family sharing and an independent clinician field/export grant',async()=>{
    await expect(service.workspace(family,{from:today,to:today})).rejects.toMatchObject({status:403});
    await expect(service.workspace(clinician,{from:today,to:today})).rejects.toMatchObject({status:403});
    await pool.query(`insert into companion_local.support_shares(participant_id,actor_id,role,share_progress) values($1,$2,'family_friend',true)`,[participant,family.user_id]);
    const shared=await service.workspace(family,{from:today,to:today});
    expect(shared.days[0].sources).toEqual([]);
    await expect(service.command(family,{type:'request_data_export',idempotency_key:key(),from:today,to:today,format:'json',fields:['local_date','status']}))
      .rejects.toMatchObject({status:403});
    const grant={type:'set_progress_access' as const,idempotency_key:key(),actor_id:clinician.user_id,role:'clinician' as const,
      expected_revision:0,can_read:true,can_export:true,can_approve_rules:false,allowed_fields:['local_date','status','score_percent'] as ['local_date','status','score_percent'],max_days:7};
    await service.command(client,grant);
    const view=await service.workspace(clinician,{from:today,to:today,archetype:'diabetes'});
    expect(view.days[0].sources).toEqual([]);
    expect(view.days[0].known_weight).toBeNull();
    await service.command(client,{type:'approve_clinical_config',idempotency_key:key(),archetype:'diabetes',expected_version:0,
      title:'Reviewed daily progress',fields:['local_date','status','score_percent'],approval_ref:'Synthetic clinical review'});
    expect((await service.workspace(clinician,{from:today,to:today,archetype:'diabetes'})).clinical_config)
      .toMatchObject({version:1,title:'Reviewed daily progress'});
    const exportCommand={type:'request_data_export' as const,idempotency_key:key(),from:today,to:today,format:'csv' as const,
      fields:['local_date','status','score_percent'] as ['local_date','status','score_percent']};
    const exported=await service.command(clinician,exportCommand);
    expect(exported.export_content).toContain('"2026-10-13"');
    expect(exported.result).toMatchObject({row_count:1,fields:['local_date','status','score_percent']});
    expect((await service.command(clinician,exportCommand)).export_content).toBeNull();
    expect((await service.receipt(clinician,exportCommand.idempotency_key))?.result).toMatchObject({row_count:1});
    expect((await pool.query('select count(*)::int n from companion_local.progress_exports where participant_id=$1',[participant])).rows[0].n).toBe(1);
    await expect(service.command(clinician,{type:'request_data_export',idempotency_key:key(),from:today,to:today,format:'json',fields:['sources']}))
      .rejects.toMatchObject({status:403});
    await expect(service.command(clinician,{type:'request_data_export',idempotency_key:key(),from:today,to:today,format:'json',
      fields:['local_date','status'],archetype:'neurorehab'})).rejects.toMatchObject({status:409});
    await service.command(client,{...grant,idempotency_key:key(),expected_revision:1,can_read:false,can_export:false,allowed_fields:[]});
    await expect(service.workspace(clinician,{from:today,to:today})).rejects.toMatchObject({status:403});
    await expect(service.receipt(clinician,exportCommand.idempotency_key)).rejects.toMatchObject({status:403});
    await expect(service.command(clinician,exportCommand)).rejects.toMatchObject({status:403});
    expect((await service.workspace(other,{from:today,to:today})).days[0].status).toBe('no_plan');
  });
});
