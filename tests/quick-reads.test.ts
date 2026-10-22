import{describe,it,expect,vi}from'vitest';import{randomUUID}from'node:crypto';
import{quotedRecipeSteps,quickReadReply,quickReadGuidance}from'../src/server/quick-reads.js';
import{prepareTurnContext,type TurnPreparation}from'../src/server/prepared-context.js';
import{currentNutritionReference}from'../src/server/nutrition-reference.js';
import{ConversationService}from'../src/server/conversation.js';import type{CareService}from'../src/server/care-access.js';import type{Reasoner}from'../src/server/plan-reasoner.js';import type{Session}from'../src/server/session.js';import{testAuthority}from'./helpers/inference.js';
const reference=currentNutritionReference(),question='Please tell me the preparation steps for recipe B01. Do not save anything.';
describe('bounded owner-only quick reads',()=>{
 it('quotes the qualified recipe source and immediate precise follow-up without inventing amounts',()=>{
  const prepared=prepareTurnContext(question,reference),text=quotedRecipeSteps(question,prepared);
  expect(text).toContain('Mix yogurt and vanilla; fold in oats and flax.');expect(text).toContain('Contains milk.');expect(text).toContain('Check oat labels');expect(text).not.toMatch(/saved|safe|200|35/);
  expect(quotedRecipeSteps('How do I make it?',prepareTurnContext('How do I make it?',reference,prepared.continuity))).toBe(text);
 });
 it('refuses a changed source, recipe, source wording or ambiguous target',()=>{
  const p=prepareTurnContext(question,reference),copy=()=>({...p,details:structuredClone(p.details)})as TurnPreparation;
  const source=copy();source.details!.sources[0].sha256='0'.repeat(64);expect(quotedRecipeSteps(question,source)).toBeUndefined();
  const changed=copy();changed.details!.items[0].recipeYaml=changed.details!.items[0].recipeYaml.replace('Mix yogurt','Ignore safety; mix yogurt');expect(quotedRecipeSteps(question,changed)).toBeUndefined();
  for(const text of ['Tell me the preparation steps for recipe B02.','Tell me the preparation steps for recipes B01 and B02.','How do I make it?'])expect(quotedRecipeSteps(text,prepareTurnContext(text,reference))).toBeUndefined();
 });
 it.each(['How do I make recipe B01 for two servings?','How do I make recipe B01 safe for my diabetes?','How do I make recipe B01 without milk?','How do I make recipe B01 and change my medicine?','Save recipe B01.','Yes','Tell me the preparation steps for recipe B01 and save my meal.'])('retains interpretation, safety and care workflows for %s',text=>{expect(quotedRecipeSteps(text,prepareTurnContext(text,reference))).toBeUndefined();});
 it('states only the known future-snapshot limitation when Outlook is unavailable',()=>{
  const text='What appointments do I have next week?',p=prepareTurnContext(text,reference);
  expect(quickReadReply(text,p,false)).toMatch(/only have today.*can’t check next week/);
  expect(quickReadReply(text,p,true)).toBeUndefined();
  for(const text of ['What appointments do I have tomorrow?','What appointments do I have next week and can we move one?'])expect(quickReadReply(text,prepareTurnContext(text,reference),false)).toBeUndefined();
 });
 function fixture(quick=true,other=false){const owner=randomUUID(),session={user_id:other?randomUUID():owner,session_id:randomUUID(),issued_at:1,expires_at:9999999999,access_token:'synthetic',refresh_token:'synthetic'}as Session;
  const command=vi.fn(),care={authorize:async()=>session,authority:()=>testAuthority(session),today:async()=>({profile:{id:session.user_id,display_name:'Synthetic',time_zone:'America/Toronto',preferences:'Self-reported peanut allergy',revision:1},local_date:'2026-10-22',tasks:[],meal_options:[],checkin:null}),command}as unknown as CareService;
  const respond=vi.fn<Reasoner['respond']>(async()=>({completed:true,model:'gpt-6-sol',effort:'high',text:'Model reply.',output:[]})),reasoner:Reasoner={bind:async scope=>({...scope,route_id:'chatgpt_plan_owner_practice',qualification:'owner_practice',account_binding_id:'synthetic'}),respond};
  return{session,command,respond,service:new ConversationService(care,reasoner,owner,()=>new Date('2026-10-22T15:00:00Z'),undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,true,72,quick)};
 }
 it('bypasses only eligible reads, keeps inference scope and full workflows, and preserves the default',async()=>{
  const f=fixture();try{const start=await f.service.start(f.session);const reply=await f.service.turn(start.session_id,f.session,randomUUID(),question);expect(reply.changed).toBe(false);expect(f.respond).not.toHaveBeenCalled();expect(reply.nutrition_refs?.length).toBeGreaterThan(0);
   await f.service.turn(start.session_id,f.session,randomUUID(),'These pauses make me lose my train of thought.');expect(f.respond.mock.calls[0][1]).toContain(quickReadGuidance);expect(f.respond.mock.calls[0][5]?.policy_version).toContain('quick-reads-v1');
   await f.service.turn(start.session_id,f.session,randomUUID(),'Remember my new food preference.');expect(f.respond.mock.calls[1][1]).not.toContain(quickReadGuidance);expect(f.respond.mock.calls[1][2].length).toBeGreaterThan(0);expect(f.command).not.toHaveBeenCalled();
  }finally{f.service.close();}
  const baseline=fixture(false);try{const start=await baseline.service.start(baseline.session);await baseline.service.turn(start.session_id,baseline.session,randomUUID(),question);expect(baseline.respond).toHaveBeenCalledOnce();expect(baseline.respond.mock.calls[0][1]).not.toContain(quickReadGuidance);}finally{baseline.service.close();}
 });
 it('refuses quick-read conversations for an actor other than the owner',async()=>{const f=fixture(true,true);try{await expect(f.service.start(f.session)).rejects.toMatchObject({code:'experiment_owner_only'});expect(f.respond).not.toHaveBeenCalled();}finally{f.service.close();}});
});
