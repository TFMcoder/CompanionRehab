import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { bootstrapLocalUser, LocalCare } from '../src/server/local-care.js';
import { localCareMigrations } from '../src/server/local-migrations.js';
import { MealGroceryService } from '../src/server/meal-grocery.js';
import { ProgramService } from '../src/server/programs.js';
import { ProgressService } from '../src/server/progress.js';
import { decryptSnapshot, encryptSnapshot, exportSnapshot, localBackupTables, restoreSnapshot, type Snapshot } from '../src/server/backup.js';
import { pglitePool } from './helpers/pglite-pool.js';

const now = new Date('2026-10-13T14:00:00Z');
const command = () => ({ idempotency_key: randomUUID() });
const required = ['meal_proposals', 'meal_option_details', 'grocery_items', 'meal_grocery_receipts',
  'program_definitions', 'program_versions', 'program_runs', 'program_receipts',
  'support_shares', 'support_notification_preferences', 'support_notifications', 'support_notification_scanned',
  'support_notification_scan_cursor', 'routine_choices', 'prompt_preferences', 'prompt_jobs', 'prompt_delivery_events',
  'prompt_scheduler_cursor',
  'progress_rule_sets', 'progress_clinical_configs', 'progress_receipts', 'progress_exports'];
function disposableUrl(value: string) {
  const url = new URL(value);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || !/^\/nancy_features_[a-z0-9_]+$/.test(url.pathname)
      || url.search || url.hash) throw new Error('Use a disposable loopback nancy_features database.');
  return value;
}

