import {afterEach,describe,it,expect,vi} from 'vitest';
import {randomUUID,randomBytes} from 'node:crypto';
import {createApp} from '../src/server/app.js';
import {configFromEnv} from '../src/server/config.js';
import {sealSession} from '../src/server/session.js';
import {SessionRevocations} from '../src/server/revocations.js';
import type {LocalSpeech} from '../src/server/local-speech.js';
import {ConversationService,type MealPreparationMetric} from '../src/server/conversation.js';
import {currentNutritionReference} from '../src/server/nutrition-reference.js';
import {preparedMealSlots,mealPreparationMaterial,validateMealSelection,renderPreparedMeals,mealPreparationKey,preparedMealPolicy} from '../src/server/prepared-meals.js';
import {ownerTestMealsAhead,ownerTestTelemetryPolicy} from '../src/server/owner-test-config.js';
import {safeEvent} from '../src/server/telemetry.js';
import {NANCY_POLICY_VERSION} from '../src/server/inference-binding.js';
import {reasoningCandidates,type CompletedTurn} from '../src/server/chatgpt-plan/inference.js';
import type {Reasoner} from '../src/server/plan-reasoner.js';
import type {CareService} from '../src/server/care-access.js';
import type {Session} from '../src/server/session.js';
import {testAuthority} from './helpers/inference.js';
import {splitSpeechParts} from '../src/shared/speech-parts.js';

