import { z } from 'zod';
import { uuid, type AppRole } from './contracts.js';
import { activityDate } from './activity-contracts.js';

export const programCapabilities = ['read_routine','edit_routine','read_rehab','edit_rehab','approve_rehab'] as const;
export type ProgramCapability = typeof programCapabilities[number];
export const programKind = z.enum(['routine','rehab']);
const revision = z.number().int().nonnegative();
const text = z.string().trim().min(1).max(500);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const programStepSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/), title: z.string().trim().min(1).max(120),
  instruction: text, optional: z.boolean(), depends_on: z.array(z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/)).max(10),
  estimated_minutes: z.number().int().min(1).max(180),
}).strict();
export type ProgramStep = z.infer<typeof programStepSchema>;
export const programDraftSchema = z.object({
  title: z.string().trim().min(1).max(160), kind: programKind,
  steps: z.array(programStepSchema).min(1).max(30),
  protected_start: time.nullable(), protected_end: time.nullable(),
  rest_minutes: z.number().int().min(0).max(240),
}).strict().superRefine((draft, ctx) => {
  if ((draft.protected_start === null) !== (draft.protected_end === null) ||
      draft.protected_start && draft.protected_end && draft.protected_start >= draft.protected_end)
    ctx.addIssue({ code: 'custom', message: 'Choose an ordered protected window.', path: ['protected_start'] });
  const seen = new Set<string>();
  for (const [index, step] of draft.steps.entries()) {
    if (seen.has(step.id) || step.depends_on.some(id => !seen.has(id) || id === step.id))
      ctx.addIssue({ code: 'custom', message: 'Step IDs must be unique and dependencies must be earlier steps.', path: ['steps', index] });
    seen.add(step.id);
  }
});
export type ProgramDraft = z.infer<typeof programDraftSchema>;
const base = { idempotency_key: uuid };
const run = { run_id: uuid, expected_revision: revision };
const conflictReview = { acknowledged_conflicts: z.array(uuid).max(30) };
export const programCommandSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('set_program_access'), actor_id: uuid, role: z.enum(['administrator','family_friend','clinician']),
    expected_revision: revision, capabilities: z.array(z.enum(programCapabilities)).max(5).refine(v => new Set(v).size === v.length), confirmed: z.literal(true) }).strict(),
  z.object({ ...base, type: z.literal('create_program'), draft: programDraftSchema, confirmed: z.literal(true) }).strict(),
  z.object({ ...base, type: z.literal('revise_program'), definition_id: uuid, expected_version: revision, draft: programDraftSchema, confirmed: z.literal(true) }).strict(),
  z.object({ ...base, type: z.literal('approve_program'), version_id: uuid, approval_ref: text, confirmed: z.literal(true) }).strict(),
  z.object({ ...base, type: z.literal('start_program'), version_id: uuid, local_date: activityDate, ...conflictReview, confirmed: z.literal(true) }).strict(),
  z.object({ ...base, ...run, type: z.literal('pause_program'), reason: text, confirmed: z.literal(true) }).strict(),
  z.object({ ...base, ...run, type: z.literal('resume_program'), ...conflictReview, confirmed: z.literal(true) }).strict(),
  z.object({ ...base, ...run, type: z.literal('end_program'), reason: text, confirmed: z.literal(true) }).strict(),
  z.object({ ...base, ...run, type: z.literal('report_program_step'), step_id: z.string(), outcome: z.enum(['completed','skipped']),
    reason: z.string().trim().max(500), difficulty: z.string().trim().max(500), assistance: z.string().trim().max(500),
    notes: z.string().trim().max(1000), ...conflictReview, confirmed: z.literal(true) }).strict(),
  z.object({ ...base, type: z.literal('correct_program_step'), run_id: uuid, step_id: z.string(), expected_revision: revision,
    outcome: z.enum(['completed','skipped']), reason: z.string().trim().max(500), difficulty: z.string().trim().max(500),
    assistance: z.string().trim().max(500), notes: z.string().trim().max(1000), correction_reason: text, confirmed: z.literal(true) }).strict(),
]);
export type ProgramCommand = z.infer<typeof programCommandSchema>;
export interface ProgramVersion {
  id: string; definition_id: string; kind: 'routine'|'rehab'; title: string; version: number; steps: ProgramStep[];
  protected_start: string|null; protected_end: string|null; rest_minutes: number;
  approved: boolean; approval_ref: string|null; current: boolean;
}
export interface ProgramResult {
  step_id: string; outcome: 'completed'|'skipped'; reason: string; difficulty: string; assistance: string; notes: string;
  revision: number; reported_at: string;
}
export interface ProgramRun {
  id: string; definition_id: string; version_id: string; title: string; local_date: string; status: 'active'|'paused'|'completed'|'ended';
  revision: number; current_step: ProgramStep|null; obsolete: boolean; blocked_reason: string|null; pause_reason: string|null; results: ProgramResult[];
}
export interface ProgramAccess { actor_id: string; label: string; role: 'administrator'|'family_friend'|'clinician'; revision: number; capabilities: ProgramCapability[] }
export interface ProgramWorkspace {
  role: AppRole; capabilities: ProgramCapability[]; local_date: string; time_zone: string; versions: ProgramVersion[]; runs: ProgramRun[];
  sharing: ProgramAccess[]; capacity: {available_minutes:number;rest_minutes:number}|null;
  planning: {task_count:number;meal_count:number;appointment_count:number;requires_acceptance:true};
  conflicts: Array<{id:string;title:string;starts_at:string}>;
  conflicts_by_version: Record<string,Array<{id:string;title:string;starts_at:string}>>;
}
export interface ProgramReceipt { command_id: string; result: string; definition_id: string|null; version_id: string|null;
  run_id: string|null; step_id: string|null; revision: number; replayed: boolean }
