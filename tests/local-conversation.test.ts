import { afterEach,describe,it,expect,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testAuthority,bindTestInference } from './helpers/inference.js';
import { ConversationService } from '../src/server/conversation.js';
import { localActionSchema,prepareLocalAction,readLocalWorkflow } from '../src/server/local-conversation.js';
import type { CareService } from '../src/server/care-access.js';
import type { Reasoner } from '../src/server/plan-reasoner.js';
import type { LocalFeatures } from '../src/server/local-features.js';
import type { Session } from '../src/server/session.js';
import type { Today } from '../src/shared/contracts.js';

const session:Session={user_id:randomUUID(),session_id:randomUUID(),issued_at:1,expires_at:9999999999,access_token:'synthetic',refresh_token:'synthetic'};
const today:Today={profile:{id:session.user_id,display_name:'Synthetic',time_zone:'America/Toronto',preferences:'',revision:1},local_date:'2026-10-13',tasks:[],meal_options:[],checkin:null};
const action={family:'meals',command:{type:'add_grocery',item:{name:'Synthetic asparagus',amount:1,unit:'bunch'},proposal_id:null,expected_proposal_revision:null}};
const response=(name:string,args:unknown)=>({completed:true,model:'gpt-6-sol',effort:'high',text:'',output:[{type:'function_call',name,call_id:randomUUID(),arguments:JSON.stringify(args)}]});
let service:ConversationService|undefined;
afterEach(()=>service?.close());
function make(){
 const care={authorize:vi.fn(async s=>s),authority:()=>testAuthority(session),today:vi.fn(async()=>structuredClone(today))} as unknown as CareService;
 const receipts=new Map(),command=vi.fn(async(_s,c)=>{const result={command_id:c.idempotency_key,result:{saved:true},replayed:false};receipts.set(c.idempotency_key,result);return result;});
 const features={authorityRevision:vi.fn(async()=> 'grant1'),meals:{workspace:vi.fn(async()=>({can_edit:true,pantry:[],groceries:[],proposals:[],accepted_meals:[]})),command,receipt:vi.fn(async(_s,key)=>receipts.get(key)??null)}} as unknown as LocalFeatures;
 const respond=vi.fn().mockResolvedValue(response('prepare_local_action',action));
 service=new ConversationService(care,{bind:bindTestInference,respond} as Reasoner,session.user_id,()=>new Date('2026-10-13T14:00:00Z'),undefined,undefined,undefined,undefined,features);
 return {care,features,respond,command,receipts,service};
}
describe('bounded local workflows in Nancy voice',()=>{
 it('performs no write until exact confirmation after playback, then deduplicates the turn',async()=>{
  const {service,command}=make(),start=await service.start(session);
  const review=await service.turn(start.session_id,session,randomUUID(),'Add asparagus to the list');
  expect(review.text).toContain('1 bunch Synthetic asparagus');expect(command).not.toHaveBeenCalled();
  await service.played(start.session_id,session,review.reply_id);
  const id=randomUUID(),saved=await service.turn(start.session_id,session,id,'save this choice');
  expect(saved.changed).toBe(true);expect(command).toHaveBeenCalledTimes(1);
  expect(await service.turn(start.session_id,session,id,'save this choice')).toEqual(saved);expect(command).toHaveBeenCalledTimes(1);
 });
 it('interruption removes consent and cannot cause a late confirmation write',async()=>{
  const {service,command}=make(),start=await service.start(session),review=await service.turn(start.session_id,session,randomUUID(),'Add asparagus');
  service.interrupt(start.session_id,session);
  expect(()=>service.played(start.session_id,session,review.reply_id)).toThrow('That reply is no longer available.');
  await service.turn(start.session_id,session,randomUUID(),'save this choice');expect(command).not.toHaveBeenCalled();
 });
 it('uses the existing receipt after a lost write response instead of sending twice',async()=>{
  const {service,command,receipts}=make();command.mockImplementationOnce(async(_s,c)=>{receipts.set(c.idempotency_key,{command_id:c.idempotency_key,result:{saved:true},replayed:false});throw new Error('synthetic network interruption');});
  const start=await service.start(session),review=await service.turn(start.session_id,session,randomUUID(),'Add asparagus');await service.played(start.session_id,session,review.reply_id);
  expect((await service.turn(start.session_id,session,randomUUID(),'save this choice')).changed).toBe(true);expect(command).toHaveBeenCalledTimes(1);
 });
 it('invalidates old review when any scoped sharing revision changes',async()=>{
  const {service,features,command}=make(),start=await service.start(session),review=await service.turn(start.session_id,session,randomUUID(),'Add asparagus');await service.played(start.session_id,session,review.reply_id);
  vi.mocked(features.authorityRevision).mockResolvedValue('revoked');
  await expect(service.turn(start.session_id,session,randomUUID(),'save this choice')).rejects.toMatchObject({status:403});expect(command).not.toHaveBeenCalled();
 });
 it('rejects model-supplied approval, capability edits and client actions in a family context',async()=>{
  const {features}=make();
  expect(()=>localActionSchema({family:'programs',action:'approve_program'},true)).toThrow();
  expect(()=>localActionSchema({family:'meals',action:'accept_meal'},false)).toThrow();
  expect(()=>localActionSchema({family:'support',action:'set_support_share'},false)).toThrow();
  await expect(prepareLocalAction(features,session,{...action,command:{...action.command,confirmed:true}},true,randomUUID())).rejects.toMatchObject({status:400});
  await expect(readLocalWorkflow(features,session,{section:'day'},false)).rejects.toMatchObject({status:403});
 });
 it('retrieves individual action schemas without an approval flag or receipt key',()=>{
  const schema=localActionSchema({family:'programs',action:'report_program_step'},true);
  expect(schema.properties.step_id).toBeDefined();expect(schema.properties.idempotency_key).toBeUndefined();expect(schema.properties.confirmed).toBeUndefined();
 });
 it('reads back a program correction using its step-result revision, not its run revision',async()=>{
  const {features}=make(),runId=randomUUID(),versionId=randomUUID();
  features.programs={workspace:vi.fn(async()=>({
    runs:[{id:runId,revision:4,version_id:versionId,results:[{step_id:'prepare',revision:1,outcome:'completed'}]}],
    versions:[{id:versionId,title:'Synthetic routine',steps:[{id:'prepare',title:'Prepare'}]}],conflicts:[],
  }))} as unknown as LocalFeatures['programs'];
  const review=await prepareLocalAction(features,session,{family:'programs',command:{type:'correct_program_step',
    run_id:runId,step_id:'prepare',expected_revision:1,outcome:'completed',reason:'',difficulty:'Mild',
    assistance:'',notes:'Synthetic correction',correction_reason:'Clarify factual report'}},true,randomUUID());
  expect(review.text).toContain('Correct Prepare in Synthetic routine as completed');
  expect(review.command.type).toBe('correct_program_step');
 });
 it('reads the selected approved version conflicts before starting a new run',async()=>{
  const {features}=make(),versionId=randomUUID(),appointmentId=randomUUID();
  features.programs={workspace:vi.fn(async()=>({runs:[],versions:[{id:versionId,title:'Synthetic routine',version:1,current:true,approved:true}],conflicts:[],
   conflicts_by_version:{[versionId]:[{id:appointmentId,title:'Synthetic appointment',starts_at:'2026-10-13T14:30:00Z'}]}}))} as unknown as LocalFeatures['programs'];
  const review=await prepareLocalAction(features,session,{family:'programs',command:{type:'start_program',version_id:versionId,local_date:'2026-10-13',acknowledged_conflicts:[appointmentId]}},true,randomUUID());
  expect(review.text).toContain('Synthetic appointment at 2026-10-13T14:30:00Z');
 });
 it('reads back an exact current reminder response without claiming intake or completion',async()=>{
  const {features}=make(),promptId=randomUUID();
  features.day={workspace:vi.fn(async()=>({prompts:[{id:promptId,message:'Have you eaten recently?',response_revision:2,state:'delivered'}]}))} as unknown as LocalFeatures['day'];
  const command={type:'respond_prompt',prompt_id:promptId,expected_revision:2,decision:'snooze',snooze_minutes:15};
  const review=await prepareLocalAction(features,session,{family:'day',command},true,randomUUID());
  expect(review.text).toContain('Snooze for 15 minutes');expect(review.text).toContain('does not record eating or task completion');
  await expect(prepareLocalAction(features,session,{family:'day',command:{...command,expected_revision:1}},true,randomUUID())).rejects.toMatchObject({status:409});
  await expect(prepareLocalAction(features,session,{family:'day',command:{...command,decision:'decline'}},true,randomUUID())).rejects.toMatchObject({status:400});
 });
 it('reviews explicit focus starts and state changes without treating session finish as completion',async()=>{
  const {features}=make(),activityId=randomUUID(),focusId=randomUUID(),sourceVersion='a'.repeat(64);
  const workspace=vi.fn().mockResolvedValue({preferences:{enabled:true},focus:null,focus_options:[{activity_id:activityId,title:'Synthetic sorting',activity_revision:0,source_version:sourceVersion}]});
  features.day={workspace} as unknown as LocalFeatures['day'];
  const command={type:'start_task_focus',activity_id:activityId,expected_activity_revision:0,expected_activity_version:sourceVersion,interval_minutes:25};
  expect((await prepareLocalAction(features,session,{family:'day',command},true,randomUUID())).text).toContain('check-in interval of 25 minutes');
  await expect(prepareLocalAction(features,session,{family:'day',command:{...command,expected_activity_version:'b'.repeat(64)}},true,randomUUID())).rejects.toMatchObject({status:409});
  workspace.mockResolvedValue({preferences:{enabled:true},focus:{id:focusId,title:'Synthetic sorting',revision:1,state:'active'}});
  await expect(prepareLocalAction(features,session,{family:'day',command},true,randomUUID())).rejects.toMatchObject({status:409});
  expect((await prepareLocalAction(features,session,{family:'day',command:{type:'pause_task_focus',focus_id:focusId,expected_revision:1}},true,randomUUID())).text).toContain('focus reminder will pause');
  await expect(prepareLocalAction(features,session,{family:'day',command:{type:'resume_task_focus',focus_id:focusId,expected_revision:1,interval_minutes:20}},true,randomUUID())).rejects.toMatchObject({status:409});
  workspace.mockResolvedValue({preferences:{enabled:true},focus:{id:focusId,title:'Synthetic sorting',revision:2,state:'paused'}});
  expect((await prepareLocalAction(features,session,{family:'day',command:{type:'resume_task_focus',focus_id:focusId,expected_revision:2,interval_minutes:20}},true,randomUUID())).text).toContain('not uninterrupted work');
  expect((await prepareLocalAction(features,session,{family:'day',command:{type:'finish_task_focus',focus_id:focusId,expected_revision:2}},true,randomUUID())).text).toContain('does not record the task as completed');
 });
});
