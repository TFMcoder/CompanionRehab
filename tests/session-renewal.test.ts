import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {randomBytes} from 'node:crypto';
import {microsoftTestDatabase,createMicrosoftFixture} from './helpers/microsoft-fixture.js';
import {createApp} from '../src/server/app.js';
import {configFromEnv} from '../src/server/config.js';
import {sealSession,openSession} from '../src/server/session.js';
import {SessionRevocations} from '../src/server/revocations.js';
describe('local browser session renewal overlap',()=>{
 let database:Awaited<ReturnType<typeof microsoftTestDatabase>>;
 beforeAll(async()=>{database=await microsoftTestDatabase();});afterAll(async()=>database.close());
 async function fixture(){let now=new Date('2026-10-21T14:00:00Z');const f=await createMicrosoftFixture(database.pool,()=>now);return {...f,advance:(ms:number)=>{now=new Date(now.getTime()+ms);},now:()=>now};}
 it('returns the same rotated credentials to a delayed in-flight cookie only within a fixed ten-second window',async()=>{
  const f=await fixture();f.advance(8*3600000+1);const fresh=await f.care.authorize(f.session);
  expect(await f.care.authorize(f.session)).toEqual(fresh);
  f.advance(9000);expect(await f.care.authorize(f.session)).toEqual(fresh);
  f.advance(1001);await expect(f.care.authorize(f.session)).rejects.toMatchObject({status:401});
  expect(await f.care.authorize(fresh)).toEqual(fresh);
 });
 it('does not coalesce changed credentials or another actor into the legitimate renewal',async()=>{
  const f=await fixture();f.advance(8*3600000+1);
  const good=f.care.authorize(f.session),wrong=f.care.authorize({...f.session,refresh_token:'synthetic-wrong-refresh'});
  expect((await Promise.allSettled([good,wrong])).map(r=>r.status)).toEqual(['fulfilled','rejected']);
  await expect(f.care.authorize({...f.session,user_id:f.admin.user_id})).rejects.toMatchObject({status:401});
 });
 it('preserves each request’s review authority without borrowing or dropping it during overlap',async()=>{
  const f=await fixture(),scope=await f.care.authority(f.session);f.advance(8*3600000+1);
  const [reviewed,plain]=await Promise.all([f.care.authorize({...f.session,reviewed_authority:scope}),f.care.authorize(f.session)]);
  expect(reviewed.reviewed_authority).toEqual(scope);expect(plain.reviewed_authority).toBeUndefined();
  const stale=await f.care.authorize({...f.session,reviewed_authority:{...scope,grant_revision:'synthetic-stale-review'}});
  await expect(f.care.today(stale)).rejects.toMatchObject({code:'scope_changed'});
 });
 it.each(['logout','grant','account'])('freshly rechecks %s even while a previous cookie is in its overlap window',async kind=>{
  const f=await fixture();f.advance(8*3600000+1);const fresh=await f.care.authorize(f.session);
  if(kind==='logout')await f.care.logout(fresh);
  else if(kind==='grant')await database.pool.query('update companion_local.role_grants set revoked_at=$2 where actor_id=$1',[f.session.user_id,f.now()]);
  else await database.pool.query('update companion_local.accounts set disabled_at=$2 where id=$1',[f.session.user_id,f.now()]);
  await expect(f.care.authorize(f.session)).rejects.toMatchObject({status:401});
 });
 it('sets a usable replacement cookie for a late actual HTTP request instead of clearing the login',async()=>{
  const f=await fixture(),config=configFromEnv({PUBLIC_ORIGIN:'http://localhost:8787',DATABASE_URL:'postgresql://localhost/synthetic',SESSION_KEY:randomBytes(32).toString('base64')}),app=await createApp(config,{care:f.care,revocations:new SessionRevocations()});
  const headers={host:'localhost:8787',origin:config.origin,cookie:'nancy_session='+sealSession(f.session,config.sessionKey!)};
  try{f.advance(8*3600000+1);
   const first=await app.inject({url:'/api/auth/session',headers}),late=await app.inject({url:'/api/auth/session',headers});
   expect(first.statusCode).toBe(200);expect(late.statusCode).toBe(200);
   const read=(value:unknown)=>openSession(/nancy_session=([^;]+)/.exec(String(value))?.[1],config.sessionKey!);
   expect(read(first.headers['set-cookie'])).toEqual(read(late.headers['set-cookie']));expect(String(late.headers['set-cookie'])).not.toContain('Max-Age=0');
  }finally{await app.close();}
 });
});
