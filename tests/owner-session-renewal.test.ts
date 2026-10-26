import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {microsoftTestDatabase,createMicrosoftFixture} from './helpers/microsoft-fixture.js';
import {createApp} from '../src/server/app.js';
import {ConversationService} from '../src/server/conversation.js';
import {configFromEnv} from '../src/server/config.js';
import {sealSession,openSession,type Session} from '../src/server/session.js';
import {SessionRevocations} from '../src/server/revocations.js';
import {OwnerSessionRenewal} from '../src/server/owner-session-renewal.js';
import type {CareService} from '../src/server/care-access.js';
import type {Reasoner} from '../src/server/plan-reasoner.js';
import {reasoningCandidates} from '../src/server/chatgpt-plan/inference.js';

describe('owner-only renewal through an in-flight conversation',()=>{
 let database:Awaited<ReturnType<typeof microsoftTestDatabase>>;
 const apps:Array<Awaited<ReturnType<typeof createApp>>>=[];
 beforeAll(async()=>{database=await microsoftTestDatabase();});
 afterAll(async()=>database.close());
 beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-25T10:00:00Z'));});
 afterEach(async()=>{for(const app of apps.splice(0))await app.close();vi.useRealTimers();});
 async function fixture(enabled=true,backgroundMeals=false){
  let now=new Date();const started=now.getTime();
  const f=await createMicrosoftFixture(database.pool,()=>now);
  const advanceTo=(elapsed:number)=>{now=new Date(started+elapsed);vi.setSystemTime(now);};
  const facade:CareService={login:f.care.login.bind(f.care),authorize:f.care.authorize.bind(f.care),authority:f.care.authority.bind(f.care),today:f.care.today.bind(f.care),command:f.care.command.bind(f.care),logout:f.care.logout.bind(f.care),setup:f.care.setup.bind(f.care),receipt:f.care.receipt.bind(f.care),close:async()=>{}};
  let modelWork=async()=>{},asrWork=async()=>{};
  const text=backgroundMeals?JSON.stringify({breakfast:'B02',lunch:'L03',dinner:'D01'}):'A synthetic useful reply.';
  const model=vi.fn(async()=>{await modelWork();return{completed:true,model:'gpt-6-sol',effort:backgroundMeals?'low':'high',text,output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]};});
  const reasoner={bind:async(scope:Record<string,unknown>)=>({...scope,route_id:'chatgpt_plan_owner_practice',account_binding_id:'synthetic-owner-account',qualification:'owner_practice'}),respond:model} as unknown as Reasoner;
  const renewal=enabled?new OwnerSessionRenewal(f.session.user_id):undefined;
  // The login is almost eight hours old, but this conversation starts now.
  // Advancing browser wall time after opening would legitimately expire its
  // separate twenty-minute conversation lifetime before the renewal scenario.
  advanceTo(8*3600000-1000);
  const conversation=new ConversationService(facade,reasoner,f.session.user_id,()=>now,backgroundMeals?async()=>Buffer.from('synthetic Heart bytes'):undefined,
    undefined,undefined,undefined,undefined,undefined,undefined,undefined,backgroundMeals?reasoningCandidates['sol-low']:undefined,backgroundMeals,backgroundMeals?72:undefined,
    backgroundMeals,backgroundMeals,backgroundMeals,undefined,undefined,undefined,undefined,undefined,undefined,undefined,renewal);
  const opening=await conversation.start(f.session);
  const config={...configFromEnv({PUBLIC_ORIGIN:'https://nancy-owner.example.invalid:10000',PORT:'8788',DATABASE_URL:'postgresql://synthetic.invalid/unused',SESSION_KEY:randomBytes(32).toString('base64'),VOICE_TRANSPORT:'local',NANCY_PLAN_USER_ID:f.session.user_id,NANCY_SYNTHETIC:'1'}),sessionCookieName:'nancy_test_session' as const};
  const transcribe=vi.fn(async()=>{await asrWork();return'Tell me something useful.';});
  const speech={readiness:()=>({kokoro:'ready',asr:'ready'}),transcribe,close:async()=>{}};
  const app=await createApp(config,{care:facade,conversation,speech:speech as any,microsoft:null,revocations:new SessionRevocations(),ownerSessionRenewal:renewal});apps.push(app);
  const cookie=(session:Session)=>'nancy_test_session='+sealSession(session,config.sessionKey!);
  const headers=(session=f.session)=>({host:new URL(config.origin).host,origin:config.origin,cookie:cookie(session)});
  const readCookie=(response:{headers:Record<string,unknown>})=>openSession(/nancy_test_session=([^;]+)/.exec(String(response.headers['set-cookie']))?.[1],config.sessionKey!);
  const turn=(audio=false,extra:Record<string,string>={})=>app.inject({method:'POST',url:'/api/conversation/'+opening.session_id+(audio?'/audio':'/turn'),headers:{...headers(),...extra},payload:{turn_id:randomUUID(),...(audio?{wav:Buffer.alloc(64).toString('base64')}:{text:'Tell me something useful.'})}});
  return{...f,app,conversation,facade,renewal,config,advanceTo,headers,readCookie,turn,model,transcribe,setModel:(work:()=>Promise<void>)=>{modelWork=work;},setAsr:(work:()=>Promise<void>)=>{asrWork=work;}};
 }
 const expiry=8*3600000;
 it('keeps the ordinary runtime behavior unchanged when maintenance is absent',async()=>{
  const f=await fixture(false);f.advanceTo(expiry-1000);f.setModel(async()=>f.advanceTo(expiry+1000));
  const response=await f.turn();expect(response.statusCode).toBe(401);expect(String(response.headers['set-cookie'])).toContain('Max-Age=0');
 });
 it.each(['model','asr'] as const)('returns a usable replacement cookie when %s work crosses expiry',async phase=>{
  const f=await fixture();f.advanceTo(expiry-1000);
  (phase==='model'?f.setModel:f.setAsr)(async()=>f.advanceTo(expiry+1000));
  const response=await f.turn(phase==='asr');expect(response.statusCode).toBe(200);expect(response.json().text).toBe('A synthetic useful reply.');
  const renewed=f.readCookie(response)!;expect(renewed).not.toBeNull();expect(renewed.access_token).not.toBe(f.session.access_token);expect(renewed.refresh_token).not.toBe(f.session.refresh_token);
  expect(await f.care.authority(renewed)).toMatchObject({actor_id:f.session.user_id,login_session_id:f.session.session_id});
  expect((await f.app.inject({url:'/api/today',headers:f.headers(renewed)})).statusCode).toBe(200);
  expect(String(response.headers['set-cookie'])).not.toContain('Max-Age=0');expect(renewed.reviewed_authority).toBeUndefined();
 });
 it('updates already-authorized peer requests without accepting new stale cookies beyond overlap',async()=>{
  const f=await fixture();let started!:()=>void,finish!:()=>void;
  const entered=new Promise<void>(resolve=>{started=resolve;}),released=new Promise<void>(resolve=>{finish=resolve;});
  f.setModel(async()=>{started();await released;});f.advanceTo(expiry-1000);
  const pending=Promise.resolve(f.turn());await entered;
  f.advanceTo(expiry+1000);const peer=await f.app.inject({url:'/api/today',headers:f.headers()});expect(peer.statusCode).toBe(200);
  const peerCookie=f.readCookie(peer)!;expect(peerCookie.access_token).not.toBe(f.session.access_token);
  f.advanceTo(expiry+12000);
  expect((await f.app.inject({url:'/api/today',headers:f.headers()})).statusCode).toBe(401);
  finish();const response=await pending;expect(response.statusCode).toBe(200);expect(f.readCookie(response)).toEqual(peerCookie);
 });
 it.each(['logout','grant','account'] as const)('still rejects %s revoked during reasoning and clears the login',async kind=>{
  const f=await fixture();f.advanceTo(expiry-1000);f.setModel(async()=>{
    f.advanceTo(expiry+1000);
    if(kind==='logout')await f.care.logout(f.session);
    else if(kind==='grant')await database.pool.query('update companion_local.role_grants set revoked_at=$2 where actor_id=$1',[f.session.user_id,new Date()]);
    else await database.pool.query('update companion_local.accounts set disabled_at=$2 where id=$1',[f.session.user_id,new Date()]);
  });
  const response=await f.turn();expect(response.statusCode).toBe(401);expect(String(response.headers['set-cookie'])).toContain('Max-Age=0');
 });
 it('does not carry a reviewed grant across a changed authority revision',async()=>{
  const f=await fixture();const metadata=await f.app.inject({url:'/api/auth/session',headers:f.headers()});expect(metadata.statusCode).toBe(200);
  f.advanceTo(expiry-1000);f.setModel(async()=>{f.advanceTo(expiry+1000);await database.pool.query('update companion_local.role_grants set granted_at=$2 where actor_id=$1',[f.session.user_id,new Date()]);});
  const response=await f.turn(false,{'x-nancy-scope':metadata.json().scope_key});expect(response.statusCode).toBe(403);expect(response.json().error.code).toBe('scope_changed');
 });
 it('refuses activation outside the exact synthetic owner origin, port, cookie and actor',async()=>{
  const f=await fixture();
  for(const change of [{synthetic:false},{sessionCookieName:'nancy_session' as const},{port:8787},{origin:'http://localhost:8788'},{origin:'https://nancy-owner.example.invalid:8443'},{planUserId:randomUUID()}])
    await expect(createApp({...f.config,...change},{care:f.facade,microsoft:null,revocations:new SessionRevocations(),ownerSessionRenewal:f.renewal})).rejects.toThrow('isolated synthetic owner runtime');
  await expect(createApp(f.config,{care:{...f.facade,authority:undefined},microsoft:null,revocations:new SessionRevocations(),ownerSessionRenewal:f.renewal})).rejects.toThrow('isolated synthetic owner runtime');
 });
 it('keeps each active request’s reviewed authority while publishing only validated token fields',async()=>{
  const f=await fixture(),authority=await f.care.authority(f.session);
  const reviewed={...f.session,reviewed_authority:authority},stale={...f.session,reviewed_authority:{...authority,grant_revision:'synthetic-stale'}};
  const stopA=f.renewal!.track(reviewed),stopB=f.renewal!.track(stale);
  try{
    f.advanceTo(expiry+1);await f.renewal!.authorize(f.facade,{...f.session});
    expect(reviewed.access_token).toBe(stale.access_token);expect(reviewed.access_token).not.toBe(f.session.access_token);
    expect(reviewed.reviewed_authority).toEqual(authority);expect(stale.reviewed_authority.grant_revision).toBe('synthetic-stale');
    await expect(f.care.authority(stale)).rejects.toMatchObject({code:'scope_changed'});
  }finally{stopA();stopA();stopB();}
 });
 it.each([false,true])('rechecks only a known tracked-peer renewal race and still enforces revocation: %s',async revoked=>{
  const f=await fixture(),first={...f.session},peer={...f.session};
  const releaseFirst=f.renewal!.track(first),releasePeer=f.renewal!.track(peer);
  let entered!:()=>void,finish!:()=>void,calls=0;
  const started=new Promise<void>(resolve=>{entered=resolve;}),finished=new Promise<void>(resolve=>{finish=resolve;});
  const delayed={authorize:async(session:Session)=>{
    calls++;if(calls===1){const sent={...session};entered();await finished;return f.care.authorize(sent);}
    return f.care.authorize(session);
  }};
  try{
    f.advanceTo(expiry+1);const pending=f.renewal!.authorize(delayed,first);const settled=pending.then(value=>({value}),error=>({error}));await started;
    const fresh=await f.renewal!.authorize(f.facade,peer);expect(first.access_token).toBe(fresh.access_token);
    f.advanceTo(expiry+12000);
    if(revoked)await database.pool.query('update companion_local.role_grants set revoked_at=$2 where actor_id=$1',[f.session.user_id,new Date()]);
    finish();const result=await settled;expect(calls).toBe(2);
    if(revoked)expect(result).toMatchObject({error:{status:401}});else expect(result).toMatchObject({value:{access_token:fresh.access_token}});
  }finally{finish();releaseFirst();releasePeer();}
 });
 it('does not strand the browser cookie when detached meal preparation crosses expiry after its response',async()=>{
  const f=await fixture(true,true);let entered!:()=>void,finish!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;}),released=new Promise<void>(resolve=>{finish=resolve;});
  f.setModel(async()=>{entered();await released;});
  const response=await f.app.inject({url:'/api/auth/session',headers:f.headers()});expect(response.statusCode).toBe(200);expect(response.headers['set-cookie']).toBeUndefined();
  await started;const job=f.conversation.prepareMeals(f.session);
  f.advanceTo(expiry+1000);finish();await job;
  const row=(await database.pool.query('select access_hash from companion_local.sessions where id=$1',[f.session.session_id])).rows[0];
  const browserTokenPreserved=Buffer.from(row.access_hash).equals(createHash('sha256').update(f.session.access_token).digest());
  f.advanceTo(expiry+12000);const next=await f.app.inject({url:'/api/today',headers:f.headers()});expect(next.statusCode).toBe(200);
  expect(browserTokenPreserved).toBe(true);
  expect(f.readCookie(next)?.access_token).not.toBe(f.session.access_token);expect(String(next.headers['set-cookie'])).not.toContain('Max-Age=0');
 });
 it('returns successful intentional logout with a cleared cookie, then rejects later access',async()=>{
  const f=await fixture();const response=await f.app.inject({method:'POST',url:'/api/auth/logout',headers:f.headers(),payload:{}});
  expect(response.statusCode).toBe(200);expect(response.json()).toEqual({ok:true});expect(String(response.headers['set-cookie'])).toContain('Max-Age=0');
  expect((await f.app.inject({url:'/api/today',headers:f.headers()})).statusCode).toBe(401);await expect(f.care.authorize(f.session)).rejects.toMatchObject({status:401});
 });
 it.each([false,true])('stops detached work at the absolute login deadline despite future access expiry (remember=%s)',async remember=>{
  const f=await fixture(),authority=await f.care.authority(f.session);
  const deadline=(f.session.issued_at+(remember?30:7)*86400)*1000;
  let clock=deadline-1;
  const session={...f.session,remember_device:remember,expires_at:(deadline+3600000)/1000};
  const authorize=vi.fn(async()=>session),readAuthority=vi.fn(async()=>authority);
  const care={...f.facade,authorize,authority:readAuthority};
  const renewal=new OwnerSessionRenewal(f.session.user_id,()=>clock);
  const reasoner={bind:vi.fn(),respond:vi.fn()} as unknown as Reasoner;
  const service=new ConversationService(care,reasoner,f.session.user_id,()=>new Date(clock),undefined,
    undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,
    undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,renewal);
  try{
    expect(await renewal.authorizeConversation(care,session)).toBe(session);expect(readAuthority).toHaveBeenCalledOnce();readAuthority.mockClear();
    for(const offset of [0,1]){
      clock=deadline+offset;
      await expect(renewal.authorizeConversation(care,session)).rejects.toMatchObject({status:401});
      await expect(service.start(session)).rejects.toMatchObject({status:401});
      expect(readAuthority).not.toHaveBeenCalled();expect(reasoner.bind).not.toHaveBeenCalled();expect(reasoner.respond).not.toHaveBeenCalled();
    }
    expect(authorize).not.toHaveBeenCalled();expect(session.access_token).toBe(f.session.access_token);expect(session.refresh_token).toBe(f.session.refresh_token);
  }finally{service.close();}
 });
});
