import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {LocalCare,bootstrapLocalUser} from '../src/server/local-care.js';
import {LocalDayService} from '../src/server/local-day.js';
import {ProgramService} from '../src/server/programs.js';
import {localCareMigrations} from '../src/server/local-migrations.js';
import {pglitePool} from './helpers/pglite-pool.js';

describe('effective appointment and meal scheduling',()=>{
 let db:PGlite,pool:Pool;
 beforeAll(async()=>{db=new PGlite();pool=pglitePool(db) as unknown as Pool;for(const f of localCareMigrations)await db.exec(await readFile(new URL('../db/'+f,import.meta.url),'utf8'));});
 afterAll(async()=>{await db.close();});
 async function fixture(){let now=new Date('2026-10-13T13:30:00Z');const email=randomUUID()+'@example.invalid',password='synthetic-schedule-password';
  const person=await bootstrapLocalUser(pool,{email,password,role:'client'}),care=new LocalCare({pool,clock:()=>now}),session=await care.login(email,password),day=new LocalDayService(pool,()=>now),programs=new ProgramService(pool,{clock:()=>now});
  await day.command(session,{type:'set_prompt_preferences',idempotency_key:randomUUID(),expected_revision:0,confirmed:true,preferences:{enabled:true,meal_times:{breakfast:'09:30',lunch:null,dinner:null},appointment_lead_minutes:30,quiet_start:'21:00',quiet_end:'08:00',foreground_speech:false,browser_notifications:false}});
  return {person,care,session,day,programs,setNow:(value:string)=>{now=new Date(value);}};}
 async function mealFixture(){
  const f=await fixture();
  await f.care.setup(f.session,{expected_revision:0,display_name:'Synthetic',time_zone:'America/Toronto',preferences:'',tasks:[],meal_options:[{name:'Toast',slots:['breakfast']},{name:'Porridge',slots:['breakfast']},{name:'Soup',slots:['lunch']},{name:'Rice',slots:['dinner']}]});
  await f.care.command(f.session,{type:'start_or_resume_checkin',idempotency_key:randomUUID(),local_date:'2026-10-13',expected_revision:0,payload:{}});
  const accept=async(breakfast='Toast')=>{
   const today=await f.care.today(f.session);
   const meals=today.meal_options.filter(m=>m.name!== (breakfast==='Toast'?'Porridge':'Toast')).map(m=>({slot:m.slots[0],option_id:m.id}));
   const proposed=await f.care.command(f.session,{type:'propose_day_plan',idempotency_key:randomUUID(),local_date:today.local_date,expected_revision:today.checkin!.revision,payload:{task_ids:[],meals}});
   return f.care.command(f.session,{type:'accept_day_plan',idempotency_key:randomUUID(),local_date:today.local_date,expected_revision:proposed.revision,payload:{proposal_id:proposed.plan!.id}});
  };
  await accept();
  const breakfast=async()=> (await f.care.ledger(f.session)).options.find(o=>o.kind==='meal'&&o.meal_slot==='breakfast'&&o.title==='Toast')!;
  return {...f,accept,breakfast};
 }
 it('retains an imminent appointment ahead of a full historical context cap',async()=>{
  const f=await fixture();await pool.query(`insert into companion_local.appointments(participant_id,title,starts_at,created_by)
    select $1,'Historical fixture', '2026-10-03T14:00:00Z'::timestamptz+n*interval '1 minute',$2 from generate_series(1,200)n`,[f.person.participant_id,f.person.user_id]);
  const a=await f.care.setAppointment(f.session,{title:'Imminent fixture',starts_at:'2026-10-13T14:30:00Z',idempotency_key:randomUUID()});
  const today=await f.care.today(f.session);expect(today.appointments!.some(i=>i.id===a.appointment.id)).toBe(true);expect(today.appointment_context).toEqual({total_count:201,omitted_count:1});
 });
 it('invalidates stale claims and uses rescheduled appointment time for reminders and program conflicts',async()=>{
  const f=await fixture();const a=await f.care.setAppointment(f.session,{title:'Appointment fixture',starts_at:'2026-10-13T14:00:00Z',idempotency_key:randomUUID()});
  const version=await f.programs.command(f.session,{type:'create_program',idempotency_key:randomUUID(),confirmed:true,draft:{title:'Protected software fixture',kind:'routine',protected_start:'09:45',protected_end:'10:15',rest_minutes:0,steps:[{id:'one',title:'Read fixture',instruction:'Read this synthetic sentence.',optional:false,estimated_minutes:1,depends_on:[]}]}});
  await f.programs.command(f.session,{type:'approve_program',idempotency_key:randomUUID(),confirmed:true,version_id:version.version_id!,approval_ref:'Synthetic software approval'});
  expect((await f.programs.workspace(f.session)).conflicts_by_version[version.version_id!]).toHaveLength(1);
  await f.day.tick();const stale=await f.day.claimPrompt(f.session);expect(stale).not.toBeNull();
  const option=(await f.care.ledger(f.session)).options.find(o=>o.source_id===a.appointment.id)!;
  await f.care.activityCommand(f.session,{type:'reschedule_activity',idempotency_key:randomUUID(),local_date:'2026-10-13',expected_revision:0,payload:{activity_id:option.id,scheduled_at:'2026-10-13T15:00:00Z',reason:'Reviewed synthetic move'}});
  await expect(f.day.promptText(f.session,stale!.id,stale!.claim_token!)).rejects.toBeDefined();expect(await f.day.claimPrompt(f.session)).toBeNull();
  expect((await f.programs.workspace(f.session)).conflicts_by_version[version.version_id!]).toEqual([]);
  f.setNow('2026-10-13T14:30:00Z');await f.day.tick();const moved=await f.day.claimPrompt(f.session);expect(moved?.message).toMatch(/11:00/);
  const entry=(await f.care.ledger(f.session)).entries.find(o=>o.source_id===a.appointment.id)!;
  await f.care.activityCommand(f.session,{type:'record_activity',idempotency_key:randomUUID(),local_date:'2026-10-13',expected_revision:entry.revision,payload:{activity_id:entry.id,status:'deferred',occurred_at:null,notes:'Client deferred fixture'}});
  await expect(f.day.promptText(f.session,moved!.id,moved!.claim_token!)).rejects.toBeDefined();
 });
 it('reschedules meal reminders and cancels them after an actual completion',async()=>{
  const f=await fixture();const today=await f.care.setup(f.session,{expected_revision:0,display_name:'Synthetic',time_zone:'America/Toronto',preferences:'',tasks:[],meal_options:[{name:'Toast',slots:['breakfast']},{name:'Soup',slots:['lunch']},{name:'Rice',slots:['dinner']}]});
  const start=await f.care.command(f.session,{type:'start_or_resume_checkin',idempotency_key:randomUUID(),local_date:today.local_date,expected_revision:0,payload:{}});
  const proposed=await f.care.command(f.session,{type:'propose_day_plan',idempotency_key:randomUUID(),local_date:today.local_date,expected_revision:start.revision,payload:{task_ids:[],meals:today.meal_options.map(m=>({slot:m.slots[0],option_id:m.id}))}});
  await f.care.command(f.session,{type:'accept_day_plan',idempotency_key:randomUUID(),local_date:today.local_date,expected_revision:proposed.revision,payload:{proposal_id:proposed.plan!.id}});
  const meal=(await f.care.ledger(f.session)).options.find(o=>o.kind==='meal'&&o.meal_slot==='breakfast')!;
  await f.care.activityCommand(f.session,{type:'reschedule_activity',idempotency_key:randomUUID(),local_date:today.local_date,expected_revision:meal.revision,payload:{activity_id:meal.id,scheduled_at:'2026-10-13T14:30:00Z',reason:'Reviewed meal timing'}});
  await f.day.tick();expect(await f.day.claimPrompt(f.session)).toBeNull();f.setNow('2026-10-13T14:30:00Z');await f.day.tick();expect((await f.day.claimPrompt(f.session))?.message).toContain('Toast');
  await f.care.activityCommand(f.session,{type:'record_activity',idempotency_key:randomUUID(),local_date:today.local_date,expected_revision:1,payload:{activity_id:meal.id,status:'completed',occurred_at:'2026-10-13T14:30:00Z',notes:'',portion:null}});
  await f.day.tick();expect(await f.day.claimPrompt(f.session)).toBeNull();
 });
 it('preserves the effective meal time when the same meal is reaccepted in a new plan',async()=>{
  const f=await mealFixture();await f.day.tick();const original=await f.day.claimPrompt(f.session);expect(original?.message).toContain('Toast');
  const meal=await f.breakfast();
  await f.care.activityCommand(f.session,{type:'reschedule_activity',idempotency_key:randomUUID(),local_date:'2026-10-13',expected_revision:meal.revision,payload:{activity_id:meal.id,scheduled_at:'2026-10-13T14:30:00Z',reason:'Reviewed later breakfast'}});
  const before=(await f.care.today(f.session)).checkin!.accepted!.id;
  await f.accept();expect((await f.care.today(f.session)).checkin!.accepted!.id).not.toBe(before);
  expect(await f.breakfast()).toMatchObject({id:meal.id,scheduled_at:'2026-10-13T14:30:00.000Z'});
  await f.day.tick();await expect(f.day.promptText(f.session,original!.id,original!.claim_token!)).rejects.toBeDefined();
  expect(await f.day.claimPrompt(f.session)).toBeNull();
  f.setNow('2026-10-13T14:30:00Z');await f.day.tick();const moved=await f.day.claimPrompt(f.session);
  expect(moved).toMatchObject({due_at:'2026-10-13T14:30:00.000Z'});expect(moved?.message).toContain('Toast');
 });
 it('preserves a deferred meal across reacceptance without deferring a replacement choice',async()=>{
  const f=await mealFixture(),meal=await f.breakfast();
  await f.care.activityCommand(f.session,{type:'record_activity',idempotency_key:randomUUID(),local_date:'2026-10-13',expected_revision:meal.revision,payload:{activity_id:meal.id,status:'deferred',occurred_at:null,notes:'Not now'}});
  await f.accept();await f.day.tick();expect(await f.day.claimPrompt(f.session)).toBeNull();
  expect(await f.breakfast()).toMatchObject({id:meal.id,status:'deferred'});
  await f.accept('Porridge');await f.day.tick();const replacement=await f.day.claimPrompt(f.session);
  expect(replacement?.message).toContain('Porridge');expect(replacement).toMatchObject({due_at:'2026-10-13T13:30:00.000Z'});
  expect(await f.breakfast()).toMatchObject({id:meal.id,status:'deferred'});
 });
 it('keeps completion suppression and corrected timing through later accepted plan versions',async()=>{
  const f=await mealFixture(),meal=await f.breakfast();
  await f.care.activityCommand(f.session,{type:'reschedule_activity',idempotency_key:randomUUID(),local_date:'2026-10-13',expected_revision:meal.revision,payload:{activity_id:meal.id,scheduled_at:'2026-10-13T14:30:00Z',reason:'Reviewed later breakfast'}});
  await f.care.activityCommand(f.session,{type:'record_activity',idempotency_key:randomUUID(),local_date:'2026-10-13',expected_revision:1,payload:{activity_id:meal.id,status:'completed',occurred_at:'2026-10-13T13:30:00Z',notes:'Reported breakfast'}});
  await f.accept();await f.day.tick();expect(await f.day.claimPrompt(f.session)).toBeNull();
  await f.care.activityCommand(f.session,{type:'correct_activity',idempotency_key:randomUUID(),local_date:'2026-10-13',expected_revision:2,payload:{activity_id:meal.id,status:'voided',occurred_at:null,notes:'',reason:'Breakfast report was mistaken'}});
  await f.accept();await f.day.tick();expect(await f.day.claimPrompt(f.session)).toBeNull();
  f.setNow('2026-10-13T14:30:00Z');await f.day.tick();expect(await f.day.claimPrompt(f.session)).toMatchObject({due_at:'2026-10-13T14:30:00.000Z'});
 });
});
