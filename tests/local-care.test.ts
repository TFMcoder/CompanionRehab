import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { LocalCare, bootstrapLocalUser } from '../src/server/local-care.js';
import { decryptSnapshot, encryptSnapshot, exportSnapshot, restoreSnapshot } from '../src/server/backup.js';
import type { CareCommand, SetupInput } from '../src/shared/contracts.js';

function pglitePool(db: PGlite) {
  return {
    query: (text: string, values?: unknown[]) => db.query(text, values),
    connect: async () => {
      let tx: any;
      let work: Promise<unknown> | undefined;
      let unlock: (() => void) | undefined;
      let cancel: ((error: Error) => void) | undefined;
      return {
        query: async (text: string, values?: unknown[]) => {
          const statement = text.trim().toLowerCase();
          if (statement === 'begin') {
            let ready!: () => void;
            const started = new Promise<void>(resolve => { ready = resolve; });
            const hold = new Promise<void>((resolve, reject) => { unlock = resolve; cancel = reject; });
            work = db.transaction(async transaction => { tx = transaction; ready(); await hold; });
            await started;
            return { rows: [], rowCount: 0 };
          }
          if (statement === 'commit') {
            unlock?.();
            await work;
            tx = undefined;
            return { rows: [], rowCount: 0 };
          }
          if (statement === 'rollback') {
            cancel?.(new Error('test transaction rollback'));
            await work?.catch(() => {});
            tx = undefined;
            return { rows: [], rowCount: 0 };
          }
          return tx ? tx.query(text, values) : db.query(text, values);
        },
        release() {},
      };
    },
  };
}

