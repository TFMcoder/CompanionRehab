import { z } from 'zod';

/** Ordinary planning preferences, never clinical thresholds or outreach consent. */
export const intakeTimingSchema = z.object({
  full_meal_spacing_minutes: z.number().int().min(15).max(720),
  intake_report_check_minutes: z.number().int().min(30).max(960),
}).strict();
export type IntakeTiming = z.infer<typeof intakeTimingSchema> & { revision: number };
export const defaultIntakeTiming: IntakeTiming = {
  revision: 0, full_meal_spacing_minutes: 60, intake_report_check_minutes: 360,
};
