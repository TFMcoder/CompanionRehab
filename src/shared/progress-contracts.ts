import { z } from 'zod';

export const progressArchetypes = [
  { id: 'diabetes', label: 'Diabetes' },
  { id: 'neurorehab', label: 'Neurorehab' },
  { id: 'psychology_psychiatry', label: 'Psychologist / Psychiatrist' },
  { id: 'family_doctor', label: 'Family doctor' },
  { id: 'ot_psw_dsw', label: 'OT / PSW / DSW' },
] as const;
export const progressKinds = ['task', 'meal', 'exercise', 'rehab', 'appointment', 'routine_step', 'rehab_step'] as const;
export const progressFields = ['local_date', 'status', 'score_percent', 'completed_weight', 'known_weight',
  'missing_count', 'deferred_count', 'exempt_count', 'corrected_count', 'plan_version', 'rule_version',
  'time_zone', 'protocol_versions', 'sources'] as const;
export type ProgressField = typeof progressFields[number];
export type ProgressKind = typeof progressKinds[number];

const day = z.iso.date();
const uuid = z.string().uuid();
const fields = z.array(z.enum(progressFields)).min(1).max(progressFields.length).refine(values => new Set(values).size === values.length);
const optionalFields = z.array(z.enum(progressFields)).max(progressFields.length).refine(values => new Set(values).size === values.length);
export const progressRangeSchema = z.object({ from: day, to: day, archetype: z.enum(progressArchetypes.map(item => item.id) as [typeof progressArchetypes[number]['id'], ...typeof progressArchetypes[number]['id'][]]).optional() }).strict()
  .refine(range => range.from <= range.to, 'Choose a valid date range');
export type ProgressRange = z.infer<typeof progressRangeSchema>;
export const scoringRulesSchema = z.object({
  weights: z.array(z.object({ kind: z.enum(progressKinds), weight: z.number().int().min(1).max(100) }).strict()).min(1).max(progressKinds.length)
    .refine(items => new Set(items.map(item => item.kind)).size === items.length, 'Each activity type has one weight'),
  deferral_treatment: z.enum(['exempt', 'count_as_not_done']),
  achievements: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), label: z.string().trim().min(1).max(100), min_percent: z.number().int().min(1).max(100) }).strict()).max(8)
    .refine(items => new Set(items.map(item => item.key)).size === items.length, 'Achievement keys are unique'),
}).strict();
export type ScoringRules = z.infer<typeof scoringRulesSchema>;

const base = { idempotency_key: uuid };
export const progressCommandSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('approve_scoring_rules'), expected_rule_version: z.number().int().nonnegative(), rules: scoringRulesSchema,
    approval_ref: z.string().trim().min(1).max(200) }).strict(),
  z.object({ ...base, type: z.literal('recalculate_score'), local_date: day }).strict(),
  z.object({ ...base, type: z.literal('set_progress_access'), actor_id: uuid, role: z.enum(['administrator', 'clinician']),
    expected_revision: z.number().int().nonnegative(), can_read: z.boolean(), can_export: z.boolean(), can_approve_rules: z.boolean(),
    allowed_fields: optionalFields, max_days: z.number().int().min(1).max(90) }).strict()
    .refine(value => !(value.can_export || value.can_approve_rules) || value.can_read, 'Export and approval require read access')
    .refine(value => !value.can_read || value.allowed_fields.includes('local_date') && value.allowed_fields.includes('status'), 'Readable scope needs date and status'),
  z.object({ ...base, type: z.literal('approve_clinical_config'), archetype: z.enum(progressArchetypes.map(item => item.id) as [typeof progressArchetypes[number]['id'], ...typeof progressArchetypes[number]['id'][]]),
    expected_version: z.number().int().nonnegative(), title: z.string().trim().min(1).max(100), fields,
    approval_ref: z.string().trim().min(1).max(200) }).strict(),
  z.object({ ...base, type: z.literal('request_data_export'), from: day, to: day, format: z.enum(['json', 'csv']), fields,
    archetype: z.enum(progressArchetypes.map(item => item.id) as [typeof progressArchetypes[number]['id'], ...typeof progressArchetypes[number]['id'][]]).optional() }).strict()
    .refine(value => value.from <= value.to, 'Choose a valid date range'),
]);
export type ProgressCommand = z.infer<typeof progressCommandSchema>;

export interface ProgressSource {
  source_id: string; kind: ProgressKind; title: string; state: 'completed' | 'deferred' | 'exempt' | 'missing' | 'voided';
  weight: number; activity_revision: number | null; corrected: boolean; explanation: string;
}
export interface ProgressDay {
  local_date: string; status: 'no_plan' | 'unconfigured' | 'ready'; time_zone: string;
  plan_id: string | null; plan_version: number | null; rule_version: number | null;
  protocol_versions: string[];
  score_percent: number | null; completed_weight: number | null; known_weight: number | null;
  missing_count: number | null; deferred_count: number | null; exempt_count: number | null; corrected_count: number | null;
  sources: ProgressSource[]; source_digest: string | null; snapshot_generation: number | null; stale: boolean;
  achievements: Array<{ key: string; label: string; active: boolean }>;
}
export interface ProgressWorkspace {
  role: string; time_zone: string; from: string; to: string; days: ProgressDay[];
  trend: { days_in_range: number; days_with_accepted_plan: number; days_without_accepted_plan: number;
    days_with_reported_outcome: number | null; days_with_missing_reports: number | null;
    average_reported_percent: number | null; corrected_days: number | null;
    plan_versions: number[]; rule_versions: number[] };
  active_rules: { version: number; rules: ScoringRules; approval_ref: string } | null;
  archetypes: typeof progressArchetypes;
  clinical_config: { archetype: string; version: number; title: string; fields: ProgressField[] } | null;
  allowed_fields: ProgressField[]; can_approve_rules: boolean; can_export: boolean;
  access_grants: Array<{ actor_id: string; role: 'administrator' | 'clinician'; revision: number; can_read: boolean; can_export: boolean; can_approve_rules: boolean; allowed_fields: ProgressField[]; max_days: number }>;
}
export interface ProgressReceipt {
  command_id: string; type: ProgressCommand['type']; revision: number; replayed: boolean;
  result: Record<string, unknown>;
  export_content?: string | null;
}
