import { z } from "zod";

export const mealSlots = ["breakfast", "lunch", "dinner"] as const;
export type MealSlot = typeof mealSlots[number];
export const uuid = z.string().uuid();
export const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const planInput = z.object({
  task_ids: z.array(uuid).max(20).refine(a => new Set(a).size === a.length, "Duplicate task"),
  meals: z.array(z.object({ slot: z.enum(mealSlots), option_id: uuid }).strict()).length(3)
    .refine(a => new Set(a.map(x => x.slot)).size === 3, "Choose each meal once"),
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
  tasks: z.array(z.object({ id: uuid.optional(), title: z.string().trim().min(1).max(160), time_hint: z.string().max(40).nullable() }).strict()).min(1).max(20),
  meal_options: z.array(z.object({ id: uuid.optional(), name: z.string().trim().min(1).max(160), slots: z.array(z.enum(mealSlots)).min(1).max(3) }).strict()).min(3).max(30),
}).strict();
export type SetupInput = z.infer<typeof setupSchema>;
export interface Task { id: string; title: string; time_hint: string | null }
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
}
export interface Receipt {
  command_id: string; checkin_id: string; revision: number;
  result: "resumed" | "proposed" | "accepted"; plan: Plan | AcceptedPlan | null; replayed: boolean;
}
export interface AppConfig { configured: boolean; voice_available: boolean; assistant_name: "Nancy"; missing: string[] }
export function dateInZone(now: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
