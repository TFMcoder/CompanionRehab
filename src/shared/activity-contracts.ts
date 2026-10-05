import { z } from 'zod';

export const activityKinds = ['task', 'meal', 'appointment'] as const;
export type ActivityKind = typeof activityKinds[number];
export type ActivityStatus = 'pending' | 'completed' | 'deferred' | 'voided';
export interface ActivityOption {
  id: string; kind: ActivityKind; title: string; local_date: string; source_id: string | null;
  meal_slot: 'breakfast' | 'lunch' | 'dinner' | null; plan_id: string | null;
  scheduled_at: string | null; status: ActivityStatus; revision: number; unplanned: boolean;
}
export interface ActivityEntry extends ActivityOption {
  occurred_at: string | null; recorded_at: string; updated_at: string;
  notes: string; portion: string | null; last_action: 'reported' | 'corrected' | 'rescheduled';
}
export interface ActivityLedger {
  local_date: string; options: ActivityOption[]; entries: ActivityEntry[]; recent_entries: ActivityEntry[];
  summary: { tasks_completed: number; meals_eaten: number; appointments_attended: number; deferred: number };
}
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value + 'T12:00:00Z'); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Use a real calendar date');
const instant = z.iso.datetime({ offset: true });
const fields = { idempotency_key: z.string().uuid(), local_date: day, expected_revision: z.number().int().nonnegative() };
const report = z.object({
  activity_id: z.string().uuid().optional(),
  unplanned: z.object({ kind: z.enum(activityKinds), title: z.string().trim().min(1).max(160), meal_slot: z.enum(['breakfast', 'lunch', 'dinner']).optional() }).strict().optional(),
  status: z.enum(['completed', 'deferred']), occurred_at: instant.nullable(), notes: z.string().trim().max(500),
  portion: z.string().trim().min(1).max(160).nullable().optional(),
}).strict().superRefine((p, ctx) => {
  if (!!p.activity_id === !!p.unplanned) ctx.addIssue({ code: 'custom', message: 'Choose one exact activity or an unplanned activity' });
  if ((p.status === 'completed') !== (p.occurred_at !== null)) ctx.addIssue({ code: 'custom', message: 'Completed activities need an actual time; deferred activities are not completed' });
  if (p.unplanned?.meal_slot && p.unplanned.kind !== 'meal') ctx.addIssue({ code: 'custom', message: 'Only meals have a meal slot' });
});
const correction = z.object({ activity_id: z.string().uuid(), status: z.enum(['completed', 'deferred', 'voided']), occurred_at: instant.nullable(),
  notes: z.string().trim().max(500), portion: z.string().trim().min(1).max(160).nullable().optional(), reason: z.string().trim().min(1).max(500),
}).strict().superRefine((p, ctx) => {
  if ((p.status === 'completed') !== (p.occurred_at !== null)) ctx.addIssue({ code: 'custom', message: 'Only completed activities have an actual occurrence time' });
});
export const activityCommandSchema = z.discriminatedUnion('type', [
  z.object({ ...fields, type: z.literal('record_activity'), payload: report }).strict(),
  z.object({ ...fields, type: z.literal('correct_activity'), payload: correction }).strict(),
  z.object({ ...fields, type: z.literal('reschedule_activity'), payload: z.object({ activity_id: z.string().uuid(), scheduled_at: instant, reason: z.string().trim().min(1).max(500) }).strict() }).strict(),
]);
export type ActivityCommand = z.infer<typeof activityCommandSchema>;
export interface ActivityReceipt { command_id: string; result: 'reported' | 'corrected' | 'rescheduled'; entry: ActivityEntry; replayed: boolean }
export const activityDate = day;
