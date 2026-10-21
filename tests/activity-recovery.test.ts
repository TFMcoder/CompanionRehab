import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import type {Pool} from 'pg';
import {LocalCare,bootstrapLocalUser} from '../src/server/local-care.js';
import {ConversationService} from '../src/server/conversation.js';
import {localCareMigrations} from '../src/server/local-migrations.js';
import {pglitePool} from './helpers/pglite-pool.js';
import {bindTestInference} from './helpers/inference.js';
import {ApiError,unavailable} from '../src/server/errors.js';
import {exportSnapshot,encryptSnapshot,decryptSnapshot,restoreSnapshot} from '../src/server/backup.js';
import type {ActivityCommand} from '../src/shared/activity-contracts.js';
import {createApp} from '../src/server/app.js';
import {configFromEnv} from '../src/server/config.js';
import {sealSession} from '../src/server/session.js';
import {SessionRevocations} from '../src/server/revocations.js';
import type {LocalSpeech} from '../src/server/local-speech.js';

describe('durable confirmed spoken activity recovery',()=>{
 let db:PGlite,pool:Pool;const now=new Date('2026-10-13T14:00:00Z');
 beforeAll(async()=>{db=new PGlite();pool=pglitePool(db) as unknown as Pool;for(const f of localCareMigrations)await db.exec(await readFile(new URL('../db/'+f,import.meta.url),'utf8'));});
 afterAll(async()=>{await db.close();});
 afterEach(()=>vi.useRealTimers());
 async function fixture(){const email=randomUUID()+'@example.invalid',password='synthetic-recovery-password';await bootstrapLocalUser(pool,{email,password,role:'client'});
  const care=new LocalCare({pool,clock:()=>now}),session=await care.login(email,password),respond=vi.fn();
  const command:ActivityCommand={type:'record_activity',idempotency_key:randomUUID(),local_date:'2026-10-13',expected_revision:0,payload:{unplanned:{kind:'meal',title:'Synthetic toast',meal_slot:'breakfast'},status:'completed',occurred_at:'2026-10-13T13:00:00Z',notes:'',portion:null}};
  const {type:_type,idempotency_key:_key,...args}=command;
  respond.mockResolvedValueOnce({completed:true,model:'gpt-6-sol',effort:'high',text:'',output:[{type:'function_call',name:'prepare_activity_record',call_id:randomUUID(),arguments:JSON.stringify(args)}]});
  const service=new ConversationService(care,{bind:bindTestInference,respond},session.user_id,()=>now);
  return {care,session,service,respond,command};}
 it('reconciles a committed save after failed receipt lookup and conversation restart without another write',async()=>{
  const f=await fixture(),start=await f.service.start(f.session),review=await f.service.turn(start.session_id,f.session,randomUUID(),'I ate toast at nine');f.service.played(start.session_id,f.session,review.reply_id);
  const write=f.care.activityCommand.bind(f.care),save=vi.spyOn(f.care,'activityCommand').mockImplementationOnce(async(s,c)=>{await write(s,c);throw unavailable();});
  const read=f.care.activityReceipt.bind(f.care);vi.spyOn(f.care,'activityReceipt').mockRejectedValueOnce(unavailable()).mockImplementation(read);
  const failedTurn=randomUUID();
  await expect(f.service.turn(start.session_id,f.session,failedTurn,'save this change')).rejects.toMatchObject({code:'outcome_unconfirmed'});
  await expect(f.service.turn(start.session_id,f.session,failedTurn,'retry this activity save')).rejects.toMatchObject({code:'changed_turn'});
  const pending=await f.care.pendingActivityCommand(f.session);expect(pending).not.toBeNull();f.service.close();
  const restarted=new ConversationService(f.care,{bind:bindTestInference,respond:f.respond},f.session.user_id,()=>now);
  try{const next=await restarted.start(f.session),reply=await restarted.turn(next.session_id,f.session,randomUUID(),'I ate toast');expect(reply.changed).toBe(true);expect(reply.text).toContain('was saved');
   expect(save).toHaveBeenCalledTimes(1);expect(f.respond).toHaveBeenCalledTimes(1);expect(await f.care.pendingActivityCommand(f.session)).not.toBeNull();
   await restarted.received(next.session_id,f.session,reply.reply_id);expect(await f.care.pendingActivityCommand(f.session)).toBeNull();
   expect((await f.care.ledger(f.session)).entries.filter(e=>e.kind==='meal')).toHaveLength(1);
  }finally{restarted.close();}
 });
 it('requires explicit same-key retry after a missing receipt and retains intent in encrypted restore',async()=>{
  const f=await fixture();await f.care.holdActivityCommand(f.session,f.command);
  const snapshot=await exportSnapshot(pool,'synthetic-source','companion_local'),key=randomBytes(32),copy=decryptSnapshot(encryptSnapshot(snapshot,key),key);
  expect(copy.tables.pending_activity_commands).toHaveLength(1);
  const target=new PGlite();try{for(const file of localCareMigrations)await target.exec(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));
   await restoreSnapshot(pglitePool(target),copy,'synthetic-target');expect((await target.query('select command_id from companion_local.pending_activity_commands')).rows).toContainEqual({command_id:f.command.idempotency_key});
  }finally{await target.close();}
  const start=await f.service.start(f.session);try{const reply=await f.service.turn(start.session_id,f.session,randomUUID(),'I ate something else');expect(reply.text).toContain('retry this activity save');expect(f.respond).not.toHaveBeenCalled();
   const saved=await f.service.turn(start.session_id,f.session,randomUUID(),'retry this activity save');expect(await f.care.activityReceipt(f.session,f.command.idempotency_key)).not.toBeNull();expect(await f.care.pendingActivityCommand(f.session)).not.toBeNull();
   await f.service.received(start.session_id,f.session,saved.reply_id);expect(await f.care.pendingActivityCommand(f.session)).toBeNull();
  }finally{f.service.close();}
 });
 it('clears a definitely rejected retry so a stale intent cannot trap later reports',async()=>{
  const f=await fixture();await f.care.holdActivityCommand(f.session,f.command);
  vi.spyOn(f.care,'activityCommand').mockRejectedValueOnce(new ApiError(409,'stale_revision','Review the current activity first.'));
  const start=await f.service.start(f.session);
  try{await expect(f.service.turn(start.session_id,f.session,randomUUID(),'retry this activity save')).rejects.toMatchObject({code:'stale_revision'});
   expect(await f.care.pendingActivityCommand(f.session)).toBeNull();expect(await f.care.activityReceipt(f.session,f.command.idempotency_key)).toBeNull();
  }finally{f.service.close();}
 });
 async function saveReviewed(f:Awaited<ReturnType<typeof fixture>>){
  const start=await f.service.start(f.session),review=await f.service.turn(start.session_id,f.session,randomUUID(),'I ate toast at nine');
  f.service.played(start.session_id,f.session,review.reply_id);
  const turnId=randomUUID(),reply=await f.service.turn(start.session_id,f.session,turnId,'save this change');
  return {start,review,turnId,reply};
 }
 it('retains a successful but undelivered save through repeated turns and restart until receipt acknowledgement',async()=>{
  const f=await fixture(),save=vi.spyOn(f.care,'activityCommand'),first=await saveReviewed(f);
  expect(first.reply).toMatchObject({text:'Your activity is recorded.',acknowledgement_required:true});
  const held=await f.care.pendingActivityCommand(f.session);expect(held).not.toBeNull();
  // A server response is discarded here: no receipt or playback acknowledgement.
  expect(await f.service.turn(first.start.session_id,f.session,first.turnId,'save this change')).toEqual(first.reply);
  f.service.close();const restarted=new ConversationService(f.care,{bind:bindTestInference,respond:f.respond},f.session.user_id,()=>now);
  try{
   const start=await restarted.start(f.session),recovered=await restarted.turn(start.session_id,f.session,randomUUID(),'I ate toast at nine');
   expect(recovered.text).toContain('was saved');expect(recovered.acknowledgement_required).toBe(true);
   // Even a second lost reconciliation response must preserve the key.
   const again=await restarted.turn(start.session_id,f.session,randomUUID(),'save this change');
   expect(again.text).toContain('was saved');expect((await f.care.pendingActivityCommand(f.session))?.command.idempotency_key).toBe(held!.command.idempotency_key);
   expect(save).toHaveBeenCalledTimes(1);expect(f.respond).toHaveBeenCalledTimes(1);
   expect((await f.care.ledger(f.session)).entries.filter(e=>e.kind==='meal')).toHaveLength(1);
   await restarted.received(start.session_id,f.session,again.reply_id);
   await restarted.received(start.session_id,f.session,again.reply_id);
   expect(await f.care.pendingActivityCommand(f.session)).toBeNull();
  }finally{restarted.close();}
 });
 it('preserves recovery if acknowledgement fails before commit, and safely repeats a committed acknowledgement whose response was lost',async()=>{
  const f=await fixture(),first=await saveReviewed(f),ack=f.care.acknowledgeActivityCommand.bind(f.care);
  const acknowledge=vi.spyOn(f.care,'acknowledgeActivityCommand').mockRejectedValueOnce(unavailable());
  try{
   await expect(f.service.received(first.start.session_id,f.session,first.reply.reply_id)).rejects.toMatchObject({status:503});
   expect(await f.care.pendingActivityCommand(f.session)).not.toBeNull();
   const recovered=await f.service.turn(first.start.session_id,f.session,randomUUID(),'retry this activity save');
   expect(recovered.text).toContain('was saved');
   acknowledge.mockImplementationOnce(async(s,key)=>{await ack(s,key);throw unavailable();});
   await expect(f.service.received(first.start.session_id,f.session,recovered.reply_id)).rejects.toMatchObject({status:503});
   expect(await f.care.pendingActivityCommand(f.session)).toBeNull();
   acknowledge.mockImplementation(ack);
   await f.service.received(first.start.session_id,f.session,recovered.reply_id);
   expect((await f.service.turn(first.start.session_id,f.session,randomUUID(),'Show my meals')).navigate).toBe('meals');
   expect((await f.care.ledger(f.session)).entries.filter(e=>e.kind==='meal')).toHaveLength(1);
  }finally{f.service.close();}
 });
 it('does not acknowledge a save from playback alone, arbitrary reply IDs, another login, another actor, or revoked authority',async()=>{
  const f=await fixture(),first=await saveReviewed(f),key=(await f.care.pendingActivityCommand(f.session))!.command.idempotency_key;
  try{
   f.service.played(first.start.session_id,f.session,first.reply.reply_id);
   expect(await f.care.pendingActivityCommand(f.session)).not.toBeNull();
   await expect(f.service.received(first.start.session_id,f.session,first.review.reply_id)).rejects.toMatchObject({status:404});
   await expect(f.service.received(first.start.session_id,{...f.session,session_id:randomUUID()},first.reply.reply_id)).rejects.toMatchObject({status:404});
   const email=randomUUID()+'@example.invalid',password='synthetic-other-actor';
   await bootstrapLocalUser(pool,{email,password,role:'client',participant_id:f.session.user_id});const other=await f.care.login(email,password);
   expect(await f.care.activityReceipt(other,key)).toBeNull();
   await expect(f.care.acknowledgeActivityCommand(other,key)).rejects.toMatchObject({code:'outcome_unconfirmed'});
   expect(await f.care.pendingActivityCommand(f.session)).not.toBeNull();
   await pool.query('update companion_local.role_grants set revoked_at=$2 where actor_id=$1',[f.session.user_id,now]);
   await expect(f.service.received(first.start.session_id,f.session,first.reply.reply_id)).rejects.toMatchObject({status:401});
   expect((await pool.query('select command_id from companion_local.pending_activity_commands where actor_id=$1',[f.session.user_id])).rows).toEqual([{command_id:key}]);
  }finally{f.service.close();}
 });
 it('does not let an old acknowledgement clear a newer pending command',async()=>{
  const f=await fixture(),first=await saveReviewed(f);
  try{
   await f.service.received(first.start.session_id,f.session,first.reply.reply_id);
   await f.care.holdActivityCommand(f.session,f.command);
   await f.service.received(first.start.session_id,f.session,first.reply.reply_id);
   expect((await f.care.pendingActivityCommand(f.session))?.command.idempotency_key).toBe(f.command.idempotency_key);
   await f.care.discardPendingActivityCommand(f.session,f.command.idempotency_key);
  }finally{f.service.close();}
 });
 it('discards an obsolete unsaved grant-bound intent and immediately allows navigation without executing it',async()=>{
  const f=await fixture();await f.care.holdActivityCommand(f.session,f.command);
  await pool.query("update companion_local.role_grants set granted_at=granted_at+interval '1 second' where actor_id=$1",[f.session.user_id]);
  const start=await f.service.start(f.session);
  try{
   expect((await f.service.turn(start.session_id,f.session,randomUUID(),'Show my meals')).navigate).toBe('meals');
   expect(await f.care.pendingActivityCommand(f.session)).toBeNull();expect(f.respond).not.toHaveBeenCalled();
   await expect(f.care.commitPendingActivityCommand(f.session,f.command)).rejects.toMatchObject({code:'activity_review_required'});
   expect(await f.care.activityReceipt(f.session,f.command.idempotency_key)).toBeNull();
   expect((await f.service.turn(start.session_id,f.session,randomUUID(),'Show my tasks')).navigate).toBe('tasks');
  }finally{f.service.close();}
 });
 it('checks a held command grant again before writing and lets the client explicitly cancel an unsaved request',async()=>{
  const f=await fixture();await f.care.holdActivityCommand(f.session,f.command);
  await pool.query("update companion_local.role_grants set granted_at=granted_at+interval '1 second' where actor_id=$1",[f.session.user_id]);
  await expect(f.care.commitPendingActivityCommand(f.session,f.command)).rejects.toMatchObject({code:'activity_review_required'});
  await f.care.discardPendingActivityCommand(f.session,f.command.idempotency_key);
  await f.care.holdActivityCommand(f.session,f.command);
  const start=await f.service.start(f.session);
  try{
   const cancelled=await f.service.turn(start.session_id,f.session,randomUUID(),'cancel this activity save');
   expect(cancelled.text).toContain('was cancelled');expect(await f.care.pendingActivityCommand(f.session)).toBeNull();
   await expect(f.care.commitPendingActivityCommand(f.session,f.command)).rejects.toMatchObject({code:'activity_review_required'});
   expect((await f.service.turn(start.session_id,f.session,randomUUID(),'Show my meals')).navigate).toBe('meals');
  }finally{f.service.close();}
 });
 it('reconciles an already committed old-grant intent rather than discarding or repeating its write',async()=>{
  const f=await fixture();await f.care.holdActivityCommand(f.session,f.command);await f.care.commitPendingActivityCommand(f.session,f.command);
  await pool.query("update companion_local.role_grants set granted_at=granted_at+interval '1 second' where actor_id=$1",[f.session.user_id]);
  const start=await f.service.start(f.session);
  try{
   const reply=await f.service.turn(start.session_id,f.session,randomUUID(),'cancel this activity save');
   expect(reply.text).toContain('was saved');expect(await f.care.pendingActivityCommand(f.session)).not.toBeNull();
   await f.service.received(start.session_id,f.session,reply.reply_id);
   expect(await f.care.pendingActivityCommand(f.session)).toBeNull();
   expect((await f.care.ledger(f.session)).entries.filter(e=>e.kind==='meal')).toHaveLength(1);expect(f.respond).not.toHaveBeenCalled();
  }finally{f.service.close();}
 });
 it('acknowledges through the authenticated HTTP route while rejecting missing auth, origin changes and another actor',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);
  const f=await fixture(),first=await saveReviewed(f);
  const config=configFromEnv({PUBLIC_ORIGIN:'http://localhost:8787',DATABASE_URL:'postgresql://local.invalid/synthetic',SESSION_KEY:randomBytes(32).toString('base64')});
  const app=await createApp(config,{care:f.care,conversation:f.service,speech:{readiness:()=>({kokoro:'ready',asr:'ready'}),close:vi.fn()} as unknown as LocalSpeech,revocations:new SessionRevocations()});
  const headers={host:'localhost:8787',origin:config.origin,cookie:`nancy_session=${sealSession(f.session,config.sessionKey!)}`};
  const url=`/api/conversation/${first.start.session_id}/received`,payload={reply_id:first.reply.reply_id};
  try{
   expect((await app.inject({method:'POST',url,headers:{...headers,cookie:''},payload})).statusCode).toBe(401);
   expect((await app.inject({method:'POST',url,headers:{...headers,origin:'https://other.invalid'},payload})).statusCode).toBe(403);
   expect((await app.inject({method:'POST',url,headers,payload:{...payload,command_id:randomUUID()}})).statusCode).toBe(400);
   const email=randomUUID()+'@example.invalid',password='synthetic-other-login';
   await bootstrapLocalUser(pool,{email,password,role:'client',participant_id:f.session.user_id});const other=await f.care.login(email,password);
   expect((await app.inject({method:'POST',url,headers:{...headers,cookie:`nancy_session=${sealSession(other,config.sessionKey!)}`},payload})).statusCode).toBe(404);
   expect(await f.care.pendingActivityCommand(f.session)).not.toBeNull();
   expect((await app.inject({method:'POST',url,headers,payload})).statusCode).toBe(200);
   expect((await app.inject({method:'POST',url,headers,payload})).statusCode).toBe(200);
   expect(await f.care.pendingActivityCommand(f.session)).toBeNull();
   vi.setSystemTime(new Date(now.getTime()+8*86400000));
   expect((await app.inject({url:'/api/today',headers})).statusCode).toBe(401);
  }finally{await app.close();}
 });
});
