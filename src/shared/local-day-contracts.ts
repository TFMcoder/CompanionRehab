import { z } from 'zod';
import { activityDate } from './activity-contracts.js';
import { uuid, mealSlots, type Task, type Plan, type MealSlot } from './contracts.js';
import { intakeTimingSchema, type IntakeTiming } from './intake-timing.js';
export const clockTime=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const base={idempotency_key:uuid,confirmed:z.literal(true)};
export const promptPreferencesSchema=z.object({enabled:z.boolean(),food_check_ins:z.boolean().optional(),meal_times:z.object({breakfast:clockTime.nullable(),lunch:clockTime.nullable(),dinner:clockTime.nullable()}).strict(),
 appointment_lead_minutes:z.number().int().min(0).max(180),quiet_start:clockTime,quiet_end:clockTime,foreground_speech:z.boolean(),browser_notifications:z.boolean()}).strict();
export type PromptPreferences=z.infer<typeof promptPreferencesSchema> & {revision:number};
export const routineChoicesSchema=z.object({task_ids:z.array(uuid).max(20),meals:z.array(z.object({slot:z.enum(mealSlots),option_id:uuid}).strict()).max(3),weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7)}).strict()
 .refine(v=>new Set(v.task_ids).size===v.task_ids.length&&new Set(v.meals.map(m=>m.slot)).size===v.meals.length&&new Set(v.weekdays).size===v.weekdays.length,'Choose each item once');
