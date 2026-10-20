import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {randomBytes} from 'node:crypto';
import {createApp} from '../src/server/app.js';
import {configFromEnv} from '../src/server/config.js';
import {sealSession} from '../src/server/session.js';
import {SessionRevocations} from '../src/server/revocations.js';
import type {RuntimeLog} from '../src/server/telemetry.js';
import {createMicrosoftFixture,microsoftTestDatabase} from './helpers/microsoft-fixture.js';

describe('Microsoft initial connection HTTP boundary',()=>{
 let database:Awaited<ReturnType<typeof microsoftTestDatabase>>,f:Awaited<ReturnType<typeof createMicrosoftFixture>>,app:Awaited<ReturnType<typeof createApp>>,config:ReturnType<typeof configFromEnv>;
 const records:unknown[]=[],now=new Date('2026-10-17T16:00:00Z');
 const basic={host:'localhost:8787',origin:'http://localhost:8787'};
 const headers=(binding?:string,session=f.session)=>({...basic,cookie:`nancy_session=${sealSession(session,config.sessionKey!)}${binding?'; nancy_microsoft_binding='+binding:''}`});
 const binding=(response:{headers:Record<string,unknown>})=>{const values=response.headers['set-cookie'];const joined=Array.isArray(values)?values.join(';'):String(values??'');return /nancy_microsoft_binding=([^;]+)/.exec(joined)?.[1];};
 async function begin(){const result=await app.inject({method:'POST',url:'/api/microsoft/connect',headers:headers(),payload:{}});expect(result.statusCode,result.body).toBe(200);return binding(result)!;}
 beforeAll(async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);
  database=await microsoftTestDatabase();f=await createMicrosoftFixture(database.pool,()=>now);
  config=configFromEnv({PUBLIC_ORIGIN:basic.origin,DATABASE_URL:'postgresql://localhost/synthetic',SESSION_KEY:randomBytes(32).toString('base64')});
  app=await createApp(config,{care:f.care,microsoft:f.service,revocations:new SessionRevocations(),runtimeLog:{record:(value:unknown)=>{records.push(value);},close:()=>{}} as unknown as RuntimeLog});
 });
 afterAll(async()=>{await app?.close();await database?.close();vi.useRealTimers();});
 it('requires local authentication for every data/setup route and same-origin writes',async()=>{
  for(const url of ['/api/microsoft','/api/microsoft/resources','/api/microsoft/context?start=2026-10-17T00:00:00Z&end=2026-10-18T00:00:00Z'])expect((await app.inject({url,headers:basic})).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url:'/api/microsoft/connect',headers:{...headers(),origin:'https://outside.invalid'},payload:{}})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url:'/api/microsoft/connect',headers:headers(),payload:{actor_id:f.admin.user_id}})).statusCode).toBe(400);
  expect((await app.inject({method:'POST',url:'/api/microsoft/connect',headers:headers(undefined,f.admin),payload:{}})).statusCode).toBe(403);
  expect((await app.inject({url:'/api/auth/session',headers:headers()})).json().microsoft_available).toBe(true);
  expect((await app.inject({url:'/api/auth/session',headers:headers(undefined,f.admin)})).json().microsoft_available).toBe(false);
 });
 it('uses a dedicated HttpOnly Lax cookie; callback stages without Nancy cookie then cleans URL',async()=>{
  const result=await app.inject({method:'POST',url:'/api/microsoft/connect',headers:headers(),payload:{}});
  expect(result.statusCode).toBe(200);const cookies=String(result.headers['set-cookie']);expect(cookies).toContain('HttpOnly');expect(cookies).toContain('SameSite=Lax');expect(cookies).toContain('Path=/api/microsoft');
  const browser=binding(result)!;
  const callback=await app.inject({url:'/api/microsoft/callback?state='+f.latest().state+'&code=private-provider-code',headers:{host:basic.host,cookie:'nancy_microsoft_binding='+browser}});
  expect(callback.statusCode).toBe(303);expect(callback.headers.location).toBe('/?microsoft=finish');expect(f.calls.exchange).toBe(0);
  expect(callback.headers['cache-control']).toBe('no-store');expect(callback.headers['referrer-policy']).toBe('no-referrer');
  expect(JSON.stringify(records)).not.toContain('private-provider-code');expect(JSON.stringify(records)).not.toContain(f.latest().state);
  const finish=await app.inject({method:'POST',url:'/api/microsoft/finish',headers:headers(browser),payload:{}});
  expect(finish.statusCode,finish.body).toBe(200);expect(finish.json()).toMatchObject({state:'connected',selected_calendar_ids:[]});expect(f.calls.exchange).toBe(1);
  expect(String(finish.headers['set-cookie'])).toContain('Expires=Thu, 01 Jan 1970');
 });
 it('callback exemption is narrow and does not authorize normal requests or finish',async()=>{
  expect((await app.inject({method:'POST',url:'/api/microsoft/callback',headers:basic,payload:{}})).statusCode).toBe(401);
  expect((await app.inject({url:'/api/microsoft/callback/other',headers:basic})).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url:'/api/microsoft/finish',headers:basic,payload:{}})).statusCode).toBe(401);
  const result=await app.inject({url:'/api/microsoft/callback?state=wrong&code=sensitive',headers:basic});
  expect(result.statusCode).toBe(303);expect(result.headers.location).toBe('/?microsoft=failed');expect(result.body).not.toContain('sensitive');
 });
 it('selection and bounded reads preserve local plan and return freshness with no credential fields',async()=>{
  const resources=await app.inject({url:'/api/microsoft/resources',headers:headers()});expect(resources.statusCode,resources.body).toBe(200);
  const status=(await app.inject({url:'/api/microsoft',headers:headers()})).json();
  const selected=await app.inject({method:'POST',url:'/api/microsoft/selection',headers:headers(),payload:{expected_revision:status.revision,calendar_ids:['calendar-approved'],mail_folder_ids:['folder-approved']}});
  expect(selected.statusCode,selected.body).toBe(200);
  const context=await app.inject({url:'/api/microsoft/context?start=2026-10-17T00:00:00Z&end=2026-10-18T00:00:00Z',headers:headers()});
  expect(context.statusCode,context.body).toBe(200);expect(context.json()).toMatchObject({source:'microsoft',model_disclosure_enabled:false});expect(context.json().calendars).toHaveLength(1);
  expect(context.body).not.toMatch(/accessToken|refreshToken|token_ciphertext|synthetic-access-token/);
  expect((await f.care.today(f.session)).checkin).toBeNull();
 });
 it('logout cancels pending flow and a replacement login cannot finish it',async()=>{
  const browser=await begin();await app.inject({url:'/api/microsoft/callback?state='+f.latest().state+'&code=code',headers:{host:basic.host,cookie:'nancy_microsoft_binding='+browser}});
  const logout=await app.inject({method:'POST',url:'/api/auth/logout',headers:headers(),payload:{}});expect(logout.statusCode).toBe(200);
  f.session=await f.care.login(f.email,f.password);
  const result=await app.inject({method:'POST',url:'/api/microsoft/finish',headers:headers(browser),payload:{}});expect(result.statusCode).toBe(400);
 });
 it('disconnect is a local revocation and removes persisted credential bytes',async()=>{
  const result=await app.inject({method:'POST',url:'/api/microsoft/disconnect',headers:headers(),payload:{}});expect(result.statusCode,result.body).toBe(200);expect(result.json().state).toBe('disconnected');
  const row=(await database.pool.query('select * from companion_local.microsoft_connections where actor_id=$1',[f.session.user_id])).rows[0];expect(row.token_ciphertext).toBeNull();expect(row.selected_calendar_ids).toEqual([]);
  expect((await app.inject({url:'/api/microsoft/resources',headers:headers()})).statusCode).toBe(409);
 });
 it('freshly revoked local grants reject HTTP and erase connector credentials',async()=>{
  const browser=await begin();await app.inject({url:'/api/microsoft/callback?state='+f.latest().state+'&code=code',headers:{host:basic.host,cookie:'nancy_microsoft_binding='+browser}});
  expect((await app.inject({method:'POST',url:'/api/microsoft/finish',headers:headers(browser),payload:{}})).statusCode).toBe(200);
  await database.pool.query('update companion_local.role_grants set revoked_at=$2 where actor_id=$1',[f.session.user_id,now]);
  expect((await app.inject({url:'/api/microsoft/resources',headers:headers()})).statusCode).toBe(401);
  expect((await database.pool.query('select token_ciphertext from companion_local.microsoft_connections where actor_id=$1',[f.session.user_id])).rows[0].token_ciphertext).toBeNull();
 });
});
