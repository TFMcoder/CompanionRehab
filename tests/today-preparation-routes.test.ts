import {describe,it,expect,vi} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {createApp} from '../src/server/app.js';
import {configFromEnv} from '../src/server/config.js';
import {SessionRevocations} from '../src/server/revocations.js';
import {sealSession,type Session} from '../src/server/session.js';
import type {CareService,CareAuthority} from '../src/server/care-access.js';
import type {LocalFeatures} from '../src/server/local-features.js';
import {ApiError} from '../src/server/errors.js';

const config=configFromEnv({PUBLIC_ORIGIN:'http://localhost:8787',DATABASE_URL:'postgresql://local.invalid/synthetic',SESSION_KEY:randomBytes(32).toString('base64')});
const session:Session={user_id:randomUUID(),session_id:randomUUID(),access_token:'synthetic',refresh_token:'synthetic',issued_at:Date.now()/1000,expires_at:Date.now()/1000+3600};
const headers={host:'localhost:8787',origin:config.origin,cookie:`nancy_session=${sealSession(session,config.sessionKey!)}`};
describe('quiet preparation HTTP scope boundary',()=>{
 const setup=async()=>{
  let scope:CareAuthority={actor_id:session.user_id,login_session_id:session.session_id,active_role:'client',client_id:randomUUID(),grant_revision:'initial'};
  const care={authorize:vi.fn(async s=>s),authority:vi.fn(async()=>({...scope})),today:vi.fn(async()=>({role:'client',profile:{id:scope.client_id,display_name:'Synthetic private name',time_zone:'America/Toronto',preferences:'',revision:1},local_date:'2026-10-14',tasks:[],meal_options:[],checkin:null})),close:vi.fn()} as unknown as CareService;
  const prepare=vi.fn(async()=>null),features={day:{prepare}} as unknown as LocalFeatures;
  const app=await createApp(config,{care,features,revocations:new SessionRevocations()});return {app,prepare,care,change:()=>{scope={...scope,client_id:randomUUID(),grant_revision:'new'};}};
 };
 it('keeps a nonauthorization preparation failure from blocking the fresh day',async()=>{
  const f=await setup();f.prepare.mockRejectedValueOnce(new Error('Synthetic optional preparation failure'));
  try{const r=await f.app.inject({url:'/api/today',headers});expect(r.statusCode).toBe(200);expect(f.care.authority).toHaveBeenCalledTimes(2);}finally{await f.app.close();}
 });
 it('does not return earlier client data if a still-valid scope changes during preparation',async()=>{
  const f=await setup();f.prepare.mockImplementationOnce(async()=>{f.change();return null;});
  try{const r=await f.app.inject({url:'/api/today',headers});expect(r.statusCode).toBe(403);expect(r.json()).toMatchObject({error:{code:'scope_changed'}});expect(r.body).not.toContain('Synthetic private name');}finally{await f.app.close();}
 });
 it('preserves preparation authorization failures even if later authorization might succeed',async()=>{
  const f=await setup();f.prepare.mockRejectedValueOnce(new ApiError(403,'scope_changed','Your access changed.'));
  try{const r=await f.app.inject({url:'/api/today',headers});expect(r.statusCode).toBe(403);expect(r.body).not.toContain('Synthetic private name');}finally{await f.app.close();}
 });
});
