import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Client, Pool } from 'pg';
import { LocalCare, bootstrapLocalUser } from '../src/server/local-care.js';
import { databaseIdentity, decryptSnapshot, encryptSnapshot, exportSnapshot, restoreSnapshot, schemaHash, type Snapshot } from '../src/server/backup.js';
import type { ActivityCommand, ActivityEntry, ActivityLedger, ActivityReceipt } from '../src/shared/activity-contracts.js';
import type { CareCommand } from '../src/shared/contracts.js';
import type { Session } from '../src/server/session.js';

const evidencePath = '.local/probes/activity-ledger-live.json';
const fixedInstant = '2026-10-05T15:00:00.000Z';
const fixedClock = () => new Date(fixedInstant);
const startedAt = new Date().toISOString();
const started = performance.now();
const checks: Record<string, boolean> = {};
const sourceCounts: Record<string, number> = {};
const targetCounts: Record<string, number> = {};
const privateDetails: Record<string, unknown> = {};
let stage = 'configuration';
let serverVersion = 'unknown';
let sourceName = 'not-created';
let targetName = 'not-created';
let snapshot: Snapshot | undefined;
let activityDigest = '';
let activityReceiptDigest = '';

function assertCheck(name: string, condition: unknown, detail = 'Probe assertion failed.') {
  checks[name] = Boolean(condition);
  if (!condition) throw new Error(`${name}: ${detail}`);
}

function errorCode(error: unknown) {
  return typeof error === 'object' && error && 'code' in error ? String(error.code) : 'unknown';
}

async function expectRejected(name: string, work: Promise<unknown>, expectedCode: string) {
  try {
    await work;
    assertCheck(name, false, `Expected ${expectedCode}.`);
  } catch (error) {
    assertCheck(name, errorCode(error) === expectedCode, `Expected ${expectedCode}, received ${errorCode(error)}.`);
  }
}

function databaseName(prefix: string, suffix: string) {
  const name = `${prefix}_${suffix}`;
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(name)) throw new Error('Generated database name is invalid.');
  return name;
}

function databaseUrl(base: URL, name: string) {
  const value = new URL(base);
  value.pathname = `/${name}`;
  value.search = '';
  value.hash = '';
  return value;
}

function findOption(ledger: ActivityLedger, kind: ActivityEntry['kind'], title: string) {
  const matches = ledger.options.filter(item => item.kind === kind && item.title === title);
  assertCheck(`one_${kind}_${title.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_option`, matches.length === 1);
  return matches[0];
}

function rowsDigest(rows: unknown[]) {
  return createHash('sha256').update(JSON.stringify(rows, (_key, value) => value instanceof Date ? value.toISOString() : value)).digest('hex');
}

