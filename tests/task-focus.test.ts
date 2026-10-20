import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { pglitePool } from './helpers/pglite-pool.js';
import { localCareMigrations } from '../src/server/local-migrations.js';
import { bootstrapLocalUser,LocalCare } from '../src/server/local-care.js';
import { LocalDayService } from '../src/server/local-day.js';
import type { LocalDayCommand } from '../src/shared/local-day-contracts.js';
describe('explicit task focus with consented durable check-ins',()=>{
 let db:PGlite,pool:Pool;
 beforeAll(async()=>{db=new PGlite();pool=pglitePool(db) as unknown as Pool;for(const file of localCareMigrations)await db.exec(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));});
 afterAll(async()=>db.close());
 async function fixture(){
  let now=new Date('2026-10-14T14:00:00Z');const email=`${randomUUID()}@example.invalid`,password='synthetic-focus-password',care=new LocalCare({pool,clock:()=>now});
  const person=await bootstrapLocalUser(pool,{email,password,role:'client'}),session=await care.login(email,password),service=new LocalDayService(pool,()=>now);
  await pool.query("update companion_local.sessions set expires_at='2030-01-01T00:00:00Z' where id=$1",[session.session_id]);
  const fresh=await care.today(session);await care.setup(session,{display_name:'Synthetic',time_zone:'America/Toronto',preferences:'',expected_revision:fresh.profile!.revision,tasks:[{title:'Sort photos',time_hint:null},{title:'Water plants',time_hint:null}],meal_options:[]});
  const key=()=>({idempotency_key:randomUUID(),confirmed:true as const});
  async function prefs(enabled=true){const {revision,...preferences}=(await service.workspace(session)).preferences;await service.command(session,{...key(),type:'set_prompt_preferences',expected_revision:revision,preferences:{...preferences,enabled,quiet_start:'23:00',quiet_end:'06:00'}});}
  async function start(interval=15,index=0){const option=(await service.workspace(session)).focus_options![index];const command:LocalDayCommand={...key(),type:'start_task_focus',activity_id:option.activity_id,expected_activity_revision:option.activity_revision,expected_activity_version:option.source_version,interval_minutes:interval};return {command,receipt:await service.command(session,command)};}
  return {person,care,session,service,key,prefs,start,clock:()=>now,setNow:(instant:string)=>{now=new Date(instant);}};
 }
 it('starts only with consent and never fabricates a task result',async()=>{
  const f=await fixture();await expect(f.start()).rejects.toMatchObject({status:409});await f.prefs();
  const started=await f.start(20);expect(await f.service.activeFocus(f.session)).toMatchObject({state:'active',interval_minutes:20,started_at:'2026-10-14T14:00:00.000Z',check_due_at:'2026-10-14T14:20:00.000Z'});
  expect((await f.service.command(f.session,started.command)).replayed).toBe(true);expect((await f.care.ledger(f.session)).entries).toHaveLength(0);
  await expect(f.start(30,1)).rejects.toMatchObject({status:409});
 });
 it('pauses, resumes at the chosen interval, asks rather than infers work, and stops without completion',async()=>{
  const f=await fixture();await f.prefs();const {receipt}=await f.start(15);f.setNow('2026-10-14T14:15:00Z');
  const prompt=await f.service.claimPrompt(f.session);expect(prompt?.message).toContain('Are you still working');expect(prompt?.message).not.toMatch(/hyperfix|working for|continuous/i);
  await f.service.command(f.session,{...f.key(),type:'pause_task_focus',focus_id:receipt.focus_id!,expected_revision:1});expect(await f.service.currentPrompt(f.session,prompt!.id)).toBe(false);expect(await f.service.claimPrompt(f.session)).toBeNull();
  f.setNow('2026-10-14T14:25:00Z');await f.service.command(f.session,{...f.key(),type:'resume_task_focus',focus_id:receipt.focus_id!,expected_revision:2,interval_minutes:10});
  expect(await f.service.activeFocus(f.session)).toMatchObject({state:'active',started_at:'2026-10-14T14:00:00.000Z',last_started_at:'2026-10-14T14:25:00.000Z',check_due_at:'2026-10-14T14:35:00.000Z'});
  f.setNow('2026-10-14T14:35:00Z');const again=await f.service.claimPrompt(f.session);expect(again).not.toBeNull();
  await f.service.command(f.session,{...f.key(),type:'finish_task_focus',focus_id:receipt.focus_id!,expected_revision:3});expect(await f.service.activeFocus(f.session)).toBeNull();expect(await f.service.currentPrompt(f.session,again!.id)).toBe(false);expect((await f.care.ledger(f.session)).entries).toHaveLength(0);
 });
 it('retains exact confirmed focus intent and one receipt through lost responses and restart',async()=>{
  const f=await fixture();await f.prefs();const choice=(await f.service.workspace(f.session)).focus_options![0];
  const command:LocalDayCommand={...f.key(),type:'start_task_focus',activity_id:choice.activity_id,expected_activity_revision:choice.activity_revision,expected_activity_version:choice.source_version,interval_minutes:25};
  await f.service.holdHandoff(f.session,command);const saved=await f.service.commitHeldHandoff(f.session,command),restart=new LocalDayService(pool,f.clock);
  expect(await restart.pendingHandoff(f.session)).toMatchObject({command,scope_matches:true});expect((await restart.commitHeldHandoff(f.session,command)).replayed).toBe(true);expect(await restart.discardPendingHandoff(f.session,command.idempotency_key)).toBe(false);
  expect(await restart.acknowledgeHandoff(f.session,command.idempotency_key)).toBe(true);expect(await restart.pendingHandoff(f.session)).toBeNull();expect((await restart.activeFocus(f.session))?.id).toBe(saved.focus_id);
 });
 it('makes cancellation idempotent and refuses a late focus commit',async()=>{
  const f=await fixture();await f.prefs();const choice=(await f.service.workspace(f.session)).focus_options![0];const command:LocalDayCommand={...f.key(),type:'start_task_focus',activity_id:choice.activity_id,expected_activity_revision:0,expected_activity_version:choice.source_version,interval_minutes:10};
  expect(await f.service.discardPendingHandoff(f.session,command.idempotency_key)).toBe(true);await f.service.holdHandoff(f.session,command);expect(await f.service.discardPendingHandoff(f.session,command.idempotency_key)).toBe(true);expect(await f.service.discardPendingHandoff(f.session,command.idempotency_key)).toBe(true);await expect(f.service.commitHeldHandoff(f.session,command)).rejects.toMatchObject({status:409});
 });
 it('rejects an old review after a pending task changes without an activity revision',async()=>{
  const f=await fixture();await f.prefs();const option=(await f.service.workspace(f.session)).focus_options![0];
  await pool.query("update companion_local.task_definitions set title='Changed task' where id=$1",[option.task_id]);
  await expect(f.service.command(f.session,{...f.key(),type:'start_task_focus',activity_id:option.activity_id,expected_activity_revision:0,expected_activity_version:option.source_version,interval_minutes:15})).rejects.toMatchObject({status:409});
 });
 it('cancels a claimed focus check after actual completion and permits a different task',async()=>{
  const f=await fixture();await f.prefs();await f.start();const focus=(await f.service.activeFocus(f.session))!;f.setNow('2026-10-14T14:15:00Z');const prompt=(await f.service.claimPrompt(f.session))!;
  await f.care.activityCommand(f.session,{type:'record_activity',idempotency_key:randomUUID(),local_date:'2026-10-14',expected_revision:0,payload:{activity_id:focus.activity_id,status:'completed',occurred_at:f.clock().toISOString(),notes:''}});
  expect(await f.service.activeFocus(f.session)).toBeNull();expect(await f.service.currentPrompt(f.session,prompt.id)).toBe(false);await expect(f.service.acknowledgePrompt(f.session,prompt.id,prompt.claim_token!,'in_app')).rejects.toMatchObject({status:409});
  const next=await f.start(30);expect(next.receipt.focus_id).not.toBe(focus.id);expect((await f.care.ledger(f.session)).summary.tasks_completed).toBe(1);
 });
 it('persists snooze and decline and invalidates snoozed checks when the source is corrected',async()=>{
  const f=await fixture();await f.prefs();await f.start();f.setNow('2026-10-14T14:15:00Z');const prompt=(await f.service.claimPrompt(f.session))!;
  await f.service.command(f.session,{...f.key(),type:'respond_prompt',prompt_id:prompt.id,expected_revision:0,decision:'snooze',snooze_minutes:30});
  const restart=new LocalDayService(pool,f.clock);f.setNow('2026-10-14T14:45:00Z');const again=(await restart.claimPrompt(f.session))!;expect(again.id).toBe(prompt.id);
  await restart.command(f.session,{...f.key(),type:'respond_prompt',prompt_id:prompt.id,expected_revision:1,decision:'decline',snooze_minutes:null});await restart.tick();expect(await restart.claimPrompt(f.session)).toBeNull();
  const focus=(await restart.activeFocus(f.session))!;await restart.command(f.session,{...f.key(),type:'pause_task_focus',focus_id:focus.id,expected_revision:1});await restart.command(f.session,{...f.key(),type:'resume_task_focus',focus_id:focus.id,expected_revision:2,interval_minutes:5});
  f.setNow('2026-10-14T14:50:00Z');const renewed=await restart.claimPrompt(f.session);expect(renewed).not.toBeNull(); // Explicitly resumed with another agreed interval.
  await pool.query("update companion_local.task_definitions set title='Corrected task' where id=$1",[focus.task_id]);expect(await restart.currentPrompt(f.session,renewed!.id)).toBe(false);
 });
 it('honours quiet hours and does not replay missed focus prompts after restart',async()=>{
  const f=await fixture();await f.prefs();f.setNow('2026-10-15T02:55:00Z');await f.start(15);f.setNow('2026-10-15T03:10:00Z');expect(await f.service.claimPrompt(f.session)).toBeNull();
  expect((await f.service.workspace(f.session)).prompts.some(prompt=>prompt.state==='cancelled')).toBe(true);
  await f.service.command(f.session,{...f.key(),type:'finish_task_focus',focus_id:(await f.service.activeFocus(f.session))!.id,expected_revision:1});
  f.setNow('2026-10-15T14:00:00Z');await f.start(5);f.setNow('2026-10-15T15:00:00Z');const restart=new LocalDayService(pool,f.clock);await restart.tick();expect(await restart.claimPrompt(f.session)).toBeNull();expect((await restart.workspace(f.session)).prompts.some(prompt=>prompt.state==='missed')).toBe(true);
 });
 it('allows one new spoken dispatch only after an explicit snooze, not after claim recovery',async()=>{
  const f=await fixture();await f.prefs();const view=await f.service.workspace(f.session),{revision,...preferences}=view.preferences;
  await f.service.command(f.session,{...f.key(),type:'set_prompt_preferences',expected_revision:revision,preferences:{...preferences,foreground_speech:true}});await f.start();f.setNow('2026-10-14T14:15:00Z');const first=(await f.service.claimPrompt(f.session))!;
  await f.service.beginPromptSpeech(f.session,first.id,first.claim_token!);await expect(f.service.beginPromptSpeech(f.session,first.id,first.claim_token!)).rejects.toMatchObject({status:409});
  await f.service.acknowledgePrompt(f.session,first.id,first.claim_token!,'speech');await f.service.command(f.session,{...f.key(),type:'respond_prompt',prompt_id:first.id,expected_revision:0,decision:'snooze',snooze_minutes:10});
  f.setNow('2026-10-14T14:25:00Z');const second=(await f.service.claimPrompt(f.session))!;expect(second.id).toBe(first.id);await expect(f.service.beginPromptSpeech(f.session,second.id,second.claim_token!)).resolves.toContain('Are you still working');
  await expect(f.service.beginPromptSpeech(f.session,second.id,second.claim_token!)).rejects.toMatchObject({status:409});
 });
 it('preserves an explicit snooze through an unrelated enabled preference edit but not revoked consent',async()=>{
  const f=await fixture();await f.prefs();await f.start();f.setNow('2026-10-14T14:15:00Z');const first=(await f.service.claimPrompt(f.session))!;
  await f.service.command(f.session,{...f.key(),type:'respond_prompt',prompt_id:first.id,expected_revision:0,decision:'snooze',snooze_minutes:15});await f.prefs();
  const restart=new LocalDayService(pool,f.clock);f.setNow('2026-10-14T14:30:00Z');const after=(await restart.claimPrompt(f.session))!;expect(after.id).toBe(first.id);expect(after.response_revision).toBe(1);
  await f.service.command(f.session,{...f.key(),type:'respond_prompt',prompt_id:first.id,expected_revision:1,decision:'snooze',snooze_minutes:15});await f.prefs(false);
  f.setNow('2026-10-14T14:45:00Z');expect(await restart.claimPrompt(f.session)).toBeNull();expect(await restart.currentPrompt(f.session,first.id)).toBe(false);
 });
 it('recovers delivered snoozed text after reload without dispatch, and hides declined or stale sources',async()=>{
  const f=await fixture();await f.prefs();await f.start();f.setNow('2026-10-14T14:15:00Z');const first=(await f.service.claimPrompt(f.session))!;await f.service.acknowledgePrompt(f.session,first.id,first.claim_token!,'in_app');
  await f.service.command(f.session,{...f.key(),type:'respond_prompt',prompt_id:first.id,expected_revision:0,decision:'snooze',snooze_minutes:15});expect(await f.service.resumePrompt(f.session)).toBeNull();
  f.setNow('2026-10-14T14:30:00Z');const second=(await f.service.claimPrompt(f.session))!;await f.service.acknowledgePrompt(f.session,second.id,second.claim_token!,'in_app');
  const count=async()=>(await pool.query('select count(*)::int as n from companion_local.prompt_delivery_events where prompt_id=$1',[first.id])).rows[0].n,before=await count(),restart=new LocalDayService(pool,f.clock);
  expect(await restart.resumePrompt(f.session)).toMatchObject({id:first.id,response_revision:1,state:'delivered',restored:true,foreground_speech:false,browser_notifications:false});expect(await count()).toBe(before);
  await restart.command(f.session,{...f.key(),type:'respond_prompt',prompt_id:first.id,expected_revision:1,decision:'decline',snooze_minutes:null});expect(await restart.resumePrompt(f.session)).toBeNull();
  const focus=(await restart.activeFocus(f.session))!;await restart.command(f.session,{...f.key(),type:'pause_task_focus',focus_id:focus.id,expected_revision:1});await restart.command(f.session,{...f.key(),type:'resume_task_focus',focus_id:focus.id,expected_revision:2,interval_minutes:5});f.setNow('2026-10-14T14:35:00Z');const latest=(await restart.claimPrompt(f.session))!;await restart.acknowledgePrompt(f.session,latest.id,latest.claim_token!,'in_app');
  await f.prefs(false);expect(await restart.resumePrompt(f.session)).toBeNull();
 });
 it('refuses another participant and revocation before a held focus commit',async()=>{
  const f=await fixture(),other=await fixture();await f.prefs();const option=(await f.service.workspace(f.session)).focus_options![0];const command:LocalDayCommand={...f.key(),type:'start_task_focus',activity_id:option.activity_id,expected_activity_revision:0,expected_activity_version:option.source_version,interval_minutes:15};
  await expect(other.service.command(other.session,command)).rejects.toMatchObject({status:409});await f.service.holdHandoff(f.session,command);await pool.query('update companion_local.accounts set disabled_at=now() where id=$1',[f.person.user_id]);await expect(f.service.commitHeldHandoff(f.session,command)).rejects.toMatchObject({status:401});
 });
});
