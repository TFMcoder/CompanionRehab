import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import type { AppRole } from '../../src/shared/contracts.js';
import type { TaskRequestCommand, TaskRequestDraft, TaskRequestReceipt, TaskRequestWorkspace } from '../../src/shared/task-request-contracts.js';
import type { Session } from '../../src/server/session.js';
import type { RequestConversationService } from '../../src/server/request-conversation.js';

export function requestFixture(role:AppRole='family_friend') {
  const session:Session={session_id:randomUUID(),user_id:randomUUID(),issued_at:1,expires_at:9999999999,access_token:'synthetic',refresh_token:'synthetic'};
  const draft:TaskRequestDraft={task_name:'Synthetic grocery pickup',priority:'medium',requested_date:'2026-10-07',requested_time:'15:00',participant_time_zone:'America/Toronto',estimated_duration_minutes:20,travel_minutes:10,notes:''};
  const requestId=randomUUID(),helpId=randomUUID(),flagId=randomUUID();
  const workspace:TaskRequestWorkspace={actor_id:session.user_id,role,participant:{id:role==='client'?session.user_id:randomUUID(),display_name:'Synthetic Client',time_zone:'America/Toronto'},local_date:'2026-10-07',
    capabilities:role==='administrator'?['request_tasks','read_requests','review_request_flags']:role==='family_friend'?['request_tasks','read_requests','help_requests']:[],capacity:null,sharing:[],
    requests:[{id:requestId,revision:1,requester_id:randomUUID(),requester_role:'family_friend',requester_label:'private-family@example.invalid',draft,status:'pending',requested_at:'2026-10-07T19:00:00Z',accepted_at:null,accepted_draft:null,task_id:null,activity_id:null,reason:null,created_at:'2026-10-07T12:00:00Z',updated_at:'2026-10-07T12:00:00Z',can_accept:role==='client',can_reject:role==='client',can_withdraw:role!=='client'}],
    help_requests:[{id:helpId,request_id:requestId,revision:1,task_name:draft.task_name,draft,reason:'Not today.',status:'unassigned',volunteer_id:null,resolution:null,eligible_helper_count:1,can_volunteer:role==='family_friend',can_resolve:role==='client'||role==='administrator'}],
    administrator_flags:role==='administrator'?[{id:flagId,request_id:requestId,help_id:helpId,revision:1,task_name:draft.task_name,draft,reason:'Not today.',status:'open',can_acknowledge:true}]:[]};
  const receipt=(command:TaskRequestCommand):TaskRequestReceipt=>({command_id:command.idempotency_key,type:command.type,request_id:requestId,help_id:command.type==='reject_request'?helpId:null,flag_id:command.type==='reject_request'?flagId:null,task_id:null,activity_id:null,revision:2,result:command.type,replayed:false});
  const requests:RequestConversationService={workspace:vi.fn(async()=>structuredClone(workspace)),review:vi.fn(async(_s,d)=>({draft:d,review_token:'a'.repeat(64),profile_revision:1,day_revision:0,capacity_revision:1,capacity:{local_date:d.requested_date,available_minutes:60,rest_minutes:10,revision:1},warnings:[],blockers:[],can_accept:true,capacity_known:true,schedule_review_required:false})),
    command:vi.fn(async(_s,c)=>receipt(c)),receipt:vi.fn(async()=>null),authorityRevision:vi.fn(async()=>'request-grant-one')};
  return {session,draft,requestId,helpId,flagId,workspace,requests};
}
