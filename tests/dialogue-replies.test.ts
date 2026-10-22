import{afterEach,it,expect,vi}from'vitest';import{randomUUID}from'node:crypto';
import{ConversationService}from'../src/server/conversation.js';import{reasoningCandidates,type CompletedTurn}from'../src/server/chatgpt-plan/inference.js';
import type{CareService}from'../src/server/care-access.js';import type{Session}from'../src/server/session.js';import type{Reasoner}from'../src/server/plan-reasoner.js';import{testAuthority}from'./helpers/inference.js';
import{dialogueChatReply,dialogueChatReplies,mealFollowup,validateDialogueMeals,dialogueMealPreparationPolicy}from'../src/server/dialogue-replies.js';
import{mealPreparationMaterial}from'../src/server/prepared-meals.js';import{currentNutritionReference}from'../src/server/nutrition-reference.js';
import{ownerTestDialogue,ownerTestTelemetryPolicy}from'../src/server/owner-test-config.js';import{safeEvent}from'../src/server/telemetry.js';import{NANCY_POLICY_VERSION}from'../src/server/inference-binding.js';import{splitSpeechParts}from'../src/shared/speech-parts.js';
const choice={breakfast:['B02','B04'],lunch:['L03','L01'],dinner:['D01','D03']};
const response=(text:string):CompletedTurn=>({completed:true,model:'gpt-6-sol',effort:'low',text,output:[]});
const services:ConversationService[]=[];afterEach(()=>{services.splice(0).forEach(s=>s.close());});
function fixture(enabled=true,other=false){
 const owner=randomUUID(),session={user_id:other?randomUUID():owner,session_id:randomUUID(),issued_at:1,expires_at:9999999999,access_token:'synthetic',refresh_token:'synthetic'}as Session;
 let now=new Date('2026-10-22T15:00:00Z'),grant='one';
 const today={profile:{id:session.user_id,display_name:'Synthetic',time_zone:'America/Toronto',preferences:'Self-reported type 2 diabetes; peanut allergy; no yogurt',revision:1},role:'client',local_date:'2026-10-22',tasks:[],meal_options:[],checkin:null};
 const care={authorize:vi.fn(async()=>session),authority:async()=>({...await testAuthority(session),grant_revision:grant}),today:vi.fn(async()=>structuredClone(today)),command:vi.fn()}as unknown as CareService;
 const respond=vi.fn<Reasoner['respond']>(async()=>response(JSON.stringify(enabled?choice:{breakfast:'B02',lunch:'L03',dinner:'D01'}))),prepare=vi.fn(async()=>Buffer.from('synthetic Heart'));
 const metrics:any[]=[],preparations:any[]=[];
 const service=new ConversationService(care,{bind:async scope=>({...scope,route_id:'chatgpt_plan_owner_practice',qualification:'owner_practice',account_binding_id:'test'}),respond},owner,()=>now,prepare,m=>metrics.push(m),undefined,undefined,undefined,undefined,undefined,undefined,reasoningCandidates['sol-low'],true,72,true,true,true,m=>preparations.push(m),enabled);services.push(service);
 const turn=async(id:string,text:string)=>service.turn(id,session,randomUUID(),text);
 const open=async()=>{await service.prepareMeals(session);const opening=await service.start(session);return opening.session_id;};
 return{service,session,today,care,respond,prepare,metrics,preparations,turn,open,revoke:()=>{grant='two';},expire:()=>{now=new Date(now.getTime()+600001);}};
}
it('requires the exact existing private trial and retains bounded numeric metadata',()=>{
 const settings={owner_actor_id:randomUUID(),participant_id:randomUUID(),origin:'https://synthetic.example:10000'}as any,selected={schema_version:1,...settings,profile:'sol-low',context_mode:'prepared-v1',speech_mode:'heart-latency-v1',read_mode:'quick-v1',reply_mode:'spoken-v1',meal_mode:'ahead-v1',continuation_mode:'dialogue-v1'};
 expect(ownerTestDialogue(settings)).toBe(false);expect(ownerTestDialogue(settings,selected)).toBe(true);
 for(const change of [{meal_mode:undefined},{profile:'sol-none'},{owner_actor_id:randomUUID()},{origin:'https://synthetic.example:8443'},{continuation_mode:'other'}])expect(()=>ownerTestDialogue(settings,{...selected,...change})).toThrow();
 const tag=ownerTestTelemetryPolicy(NANCY_POLICY_VERSION,settings,selected);expect(tag.length).toBeLessThanOrEqual(64);expect(tag.endsWith('-dialog1')).toBe(true);
 expect(safeEvent({kind:'conversation',outcome:'ok',measurements:{policy_version:tag,meal_followup_hit:1,conversation_quick_hit:0,transcript:'private'}}).measurements).toEqual({policy_version:tag,meal_followup_hit:1,conversation_quick_hit:0});
});
it('matches whole simple messages without swallowing symptoms, instructions or other care intent',()=>{
 for(const text of ['Hello Nancy',"I'm bored",'Thank you.','I lost my train of thought.','These long pauses are frustrating. I lose my train of thought while waiting for you.'])expect(dialogueChatReply(text),text).toBeTruthy();
 for(const text of ['Hi Nancy, add a task',"I'm lonely and I want to hurt myself",'I lost consciousness','I forgot what medicine I took',"I'm bored; recommend lunch",'Thanks, save it','These pauses are frustrating. I have chest pain.','Why does sleep help memory?'])expect(dialogueChatReply(text),text).toBeUndefined();
});
it('validates both ranked choices against source/category and saved exclusions',()=>{
 const material=mealPreparationMaterial(currentNutritionReference()),selected=validateDialogueMeals(JSON.stringify(choice),material,{preferences:'peanut allergy; no yogurt'});
 expect(selected.choices.breakfast.id).toBe('B02');expect(selected.options.breakfast.map(x=>x.id)).toEqual(['B02','B04']);expect(dialogueMealPreparationPolicy).toContain('one or two distinct');
 for(const change of [{breakfast:['B02','B02']},{breakfast:['B02','B99']},{breakfast:['B02','L01']},{breakfast:['B02','B01']},{breakfast:null},{breakfast:['B02','B04','B05']}])expect(()=>validateDialogueMeals(JSON.stringify({...choice,...change}),material,{preferences:'no yogurt'})).toThrow();
});
it('keeps default-off behavior for follow-ups and arbitrary chat',async()=>{
 const f=fixture(false),id=await f.open();await f.turn(id,'What meals do you recommend for breakfast, lunch and dinner?');f.respond.mockResolvedValue(response('A fresh answer.'));
 await f.turn(id,'What about lunch?');await f.turn(id,'Hello Nancy');expect(f.respond).toHaveBeenCalledTimes(3);expect(f.metrics.every(m=>m.meal_followup_hit===undefined)).toBe(true);
});
it('preserves a prepared menu across an opening greeting, with zero model calls on the greeting/menu',async()=>{
 const f=fixture(),id=await f.open();expect((await f.turn(id,'Hello Nancy')).text).toBe(dialogueChatReplies.greeting);const menu=await f.turn(id,'What meals do you recommend for breakfast, lunch and dinner?');expect(menu.text).toContain('Cheddar-spinach');expect(f.respond).toHaveBeenCalledOnce();expect(f.metrics.map(m=>m.model_calls)).toEqual([0,0]);expect(f.metrics[1].prepared_meal_hit).toBe(1);
});
it('retains the meal thread across a bounded lost-thought response without discarding the conversation',async()=>{
 const f=fixture(),id=await f.open();await f.turn(id,'Recommend breakfast.');expect((await f.turn(id,'I lost my train of thought.')).text).toBe(dialogueChatReplies.lost);const reply=await f.turn(id,'What about lunch?');expect(reply.text).toContain('Tomato-lentil');expect(f.respond).toHaveBeenCalledOnce();
});
it.each(['What about lunch?','What did you suggest for lunch?','Recommend lunch.'])('quotes the selected meal and exact warmed Heart part for %s',async question=>{
 const f=fixture(),id=await f.open();await f.turn(id,'What meals do you recommend for breakfast, lunch and dinner?');const reply=await f.turn(id,question);
 expect(reply.text).toContain('Tomato-lentil soup');expect(reply.changed).toBe(false);expect(reply.nutrition_refs?.find(r=>r.document_id==='CR_NUTRITION_MEALS_V1')?.items).toEqual(['L03']);expect(f.respond).toHaveBeenCalledOnce();expect(f.metrics.at(-1).meal_followup_hit).toBe(1);
 const count=f.prepare.mock.calls.length;expect(await f.service.preparedAudio(id,f.session,reply.reply_id,splitSpeechParts(reply.text,72)[0],new AbortController().signal)).toEqual(Buffer.from('synthetic Heart'));expect(f.prepare).toHaveBeenCalledTimes(count);
});
it('changes only the suggested choice for a prepared alternative and never repeats an exhausted choice',async()=>{
 const f=fixture(),id=await f.open();await f.turn(id,'Recommend breakfast.');const alternate=await f.turn(id,'Suggest another breakfast.');expect(alternate.text).toContain('Peach cottage-cheese');expect(f.respond).toHaveBeenCalledOnce();
 expect((await f.turn(id,'What did you recommend for breakfast?')).text).toContain('Peach cottage-cheese');f.respond.mockResolvedValue(response('Let’s look for a different option.'));await f.turn(id,'Suggest another breakfast.');expect(f.respond).toHaveBeenCalledTimes(2);expect(f.care.command).not.toHaveBeenCalled();
});
it('clarifies an ambiguous follow-up and applies its pending intent to the named slot',async()=>{
 const f=fixture(),id=await f.open();await f.turn(id,'What meals do you recommend for breakfast, lunch and dinner?');expect((await f.turn(id,'How do I make it?')).text).toContain('Which meal');const steps=await f.turn(id,'breakfast');expect(steps.text).toContain('The recipe says:');expect(f.respond).toHaveBeenCalledOnce();expect(f.metrics.at(-1).meal_followup_hit).toBe(1);
});
it.each(['What are the ingredients in that breakfast?','How do I make that breakfast?','Why did you pick that breakfast?'])('answers source follow-up %s without another lookup round',async question=>{
 const f=fixture(),id=await f.open();await f.turn(id,'Recommend breakfast.');const reply=await f.turn(id,question);expect(f.respond).toHaveBeenCalledOnce();expect(f.metrics.at(-1).meal_followup_hit).toBe(1);expect(reply.text).not.toMatch(/\b(?:saved|eaten)\b|grams of carbohydrate/i);expect(reply.nutrition_refs?.find(r=>r.document_id==='CR_NUTRITION_MEALS_V1')?.items).toEqual(['B02']);
 if(question.includes('ingredients'))expect(reply.text).toMatch(/eggs|egg/);if(question.includes('make'))expect(reply.text).toContain('recipe says');
});
it.each(['Recommend breakfast without eggs','How many carbs are in it?','Is that safe for my allergy?','Save this breakfast','Recommend 6 breakfast options','Recommend breakfast without lunch'])('keeps new/unsafe/changed intent out of the fast path: %s',async question=>{
 const f=fixture(),id=await f.open();await f.turn(id,'Recommend breakfast.');f.respond.mockResolvedValue(response('A freshly considered reply.'));await f.turn(id,question);expect(f.respond).toHaveBeenCalledTimes(2);expect(f.metrics.at(-1).meal_followup_hit).toBe(0);expect(f.care.command).not.toHaveBeenCalled();
});
it.each(['preferences','date','expiry'])('invalidates the retained menu after %s changes',async change=>{
 const f=fixture(),id=await f.open();await f.turn(id,'Recommend breakfast.');if(change==='preferences')f.today.profile.preferences='No eggs';if(change==='date')f.today.local_date='2026-10-23';if(change==='expiry')f.expire();f.respond.mockResolvedValue(response('Fresh reply.'));await f.turn(id,'What about lunch?');expect(f.respond).toHaveBeenCalledTimes(2);expect(f.metrics.at(-1).meal_followup_hit).toBe(0);
});
it('blocks source/audio after scope revocation and discards thread on interruption/logout',async()=>{
 const f=fixture(),id=await f.open();await f.turn(id,'Recommend breakfast.');const reply=await f.turn(id,'What about lunch?');f.revoke();await expect(f.service.preparedAudio(id,f.session,reply.reply_id,splitSpeechParts(reply.text,72)[0],new AbortController().signal)).rejects.toMatchObject({code:'scope_changed'});
 const next=fixture(),nextId=await next.open();await next.turn(nextId,'Recommend breakfast.');next.service.interrupt(nextId,next.session);next.respond.mockResolvedValue(response('A new source reply.'));await next.turn(nextId,'What about lunch?');expect(next.respond).toHaveBeenCalledTimes(2);next.service.endLogin(next.session.session_id);await expect(next.turn(nextId,'What about dinner?')).rejects.toMatchObject({code:'conversation_ended'});
});
it('retains previous question/history and fresh facts in shorter model-dependent conversation',async()=>{
 const f=fixture(),id=await f.open();f.respond.mockResolvedValue(response('Rain forms when tiny drops in clouds join and grow heavy enough to fall.'));await f.turn(id,'Can you tell me something interesting about rain?');await f.turn(id,'Why does that happen?');const call=f.respond.mock.calls.at(-1)!;expect(call[1]).toContain('at most eight words');expect(call[1]).toContain('Never advise changing medication');expect(JSON.stringify(call[0])).toContain('Rain forms');expect(JSON.stringify(call[0])).toContain('peanut allergy');expect(call[2]).toEqual([]);expect(f.care.command).not.toHaveBeenCalled();
});
it('reuses the exact first Heart part for a repeated source-detail question and still refuses stale speech',async()=>{
 const f=fixture(),id=await f.open();await f.turn(id,'Recommend breakfast.');const first=await f.turn(id,'How do I make it?');await f.service.preparedAudio(id,f.session,first.reply_id,splitSpeechParts(first.text,72)[0],new AbortController().signal);const count=f.prepare.mock.calls.length;
 const repeated=await f.turn(id,'How do I make it?');expect(repeated.text).toBe(first.text);expect(f.prepare).toHaveBeenCalledTimes(count);f.today.profile.preferences='No eggs';await expect(f.service.preparedAudio(id,f.session,repeated.reply_id,splitSpeechParts(repeated.text,72)[0],new AbortController().signal)).rejects.toMatchObject({code:'prepared_meal_changed'});
});
it('does not permit a different actor to use the experiment',async()=>{
 const f=fixture(true,true);await expect(f.service.start(f.session)).rejects.toMatchObject({code:'experiment_owner_only'});expect(f.respond).not.toHaveBeenCalled();
});
