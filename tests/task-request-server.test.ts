import { describe, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../src/server/app.js';
import { configFromEnv } from '../src/server/config.js';
import { sealSession, type Session } from '../src/server/session.js';
import { SessionRevocations } from '../src/server/revocations.js';
import type { CareService, CareAuthority } from '../src/server/care-access.js';
import type { TaskRequestService } from '../src/server/task-requests.js';
import type { ConversationService } from '../src/server/conversation.js';
import type { LocalSpeech } from '../src/server/local-speech.js';

function fixture() {
  const session:Session={user_id:randomUUID(),session_id:randomUUID(),access_token:'synthetic-only',refresh_token:'synthetic-only-refresh',issued_at:Date.now()/1000,expires_at:Date.now()/1000+3600};
  const config=configFromEnv({PUBLIC_ORIGIN:'http://localhost:8787',DATABASE_URL:'postgresql://localhost/synthetic',SESSION_KEY:randomBytes(32).toString('base64'),NANCY_PLAN_USER_ID:session.user_id});
  let authority:CareAuthority={actor_id:session.user_id,login_session_id:session.session_id,active_role:'family_friend',client_id:randomUUID(),grant_revision:'one'};
  const care={authorize:vi.fn(async(s:Session)=>s),authority:vi.fn(async()=>authority),today:vi.fn(),close:vi.fn()} as unknown as CareService;
  const requests={workspace:vi.fn(async()=>({role:authority.active_role})),review:vi.fn(async()=>({warnings:[]})),command:vi.fn(async()=>({result:'submit_request'})),receipt:vi.fn(async()=>null),authorityRevision:vi.fn(async()=>'access-one')} as unknown as Pick<TaskRequestService,'workspace'|'review'|'command'|'receipt'|'authorityRevision'>;
  const headers={host:'localhost:8787',origin:config.origin,cookie:`nancy_session=${sealSession(session,config.sessionKey!)}`};
  const draft={task_name:'Synthetic pickup',priority:'low',requested_date:'2026-10-08',requested_time:'12:00',participant_time_zone:'America/Toronto',estimated_duration_minutes:10,travel_minutes:0,notes:''};
  return {session,config,care,requests,headers,draft,setAuthority:(patch:Partial<CareAuthority>)=>{authority={...authority,...patch};}};
}

describe('request HTTP boundaries',()=>{
  it('authenticates and validates every request route without opening client-only today or inference',async()=>{
    const f=fixture();const app=await createApp(f.config,{care:f.care,taskRequests:f.requests,revocations:new SessionRevocations()});
    try {
      expect((await app.inject({url:'/api/task-requests',headers:{host:f.headers.host}})).statusCode).toBe(401);
      expect((await app.inject({url:'/api/task-requests',headers:f.headers})).json()).toEqual({role:'family_friend'});
      expect((await app.inject({method:'POST',url:'/api/task-requests/review',headers:{...f.headers,origin:'https://unrelated.invalid'},payload:f.draft})).statusCode).toBe(403);
      expect((await app.inject({method:'POST',url:'/api/task-requests/review',headers:f.headers,payload:{...f.draft,actor_id:randomUUID()}})).statusCode).toBe(400);
      expect((await app.inject({method:'POST',url:'/api/task-requests/review',headers:f.headers,payload:f.draft})).statusCode).toBe(200);
      const command={type:'submit_request',idempotency_key:randomUUID(),draft:f.draft,review_token:'a'.repeat(64),confirmed:true};
      expect((await app.inject({method:'POST',url:'/api/task-requests/commands',headers:f.headers,payload:{...command,confirmed:false}})).statusCode).toBe(400);
      expect((await app.inject({method:'POST',url:'/api/task-requests/commands',headers:f.headers,payload:command})).statusCode).toBe(200);
      expect(f.requests.command).toHaveBeenCalledWith(f.session,command);
      const unknown=await app.inject({url:`/api/task-requests/receipts/${command.idempotency_key}`,headers:f.headers});expect(unknown.statusCode).toBe(404);expect(unknown.body).toContain('unconfirmed');
      expect((await app.inject({url:'/api/task-requests/receipts/not-a-uuid',headers:f.headers})).statusCode).toBe(400);
      expect(f.care.today).not.toHaveBeenCalled();
    }finally{await app.close();}
  });
  it('returns opaque server-derived scope and excludes credentials and another account voice entitlement',async()=>{
    const f=fixture();const conversation={close:vi.fn()} as unknown as ConversationService;
    const speech={readiness:()=>({kokoro:'ready',asr:'ready'}),close:vi.fn()} as unknown as LocalSpeech;
    const app=await createApp(f.config,{care:f.care,taskRequests:f.requests,conversation,speech,revocations:new SessionRevocations()});
    try {
      const first=(await app.inject({url:'/api/auth/session',headers:f.headers})).json();
      expect(first).toMatchObject({authenticated:true,role:'family_friend',actor_id:f.session.user_id,voice_eligible:true,task_requests_available:true});
      expect(first.scope_key).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(first)).not.toContain('synthetic-only');
      vi.mocked(f.requests.authorityRevision).mockResolvedValueOnce('access-two');
      expect((await app.inject({url:'/api/auth/session',headers:f.headers})).json().scope_key).not.toBe(first.scope_key);
      f.setAuthority({active_role:'clinician'});
      expect((await app.inject({url:'/api/auth/session',headers:f.headers})).json()).toMatchObject({voice_eligible:false,role:'clinician'});
      f.setAuthority({active_role:'family_friend'});
      const different={...f.session,user_id:randomUUID()};f.setAuthority({actor_id:different.user_id});
      expect((await app.inject({url:'/api/auth/session',headers:{...f.headers,cookie:`nancy_session=${sealSession(different,f.config.sessionKey!)}`}})).json().voice_eligible).toBe(false);
      expect(f.care.today).not.toHaveBeenCalled();
    }finally{await app.close();}
  });
  it('does not expose request operations through a care adapter without the service',async()=>{
    const f=fixture();const app=await createApp(f.config,{care:f.care,revocations:new SessionRevocations()});
    try {expect((await app.inject({url:'/api/task-requests',headers:f.headers})).statusCode).toBe(503);}
    finally{await app.close();}
  });
});