describe('local PostgreSQL care adapter', () => {
  let db: PGlite;
  let care: LocalCare;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(await readFile(new URL('../db/002_local_care.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../db/003_activity_ledger.sql', import.meta.url), 'utf8'));
    care = new LocalCare({ pool: pglitePool(db) as any });
  });
  afterAll(async () => { await db.close(); });

  it('authenticates a local account and commits exact-version plans with receipt replay', async () => {
    await bootstrapLocalUser(care.pool, { email: 'synthetic-client@example.invalid', password: 'synthetic-only-password-1', role: 'client', display_name: 'Synthetic Client', time_zone: 'America/Toronto' });
    const session = await care.login('synthetic-client@example.invalid', 'synthetic-only-password-1');
    expect(await care.role(session)).toBe('client');
    const today = await care.today(session);
    const setup = await care.setup(session, {
      display_name: 'Synthetic Client', time_zone: 'America/Toronto', expected_revision: 0, preferences: '',
      tasks: [{ title: 'Synthetic walk', time_hint: 'morning', urgency: 'medium', scheduled_time: '09:15', category: 'exercise', duration_minutes: 15 }],
      meal_options: [
        { name: 'Oatmeal', slots: ['breakfast'] }, { name: 'Soup', slots: ['lunch'] }, { name: 'Pasta', slots: ['dinner'] },
      ],
    });
    expect(setup.tasks[0]).toMatchObject({ title: 'Synthetic walk', scheduled_time: '09:15', urgency: 'medium' });
    await expect(care.setup(session, { display_name: 'Synthetic Client', time_zone: 'America/Toronto', expected_revision: 1, preferences: '',
      tasks: [{ id: crypto.randomUUID(), title: 'Unknown target', time_hint: null }], meal_options: setup.meal_options })).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await care.today(session)).tasks.some(task => task.id === setup.tasks[0].id)).toBe(true);
    const start: CareCommand = { type: 'start_or_resume_checkin', idempotency_key: crypto.randomUUID(), local_date: today.local_date, expected_revision: 0, payload: {} };
    const started = await care.command(session, start);
    expect(started.result).toBe('resumed');
    const proposal: CareCommand = { type: 'propose_day_plan', idempotency_key: crypto.randomUUID(), local_date: today.local_date, expected_revision: started.revision,
      payload: { task_ids: [setup.tasks[0].id], task_overrides: [{ id: setup.tasks[0].id, urgency: 'low', scheduled_time: '11:00' }], meals: [
        { slot: 'breakfast', option_id: setup.meal_options.find(m => m.slots.includes('breakfast'))!.id }, { slot: 'lunch', option_id: setup.meal_options.find(m => m.slots.includes('lunch'))!.id }, { slot: 'dinner', option_id: setup.meal_options.find(m => m.slots.includes('dinner'))!.id },
      ] } };
    const proposed = await care.command(session, proposal);
    expect(proposed.plan?.tasks[0]).toMatchObject({ urgency: 'low', scheduled_time: '11:00' });
    expect((await care.today(session)).tasks[0]).toMatchObject({ urgency: 'medium', scheduled_time: '09:15' });
    expect(proposed.result).toBe('proposed');
    expect((await care.command(session, proposal)).replayed).toBe(true);
    expect(await care.receipt(session, proposal.idempotency_key)).toMatchObject({ result: 'proposed' });
    const accepted: CareCommand = { type: 'accept_day_plan', idempotency_key: crypto.randomUUID(), local_date: today.local_date, expected_revision: proposed.revision, payload: { proposal_id: proposed.plan!.id } };
    expect((await care.command(session, accepted)).result).toBe('accepted');
    expect((await care.today(session)).checkin?.accepted?.version).toBe(1);
    await expect(care.command(session, { ...accepted, idempotency_key: crypto.randomUUID(), expected_revision: proposed.revision })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('denies a scoped family grant access to client commands and writes grocery/appointment receipts once', async () => {
    const owner = await care.login('synthetic-client@example.invalid', 'synthetic-only-password-1');
    const profile = await care.today(owner);
    const ownerId = (await care.pool.query('select id from companion_local.participant_profiles where display_name=$1', ['Synthetic Client'])).rows[0].id;
    await bootstrapLocalUser(care.pool, { email: 'synthetic-family@example.invalid', password: 'synthetic-family-password-2', role: 'family_friend', participant_id: ownerId });
    const family = await care.login('synthetic-family@example.invalid', 'synthetic-family-password-2');
    expect(await care.role(family)).toBe('family_friend');
    await expect(care.today(family)).rejects.toMatchObject({ status: 403 });
    expect(profile.profile?.display_name).toBe('Synthetic Client');
    const groceryKey = crypto.randomUUID();
    const first = await care.addGrocery(owner, { name: 'Synthetic apples', quantity: '2', idempotency_key: groceryKey });
    const replay = await care.addGrocery(owner, { name: 'Synthetic apples', quantity: '2', idempotency_key: groceryKey });
    expect(replay).toEqual(first);
    expect((await care.groceries(owner)).items.filter(item => item.id === first.item.id)).toHaveLength(1);
    const appointment = { title: 'Synthetic appointment', starts_at: new Date(Date.now() + 86400000).toISOString(), idempotency_key: crypto.randomUUID() };
    expect(await care.setAppointment(owner, appointment)).toEqual(await care.setAppointment(owner, appointment));
    expect((await care.appointments(owner)).appointments.some(item => item.title === 'Synthetic appointment')).toBe(true);
  });

  it('encrypts local account/care export and restores care data without copying active sessions', async () => {
    const source = await exportSnapshot(care.pool as any, 'source-local', 'companion_local');
    expect(source.scope).toBe('care-and-local-access');
    expect(source.tables.sessions).toBeUndefined();
    expect(source.tables.accounts.length).toBeGreaterThan(0);
    const key = randomBytes(32);
    const encrypted = encryptSnapshot(source, key);
    expect(encrypted.includes(Buffer.from('synthetic-client@example.invalid'))).toBe(false);
    const decoded = decryptSnapshot(encrypted, key);
    const target = new PGlite();
    await target.exec(await readFile(new URL('../db/002_local_care.sql', import.meta.url), 'utf8'));
    await target.exec(await readFile(new URL('../db/003_activity_ledger.sql', import.meta.url), 'utf8'));
    try {
      await restoreSnapshot(target as any, decoded, 'target-local');
      const restored = await exportSnapshot(target as any, 'target-local', 'companion_local');
      expect(restored.tables).toEqual(source.tables);
      expect((await target.query<{ count: number }>('select count(*)::int as count from companion_local.sessions')).rows[0].count).toBe(0);
      const restoredCare = new LocalCare({ pool: pglitePool(target) as any });
      const restoredSession = await restoredCare.login('synthetic-client@example.invalid', 'synthetic-only-password-1');
      expect((await restoredCare.today(restoredSession)).profile?.display_name).toBe('Synthetic Client');
    } finally { await target.close(); }
  });
});

