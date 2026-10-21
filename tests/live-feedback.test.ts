import {afterAll,beforeAll,describe,it,expect,vi} from 'vitest';
import {createMicrosoftFixture,microsoftTestDatabase} from './helpers/microsoft-fixture.js';
import {MicrosoftService} from '../src/server/microsoft/service.js';
import {outlookDateRange,requestedOutlookRange} from '../src/server/microsoft/conversation.js';
import {mealStarterReferences,mealStarterContext} from '../src/server/meal-starters.js';
import {currentNutritionReference} from '../src/server/nutrition-reference.js';
import {kokoroPronunciationInput} from '../src/server/local-speech.js';
import {openSession,sealSession} from '../src/server/session.js';
import {randomBytes} from 'node:crypto';
import {MicrosoftOAuthError} from '../src/server/microsoft/oauth.js';
import {MicrosoftGraphError} from '../src/server/microsoft/graph.js';

describe('live feedback: authority, preparation and retained sign-in',()=>{
 let database:Awaited<ReturnType<typeof microsoftTestDatabase>>;
 beforeAll(async()=>{database=await microsoftTestDatabase();});afterAll(async()=>database.close());
 async function fixture(){
  let now=new Date('2026-10-21T10:05:00Z');const f=await createMicrosoftFixture(database.pool,()=>now);await f.connect();
  const service=new MicrosoftService(database.pool,{...f.settings,modelUseApproved:true,preparationApproved:true},f.oauth,{clock:()=>now,graph:()=>f.graph});
  await service.select(f.session,{expected_revision:(await service.status(f.session)).revision,calendar_ids:['calendar-approved'],mail_folder_ids:['folder-approved']});
  return {...f,service,now:()=>now,advance:(ms:number)=>{now=new Date(now.getTime()+ms);}};
 }
 it('a failed or expired browser login cannot erase a still-authorized Outlook connection',async()=>{
  const f=await fixture();await f.service.invalidateSession(f.session);expect((await f.service.status(f.session)).state).toBe('connected');
  f.advance(8*3600000+1);await expect(f.service.status(f.session)).rejects.toMatchObject({status:401});
  const signed=await f.care.login(f.email,f.password);expect((await f.service.status(signed)).state).toBe('connected');
  expect((await f.service.status(signed)).selected_calendar_ids).toEqual(['calendar-approved']);
 });
 it('revoked grants still erase credentials and prepared context before a provider read',async()=>{
  const f=await fixture();await f.service.prepareMorning();const reads=f.calls.calendar;
  await database.pool.query('update companion_local.role_grants set revoked_at=$2 where actor_id=$1',[f.session.user_id,f.now()]);
  await expect(f.service.preparedContext(f.session,outlookDateRange('2026-10-21','America/Toronto'))).rejects.toMatchObject({status:401});
  const row=(await database.pool.query('select token_ciphertext,prepared_context_ciphertext,state from companion_local.microsoft_connections where actor_id=$1',[f.session.user_id])).rows[0];
  expect(row).toMatchObject({token_ciphertext:null,prepared_context_ciphertext:null,state:'reconnect_required'});expect(f.calls.calendar).toBe(reads);
 });
 it('prepares once across restart, encrypts snapshots, keeps the mailbox lookback separate and expires cached facts',async()=>{
  const f=await fixture(),calendarRanges:unknown[]=[],mailRanges:unknown[]=[];
  const calendar=f.graph.calendarView,mail=f.graph.listMessages;
  f.graph.calendarView=async(...args:any[])=>{calendarRanges.push(args[1]);return calendar();};
  f.graph.listMessages=async(...args:any[])=>{mailRanges.push(args[1]);return mail();};
  expect(await f.service.prepareMorning()).toMatchObject({state:'prepared'});expect(calendarRanges[0]).toEqual(outlookDateRange('2026-10-21','America/Toronto',7));
  expect(mailRanges[0]).toEqual({start:'2026-10-14T10:05:00.000Z',end:'2026-10-21T10:05:00.000Z'});
  const cipher=(await database.pool.query('select prepared_context_ciphertext from companion_local.microsoft_connections where actor_id=$1',[f.session.user_id])).rows[0].prepared_context_ciphertext;
  expect(cipher).not.toContain('Synthetic appointment');
  const reads=f.calls.calendar;expect((await f.service.preparedContext(f.session,outlookDateRange('2026-10-22','America/Toronto'))).state).toBe('prepared');expect(f.calls.calendar).toBe(reads);
  expect(await f.service.prepareMorning()).toMatchObject({state:'not_due'});
  const restarted=new MicrosoftService(database.pool,{...f.settings,modelUseApproved:true,preparationApproved:true},f.oauth,{clock:f.now,graph:()=>f.graph});
  expect(await restarted.prepareMorning()).toMatchObject({state:'not_due'});
  f.advance(5*60000);expect((await restarted.preparedContext(f.session,outlookDateRange('2026-10-21','America/Toronto'))).state).toBe('not_prepared');
  expect(await restarted.prepareMorning()).toMatchObject({state:'prepared'});expect(f.calls.calendar).toBe(reads+1);
 });
 it('does not prepare without consent, outside the morning window, or disclose after resource changes',async()=>{
  const f=await fixture(),disabled=new MicrosoftService(database.pool,{...f.settings,modelUseApproved:true},f.oauth,{clock:f.now,graph:()=>f.graph});
  expect(await disabled.prepareMorning()).toMatchObject({state:'not_authorized'});expect(f.calls.calendar).toBe(0);
  await f.service.prepareMorning();await f.service.select(f.session,{expected_revision:(await f.service.status(f.session)).revision,calendar_ids:[],mail_folder_ids:[]});
  expect((await f.service.preparedContext(f.session,outlookDateRange('2026-10-21','America/Toronto'))).state).toBe('not_prepared');
  f.advance(5*3600000);expect(await f.service.prepareMorning()).toMatchObject({state:'outside_window'});
 });
 it('keeps consent and selected resources during a transient refresh outage, then recovers',async()=>{
  const f=await fixture();f.advance(3600001);
  const unavailable=new MicrosoftService(database.pool,{...f.settings,modelUseApproved:true},{...f.oauth,async refreshTokens(){throw new MicrosoftOAuthError('provider_unavailable');}},{clock:f.now,graph:()=>f.graph});
  expect((await unavailable.conversationContext(f.session,outlookDateRange('2026-10-21','America/Toronto'))).state).toBe('unavailable');
  expect(await unavailable.status(f.session)).toMatchObject({state:'connected',selected_calendar_ids:['calendar-approved']});
  expect((await f.service.conversationContext(f.session,outlookDateRange('2026-10-21','America/Toronto'))).state).toBe('fresh');
 });
 it('drains concurrent provider reads before releasing their authorization transaction on failure',async()=>{
  const f=await fixture();let release!:()=>void,started!:()=>void,finished=false;
  const waiting=new Promise<void>(resolve=>{release=resolve;}),mailStarted=new Promise<void>(resolve=>{started=resolve;});
  const service=new MicrosoftService(database.pool,{...f.settings,modelUseApproved:true},f.oauth,{clock:f.now,graph:()=>({...f.graph,async calendarView(){throw new MicrosoftGraphError('provider_error',503);},async listMessages(){started();await waiting;return f.graph.listMessages();}})});
  const request=service.conversationContext(f.session,outlookDateRange('2026-10-21','America/Toronto')).then(result=>{finished=true;return result;});
  await mailStarted;expect(finished).toBe(false);release();expect((await request).state).toBe('unavailable');expect((await service.status(f.session)).state).toBe('connected');
 });
 it.skipIf(!process.env.MICROSOFT_TEST_DATABASE_URL)('bounds an actual PostgreSQL row-lock wait without blocking error diagnostics',async()=>{
  const f=await fixture(),blocker=await database.pool.connect();
  try{await blocker.query('begin');await blocker.query('select id from companion_local.microsoft_connections where actor_id=$1 for update',[f.session.user_id]);
   const started=performance.now(),result=await f.service.conversationContext(f.session,outlookDateRange('2026-10-21','America/Toronto'));
   expect(result.state).toBe('unavailable');expect(performance.now()-started).toBeLessThan(5000);
  }finally{await blocker.query('rollback');blocker.release();}
 });
 it('keeps trusted-device login for 30 days with rotating access, ordinary login for seven, and honors logout',async()=>{
  const f=await fixture(),trusted=await f.care.login(f.email,f.password,true),ordinary=await f.care.login(f.email,f.password);
  expect(trusted.remember_device).toBe(true);f.advance(8*86400000);
  const refreshed=await f.care.authorize(trusted);expect(refreshed.access_token).not.toBe(trusted.access_token);expect(refreshed.issued_at).toBe(trusted.issued_at);
  await expect(f.care.authorize(ordinary)).rejects.toMatchObject({status:401});await f.care.logout(refreshed);await expect(f.care.authorize(refreshed)).rejects.toMatchObject({status:401});
  const another=await f.care.login(f.email,f.password,true);f.advance(30*86400000);await expect(f.care.authorize(another)).rejects.toMatchObject({status:401});
  const key=randomBytes(32),clock=vi.spyOn(Date,'now').mockReturnValue((trusted.issued_at+8*86400)*1000);
  try{expect(openSession(sealSession(trusted,key),key)?.remember_device).toBe(true);expect(openSession(sealSession(ordinary,key),key)).toBeNull();}finally{clock.mockRestore();}
 });
});
describe('live feedback: bounded meal/date references and pronunciation',()=>{
 it('retrieves real recipes for all requested meal slots before a model/tool round',()=>{
  const results=mealStarterReferences('What meals do you recommend for breakfast, lunch and dinner?',currentNutritionReference());
  const categories:string[]=[];for(const result of results)for(const item of result.items)if('category' in item)categories.push(item.category);
  expect(results).toHaveLength(4);expect(categories).toEqual(['breakfast','breakfast','lunch','lunch','dinner','dinner']);
  expect(results.every(r=>r.sources.length>0)).toBe(true);expect(mealStarterReferences('I ate breakfast at 9',currentNutritionReference())).toEqual([]);
  const context=mealStarterContext(results);expect(context.items).toHaveLength(8);expect(JSON.stringify(context).length).toBeLessThan(4000);expect(JSON.stringify(context)).not.toContain('recipeYaml');expect(context.detail_policy).toContain('Retrieve exact recipe details');
 });
 it('handles tomorrow and a DST-spanning week without pretending every local day has 24 hours',()=>{
  expect(requestedOutlookRange('My calendar tomorrow','2026-10-31','America/Toronto')).toEqual({start:'2026-11-01T00:00:00-04:00',end:'2026-11-02T00:00:00-05:00'});
  const range=outlookDateRange('2026-10-28','America/Toronto',7);expect(Date.parse(range.end)-Date.parse(range.start)).toBe(169*3600000);
  expect(requestedOutlookRange('my calendar next week','2026-10-21','America/Toronto')).toBeNull();
 });
 it('uses the requested cyclic pronunciation in synthesis without changing the source text',()=>{
  const source='Cyclic breathing in rehab.';expect(kokoroPronunciationInput(source)).toBe('sick lick breathing in reehab.');expect(source).toBe('Cyclic breathing in rehab.');expect(kokoroPronunciationInput('bicyclic')).toBe('bicyclic');
 });
});
