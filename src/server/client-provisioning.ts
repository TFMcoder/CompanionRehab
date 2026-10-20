import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCallback } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { canonicalJson } from './local-authority.js';

/** Local operator tool only. Never expose provisioning through a care or Nancy route. */
export const clientProvisionRequestSchema = z.object({
  operation_id: z.string().uuid(),
  participant_id: z.string().uuid(),
  practice_actor_id: z.string().uuid(),
  client_actor_id: z.string().uuid(),
  client_email: z.email().max(254).transform(value => value.toLowerCase()),
  practice_role_after: z.enum(['none', 'family_friend', 'administrator']),
  approval_ref: z.string().trim().min(1).max(240),
  backup_ref: z.string().trim().min(1).max(240),
}).strict().refine(value => value.practice_actor_id !== value.client_actor_id, 'The client needs a distinct actor.');
export type ClientProvisionRequest = z.infer<typeof clientProvisionRequestSchema>;

export class ClientProvisionError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
const fail = (code: string, message: string): never => { throw new ClientProvisionError(code, message); };
const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
type Db = Pick<PoolClient, 'query'>;
const eventType = 'PermanentClientAccountProvisioned';

export interface ClientProvisionReview {
  version: 1;
  request: ClientProvisionRequest;
  review_digest: string;
  profile_revision: number;
  practice_grant_id: string;
  sessions_to_revoke: number;
  preserved_counts: { activities: number; checkins: number; accepted_plans: number; care_events: number };
  inference_enabled: false;
  feature_sharing_added: false;
}
export interface ClientProvisionResult {
  operation_id: string; participant_id: string; client_actor_id: string;
  practice_actor_id: string; practice_role_after: ClientProvisionRequest['practice_role_after'];
  sessions_revoked: number; inference_enabled: false; replayed: boolean;
}

async function previous(db: Db, request: ClientProvisionRequest, reviewDigest?: string): Promise<ClientProvisionResult | null> {
  const row = (await db.query('select event_type,data from companion_local.domain_events where participant_id=$1 and command_id=$2',
    [request.participant_id, request.operation_id])).rows[0];
  if (!row) return null;
  if (row.event_type !== eventType || row.data.request_digest !== digest(request)
    || reviewDigest && row.data.review_digest !== reviewDigest)
    return fail('operation_conflict', 'The operation reference was already used for a different provisioning decision.');
  return { ...row.data.result, replayed: true };
}

async function inspect(db: Db, request: ClientProvisionRequest, lock: boolean): Promise<ClientProvisionReview> {
  const profile = (await db.query(`select id,revision from companion_local.participant_profiles where id=$1 ${lock ? 'for update' : ''}`,
    [request.participant_id])).rows[0];
  if (!profile) return fail('participant_missing', 'The explicitly selected existing participant profile was not found.');
  const practice = (await db.query(`select id,disabled_at from companion_local.accounts where id=$1 ${lock ? 'for update' : ''}`,
    [request.practice_actor_id])).rows[0];
  if (!practice || practice.disabled_at) return fail('practice_account_unavailable', 'The selected practice account is not active.');
  const grants = (await db.query(`select id,actor_id,role,granted_at,revoked_at from companion_local.role_grants
    where participant_id=$1 order by id ${lock ? 'for update' : ''}`, [request.participant_id])).rows;
  const clients = grants.filter(row => row.role === 'client' && !row.revoked_at);
  if (clients.length !== 1 || clients[0].actor_id !== request.practice_actor_id)
    return fail('client_grants_changed', 'Review the existing client grants before assigning a permanent client.');
  if (grants.some(row => row.actor_id === request.practice_actor_id && !row.revoked_at
    && row.role !== 'client' && row.role !== request.practice_role_after))
    return fail('practice_roles_changed', 'The practice actor has additional roles outside the selected transition. Review them explicitly first.');
  const existing = (await db.query('select id from companion_local.accounts where id=$1 or lower(email)=$2',
    [request.client_actor_id, request.client_email])).rows;
  if (existing.length) return fail('client_account_exists', 'The proposed client actor or email already belongs to an account.');
  if (request.practice_role_after !== 'none' && grants.some(row => row.actor_id === request.practice_actor_id
    && row.role === request.practice_role_after && row.revoked_at))
    return fail('previous_role_revoked', 'A previously revoked role requires its own access review; provisioning will not restore it.');
  const sessions = (await db.query(`select id from companion_local.sessions where participant_id=$1 and actor_id=$2
    and revoked_at is null order by id ${lock ? 'for update' : ''}`, [request.participant_id, request.practice_actor_id])).rows;
  const counts = (await db.query(`select
    (select count(*)::int from companion_local.activity_records where participant_id=$1) as activities,
    (select count(*)::int from companion_local.daily_checkins where participant_id=$1) as checkins,
    (select count(*)::int from companion_local.accepted_day_plan_versions where participant_id=$1) as accepted_plans,
    (select count(*)::int from companion_local.domain_events where participant_id=$1) as care_events`, [request.participant_id])).rows[0];
  const reviewDigest = digest({ request, profile, grants, sessions, counts });
  return { version: 1, request, review_digest: reviewDigest, profile_revision: profile.revision,
    practice_grant_id: clients[0].id, sessions_to_revoke: sessions.length, preserved_counts: counts,
    inference_enabled: false, feature_sharing_added: false };
}

