import { z } from 'zod';
import { activityDate } from './activity-contracts.js';
import { uuid, mealSlots, type Task, type Plan, type MealSlot } from './contracts.js';
export const clockTime=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const base={idempotency_key:uuid,confirmed:z.literal(true)};
export const promptPreferencesSchema=z.object({enabled:z.boolean(),meal_times:z.object({breakfast:clockTime.nullable(),lunch:clockTime.nullable(),dinner:clockTime.nullable()}).strict(),
 appointment_lead_minutes:z.number().int().min(0).max(180),quiet_start:clockTime,quiet_end:clockTime,foreground_speech:z.boolean(),browser_notifications:z.boolean()}).strict();
export type PromptPreferences=z.infer<typeof promptPreferencesSchema> & {revision:number};
export const routineChoicesSchema=z.object({task_ids:z.array(uuid).max(20),meals:z.array(z.object({slot:z.enum(mealSlots),option_id:uuid}).strict()).max(3),weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7)}).strict()
 .refine(v=>new Set(v.task_ids).size===v.task_ids.length&&new Set(v.meals.map(m=>m.slot)).size===v.meals.length&&new Set(v.weekdays).size===v.weekdays.length,'Choose each item once');
export type RoutineChoices=z.infer<typeof routineChoicesSchema>;
export const localDayCommandSchema=z.discriminatedUnion('type',[
 z.object({...base,type:z.literal('set_prompt_preferences'),expected_revision:z.number().int().nonnegative(),preferences:promptPreferencesSchema}).strict(),
 z.object({...base,type:z.literal('set_routine_choices'),expected_revision:z.number().int().nonnegative(),selections:routineChoicesSchema}).strict(),
 z.object({...base,type:z.literal('decide_carryover'),source_date:activityDate,source_plan_id:uuid,source_activity_id:uuid,source_revision:z.number().int().nonnegative(),target_date:activityDate,
  decision:z.enum(['keep','reschedule','cancel','help','unresolved']),expected_day_revision:z.number().int().nonnegative(),scheduled_time:clockTime.nullable(),urgency:z.enum(['high','medium','low']),duration_minutes:z.number().int().min(1).max(480).nullable(),note:z.string().trim().max(500)}).strict(),
]);
export type LocalDayCommand=z.infer<typeof localDayCommandSchema>;
export interface LocalDayReceipt {command_id:string;type:LocalDayCommand['type'];revision:number;result:string;proposal:Plan|null;replayed:boolean}
export interface CarryoverItem {source_date:string;source_plan_id:string;activity_id:string;revision:number;task:Task;decision:string|null;note:string;proposal_id:string|null;accepted:boolean}
export interface CarryoverHistoryItem {source_date:string;source_plan_id:string|null;activity_id:string;task_title:string;decision:'keep'|'reschedule'|'cancel'|'help'|'unresolved';note:string;target_date:string;created_at:string;proposal_id:string|null;accepted:boolean}
export interface PromptItem {id:string;message:string;due_at:string;expires_at:string;state:string;claim_token?:string;foreground_speech?:boolean;browser_notifications?:boolean;delivery_uncertain?:boolean}
export interface LocalDayWorkspace {local_date:string;time_zone:string;day_revision:number;carryover:CarryoverItem[];carryover_history:CarryoverHistoryItem[];history_truncated:boolean;next_carryover_before:string|null;preferences:PromptPreferences;routine:{revision:number;selections:RoutineChoices}|null;routine_suggestions:{task_ids:string[];meals:{slot:MealSlot;option_id:string}[]};prompts:PromptItem[]}
