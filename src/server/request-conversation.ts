import { z } from 'zod';
import { taskRequestCommandSchema, taskRequestDraftSchema, type TaskRequestCommand, type TaskRequestWorkspace } from '../shared/task-request-contracts.js';
import type { TaskRequestService } from './task-requests.js';
import type { Session } from './session.js';
import { ApiError } from './errors.js';

export type RequestConversationService = Pick<TaskRequestService, 'workspace'|'review'|'command'|'receipt'|'authorityRevision'>;
export interface RequestReview { command: TaskRequestCommand; text: string; phrase: string }
const policy = `Task requests are invitations, never assignments. Only the addressed client can accept. Family and administrators cannot accept for them. Use the current role and capabilities, never spoken identity claims. Ask for the task name, priority, requested date/time and estimated effort/travel; do not invent missing details. Check review_task_request for bounded schedule/capacity feedback without asking for private appointment details. Free time is not capacity. Unknown client capacity needs a client answer before acceptance. Offer a smaller task, another time or voluntary help when needed. For a decline, ask the client for a short reason in their own words; never invent or penalize a refusal. The app reads the exact action and waits for its specific confirmation phrase after playback. Preparing an action is not a save. A declined request creates help and a scoped administrator flag in-app; no email, external notification or recipient model is triggered. Never claim a task was performed because a request was accepted. Read-only request facts can be searched when omitted. Access sharing is available by buttons only.`;
export const requestPolicy = policy;