describe('new local feature encrypted backup and empty-target restore', () => {
  let sourceDb: PGlite | undefined, targetDb: PGlite | undefined, source: Pool, target: Pool, snapshot: Snapshot;
  let ownerId: string, familyId: string, proposalId: string, optionId: string, programId: string, versionId: string;
  const key = randomBytes(32);
  beforeAll(async () => {
    const sourceUrl = process.env.LOCAL_FEATURE_BACKUP_SOURCE_URL;
    const targetUrl = process.env.LOCAL_FEATURE_BACKUP_TARGET_URL;
    if (sourceUrl || targetUrl) {
      if (!sourceUrl || !targetUrl) throw new Error('Use distinct disposable source and target databases.');
      const sourcePath = new URL(disposableUrl(sourceUrl)).pathname;
      const targetPath = new URL(disposableUrl(targetUrl)).pathname;
      const httpPath = process.env.LOCAL_FEATURE_HTTP_URL ? new URL(disposableUrl(process.env.LOCAL_FEATURE_HTTP_URL)).pathname : null;
      if (sourcePath === targetPath || sourcePath === httpPath || targetPath === httpPath)
        throw new Error('Use distinct disposable feature databases.');
      source = new Pool({ connectionString: sourceUrl, max: 1 });
      target = new Pool({ connectionString: targetUrl, max: 1 });
    } else {
      sourceDb = new PGlite(); targetDb = new PGlite();
      source = pglitePool(sourceDb) as unknown as Pool; target = pglitePool(targetDb) as unknown as Pool;
    }
    for (const file of localCareMigrations) {
      const sql = await readFile(new URL(`../db/${file}`, import.meta.url), 'utf8');
      if (sourceDb) await sourceDb.exec(sql); else await source.query(sql);
      if (targetDb) await targetDb.exec(sql); else await target.query(sql);
    }
    const owner = await bootstrapLocalUser(source, { email: 'feature-backup-owner@example.invalid',
      password: 'synthetic-feature-backup-password', role: 'client', display_name: 'Synthetic owner', time_zone: 'America/Toronto' });
    const family = await bootstrapLocalUser(source, { email: 'feature-backup-family@example.invalid',
      password: 'synthetic-feature-backup-password', role: 'family_friend', participant_id: owner.participant_id });
    ownerId = owner.user_id; familyId = family.user_id;
    const care = new LocalCare({ pool: source, clock: () => now });
    const session = await care.login('feature-backup-owner@example.invalid', 'synthetic-feature-backup-password');
    const meals = new MealGroceryService(source, { clock: () => now });
    const proposal = await meals.command(session, { type: 'propose_meal', ...command(), draft: {
      name: 'Synthetic lentil supper', slots: ['dinner'], portion: 'One ordinary serving',
      ingredients: [{ name: 'Lentils', amount: 1, unit: 'cup' }], preference_notes: '', source_refs: [] } });
    proposalId = proposal.result.proposal_id as string;
    const accepted = await meals.command(session, { type: 'accept_meal', ...command(), proposal_id: proposalId, expected_revision: 1 });
    optionId = accepted.result.option_id as string;
    await meals.command(session, { type: 'add_grocery', ...command(), item: { name: 'Lentils', amount: 1, unit: 'cup' },
      proposal_id: proposalId, expected_proposal_revision: 2 });
    await meals.command(session, { type: 'upsert_pantry', ...command(), item_id: null, expected_revision: 0,
      item: { name: 'Rice', amount: 1, unit: 'bag' } });
    const programs = new ProgramService(source, { clock: () => now });
    const created = await programs.command(session, { type: 'create_program', ...command(), confirmed: true, draft: {
      title: 'Synthetic preparation sequence', kind: 'routine', protected_start: null, protected_end: null, rest_minutes: 0,
      steps: [{ id: 'prepare', title: 'Prepare', instruction: 'Use the synthetic step.', optional: false, depends_on: [], estimated_minutes: 5 }],
    } });
    programId = created.definition_id!; versionId = created.version_id!;
    await programs.command(session, { type: 'approve_program', ...command(), confirmed: true,
      version_id: versionId, approval_ref: 'Synthetic owner review' });
    await programs.command(session, { type: 'start_program', ...command(), confirmed: true,
      version_id: versionId, local_date: '2026-10-13', acknowledged_conflicts: [] });
    await source.query(`insert into companion_local.support_shares(participant_id,actor_id,role,share_progress)
      values($1,$2,'family_friend',true)`, [ownerId, familyId]);
    await source.query(`insert into companion_local.support_notification_preferences(participant_id,actor_id,role,time_zone,task_completion)
      values($1,$2,'family_friend','America/Toronto',true)`, [ownerId, familyId]);
    const eventId = randomUUID();
    await source.query(`insert into companion_local.domain_events(id,participant_id,actor_id,event_type,data)
      values($1,$2,$2,'ActivityReported','{}')`, [eventId, ownerId]);
    await source.query(`insert into companion_local.support_notifications(participant_id,recipient_id,recipient_role,event_id,activity_id,activity_kind,event_type,activity_revision)
      values($1,$2,'family_friend',$3,$4,'task','ActivityReported',1)`, [ownerId, familyId, eventId, randomUUID()]);
    await source.query('insert into companion_local.support_notification_scanned(event_id) values($1)', [eventId]);
    await source.query('insert into companion_local.support_notification_scan_cursor(id,last_participant_id) values(true,$1)', [ownerId]);
    await source.query(`insert into companion_local.routine_choices(participant_id,revision,selections,updated_by)
      values($1,1,'[]',$1)`, [ownerId]);
    await source.query(`insert into companion_local.prompt_preferences(participant_id,revision,enabled,consent_actor)
      values($1,1,true,$1)`, [ownerId]);
    const promptId = randomUUID();
    await source.query(`insert into companion_local.prompt_jobs(id,participant_id,source_key,source_version,preference_revision,due_at,expires_at,message,state)
      values($1,$2,'synthetic-meal','1',1,$3,$4,'Synthetic reminder','pending')`, [promptId, ownerId, now, new Date(now.getTime()+3600000)]);
    await source.query(`insert into companion_local.prompt_delivery_events(id,participant_id,prompt_id,event_type,actor_id,data)
      values($1,$2,$3,'created',$2,'{}')`, [randomUUID(), ownerId, promptId]);
    await source.query('insert into companion_local.prompt_scheduler_cursor(id,last_participant_id) values(true,$1)', [ownerId]);
    const progress = new ProgressService(source, { clock: () => now });
    await progress.command(session, { type: 'approve_scoring_rules', ...command(), expected_rule_version: 0,
      approval_ref: 'Synthetic owner approval', rules: { weights: [{ kind: 'task', weight: 1 }],
        deferral_treatment: 'exempt', achievements: [] } });
    await progress.command(session, { type: 'approve_clinical_config', ...command(), archetype: 'family_doctor',
      expected_version: 0, title: 'Synthetic reviewed view', fields: ['local_date', 'status'], approval_ref: 'Synthetic owner review' });
    await progress.command(session, { type: 'request_data_export', ...command(), from: '2026-10-13', to: '2026-10-13',
      format: 'csv', fields: ['local_date', 'status'] });
    snapshot = await exportSnapshot(source, 'synthetic-feature-source', 'companion_local');
  });
  afterAll(async () => {
    if (sourceDb) await sourceDb.close(); else await source?.end();
    if (targetDb) await targetDb.close(); else await target?.end();
  });

  it('covers the full current migration set and encrypts local feature records without sessions', () => {
    expect(required.every(table => localBackupTables.includes(table as typeof localBackupTables[number]))).toBe(true);
    for (const table of required) expect(snapshot.tables[table].length, table).toBeGreaterThan(0);
    expect(snapshot.tables.sessions).toBeUndefined();
    const ciphertext = encryptSnapshot(snapshot, key);
    expect(ciphertext.includes(Buffer.from('Synthetic lentil supper'))).toBe(false);
    expect(ciphertext.includes(Buffer.from('feature-backup-owner@example.invalid'))).toBe(false);
    expect(decryptSnapshot(ciphertext, key).tables).toEqual(JSON.parse(JSON.stringify(snapshot.tables)));
  });

  it('includes every durable companion_local table except live sessions', async () => {
    const tables = (await source.query(`select table_name from information_schema.tables
      where table_schema='companion_local' and table_type='BASE TABLE' order by table_name`)).rows
      .map(row => row.table_name as string).filter(name => name !== 'sessions');
    const missing = tables.filter(name => !localBackupTables.includes(name as typeof localBackupTables[number]));
    expect(missing, `Backup omits durable tables: ${missing.join(', ')}`).toEqual([]);
    expect([...localBackupTables].sort()).toEqual(tables);
  });

  it('restores linked accepted meals, groceries and current program versions in dependency order', async () => {
    await restoreSnapshot(target, decryptSnapshot(encryptSnapshot(snapshot, key), key), 'synthetic-feature-target');
    const restored = await exportSnapshot(target, 'synthetic-feature-target', 'companion_local');
    expect(restored.tables).toEqual(snapshot.tables);
    expect((await target.query('select count(*)::int n from companion_local.sessions')).rows[0].n).toBe(0);
    expect((await target.query(`select count(*)::int n from companion_local.grocery_items g
      join companion_local.meal_proposals p on p.id=g.meal_proposal_id
      join companion_local.meal_options o on o.id=p.accepted_option_id
      join companion_local.meal_option_details d on d.option_id=o.id
      where p.id=$1 and o.id=$2`, [proposalId, optionId])).rows[0].n).toBe(1);
    expect((await target.query(`select count(*)::int n from companion_local.program_definitions d
      join companion_local.program_versions v on v.definition_id=d.id and v.version=d.current_version
      join companion_local.program_runs r on r.version_id=v.id
      where d.id=$1 and v.id=$2 and v.approved_at is not null`, [programId, versionId])).rows[0].n).toBe(1);
    expect((await target.query('select count(*)::int n from companion_local.progress_rule_sets where participant_id=$1', [ownerId])).rows[0].n).toBe(1);
    await expect(target.query("update companion_local.progress_receipts set result='{}'::jsonb")).rejects.toBeTruthy();
  });

  it('refuses a source or populated target and a missing new table', async () => {
    await expect(restoreSnapshot(target, snapshot, snapshot.source_id)).rejects.toThrow('source database');
    await expect(restoreSnapshot(target, snapshot, 'synthetic-feature-target')).rejects.toThrow('Target contains care data');
    const missing = structuredClone(snapshot); delete missing.tables.program_versions;
    expect(() => decryptSnapshot(encryptSnapshot(missing, key), key)).toThrow('schema does not match');
  });
});
