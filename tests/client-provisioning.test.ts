import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { LocalCare, bootstrapLocalUser } from '../src/server/local-care.js';
import { localCareMigrations } from '../src/server/local-migrations.js';
import { applyClientProvision, createClientCredential, decryptClientCredential, encryptClientCredential,
  reviewClientProvision, type ClientProvisionRequest } from '../src/server/client-provisioning.js';
import { pglitePool } from './helpers/pglite-pool.js';

describe('permanent client access transition without moving care records', () => {
  let db: PGlite, pool: Pool;
  const now = new Date('2026-10-14T10:00:00Z');
  beforeAll(async () => {
    db = new PGlite(); pool = pglitePool(db) as unknown as Pool;
    for (const file of localCareMigrations) await db.exec(await readFile(new URL('../db/' + file, import.meta.url), 'utf8'));
  });
  afterAll(async () => { await db.close(); });
  async function fixture(role: ClientProvisionRequest['practice_role_after'] = 'family_friend') {
    const email = randomUUID() + '@example.invalid', password = 'synthetic-practice-password';
    const owner = await bootstrapLocalUser(pool, { email, password, role: 'client', display_name: 'Synthetic preserved participant' });
    const care = new LocalCare({ pool, clock: () => now }), session = await care.login(email, password);
    await care.command(session, { type: 'start_or_resume_checkin', idempotency_key: randomUUID(), local_date: '2026-10-14', expected_revision: 0, payload: {} });
    const request: ClientProvisionRequest = { operation_id: randomUUID(), participant_id: owner.participant_id,
      practice_actor_id: owner.user_id, client_actor_id: randomUUID(), client_email: randomUUID() + '@example.invalid',
      practice_role_after: role, approval_ref: 'synthetic-private-decision', backup_ref: '.local/backups/synthetic.nancy' };
    return { owner, care, session, request, email, password };
  }
  async function preserved(participant: string) {
    const result: Record<string, unknown> = {};
    for (const table of ['participant_profiles', 'daily_checkins', 'day_plan_proposals', 'accepted_day_plan_versions', 'command_receipts', 'activity_records'])
      result[table] = (await pool.query(`select * from companion_local.${table} where ${table === 'participant_profiles' ? 'id' : 'participant_id'}=$1`, [participant])).rows;
    return result;
  }

  it('preflights without changing records or creating credentials/accounts', async () => {
    const f = await fixture(); const before = await preserved(f.owner.participant_id);
    const review = await reviewClientProvision(pool, f.request);
    expect(review).toMatchObject({ request: f.request, sessions_to_revoke: 1, inference_enabled: false, feature_sharing_added: false,
      preserved_counts: { checkins: 1, care_events: 1, activities: 0, accepted_plans: 0 } });
    expect(await preserved(f.owner.participant_id)).toEqual(before);
    expect((await pool.query('select id from companion_local.accounts where id=$1', [f.request.client_actor_id])).rows).toEqual([]);
    expect(await f.care.authorize(f.session)).toEqual(f.session);
  });

  it('preserves the participant and historical actors, grants a distinct client, and invalidates the former client session', async () => {
    const f = await fixture(), before = await preserved(f.owner.participant_id);
    const events = (await pool.query('select * from companion_local.domain_events where participant_id=$1 order by id', [f.owner.participant_id])).rows;
    const review = await reviewClientProvision(pool, f.request), credential = createClientCredential(f.request);
    const result = await applyClientProvision(pool, f.request, review.review_digest, credential.password, () => now);
    expect(result).toMatchObject({ participant_id: f.owner.participant_id, client_actor_id: f.request.client_actor_id, sessions_revoked: 1, replayed: false });
    expect(await preserved(f.owner.participant_id)).toEqual(before);
    expect((await pool.query("select * from companion_local.domain_events where participant_id=$1 and event_type<>'PermanentClientAccountProvisioned' order by id", [f.owner.participant_id])).rows).toEqual(events);
    await expect(f.care.authorize(f.session)).rejects.toMatchObject({ status: 401 });
    const client = await f.care.login(f.request.client_email, credential.password);
    expect((await f.care.authority(client))).toMatchObject({ actor_id: f.request.client_actor_id, client_id: f.owner.participant_id, active_role: 'client' });
    expect((await f.care.today(client)).profile?.id).toBe(f.owner.participant_id);
    const former = await f.care.login(f.email, f.password);
    expect(await f.care.role(former)).toBe('family_friend');
    await expect(f.care.command(former, { type: 'start_or_resume_checkin', idempotency_key: randomUUID(), local_date: '2026-10-14', expected_revision: 0, payload: {} }))
      .rejects.toMatchObject({ status: 403 });
    for (const table of ['request_access', 'support_shares', 'program_access', 'progress_access', 'operations_access'])
      expect((await pool.query(`select * from companion_local.${table} where participant_id=$1`, [f.owner.participant_id])).rows).toEqual([]);
    const event = (await pool.query("select data from companion_local.domain_events where participant_id=$1 and event_type='PermanentClientAccountProvisioned'", [f.owner.participant_id])).rows[0].data;
    expect(JSON.stringify(event)).not.toContain(credential.password);
  });

  it('recovers the same operation without creating another account, changing a password or duplicating the event', async () => {
    const f = await fixture('none'), review = await reviewClientProvision(pool, f.request), credential = createClientCredential(f.request);
    const first = await applyClientProvision(pool, f.request, review.review_digest, credential.password, () => now);
    expect(await applyClientProvision(pool, f.request, review.review_digest, credential.password, () => now)).toEqual({ ...first, replayed: true });
    expect((await pool.query("select id from companion_local.domain_events where participant_id=$1 and event_type='PermanentClientAccountProvisioned'", [f.owner.participant_id])).rows).toHaveLength(1);
    await expect(f.care.login(f.email, f.password)).rejects.toMatchObject({ status: 401 });
    expect((await f.care.login(f.request.client_email, credential.password)).user_id).toBe(f.request.client_actor_id);
    await expect(applyClientProvision(pool, { ...f.request, practice_role_after: 'administrator' }, review.review_digest, credential.password, () => now))
      .rejects.toMatchObject({ code: 'operation_conflict' });
  });

  it('rejects a stale review atomically and leaves the old client able to use the unchanged profile', async () => {
    const f = await fixture(), review = await reviewClientProvision(pool, f.request);
    await pool.query('update companion_local.participant_profiles set revision=revision+1 where id=$1', [f.owner.participant_id]);
    await expect(applyClientProvision(pool, f.request, review.review_digest, createClientCredential(f.request).password, () => now)).rejects.toMatchObject({ code: 'review_stale' });
    expect((await pool.query('select id from companion_local.accounts where id=$1', [f.request.client_actor_id])).rows).toEqual([]);
    expect(await f.care.authorize(f.session)).toEqual(f.session);
    expect(await f.care.role(f.session)).toBe('client');
  });

  it('refuses ambiguous existing client grants and an existing destination email', async () => {
    const f = await fixture();
    await expect(reviewClientProvision(pool, { ...f.request, client_email: f.email })).rejects.toMatchObject({ code: 'client_account_exists' });
    await bootstrapLocalUser(pool, { email: randomUUID() + '@example.invalid', password: 'synthetic-extra-client-password', role: 'client', participant_id: f.owner.participant_id });
    await expect(reviewClientProvision(pool, f.request)).rejects.toMatchObject({ code: 'client_grants_changed' });
  });

  it('rolls back a failure after creating the account and preserves the prior client access', async () => {
    const f = await fixture(), review = await reviewClientProvision(pool, f.request);
    const wrapped = Object.create(pool) as Pool;
    wrapped.connect = (async () => {
      const client = await pool.connect(), query = client.query.bind(client);
      return { query: (sql: string, values?: unknown[]) => {
        if (sql.startsWith('update companion_local.role_grants set revoked_at')) throw new Error('Synthetic interrupted transition');
        return query(sql, values);
      }, release: () => client.release() };
    }) as Pool['connect'];
    await expect(applyClientProvision(wrapped, f.request, review.review_digest, createClientCredential(f.request).password, () => now))
      .rejects.toMatchObject({ code: 'provisioning_unconfirmed' });
    expect((await pool.query('select id from companion_local.accounts where id=$1', [f.request.client_actor_id])).rows).toEqual([]);
    expect((await pool.query('select id from companion_local.role_grants where actor_id=$1', [f.request.client_actor_id])).rows).toEqual([]);
    expect(await f.care.authorize(f.session)).toEqual(f.session);
    expect(await f.care.role(f.session)).toBe('client');
  });

  it('can re-role the practice actor as administrator without retaining client approvals or granting feature access', async () => {
    const f = await fixture('administrator'), review = await reviewClientProvision(pool, f.request);
    await applyClientProvision(pool, f.request, review.review_digest, createClientCredential(f.request).password, () => now);
    const administrator = await f.care.login(f.email, f.password);
    expect(await f.care.role(administrator)).toBe('administrator');
    await expect(f.care.command(administrator, { type: 'start_or_resume_checkin', idempotency_key: randomUUID(), local_date: '2026-10-14', expected_revision: 0, payload: {} }))
      .rejects.toMatchObject({ status: 403 });
    expect((await pool.query('select * from companion_local.operations_access where participant_id=$1', [f.owner.participant_id])).rows).toEqual([]);
  });

  it('does not silently retain an unreviewed secondary practice role or restore a revoked one', async () => {
    const f = await fixture('none');
    await pool.query("insert into companion_local.role_grants(participant_id,actor_id,role) values($1,$2,'family_friend')", [f.owner.participant_id, f.owner.user_id]);
    await expect(reviewClientProvision(pool, f.request)).rejects.toMatchObject({ code: 'practice_roles_changed' });
    await pool.query("update companion_local.role_grants set revoked_at=$3 where participant_id=$1 and actor_id=$2 and role='family_friend'", [f.owner.participant_id, f.owner.user_id, now]);
    await expect(reviewClientProvision(pool, { ...f.request, practice_role_after: 'family_friend' })).rejects.toMatchObject({ code: 'previous_role_revoked' });
  });

  it('encrypts the only generated login and rejects tampering or another request', async () => {
    const f = await fixture(), credential = createClientCredential(f.request), key = randomBytes(32);
    const bytes = encryptClientCredential(credential, key);
    expect(bytes.includes(Buffer.from(credential.password))).toBe(false);
    expect(decryptClientCredential(bytes, key, f.request)).toEqual(credential);
    expect(() => decryptClientCredential(bytes, key, { ...f.request, client_actor_id: randomUUID() })).toThrow(/does not match/);
    const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] ^= 1;
    expect(() => decryptClientCredential(corrupt, key, f.request)).toThrow(/could not be opened/);
    expect(() => decryptClientCredential(bytes, randomBytes(32), f.request)).toThrow(/could not be opened/);
  });
});