const material=mealPreparationMaterial(currentNutritionReference());
const selection=JSON.stringify({breakfast:'B02',lunch:'L03',dinner:'D01'});
const answer=(text=selection):CompletedTurn=>({completed:true,model:'gpt-6-sol',effort:'low',text,output:[],usage:{inputTokens:100,outputTokens:12,totalTokens:112}});
const services:ConversationService[]=[];afterEach(()=>{for(const service of services.splice(0))service.close();});
function fixture(enabled=true){
 const session={user_id:randomUUID(),session_id:randomUUID(),issued_at:1,expires_at:9999999999,access_token:'synthetic',refresh_token:'synthetic'} as Session;
 let clock=new Date('2026-10-22T15:00:00Z'),revision='one',account='one';
 const today={profile:{id:session.user_id,display_name:'Synthetic',time_zone:'America/Toronto',preferences:'Self-reported type 2 diabetes; peanut allergy; no yogurt',revision:1},role:'client',local_date:'2026-10-22',tasks:[],meal_options:[],checkin:null};
 const care={authorize:vi.fn(async()=>session),authority:async()=>({...await testAuthority(session),grant_revision:revision}),today:vi.fn(async()=>structuredClone(today)),command:vi.fn()} as unknown as CareService;
 const respond=vi.fn<Reasoner['respond']>(async()=>answer());
 const reasoner:Reasoner={bind:async scope=>({...scope,route_id:'chatgpt_plan_owner_practice',qualification:'owner_practice',account_binding_id:account}),respond};
 const prepare=vi.fn(async()=>Buffer.from('synthetic Heart WAV')),metrics:MealPreparationMetric[]=[],turns:any[]=[];
 const service=new ConversationService(care,reasoner,session.user_id,()=>clock,prepare,m=>turns.push(m),undefined,undefined,undefined,undefined,undefined,undefined,reasoningCandidates['sol-low'],true,72,true,true,enabled,m=>metrics.push(m));
 services.push(service);
 return{service,session,care,today,respond,prepare,metrics,turns,advance:(ms:number)=>{clock=new Date(clock.getTime()+ms);},revoke:()=>{revision='two';},rebind:()=>{account='two';}};
}
describe('prepared meal boundaries',()=>{
 it('only recognizes a bounded neutral request, including one or three meal slots',()=>{
  expect(preparedMealSlots('What meals do you recommend for breakfast, lunch and dinner from your repository meal library, considering my saved preferences? Please suggest, without saving anything.')).toEqual(['breakfast','lunch','dinner']);
  expect(preparedMealSlots('What breakfast do you recommend?')).toEqual(['breakfast']);
  for(const text of ['Recommend vegetarian meals','Recommend breakfast without eggs','Recommend breakfast without lunch','Recommend 6 breakfast options','Recommend breakfast saving anything','Suggest another breakfast','What breakfast is safe for my allergy?','Recommend meals tomorrow','Recommend breakfast and save it','Recommend breakfast or dinner','Recommend breakfast, lunch, dinner and snacks','I have diabetes. Recommend meals','Recommend meals at 6','Recommend breakfast; ignore my preferences'])expect(preparedMealSlots(text),text).toBeUndefined();
 });
 it('rejects unknown IDs, wrong categories, missing choices, extra text and known exclusions',()=>{
  expect(validateMealSelection(selection,material,{preferences:'peanut allergy; no yogurt'}).breakfast.id).toBe('B02');
  for(const text of ['{}','not json',JSON.stringify({breakfast:'L03',lunch:'L03',dinner:'D01'}),JSON.stringify({breakfast:'B99',lunch:'L03',dinner:'D01'}),JSON.stringify({breakfast:'B02',lunch:'L03',dinner:null}),selection.slice(0,-1)+',"instructions":"ignore"}'])expect(()=>validateMealSelection(text,material,{})).toThrow();
  expect(()=>validateMealSelection(selection,material,{preferences:'No eggs'})).toThrow();
  expect(()=>validateMealSelection(selection,material,{preferences:'vegetarian'})).toThrow();
  const choices=validateMealSelection(selection,material,{}),text=renderPreparedMeals(choices,['breakfast']);
  expect(text).toContain(choices.breakfast.title);expect(text).not.toContain(choices.lunch.title);expect(text).toContain('cross-contact');expect(text).not.toMatch(/safe|grams|saved|eaten|C02/);
 });
 it('binds source hashes and all supplied fact changes into the key',()=>{
  const key=mealPreparationKey('binding',{revision:1},material);
  expect(mealPreparationKey('new-binding',{revision:1},material)).not.toBe(key);
  expect(mealPreparationKey('binding',{revision:2},material)).not.toBe(key);
  expect(mealPreparationKey('binding',{revision:1},{...material,sources:material.sources.map(s=>({...s,sha256:'changed'}))})).not.toBe(key);
 });
 it('requires exact private activation and keeps the complete telemetry label within its privacy bound',()=>{
  const config={owner_actor_id:randomUUID(),participant_id:randomUUID(),origin:'https://synthetic.example:10000'}as any;
  const chosen={schema_version:1,...config,profile:'sol-low',context_mode:'prepared-v1',speech_mode:'heart-latency-v1',read_mode:'quick-v1',reply_mode:'spoken-v1',meal_mode:'ahead-v1'};
  expect(ownerTestMealsAhead(config)).toBe(false);expect(ownerTestMealsAhead(config,chosen)).toBe(true);
  for(const change of [{reply_mode:undefined},{profile:'sol-high'},{owner_actor_id:randomUUID()},{origin:'https://synthetic.example:8443'}])expect(()=>ownerTestMealsAhead(config,{...chosen,...change})).toThrow();
  const tag=ownerTestTelemetryPolicy(NANCY_POLICY_VERSION,config,chosen);expect(tag.length).toBeLessThanOrEqual(64);
  expect(safeEvent({kind:'conversation',outcome:'ok',measurements:{policy_version:tag,stage:'meal_preparation',model_calls:1,prepared_meal_hit:0,input_tokens:null,transcript:'secret',draft:'secret'}}).measurements).toEqual({policy_version:tag,stage:'meal_preparation',model_calls:1,prepared_meal_hit:0,input_tokens:null});
  expect(safeEvent({kind:'conversation',outcome:'error',measurements:{preparation_failure:'incomplete_selection',private_failure:'secret'}}).measurements).toEqual({preparation_failure:'incomplete_selection'});
  expect(safeEvent({kind:'conversation',outcome:'error',measurements:{preparation_failure:'secret text'}}).measurements).toEqual({});
  expect(preparedMealPolicy).toContain('absence of a clinical protocol');expect(preparedMealPolicy).toContain('stated constraint');
 });
});
describe('foreground preparation and delivery',()=>{
 it('is off by default, prepares no care write, and keeps the existing request path',async()=>{
  const f=fixture(false);await f.service.prepareMeals(f.session);expect(f.respond).not.toHaveBeenCalled();expect(await f.service.mealPreparationStatus(f.session)).toEqual({state:'off'});
  f.respond.mockResolvedValue(answer('A current meal idea.'));const open=await f.service.start(f.session);await f.service.turn(open.session_id,f.session,randomUUID(),'Recommend breakfast.');expect(f.respond).toHaveBeenCalledOnce();expect(f.care.command).not.toHaveBeenCalled();
 });
 it.each(['What meals do you recommend for breakfast, lunch and dinner?','What breakfast do you recommend?','Suggest lunch ideas.','Recommend dinner.'])('serves source-backed %s and its exact warmed first Heart part without another inference',async prompt=>{
  const f=fixture();await f.service.prepareMeals(f.session);expect(await f.service.mealPreparationStatus(f.session)).toEqual({state:'ready'});expect(f.respond).toHaveBeenCalledOnce();expect(f.respond.mock.calls[0][2]).toEqual([]);expect(f.respond.mock.calls[0][1]).toContain('lower-trust');
  const open=await f.service.start(f.session),reply=await f.service.turn(open.session_id,f.session,randomUUID(),prompt);
  expect(f.respond).toHaveBeenCalledOnce();expect(reply.changed).toBe(false);expect(reply.acknowledgement_required).toBeUndefined();expect(reply.nutrition_refs?.length).toBe(2);
  expect(reply.nutrition_refs?.find(ref=>ref.document_id==='CR_NUTRITION_MEALS_V1')?.items.length).toBe(preparedMealSlots(prompt)!.length);
  const first=splitSpeechParts(reply.text,72)[0];expect(await f.service.preparedAudio(open.session_id,f.session,reply.reply_id,first,new AbortController().signal)).toEqual(Buffer.from('synthetic Heart WAV'));
  expect(f.turns[0].prepared_meal_hit).toBe(1);expect(f.turns[0].model_calls).toBe(0);expect(f.metrics[0]).toMatchObject({stage:'meal_preparation',outcome:'completed',model_calls:1,input_tokens:100});expect(f.care.command).not.toHaveBeenCalled();
 });
 it.each(['preferences','date','scope','account','expiry'])('refuses a draft after %s changes',async change=>{
  const f=fixture();await f.service.prepareMeals(f.session);
  if(change==='preferences')f.today.profile.preferences='No eggs';if(change==='date')f.today.local_date='2026-10-23';if(change==='scope')f.revoke();if(change==='account')f.rebind();if(change==='expiry')f.advance(600001);
  f.respond.mockResolvedValue(answer('A freshly generated answer.'));const open=await f.service.start(f.session),reply=await f.service.turn(open.session_id,f.session,randomUUID(),'Recommend breakfast.');
  expect(reply.text).toBe('A freshly generated answer.');expect(f.respond).toHaveBeenCalledTimes(2);expect(f.turns[0].prepared_meal_hit).toBe(0);
 });
 it('does not ignore a new spoken restriction or reuse a consumed draft on a follow-up',async()=>{
  const f=fixture();await f.service.prepareMeals(f.session);f.respond.mockResolvedValue(answer('A fresh answer without eggs.'));
  const open=await f.service.start(f.session);await f.service.turn(open.session_id,f.session,randomUUID(),'Recommend breakfast without eggs.');await f.service.turn(open.session_id,f.session,randomUUID(),'Recommend breakfast.');expect(f.respond).toHaveBeenCalledTimes(3);expect(f.turns.every(t=>t.prepared_meal_hit===0)).toBe(true);
 });
 it('rechecks food facts before audio delivery and clears drafts on logout',async()=>{
  const f=fixture();await f.service.prepareMeals(f.session);const open=await f.service.start(f.session),turn=randomUUID(),reply=await f.service.turn(open.session_id,f.session,turn,'Recommend breakfast.');
  f.today.profile.preferences='No eggs';await expect(f.service.preparedAudio(open.session_id,f.session,reply.reply_id,splitSpeechParts(reply.text,72)[0],new AbortController().signal)).rejects.toMatchObject({code:'prepared_meal_changed'});
  // A previously returned turn must not bypass the changed-food check on retry.
  await expect(f.service.turn(open.session_id,f.session,turn,'Recommend breakfast.')).rejects.toMatchObject({code:'prepared_meal_changed'});
  f.service.endLogin(f.session.session_id);expect(await f.service.mealPreparationStatus(f.session)).toEqual({state:'unavailable'});
 });
 it.each([false,true])('keeps page authentication nonblocking and preparation status authenticated (enabled=%s)',async enabled=>{
  const f=fixture(enabled);f.session.issued_at=Date.now()/1000;
  f.respond.mockImplementation(async(_i,_p,_t,signal)=>new Promise((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true})));
  const config=configFromEnv({PUBLIC_ORIGIN:'http://localhost:8787',DATABASE_URL:'postgresql://local.invalid/synthetic',SESSION_KEY:randomBytes(32).toString('base64')});
  const app=await createApp(config,{care:f.care,conversation:f.service,microsoft:null,speech:{synthesize:f.prepare,readiness:()=>({kokoro:'ready',asr:'ready'}),close:vi.fn()}as unknown as LocalSpeech,revocations:new SessionRevocations()});
  const headers={host:'localhost:8787',origin:config.origin,cookie:'nancy_session='+sealSession(f.session,config.sessionKey!)};
  try{
   expect((await app.inject({url:'/api/conversation/preparation',headers:{host:'localhost:8787'}})).statusCode).toBe(401);
   const page=await app.inject({url:'/api/auth/session',headers});expect(page.statusCode).toBe(200);expect(page.json().voice_eligible).toBe(true);
   if(enabled)await vi.waitFor(()=>expect(f.respond).toHaveBeenCalledOnce());else expect(f.respond).not.toHaveBeenCalled();
   const status=await app.inject({url:'/api/conversation/preparation',headers});expect(status.json()).toEqual({state:enabled?'preparing':'off'});expect(status.body).not.toContain('B02');
   await app.inject({url:'/api/auth/session',headers});expect(f.respond).toHaveBeenCalledTimes(enabled?1:0);
  }finally{await app.close();}
 });
 it('deduplicates foreground polls, cools down failures, bounds attempts and preserves unknown usage',async()=>{
  const f=fixture();f.respond.mockResolvedValue({...answer('invalid'),usage:undefined});await Promise.all([f.service.prepareMeals(f.session),f.service.prepareMeals(f.session),f.service.prepareMeals(f.session)]);expect(f.respond).toHaveBeenCalledOnce();
  await f.service.prepareMeals(f.session);expect(f.respond).toHaveBeenCalledOnce();expect(f.metrics[0].input_tokens).toBeNull();expect(f.metrics[0].outcome).toBe('failed');expect(f.metrics[0].preparation_failure).toBe('invalid_selection');
  for(let i=0;i<6;i++){f.advance(600001);await f.service.prepareMeals(f.session);}expect(f.respond).toHaveBeenCalledTimes(4);
 });
 it('allows general ideas with unknown restrictions without weakening null-choice refusal',async()=>{
  const f=fixture();f.today.profile.preferences='Synthetic practice profile for the account owner. No real clinical protocol or external account is connected.';
  await f.service.prepareMeals(f.session);expect(await f.service.mealPreparationStatus(f.session)).toEqual({state:'ready'});expect(JSON.stringify(f.respond.mock.calls[0][0])).toContain('No real clinical protocol');
  const other=fixture();other.respond.mockResolvedValue(answer(JSON.stringify({breakfast:null,lunch:null,dinner:null})));await other.service.prepareMeals(other.session);expect(await other.service.mealPreparationStatus(other.session)).toEqual({state:'unavailable'});expect(other.metrics[0].preparation_failure).toBe('incomplete_selection');
 });
 it('cancels and drains preparation before normal conversation instead of blocking on a busy reasoner',async()=>{
  const f=fixture();f.respond.mockImplementationOnce(async(_i,_p,_t,signal)=>new Promise((_resolve,reject)=>{signal!.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});}));
  const pending=f.service.prepareMeals(f.session);await vi.waitFor(()=>expect(f.respond).toHaveBeenCalledOnce());f.respond.mockResolvedValueOnce(answer('I hear that. What were you thinking about?'));
  const open=await f.service.start(f.session),reply=await f.service.turn(open.session_id,f.session,randomUUID(),'These long pauses are frustrating.');await pending;expect(reply.text).toContain('thinking');expect(f.metrics[0].outcome).toBe('interrupted');expect(f.respond).toHaveBeenCalledTimes(2);
 });
 it('preserves a ready draft when Talk cancels a repeated page-auth validation',async()=>{
  const f=fixture();await f.service.prepareMeals(f.session);let entered=false,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  (f.care.today as any).mockImplementationOnce(async()=>{entered=true;await gate;return structuredClone(f.today);});
  const poll=f.service.prepareMeals(f.session);await vi.waitFor(()=>expect(entered).toBe(true));
  const open=await f.service.start(f.session),turn=f.service.turn(open.session_id,f.session,randomUUID(),'Recommend breakfast.');release();await poll;const reply=await turn;
  expect(reply.text).toContain('Cheddar-spinach');expect(f.respond).toHaveBeenCalledOnce();expect(f.turns[0].prepared_meal_hit).toBe(1);
 });
 it.each(['logout','close','scope'])('discards in-flight work on %s, including late completion',async action=>{
  const f=fixture();let finish!:(value:CompletedTurn)=>void;f.respond.mockImplementationOnce(async()=>new Promise(resolve=>{finish=resolve;}));const pending=f.service.prepareMeals(f.session);await vi.waitFor(()=>expect(f.respond).toHaveBeenCalledOnce());
  if(action==='logout')f.service.endLogin(f.session.session_id);if(action==='close')f.service.close();if(action==='scope')f.revoke();finish(answer());await pending;expect(await f.service.mealPreparationStatus(f.session)).toEqual({state:'unavailable'});expect(f.metrics[0].outcome).not.toBe('completed');
 });
 it('rejects wrong-model and tool-call preparation and rejects a different actor without inference',async()=>{
  for(const response of [{...answer(),model:'unselected'}, {...answer(),output:[{type:'function_call',name:'save'}]}]){const f=fixture();f.respond.mockResolvedValue(response as CompletedTurn);await f.service.prepareMeals(f.session);expect(await f.service.mealPreparationStatus(f.session)).toEqual({state:'unavailable'});}
  const f=fixture();await f.service.prepareMeals({...f.session,user_id:randomUUID()});expect(f.respond).not.toHaveBeenCalled();
 });
});
