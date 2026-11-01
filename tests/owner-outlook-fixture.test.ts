import {describe,it,expect,vi} from 'vitest';
import {randomUUID,randomBytes} from 'node:crypto';
import {OwnerOutlookFixture,createOwnerOutlookFixture} from '../src/server/owner-outlook-fixture.js';
import {ownerTestOutlookReads,ownerTestTelemetryPolicy,ownerTestSpeechPriority} from '../src/server/owner-test-config.js';
import {outlookDateRange} from '../src/server/microsoft/conversation.js';
import {testAuthority} from './helpers/inference.js';
import type {Session} from '../src/server/session.js';
import {sealSession} from '../src/server/session.js';
import {createApp} from '../src/server/app.js';

const fixture=()=>{
 const session:Session={user_id:randomUUID(),session_id:randomUUID(),issued_at:1,expires_at:9999999999,access_token:'synthetic',refresh_token:'synthetic'},participant=randomUUID();
 const settings={schema_version:1 as const,database_name:'nancy_owner_test' as const,database_role:'nancy_owner_test' as const,database_url:'postgresql://nancy_owner_test:synthetic@127.0.0.1:55432/nancy_owner_test',origin:'https://example.invalid:10000',port:8788 as const,owner_actor_id:session.user_id,participant_id:participant,excluded_live_participant_id:randomUUID(),session_key:randomBytes(32).toString('base64'),email:'tester@nancy.local' as const};
 const authority=vi.fn(async(s:Session)=>({...await testAuthority(s,participant),time_zone:'America/Toronto',profile_revision:1}));
 const source=new OwnerOutlookFixture(settings,authority,()=>new Date('2026-10-26T16:00:00Z'));
 return{session,settings,authority,source};
};
describe('owner-only practice Outlook runtime',()=>{
 it('offers labelled forty-five-day-old practice email without changing default recent Inbox or enabling writes',async()=>{
  const f=fixture(),search=await f.source.conversationMailSearch(f.session,{query:'clinic'});expect(search.mail_folders[0].messages).toHaveLength(1);expect(search.mail_folders[0].messages[0]).toMatchObject({id:'owner-practice-message-older',reply_status:'unknown',is_read:true});expect(search.source_mode).toBe('owner_fixture');
  const recent=await f.source.conversationContext(f.session,outlookDateRange('2026-10-26','America/Toronto'),'inbox');expect(recent.mail_folders[0].messages).toHaveLength(1);expect(recent.mail_folders[0].messages[0].id).toBe('owner-practice-message');await expect(f.source.prepareAction()).rejects.toMatchObject({code:'owner_outlook_fixture_read_only'});
 });
 it('uses current local fixture dates and explicit synthetic/read-only status without credentials',async()=>{
  const f=fixture(),description=await f.source.description(f.session);expect(description).toMatchObject({enabled:true,synthetic:true,read_only:true,local_date:'2026-10-26'});expect(description.events.some(e=>e.start==='2026-10-27T14:00:00-04:00')).toBe(true);
  expect(await f.source.status(f.session)).toMatchObject({model_disclosure_enabled:true,reviewed_writes_enabled:false});expect(f.source.sourceMode).toBe('owner_fixture');
 });
 it('keeps source purposes and Inbox recency separate across future/DST ranges',async()=>{
  const f=fixture(),range=outlookDateRange('2026-10-26','America/Toronto',7),calendar=await f.source.conversationContext(f.session,range,'calendar');
  expect(calendar.mail_folders).toEqual([]);expect(Date.parse(range.end)-Date.parse(range.start)).toBe(169*3600000);
  const inbox=await f.source.conversationContext(f.session,outlookDateRange('2026-11-02','America/Toronto',7),'inbox');expect(inbox.calendars).toEqual([]);expect(inbox.mail_range.start).toBe('2026-10-19T16:00:00.000Z');expect(inbox.mail_folders[0].messages[0]).toMatchObject({reply_status:'unknown',is_read:false});
 });
 it.each(['actor','client','role','login'])('rejects changed %s and does not treat fixture configuration as authority',async mode=>{
  const f=fixture();f.authority.mockImplementationOnce(async s=>({...await testAuthority(s,f.settings.participant_id),actor_id:mode==='actor'?randomUUID():s.user_id,client_id:mode==='client'?randomUUID():f.settings.participant_id,active_role:mode==='role'?'administrator':'client',login_session_id:mode==='login'?randomUUID():s.session_id,time_zone:'America/Toronto',profile_revision:1}));
  await expect(f.source.conversationContext(f.session,outlookDateRange('2026-10-27','America/Toronto'))).rejects.toMatchObject({code:'owner_outlook_fixture_scope'});
 });
 it('rechecks grant/profile authority before returning read facts',async()=>{
  const f=fixture();f.authority.mockResolvedValueOnce({...await testAuthority(f.session,f.settings.participant_id),time_zone:'America/Toronto',profile_revision:1}).mockResolvedValueOnce({...await testAuthority(f.session,f.settings.participant_id),grant_revision:'changed',time_zone:'America/Toronto',profile_revision:1});
  await expect(f.source.conversationContext(f.session,outlookDateRange('2026-10-27','America/Toronto'))).rejects.toMatchObject({code:'owner_outlook_fixture_scope'});
 });
 it('rejects writes, invented message IDs and an incorrect database/role',async()=>{
  const f=fixture();await expect(f.source.prepareAction()).rejects.toMatchObject({code:'owner_outlook_fixture_read_only'});await expect(f.source.confirmAction()).rejects.toMatchObject({code:'owner_outlook_fixture_read_only'});await expect(f.source.actionReceipt()).rejects.toMatchObject({code:'owner_outlook_fixture_read_only'});await expect(f.source.conversationMessage(f.session,'owner-practice-inbox','invented')).rejects.toMatchObject({code:'owner_outlook_fixture_scope'});
  await expect(createOwnerOutlookFixture(f.settings,{pool:{query:async()=>({rows:[{db:'wrong',role:'nancy_owner_test'}]})}} as any)).rejects.toMatchObject({code:'owner_outlook_fixture_scope'});
 });
 it('requires an exact private selection and leaves flag-absent settings unchanged',()=>{
  const f=fixture(),selection={schema_version:1,owner_actor_id:f.settings.owner_actor_id,participant_id:f.settings.participant_id,origin:f.settings.origin,profile:'sol-low',context_mode:'prepared-v1',speech_mode:'heart-latency-v1',read_mode:'quick-v1',reply_mode:'spoken-v1',meal_mode:'ahead-v1',continuation_mode:'dialogue-v1',chat_mode:'ahead-v1',reference_mode:'verified-v1',connection_mode:'warm-v2'};
  expect(ownerTestOutlookReads(f.settings,selection)).toBe(false);expect(ownerTestOutlookReads(f.settings,{...selection,outlook_mode:'fixture-fast-v1'})).toBe(true);expect(ownerTestTelemetryPolicy('nancy-core-v2',f.settings,{...selection,outlook_mode:'fixture-fast-v1'})).toMatch(/-of1$/);
  expect(ownerTestSpeechPriority(f.settings,{...selection,outlook_mode:'fixture-fast-v1'})).toBe(false);expect(ownerTestSpeechPriority(f.settings,{...selection,outlook_mode:'fixture-fast-v2'})).toBe(true);expect(ownerTestTelemetryPolicy('nancy-core-v2',f.settings,{...selection,outlook_mode:'fixture-fast-v2'})).toMatch(/-of2$/);
  for(const changed of [{owner_actor_id:randomUUID()},{participant_id:randomUUID()},{origin:'https://example.invalid:8443'},{profile:'sol-high'},{connection_mode:'warm-v3'}])expect(()=>ownerTestOutlookReads(f.settings,{...selection,outlook_mode:'fixture-fast-v1',...changed})).toThrow();
 });
 it('protects fixture diagnostics with the owner cookie, exact origin and fresh identity; real Microsoft stays unavailable',async()=>{
  const f=fixture(),config={origin:f.settings.origin,port:8788,databaseUrl:f.settings.database_url,sessionKey:Buffer.from(f.settings.session_key,'base64'),planUserId:f.settings.owner_actor_id,synthetic:true,sessionCookieName:'nancy_test_session' as const,voiceModel:'unused',voiceMinutes:1,voiceDailyMinutes:1};
  const care={authorize:async(s:Session)=>s,authority:f.authority},app=await createApp(config,{care:care as any,microsoft:null,ownerOutlookFixture:f.source});
  try{
   const host=new URL(config.origin).host,cookie='nancy_test_session='+sealSession({...f.session,issued_at:Math.floor(Date.now()/1000)},config.sessionKey);
   expect((await app.inject({url:'/api/owner-outlook-fixture',headers:{host}})).statusCode).toBe(401);
   const valid=await app.inject({url:'/api/owner-outlook-fixture',headers:{host,cookie}});expect(valid.statusCode).toBe(200);expect(valid.json()).toMatchObject({synthetic:true,read_only:true});
   expect((await app.inject({url:'/api/microsoft',headers:{host,cookie}})).json().state).toBe('not_configured');
   expect((await app.inject({url:'/api/owner-outlook-fixture',headers:{host:'example.invalid:8443',cookie}})).statusCode).toBe(403);
   f.authority.mockImplementation(async s=>({...await testAuthority(s,randomUUID()),time_zone:'America/Toronto',profile_revision:1}));
   expect((await app.inject({url:'/api/owner-outlook-fixture',headers:{host,cookie}})).statusCode).toBe(403);
  }finally{await app.close();}
 });
 it('refuses fixture diagnostics on a non-owner/non-synthetic runtime',async()=>{
  const f=fixture(),config={origin:'https://example.invalid:8443',port:8787,databaseUrl:f.settings.database_url,sessionKey:randomBytes(32),planUserId:randomUUID(),synthetic:false,voiceModel:'unused',voiceMinutes:1,voiceDailyMinutes:1};
  await expect(createApp(config,{care:{authorize:async(s:Session)=>s} as any,microsoft:null,ownerOutlookFixture:f.source})).rejects.toThrow('isolated owner runtime');
 });
});
