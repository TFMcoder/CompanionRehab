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
import {prepareLocalAction} from '../src/server/local-conversation.js';
import {unavailable} from '../src/server/errors.js';
import type {LocalDayCommand} from '../src/shared/local-day-contracts.js';

describe('reviewed significant handoffs in Nancy voice',()=>{
 let db:PGlite,pool:Pool;
 beforeAll(async()=>{db=new PGlite();pool=pglitePool(db) as unknown as Pool;for(const file of localCareMigrations)await db.exec(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));});
 afterAll(async()=>{await db.close();});
 async function fixture(){let now=new Date('2026-10-13T14:00:00Z');const clock=()=>now,email=randomUUID()+'@example.invalid',password='synthetic-handoff-password';
  const person=await bootstrapLocalUser(pool,{email,password,role:'client'}),care=new LocalCare({pool,clock}),session=await care.login(email,password),day=new LocalDayService(pool,clock);
  const features={day,authorityRevision:async()=> 'synthetic-sharing'} as unknown as LocalFeatures;
  const respond=vi.fn(),create=()=>new ConversationService(care,{bind:bindTestInference,respond},person.user_id,clock,undefined,undefined,undefined,undefined,features);
  return {person,care,session,day,features,respond,create,setNow:(value:string)=>{now=new Date(value);}};
 }
 const input={type:'record_significant_handoff',summary:'My shoulder is sore after the gardening incident; please remember this tomorrow.',occurred_at:'2026-10-13T13:45:00Z'};
 const tool=(command:unknown)=>({completed:true,model:'gpt-6-sol',effort:'high',text:'',output:[{type:'function_call',name:'prepare_local_action',call_id:randomUUID(),arguments:JSON.stringify({family:'day',command})}]});
 it('prepares a new typed note in one model round with the same review, durable receipt and acknowledgement',async()=>{
  const f=await fixture(),{type,...fields}=input;
  f.respond.mockResolvedValueOnce({completed:true,model:'gpt-6-sol',effort:'high',text:'',output:[{type:'function_call',name:'prepare_significant_handoff',call_id:randomUUID(),arguments:JSON.stringify(fields)}]});
  const service=f.create();
  try{
   const start=await service.start(f.session),review=await service.turn(start.session_id,f.session,randomUUID(),'Remember this important event.');
   expect(review.text).toContain(input.summary);expect(f.respond).toHaveBeenCalledTimes(1);
   expect(await f.day.activeHandoffs(f.session)).toEqual([]);expect(await f.day.pendingHandoff(f.session)).toBeNull();
   const tools=f.respond.mock.calls[0][2].map((tool:any)=>tool.name);
   expect(tools).toContain('prepare_significant_handoff');expect(tools).toContain('get_local_action_schema');expect(tools).toContain('prepare_activity_record');
   service.played(start.session_id,f.session,review.reply_id);
   const saved=await service.turn(start.session_id,f.session,randomUUID(),'save this choice');
   expect(saved.acknowledgement_required).toBe(true);expect(await f.day.activeHandoffs(f.session)).toHaveLength(1);
   await service.received(start.session_id,f.session,saved.reply_id);expect(await f.day.pendingHandoff(f.session)).toBeNull();
   expect(f.respond).toHaveBeenCalledTimes(1);
  }finally{service.close();}
 });
 it('does not let direct-note arguments manufacture confirmation or an idempotency key',async()=>{
  const f=await fixture(),service=f.create(),{type,...fields}=input;
  f.respond.mockResolvedValueOnce({completed:true,model:'gpt-6-sol',effort:'high',text:'',output:[{type:'function_call',name:'prepare_significant_handoff',call_id:randomUUID(),arguments:JSON.stringify({...fields,confirmed:true,idempotency_key:randomUUID()})}]})
   .mockResolvedValueOnce({completed:true,model:'gpt-6-sol',effort:'high',text:'Please describe the note.',output:[]});
  try{
   const start=await service.start(f.session);await service.turn(start.session_id,f.session,randomUUID(),'Remember this important event.');
   expect(await f.day.activeHandoffs(f.session)).toEqual([]);expect(await f.day.pendingHandoff(f.session)).toBeNull();
   const output=f.respond.mock.calls[1][0].find((item:any)=>item.type==='function_call_output');expect(JSON.parse(output.output)).toMatchObject({outcome:'rejected'});
  }finally{service.close();}
 });
 it('persists only after spoken review, recovers lost success across restart and acknowledges without duplicates',async()=>{
  const f=await fixture();f.respond.mockResolvedValueOnce(tool(input));let service=f.create();
  try{
   const start=await service.start(f.session),review=await service.turn(start.session_id,f.session,randomUUID(),'Please remember this event for tomorrow.');
   expect(review.text).toContain(input.summary);expect(await f.day.activeHandoffs(f.session)).toEqual([]);expect(await f.day.pendingHandoff(f.session)).toBeNull();
   service.played(start.session_id,f.session,review.reply_id);const turn=randomUUID(),saved=await service.turn(start.session_id,f.session,turn,'save this choice');
   expect(saved.acknowledgement_required).toBe(true);expect(await service.turn(start.session_id,f.session,turn,'save this choice')).toEqual(saved);
   const pending=await f.day.pendingHandoff(f.session);expect(pending).not.toBeNull();service.close();service=f.create();
   const next=await service.start(f.session),recovered=await service.turn(next.session_id,f.session,randomUUID(),'Remember the gardening incident.');
   expect(recovered.text).toContain('saved');expect(f.respond).toHaveBeenCalledTimes(1);expect(await f.day.activeHandoffs(f.session)).toHaveLength(1);
   const ack=vi.spyOn(f.day,'acknowledgeHandoff').mockRejectedValueOnce(unavailable());
   await expect(service.received(next.session_id,f.session,recovered.reply_id)).rejects.toMatchObject({status:503});expect(await f.day.pendingHandoff(f.session)).not.toBeNull();
   ack.mockRestore();await service.received(next.session_id,f.session,recovered.reply_id);await service.received(next.session_id,f.session,recovered.reply_id);expect(await f.day.pendingHandoff(f.session)).toBeNull();
  }finally{service.close();}
 });
 it('requires exact retry for an unknown result and cancels obsolete grant intent while allowing navigation',async()=>{
  const f=await fixture(),command={...input,idempotency_key:randomUUID(),confirmed:true} as LocalDayCommand;await f.day.holdHandoff(f.session,command);let service=f.create();
  try{
   const start=await service.start(f.session),unknown=await service.turn(start.session_id,f.session,randomUUID(),'Did that save?');expect(unknown.text).toContain('unconfirmed');expect(await f.day.activeHandoffs(f.session)).toEqual([]);
   const saved=await service.turn(start.session_id,f.session,randomUUID(),'retry this context note save');await service.received(start.session_id,f.session,saved.reply_id);expect(await f.day.activeHandoffs(f.session)).toHaveLength(1);
   const unsaved={...command,idempotency_key:randomUUID(),summary:'Another explicit note.'};await f.day.holdHandoff(f.session,unsaved);
   await pool.query("update companion_local.role_grants set granted_at=granted_at+interval '1 second' where actor_id=$1",[f.person.user_id]);
   service.close();service=f.create();const next=await service.start(f.session),nav=await service.turn(next.session_id,f.session,randomUUID(),'Show my meals');
   expect(nav.navigate).toBe('meals');expect(await f.day.pendingHandoff(f.session)).toBeNull();expect(await f.day.activeHandoffs(f.session)).toHaveLength(1);expect(f.respond).not.toHaveBeenCalled();
  }finally{service.close();}
 });
 it('reads fresh active notes across midnight, corrects exact versions and excludes resolved notes',async()=>{
  const f=await fixture();await f.day.command(f.session,{...input,idempotency_key:randomUUID(),confirmed:true} as LocalDayCommand);
  const note=(await f.day.activeHandoffs(f.session))[0];f.setNow('2026-10-14T03:59:00Z');f.session=await f.care.authorize(f.session);f.setNow('2026-10-14T04:01:00Z');
  const service=f.create();f.respond.mockResolvedValue({completed:true,model:'gpt-6-sol',effort:'high',text:'What would help today?',output:[]});
  try{
   const start=await service.start(f.session);await service.turn(start.session_id,f.session,randomUUID(),'What do you remember?');
   expect(JSON.stringify(f.respond.mock.calls.at(-1)![0])).toContain(input.summary);expect(f.respond.mock.calls.at(-1)![1]).not.toContain(input.summary);
   const correction={type:'correct_significant_handoff',handoff_id:note.id,expected_revision:1,summary:'The shoulder discomfort is improving.',occurred_at:input.occurred_at,reason:'Update my description'};
   const review=await prepareLocalAction(f.features,f.session,{family:'day',command:correction},true,randomUUID());expect(review.text).toContain('Correct your note');await f.day.command(f.session,review.command as LocalDayCommand);
   await expect(prepareLocalAction(f.features,f.session,{family:'day',command:correction},true,randomUUID())).rejects.toMatchObject({status:409});
   await service.turn(start.session_id,f.session,randomUUID(),'What is relevant now?');const facts=JSON.stringify(f.respond.mock.calls.at(-1)![0].filter((x:any)=>x.role==='user'&&String(x.content).startsWith('Current authorized facts')));
   expect(facts).toContain(correction.summary);expect(facts).not.toContain(input.summary);
   await f.day.command(f.session,{type:'review_significant_handoff',idempotency_key:randomUUID(),confirmed:true,handoff_id:note.id,expected_revision:2,decision:'resolved',note:'No longer needed'});
   await service.turn(start.session_id,f.session,randomUUID(),'What is relevant now?');const resolved=JSON.stringify(f.respond.mock.calls.at(-1)![0].filter((x:any)=>x.role==='user'&&String(x.content).startsWith('Current authorized facts')));expect(resolved).not.toContain(correction.summary);
  }finally{service.close();}
 });
 it('can cancel an unknown hold outcome even when no envelope reached durable storage',async()=>{
  const f=await fixture();f.respond.mockResolvedValueOnce(tool(input));const service=f.create();
  try{
   const start=await service.start(f.session),review=await service.turn(start.session_id,f.session,randomUUID(),'Remember this for tomorrow.');service.played(start.session_id,f.session,review.reply_id);
   vi.spyOn(f.day,'holdHandoff').mockRejectedValueOnce(unavailable());
   await expect(service.turn(start.session_id,f.session,randomUUID(),'save this choice')).rejects.toMatchObject({status:503});
   expect(await f.day.pendingHandoff(f.session)).toBeNull();
   const cancelled=await service.turn(start.session_id,f.session,randomUUID(),'cancel this context note save');expect(cancelled.text).toContain('cancelled');
   expect((await service.turn(start.session_id,f.session,randomUUID(),'Show my meals')).navigate).toBe('meals');expect(await f.day.activeHandoffs(f.session)).toEqual([]);
  }finally{service.close();}
 });
 it('attempts quiet preparation without blocking greeting, then revalidates authorization',async()=>{
  const f=await fixture(),prepare=vi.spyOn(f.day,'prepare').mockRejectedValueOnce(new Error('Synthetic preparation failure')),service=f.create();
  try{
   expect((await service.start(f.session)).text).toContain('what can I help');expect(prepare).toHaveBeenCalledWith(f.session,'open');
   prepare.mockImplementationOnce(async()=>{await pool.query('update companion_local.role_grants set revoked_at=$2 where actor_id=$1',[f.person.user_id,new Date('2026-10-13T14:00:00Z')]);return null;});
   await expect(service.start(f.session)).rejects.toMatchObject({status:401});
  }finally{service.close();}
 });
});
