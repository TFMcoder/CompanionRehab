import {describe,it,expect,vi} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {createApp} from '../src/server/app.js';
import {configFromEnv} from '../src/server/config.js';
import {SessionRevocations} from '../src/server/revocations.js';
import {sealSession,type Session} from '../src/server/session.js';
import type {CareService} from '../src/server/care-access.js';

const config=configFromEnv({PUBLIC_ORIGIN:'http://localhost:8787',DATABASE_URL:'postgresql://local.invalid/synthetic',SESSION_KEY:randomBytes(32).toString('base64')});
const session:Session={user_id:randomUUID(),session_id:randomUUID(),access_token:'synthetic',refresh_token:'synthetic',issued_at:Date.now()/1000,expires_at:Date.now()/1000+3600};
const headers={host:'localhost:8787',origin:config.origin,cookie:`nancy_session=${sealSession(session,config.sessionKey!)}`};
const command={type:'save_preference',idempotency_key:randomUUID(),confirmed:true,preference_id:null,expected_revision:0,category:'meals',text:'Synthetic oatmeal preference',duration:'lasting',local_date:null};
describe('preference HTTP capabilities',()=>{
 it('requires sign-in, origin and a confirmed strict command without caller-selected ownership',async()=>{
  const care={authorize:vi.fn(async s=>s),preferences:vi.fn(async()=>({items:[],pending:null})),preferenceCommand:vi.fn(async()=>({command_id:command.idempotency_key})),close:vi.fn()} as unknown as CareService;
  const app=await createApp(config,{care,revocations:new SessionRevocations()});
  try{
   expect((await app.inject({url:'/api/preferences',headers:{host:headers.host}})).statusCode).toBe(401);
   expect((await app.inject({url:'/api/preferences',headers})).statusCode).toBe(200);
   for(const payload of [{...command,confirmed:false},{...command,participant_id:randomUUID()},{...command,duration:'today',local_date:null}]){
    expect((await app.inject({method:'POST',url:'/api/preferences/commands',headers,payload})).statusCode).toBe(400);
   }
   expect((await app.inject({method:'POST',url:'/api/preferences/commands',headers:{...headers,origin:'https://other.invalid'},payload:command})).statusCode).toBe(403);
   expect(care.preferenceCommand).not.toHaveBeenCalled();
   expect((await app.inject({method:'POST',url:'/api/preferences/commands',headers,payload:command})).statusCode).toBe(200);
   expect(care.preferenceCommand).toHaveBeenCalledWith(session,command);
  }finally{await app.close();}
 });
 it('binds recovery keys to the signed-in actor and rejects extra recovery fields',async()=>{
  const care={authorize:vi.fn(async s=>s),preferenceReceipt:vi.fn(async()=>null),retryPreferenceCommand:vi.fn(async()=>({command_id:command.idempotency_key})),acknowledgePreferenceCommand:vi.fn(async()=>{}),discardPreferenceCommand:vi.fn(async()=>false),close:vi.fn()} as unknown as CareService;
  const app=await createApp(config,{care,revocations:new SessionRevocations()});
  try{
   expect((await app.inject({url:'/api/preferences/receipts/not-a-key',headers})).statusCode).toBe(400);
   expect((await app.inject({url:`/api/preferences/receipts/${command.idempotency_key}`,headers})).statusCode).toBe(404);
   for(const [route,fn] of [['retry',care.retryPreferenceCommand],['ack',care.acknowledgePreferenceCommand],['discard',care.discardPreferenceCommand]] as const){
    expect((await app.inject({method:'POST',url:'/api/preferences/'+route,headers,payload:{key:command.idempotency_key,actor_id:randomUUID()}})).statusCode).toBe(400);
    expect(fn).not.toHaveBeenCalled();
    const result=await app.inject({method:'POST',url:'/api/preferences/'+route,headers,payload:{key:command.idempotency_key}});
    expect(result.statusCode).toBe(200);expect(fn).toHaveBeenCalledWith(session,command.idempotency_key);
    if(route==='discard')expect(result.json()).toEqual({discarded:false});
   }
  }finally{await app.close();}
 });
});
