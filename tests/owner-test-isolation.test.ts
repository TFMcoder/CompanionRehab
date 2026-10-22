import {describe,it,expect,vi} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {createApp} from '../src/server/app.js';
import {configFromEnv} from '../src/server/config.js';
import {ownerTestSchema,ownerTestIndex,ownerTestReasoning,ownerTestPreparation} from '../src/server/owner-test-config.js';
import {sealSession,type Session} from '../src/server/session.js';
import {SessionRevocations} from '../src/server/revocations.js';
import type {CareService} from '../src/server/care-access.js';

const session:Session={user_id:randomUUID(),session_id:randomUUID(),access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:Date.now()/1000+3600,issued_at:Date.now()/1000};
const settings=()=>({schema_version:1,database_name:'nancy_owner_test',database_role:'nancy_owner_test',database_url:'postgres://nancy_owner_test:synthetic@127.0.0.1:55432/nancy_owner_test',origin:'https://synthetic.example:10000',port:8788,owner_actor_id:randomUUID(),participant_id:randomUUID(),excluded_live_participant_id:randomUUID(),session_key:randomBytes(32).toString('base64'),email:'tester@nancy.local'});
const double=()=>({login:vi.fn(async()=>session),authorize:vi.fn(async(s:Session)=>s),logout:vi.fn(async()=>{}),today:vi.fn(async()=>({profile:null})),setup:vi.fn(),command:vi.fn(),receipt:vi.fn()} as unknown as CareService);
describe('isolated owner test contract',()=>{
 it('keeps Sol-high by default and accepts an alternate only for the exact private owner copy',()=>{
  const config=ownerTestSchema.parse(settings()),selection={schema_version:1,owner_actor_id:config.owner_actor_id,participant_id:config.participant_id,origin:config.origin,profile:'sol-none'};
  expect(ownerTestReasoning(config)).toEqual({model:'gpt-6-sol',effort:'high'});
  expect(ownerTestReasoning(config,selection)).toEqual({model:'gpt-6-sol',effort:'none'});
  expect(ownerTestPreparation(config)).toBe(false);expect(ownerTestPreparation(config,selection)).toBe(false);
  expect(ownerTestPreparation(config,{...selection,context_mode:'prepared-v1'})).toBe(true);
  expect(()=>ownerTestPreparation(config,{...selection,context_mode:'unreviewed'})).toThrow();
  for(const change of [{owner_actor_id:randomUUID()},{participant_id:randomUUID()},{origin:'https://synthetic.example:8443'},{profile:'anything'},{api_key:'synthetic'}])expect(()=>ownerTestReasoning(config,{...selection,...change})).toThrow();
 });
 it('accepts a separate local database, restricted role and independent synthetic profile',()=>{expect(ownerTestSchema.parse(settings())).toMatchObject({database_name:'nancy_owner_test',port:8788});});
 it.each([
  {database_url:'postgres://nancy_owner_test:synthetic@127.0.0.1:55432/nancy_client_trial'},
  {database_url:'postgres://postgres:synthetic@127.0.0.1:55432/nancy_owner_test'},
  {database_url:'postgres://nancy_owner_test:synthetic@remote.invalid:55432/nancy_owner_test'},
  {origin:'https://synthetic.example:8443'},
  {origin:'http://localhost:10000'},
  {session_key:'synthetic-invalid'},
 ])('rejects unsafe test configuration %j',change=>{expect(ownerTestSchema.safeParse({...settings(),...change}).success).toBe(false);});
 it('rejects reuse of the live care profile',()=>{const s=settings();expect(ownerTestSchema.safeParse({...s,participant_id:s.excluded_live_participant_id}).success).toBe(false);});
 it('labels only the generated test entry while retaining the locked Current asset references',()=>{
  const original='<html><head><title>Nancy</title><meta name="nancy-focus-review" content="disabled"><script src="/assets/app-synthetic.js"></script></head><body><div id="root"></div></body></html>';
  const result=ownerTestIndex(original);expect(result).toContain('role="note"');expect(result).toContain('practice data only');expect(result).toContain('/assets/app-synthetic.js');expect(result).toContain('content="disabled"');expect(original).not.toContain('owner-test.css');
  expect(()=>ownerTestIndex(original.replace('content="disabled"','content="enabled"'))).toThrow();
 });
 it('sets, reads and clears only its test cookie; a rejected test cookie never clears the live cookie',async()=>{
  const c={...configFromEnv({PUBLIC_ORIGIN:'https://synthetic.example:10000',DATABASE_URL:'postgres://synthetic-unused',SESSION_KEY:randomBytes(32).toString('base64')}),sessionCookieName:'nancy_test_session' as const};
  const care=double(),app=await createApp(c,{care,microsoft:null,revocations:new SessionRevocations()});
  const headers={host:'synthetic.example:10000',origin:c.origin};
  try{
   const login=await app.inject({method:'POST',url:'/api/auth/login',headers,payload:{email:'tester@nancy.local',password:'synthetic-password'}});
   expect(login.statusCode).toBe(200);expect(login.headers['set-cookie']).toContain('nancy_test_session=');expect(login.headers['set-cookie']).toContain('Secure');
   const cookie=String(login.headers['set-cookie']).split(';')[0];
   expect((await app.inject({url:'/api/today',headers:{...headers,cookie}})).statusCode).toBe(200);
   const liveOnly=await app.inject({url:'/api/today',headers:{...headers,cookie:'nancy_session='+sealSession(session,c.sessionKey!)}});
   expect(liveOnly.statusCode).toBe(401);expect(liveOnly.headers['set-cookie']).toContain('nancy_test_session=');expect(String(liveOnly.headers['set-cookie'])).not.toMatch(/(?:^|,\s*)nancy_session=/);
   const out=await app.inject({method:'POST',url:'/api/auth/logout',headers:{...headers,cookie},payload:{}});expect(out.statusCode).toBe(200);expect(out.headers['set-cookie']).toContain('nancy_test_session=');
  }finally{await app.close();}
 });
 it('rejects live encrypted sessions even if someone renames the cookie',async()=>{
  const c={...configFromEnv({PUBLIC_ORIGIN:'https://synthetic.example:10000',DATABASE_URL:'postgres://synthetic-unused',SESSION_KEY:randomBytes(32).toString('base64')}),sessionCookieName:'nancy_test_session' as const};
  const care=double(),app=await createApp(c,{care,microsoft:null,revocations:new SessionRevocations()});
  try{const result=await app.inject({url:'/api/today',headers:{host:'synthetic.example:10000',cookie:'nancy_test_session='+sealSession(session,randomBytes(32))}});expect(result.statusCode).toBe(401);expect(care.authorize).not.toHaveBeenCalled();}finally{await app.close();}
 });
 it('keeps the production cookie default and rejects the test cookie there',async()=>{
  const c=configFromEnv({PUBLIC_ORIGIN:'https://synthetic.example:8443',DATABASE_URL:'postgres://synthetic-unused',SESSION_KEY:randomBytes(32).toString('base64')});
  const care=double(),app=await createApp(c,{care,microsoft:null,revocations:new SessionRevocations()});
  try{const denied=await app.inject({url:'/api/today',headers:{host:'synthetic.example:8443',cookie:'nancy_test_session='+sealSession(session,c.sessionKey!)}});expect(denied.statusCode).toBe(401);expect(denied.headers['set-cookie']).toContain('nancy_session=');expect(care.authorize).not.toHaveBeenCalled();}finally{await app.close();}
 });
 it('cannot clear a live Outlook callback cookie when the disconnected test callback fails',async()=>{
  const c={...configFromEnv({PUBLIC_ORIGIN:'https://synthetic.example:10000',DATABASE_URL:'postgres://synthetic-unused',SESSION_KEY:randomBytes(32).toString('base64')}),sessionCookieName:'nancy_test_session' as const};
  const app=await createApp(c,{care:double(),microsoft:null,revocations:new SessionRevocations()});
  try{const result=await app.inject({url:'/api/microsoft/callback',headers:{host:'synthetic.example:10000',cookie:'nancy_microsoft_binding=synthetic-live-binding'}});expect(result.statusCode).toBe(303);expect(result.headers['set-cookie']).toContain('nancy_test_microsoft_binding=');expect(String(result.headers['set-cookie'])).not.toMatch(/(?:^|,\s*)nancy_microsoft_binding=/);}finally{await app.close();}
 });
});
