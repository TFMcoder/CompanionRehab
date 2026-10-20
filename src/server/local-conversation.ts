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
 day:['add_client_task','add_local_appointment','set_intake_timing','set_prompt_preferences','set_routine_choices','decide_carryover','record_significant_handoff','correct_significant_handoff','review_significant_handoff','respond_prompt','start_task_focus','pause_task_focus','resume_task_focus','finish_task_focus'],programs:['start_program','pause_program','resume_program','end_program','report_program_step','correct_program_step'],support:[]};
const otherActions={meals:['upsert_pantry','remove_pantry','add_grocery','update_grocery','mark_grocery_acquired'],day:[],programs:[],support:['set_support_notifications','mark_support_notification_read']};
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
 if(input.section==='day'){const w=await features.day.workspace(session,input.before);return {local_date:w.local_date,day_revision:w.day_revision,carryover:bounded(w.carryover,c=>c.task.title,8),history_truncated:w.history_truncated,preferences:w.preferences,intake_timing:w.intake_timing,routine:w.routine,routine_suggestions:w.routine_suggestions,handoffs:bounded(w.handoffs??[],h=>h.summary,20),handoff_history:bounded(w.handoff_history??[],h=>h.summary,20),prompts:bounded(w.prompts??[],p=>p.message,12),focus:w.focus??null,focus_options:bounded(w.focus_options??[],task=>task.title,20)};}
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
  if(c.type==='add_client_task'){
   if(!care)throw new ApiError(503,'unavailable','Task choices are unavailable.');const today=await care.today(session);if(today.profile?.revision!==c.expected_profile_revision)throw new ApiError(409,'conflict','Review the current task choices again.');
   text=`Save a new task choice: ${c.title}, ${c.urgency} priority, on ${c.scheduled_date}${c.scheduled_time?' at '+c.scheduled_time:', without a time set'}, ${today.profile.time_zone}${c.duration_minutes?', for '+c.duration_minutes+' minutes':''}. This adds a task choice, not an accepted day plan or completion report.`;
  }else if(c.type==='add_local_appointment'){
   if(!care)throw new ApiError(503,'unavailable','Appointments are unavailable.');const today=await care.today(session),zone=today.profile!.time_zone;
   text=`Save ${c.title} in your local day calendar for ${new Intl.DateTimeFormat('en-CA',{timeZone:zone,dateStyle:'full',timeStyle:'short'}).format(new Date(c.starts_at))}, ${zone}. This does not create an Outlook invitation or report attendance.`;
  }else if(c.type==='decide_carryover'){const w2=c.source_date<w.local_date?await features.day.workspace(session,new Date(Date.parse(c.source_date+'T12:00:00Z')+86400000).toISOString().slice(0,10)):w;const item=w2.carryover.find(i=>i.activity_id===c.source_activity_id&&i.source_plan_id===c.source_plan_id&&i.revision===c.source_revision);if(!item)throw new ApiError(409,'conflict','Review the unfinished task again.');text=`For ${item.task.title} from ${item.source_date}: ${c.decision==='help'?'record that you need help':c.decision==='cancel'?'record that it is no longer needed':c.decision==='unresolved'?'leave it for later review':`propose it for today, ${c.urgency} priority${c.scheduled_time?`, at ${c.scheduled_time}`:', without a set time'}${c.duration_minutes?`, for ${c.duration_minutes} minutes`:''}`}. ${c.note}`;}
  else if(c.type==='set_intake_timing'){
   if((w.intake_timing?.revision??0)!==c.expected_revision)throw new ApiError(409,'conflict','Review the latest food timing choices.');
   text=`Wait at least ${c.preferences.full_meal_spacing_minutes} minutes after a reported full meal before automatically suggesting another. If you choose food check-ins, check after ${c.preferences.intake_report_check_minutes} minutes without a report during your day window. These are your planning preferences, not clinical instructions. Reminder consent and quiet hours still apply.`;
  }
  else if(c.type==='set_prompt_preferences'){const p=c.preferences;text=`${p.enabled?'Enable':'Disable'} reminders. Food check-ins ${p.food_check_ins?'on':'off'}. Meal times: ${Object.entries(p.meal_times).map(([slot,time])=>`${slot}: ${time??'off'}`).join(', ')}. Appointments: ${p.appointment_lead_minutes} minutes before. Quiet from ${p.quiet_start} to ${p.quiet_end}. Spoken reminders ${p.foreground_speech?'on':'off'} while the page is open; device notifications ${p.browser_notifications?'on':'off'}.`;}
  else if(c.type==='respond_prompt'){
   const prompt=w.prompts.find(item=>item.id===c.prompt_id&&(item.response_revision??0)===c.expected_revision&&['pending','claimed','delivered'].includes(item.state)&&item.response!=='declined');
   if(!prompt)throw new ApiError(409,'conflict','Review the current reminder before responding.');
   if((c.decision==='snooze')!==(c.snooze_minutes!==null))throw new ApiError(400,'invalid_input','Choose a snooze interval or decline this reminder.');
   text=`${c.decision==='snooze'?`Snooze for ${c.snooze_minutes} minutes`:'Decline'} this reminder: “${prompt.message}”. This does not record eating or task completion.`;
  }
  else if(c.type==='start_task_focus'){
   if(!w.preferences.enabled)throw new ApiError(409,'conflict','Choose your reminder settings before agreeing to a focus check-in.');
   if(w.focus)throw new ApiError(409,'conflict','Review the current task session before starting another.');
   const task=w.focus_options?.find(item=>item.activity_id===c.activity_id&&item.activity_revision===c.expected_activity_revision&&item.source_version===c.expected_activity_version);
   if(!task)throw new ApiError(409,'conflict','Review the current task and its timing before starting.');
   text=`Start a task session for “${task.title}”, with a check-in interval of ${c.interval_minutes} minutes. This records your stated start, not continuous work or completion. Reminder delivery follows your chosen settings.`;
  }
  else if(c.type==='pause_task_focus'||c.type==='resume_task_focus'||c.type==='finish_task_focus'){
   if(c.type==='resume_task_focus'&&!w.preferences.enabled)throw new ApiError(409,'conflict','Choose your reminder settings before resuming a focus check-in.');
   const focus=w.focus;
   if(!focus||focus.id!==c.focus_id||focus.revision!==c.expected_revision||c.type==='pause_task_focus'&&focus.state!=='active'||c.type==='resume_task_focus'&&focus.state!=='paused')throw new ApiError(409,'conflict','Review the current task session before changing it.');
   text=c.type==='pause_task_focus'?`Pause your task session for “${focus.title}”. Its focus reminder will pause too.`
    :c.type==='resume_task_focus'?`Resume your task session for “${focus.title}”, with a check-in interval of ${c.interval_minutes} minutes. This records your stated restart, not uninterrupted work. Reminder delivery follows your chosen settings.`
    :`Finish your task session for “${focus.title}”. This stops its focus reminder and does not record the task as completed.`;
  }
  else if(c.type==='record_significant_handoff')text=`Remember this significant event for a later conversation: ${c.summary}. Reported as occurring ${new Intl.DateTimeFormat('en-CA',{timeZone:w.time_zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(c.occurred_at))}. It remains available until reviewed or resolved.`;
  else if(c.type==='correct_significant_handoff'||c.type==='review_significant_handoff'){
   const note=[...(w.handoffs??[]),...(w.handoff_history??[])].find(item=>item.id===c.handoff_id&&item.revision===c.expected_revision);
   if(!note)throw new ApiError(409,'conflict','Review the current significant-event note.');
   text=c.type==='correct_significant_handoff'?`Correct your note from “${note.summary}” to “${c.summary}”, occurring ${new Intl.DateTimeFormat('en-CA',{timeZone:w.time_zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(c.occurred_at))}. Reason: ${c.reason}.`
    :`${c.decision==='resolved'?'Resolve':'Keep available for later conversations'} your note: “${note.summary}”. ${c.note}`;
  }
  else if(c.type==='set_routine_choices'){const current=await features.day.workspace(session);if((current.routine?.revision??0)!==c.expected_revision)throw new ApiError(409,'conflict','Repeat choices changed.');
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
