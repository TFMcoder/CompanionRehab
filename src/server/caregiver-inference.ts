import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Pool } from 'pg';
import { z } from 'zod';
import { ApiError } from './errors.js';
import type { InferenceScope } from './inference-binding.js';

/** An explicit application authorization, not a claim of provider entitlement. */
export const caregiverInferenceSchema = z.object({
  schema_version: z.literal(1), enabled: z.boolean(), authorization_id: z.uuid(),
  approved_by_actor_id: z.uuid(), client_actor_id: z.uuid(), participant_id: z.uuid(),
  caregiver_role: z.enum(['administrator', 'family_friend']),
  caregiver_grant_id: z.uuid(), client_grant_id: z.uuid(),
  account_binding_id: z.uuid(), host_id: z.string().regex(/^urn:uuid:[a-f0-9-]{36}$/i),
  approved_at: z.iso.datetime(), authorization_ref: z.string().min(1).max(300),
}).strict();
export type CaregiverInferenceConfig = z.infer<typeof caregiverInferenceSchema>;
export interface CaregiverInferenceAuthorization {
  ownerActorId: string; accountBindingId: string; hostId: string; authorizationRef: string;
}
export type ResolveCaregiverInference = (scope: InferenceScope) => Promise<CaregiverInferenceAuthorization | undefined>;

export function caregiverInferencePath(path: string): string {
  const resolved = resolve(path), rel = relative(resolve('.local'), resolved);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error('Caregiver voice authorization must stay under the ignored .local directory.');
  return resolved;
}

/** Re-read both the local authorization and live grants on every binding check. */
export function resolveCaregiverInference(path: string | undefined, ownerActorId: string, pool: Pick<Pool, 'query'>): ResolveCaregiverInference {
  const file = path ? caregiverInferencePath(path) : undefined;
  return async scope => {
    if (!file || scope.active_role !== 'client' || scope.actor_id === ownerActorId) return undefined;
    let config: CaregiverInferenceConfig;
    try { config = caregiverInferenceSchema.parse(JSON.parse(await readFile(file, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new ApiError(503, 'caregiver_connection_unavailable', 'The caregiver connection needs review. You can use the buttons.');
    }
    if (!config.enabled || config.approved_by_actor_id !== ownerActorId || config.client_actor_id !== scope.actor_id
      || config.participant_id !== scope.client_id || config.client_actor_id === ownerActorId) return undefined;
    const rows = (await pool.query(`select g.id,g.actor_id,g.role,g.granted_at from companion_local.role_grants g
      join companion_local.accounts a on a.id=g.actor_id
      where g.participant_id=$1 and g.revoked_at is null and a.disabled_at is null
      and ((g.id=$2 and g.actor_id=$3 and g.role=$4) or (g.id=$5 and g.actor_id=$6 and g.role='client'))
      order by g.id`, [config.participant_id, config.caregiver_grant_id, ownerActorId, config.caregiver_role,
      config.client_grant_id, config.client_actor_id])).rows;
    if (rows.length !== 2) return undefined;
    return Object.freeze({ ownerActorId, accountBindingId: config.account_binding_id, hostId: config.host_id,
      authorizationRef: 'sha256:' + createHash('sha256').update(JSON.stringify([config,
        rows.map(row => [row.id, row.actor_id, row.role, new Date(row.granted_at).toISOString()])])).digest('hex') });
  };
}
