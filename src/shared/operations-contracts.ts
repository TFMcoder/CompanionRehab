import { z } from 'zod';
import { localDate, uuid } from './contracts.js';

export const operationsCommandSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('set_operations_access'),idempotency_key:uuid,actor_id:uuid,expected_revision:z.number().int().nonnegative(),
    can_view:z.boolean(),can_manage_local_issues:z.boolean(),can_view_audit:z.boolean()}).strict(),
  z.object({type:z.literal('note_held_intent'),idempotency_key:uuid,intent_id:uuid,expected_revision:z.number().int().nonnegative(),
    note:z.string().trim().min(1).max(500)}).strict(),
  z.object({type:z.literal('resolve_held_intent_review'),idempotency_key:uuid,intent_id:uuid,expected_revision:z.number().int().positive(),
    note:z.string().trim().min(1).max(500)}).strict(),
]);
export type OperationsCommand=z.infer<typeof operationsCommandSchema>;
export const operationsQuerySchema=z.object({date:localDate.optional(),cursor:z.string().max(2048).optional(),limit:z.number().int().min(1).max(50).optional()}).strict();
export type OperationsQuery=z.infer<typeof operationsQuerySchema>;
export interface OperatorAccess {actor_id:string;label:string;revision:number;can_view:boolean;can_manage_local_issues:boolean;can_view_audit:boolean}
export interface OperationsDay {local_date:string;accepted_plan_version:number|null;planned_tasks:number;planned_meals:number;
  completed_tasks:number;completed_meals:number;deferred_tasks:number;deferred_meals:number;appointments_scheduled:number;source_as_of:string|null}
export interface ConnectorHealth {state:'not_connected';targets:number;linked_resources:number;held_intents:number;failed_syncs:'unknown';last_sync_at:null}
export interface HeldIntentReview {id:string;created_at:string;system:'email'|'calendar'|'pm';provider:string;operation:'notify'|'create'|'update'|'cancel';state:'held';
  review_status:'unreviewed'|'open'|'resolved';review_revision:number;review_note:string|null;reviewed_at:string|null}
export interface OperationsAuditItem {id:string;event_type:string;created_at:string;actor_id:string|null;command_id:string|null}
export interface OperationsWorkspace {role:'client'|'administrator';local_date:string;can_view:boolean;can_manage_local_issues:boolean;can_view_audit:boolean;
  operators:OperatorAccess[];day:OperationsDay|null;connector:ConnectorHealth|null;held_intents:HeldIntentReview[];next_cursor:string|null;
  audit:OperationsAuditItem[];audit_available:boolean}
export interface OperationsReceipt {command_id:string;result:Record<string,unknown>;replayed:boolean}
