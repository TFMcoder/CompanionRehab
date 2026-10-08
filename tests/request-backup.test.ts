import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localCareMigrations } from '../src/server/local-migrations.js';
import { bootstrapLocalUser, LocalCare } from '../src/server/local-care.js';
import { TaskRequestService } from '../src/server/task-requests.js';
import { decryptSnapshot, encryptSnapshot, exportSnapshot, localBackupTables, restoreSnapshot, type Snapshot } from '../src/server/backup.js';
import type { TaskRequestDraft } from '../src/shared/task-request-contracts.js';
import { pglitePool } from './helpers/pglite-pool.js';

const requestTables = ['request_access','request_day_capacity','request_constraints','task_requests','request_help','request_flags','request_receipts'];
describe('request state encrypted backup and isolated restore', () => {
  let source: Pool, target: Pool, sourceDb: PGlite | undefined, targetDb: PGlite | undefined;
  let snapshot: Snapshot;
  const key = randomBytes(32), clock = () => new Date('2026-10-07T12:00:00Z');
  const command = () => ({ idempotency_key: randomUUID(), confirmed: true as const });
  beforeAll(async () => {
    const urls = [process.env.REQUEST_BACKUP_SOURCE_URL, process.env.REQUEST_BACKUP_TARGET_URL];
    if (urls.some(Boolean)) {
      if (!urls.every(Boolean) || urls[0] === urls[1]) throw new Error('Supply distinct disposable backup databases.');
      for (const url of urls) {
        const parsed = new URL(url!);
        if (!['127.0.0.1','localhost'].includes(parsed.hostname) || !/^\/nancy_requests_[a-z0-9_]+$/.test(parsed.pathname))
          throw new Error('Use isolated loopback request probe databases.');
      }
      source = new Pool({ connectionString: urls[0], max: 1 }); target = new Pool({ connectionString: urls[1], max: 1 });
    } else {
      sourceDb = new PGlite(); targetDb = new PGlite();
      source = pglitePool(sourceDb) as unknown as Pool; target = pglitePool(targetDb) as unknown as Pool;
    }
    for (const file of localCareMigrations) {
      const sql = await readFile(new URL('../db/'+file, import.meta.url), 'utf8');
      if (sourceDb) await sourceDb.exec(sql); else await source.query(sql);
      if (targetDb) await targetDb.exec(sql); else await target.query(sql);
    }
    const care = new LocalCare({ pool: source, clock }); const requests = new TaskRequestService(source, { clock });
    const owner = await bootstrapLocalUser(source, { email: 'backup-client@example.invalid', password: 'synthetic-backup-password',
      role: 'client', display_name: 'Synthetic backup client', time_zone: 'America/Toronto' });
    const family = await bootstrapLocalUser(source, { email: 'backup-family@example.invalid', password: 'synthetic-backup-password',
      role: 'family_friend', participant_id: owner.participant_id });
    const admin = await bootstrapLocalUser(source, { email: 'backup-admin@example.invalid', password: 'synthetic-backup-password',
      role: 'administrator', participant_id: owner.participant_id });
    const clientSession = await care.login('backup-client@example.invalid', 'synthetic-backup-password');
    const familySession = await care.login('backup-family@example.invalid', 'synthetic-backup-password');
    await requests.command(clientSession, { ...command(), type: 'set_request_access', actor_id: family.user_id, role: 'family_friend',
      expected_revision: 0, capabilities: ['request_tasks','read_requests'] });
    await requests.command(clientSession, { ...command(), type: 'set_request_access', actor_id: admin.user_id, role: 'administrator',
      expected_revision: 0, capabilities: ['review_request_flags'] });
    await requests.command(clientSession, { ...command(), type: 'set_day_capacity', local_date: '2026-10-07',
      expected_revision: 0, available_minutes: 120, rest_minutes: 10 });
    await source.query(`insert into companion_local.request_constraints(participant_id,revision,max_task_minutes,max_daily_request_minutes,approval_ref)
      values($1,1,60,120,'synthetic-approved-constraint')`, [owner.participant_id]);
    const draft: TaskRequestDraft = { task_name: 'Synthetic backup grocery request', priority: 'low', requested_date: '2026-10-07',
      requested_time: '15:00', participant_time_zone: 'America/Toronto', estimated_duration_minutes: 20, travel_minutes: 10, notes: '' };
    const review = await requests.review(familySession, draft);
    const accepted = await requests.command(familySession, { ...command(), type: 'submit_request', draft, review_token: review.review_token });
    const acceptance = await requests.review(clientSession, draft);
    await requests.command(clientSession, { ...command(), type: 'accept_request', request_id: accepted.request_id!, expected_revision: 1,
      draft, review_token: acceptance.review_token, schedule_review_confirmed: true });
    const secondDraft = { ...draft, task_name: 'Synthetic declined request', requested_time: '17:00' };
    const secondReview = await requests.review(familySession, secondDraft);
    const rejected = await requests.command(familySession, { ...command(), type: 'submit_request', draft: secondDraft, review_token: secondReview.review_token });
    await requests.command(clientSession, { ...command(), type: 'reject_request', request_id: rejected.request_id!, expected_revision: 1,
      reason: 'Synthetic capacity reason.' });
    snapshot = await exportSnapshot(source, 'synthetic-request-source', 'companion_local');
  });
  afterAll(async () => { if (sourceDb) await sourceDb.close(); else await source?.end(); if (targetDb) await targetDb.close(); else await target?.end(); });

  it('captures every request table and excludes sessions while encrypting identifiers and reasons', () => {
    expect(requestTables.every(table => localBackupTables.includes(table as typeof localBackupTables[number]))).toBe(true);
    for (const table of requestTables) expect(snapshot.tables[table].length).toBeGreaterThan(0);
    expect(snapshot.tables.sessions).toBeUndefined();
    const encrypted = encryptSnapshot(snapshot, key);
    expect(encrypted.includes(Buffer.from('Synthetic capacity reason.'))).toBe(false);
    expect(encrypted.includes(Buffer.from('backup-client@example.invalid'))).toBe(false);
    expect(decryptSnapshot(encrypted, key).tables).toEqual(JSON.parse(JSON.stringify(snapshot.tables)));
  });

  it('restores accepted tasks, rejected help/flags, access, capacity and receipts in dependency order', async () => {
    await restoreSnapshot(target, decryptSnapshot(encryptSnapshot(snapshot, key), key), 'synthetic-request-restore');
    const restored = await exportSnapshot(target, 'synthetic-request-restore', 'companion_local');
    expect(restored.tables).toEqual(snapshot.tables);
    expect((await target.query('select count(*)::int as n from companion_local.sessions')).rows[0].n).toBe(0);
    expect((await target.query(`select count(*)::int as n from companion_local.task_requests r
      join companion_local.task_definitions t on t.id=r.task_id join companion_local.accepted_day_plan_versions p on p.id=r.accepted_plan_id
      where r.status='accepted'`)).rows[0].n).toBe(1);
    expect((await target.query(`select count(*)::int as n from companion_local.task_requests r
      join companion_local.activity_records a on a.id=r.activity_id
      where r.status='accepted' and a.last_action='accepted' and a.status='pending' and a.occurred_at is null`)).rows[0].n).toBe(1);
    expect((await target.query(`select count(*)::int as n from companion_local.request_flags f
      join companion_local.request_help h on h.id=f.help_id join companion_local.task_requests r on r.id=h.request_id
      where r.status='rejected'`)).rows[0].n).toBe(1);
    await expect(target.query("update companion_local.request_receipts set result='{}'::jsonb")).rejects.toBeTruthy();
  });

  it('refuses restoring into its source or a nonempty target and rejects omitted request tables', async () => {
    await expect(restoreSnapshot(target, snapshot, snapshot.source_id)).rejects.toThrow('source database');
    await expect(restoreSnapshot(target, snapshot, 'synthetic-request-restore')).rejects.toThrow('Target contains care data');
    const incomplete = structuredClone(snapshot); delete incomplete.tables.request_help;
    expect(() => decryptSnapshot(encryptSnapshot(incomplete, key), key)).toThrow('schema does not match');
    const old = structuredClone(snapshot); old.schema_hash = '0'.repeat(64);
    expect(() => decryptSnapshot(encryptSnapshot(old, key), key)).toThrow('schema does not match');
  });
});
