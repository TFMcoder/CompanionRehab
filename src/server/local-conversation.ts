import { z } from 'zod';
import type { LocalFeatures } from './local-features.js';
import type { Session } from './session.js';
import type { CareService } from './care-access.js';
import type { OutputItem } from './chatgpt-plan/inference.js';
import { ApiError } from './errors.js';
import { mealGroceryCommandSchema, type MealGroceryCommand } from '../shared/meal-grocery-contracts.js';
import { localDayCommandSchema, type LocalDayCommand } from '../shared/local-day-contracts.js';
import { programCommandSchema, type ProgramCommand } from '../shared/program-contracts.js';
import { supportCommandSchema, type SupportCommand } from '../shared/support-contracts.js';

const family=z.enum(['meals','day','programs','support']);
type Family=z.infer<typeof family>;
type Command=MealGroceryCommand|LocalDayCommand|ProgramCommand|SupportCommand;
export interface LocalReview {family:Family;command:Command;text:string;phrase:string}
const schemas={meals:mealGroceryCommandSchema,day:localDayCommandSchema,programs:programCommandSchema,support:supportCommandSchema};
const clientActions={meals:['propose_meal','accept_meal','upsert_pantry','remove_pantry','add_grocery','update_grocery','mark_grocery_acquired'],
 day:['set_prompt_preferences','set_routine_choices','decide_carryover'],programs:['start_program','pause_program','resume_program','end_program','report_program_step','correct_program_step'],support:[]};
const otherActions={meals:['upsert_pantry','remove_pantry','add_grocery','update_grocery','mark_grocery_acquired'],day:[],programs:[],support:['set_support_notifications','mark_support_notification_read']};
export const localWorkflowPolicy='Optional foreground Hey Nancy and consented local meal/appointment reminders are available through the UI; no locked-phone listener or closed-page speech. Use get_local_workflow for meal drafts/pantry, unfinished tasks, repeat choices, reminders, approved programs or shared activity. Retrieve get_local_action_schema for an action before preparing it. prepare_local_action only reads back a proposed change; the application waits for the exact spoken confirmation. Never configure grants, approve protocols or scoring rules through a model tool. Ask about unfinished work without treating missing data as failure. Meal choices need client acceptance before use in a day plan; meal choice acceptance is not a meal report. Ask about ingredients and portions, retrieve repository nutrition references, and add only confirmed missing ingredients. Program instructions are pinned human-approved content; never improvise rehab.';
const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const tool=(name:string,description:string,parameters:Record<string,unknown>):OutputItem=>({type:'function',name,description,parameters,strict:false});
export function localWorkflowTools(client:boolean):OutputItem[]{return [
 tool('get_local_workflow','Read a small authorized workflow snapshot. Search by name if items were omitted.',object({section:{type:'string',enum:client?['meals','day','programs','support']:['meals','support']},search:{type:'string',maxLength:160},before:{type:'string',description:'Optional YYYY-MM-DD for earlier day review.'}},['section'])),
 tool('get_local_action_schema','Get exact typed fields for an allowed action. Never guess revisions or identifiers.',object({family:{type:'string',enum:client?['meals','day','programs']:['meals','support']},action:{type:'string',enum:Object.values(client?clientActions:otherActions).flat()}})),
 tool('prepare_local_action','Prepare one exact change for client-spoken review. No write until the application receives confirmation after full playback.',object({family:{type:'string',enum:client?['meals','day','programs']:['meals','support']},command:{type:'object',description:'Exact fields from get_local_action_schema, excluding idempotency_key and confirmed.'}})),
 ];}
