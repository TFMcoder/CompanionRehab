import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import type { Session } from '../src/server/session.js';
import { SupportTeamService } from '../src/server/support-team.js';
import { pglitePool } from './helpers/pglite-pool.js';

describe('Support Team grants and in-app alerts',()=>{
  let db:PGlite,pool:Pool,service:SupportTeamService,clock=new Date('2026-10-13T02:00:00Z');
  beforeAll(async()=>{
    db=new PGlite();pool=pglitePool(db) as unknown as Pool;
    for(const file of ['002_local_care.sql','003_activity_ledger.sql','004_client_readiness.sql','005_runtime_observability.sql','006_family_task_requests.sql','010_support_team.sql'])
      await db.exec(await readFile(new URL(`../db/${file}`,import.meta.url),'utf8'));
    service=new SupportTeamService(pool,{clock:()=>clock});
  });
  afterAll(async()=>{await db.close();});
  async function actor(role:'client'|'family_friend'|'administrator'|'clinician',participant?:string) {
    const id=randomUUID(),p=participant??id,token=randomUUID(),sid=randomUUID();
    await pool.query('insert into companion_local.accounts(id,email,password_salt,password_hash) values($1,$2,$3,$3)',[id,`${id}@example.invalid`,Buffer.from('synthetic')]);
    if(!participant)await pool.query("insert into companion_local.participant_profiles(id,display_name,time_zone) values($1,'Synthetic client','America/Toronto')",[p]);
    await pool.query('insert into companion_local.role_grants(participant_id,actor_id,role) values($1,$2,$3)',[p,id,role]);
    await pool.query('insert into companion_local.sessions(id,actor_id,participant_id,role,access_hash,refresh_hash,expires_at) values($1,$2,$3,$4,$5,$5,$6)',[sid,id,p,role,createHash('sha256').update(token).digest(),new Date('2026-12-01T00:00:00Z')]);
    return {session_id:sid,user_id:id,access_token:token,refresh_token:token,issued_at:clock.getTime()/1000,expires_at:Date.parse('2026-12-01T00:00:00Z')/1000} satisfies Session;
  }
  const key=()=>randomUUID();
  async function share(client:Session,recipient:Session,role:'family_friend'|'administrator'|'clinician',tasks:boolean,meals:boolean,revision=0) {
    return service.command(client,{type:'set_support_share',idempotency_key:key(),actor_id:recipient.user_id,role,expected_revision:revision,
      share_tasks:tasks,share_meals:meals,share_progress:false});
  }
  async function prefs(recipient:Session,revision=0,overrides:Partial<{task_completion:boolean;meal_completion:boolean;task_reschedule:boolean;meal_reschedule:boolean;quiet_start:string|null;quiet_end:string|null}>={}) {
    return service.command(recipient,{type:'set_support_notifications',idempotency_key:key(),expected_revision:revision,
      task_completion:false,meal_completion:false,task_reschedule:false,meal_reschedule:false,quiet_start:null,quiet_end:null,time_zone:'America/Toronto',...overrides});
  }
  async function acceptedPlan(client:Session) {
    const check=randomUUID(),proposal=randomUUID(),task=randomUUID(),meal=randomUUID(),date='2026-10-12';
    const plan={id:proposal,task_ids:[task],tasks:[{id:task,title:'Synthetic laundry',urgency:'low',scheduled_time:'16:00'}],
      meals:[{slot:'dinner',option_id:meal,name:'Private synthetic soup'}],created_at:clock.toISOString()};
    await pool.query('insert into companion_local.daily_checkins(id,participant_id,local_date,revision) values($1,$2,$3,1)',[check,client.user_id,date]);
    await pool.query('insert into companion_local.day_plan_proposals(id,checkin_id,participant_id,setup_revision,checkin_revision,plan) values($1,$2,$3,0,1,$4)',[proposal,check,client.user_id,JSON.stringify(plan)]);
    await pool.query('insert into companion_local.accepted_day_plan_versions(checkin_id,participant_id,version,proposal_id,plan) values($1,$2,1,$3,$4)',[check,client.user_id,proposal,JSON.stringify(plan)]);
    await pool.query('update companion_local.daily_checkins set accepted_version=1,current_proposal_id=$2 where id=$1',[check,proposal]);
    return {task,meal,date};
  }
  async function activity(client:Session,kind:'task'|'meal',type:'ActivityReported'|'ActivityRescheduled',status:'completed'|'pending',date='2026-10-12') {
    const id=randomUUID(),command=randomUUID(),revision=1,created=new Date(clock.getTime()+1000);
    const title=kind==='meal'?'Private synthetic soup':'Synthetic laundry';
    await pool.query(`insert into companion_local.append_only_mutations(participant_id,command_id,actor_id,command,result,event_type,created_at)
      values($1,$2,$1,'{}','{}',$3,$4)`,[client.user_id,command,type,created]);
    await pool.query(`insert into companion_local.activity_records(id,participant_id,local_date,kind,title,source_id,meal_slot,plan_id,unplanned,scheduled_at,
      status,occurred_at,revision,last_action,recorded_at,updated_at,last_actor_id,last_command_id)
      values($1,$2,$3,$4,$5,null,$6,null,true,$7,$8,$9,$10,$11,$12,$12,$2,$13)`,
      [id,client.user_id,date,kind,title,kind==='meal'?'dinner':null,type==='ActivityRescheduled'?created:null,status,
        status==='completed'?created:null,revision,type==='ActivityReported'?'reported':'rescheduled',created,command]);
    const event=randomUUID();
    await pool.query(`insert into companion_local.domain_events(id,participant_id,actor_id,command_id,event_type,local_date,data,created_at)
      values($1,$2,$2,$3,$4,$5,$6,$7)`,[event,client.user_id,command,type,date,JSON.stringify({activity_id:id,after:{revision}}),created]);
    return {id,command,event};
  }
  it('shows only separately consented tasks or meals and paginates without clinical details',async()=>{
    const client=await actor('client'),family=await actor('family_friend',client.user_id),admin=await actor('administrator',client.user_id);
    await acceptedPlan(client);
    expect((await service.workspace(family,{date:'2026-10-12'})).items).toEqual([]);
    const granted=await share(client,family,'family_friend',true,false);
    expect((await service.command(client,{type:'set_support_share',idempotency_key:granted.command_id,actor_id:family.user_id,role:'family_friend',expected_revision:0,share_tasks:true,share_meals:false,share_progress:false})).replayed).toBe(true);
    const board=await service.workspace(family,{date:'2026-10-12',limit:1});
    expect(board.items.map(i=>i.title)).toEqual(['Synthetic laundry']);
    expect(JSON.stringify(board)).not.toContain('Private synthetic soup');
    expect(board.progress_status).toBe('unavailable');
    await expect(service.command(admin,{type:'set_support_share',idempotency_key:key(),actor_id:family.user_id,role:'family_friend',expected_revision:1,share_tasks:true,share_meals:true,share_progress:true})).rejects.toMatchObject({status:403});
    await share(client,family,'family_friend',true,true,1);
    const first=await service.workspace(family,{date:'2026-10-12',limit:1});expect(first.next_items_cursor).toBeTruthy();
    const second=await service.workspace(family,{date:'2026-10-12',limit:1,items_cursor:first.next_items_cursor!});
    expect([...first.items,...second.items].map(i=>i.title).sort()).toEqual(['Private synthetic soup','Synthetic laundry']);
  });
  it('materializes only opted-in committed task/meal changes once, then honors quiet hours, correction and revocation',async()=>{
    const client=await actor('client'),family=await actor('family_friend',client.user_id);
    await share(client,family,'family_friend',true,false);
    await prefs(family,0,{task_completion:true,quiet_start:'21:00',quiet_end:'07:00'});
    const task=await activity(client,'task','ActivityReported','completed');
    await activity(client,'meal','ActivityReported','completed');
    expect(await service.refreshNotifications()).toBe(1);
    expect(await service.refreshNotifications()).toBe(0);
    const quiet=await service.workspace(family,{date:'2026-10-12'});
    expect(quiet.notifications_quiet).toBe(true);expect(quiet.notifications).toEqual([]);
    clock=new Date('2026-10-13T12:00:00Z');
    const visible=await service.workspace(family,{date:'2026-10-12'});
    expect(visible.notifications).toHaveLength(1);expect(visible.notifications[0]).toMatchObject({kind:'task',type:'completed',activity_id:task.id});
    const correction=randomUUID();
    await pool.query("insert into companion_local.append_only_mutations(participant_id,command_id,actor_id,command,result,event_type) values($1,$2,$1,'{}','{}','ActivityCorrected')",[client.user_id,correction]);
    await pool.query("update companion_local.activity_records set revision=2,status='voided',occurred_at=null,last_action='corrected',last_command_id=$2 where id=$1",[task.id,correction]);
    expect((await service.workspace(family,{date:'2026-10-12'})).notifications).toEqual([]);
    await share(client,family,'family_friend',false,false,1);
    expect((await service.workspace(family,{date:'2026-10-12'})).items).toEqual([]);
    expect((await service.workspace(family,{date:'2026-10-12'})).notifications).toEqual([]);
  });
  it('requires each recipient opt-in and suppresses stale alerts after opt-out or reschedule supersession',async()=>{
    clock=new Date('2026-10-13T02:00:00Z');
    const client=await actor('client'),family=await actor('family_friend',client.user_id),outsider=await actor('family_friend');
    await share(client,family,'family_friend',true,true);
    const scheduled=await activity(client,'meal','ActivityRescheduled','pending');
    expect(await service.refreshNotifications()).toBe(0);
    clock=new Date(clock.getTime()+2000);
    await prefs(family,0,{meal_reschedule:true});
    expect(await service.refreshNotifications()).toBe(0); // earlier event is not retroactively delivered
    const later=await activity(client,'meal','ActivityRescheduled','pending');
    expect(await service.refreshNotifications()).toBe(1);
    expect((await service.workspace(family,{date:'2026-10-12'})).notifications).toHaveLength(1);
    await prefs(family,1,{meal_reschedule:false});
    expect((await service.workspace(family,{date:'2026-10-12'})).notifications).toEqual([]);
    await expect(service.workspace(outsider,{date:'2026-10-12'})).resolves.toMatchObject({items:[],notifications:[]});
    expect(later.event).not.toBe(scheduled.event);
  });
  it('bounds each notification scan and rotates through participants with backlog',async()=>{
    clock=new Date('2026-10-13T14:00:00Z');
    const client=await actor('client'),family=await actor('family_friend',client.user_id);
    await share(client,family,'family_friend',true,false);await prefs(family,0,{task_completion:true});
    for(let i=0;i<25;i++)await activity(client,'task','ActivityReported','completed');
    const others:Session[]=[];
    for(let i=0;i<9;i++){const person=await actor('client');others.push(person);await activity(person,'task','ActivityReported','completed');}
    await service.refreshNotifications();
    const count=async(participant:string)=>Number((await pool.query(`select count(*)::int as n from companion_local.support_notification_scanned s
      join companion_local.domain_events e on e.id=s.event_id where e.participant_id=$1`,[participant])).rows[0].n);
    expect(await count(client.user_id)).toBeLessThanOrEqual(SupportTeamService.eventsPerParticipant);
    for(let i=0;i<5;i++)await service.refreshNotifications();
    expect(await count(client.user_id)).toBe(25);
    for(const person of others)expect(await count(person.user_id)).toBe(1);
    const first=await service.workspace(family,{date:'2026-10-12'});
    expect(first.notifications).toHaveLength(20);expect(first.next_notifications_cursor).toBeTruthy();
    const second=await service.workspace(family,{date:'2026-10-12',notifications_cursor:first.next_notifications_cursor!});
    expect(second.notifications).toHaveLength(5);expect(second.next_notifications_cursor).toBeNull();
    expect(new Set([...first.notifications,...second.notifications].map(n=>n.id)).size).toBe(25);
  });
  it('denies a prior mark-read receipt and replay after the matching activity share is revoked',async()=>{
    clock=new Date('2026-10-13T15:00:00Z');
    const client=await actor('client'),family=await actor('family_friend',client.user_id);
    await share(client,family,'family_friend',true,false);
    await prefs(family,0,{task_completion:true});
    await activity(client,'task','ActivityReported','completed');
    let notification;
    for(let i=0;i<6&&!notification;i++){
      await service.refreshNotifications();
      notification=(await service.workspace(family,{date:'2026-10-12'})).notifications[0];
    }
    expect(notification).toBeDefined();
    if(!notification)throw new Error('Synthetic notification was not materialized.');
    const command={type:'mark_support_notification_read' as const,idempotency_key:key(),notification_id:notification.id};
    expect((await service.command(family,command)).result).toMatchObject({read:true});
    await share(client,family,'family_friend',false,false,1);
    await expect(service.receipt(family,command.idempotency_key)).rejects.toMatchObject({status:403});
    await expect(service.command(family,command)).rejects.toMatchObject({status:403});
  });
});
