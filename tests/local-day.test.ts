import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { pglitePool } from './helpers/pglite-pool.js';
import { LocalCare } from '../src/server/local-care.js';
import { LocalDayService, isQuiet } from '../src/server/local-day.js';
import type { Session } from '../src/server/session.js';
import type { LocalDayCommand, PromptPreferences } from '../src/shared/local-day-contracts.js';
import { localCareMigrations } from '../src/server/local-migrations.js';

describe('local day review and consented scheduler',()=>{
 let db:PGlite,pool:Pool,care:LocalCare,service:LocalDayService;
 let now=new Date('2026-10-13T12:00:00Z');
 beforeAll(async()=>{db=new PGlite();pool=pglitePool(db) as unknown as Pool;
  for(const file of localCareMigrations)await db.exec(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));
  care=new LocalCare({pool,clock:()=>now});service=new LocalDayService(pool,()=>now);
 });
 afterAll(async()=>db.close());
 async function account(role='client',participant?:string){
  const id=randomUUID(),token=randomUUID(),session:Session={session_id:randomUUID(),user_id:id,access_token:token,refresh_token:randomUUID(),issued_at:0,expires_at:9999999999};
  await pool.query('insert into companion_local.accounts(id,email,password_salt,password_hash) values($1,$2,$3,$3)',[id,id+'@example.invalid',Buffer.from('synthetic')]);
  if(!participant)await pool.query("insert into companion_local.participant_profiles(id,display_name,time_zone) values($1,'Synthetic','America/Toronto')",[id]);
  await pool.query('insert into companion_local.role_grants(participant_id,actor_id,role) values($1,$2,$3)',[participant??id,id,role]);
  await pool.query('insert into companion_local.sessions(id,actor_id,participant_id,role,access_hash,refresh_hash,expires_at) values($1,$2,$3,$4,$5,$6,$7)',[session.session_id,id,participant??id,role,createHash('sha256').update(token).digest(),createHash('sha256').update(session.refresh_token).digest(),new Date('2030-01-01')]);return session;
 }
 const key=()=>({idempotency_key:randomUUID(),confirmed:true as const});
 async function plan(s:Session){
  let today=await care.today(s);
  if(!today.tasks.length)today=await care.setup(s,{display_name:'Synthetic',time_zone:'America/Toronto',expected_revision:today.profile!.revision,preferences:'',tasks:[{title:'Synthetic task',time_hint:null}],meal_options:[{name:'Synthetic meal',slots:['breakfast','lunch','dinner']}]});
  await care.command(s,{type:'start_or_resume_checkin',idempotency_key:randomUUID(),local_date:today.local_date,expected_revision:0,payload:{}});
  today=await care.today(s);
  const p=await care.command(s,{type:'propose_day_plan',idempotency_key:randomUUID(),local_date:today.local_date,expected_revision:today.checkin!.revision,payload:{task_ids:today.tasks.map(t=>t.id),meals:['breakfast','lunch','dinner'].map(slot=>({slot,option_id:today.meal_options[0].id}))}});
  await care.command(s,{type:'accept_day_plan',idempotency_key:randomUUID(),local_date:today.local_date,expected_revision:p.revision,payload:{proposal_id:p.plan!.id}});return care.today(s);
 }
 async function prefs(s:Session,change:Partial<PromptPreferences>={}){
  const current=(await service.workspace(s)).preferences;const {revision,...preferences}={...current,...change};
  return service.command(s,{...key(),type:'set_prompt_preferences',expected_revision:current.revision,preferences});
 }
 it('defaults to no reminders and rejects family and forged sessions',async()=>{
  now=new Date('2026-10-13T12:00:00Z');const s=await account(),family=await account('family_friend',s.user_id);
  expect((await service.workspace(s)).preferences.enabled).toBe(false);
  expect(await service.claimPrompt(s)).toBeNull();
  await expect(service.workspace(family)).rejects.toMatchObject({status:403});
  await expect(service.workspace({...s,user_id:family.user_id})).rejects.toMatchObject({status:401});
 });
 it('only proposes carryover, retains old days and requires exact plan acceptance',async()=>{
  now=new Date('2026-10-12T12:00:00Z');const s=await account();await plan(s);
  now=new Date('2026-10-13T12:00:00Z');const today=await plan(s),before=await service.workspace(s),item=before.carryover[0];
  const command:LocalDayCommand={...key(),type:'decide_carryover',source_date:item.source_date,source_plan_id:item.source_plan_id,source_activity_id:item.activity_id,source_revision:item.revision,target_date:before.local_date,decision:'reschedule',expected_day_revision:before.day_revision,scheduled_time:'11:00',urgency:'low',duration_minutes:15,note:'Synthetic review'};
  const saved=await service.command(s,command);expect(saved.result).toBe('proposed');
  expect(saved.proposal!.task_ids).toEqual([item.task.id]);
  expect((await pool.query('select source_plan_id from companion_local.carryover_decisions where command_id=$1',[command.idempotency_key])).rows[0].source_plan_id).toBe(item.source_plan_id);
  expect((await care.today(s)).checkin!.accepted!.id).toBe(today.checkin!.accepted!.id);
  expect((await service.workspace(s)).carryover).toHaveLength(1);
  expect((await service.command(s,command)).replayed).toBe(true);
  await expect(service.command(s,{...command,note:'Changed'})).rejects.toMatchObject({status:409});
  await care.command(s,{type:'accept_day_plan',idempotency_key:randomUUID(),local_date:before.local_date,expected_revision:saved.revision,payload:{proposal_id:saved.proposal!.id}});
  expect((await service.workspace(s)).carryover).toHaveLength(0);
  expect((await care.ledger(s,'2026-10-12')).summary.tasks_completed).toBe(0);
 });
 it('cancel and help decisions preserve actual facts; stale or unknown targets fail',async()=>{
  now=new Date('2026-10-12T12:00:00Z');const s=await account();await plan(s);now=new Date('2026-10-13T12:00:00Z');
  const w=await service.workspace(s),item=w.carryover[0];
  const c:LocalDayCommand={...key(),type:'decide_carryover',source_date:item.source_date,source_plan_id:item.source_plan_id,source_activity_id:item.activity_id,source_revision:0,target_date:w.local_date,decision:'help',expected_day_revision:0,scheduled_time:null,urgency:'medium',duration_minutes:null,note:''};
  await expect(service.command(s,c)).rejects.toMatchObject({status:400});
  await expect(service.command(s,{...c,note:'Please help',source_revision:999})).rejects.toMatchObject({status:409});
  await expect(service.command(s,{...c,note:'Please help',source_plan_id:randomUUID()})).rejects.toMatchObject({status:409});
  await service.command(s,{...c,note:'Please help'});expect((await service.workspace(s)).carryover).toHaveLength(0);
  expect((await service.workspace(s)).carryover_history).toEqual([expect.objectContaining({decision:'help',note:'Please help',source_plan_id:item.source_plan_id})]);
  expect((await care.ledger(s,'2026-10-12')).entries).toHaveLength(0);
 });
 it('reusable choices are suggestions, not accepted or automatically performed work',async()=>{
  now=new Date('2026-10-13T12:00:00Z');const s=await account(),today=await plan(s);
  await service.command(s,{...key(),type:'set_routine_choices',expected_revision:0,selections:{weekdays:[2],task_ids:[today.tasks[0].id],meals:[{slot:'breakfast',option_id:today.meal_options[0].id}]}});
  expect((await service.workspace(s)).routine_suggestions.task_ids).toEqual([today.tasks[0].id]);
  now=new Date('2026-10-14T12:00:00Z');expect((await service.workspace(s)).routine_suggestions.task_ids).toEqual([]);
  expect((await care.today(s)).checkin).toBeNull();
 });
 it('scheduler queues one prompt, claims once, and records truthful delivery',async()=>{
  now=new Date('2026-10-13T12:00:00Z');const s=await account();await plan(s);
  await prefs(s,{enabled:true,meal_times:{breakfast:'08:05',lunch:null,dinner:null},foreground_speech:true});
  await service.tick();expect(await service.claimPrompt(s)).toBeNull();
  now=new Date('2026-10-13T12:05:00Z');await service.tick();await service.tick();
  const prompt=await service.claimPrompt(s);expect(prompt?.message).toContain('Synthetic meal');
  expect(await service.claimPrompt(s)).toBeNull();
  expect(await service.promptText(s,prompt!.id,prompt!.claim_token!)).toContain('breakfast');
  const attempts=await Promise.allSettled([service.beginPromptSpeech(s,prompt!.id,prompt!.claim_token!),service.beginPromptSpeech(s,prompt!.id,prompt!.claim_token!)]);
  expect(attempts.filter(a=>a.status==='fulfilled')).toHaveLength(1);
  expect(attempts.filter(a=>a.status==='rejected').map(a=>a.reason)).toEqual([expect.objectContaining({status:409,code:'speech_already_requested'})]);
  expect((await pool.query("select count(*)::int as n from companion_local.prompt_delivery_events where prompt_id=$1 and event_type='speech_dispatch_attempt'",[prompt!.id])).rows[0].n).toBe(1);
  expect(await service.promptText(s,prompt!.id,prompt!.claim_token!)).toContain('breakfast');
  expect(await service.acknowledgePrompt(s,prompt!.id,prompt!.claim_token!,'speech')).toEqual({ok:true,replayed:false});
  expect(await service.acknowledgePrompt(s,prompt!.id,prompt!.claim_token!,'speech')).toEqual({ok:true,replayed:true});
  expect((await service.workspace(s)).prompts.filter(p=>p.state==='delivered')).toHaveLength(1);
 });
 it('revoked consent invalidates claimed speech, and restart does not announce expired work',async()=>{
  now=new Date('2026-10-13T12:00:00Z');const s=await account();await plan(s);
  await prefs(s,{enabled:true,meal_times:{breakfast:'08:00',lunch:null,dinner:null},foreground_speech:true});
  const claimed=await service.claimPrompt(s);expect(claimed).not.toBeNull();
  await prefs(s,{enabled:false});await expect(service.promptText(s,claimed!.id,claimed!.claim_token!)).rejects.toMatchObject({status:403});
  await prefs(s,{enabled:true});now=new Date('2026-10-13T13:00:00Z');const restarted=new LocalDayService(pool,()=>now);await restarted.tick();
  expect(await restarted.claimPrompt(s)).toBeNull();expect((await restarted.workspace(s)).prompts.some(p=>p.state==='missed')).toBe(true);
 });
 it('quiet hours handle overnight and same-day windows without disabling all hours',()=>{
  expect(isQuiet(new Date('2026-10-13T02:00:00Z'),'America/Toronto','21:00','08:00')).toBe(true);
  expect(isQuiet(new Date('2026-10-13T15:00:00Z'),'America/Toronto','21:00','08:00')).toBe(false);
  expect(isQuiet(now,'America/Toronto','08:00','08:00')).toBe(false);
 });
 it('pages past 31 accepted dates even when older pages have no unresolved tasks',async()=>{
  const s=await account();now=new Date('2026-09-01T12:00:00Z');await plan(s);
  now=new Date('2026-09-02T12:00:00Z');const early=await service.workspace(s),task=early.carryover[0];
  await service.command(s,{...key(),type:'decide_carryover',source_date:task.source_date,source_plan_id:task.source_plan_id,source_activity_id:task.activity_id,source_revision:task.revision,target_date:early.local_date,decision:'cancel',expected_day_revision:early.day_revision,scheduled_time:null,urgency:'medium',duration_minutes:null,note:'Old choice'});
  for(let offset=1;offset<=35;offset++){now=new Date(Date.UTC(2026,8,1+offset,12));await plan(s);}
  now=new Date('2026-10-07T12:00:00Z');const recent=await service.workspace(s);
  expect(recent.next_carryover_before).not.toBeNull();expect(recent.carryover.map(v=>v.task.id)).toHaveLength(1);
  const older=await service.workspace(s,recent.next_carryover_before!);
  expect(older.carryover).toHaveLength(0);
  expect(older.carryover_history).toEqual([expect.objectContaining({decision:'cancel',note:'Old choice',source_date:'2026-09-01'})]);
  expect(older.next_carryover_before).toBeNull();
 });
 it('returns stale claims as uncertain text only, and deduplicates preference saves after delivery',async()=>{
  now=new Date('2026-10-13T12:05:00Z');const s=await account();await plan(s);
  await prefs(s,{enabled:true,meal_times:{breakfast:'08:05',lunch:null,dinner:null},foreground_speech:true,browser_notifications:true});
  const first=await service.claimPrompt(s);expect(first).not.toBeNull();
  now=new Date('2026-10-13T12:07:00Z');const restarted=new LocalDayService(pool,()=>now);
  const uncertain=await restarted.claimPrompt(s);expect(uncertain).toEqual(expect.objectContaining({id:first!.id,delivery_uncertain:true,foreground_speech:false,browser_notifications:false}));
  await expect(restarted.promptText(s,first!.id,first!.claim_token!)).rejects.toMatchObject({status:403});
  await expect(restarted.acknowledgePrompt(s,uncertain!.id,uncertain!.claim_token!,'speech')).rejects.toMatchObject({status:403});
  expect(await restarted.acknowledgePrompt(s,uncertain!.id,uncertain!.claim_token!,'in_app')).toEqual({ok:true,replayed:false});
  await prefs(s,{enabled:true,meal_times:{breakfast:'08:05',lunch:null,dinner:null},foreground_speech:true,browser_notifications:true});
  await restarted.tick();expect(await restarted.claimPrompt(s)).toBeNull();
  expect((await pool.query("select count(*)::int as count from companion_local.prompt_jobs where participant_id=$1 and state='delivered'",[s.user_id])).rows[0].count).toBe(1);
 });
 it('suppresses ambiguous and nonexistent local reminder times',async()=>{
  const s=await account();now=new Date('2026-03-08T05:00:00Z');await plan(s);
  await prefs(s,{enabled:true,meal_times:{breakfast:'02:30',lunch:null,dinner:null}});
  await service.tick();expect((await service.workspace(s)).prompts).toHaveLength(0);
  now=new Date('2026-11-01T04:00:00Z');await plan(s);
  await prefs(s,{enabled:true,meal_times:{breakfast:'01:30',lunch:null,dinner:null}});
  await service.tick();expect((await service.workspace(s)).prompts).toHaveLength(0);
 });
 it('stops speech and delivery when quiet hours begin after a claim',async()=>{
  now=new Date('2026-10-13T12:05:00Z');const s=await account();await plan(s);
  await prefs(s,{enabled:true,meal_times:{breakfast:'08:05',lunch:null,dinner:null},quiet_start:'08:06',quiet_end:'08:10',foreground_speech:true});
  const claimed=await service.claimPrompt(s);expect(claimed).not.toBeNull();
  now=new Date('2026-10-13T12:07:00Z');
  await expect(service.promptText(s,claimed!.id,claimed!.claim_token!)).rejects.toMatchObject({status:403});
  await expect(service.acknowledgePrompt(s,claimed!.id,claimed!.claim_token!,'speech')).rejects.toMatchObject({status:409});
 });
 it('cancels claims after client-grant revocation',async()=>{
  now=new Date('2026-10-13T12:05:00Z');const s=await account();await plan(s);
  await prefs(s,{enabled:true,meal_times:{breakfast:'08:05',lunch:null,dinner:null},foreground_speech:true});
  const claimed=await service.claimPrompt(s);expect(claimed).not.toBeNull();
  await pool.query('update companion_local.role_grants set revoked_at=$1 where participant_id=$2 and actor_id=$2 and role=$3',[now,s.user_id,'client']);
  await service.tick();
  expect((await pool.query('select state from companion_local.prompt_jobs where id=$1',[claimed!.id])).rows[0].state).toBe('cancelled');
  await expect(service.promptText(s,claimed!.id,claimed!.claim_token!)).rejects.toMatchObject({status:401});
 });
 it('bounds each scheduler tick and rotates fairly through enabled clients',async()=>{
  now=new Date('2026-10-13T12:05:00Z');const participants:Session[]=[];
  for(let i=0;i<10;i++){
   const s=await account();participants.push(s);await plan(s);
   await prefs(s,{enabled:true,meal_times:{breakfast:'08:05',lunch:null,dinner:null}});
  }
  const ids=participants.map(s=>s.user_id);
  const pending=async()=>Number((await pool.query("select count(*)::int as n from companion_local.prompt_jobs where participant_id=any($1::uuid[]) and source_key like 'meal:%'",[ids])).rows[0].n);
  await service.tick();expect(await pending()).toBeLessThanOrEqual(LocalDayService.participantsPerTick);
  for(let i=0;i<5;i++)await service.tick();
  expect(await pending()).toBe(10);
  expect((await pool.query('select count(*)::int as n from companion_local.prompt_scheduler_cursor')).rows[0].n).toBe(1);
 });
 it('cleans obsolete prompt jobs in bounded batches without losing client-initiated reconciliation',async()=>{
  now=new Date('2026-10-13T12:05:00Z');const s=await account();
  await prefs(s,{enabled:true});
  for(let i=0;i<70;i++)await pool.query(`insert into companion_local.prompt_jobs(id,participant_id,source_key,source_version,preference_revision,due_at,expires_at,message,state)
   values($1,$2,$3,'old',1,$4,$5,'Old prompt','pending')`,[randomUUID(),s.user_id,`obsolete:${i}`,new Date('2026-10-12T12:00:00Z'),new Date('2026-10-12T12:10:00Z')]);
  expect(await service.claimPrompt(s)).toBeNull();
  const cancelled=async()=>Number((await pool.query("select count(*)::int as n from companion_local.prompt_jobs where participant_id=$1 and state='cancelled'",[s.user_id])).rows[0].n);
  expect(await cancelled()).toBe(LocalDayService.jobsPerReconciliation);
  expect(await service.claimPrompt(s)).toBeNull();expect(await cancelled()).toBe(70);
 });
});
