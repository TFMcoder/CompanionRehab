import {describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createPlanRequest,reasoningCandidates,requestSolHigh,type CompletedTurn} from '../src/server/chatgpt-plan/inference.js';
import {ConversationService} from '../src/server/conversation.js';
import type {CareService} from '../src/server/care-access.js';
import type {Reasoner} from '../src/server/plan-reasoner.js';
import type {Session} from '../src/server/session.js';
import type {PlanCredential} from '../src/server/chatgpt-plan/storage.js';
import {testAuthority} from './helpers/inference.js';
const credential={accessToken:'synthetic',scopes:['chatgpt.tokens.use.direct']} as PlanCredential;
const stream=(model:string)=>new Response(`data: ${JSON.stringify({type:'response.completed',response:{status:'completed',model,output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'A short answer.'}]}]}})}\n\n`);
describe('explicit owner-only reasoning comparison',()=>{
 it.each(Object.entries(reasoningCandidates))('pins %s, preserves plan auth and rejects a different provider model',async(_id,profile)=>{
  const request=createPlanRequest(profile),fetcher=vi.fn(async(url:unknown,init?:RequestInit)=>{
   expect(url).toBe('https://api.openai.com/v1/responses');expect(init?.redirect).toBe('error');
   expect(init?.headers).toMatchObject({Authorization:'Bearer synthetic'});
   expect(JSON.parse(String(init?.body))).toMatchObject({model:profile.model,reasoning:{effort:profile.effort},store:false,stream:true});
   return stream(profile.model);
  });
  expect(await request(credential,[{role:'user',content:'Synthetic'}],{},fetcher as typeof fetch)).toMatchObject({completed:true,...profile});
  await expect(request(credential,[],{},vi.fn(async()=>stream('unselected')) as typeof fetch)).rejects.toThrow('different model');
 });
 it('has no global/environment switch, no fallback, and snapshots a validated candidate',async()=>{
  const profile={model:'gpt-6-sol',effort:'low'},request=createPlanRequest(profile);profile.effort='high';
  const fetcher=vi.fn(async(_u:unknown,init?:RequestInit)=>{expect(JSON.parse(String(init?.body)).reasoning.effort).toBe('low');return new Response('{}',{status:403});});
  await expect(request(credential,[],{},fetcher as typeof fetch)).rejects.toMatchObject({status:403});expect(fetcher).toHaveBeenCalledOnce();
  expect(()=>createPlanRequest({model:'anything',effort:'low'})).toThrow();
  const extra={model:'gpt-6-sol',effort:'high',endpoint:'other'};expect(()=>createPlanRequest(extra)).toThrow();
  const injectedOptions={instructions:'Synthetic',model:'unselected'},unused=vi.fn();
  await expect(request(credential,[],injectedOptions,unused as unknown as typeof fetch)).rejects.toThrow('Unsupported');expect(unused).not.toHaveBeenCalled();
  const original=vi.fn(async(_u:unknown,init?:RequestInit)=>{expect(JSON.parse(String(init?.body))).toMatchObject({model:'gpt-6-sol',reasoning:{effort:'high'}});return stream('gpt-6-sol');});
  await requestSolHigh(credential,[],{},original as typeof fetch);
 });
 function fixture(profile?:typeof reasoningCandidates[keyof typeof reasoningCandidates],otherActor=false){
  const owner=randomUUID(),session={user_id:otherActor?randomUUID():owner,session_id:randomUUID(),access_token:'synthetic',refresh_token:'synthetic',issued_at:Date.now()/1000,expires_at:Date.now()/1000+3600} as Session;
  const care={authorize:async()=>session,authority:()=>testAuthority(session),today:async()=>({profile:{id:session.user_id,display_name:'Synthetic',time_zone:'America/Toronto',preferences:'',revision:1},local_date:'2026-10-21',tasks:[],meal_options:[],checkin:null})} as unknown as CareService;
  const respond=vi.fn<Reasoner['respond']>(async()=>({completed:true,...(profile??reasoningCandidates['sol-high']),text:'A short answer.',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'A short answer.'}]}]}));
  const reasoner:Reasoner={bind:async scope=>({...scope,route_id:'chatgpt_plan_owner_practice',qualification:'owner_practice',account_binding_id:'synthetic'}),respond};
  const service=new ConversationService(care,reasoner,owner,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,profile);
  return{service,session,respond};
 }
 it('validates the exact experiment effort and model before returning speech, with a distinct policy binding',async()=>{
  const {service,session,respond}=fixture(reasoningCandidates['sol-low']);
  try{const start=await service.start(session);await expect(service.turn(start.session_id,session,randomUUID(),'I feel frustrated.')).resolves.toMatchObject({text:'A short answer.'});
   expect(respond.mock.calls[0][5]?.policy_version).toContain(':owner-test:gpt-6-sol:low');
   respond.mockResolvedValueOnce({completed:true,...reasoningCandidates['sol-high'],text:'Wrong effort.',output:[]} as CompletedTurn);
   await expect(service.turn(start.session_id,session,randomUUID(),'Try again.')).rejects.toMatchObject({code:'wrong_model'});
  }finally{service.close();}
 });
 it('retains exact Sol-high validation on the default conversation',async()=>{
  const {service,session,respond}=fixture();
  try{const start=await service.start(session);respond.mockResolvedValueOnce({completed:true,...reasoningCandidates['sol-low'],text:'Wrong effort.',output:[]} as CompletedTurn);
   await expect(service.turn(start.session_id,session,randomUUID(),'Can you help?')).rejects.toMatchObject({code:'wrong_model'});
  }finally{service.close();}
 });
 it('cannot run a candidate through the caregiver/client route',async()=>{
  const {service,session,respond}=fixture(reasoningCandidates['luna-low'],true);
  try{await expect(service.start(session)).rejects.toMatchObject({code:'experiment_owner_only'});expect(respond).not.toHaveBeenCalled();}finally{service.close();}
 });
});
