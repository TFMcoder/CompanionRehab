import { z } from 'zod';
import { localDate, uuid } from './contracts.js';

const clockTime=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const supportCommandSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('set_support_share'),idempotency_key:uuid,actor_id:uuid,role:z.enum(['family_friend','administrator','clinician']),
    expected_revision:z.number().int().nonnegative(),share_tasks:z.boolean(),share_meals:z.boolean(),share_progress:z.boolean()}).strict(),
  z.object({type:z.literal('set_support_notifications'),idempotency_key:uuid,expected_revision:z.number().int().nonnegative(),
    task_completion:z.boolean(),meal_completion:z.boolean(),task_reschedule:z.boolean(),meal_reschedule:z.boolean(),
    quiet_start:clockTime.nullable(),quiet_end:clockTime.nullable(),time_zone:z.string().min(1).max(80)}).strict()
    .refine(v=>(v.quiet_start===null)===(v.quiet_end===null),'Set both quiet-hour times or neither'),
  z.object({type:z.literal('mark_support_notification_read'),idempotency_key:uuid,notification_id:uuid}).strict(),
]);
export type SupportCommand=z.infer<typeof supportCommandSchema>;
export interface SupportShare {actor_id:string;role:'family_friend'|'administrator'|'clinician';label:string;share_tasks:boolean;share_meals:boolean;share_progress:boolean;revision:number}
export interface NotificationPreferences {revision:number;task_completion:boolean;meal_completion:boolean;task_reschedule:boolean;meal_reschedule:boolean;quiet_start:string|null;quiet_end:string|null;time_zone:string}
export interface SharedItem {id:string;kind:'task'|'meal';title:string;local_date:string;scheduled_at:string|null;urgency:'high'|'medium'|'low'|null;meal_slot:'breakfast'|'lunch'|'dinner'|null;status:'planned'|'pending'|'completed'|'deferred';occurred_at:string|null}
export interface SupportNotification {id:string;event_id:string;activity_id:string;kind:'task'|'meal';type:'completed'|'rescheduled';title:string;created_at:string;read_at:string|null}
export interface SupportWorkspace {role:string;local_date:string;can_view_tasks:boolean;can_view_meals:boolean;progress_status:'unavailable';
  shares:SupportShare[];preferences:NotificationPreferences|null;items:SharedItem[];next_items_cursor:string|null;
  notifications:SupportNotification[];next_notifications_cursor:string|null;notifications_quiet:boolean}
export interface SupportReceipt {command_id:string;result:Record<string,unknown>;replayed:boolean}
export interface SupportWorkspaceQuery {date?:string;items_cursor?:string;notifications_cursor?:string;limit?:number}
export const supportWorkspaceQuerySchema=z.object({date:localDate.optional(),items_cursor:z.string().max(2048).optional(),notifications_cursor:z.string().max(2048).optional(),limit:z.number().int().min(1).max(50).optional()}).strict();
