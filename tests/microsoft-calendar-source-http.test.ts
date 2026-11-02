import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {createApp} from '../src/server/app.js';
import {configFromEnv} from '../src/server/config.js';
import {sealSession} from '../src/server/session.js';
import {SessionRevocations} from '../src/server/revocations.js';
import {MicrosoftService,type MicrosoftOAuth} from '../src/server/microsoft/service.js';
import {createMicrosoftFixture,microsoftTestDatabase} from './helpers/microsoft-fixture.js';

describe('additional calendar HTTP isolation and callback dispatch',()=>{
 let db:Awaited<ReturnType<typeof microsoftTestDatabase>>,f:Awaited<ReturnType<typeof createMicrosoftFixture>>,app:Awaited<ReturnType<typeof createApp>>,config:ReturnType<typeof configFromEnv>,secondary:MicrosoftService;
 const now=new Date('2026-11-01T17:00:00Z'),basic={host:'localhost:8787',origin:'http://localhost:8787'};let secondaryState='';const secondaryExchange=vi.fn();
 const headers=(extra='',session=f.session)=>({...basic,cookie:`nancy_session=${sealSession(session,config.sessionKey!)}${extra?'; '+extra:''}`});
 const cookie=(r:{headers:Record<string,unknown>},name:string)=>new RegExp(name+'=([^;]+)').exec(String(r.headers['set-cookie']??''))?.[1];
 async function beginSecondary(){const r=await app.inject({method:'POST',url:'/api/microsoft/calendar-source/connect',headers:headers(),payload:{}});expect(r.statusCode,r.body).toBe(200);return cookie(r,'nancy_microsoft_calendar_binding')!;}
 beforeAll(async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);db=await microsoftTestDatabase();f=await createMicrosoftFixture(db.pool,()=>now);await f.connect();
  const objectId=randomUUID(),tokens={accessToken:'secondary-synthetic-access',refreshToken:'secondary-synthetic-refresh',expiresAt:new Date(now.getTime()+3600000).toISOString(),scopes:['openid','profile','offline_access','User.Read','Calendars.Read'],identity:{tenantId:f.settings.tenantId,objectId}};
  const oauth:MicrosoftOAuth={beginAuthorization(){secondaryState=randomUUID();return{state:secondaryState,nonce:randomUUID(),codeVerifier:randomUUID(),authorizationUrl:'https://login.microsoftonline.com/'+f.settings.tenantId+'/oauth2/v2.0/authorize?state='+secondaryState,expiresAt:new Date(now.getTime()+600000).toISOString()};},async exchangeCode(){secondaryExchange();return tokens;},async refreshTokens(){return tokens;}};
  secondary=new MicrosoftService(db.pool,{...f.settings,expectedObjectId:objectId,accessMode:'calendar_read',modelUseApproved:true,sourceLabel:'Additional approved calendar'},oauth,{clock:()=>now,graph:()=>({...f.graph,verifyIdentity:async()=>({id:objectId,displayName:'Synthetic additional account',mail:'additional@example.invalid',userPrincipalName:'additional@example.invalid',fetchedAt:now.toISOString()})})});
  config=configFromEnv({PUBLIC_ORIGIN:basic.origin,DATABASE_URL:'postgresql://localhost/synthetic',SESSION_KEY:randomBytes(32).toString('base64')});
  app=await createApp(config,{care:f.care,microsoft:f.service,secondaryMicrosoft:secondary,revocations:new SessionRevocations()});
 });
 afterAll(async()=>{await app?.close();await db?.close();vi.useRealTimers();});
 it('keeps secondary data/setup authenticated and same-origin',async()=>{
  for(const url of ['/api/microsoft/calendar-source','/api/microsoft/calendar-source/resources','/api/microsoft/calendar-source/context?start=2026-11-01T00:00:00Z&end=2026-11-02T00:00:00Z'])expect((await app.inject({url,headers:basic})).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url:'/api/microsoft/calendar-source/connect',headers:{...headers(),origin:'https://outside.invalid'},payload:{}})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url:'/api/microsoft/calendar-source/connect',headers:headers('',f.admin),payload:{}})).statusCode).toBe(403);
 });
 it('routes an exact stored secondary callback using its own cookie and leaves the primary connection intact',async()=>{
  const before=await f.service.status(f.session),browser=await beginSecondary();
  const callback=await app.inject({url:'/api/microsoft/callback?state='+secondaryState+'&code=synthetic-private-code',headers:{host:basic.host,cookie:'nancy_microsoft_calendar_binding='+browser}});
  expect(callback.statusCode).toBe(303);expect(callback.headers.location).toBe('/?microsoft=calendar-finish');expect(secondaryExchange).not.toHaveBeenCalled();
  const finish=await app.inject({method:'POST',url:'/api/microsoft/calendar-source/finish',headers:headers('nancy_microsoft_calendar_binding='+browser),payload:{}});
  expect(finish.statusCode,finish.body).toBe(200);expect(finish.json()).toMatchObject({state:'connected',access_mode:'calendar_read',reviewed_writes_enabled:false});expect(secondaryExchange).toHaveBeenCalledTimes(1);expect(await f.service.status(f.session)).toEqual(before);
 });
 it('rejects mail selection and exposes no secondary action routes',async()=>{
  const status=await secondary.status(f.session);
  const selection=await app.inject({method:'POST',url:'/api/microsoft/calendar-source/selection',headers:headers(),payload:{expected_revision:status.revision,calendar_ids:[],mail_folder_ids:['folder-approved']}});expect(selection.statusCode).toBe(400);
  expect((await app.inject({method:'POST',url:'/api/microsoft/calendar-source/actions/prepare',headers:headers(),payload:{}})).statusCode).toBe(404);
  const resources=await app.inject({url:'/api/microsoft/calendar-source/resources',headers:headers()});expect(resources.statusCode,resources.body).toBe(200);expect(resources.json().mail_folders.items).toEqual([]);
 });
 it('will not choose a callback source from query data or a primary binding cookie',async()=>{
  const browser=await beginSecondary(),calls=secondaryExchange.mock.calls.length;
  const querySource=await app.inject({url:'/api/microsoft/callback?state='+secondaryState+'&code=synthetic&source=primary',headers:{host:basic.host,cookie:'nancy_microsoft_calendar_binding='+browser}});expect(querySource.headers.location).toBe('/?microsoft=failed');
  const wrongCookie=await app.inject({url:'/api/microsoft/callback?state='+secondaryState+'&code=synthetic',headers:{host:basic.host,cookie:'nancy_microsoft_binding='+browser}});expect(wrongCookie.headers.location).toBe('/?microsoft=calendar-failed');expect(secondaryExchange).toHaveBeenCalledTimes(calls);
 });
 it('retains the existing primary callback marker and cookie when both sources exist',async()=>{
  const begun=await app.inject({method:'POST',url:'/api/microsoft/connect',headers:headers(),payload:{}}),browser=cookie(begun,'nancy_microsoft_binding');
  expect(browser).toBeTruthy();expect(String(begun.headers['set-cookie'])).not.toContain('nancy_microsoft_calendar_binding');
  const callback=await app.inject({url:'/api/microsoft/callback?state='+f.latest()!.state+'&code=synthetic',headers:{host:basic.host,cookie:'nancy_microsoft_binding='+browser}});expect(callback.headers.location).toBe('/?microsoft=finish');
  const finished=await app.inject({method:'POST',url:'/api/microsoft/finish',headers:headers('nancy_microsoft_binding='+browser),payload:{}});expect(finished.statusCode,finished.body).toBe(200);
 });
 it('disconnects only the additional source',async()=>{
  const before=await f.service.status(f.session),result=await app.inject({method:'POST',url:'/api/microsoft/calendar-source/disconnect',headers:headers(),payload:{}});
  expect(result.statusCode,result.body).toBe(200);expect(result.json().state).toBe('disconnected');expect(await f.service.status(f.session)).toEqual(before);
 });
});