export type RoutineChoices=z.infer<typeof routineChoicesSchema>;
export const localDayCommandSchema=z.discriminatedUnion('type',[
 z.object({...base,type:z.literal('add_client_task'),expected_profile_revision:z.number().int().nonnegative(),title:z.string().trim().min(1).max(160),urgency:z.enum(['high','medium','low']),scheduled_date:activityDate,scheduled_time:clockTime.nullable(),duration_minutes:z.number().int().min(1).max(480).nullable()}).strict(),
 z.object({...base,type:z.literal('add_local_appointment'),title:z.string().trim().min(1).max(160),starts_at:z.iso.datetime({offset:true})}).strict(),
 z.object({...base,type:z.literal('set_intake_timing'),expected_revision:z.number().int().nonnegative(),preferences:intakeTimingSchema}).strict(),
 z.object({...base,type:z.literal('start_task_focus'),activity_id:uuid,expected_activity_revision:z.number().int().nonnegative(),expected_activity_version:z.string().regex(/^[a-f0-9]{64}$/),interval_minutes:z.number().int().min(5).max(240)}).strict(),
 z.object({...base,type:z.literal('pause_task_focus'),focus_id:uuid,expected_revision:z.number().int().positive()}).strict(),
 z.object({...base,type:z.literal('resume_task_focus'),focus_id:uuid,expected_revision:z.number().int().positive(),interval_minutes:z.number().int().min(5).max(240)}).strict(),
 z.object({...base,type:z.literal('finish_task_focus'),focus_id:uuid,expected_revision:z.number().int().positive()}).strict(),
 z.object({...base,type:z.literal('respond_prompt'),prompt_id:uuid,expected_revision:z.number().int().nonnegative(),decision:z.enum(['snooze','decline']),snooze_minutes:z.number().int().min(5).max(120).nullable()}).strict(),
 z.object({...base,type:z.literal('record_significant_handoff'),summary:z.string().trim().min(1).max(300),occurred_at:z.iso.datetime({offset:true})}).strict(),
 z.object({...base,type:z.literal('correct_significant_handoff'),handoff_id:uuid,expected_revision:z.number().int().positive(),summary:z.string().trim().min(1).max(300),occurred_at:z.iso.datetime({offset:true}),reason:z.string().trim().min(1).max(300)}).strict(),
 z.object({...base,type:z.literal('review_significant_handoff'),handoff_id:uuid,expected_revision:z.number().int().positive(),decision:z.enum(['still_relevant','resolved']),note:z.string().trim().max(300)}).strict(),
 z.object({...base,type:z.literal('set_prompt_preferences'),expected_revision:z.number().int().nonnegative(),preferences:promptPreferencesSchema}).strict(),
 z.object({...base,type:z.literal('set_routine_choices'),expected_revision:z.number().int().nonnegative(),selections:routineChoicesSchema}).strict(),
 z.object({...base,type:z.literal('decide_carryover'),source_date:activityDate,source_plan_id:uuid,source_activity_id:uuid,source_revision:z.number().int().nonnegative(),target_date:activityDate,
  decision:z.enum(['keep','reschedule','cancel','help','unresolved']),expected_day_revision:z.number().int().nonnegative(),scheduled_time:clockTime.nullable(),urgency:z.enum(['high','medium','low']),duration_minutes:z.number().int().min(1).max(480).nullable(),note:z.string().trim().max(500)}).strict(),
]);
export type LocalDayCommand=z.infer<typeof localDayCommandSchema>;
export const retainedLocalDayCommandTypes:readonly LocalDayCommand['type'][]=['add_client_task','add_local_appointment','set_intake_timing','record_significant_handoff','correct_significant_handoff','review_significant_handoff','respond_prompt','start_task_focus','pause_task_focus','resume_task_focus','finish_task_focus'];
export interface LocalDayReceipt {command_id:string;type:LocalDayCommand['type'];revision:number;result:string;proposal:Plan|null;handoff_id?:string;focus_id?:string;intake_timing?:IntakeTiming;replayed:boolean}
export interface TaskFocus {id:string;activity_id:string;task_id:string;title:string;local_date:string;revision:number;state:'active'|'paused'|'finished';interval_minutes:number;started_at:string;last_started_at:string;paused_at:string|null;finished_at:string|null;check_due_at:string}
export interface FocusOption {activity_id:string;task_id:string;title:string;local_date:string;activity_revision:number;source_version:string}
export interface SignificantHandoff {id:string;summary:string;occurred_at:string;source:'client_report';source_actor_id:string;recorded_at:string;revision:number;status:'active'|'resolved';reviewed_at:string|null;reviewed_by:string|null;resolved_at:string|null;resolution_note:string}
export interface DailyPreparation {local_date:string;prepared_at:string;context_version:string;trigger:'scheduler'|'open'|'startup';status:'prepared';source_revisions:{profile:number;checkin:number}}
export interface CarryoverItem {source_date:string;source_plan_id:string;activity_id:string;revision:number;task:Task;decision:string|null;note:string;proposal_id:string|null;accepted:boolean}
export interface CarryoverHistoryItem {source_date:string;source_plan_id:string|null;activity_id:string;task_title:string;decision:'keep'|'reschedule'|'cancel'|'help'|'unresolved';note:string;target_date:string;created_at:string;proposal_id:string|null;accepted:boolean}
export interface PromptItem {id:string;message:string;due_at:string;expires_at:string;state:string;claim_token?:string;foreground_speech?:boolean;browser_notifications?:boolean;delivery_uncertain?:boolean;restored?:boolean;response_revision?:number;response?:'snoozed'|'declined'|null;snoozed_until?:string|null}
export interface LocalDayWorkspace {local_date:string;time_zone:string;day_revision:number;carryover:CarryoverItem[];carryover_history:CarryoverHistoryItem[];history_truncated:boolean;next_carryover_before:string|null;preferences:PromptPreferences;intake_timing?:IntakeTiming;routine:{revision:number;selections:RoutineChoices}|null;routine_suggestions:{task_ids:string[];meals:{slot:MealSlot;option_id:string}[]};prompts:PromptItem[];preparation?:DailyPreparation|null;handoffs?:SignificantHandoff[];handoff_history?:SignificantHandoff[];focus?:TaskFocus|null;focus_options?:FocusOption[]}
