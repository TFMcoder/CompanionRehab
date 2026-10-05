import { z } from "zod";
import type { ActivityLedger } from './activity-contracts.js';

export const mealSlots = ["breakfast", "lunch", "dinner"] as const;
export type MealSlot = typeof mealSlots[number];
export const uuid = z.string().uuid();
export const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const taskOverrides = z.array(z.object({ id: uuid,
  urgency: z.enum(['high', 'medium', 'low']).optional(),
  scheduled_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  duration_minutes: z.number().int().min(1).max(480).nullable().optional(),
}).strict()).max(20).refine(items => new Set(items.map(i => i.id)).size === items.length, 'Duplicate task override');
export const planInput = z.object({
  task_ids: z.array(uuid).max(20).refine(a => new Set(a).size === a.length, "Duplicate task"),
  meals: z.array(z.object({ slot: z.enum(mealSlots), option_id: uuid }).strict()).length(3)
    .refine(a => new Set(a.map(x => x.slot)).size === 3, "Choose each meal once"),
  task_overrides: taskOverrides.optional(),
}).strict();
export const commandSchema = z.object({
  type: z.enum(["start_or_resume_checkin", "propose_day_plan", "accept_day_plan", "revise_day_plan"]),
  idempotency_key: uuid,
  local_date: localDate,
  expected_revision: z.number().int().nonnegative(),
  payload: z.record(z.string(), z.unknown()),
}).strict().superRefine((c, ctx) => {
  const schema = c.type === "start_or_resume_checkin" ? z.object({}).strict()
    : c.type === "accept_day_plan" ? z.object({ proposal_id: uuid }).strict() : planInput;
  if (!schema.safeParse(c.payload).success) ctx.addIssue({ code: "custom", message: "Invalid command payload", path: ["payload"] });
});
export type CareCommand = z.infer<typeof commandSchema>;
export const setupSchema = z.object({
  display_name: z.string().trim().min(1).max(60),
  time_zone: z.string().max(80).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "Unknown time zone"),
  expected_revision: z.number().int().nonnegative(),
  preferences: z.string().trim().max(1000),
  tasks: z.array(z.object({ id: uuid.optional(), title: z.string().trim().min(1).max(160), time_hint: z.string().max(40).nullable(),
    urgency: z.enum(['high', 'medium', 'low']).optional(),
    scheduled_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
    category: z.enum(['task', 'exercise', 'rehab']).optional(),
    duration_minutes: z.number().int().min(1).max(480).nullable().optional(),
  }).strict()).min(1).max(20),
  meal_options: z.array(z.object({ id: uuid.optional(), name: z.string().trim().min(1).max(160), slots: z.array(z.enum(mealSlots)).min(1).max(3) }).strict()).min(3).max(30),
}).strict();
export type SetupInput = z.infer<typeof setupSchema>;
export interface Task { id: string; title: string; time_hint: string | null; urgency?: 'high' | 'medium' | 'low'; scheduled_date?: string | null; scheduled_time?: string | null; category?: 'task' | 'exercise' | 'rehab'; duration_minutes?: number | null }
export type ClientView = 'my_day' | 'tasks' | 'meals' | 'groceries' | 'activity';
export type AppRole = 'administrator' | 'client' | 'family_friend' | 'clinician';
export interface GroceryItem { id: string; name: string; quantity?: string }
export const groceryInput = z.object({ name: z.string().trim().min(1).max(160), quantity: z.string().trim().max(80).optional(), idempotency_key: uuid }).strict();
export interface CalendarAppointment { id: string; title: string; starts_at: string; duration_minutes?: number | null }
export interface ActivityReport { target_id: string; local_date: string; status: 'completed' | 'deferred'; occurred_at: string; meal_slot?: MealSlot }
export interface PriorityContext { greeting: string; period: string; local_time: string; local_date: string; suggestions: { kind: string; label: string; reason: string }[] }
export interface MealOption { id: string; name: string; slots: MealSlot[] }
export interface Plan {
  id: string;
  task_ids: string[];
  meals: { slot: MealSlot; option_id: string; name: string }[];
  tasks: Task[];
  created_at: string;
}
export interface AcceptedPlan extends Plan { version: number; accepted_at: string }
export interface CheckIn {
  id: string; local_date: string; revision: number; proposal: Plan | null; accepted: AcceptedPlan | null;
}
export interface Today {
  profile: { id: string; display_name: string; time_zone: string; preferences: string; revision: number } | null;
  local_date: string;
  tasks: Task[]; meal_options: MealOption[]; checkin: CheckIn | null;
  role?: AppRole; groceries?: GroceryItem[]; appointments?: CalendarAppointment[];
  activity_reports?: ActivityReport[]; priority_context?: PriorityContext;
  activity_ledger?: ActivityLedger;
}
export interface Receipt {
  command_id: string; checkin_id: string; revision: number;
  result: "resumed" | "proposed" | "accepted"; plan: Plan | AcceptedPlan | null; replayed: boolean;
}
export interface AppConfig { configured: boolean; voice_available: boolean; assistant_name: "Nancy"; missing: string[]; voice_transport?: 'local' | 'legacy'; role?: AppRole; synthetic?: boolean }
export function dateInZone(now: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
