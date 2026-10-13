import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import type { Session } from '../src/server/session.js';
import { OperationsService } from '../src/server/operations.js';
import { pglitePool } from './helpers/pglite-pool.js';

describe('scoped administrator operations',()=>{
  let db:PGlite,pool:Pool,service:OperationsService;
  const now=new Date('2026-10-13T12:00:00Z');
  beforeAll(async()=>{
    db=new PGlite();pool=pglitePool(db) as unknown as Pool;
    for(const file of ['002_local_care.sql','003_activity_ledger.sql','004_client_readiness.sql','005_runtime_observability.sql','006_family_task_requests.sql','012_operations.sql'])
      await db.exec(await readFile(new URL(`../db/${file}`,import.meta.url),'utf8'));
    service=new OperationsService(pool,{clock:()=>now});
  });
  afterAll(async()=>{await db.close();});
  async function actor(role:'client'|'administrator'|'family_friend',participant?:string) {
    const id=randomUUID(),p=participant??id,token=randomUUID(),sid=randomUUID();
    await pool.query('insert into companion_local.accounts(id,email,password_salt,password_hash) values($1,$2,$3,$3)',[id,`${id}@example.invalid`,Buffer.from('synthetic')]);
    if(!participant)await pool.query("insert into companion_local.participant_profiles(id,display_name,time_zone) values($1,'Synthetic client','America/Toronto')",[p]);
    await pool.query('insert into companion_local.role_grants(participant_id,actor_id,role) values($1,$2,$3)',[p,id,role]);
    await pool.query('insert into companion_local.sessions(id,actor_id,participant_id,role,access_hash,refresh_hash,expires_at) values($1,$2,$3,$4,$5,$5,$6)',[sid,id,p,role,createHash('sha256').update(token).digest(),new Date(now.getTime()+86400000)]);
    return {session_id:sid,user_id:id,access_token:token,refresh_token:token,issued_at:now.getTime()/1000,expires_at:now.getTime()/1000+86400} satisfies Session;
  }
  const key=()=>randomUUID();
  async function access(client:Session,admin:Session,revision:number,view:boolean,manage=false,audit=false) {
    return service.command(client,{type:'set_operations_access',idempotency_key:key(),actor_id:admin.user_id,expected_revision:revision,
      can_view:view,can_manage_local_issues:manage,can_view_audit:audit});
  }
  async function held(client:Session) {
    const event=randomUUID(),target=randomUUID(),intent=randomUUID();
    await pool.query(`insert into companion_local.domain_events(id,participant_id,actor_id,event_type,data) values($1,$2,$2,'SyntheticCareEvent',$3)`,[event,client.user_id,JSON.stringify({private:'PRIVATE NOTE'})]);
    await pool.query(`insert into companion_local.actuation_targets(id,participant_id,system,provider,destination_ref,created_by)
      values($1,$2,'email','Synthetic provider',$3,$2)`,[target,client.user_id,`SECRET-DESTINATION-${target}`]);
    await pool.query(`insert into companion_local.actuation_intents(id,participant_id,event_id,target_id,operation,request,requested_by)
      values($1,$2,$3,$4,'notify',$5,$2)`,[intent,client.user_id,event,target,JSON.stringify({body:'SECRET-REQUEST'})]);
    return intent;
  }
  it('requires client-scoped operator grant and keeps audit permission separate',async()=>{
    const client=await actor('client'),admin=await actor('administrator',client.user_id),family=await actor('family_friend',client.user_id);
    expect((await service.workspace(client)).operators).toMatchObject([{actor_id:admin.user_id,revision:0,can_view:false}]);
    await expect(service.workspace(admin)).rejects.toMatchObject({status:403});
    await expect(service.workspace(family)).rejects.toMatchObject({status:403});
    await expect(access(client,admin,0,false,true)).rejects.toMatchObject({status:400});
    const granted=await access(client,admin,0,true);
    const replay=await service.command(client,{type:'set_operations_access',idempotency_key:granted.command_id,actor_id:admin.user_id,
      expected_revision:0,can_view:true,can_manage_local_issues:false,can_view_audit:false});
    expect(replay.replayed).toBe(true);expect(replay.result).toMatchObject({revision:1});
    await expect(service.command(client,{type:'set_operations_access',idempotency_key:granted.command_id,actor_id:admin.user_id,
      expected_revision:0,can_view:true,can_manage_local_issues:true,can_view_audit:false})).rejects.toMatchObject({code:'conflict'});
    const workspace=await service.workspace(admin);expect(workspace).toMatchObject({role:'administrator',can_view:true,can_view_audit:false,audit_available:false,audit:[]});
    expect(workspace.connector).toMatchObject({state:'not_connected',failed_syncs:'unknown',last_sync_at:null});
    await expect(service.command(admin,{type:'note_held_intent',idempotency_key:key(),intent_id:randomUUID(),expected_revision:0,note:'Inspect locally'})).rejects.toMatchObject({status:403});
  });
  it('shows a redacted held-intent timeline, versions local review, and never dispatches',async()=>{
    const client=await actor('client'),admin=await actor('administrator',client.user_id),other=await actor('administrator',client.user_id);
    const one=await held(client),two=await held(client);
    await access(client,admin,0,true,true,true);
    await expect(service.workspace(other)).rejects.toMatchObject({status:403});
    const first=await service.workspace(admin,{limit:1});expect(first.next_cursor).toBeTruthy();
    const second=await service.workspace(admin,{limit:1,cursor:first.next_cursor!});
    expect(new Set([...first.held_intents,...second.held_intents].map(i=>i.id))).toEqual(new Set([one,two]));
    expect(JSON.stringify(first)).not.toContain('SECRET-DESTINATION');expect(JSON.stringify(first)).not.toContain('SECRET-REQUEST');
    expect(JSON.stringify(first)).not.toContain('PRIVATE NOTE');
    expect(first.audit_available).toBe(true);expect(first.audit.some(i=>i.event_type==='SyntheticCareEvent')).toBe(true);
    const noteCommand={type:'note_held_intent' as const,idempotency_key:key(),intent_id:one,expected_revision:0,note:'Check the local target.'};
    const noted=await service.command(admin,noteCommand);
    expect(noted.result).toMatchObject({review_status:'open',revision:1,intent_state:'held'});
    await expect(service.command(admin,{type:'resolve_held_intent_review',idempotency_key:key(),intent_id:one,expected_revision:2,note:'Closed'})).rejects.toMatchObject({code:'conflict'});
    const resolved=await service.command(admin,{type:'resolve_held_intent_review',idempotency_key:key(),intent_id:one,expected_revision:1,note:'Reviewed; connector remains off.'});
    expect(resolved.result).toMatchObject({review_status:'resolved',revision:2,intent_state:'held'});
    expect((await pool.query('select state from companion_local.actuation_intents where id=$1',[one])).rows[0].state).toBe('held');
    expect((await service.workspace(admin)).held_intents.find(i=>i.id===one)).toMatchObject({review_status:'resolved',review_revision:2});
    await access(client,admin,1,false);
    await expect(service.command(admin,noteCommand)).rejects.toMatchObject({status:403});
  });
  it('derives day counts from accepted plan and actual ledger, then revokes access',async()=>{
    const client=await actor('client'),admin=await actor('administrator',client.user_id),date='2026-10-13';
    const check=randomUUID(),proposal=randomUUID();
    const plan={id:proposal,tasks:[{id:randomUUID(),title:'Synthetic task'}],meals:[{slot:'lunch',option_id:randomUUID(),name:'Synthetic meal'}]};
    await pool.query('insert into companion_local.daily_checkins(id,participant_id,local_date,revision) values($1,$2,$3,1)',[check,client.user_id,date]);
    await pool.query('insert into companion_local.day_plan_proposals(id,checkin_id,participant_id,setup_revision,checkin_revision,plan) values($1,$2,$3,0,1,$4)',[proposal,check,client.user_id,JSON.stringify(plan)]);
    await pool.query('insert into companion_local.accepted_day_plan_versions(checkin_id,participant_id,version,proposal_id,plan) values($1,$2,1,$3,$4)',[check,client.user_id,proposal,JSON.stringify(plan)]);
    await pool.query('update companion_local.daily_checkins set accepted_version=1 where id=$1',[check]);
    await pool.query(`insert into companion_local.activity_records(id,participant_id,local_date,kind,title,unplanned,status,occurred_at,revision,last_action,recorded_at,updated_at)
      values($1,$2,$3,'task','Synthetic task',true,'completed',$4,1,'reported',$4,$4)`,[randomUUID(),client.user_id,date,now]);
    await access(client,admin,0,true);
    const day=(await service.workspace(admin,{date})).day;
    expect(day).toMatchObject({accepted_plan_version:1,planned_tasks:1,planned_meals:1,completed_tasks:1,completed_meals:0,appointments_scheduled:0});
    await access(client,admin,1,false);
    await expect(service.workspace(admin,{date})).rejects.toMatchObject({status:403});
    await expect(service.receipt(admin,key())).rejects.toMatchObject({status:403});
  });
});
