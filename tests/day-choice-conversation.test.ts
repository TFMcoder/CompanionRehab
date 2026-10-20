import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {LocalCare,bootstrapLocalUser} from '../src/server/local-care.js';
import {LocalDayService} from '../src/server/local-day.js';
import type {LocalFeatures} from '../src/server/local-features.js';
import {localCareMigrations} from '../src/server/local-migrations.js';
import {pglitePool} from './helpers/pglite-pool.js';
import {ConversationService} from '../src/server/conversation.js';
import {bindTestInference} from './helpers/inference.js';

describe('bounded day choice voice recovery',()=>{
 let db:PGlite,pool:Pool;
 beforeAll(async()=>{db=new PGlite();pool=pglitePool(db) as unknown as Pool;for(const file of localCareMigrations)await db.exec(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));});
 afterAll(async()=>{await db.close();});
 async function fixture(){let now=new Date('2026-10-14T16:00:00Z');const clock=()=>now,email=randomUUID()+'@example.invalid',password='synthetic-choice-password';
  const person=await bootstrapLocalUser(pool,{email,password,role:'client'}),care=new LocalCare({pool,clock}),session=await care.login(email,password),day=new LocalDayService(pool,clock);
  const features={day,authorityRevision:async()=> 'synthetic-sharing'} as unknown as LocalFeatures;
  const respond=vi.fn(),create=()=>new ConversationService(care,{bind:bindTestInference,respond},person.user_id,clock,undefined,undefined,undefined,undefined,features);
  return {person,care,session,day,features,respond,create,setNow:(value:string)=>{now=new Date(value);}};
 }
 const tool=(command:unknown)=>({completed:true,model:'gpt-6-sol',effort:'high',text:'',output:[{type:'function_call',name:'prepare_local_action',call_id:randomUUID(),arguments:JSON.stringify({family:'day',command})}]});
 it('saves a reviewed reminder snooze once and recovers its receipt after a lost success response',async()=>{
  const f=await fixture();await f.day.command(f.session,{type:'set_prompt_preferences',idempotency_key:randomUUID(),confirmed:true,expected_revision:0,preferences:{enabled:true,food_check_ins:true,meal_times:{breakfast:null,lunch:null,dinner:null},appointment_lead_minutes:30,quiet_start:'21:00',quiet_end:'06:00',foreground_speech:true,browser_notifications:false}});
  await f.day.tick();const prompt=await f.day.claimPrompt(f.session);expect(prompt).not.toBeNull();
  f.respond.mockResolvedValueOnce(tool({type:'respond_prompt',prompt_id:prompt!.id,expected_revision:0,decision:'snooze',snooze_minutes:15}));let service=f.create();
  try{
   const start=await service.start(f.session),review=await service.turn(start.session_id,f.session,randomUUID(),'Remind me in fifteen minutes.');expect(review.text).toContain('Snooze for 15 minutes');
   expect((await f.day.workspace(f.session)).prompts[0].response_revision).toBe(0);
   service.played(start.session_id,f.session,review.reply_id);const saved=await service.turn(start.session_id,f.session,randomUUID(),'save this choice');expect(saved.text).toContain('snoozed');expect(saved.acknowledgement_required).toBe(true);
   service.close();service=f.create();const next=await service.start(f.session),recovered=await service.turn(next.session_id,f.session,randomUUID(),'Did that save?');
   expect(recovered.text).toContain('snoozed');expect(f.respond).toHaveBeenCalledTimes(1);await service.received(next.session_id,f.session,recovered.reply_id);
   expect((await f.day.workspace(f.session)).prompts[0]).toMatchObject({response:'snoozed',response_revision:1,snoozed_until:'2026-10-14T16:15:00.000Z'});
   const ledger=await f.care.ledger(f.session);expect(ledger.entries).toEqual([]);
  }finally{service.close();}
 });
 it('reviews focus start, pause, resume and finish with durable recovery and fresh stated activity context',async()=>{
  const f=await fixture();let today=await f.care.today(f.session);
  today=await f.care.setup(f.session,{display_name:'Synthetic',time_zone:'America/Toronto',expected_revision:today.profile!.revision,preferences:'',tasks:[{title:'Synthetic sorting',time_hint:null}],meal_options:[{name:'Synthetic meal',slots:['breakfast','lunch','dinner']}]});
  await f.care.command(f.session,{type:'start_or_resume_checkin',idempotency_key:randomUUID(),local_date:today.local_date,expected_revision:0,payload:{}});today=await f.care.today(f.session);
  const proposal=await f.care.command(f.session,{type:'propose_day_plan',idempotency_key:randomUUID(),local_date:today.local_date,expected_revision:today.checkin!.revision,payload:{task_ids:today.tasks.map(t=>t.id),meals:['breakfast','lunch','dinner'].map(slot=>({slot,option_id:today.meal_options[0].id}))}});
  await f.care.command(f.session,{type:'accept_day_plan',idempotency_key:randomUUID(),local_date:today.local_date,expected_revision:proposal.revision,payload:{proposal_id:proposal.plan!.id}});
  await f.day.command(f.session,{type:'set_prompt_preferences',idempotency_key:randomUUID(),confirmed:true,expected_revision:0,preferences:{enabled:true,food_check_ins:false,meal_times:{breakfast:null,lunch:null,dinner:null},appointment_lead_minutes:30,quiet_start:'21:00',quiet_end:'06:00',foreground_speech:true,browser_notifications:false}});
  const option=(await f.day.workspace(f.session)).focus_options![0];expect(option).toBeDefined();
  f.respond.mockResolvedValueOnce(tool({type:'start_task_focus',activity_id:option.activity_id,expected_activity_revision:option.activity_revision,expected_activity_version:option.source_version,interval_minutes:25}));let service=f.create();
  try{
   const start=await service.start(f.session),review=await service.turn(start.session_id,f.session,randomUUID(),'Start sorting, and ask me in twenty-five minutes.');expect(review.text).toContain('stated start');expect(await f.day.activeFocus(f.session)).toBeNull();
   service.played(start.session_id,f.session,review.reply_id);const saved=await service.turn(start.session_id,f.session,randomUUID(),'save this choice');expect(saved.acknowledgement_required).toBe(true);
   expect(await f.day.activeFocus(f.session)).toMatchObject({state:'active',interval_minutes:25,revision:1});
   service.close();service=f.create();const next=await service.start(f.session),recovered=await service.turn(next.session_id,f.session,randomUUID(),'Did my task start save?');expect(recovered.changed).toBe(true);expect(f.respond).toHaveBeenCalledTimes(1);await service.received(next.session_id,f.session,recovered.reply_id);
   for(const type of ['pause_task_focus','resume_task_focus','finish_task_focus'] as const){
    const focus=(await f.day.activeFocus(f.session))!;const command={type,focus_id:focus.id,expected_revision:focus.revision,...(type==='resume_task_focus'?{interval_minutes:20}:{})};
    f.respond.mockResolvedValueOnce(tool(command));const proposed=await service.turn(next.session_id,f.session,randomUUID(),type.replaceAll('_',' '));
    const input=f.respond.mock.calls.at(-1)![0],facts=input.find((x:any)=>x.role==='user'&&String(x.content).startsWith('Current authorized facts'));
    expect(facts.content).toContain('active_task_focus');expect(facts.content).toContain(`"state":"${focus.state}"`);
    if(type==='finish_task_focus')expect(proposed.text).toContain('does not record the task as completed');
    service.played(next.session_id,f.session,proposed.reply_id);const result=await service.turn(next.session_id,f.session,randomUUID(),'save this choice');await service.received(next.session_id,f.session,result.reply_id);
   }
   expect(await f.day.activeFocus(f.session)).toBeNull();expect((await f.care.ledger(f.session)).entries).toEqual([]);
   f.respond.mockResolvedValueOnce({completed:true,model:'gpt-6-sol',effort:'high',text:'What would help next?',output:[]});await service.turn(next.session_id,f.session,randomUUID(),'What is happening now?');
   const facts=f.respond.mock.calls.at(-1)![0].find((x:any)=>x.role==='user'&&String(x.content).startsWith('Current authorized facts'));expect(facts.content).toContain('"active_task_focus":null');
  }finally{service.close();}
 });
});