function allowedTypes(w: TaskRequestWorkspace): TaskRequestCommand['type'][] {
  if(w.role === 'client') return ['accept_request','reject_request','set_day_capacity','resolve_help'];
  const result: TaskRequestCommand['type'][] = [];
  if(['family_friend','administrator'].includes(w.role) && w.capabilities.includes('request_tasks')) result.push('submit_request','withdraw_request');
  if(w.role === 'family_friend' && w.capabilities.includes('help_requests')) result.push('volunteer_help','resolve_help');
  if(w.role === 'administrator' && w.capabilities.includes('review_request_flags')) result.push('acknowledge_flag','resolve_help');
  return result;
}
const options=taskRequestCommandSchema.options;
const omit={idempotency_key:true,confirmed:true} as const;
const voiceSchemas = [
  options[0].omit({...omit,review_token:true}),options[1].omit({...omit,review_token:true,schedule_review_confirmed:true}),
  options[2].omit(omit),options[3].omit(omit),options[4].omit(omit),options[5].omit(omit),options[6].omit(omit),options[7].omit(omit),
] as const;
const voiceSchema = z.discriminatedUnion('type',voiceSchemas);
const jsonSchema = (schema: z.ZodType) => { const {$schema:_,...rest}=z.toJSONSchema(schema);return rest; };
const fn=(name:string,description:string,parameters:Record<string,unknown>)=>({type:'function',name,description,parameters,strict:false});
export function requestDefinitions(workspace:TaskRequestWorkspace) {
  const types=allowedTypes(workspace);
  const schemas=voiceSchemas.filter(s=>types.includes(s.shape.type.value));
  return [
    fn('get_task_requests','Read authorized request, help and flag facts. Search task names when omitted.',jsonSchema(z.object({search:z.string().trim().min(1).max(160).optional()}).strict())),
    ...(['client','family_friend','administrator'].includes(workspace.role) && (workspace.role==='client'||workspace.capabilities.includes('request_tasks')) ?
      [fn('review_task_request','Check a proposed task against the current schedule, known limits and client-stated capacity; this saves nothing.',jsonSchema(taskRequestDraftSchema))]:[]),
    ...(schemas.length?[fn('prepare_request_action','Prepare one exact authorized action for spoken review. No write occurs until the app obtains confirmation. Do not supply a confirmation, receipt key or review token.',{type:'object',properties:{action:{anyOf:schemas.map(jsonSchema)}},required:['action'],additionalProperties:false})]:[]),
  ];
}
export function requestFacts(w:TaskRequestWorkspace,search?:string) {
  const matches=(name:string)=>!search||name.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  const requests=w.requests.filter(r=>matches(r.draft.task_name));
  const helps=w.help_requests.filter(r=>matches(r.task_name));
  const flags=w.administrator_flags.filter(r=>matches(r.task_name));
  return {role:w.role,participant:w.participant,local_date:w.local_date,capabilities:w.capabilities,capacity:w.capacity,
    requests:requests.slice(0,12).map(({requester_label:_,created_at:__,updated_at:___,...r})=>r),request_count:requests.length,omitted_requests:Math.max(0,requests.length-12),
    help_requests:helps.slice(0,8),omitted_help:Math.max(0,helps.length-8),administrator_flags:flags.slice(0,8),omitted_flags:Math.max(0,flags.length-8)};
}
export async function prepareRequestAction(service:RequestConversationService,session:Session,input:unknown,key:string):Promise<RequestReview> {
  const parsed=z.object({action:voiceSchema}).strict().parse(input).action;
  const workspace=await service.workspace(session);
  if(!allowedTypes(workspace).includes(parsed.type)) throw new ApiError(403,'forbidden','This action is not available for your role or sharing permissions.');
  const commandData:any={...parsed,idempotency_key:key,confirmed:true};
  const target='request_id' in parsed ? workspace.requests.find(r=>r.id===parsed.request_id) : undefined;
  const help='help_id' in parsed ? workspace.help_requests.find(r=>r.id===parsed.help_id) : undefined;
  const flag='flag_id' in parsed ? workspace.administrator_flags.find(r=>r.id===parsed.flag_id) : undefined;
  let text:string,phrase:string;
  const exact=(item:{revision:number}|undefined,allowed:boolean|undefined)=>{
    if(!item||!allowed)throw new ApiError(403,'forbidden','That action is not available. Read the current request first.');
    if('expected_revision' in parsed && item.revision!==parsed.expected_revision)throw new ApiError(409,'conflict','That request changed. Review it again.');
  };
  const draftText=(draft:z.infer<typeof taskRequestDraftSchema>)=>`${draft.task_name}, ${draft.priority} priority, on ${draft.requested_date} at ${draft.requested_time} (${draft.participant_time_zone}), ${draft.estimated_duration_minutes===null?'duration still to discuss':draft.estimated_duration_minutes+' minutes'}, plus ${draft.travel_minutes} minutes of travel${draft.notes?'. Note: '+draft.notes:''}`;
  if(parsed.type==='submit_request'||parsed.type==='accept_request') {
    if(parsed.type==='accept_request')exact(target,target?.can_accept);
    const review=await service.review(session,parsed.draft);
    if(review.blockers.length)throw new ApiError(409,'capacity_review',review.blockers.join(' '));
    if(parsed.type==='accept_request'&&!review.can_accept)throw new ApiError(409,'capacity_unknown','Please discuss the task duration and how much feels manageable that day first.');
    commandData.review_token=review.review_token;
    if(parsed.type==='accept_request')commandData.schedule_review_confirmed=true;
    phrase=parsed.type==='submit_request'?'send this request':'accept this request';
    text=parsed.type==='submit_request'?`Ask ${workspace.participant.display_name} to consider ${draftText(parsed.draft)}. Only they can accept. ${review.warnings.join(' ')}`:
      `Accept ${draftText(parsed.draft)}? Please check that meals, rest, travel and any assistance fit. Acceptance schedules the task; it does not record completion.`;
  } else if(parsed.type==='reject_request') {
    exact(target,target?.can_reject);phrase='decline this request';
    text=`Decline ${target!.draft.task_name}? Your reason is: ${parsed.reason}. This shares a help request with authorized family and flags it for the administrator. It adds no task.`;
  } else if(parsed.type==='withdraw_request') {
    exact(target,target?.can_withdraw);phrase='withdraw this request';text=`Withdraw your request for ${target!.draft.task_name}?`;
  } else if(parsed.type==='volunteer_help') {
    exact(help,help?.can_volunteer);phrase='volunteer for this help';text=`Volunteer to help with ${help!.task_name}? This does not assign a task to the client.`;
  } else if(parsed.type==='resolve_help') {
    exact(help,help?.can_resolve);phrase='resolve this help';text=`Resolve help for ${help!.task_name}? Outcome: ${parsed.resolution}. This does not record a completed client activity.`;
  } else if(parsed.type==='acknowledge_flag') {
    exact(flag,flag?.can_acknowledge);phrase='acknowledge this flag';text=`Acknowledge the help flag for ${flag!.task_name}? This leaves the help open.`;
  } else {
    phrase='save my capacity';text=`Save your choice of ${parsed.available_minutes} minutes for additional requests on ${parsed.local_date}, with ${parsed.rest_minutes} minutes of rest between activities? You can change this later.`;
  }
  text+=` Say ${phrase} to confirm, or ask for a change.`;
  if(text.length>1500)throw new ApiError(409,'review_too_long','This request needs a screen review. Open Requests to review it.');
  return {command:taskRequestCommandSchema.parse(commandData),text,phrase};
}
export function requestReceiptText(result:string) {
  const texts:Record<string,string>={submitted:'Your request is saved for the client to review.',accepted:'The accepted task is saved in the day plan.',rejected:'Your decline is saved. A help request and administrator flag are now open.',withdrawn:'Your request is withdrawn.',volunteered:'Your offer to help is saved.',resolved:'The help outcome is saved.',acknowledged:'The flag is acknowledged.',capacity_saved:'Your capacity choice is saved.'};
  const commandResults:Record<string,string>={submit_request:'submitted',accept_request:'accepted',reject_request:'rejected',withdraw_request:'withdrawn',volunteer_help:'volunteered',resolve_help:'resolved',acknowledge_flag:'acknowledged',set_day_capacity:'capacity_saved'};
  return texts[commandResults[result]??result]??'Your request change is saved.';
}