const describeLive = process.env.LOCAL_CARE_TEST_URL ? describe : describe.skip;
describeLive('local PostgreSQL 17 acceptance probe', () => {
  let care: LocalCare;
  afterAll(async () => { await care.close(); });
  it('persists scrypt auth, scoped grants, plan/version/receipt and groceries in actual PostgreSQL across adapter restart', async () => {
    care = new LocalCare({ connectionString: process.env.LOCAL_CARE_TEST_URL, poolConfig: { max: 2 } });
    const suffix = crypto.randomUUID();
    const email = `synthetic-${suffix}@example.invalid`;
    const password = `synthetic-${suffix}-password`;
    const owner = await bootstrapLocalUser(care.pool, { email, password, role: 'client', display_name: 'Disposable PostgreSQL probe', time_zone: 'America/Toronto' });
    const session = await care.login(email, password);
    const today = await care.today(session);
    const setup = await care.setup(session, { display_name: 'Disposable PostgreSQL probe', time_zone: 'America/Toronto', preferences: '', expected_revision: 0,
      tasks: [{ title: 'Disposable test walk', time_hint: 'morning', urgency: 'high', scheduled_time: '09:30', category: 'exercise', duration_minutes: 15 }],
      meal_options: [{ name: 'Test breakfast', slots: ['breakfast'] }, { name: 'Test lunch', slots: ['lunch'] }, { name: 'Test dinner', slots: ['dinner'] }] });
    expect(setup.tasks[0]).toMatchObject({ urgency: 'high', scheduled_time: '09:30', category: 'exercise' });
    const start: CareCommand = { type: 'start_or_resume_checkin', idempotency_key: crypto.randomUUID(), local_date: today.local_date, expected_revision: 0, payload: {} };
    const started = await care.command(session, start);
    const unknownOverride: CareCommand = { type: 'propose_day_plan', idempotency_key: crypto.randomUUID(), local_date: today.local_date, expected_revision: started.revision,
      payload: { task_ids: [], task_overrides: [{ id: crypto.randomUUID(), urgency: 'high' }], meals: [
        { slot: 'breakfast', option_id: setup.meal_options.find(m => m.slots.includes('breakfast'))!.id }, { slot: 'lunch', option_id: setup.meal_options.find(m => m.slots.includes('lunch'))!.id }, { slot: 'dinner', option_id: setup.meal_options.find(m => m.slots.includes('dinner'))!.id },
      ] } };
    await expect(care.command(session, unknownOverride)).rejects.toMatchObject({ code: 'invalid_input' });
    const proposal: CareCommand = { type: 'propose_day_plan', idempotency_key: crypto.randomUUID(), local_date: today.local_date, expected_revision: started.revision,
      payload: { task_ids: [setup.tasks[0].id], task_overrides: [{ id: setup.tasks[0].id, urgency: 'low', scheduled_time: '11:00' }], meals: [
        { slot: 'breakfast', option_id: setup.meal_options.find(m => m.slots.includes('breakfast'))!.id }, { slot: 'lunch', option_id: setup.meal_options.find(m => m.slots.includes('lunch'))!.id }, { slot: 'dinner', option_id: setup.meal_options.find(m => m.slots.includes('dinner'))!.id },
      ] } };
    const proposed = await care.command(session, proposal);
    expect(proposed.plan?.tasks[0]).toMatchObject({ urgency: 'low', scheduled_time: '11:00' });
    expect((await care.command(session, proposal)).replayed).toBe(true);
    const accepted = await care.command(session, { type: 'accept_day_plan', idempotency_key: crypto.randomUUID(), local_date: today.local_date,
      expected_revision: proposed.revision, payload: { proposal_id: proposed.plan!.id } });
    expect(accepted.result).toBe('accepted');
    const grocery = await care.addGrocery(session, { name: 'Disposable probe item', quantity: '1', idempotency_key: crypto.randomUUID() });
    const roleUser = await bootstrapLocalUser(care.pool, { email: `family-${suffix}@example.invalid`, password: `family-${suffix}-password`, role: 'family_friend', participant_id: owner.participant_id });
    expect(roleUser.participant_id).toBe(owner.participant_id);
    const family = await care.login(`family-${suffix}@example.invalid`, `family-${suffix}-password`);
    await expect(care.today(family)).rejects.toMatchObject({ status: 403 });
    await care.close();
    care = new LocalCare({ connectionString: process.env.LOCAL_CARE_TEST_URL, poolConfig: { max: 2 } });
    expect((await care.today(session)).checkin?.accepted?.version).toBe(1);
    expect((await care.receipt(session, accepted.command_id))?.result).toBe('accepted');
    expect((await care.groceries(session)).items.some(item => item.id === grocery.item.id)).toBe(true);
    await care.logout(session);
    await expect(care.today(session)).rejects.toMatchObject({ status: 401 });
    const snapshot = await exportSnapshot(care.pool as any, `postgres-source-${suffix}`, 'companion_local');
    const key = randomBytes(32);
    const decoded = decryptSnapshot(encryptSnapshot(snapshot, key), key);
    const target = new PGlite();
    await target.exec(await readFile(new URL('../db/002_local_care.sql', import.meta.url), 'utf8'));
    await target.exec(await readFile(new URL('../db/003_activity_ledger.sql', import.meta.url), 'utf8'));
    try {
      await restoreSnapshot(target as any, decoded, `pglite-target-${suffix}`);
      const restored = await exportSnapshot(target as any, `pglite-target-${suffix}`, 'companion_local');
      const dateOnly = (tables: unknown) => JSON.stringify(tables, (key, value) => key === 'local_date' && typeof value === 'string' ? value.slice(0, 10) : value);
      expect(dateOnly(restored.tables)).toBe(dateOnly(snapshot.tables));
      const restoredCare = new LocalCare({ pool: pglitePool(target) as any });
      const restoredSession = await restoredCare.login(email, password);
      expect((await restoredCare.today(restoredSession)).checkin?.accepted?.version).toBe(1);
    } finally { await target.close(); }
  });
});