process.loadEnvFile('.local/runtime/local-care.env');
const configured = process.env.DATABASE_URL;
if (!configured) throw new Error('Local PostgreSQL is not configured.');
const base = new URL(configured);
if (!['127.0.0.1', 'localhost', '::1'].includes(base.hostname) || base.port !== '55432') {
  throw new Error('The S02 probe only uses configured loopback PostgreSQL on port 55432.');
}
const suffix = `${Date.now().toString(36)}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
sourceName = databaseName('nancy_s02_source', suffix);
targetName = databaseName('nancy_s02_restore', suffix);
const adminUrl = databaseUrl(base, 'postgres');
const sourceUrl = databaseUrl(base, sourceName);
const targetUrl = databaseUrl(base, targetName);
const migrations = await Promise.all(['db/002_local_care.sql', 'db/003_activity_ledger.sql','db/004_client_readiness.sql','db/005_runtime_observability.sql'].map(path => readFile(path, 'utf8')));
const migrationDigest = createHash('sha256').update(migrations.join('\n')).digest('hex');
const admin = new Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5_000 });

async function createEmptyDatabase(name: string) {
  const exists = await admin.query('select 1 from pg_database where datname=$1', [name]);
  if (exists.rowCount) throw new Error('Generated disposable database unexpectedly exists.');
  await admin.query(`create database "${name}"`);
}

async function migrate(url: URL) {
  const pool = new Pool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 5_000 });
  try {
    for (const sql of migrations) await pool.query(sql);
  } finally {
    await pool.end();
  }
}

let sourceCare: LocalCare | undefined;
let sourcePool: Pool | undefined;
let sourceSession: Session | undefined;
let sourceOwnerEmail = '';
let sourceOwnerPassword = '';
let restoredCare: LocalCare | undefined;

try {
  stage = 'database_creation';
  await admin.connect();
  serverVersion = String((await admin.query('show server_version')).rows[0].server_version);
  await createEmptyDatabase(sourceName);
  await createEmptyDatabase(targetName);
  assertCheck('unique_disposable_databases_created', sourceName !== targetName);
  await admin.end();

  stage = 'migration';
  await migrate(sourceUrl);
  await migrate(targetUrl);
  assertCheck('source_and_empty_target_migrated', true);

  stage = 'synthetic_care_workflow';
  sourcePool = new Pool({ connectionString: sourceUrl.toString(), max: 2, connectionTimeoutMillis: 5_000 });
  sourceCare = new LocalCare({ pool: sourcePool, clock: fixedClock });
  const ownerMarker = randomUUID();
  const otherMarker = randomUUID();
  sourceOwnerEmail = `s02-owner-${ownerMarker}@example.invalid`;
  sourceOwnerPassword = `s02-${randomBytes(24).toString('base64url')}`;
  const otherEmail = `s02-other-${otherMarker}@example.invalid`;
  const otherPassword = `s02-${randomBytes(24).toString('base64url')}`;
  const owner = await bootstrapLocalUser(sourcePool, {
    email: sourceOwnerEmail, password: sourceOwnerPassword, role: 'client', display_name: 'Disposable S02 owner',
    time_zone: 'America/Toronto', preferences: 'Synthetic S02 activity probe only.',
  });
  const other = await bootstrapLocalUser(sourcePool, {
    email: otherEmail, password: otherPassword, role: 'client', display_name: 'Disposable S02 other user',
    time_zone: 'America/Toronto', preferences: 'Synthetic S02 cross-user probe only.',
  });
  sourceSession = await sourceCare.login(sourceOwnerEmail, sourceOwnerPassword);
  const otherSession = await sourceCare.login(otherEmail, otherPassword);
  assertCheck('two_synthetic_users_authenticated', sourceSession.user_id === owner.user_id && otherSession.user_id === other.user_id);

  const initial = await sourceCare.today(sourceSession);
  assertCheck('fixed_toronto_local_day', initial.local_date === '2026-10-05');
  const setup = await sourceCare.setup(sourceSession, {
    display_name: 'Disposable S02 owner', time_zone: 'America/Toronto', preferences: 'Synthetic S02 activity probe only.',
    expected_revision: initial.profile!.revision,
    tasks: [
      { title: 'Synthetic completed walk', time_hint: 'morning', urgency: 'medium', scheduled_time: '09:15', category: 'exercise', duration_minutes: 15 },
      { title: 'Synthetic deferred call', time_hint: 'afternoon', urgency: 'low', scheduled_time: '14:00', category: 'task', duration_minutes: 10 },
      { title: 'Synthetic rescheduled laundry', time_hint: 'afternoon', urgency: 'medium', scheduled_time: '12:00', category: 'task', duration_minutes: 20 },
    ],
    meal_options: [
      { name: 'Synthetic oatmeal', slots: ['breakfast'] },
      { name: 'Synthetic soup', slots: ['lunch'] },
      { name: 'Synthetic pasta', slots: ['dinner'] },
    ],
  });
  const startCommand: CareCommand = {
    type: 'start_or_resume_checkin', idempotency_key: randomUUID(), local_date: initial.local_date, expected_revision: 0, payload: {},
  };
  const startedCheckin = await sourceCare.command(sourceSession, startCommand);
  const proposal = await sourceCare.command(sourceSession, {
    type: 'propose_day_plan', idempotency_key: randomUUID(), local_date: initial.local_date, expected_revision: startedCheckin.revision,
    payload: {
      task_ids: setup.tasks.map(task => task.id),
      meals: [
        { slot: 'breakfast', option_id: setup.meal_options.find(item => item.slots.includes('breakfast'))!.id },
        { slot: 'lunch', option_id: setup.meal_options.find(item => item.slots.includes('lunch'))!.id },
        { slot: 'dinner', option_id: setup.meal_options.find(item => item.slots.includes('dinner'))!.id },
      ],
    },
  });
  const accepted = await sourceCare.command(sourceSession, {
    type: 'accept_day_plan', idempotency_key: randomUUID(), local_date: initial.local_date, expected_revision: proposal.revision,
    payload: { proposal_id: proposal.plan!.id },
  });
  assertCheck('day_plan_accepted_without_actuals', accepted.result === 'accepted' && (await sourceCare.ledger(sourceSession)).entries.length === 0);
  const acceptedPlanBefore = (await sourcePool.query(
    'select plan from companion_local.accepted_day_plan_versions where participant_id=$1 order by version', [owner.participant_id],
  )).rows;
  assertCheck('accepted_plan_history_present', acceptedPlanBefore.length === 1);

  await sourceCare.setAppointment(sourceSession, {
    title: 'Synthetic attended appointment', starts_at: '2026-10-05T14:30:00.000Z', idempotency_key: randomUUID(),
  });
  const planned = await sourceCare.ledger(sourceSession);
  const completedTask = findOption(planned, 'task', 'Synthetic completed walk');
  const deferredTask = findOption(planned, 'task', 'Synthetic deferred call');
  const rescheduledTask = findOption(planned, 'task', 'Synthetic rescheduled laundry');
  const breakfast = findOption(planned, 'meal', 'Synthetic oatmeal');
  const appointment = findOption(planned, 'appointment', 'Synthetic attended appointment');

  const taskReceipt = await sourceCare.activityCommand(sourceSession, {
    type: 'record_activity', idempotency_key: randomUUID(), local_date: initial.local_date, expected_revision: completedTask.revision,
    payload: { activity_id: completedTask.id, status: 'completed', occurred_at: '2026-10-05T13:30:00.000Z', notes: 'Synthetic task completion' },
  });
  const mealCommand: ActivityCommand = {
    type: 'record_activity', idempotency_key: randomUUID(), local_date: initial.local_date, expected_revision: breakfast.revision,
    payload: { activity_id: breakfast.id, status: 'completed', occurred_at: '2026-10-05T13:00:00.000Z', notes: 'Synthetic meal report', portion: 'one bowl' },
  };
  const mealReceipt = await sourceCare.activityCommand(sourceSession, mealCommand);
  const mealReplay = await sourceCare.activityCommand(sourceSession, mealCommand);
  assertCheck('same_key_same_payload_replayed_once', mealReplay.replayed && mealReplay.entry.id === mealReceipt.entry.id && mealReplay.entry.revision === mealReceipt.entry.revision);
  await expectRejected('same_key_changed_payload_rejected', sourceCare.activityCommand(sourceSession, {
    ...mealCommand, payload: { ...mealCommand.payload, notes: 'Changed under an existing key' },
  }), 'conflict');

  const appointmentReceipt = await sourceCare.activityCommand(sourceSession, {
    type: 'record_activity', idempotency_key: randomUUID(), local_date: initial.local_date, expected_revision: appointment.revision,
    payload: { activity_id: appointment.id, status: 'completed', occurred_at: '2026-10-05T14:45:00.000Z', notes: 'Synthetic appointment attendance' },
  });
  const deferredReceipt = await sourceCare.activityCommand(sourceSession, {
    type: 'record_activity', idempotency_key: randomUUID(), local_date: initial.local_date, expected_revision: deferredTask.revision,
    payload: { activity_id: deferredTask.id, status: 'deferred', occurred_at: null, notes: 'Synthetic explicit deferral' },
  });
  const rescheduleReceipt = await sourceCare.activityCommand(sourceSession, {
    type: 'reschedule_activity', idempotency_key: randomUUID(), local_date: initial.local_date, expected_revision: rescheduledTask.revision,
    payload: { activity_id: rescheduledTask.id, scheduled_at: '2026-10-05T17:00:00.000Z', reason: 'Synthetic explicit reschedule' },
  });
  const mistaken = await sourceCare.activityCommand(sourceSession, {
    type: 'record_activity', idempotency_key: randomUUID(), local_date: initial.local_date, expected_revision: 0,
    payload: { unplanned: { kind: 'task', title: 'Synthetic mistaken report' }, status: 'completed', occurred_at: '2026-10-05T14:20:00.000Z', notes: 'Synthetic correction precursor' },
  });
  const correctionReceipt = await sourceCare.activityCommand(sourceSession, {
    type: 'correct_activity', idempotency_key: randomUUID(), local_date: initial.local_date, expected_revision: mistaken.entry.revision,
    payload: { activity_id: mistaken.entry.id, status: 'voided', occurred_at: null, notes: 'Voided synthetic mistake', reason: 'Wrong activity was selected' },
  });
  assertCheck('task_meal_appointment_completion_saved', [taskReceipt, mealReceipt, appointmentReceipt].every(receipt => receipt.entry.status === 'completed'));
  assertCheck('deferral_reschedule_correction_saved', deferredReceipt.entry.status === 'deferred'
    && rescheduleReceipt.entry.scheduled_at === '2026-10-05T17:00:00.000Z'
    && correctionReceipt.entry.status === 'voided');

  await expectRejected('cross_user_exact_target_rejected', sourceCare.activityCommand(otherSession, {
    type: 'record_activity', idempotency_key: randomUUID(), local_date: initial.local_date, expected_revision: completedTask.revision,
    payload: { activity_id: completedTask.id, status: 'completed', occurred_at: '2026-10-05T13:30:00.000Z', notes: 'Cross-user attempt' },
  }), 'unknown_activity');
  await expectRejected('stale_activity_revision_rejected', sourceCare.activityCommand(sourceSession, {
    type: 'correct_activity', idempotency_key: randomUUID(), local_date: initial.local_date, expected_revision: 0,
    payload: { activity_id: completedTask.id, status: 'completed', occurred_at: taskReceipt.entry.occurred_at, notes: 'Stale update', reason: 'Synthetic stale client' },
  }), 'conflict');
  await expectRejected('invalid_session_rejected', sourceCare.ledger({ ...sourceSession, access_token: 'invalid-synthetic-token' }), 'unauthorized');

  const factual = await sourceCare.ledger(sourceSession);
  assertCheck('factual_summary_matches_committed_records', factual.summary.tasks_completed === 1 && factual.summary.meals_eaten === 1
    && factual.summary.appointments_attended === 1 && factual.summary.deferred === 1);
  assertCheck('voided_correction_is_current_projection', factual.entries.some(entry => entry.id === mistaken.entry.id && entry.status === 'voided' && entry.revision === 2));
  const todayAfter = await sourceCare.today(sourceSession);
  assertCheck('today_projects_committed_activity', Boolean(todayAfter.activity_ledger)
    && todayAfter.activity_reports?.some(report => report.meal_slot === 'breakfast' && report.status === 'completed'));
  const acceptedPlanAfter = (await sourcePool.query(
    'select plan from companion_local.accepted_day_plan_versions where participant_id=$1 order by version', [owner.participant_id],
  )).rows;
  assertCheck('activity_did_not_mutate_accepted_plan_history', JSON.stringify(acceptedPlanAfter) === JSON.stringify(acceptedPlanBefore));

  stage = 'immutable_audit';
  const effectiveActivityKeys = [
    taskReceipt.command_id, mealReceipt.command_id, appointmentReceipt.command_id, deferredReceipt.command_id,
    rescheduleReceipt.command_id, mistaken.command_id, correctionReceipt.command_id,
  ];
  const auditBefore = (await sourcePool.query(
    `select id,command_id,event_type,local_date::text,data from companion_local.domain_events
      where command_id=any($1::uuid[]) order by command_id`, [effectiveActivityKeys],
  )).rows;
  assertCheck('one_immutable_event_per_effective_activity_command', auditBefore.length === effectiveActivityKeys.length);
  assertCheck('generic_activity_events_retain_kind_and_before_after', auditBefore.every(row =>
    ['ActivityReported', 'ActivityCorrected', 'ActivityRescheduled'].includes(row.event_type)
    && row.data?.activity_id && row.data?.kind && row.data?.after));
  const auditDigestBefore = rowsDigest(auditBefore);
  await expectRejected('domain_event_update_blocked', sourcePool.query(
    'update companion_local.domain_events set data=$2 where id=$1', [auditBefore[0].id, JSON.stringify({ overwritten: true })],
  ), '42501');
  const auditAfter = (await sourcePool.query(
    `select id,command_id,event_type,local_date::text,data from companion_local.domain_events
      where command_id=any($1::uuid[]) order by command_id`, [effectiveActivityKeys],
  )).rows;
  assertCheck('activity_audit_unchanged_after_blocked_mutation', rowsDigest(auditAfter) === auditDigestBefore);
  const receiptRows = (await sourcePool.query(
    `select command_id,event_type,result from companion_local.append_only_mutations
      where command_id=any($1::uuid[]) order by command_id`, [effectiveActivityKeys],
  )).rows;
  assertCheck('one_receipt_per_effective_activity_command', receiptRows.length === effectiveActivityKeys.length);
  activityReceiptDigest = rowsDigest(receiptRows);
  const activityRows = (await sourcePool.query(`select id,participant_id,local_date::text,kind,title,source_id,meal_slot,plan_id,unplanned,
    scheduled_at,status,occurred_at,notes,portion,revision,last_action,recorded_at,updated_at
    from companion_local.activity_records where participant_id=$1 order by id`, [owner.participant_id])).rows;
  activityDigest = rowsDigest(activityRows);

  privateDetails.source = {
    owner_id: owner.user_id,
    participant_id: owner.participant_id,
    other_user_id: other.user_id,
    local_date: initial.local_date,
    accepted_plan_id: accepted.plan!.id,
    activity_ids: {
      completed_task: taskReceipt.entry.id, completed_meal: mealReceipt.entry.id, completed_appointment: appointmentReceipt.entry.id,
      deferred_task: deferredReceipt.entry.id, rescheduled_task: rescheduleReceipt.entry.id, corrected_unplanned: correctionReceipt.entry.id,
    },
    activity_command_ids: effectiveActivityKeys,
    activity_events: auditBefore,
    activity_receipts: receiptRows,
    activity_records: activityRows,
    activity_record_digest: activityDigest,
    activity_receipt_digest: activityReceiptDigest,
    activity_event_digest: auditDigestBefore,
  };

  stage = 'adapter_reconnect';
  await sourcePool.end();
  sourcePool = undefined;
  sourceCare = new LocalCare({ connectionString: sourceUrl.toString(), poolConfig: { max: 2, connectionTimeoutMillis: 5_000 }, clock: fixedClock });
  const reconnectLedger = await sourceCare.ledger(sourceSession);
  const reconnectReceipt = await sourceCare.activityReceipt(sourceSession, mealCommand.idempotency_key);
  const reconnectToday = await sourceCare.today(sourceSession);
  assertCheck('fresh_adapter_reads_same_activity_ledger', reconnectLedger.summary.meals_eaten === factual.summary.meals_eaten
    && reconnectLedger.entries.length === factual.entries.length);
  assertCheck('fresh_adapter_reads_exact_activity_receipt', reconnectReceipt?.entry.id === mealReceipt.entry.id && reconnectReceipt.command_id === mealCommand.idempotency_key);
  assertCheck('fresh_adapter_reads_accepted_plan', reconnectToday.checkin?.accepted?.id === accepted.plan!.id);

  stage = 'encrypted_backup';
  const exportClient = new Client({ connectionString: sourceUrl.toString(), connectionTimeoutMillis: 5_000 });
  await exportClient.connect();
  try {
    const exported = await exportSnapshot(exportClient, databaseIdentity(sourceUrl.toString()), 'companion_local');
    const key = randomBytes(32);
    const encrypted = encryptSnapshot(exported, key);
    snapshot = decryptSnapshot(encrypted, key);
    assertCheck('encrypted_backup_round_trip', snapshot.schema === 'companion_local' && snapshot.format === 2
      && snapshot.schema_hash === schemaHash('companion_local'));
    assertCheck('backup_excludes_live_sessions', !Object.hasOwn(snapshot.tables, 'sessions'));
    assertCheck('backup_contains_no_plaintext_password', !JSON.stringify(snapshot).includes(sourceOwnerPassword)
      && !encrypted.includes(Buffer.from(sourceOwnerPassword)));
    assertCheck('backup_contains_activity_records_events_receipts', snapshot.tables.activity_records.length === factual.entries.length
      && snapshot.tables.domain_events.filter(row => effectiveActivityKeys.includes(String(row.command_id))).length === effectiveActivityKeys.length
      && snapshot.tables.append_only_mutations.filter(row => effectiveActivityKeys.includes(String(row.command_id))).length === effectiveActivityKeys.length);
    for (const [table, rows] of Object.entries(snapshot.tables)) sourceCounts[table] = rows.length;
    privateDetails.backup = {
      format: snapshot.format, schema: snapshot.schema, scope: snapshot.scope, schema_hash: snapshot.schema_hash,
      encrypted_bytes: encrypted.length, key_persisted: false, live_sessions_included: false,
    };
  } finally {
    await exportClient.end();
  }

  stage = 'isolated_restore';
  const targetClient = new Client({ connectionString: targetUrl.toString(), connectionTimeoutMillis: 5_000 });
  await targetClient.connect();
  try {
    const preRestore = await targetClient.query(`select
      (select count(*)::int from companion_local.accounts) accounts,
      (select count(*)::int from companion_local.activity_records) activities,
      (select count(*)::int from companion_local.domain_events) events,
      (select count(*)::int from companion_local.append_only_mutations) mutation_receipts`);
    assertCheck('restore_target_was_empty', Object.values(preRestore.rows[0]).every(value => value === 0));
    await restoreSnapshot(targetClient, snapshot!, databaseIdentity(targetUrl.toString()));
    for (const table of ['accounts', 'participant_profiles', 'daily_checkins', 'accepted_day_plan_versions', 'domain_events', 'append_only_mutations', 'activity_records']) {
      targetCounts[table] = Number((await targetClient.query(`select count(*)::int as count from companion_local.${table}`)).rows[0].count);
    }
    const restoredReceiptRows = (await targetClient.query(
      'select command_id,event_type,result from companion_local.append_only_mutations where command_id=any($1::uuid[]) order by command_id', [effectiveActivityKeys],
    )).rows;
    const restoredEventDigest = rowsDigest((await targetClient.query(
      `select id,command_id,event_type,local_date::text,data from companion_local.domain_events
        where command_id=any($1::uuid[]) order by command_id`, [effectiveActivityKeys],
    )).rows);
    const restoredActivityDigest = rowsDigest((await targetClient.query(`select id,participant_id,local_date::text,kind,title,source_id,meal_slot,plan_id,unplanned,
      scheduled_at,status,occurred_at,notes,portion,revision,last_action,recorded_at,updated_at
      from companion_local.activity_records where participant_id=$1 order by id`, [owner.participant_id])).rows);
    assertCheck('restore_preserved_activity_records', targetCounts.activity_records === sourceCounts.activity_records && restoredActivityDigest === activityDigest);
    assertCheck('restore_preserved_activity_receipts', restoredReceiptRows.length === effectiveActivityKeys.length && rowsDigest(restoredReceiptRows) === activityReceiptDigest);
    assertCheck('restore_preserved_activity_events_exactly', restoredEventDigest === auditDigestBefore);
    assertCheck('restore_created_no_sessions', Number((await targetClient.query('select count(*)::int as count from companion_local.sessions')).rows[0].count) === 0);
  } finally {
    await targetClient.end();
  }

  restoredCare = new LocalCare({ connectionString: targetUrl.toString(), poolConfig: { max: 2, connectionTimeoutMillis: 5_000 }, clock: fixedClock });
  const restoredSession = await restoredCare.login(sourceOwnerEmail, sourceOwnerPassword);
  const restoredLedger = await restoredCare.ledger(restoredSession);
  const restoredReceipt = await restoredCare.activityReceipt(restoredSession, mealCommand.idempotency_key);
  assertCheck('restored_auth_and_ledger_readback', restoredLedger.summary.meals_eaten === 1
    && restoredLedger.summary.tasks_completed === 1 && restoredLedger.summary.appointments_attended === 1 && restoredLedger.summary.deferred === 1);
  assertCheck('restored_exact_receipt_readback', restoredReceipt?.entry.id === mealReceipt.entry.id && restoredReceipt.command_id === mealCommand.idempotency_key);
  privateDetails.restore = {
    authenticated_user_id: restoredSession.user_id,
    ledger_summary: restoredLedger.summary,
    receipt_command_id: restoredReceipt?.command_id,
    activity_record_digest: activityDigest,
    activity_receipt_digest: activityReceiptDigest,
    event_digest: auditDigestBefore,
  };

  stage = 'evidence';
  assertCheck('all_prior_checks_passed', Object.values(checks).every(Boolean));
  const evidence = {
    probe_id: 'S02-LIVE2-LOCAL-POSTGRESQL-ACTIVITY-LEDGER',
    status: 'passed',
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    elapsed_ms: Math.round(performance.now() - started),
    data_policy: 'disposable_live',
    data_origin: 'Unique synthetic users and synthetic care/activity records only; no participant records.',
    database: {
      transport: 'configured loopback PostgreSQL on port 55432', server_version: serverVersion,
      source_database: sourceName, restore_database: targetName, databases_preserved_for_review: true,
      migration_sha256: migrationDigest, backup_schema_sha256: snapshot!.schema_hash,
    },
    clock: { injected_instant: fixedInstant, participant_time_zone: 'America/Toronto', local_date: '2026-10-05' },
    checks,
    source_table_counts: sourceCounts,
    restored_table_counts: targetCounts,
    private_details: privateDetails,
    limitations: [
      'This is a real local PostgreSQL service probe with disposable synthetic data, not participant acceptance.',
      'It does not test microphone input, audible speech, mobile UI usability or a genuine tracked day.',
      'Both uniquely named databases are intentionally preserved for evidence review and must not be treated as production data.',
    ],
  };
  await mkdir('.local/probes', { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    status: 'passed', server_version: serverVersion,
    checks_passed: Object.values(checks).filter(Boolean).length, checks_total: Object.keys(checks).length,
    counts: {
      source_activity_records: sourceCounts.activity_records,
      restored_activity_records: targetCounts.activity_records,
      source_activity_events: effectiveActivityKeys.length,
      restored_activity_events: effectiveActivityKeys.length,
      source_activity_receipts: effectiveActivityKeys.length,
      restored_activity_receipts: effectiveActivityKeys.length,
    },
  })}\n`);
} catch (error) {
  const failure = {
    probe_id: 'S02-LIVE2-LOCAL-POSTGRESQL-ACTIVITY-LEDGER',
    status: 'failed',
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    elapsed_ms: Math.round(performance.now() - started),
    failed_stage: stage,
    safe_error: { name: error instanceof Error ? error.name : 'Error', code: errorCode(error) },
    data_policy: 'disposable_live',
    synthetic_records_only: true,
    database: {
      transport: 'configured loopback PostgreSQL on port 55432', server_version: serverVersion,
      source_database: sourceName, restore_database: targetName, databases_preserved_for_review: true,
      migration_sha256: migrationDigest,
    },
    checks,
    source_table_counts: sourceCounts,
    restored_table_counts: targetCounts,
    private_details: privateDetails,
  };
  await mkdir('.local/probes', { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(failure, null, 2)}\n`, { mode: 0o600 });
  process.stderr.write('S02 local PostgreSQL activity probe failed; see the private sanitized evidence file.\n');
  process.exitCode = 1;
} finally {
  await sourceCare?.close().catch(() => {});
  await restoredCare?.close().catch(() => {});
  await sourcePool?.end().catch(() => {});
  await admin.end().catch(() => {});
}
