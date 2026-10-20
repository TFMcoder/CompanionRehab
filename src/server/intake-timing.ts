import type { LocalDb } from './local-authority.js';
import { defaultIntakeTiming, intakeTimingSchema, type IntakeTiming } from '../shared/intake-timing.js';

/** Small versioned configuration projected from existing durable care receipts. */
export async function readIntakeTiming(db: LocalDb, participant: string): Promise<IntakeTiming> {
  const row = (await db.query(`select result from companion_local.append_only_mutations
    where participant_id=$1 and event_type='LocalDayset_intake_timing'
    order by (result->>'revision')::integer desc limit 1`, [participant])).rows[0];
  if (!row) return { ...defaultIntakeTiming };
  const { revision: _revision, ...values } = row.result.intake_timing;
  return { ...intakeTimingSchema.parse(values), revision: row.result.revision };
}