function allowed(client:boolean,f:Family,type:string){if(!((client?clientActions:otherActions)[f] as readonly string[]).includes(type))throw new ApiError(403,'forbidden','Use the authorized setup screen for this choice.');}
export function localActionSchema(raw:unknown,client:boolean){const input=z.object({family,action:z.string().max(80)}).strict().parse(raw);allowed(client,input.family,input.action);
 const option=schemas[input.family].options.find(o=>o.shape.type.value===input.action)!;
 const result=z.toJSONSchema(option) as any;delete result.$schema;delete result.properties.idempotency_key;delete result.properties.confirmed;result.required=result.required.filter((k:string)=>k!=='idempotency_key'&&k!=='confirmed');return result;
}
export async function readLocalWorkflow(features:LocalFeatures,session:Session,raw:unknown,client:boolean){
 const input=z.object({section:family,search:z.string().trim().min(1).max(160).optional(),before:z.iso.date().optional()}).strict().parse(raw);
 if(!client&&!['meals','support'].includes(input.section))throw new ApiError(403,'forbidden','That workflow is private to the client.');
 const matches=(name:string)=>!input.search||name.toLocaleLowerCase().includes(input.search.toLocaleLowerCase());
 const bounded=<T>(items:T[],name:(v:T)=>string,limit=12)=>{const filtered=items.filter(v=>matches(name(v)));return {items:filtered.slice(0,limit),total:filtered.length,omitted:Math.max(0,filtered.length-limit)};};
 if(input.section==='meals'){const w=await features.meals.workspace(session);return {can_edit:w.can_edit,pantry:bounded(w.pantry,i=>i.name),groceries:bounded(w.groceries,i=>i.name),proposals:bounded(w.proposals,p=>p.draft.name,3),accepted:bounded(w.accepted_meals,p=>p.name,3)};}
 if(input.section==='day'){const w=await features.day.workspace(session,input.before);return {local_date:w.local_date,day_revision:w.day_revision,carryover:bounded(w.carryover,c=>c.task.title,8),history_truncated:w.history_truncated,preferences:w.preferences,routine:w.routine,routine_suggestions:w.routine_suggestions};}
 if(input.section==='support'){const w=await features.support.workspace(session);return {date:w.local_date,items:bounded(w.items,i=>i.title),notifications:bounded(w.notifications,i=>i.title),preferences:w.preferences};}
 const w=await features.programs.workspace(session);return {local_date:w.local_date,versions:bounded(w.versions.map(v=>({id:v.id,title:v.title,kind:v.kind,version:v.version,approved:v.approved,current:v.current,steps:v.steps.length})),v=>v.title),runs:w.runs.slice(0,5).map(r=>({...r,results:r.results.slice(-2)})),conflicts_by_version:w.conflicts_by_version,capacity:w.capacity};
}
export async function prepareLocalAction(features:LocalFeatures,session:Session,raw:unknown,client:boolean,key:string,care?:CareService):Promise<LocalReview>{
 const input=z.object({family,command:z.record(z.string(),z.unknown())}).strict().parse(raw);
 const type=z.string().parse(input.command.type);allowed(client,input.family,type);
 if('idempotency_key' in input.command||'confirmed' in input.command)throw new ApiError(400,'invalid_input','The application supplies confirmation and the receipt key.');
 const command=schemas[input.family].parse({...input.command,idempotency_key:key,...(['day','programs'].includes(input.family)?{confirmed:true}:{})}) as Command;
 let text='';
 if(input.family==='meals'){
  const w=await features.meals.workspace(session),c=command as MealGroceryCommand;
  if(c.type==='propose_meal')text=`Save a meal suggestion for ${c.draft.name}, for ${c.draft.slots.join(' and ')}. Portion: ${c.draft.portion}. Ingredients: ${c.draft.ingredients.map(i=>`${i.amount??''} ${i.unit??''} ${i.name}`.trim()).join(', ')}. ${c.draft.preference_notes}`;
  else if(c.type==='accept_meal'){const p=w.proposals.find(p=>p.id===c.proposal_id&&p.revision===c.expected_revision);if(!p)throw new ApiError(409,'conflict','Review the latest meal suggestion.');text=`Accept ${p.draft.name} as a meal choice, portion ${p.draft.portion}, for ${p.draft.slots.join(' and ')}. Ingredients: ${p.draft.ingredients.map(i=>`${i.amount??''} ${i.unit??''} ${i.name}`.trim()).join(', ')}. ${p.draft.preference_notes} This does not say you ate it.`;}
  else if(c.type==='add_grocery'||c.type==='upsert_pantry'||c.type==='update_grocery')text=`${c.type==='add_grocery'?'Add to your grocery list':c.type==='update_grocery'?'Update your grocery item':'Save in your pantry'}: ${c.item.amount??''} ${c.item.unit??''} ${c.item.name}.`;
  else if(c.type==='remove_pantry'||c.type==='mark_grocery_acquired'){const item=(c.type==='remove_pantry'?w.pantry:w.groceries).find(i=>i.id===c.item_id&&i.revision===c.expected_revision);if(!item)throw new ApiError(409,'conflict','Review the latest item.');text=c.type==='remove_pantry'?`Remove ${item.name} from your pantry.`:`Mark ${item.name} as acquired.`;}
 }else if(input.family==='day'){
  const w=await features.day.workspace(session),c=command as LocalDayCommand;
  if(c.type==='decide_carryover'){const w2=c.source_date<w.local_date?await features.day.workspace(session,new Date(Date.parse(c.source_date+'T12:00:00Z')+86400000).toISOString().slice(0,10)):w;const item=w2.carryover.find(i=>i.activity_id===c.source_activity_id&&i.source_plan_id===c.source_plan_id&&i.revision===c.source_revision);if(!item)throw new ApiError(409,'conflict','Review the unfinished task again.');text=`For ${item.task.title} from ${item.source_date}: ${c.decision==='help'?'record that you need help':c.decision==='cancel'?'record that it is no longer needed':c.decision==='unresolved'?'leave it for later review':`propose it for today, ${c.urgency} priority${c.scheduled_time?`, at ${c.scheduled_time}`:', without a set time'}${c.duration_minutes?`, for ${c.duration_minutes} minutes`:''}`}. ${c.note}`;}
  else if(c.type==='set_prompt_preferences'){const p=c.preferences;text=`${p.enabled?'Enable':'Disable'} reminders. Meal times: ${Object.entries(p.meal_times).map(([slot,time])=>`${slot}: ${time??'off'}`).join(', ')}. Appointments: ${p.appointment_lead_minutes} minutes before. Quiet from ${p.quiet_start} to ${p.quiet_end}. Spoken reminders ${p.foreground_speech?'on':'off'} while the page is open; device notifications ${p.browser_notifications?'on':'off'}.`;}
  else {const current=await features.day.workspace(session);if((current.routine?.revision??0)!==c.expected_revision)throw new ApiError(409,'conflict','Repeat choices changed.');
   const today=await care?.today(session);if(!today)throw new ApiError(503,'review_unavailable','Review these choices in Day review.');
   const tasks=c.selections.task_ids.map(id=>today.tasks.find(t=>t.id===id)?.title),meals=c.selections.meals.map(m=>{const choice=today.meal_options.find(o=>o.id===m.option_id&&o.slots.includes(m.slot));return choice?`${m.slot}: ${choice.name}`:undefined;});
   if(tasks.some(t=>!t)||meals.some(m=>!m))throw new ApiError(409,'conflict','Choose current tasks and meals.');
   text=`Save repeat-day suggestions for ${tasks.length?tasks.join(', '):'no tasks'}, and ${meals.length?meals.join(', '):'no meals'}, on ${c.selections.weekdays.map(d=>['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d]).join(', ')}. You still review each day's plan.`;}
 }else if(input.family==='programs'){
  const w=await features.programs.workspace(session),c=command as ProgramCommand;
  if(c.type==='start_program'){const v=w.versions.find(v=>v.id===c.version_id&&v.current&&v.approved);if(!v)throw new ApiError(409,'conflict','Choose a current approved routine.');text=`Start ${v.title}, version ${v.version}, today. This records a start, not completion.`;}
  else if('run_id' in c){const r=w.runs.find(r=>r.id===c.run_id&&(c.type==='correct_program_step'?r.results.some(s=>s.step_id===c.step_id&&s.revision===c.expected_revision):r.revision===c.expected_revision));if(!r)throw new ApiError(409,'conflict','Review the current routine step.');const title=w.versions.find(v=>v.id===r.version_id)?.title??'your routine';
   if(c.type==='report_program_step'||c.type==='correct_program_step'){const step=w.versions.find(v=>v.id===r.version_id)?.steps.find(s=>s.id===c.step_id);if(!step)throw new ApiError(400,'invalid_input','Choose a known step.');text=`${c.type==='correct_program_step'?'Correct':'Record'} ${step.title} in ${title} as ${c.outcome}. ${c.reason} Difficulty: ${c.difficulty||'none reported'}. Help: ${c.assistance||'none reported'}. ${c.notes}${c.type==='correct_program_step'?` Correction reason: ${c.correction_reason}`:''}`;}
   else text=`${c.type==='pause_program'?'Pause':c.type==='end_program'?'End':'Resume'} ${title}.${'reason' in c?` ${c.reason}`:''}`;
  }
  if('acknowledged_conflicts' in c&&c.acknowledged_conflicts.length){const versionId=c.type==='start_program'?c.version_id:'run_id' in c?w.runs.find(r=>r.id===c.run_id)?.version_id:undefined;const currentConflicts=versionId?w.conflicts_by_version[versionId]??[]:w.conflicts;const conflicts=c.acknowledged_conflicts.map(id=>currentConflicts.find(a=>a.id===id));if(conflicts.some(a=>!a))throw new ApiError(409,'conflict','Review the latest appointment conflicts.');text+=` You are acknowledging these schedule conflicts: ${conflicts.map(a=>`${a!.title} at ${a!.starts_at}`).join(', ')}.`;}
 }else {const w=await features.support.workspace(session),c=command as SupportCommand;
  if(c.type==='set_support_notifications')text=`Save your notification choices: task completion ${c.task_completion?'on':'off'}, meal completion ${c.meal_completion?'on':'off'}, task reschedule ${c.task_reschedule?'on':'off'}, meal reschedule ${c.meal_reschedule?'on':'off'}. Quiet hours ${c.quiet_start&&c.quiet_end?`${c.quiet_start} to ${c.quiet_end}`:'off'}, ${c.time_zone}.`;
  else if(c.type==='mark_support_notification_read'){if(!w.notifications.some(n=>n.id===c.notification_id))throw new ApiError(400,'invalid_input','Choose a current notification.');text='Mark this notification as read.';}
 }
 if(!text||text.length>1800)throw new ApiError(400,'review_too_long','Review this change on screen, or use a shorter change.');
 return {family:input.family,command,text:text+' Say “save this choice” to confirm, or tell me what to change.',phrase:'save this choice'};
}
export async function localActionReceipt(features:LocalFeatures,session:Session,review:LocalReview){return features[review.family].receipt(session,review.command.idempotency_key);}
export async function commitLocalAction(features:LocalFeatures,session:Session,review:LocalReview){
 switch(review.family){case 'meals':return features.meals.command(session,review.command as MealGroceryCommand);case 'day':return features.day.command(session,review.command as LocalDayCommand);case 'programs':return features.programs.command(session,review.command as ProgramCommand);case 'support':return features.support.command(session,review.command as SupportCommand);}
}
