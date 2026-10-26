import {describe,expect,it,vi} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {ClientSessionRenewal} from '../src/server/client-session-renewal.js';
import {OwnerSessionRenewal} from '../src/server/owner-session-renewal.js';
import {createApp} from '../src/server/app.js';
import {configFromEnv} from '../src/server/config.js';
import {sealSession,openSession,type Session} from '../src/server/session.js';
import {SessionRevocations} from '../src/server/revocations.js';
import {ApiError} from '../src/server/errors.js';
import type {CareAuthority,CareService} from '../src/server/care-access.js';
import type {LocalSpeech} from '../src/server/local-speech.js';

const origin='https://nancy-client.example.invalid:8443';
function fixture(){
  const owner=randomUUID(),actor=randomUUID(),now=Date.now(),session:Session={user_id:actor,session_id:randomUUID(),access_token:'synthetic-access',refresh_token:'synthetic-refresh',issued_at:now/1000,expires_at:(now+1000)/1000};
  const authority:CareAuthority={actor_id:actor,login_session_id:session.session_id,active_role:'client',client_id:randomUUID(),grant_revision:'synthetic-v1'};
  return{owner,actor,session,authority,renewal:new ClientSessionRenewal(owner,actor,origin,()=>now)};
}

describe('selected-client credential propagation',()=>{
  it('requires distinct UUID actors and the plain canonical HTTPS care origin',()=>{
    const owner=randomUUID(),actor=randomUUID();expect(()=>new ClientSessionRenewal(owner,actor,origin)).not.toThrow();
    for(const bad of ['http://nancy-client.example.invalid:8443','https://nancy-client.example.invalid:10000',origin+'/',origin+'/path',origin+'?q=x',origin+'#fragment','https://user:password@nancy-client.example.invalid:8443','not a URL'])
      expect(()=>new ClientSessionRenewal(owner,actor,bad)).toThrow();
    for(const [a,b] of [[owner,owner],['owner',actor],[owner,'client'],['',actor]])expect(()=>new ClientSessionRenewal(a!,b!,origin)).toThrow();
  });
  it('handles only the selected actor and rejects another actor before calling care',async()=>{
    const f=fixture(),other={...f.session,user_id:f.owner},authorize=vi.fn(),authority=vi.fn();
    expect(f.renewal.handles(f.session)).toBe(true);expect(f.renewal.handles(other)).toBe(false);
    expect(()=>f.renewal.track(other)).toThrow();await expect(f.renewal.authorize({authorize},other)).rejects.toMatchObject({status:403});
    await expect(f.renewal.authorizeConversation({authorize,authority},other)).rejects.toMatchObject({status:403});expect(authorize).not.toHaveBeenCalled();expect(authority).not.toHaveBeenCalled();
  });
  it('propagates renewed credentials only to the same tracked login and preserves request-local reviews',async()=>{
    const f=fixture(),first={...f.session,reviewed_authority:f.authority},peer={...f.session,reviewed_authority:{...f.authority,grant_revision:'synthetic-stale'}},otherLogin={...f.session,session_id:randomUUID()};
    const stops=[f.renewal.track(first),f.renewal.track(peer),f.renewal.track(otherLogin)];
    const fresh={...f.session,access_token:'synthetic-new-access',refresh_token:'synthetic-new-refresh',expires_at:f.session.expires_at+3600};
    try{
      expect(await f.renewal.authorize({authorize:async()=>fresh},first)).toBe(first);
      expect(peer.access_token).toBe(fresh.access_token);expect(peer.refresh_token).toBe(fresh.refresh_token);expect(otherLogin.access_token).toBe(f.session.access_token);
      expect(first.reviewed_authority).toEqual(f.authority);expect(peer.reviewed_authority.grant_revision).toBe('synthetic-stale');
    }finally{for(const stop of stops){stop();stop();}}
  });
  it('never accepts a different login returned by care or bypasses an actual revocation',async()=>{
    const f=fixture();
    await expect(f.renewal.authorize({authorize:async()=>({...f.session,session_id:randomUUID()})},f.session)).rejects.toMatchObject({code:'scope_changed'});
    const denied=vi.fn(async()=>{throw new ApiError(401,'unauthorized','Synthetic revocation');});
    await expect(f.renewal.authorize({authorize:denied},f.session)).rejects.toMatchObject({status:401});expect(denied).toHaveBeenCalledOnce();expect(f.session.access_token).toBe('synthetic-access');
  });
  it('checks detached care authority without rotating a browser credential or requiring provider access',async()=>{
    const f=fixture(),authorize=vi.fn(),authority=vi.fn(async()=>f.authority);
    expect(await f.renewal.authorizeConversation({authorize,authority},f.session)).toBe(f.session);expect(authority).toHaveBeenCalledWith(f.session);expect(authorize).not.toHaveBeenCalled();
    authority.mockRejectedValueOnce(new ApiError(403,'scope_changed','Synthetic grant change'));await expect(f.renewal.authorizeConversation({authorize,authority},f.session)).rejects.toMatchObject({code:'scope_changed'});
  });
  it.each([false,true])('stops detached work at the absolute login lifetime, even with unexpired access (remember=%s)',async remember=>{
    const f=fixture(),deadline=(f.session.issued_at+(remember?30:7)*86400)*1000,renewal=new ClientSessionRenewal(f.owner,f.actor,origin,()=>deadline),authority=vi.fn(),authorize=vi.fn();
    await expect(renewal.authorizeConversation({authorize,authority},{...f.session,remember_device:remember,expires_at:deadline/1000+3600})).rejects.toMatchObject({status:401});
    expect(authority).not.toHaveBeenCalled();expect(authorize).not.toHaveBeenCalled();
  });
  it('delivers a replacement cookie after selected-client work, leaving other actors on their ordinary path',async()=>{
    const f=fixture(),other={...f.session,user_id:f.owner,session_id:randomUUID()},config=configFromEnv({PUBLIC_ORIGIN:origin,PORT:'8787',DATABASE_URL:'postgresql://synthetic.invalid/unused',SESSION_KEY:randomBytes(32).toString('base64'),NANCY_PLAN_USER_ID:f.owner});
    const calls=new Map<string,number>();let rotate=false;
    const authorize=vi.fn(async(session:Session)=>{calls.set(session.user_id,(calls.get(session.user_id)??0)+1);return rotate?{...session,access_token:'synthetic-new-access',refresh_token:'synthetic-new-refresh'}:session;});
    const care={authorize,authority:async(session:Session)=>({...f.authority,actor_id:session.user_id,login_session_id:session.session_id}),today:async()=>{rotate=true;return{synthetic:true};},close:async()=>{}} as unknown as CareService;
    const app=await createApp(config,{care,microsoft:null,clientSessionRenewal:f.renewal,revocations:new SessionRevocations()});
    const headers=(session:Session)=>({host:new URL(origin).host,origin,cookie:'nancy_session='+sealSession(session,config.sessionKey!)});
    try{
      // Today already reauthorizes after its care read. Selected maintenance
      // adds the final credential propagation check before the HTTP response.
      const response=await app.inject({url:'/api/today',headers:headers(f.session)});expect(response.statusCode).toBe(200);expect(calls.get(f.actor)).toBe(3);
      const renewed=openSession(/nancy_session=([^;]+)/.exec(String(response.headers['set-cookie']))?.[1],config.sessionKey!);expect(renewed).toMatchObject({user_id:f.actor,session_id:f.session.session_id,access_token:'synthetic-new-access'});
      rotate=false;const ordinary=await app.inject({url:'/api/today',headers:headers(other)});expect(ordinary.statusCode).toBe(200);expect(calls.get(f.owner)).toBe(2);expect(ordinary.headers['set-cookie']).toBeUndefined();
    }finally{await app.close();}
  });
  it('refuses runtime activation with a different owner, origin, port, cookie or unavailable care authority',async()=>{
    const f=fixture(),config=configFromEnv({PUBLIC_ORIGIN:origin,PORT:'8787',DATABASE_URL:'postgresql://synthetic.invalid/unused',SESSION_KEY:randomBytes(32).toString('base64'),NANCY_PLAN_USER_ID:f.owner}),care={authorize:async(s:Session)=>s,authority:async()=>f.authority} as unknown as CareService;
    for(const change of [{planUserId:randomUUID()},{origin:'https://another.example.invalid:8443'},{port:8788},{sessionCookieName:'nancy_test_session' as const}])
      await expect(createApp({...config,...change},{care,microsoft:null,clientSessionRenewal:f.renewal})).rejects.toThrow('exact selected care runtime');
    await expect(createApp(config,{care:{...care,authority:undefined},microsoft:null,clientSessionRenewal:f.renewal})).rejects.toThrow('exact selected care runtime');
    await expect(createApp(config,{care,microsoft:null,clientSessionRenewal:f.renewal,ownerSessionRenewal:new OwnerSessionRenewal(f.owner)})).rejects.toThrow('only one');
    const speech={} as LocalSpeech;
    await expect(createApp(config,{care,microsoft:null,clientSpeech:{actorId:f.actor,speech}})).rejects.toThrow();
    await expect(createApp(config,{care,microsoft:null,clientSessionRenewal:f.renewal,clientSpeech:{actorId:f.owner,speech}})).rejects.toThrow();
  });
});