/** Read-only preflight. Its identifiers and counts belong in a private review file. */
export async function reviewClientProvision(pool: Pool, input: ClientProvisionRequest): Promise<ClientProvisionReview> {
  const request = clientProvisionRequestSchema.parse(input);
  if (await previous(pool, request)) return fail('already_applied', 'This provisioning operation is already recorded. Use apply with the original review to recover its result.');
  return inspect(pool, request, false);
}

/** Atomically changes access only: never copies, relabels, seeds or deletes care records. */
export async function applyClientProvision(pool: Pool, input: ClientProvisionRequest, reviewedDigest: string,
  password: string, clock = () => new Date()): Promise<ClientProvisionResult> {
  const request = clientProvisionRequestSchema.parse(input);
  z.string().regex(/^[a-f0-9]{64}$/).parse(reviewedDigest);
  z.string().min(20).max(256).parse(password);
  const salt = randomBytes(16);
  const hash = await new Promise<Buffer>((resolve, reject) => scryptCallback(password, salt, 64,
    { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(Buffer.from(key))));
  const db = await pool.connect();
  try {
    await db.query('begin');
    // Match care command lock order; this also serializes simultaneous provisioning attempts.
    await db.query('select id from companion_local.participant_profiles where id=$1 for update', [request.participant_id]);
    const recorded = await previous(db, request, reviewedDigest);
    if (recorded) { await db.query('commit'); return recorded; }
    const current = await inspect(db, request, true);
    if (current.review_digest !== reviewedDigest) return fail('review_stale', 'Account, access or care state changed. Generate and review a fresh preflight.');
    const now = clock();
    await db.query('insert into companion_local.accounts(id,email,password_salt,password_hash) values($1,$2,$3,$4)',
      [request.client_actor_id, request.client_email, salt, hash]);
    await db.query("insert into companion_local.role_grants(participant_id,actor_id,role,granted_at) values($1,$2,'client',$3)",
      [request.participant_id, request.client_actor_id, now]);
    await db.query('update companion_local.role_grants set revoked_at=$2 where id=$1', [current.practice_grant_id, now]);
    if (request.practice_role_after !== 'none')
      await db.query(`insert into companion_local.role_grants(participant_id,actor_id,role,granted_at) values($1,$2,$3,$4)
        on conflict(participant_id,actor_id,role) do nothing`, [request.participant_id, request.practice_actor_id, request.practice_role_after, now]);
    const revoked = await db.query('update companion_local.sessions set revoked_at=$3 where participant_id=$1 and actor_id=$2 and revoked_at is null returning id',
      [request.participant_id, request.practice_actor_id, now]);
    const result: ClientProvisionResult = { operation_id: request.operation_id, participant_id: request.participant_id,
      client_actor_id: request.client_actor_id, practice_actor_id: request.practice_actor_id,
      practice_role_after: request.practice_role_after, sessions_revoked: revoked.rows.length, inference_enabled: false, replayed: false };
    await db.query(`insert into companion_local.domain_events(participant_id,actor_id,command_id,event_type,data,created_at)
      values($1,$2,$3,$4,$5,$6)`, [request.participant_id, request.practice_actor_id, request.operation_id, eventType,
      JSON.stringify({ version: 1, request_digest: digest(request), review_digest: reviewedDigest,
        approval_ref: request.approval_ref, backup_ref: request.backup_ref, result }), now]);
    await db.query('commit');
    return result;
  } catch (error) {
    await db.query('rollback').catch(() => {});
    if (error instanceof ClientProvisionError) throw error;
    throw new ClientProvisionError('provisioning_unconfirmed', 'Provisioning could not be confirmed. Keep the protected credentials and recover with the same operation and review.');
  } finally { hash.fill(0); db.release(); }
}

const credentialSchema = z.object({ version: z.literal(1), operation_id: z.string().uuid(), request_digest: z.string(),
  client_actor_id: z.string().uuid(), client_email: z.email(), password: z.string().min(20), created_at: z.iso.datetime() }).strict();
export type ClientCredential = z.infer<typeof credentialSchema>;
const credentialHeader = Buffer.from('NANCY-CLIENT-LOGIN-1');
export function createClientCredential(input: ClientProvisionRequest): ClientCredential {
  const request = clientProvisionRequestSchema.parse(input);
  return { version: 1, operation_id: request.operation_id, request_digest: digest(request), client_actor_id: request.client_actor_id,
    client_email: request.client_email, password: randomBytes(24).toString('base64url'), created_at: new Date().toISOString() };
}
export function encryptClientCredential(credential: ClientCredential, key: Buffer): Buffer {
  if (key.length !== 32) throw new Error('A private 32-byte session key is required.');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(credentialHeader);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentialSchema.parse(credential))), cipher.final()]);
  return Buffer.concat([credentialHeader, iv, cipher.getAuthTag(), ciphertext]);
}
/** Only for private local delivery/recovery; never log or return through an HTTP route. */
export function decryptClientCredential(bytes: Buffer, key: Buffer, input: ClientProvisionRequest): ClientCredential {
  try {
    const offset = credentialHeader.length;
    if (key.length !== 32 || bytes.length <= offset + 28 || !bytes.subarray(0, offset).equals(credentialHeader)) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(offset, offset + 12));
    decipher.setAAD(credentialHeader); decipher.setAuthTag(bytes.subarray(offset + 12, offset + 28));
    const credential = credentialSchema.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(offset + 28)), decipher.final()]).toString('utf8')));
    if (credential.request_digest !== digest(clientProvisionRequestSchema.parse(input))) throw new Error();
    return credential;
  } catch { throw new ClientProvisionError('credential_unavailable', 'The protected login does not match this request or could not be opened. Do not replace it or rotate the account implicitly.'); }
}
