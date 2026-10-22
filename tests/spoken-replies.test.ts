import{it,expect,vi}from'vitest';import{randomUUID}from'node:crypto';
import{spokenReplyGuidance,isSpokenConversation,isSimpleMealSuggestion}from'../src/server/spoken-replies.js';
import{ownerTestSpokenReplies,ownerTestTelemetryPolicy}from'../src/server/owner-test-config.js';
import{safeEvent}from'../src/server/telemetry.js';import{NANCY_POLICY_VERSION}from'../src/server/inference-binding.js';
import{ConversationService}from'../src/server/conversation.js';
import type{CareService}from'../src/server/care-access.js';import type{Reasoner}from'../src/server/plan-reasoner.js';import type{Session}from'../src/server/session.js';import{testAuthority}from'./helpers/inference.js';
it('limits the policy replacement to two read-only modes',()=>{
 for(const mode of ['full','recipe','schedule']as const)expect(spokenReplyGuidance(mode,'authority')).toBeUndefined();
 expect(spokenReplyGuidance('conversation','authority')).toContain('Do not merely echo');
 const meals=spokenReplyGuidance('meals','UNIQUE NUTRITION AUTHORITY')!;expect(meals).toContain('UNIQUE NUTRITION AUTHORITY');expect(meals).toContain('cross-contact');expect(meals).toContain('prescribed target');
});
it('is off by default and rejects incomplete or mismatched private activation',()=>{
 const config={owner_actor_id:randomUUID(),participant_id:randomUUID(),origin:'https://synthetic.example:10000'}as any;
 expect(ownerTestSpokenReplies(config)).toBe(false);
 const selection={schema_version:1,...config,profile:'sol-low',context_mode:'prepared-v1',speech_mode:'heart-latency-v1',read_mode:'quick-v1'};
 expect(ownerTestSpokenReplies(config,selection)).toBe(false);expect(ownerTestSpokenReplies(config,{...selection,reply_mode:'spoken-v1'})).toBe(true);
 for(const change of [{read_mode:undefined},{profile:'luna-low'},{owner_actor_id:randomUUID()},{origin:'https://synthetic.example:8443'},{reply_mode:'anything'}])expect(()=>ownerTestSpokenReplies(config,{...selection,reply_mode:'spoken-v1',...change})).toThrow();
});
it('retains the complete test diagnostic identity through the bounded metadata whitelist',()=>{
 const config={owner_actor_id:randomUUID(),participant_id:randomUUID(),origin:'https://synthetic.example:10000'}as any;
 const selection={schema_version:1,...config,profile:'sol-low',context_mode:'prepared-v1',speech_mode:'heart-latency-v1',read_mode:'quick-v1',reply_mode:'spoken-v1'};
 const tag=ownerTestTelemetryPolicy(NANCY_POLICY_VERSION,config,selection);expect(tag.length).toBeLessThanOrEqual(64);expect(tag).toContain('-test-gpt-6-sol-low-prep1-heart1-read1-talk1');
 expect(safeEvent({kind:'conversation',outcome:'ok',measurements:{policy_version:tag,model_calls:1,input_tokens:null,transcript:'private'}}).measurements).toEqual({policy_version:tag,model_calls:1,input_tokens:null});
 expect(()=>ownerTestTelemetryPolicy('x'.repeat(64),config,selection)).toThrow();
});
function fixture(enabled=true,other=false,caregiver=false){
 const owner=randomUUID(),session={user_id:other?randomUUID():owner,session_id:randomUUID(),issued_at:1,expires_at:9999999999,access_token:'synthetic',refresh_token:'synthetic'}as Session;
 let preference='Self-reported type 2 diabetes; peanut allergy; no yogurt';const command=vi.fn();
 const care={authorize:async()=>session,authority:()=>testAuthority(session),today:async()=>({profile:{id:session.user_id,display_name:'Synthetic',time_zone:'America/Toronto',preferences:preference,revision:1},local_date:'2026-10-22',tasks:[],meal_options:[],checkin:null}),command}as unknown as CareService;
 const respond=vi.fn<Reasoner['respond']>(async()=>({completed:true,model:'gpt-6-sol',effort:'high',text:'A useful answer.',output:[]})),reasoner:Reasoner={bind:async scope=>({...scope,route_id:caregiver?'caregiver':'chatgpt_plan_owner_practice',qualification:caregiver?'caregiver_authorized':'owner_practice',account_binding_id:'synthetic'}as any),respond};
 return{session,command,respond,changePreference:()=>{preference='Milk allergy; no eggs';},service:new ConversationService(care,reasoner,owner,()=>new Date('2026-10-22T15:00:00Z'),undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,true,72,true,enabled)};
}
it('keeps fresh preferences, nutrition sources and read-only tools; full actions retain their policy',async()=>{
 const f=fixture();try{const opening=await f.service.start(f.session);
  await f.service.turn(opening.session_id,f.session,randomUUID(),'What meals do you recommend for breakfast, lunch and dinner?');
  const call=f.respond.mock.calls[0];expect(call[1]).toContain('usually 35–45 words');expect(call[5]?.policy_version).toContain(':spoken-v1');expect(call[2]).toEqual([]);expect(JSON.stringify(call[0])).toContain('peanut allergy');expect(JSON.stringify(call[0])).toContain('carb_sources');expect(JSON.stringify(call[0])).toContain('ingredient_names');expect(JSON.stringify(call[0])).toContain('B05');
  f.changePreference();await f.service.turn(opening.session_id,f.session,randomUUID(),'Why does sleep help memory?');const next=f.respond.mock.calls[1];expect(next[1]).toContain('15–28 words');const fresh=next[0].find(item=>typeof item.content==='string'&&item.content.startsWith('Current authorized facts'));expect(JSON.stringify(fresh)).toContain('Milk allergy');expect(JSON.stringify(fresh)).not.toContain('peanut allergy');expect(next[2]).toEqual([]);
  await f.service.turn(opening.session_id,f.session,randomUUID(),'Remember my new breakfast preference.');expect(f.respond.mock.calls[2][1]).not.toContain('15–28 words');expect(f.respond.mock.calls[2][2].length).toBeGreaterThan(0);expect(f.command).not.toHaveBeenCalled();
  await f.service.turn(opening.session_id,f.session,randomUUID(),'Recommend breakfast, lunch, dinner and snacks.');expect(f.respond.mock.calls[3][2].map(tool=>tool.name)).toEqual(['get_nutrition_reference']);
 }finally{f.service.close();}
});
it('preserves the existing default, exact source-detail route and owner restriction',async()=>{
 const f=fixture(false);try{const opening=await f.service.start(f.session);await f.service.turn(opening.session_id,f.session,randomUUID(),'These long pauses are frustrating.');expect(f.respond.mock.calls[0][1]).not.toContain('15–28 words');expect(f.respond.mock.calls[0][5]?.policy_version).not.toContain(':spoken-v1');}finally{f.service.close();}
 for(const f of [fixture(true,true),fixture(true,false,true)])try{await expect(f.service.start(f.session)).rejects.toMatchObject({code:'experiment_owner_only'});expect(f.respond).not.toHaveBeenCalled();}finally{f.service.close();}
 const detail=fixture();try{const opening=await detail.service.start(detail.session);await detail.service.turn(opening.session_id,detail.session,randomUUID(),'Is recipe B01 safe for a peanut allergy, and how many carbs does it have?');expect(detail.respond.mock.calls[0][1]).not.toContain('35–45 words');expect(JSON.stringify(detail.respond.mock.calls[0][0])).toContain('qty: 200');}finally{detail.service.close();}
});

it('keeps ambiguous, action, schedule and food phrases out of ordinary chat expansion',()=>{
 for(const text of ['Can we chat about music?',"I'm bored today; could we chat about music?",'Can you tell me something interesting about rain?'])expect(isSpokenConversation(text)).toBe(true);
 for(const text of ['Yes','Can you tell me what tasks to finish?',"I'm bored, mark my task done",'Can we talk about breakfast?',"Let's chat about my email",'Can you explain how to change my plan?'])expect(isSpokenConversation(text)).toBe(false);
 for(const text of ['What breakfast do you recommend?','Suggest some meal ideas.'])expect(isSimpleMealSuggestion(text)).toBe(true);
 for(const text of ['What breakfast do you recommend and how many carbs does it have?','Is the suggested meal safe?','Suggest another breakfast instead','Recommend a meal and its cooking steps.','Recommend breakfast, lunch, dinner and snacks.'])expect(isSimpleMealSuggestion(text)).toBe(false);
});
