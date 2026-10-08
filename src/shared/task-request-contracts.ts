import { z } from 'zod';
import { uuid, type AppRole } from './contracts.js';
import { activityDate } from './activity-contracts.js';

export const requestCapabilities = ['request_tasks', 'read_requests', 'help_requests', 'review_request_flags'] as const;
export type RequestCapability = typeof requestCapabilities[number];
const revision = z.number().int().nonnegative();
export const taskRequestDraftSchema = z.object({
  task_name: z.string().trim().min(1).max(160), priority: z.enum(['high', 'medium', 'low']),
  requested_date: activityDate, requested_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  participant_time_zone: z.string().min(1).max(80),
  estimated_duration_minutes: z.number().int().min(1).max(480).nullable(),
  travel_minutes: z.number().int().min(0).max(480), notes: z.string().trim().max(500),
}).strict();
export type TaskRequestDraft = z.infer<typeof taskRequestDraftSchema>;
const base = { idempotency_key: uuid };
const target = { request_id: uuid, expected_revision: revision };
export const taskRequestCommandSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('submit_request'), draft: taskRequestDraftSchema, review_token: z.string().length(64), confirmed: z.literal(true) }).strict(),
  z.object({ ...base, ...target, type: z.literal('accept_request'), draft: taskRequestDraftSchema, review_token: z.string().length(64), confirmed: z.literal(true), schedule_review_confirmed: z.literal(true) }).strict(),
  z.object({ ...base, ...target, type: z.literal('reject_request'), reason: z.string().trim().min(1).max(500), confirmed: z.literal(true) }).strict(),
  z.object({ ...base, ...target, type: z.literal('withdraw_request'), confirmed: z.literal(true) }).strict(),
  z.object({ ...base, type: z.literal('volunteer_help'), help_id: uuid, expected_revision: revision, confirmed: z.literal(true) }).strict(),
  z.object({ ...base, type: z.literal('resolve_help'), help_id: uuid, expected_revision: revision, resolution: z.string().trim().min(1).max(500), confirmed: z.literal(true) }).strict(),
  z.object({ ...base, type: z.literal('acknowledge_flag'), flag_id: uuid, expected_revision: revision, confirmed: z.literal(true) }).strict(),
  z.object({ ...base, type: z.literal('set_day_capacity'), local_date: activityDate, expected_revision: revision, available_minutes: z.number().int().min(0).max(960), rest_minutes: z.number().int().min(0).max(240), confirmed: z.literal(true) }).strict(),
  z.object({ ...base, type: z.literal('set_request_access'), actor_id: uuid, role: z.enum(['family_friend', 'administrator']), expected_revision: revision,
    capabilities: z.array(z.enum(requestCapabilities)).max(4).refine(v => new Set(v).size === v.length), confirmed: z.literal(true) }).strict(),
]);
export type TaskRequestCommand = z.infer<typeof taskRequestCommandSchema>;
export interface TaskRequestReview {
  draft: TaskRequestDraft; review_token: string; profile_revision: number; day_revision: number; capacity_revision: number;
  warnings: string[]; blockers: string[]; can_accept: boolean; capacity_known: boolean; schedule_review_required: boolean;
  capacity: RequestCapacity|null;
}
export interface TaskRequestItem {
  id: string; revision: number; requester_id: string; requester_role: AppRole; requester_label: string;
  draft: TaskRequestDraft; status: 'pending'|'accepted'|'rejected'|'withdrawn'; requested_at: string;
  accepted_draft: TaskRequestDraft|null; accepted_at: string|null; task_id: string|null; activity_id: string|null;
  reason: string|null; created_at: string; updated_at: string; can_accept: boolean; can_reject: boolean; can_withdraw: boolean;
}
export interface RequestHelpItem {
  id: string; request_id: string; revision: number; task_name: string; reason: string;
  draft: TaskRequestDraft;
  status: 'unassigned'|'volunteered'|'resolved'; volunteer_id: string|null; resolution: string|null;
  eligible_helper_count: number; can_volunteer: boolean; can_resolve: boolean;
}
export interface RequestFlagItem {
  id: string; request_id: string; help_id: string; revision: number; task_name: string; reason: string;
  draft: TaskRequestDraft;
  status: 'open'|'acknowledged'|'resolved'; can_acknowledge: boolean;
}
export interface RequestCapacity { local_date: string; revision: number; available_minutes: number; rest_minutes: number }
export interface RequestAccessItem { actor_id: string; role: 'family_friend'|'administrator'; label: string; revision: number; capabilities: RequestCapability[] }
export interface TaskRequestWorkspace {
  actor_id: string; role: AppRole; participant: { id: string; display_name: string; time_zone: string }; local_date: string;
  capabilities: RequestCapability[]; requests: TaskRequestItem[]; help_requests: RequestHelpItem[]; administrator_flags: RequestFlagItem[];
  capacity: RequestCapacity|null; sharing: RequestAccessItem[];
}
export interface TaskRequestReceipt {
  command_id: string; type: TaskRequestCommand['type']; request_id: string|null; help_id: string|null; flag_id: string|null;
  task_id: string|null; activity_id: string|null; revision: number; result: string; replayed: boolean;
}
