import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { Pool, Client } from 'pg';
import { createApp } from '../src/server/app.js';
import { configFromEnv } from '../src/server/config.js';
import { LocalCare, bootstrapLocalUser } from '../src/server/local-care.js';
import { ConversationService } from '../src/server/conversation.js';
import { createLocalFeatures } from '../src/server/local-features.js';
import { LocalDayService } from '../src/server/local-day.js';
import { localCareMigrations } from '../src/server/local-migrations.js';
import { SessionRevocations } from '../src/server/revocations.js';
import { openSession, type Session } from '../src/server/session.js';
import type { LocalSpeech } from '../src/server/local-speech.js';
import type { Reasoner } from '../src/server/plan-reasoner.js';
import type { ActivityCommand } from '../src/shared/activity-contracts.js';
import { dateInZone } from '../src/shared/contracts.js';
import { databaseIdentity, decryptSnapshot, encryptSnapshot, exportSnapshot, restoreSnapshot } from '../src/server/backup.js';

// Engineering verification only: actual disposable PostgreSQL and HTTP, synthetic reasoning/speech.
// Only the saved loopback connection is read; no query ever targets a configured care database.
process.loadEnvFile('.local/runtime/local-care.env');
const base = new URL(process.env.DATABASE_URL || '');
if (!['127.0.0.1', 'localhost'].includes(base.hostname) || base.port !== '55432') throw new Error('Loopback PostgreSQL is required.');
base.pathname = '/postgres';
const admin = new Client({ connectionString: base.toString(), connectionTimeoutMillis: 5000 });
const created: string[] = [], pools: Pool[] = [], checks: Record<string, boolean> = {}, counts: Record<string, number> = {};
const migrationSnapshot = await Promise.all(localCareMigrations.map(async name => ({ name, sql: await readFile('db/' + name, 'utf8') })));
const started = Date.now(), sessionKey = randomBytes(32), evidenceFile = '.local/probes/final-audit-http.json';
let phase = 'initialize', status = 'failed', app: Awaited<ReturnType<typeof createApp>> | undefined;
let now = new Date(), ownerId = '', responseDrops = 0, modelCalls = 0, restartCount = 0;
const clock = () => phase === 'browser_window' ? new Date() : now;
function check(name: string, condition: unknown): asserts condition { checks[name] = !!condition; assert.ok(condition, name); }
function disposableName() { return 'nancy_final_audit_' + randomUUID().replaceAll('-', ''); }
function quoted(name: string) { if (!/^nancy_final_audit_[a-f0-9]{32}$/.test(name) || !created.includes(name)) throw new Error('Unowned database rejected.'); return '"' + name + '"'; }
async function database(through?: string) {
  const name = disposableName();
  assert.match(name, /^nancy_final_audit_[a-f0-9]{32}$/);
  assert.equal((await admin.query('select 1 from pg_database where datname=$1', [name])).rows.length, 0);
  await admin.query('create database "' + name + '"'); created.push(name);
  const url = new URL(base); url.pathname = '/' + name;
  const pool = new Pool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 5000, query_timeout: 20000 }); pools.push(pool);
  for (const file of migrationSnapshot) if (!through || file.name <= through) await pool.query(file.sql);
  return { pool, url: url.toString(), name };
}
async function freePort() {
  const listener = createServer(); await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const address = listener.address(); assert.ok(address && typeof address !== 'string');
  await new Promise<void>(resolve => listener.close(() => resolve())); return address.port;
}
let origin = '', pool: Pool, care!: LocalCare;
let dropNextSuccess = false;
let modelResponse: Awaited<ReturnType<Reasoner['respond']>> | undefined;
const reasoner: Reasoner = {
  bind: async scope => ({ ...scope, route_id: 'synthetic_http_probe', account_binding_id: 'synthetic-local-fixture', qualification: 'owner_practice' }),
  respond: async () => { modelCalls++; assert.ok(modelResponse, 'Unexpected reasoning request'); const result = modelResponse; modelResponse = undefined; return result; },
};
async function startServer(databaseUrl: string) {
  care = new LocalCare({ pool, clock });
  const features = createLocalFeatures(pool); features.day = new LocalDayService(pool, clock);
  const conversation = new ConversationService(care, reasoner, ownerId, clock);
  const config = configFromEnv({ PUBLIC_ORIGIN: origin, DATABASE_URL: databaseUrl, SESSION_KEY: sessionKey.toString('base64'), NANCY_PLAN_USER_ID: ownerId, NANCY_SYNTHETIC: '1' });
  const speech = { readiness: () => ({ asr: 'ready', kokoro: 'ready' }), close: async () => {},
    synthesize: async () => { throw new Error('Speech is separately qualified.'); } } as unknown as LocalSpeech;
  app = await createApp(config, { care, features, conversation, speech, microsoft:null, revocations: new SessionRevocations() });
  app.addHook('onSend', async (request, reply, payload) => {
    if (dropNextSuccess && request.url.endsWith('/turn') && reply.statusCode === 200
      && typeof payload === 'string' && JSON.parse(payload).acknowledgement_required) {
      dropNextSuccess = false; responseDrops++; reply.raw.destroy();
    }
    return payload;
  });
  await app.listen({ host: '127.0.0.1', port: Number(new URL(origin).port) });
  return { features, conversation };
}
async function http(path: string, cookie = '', body?: unknown, expected = 200, suppliedOrigin = origin) {
  const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { origin: suppliedOrigin, 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  check('http_status_' + (++counts.http_requests), response.status === expected);
  return { body: await response.json() as any, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
}
async function login(email: string, password: string) { return (await http('/api/auth/login', '', { email, password })).cookie; }
function session(cookie: string): Session { const value = openSession(cookie.slice(cookie.indexOf('=') + 1), sessionKey); assert.ok(value); return value; }
async function turn(id: string, cookie: string, text: string) { return (await http(`/api/conversation/${id}/turn`, cookie, { turn_id: randomUUID(), text })).body; }

try {
  await mkdir('.local/probes', { recursive: true });
  await admin.connect(); counts.http_requests = 0;
  const source = await database(); pool = source.pool;
  const email = 'synthetic-recovery@example.invalid', password = randomBytes(24).toString('base64url');
  ownerId = (await bootstrapLocalUser(pool, { email, password, role: 'client', display_name: 'Synthetic audit participant', time_zone: 'America/Toronto' })).user_id;
  origin = 'http://127.0.0.1:' + await freePort(); await startServer(source.url);
  let cookie = await login(email, password), actorSession = session(cookie);
  await http('/api/today', '', undefined, 401);
  await http('/api/conversation', cookie, {}, 403, 'https://different.invalid');
  const localDate = dateInZone(now, 'America/Toronto'), occurred = new Date(now.getTime() - 30 * 60000).toISOString();
  const command: ActivityCommand = { type: 'record_activity', idempotency_key: randomUUID(), local_date: localDate, expected_revision: 0,
    payload: { unplanned: { kind: 'meal', title: 'Synthetic toast', meal_slot: 'breakfast' }, status: 'completed', occurred_at: occurred, notes: '', portion: null } };
  const { type: _type, idempotency_key: _key, ...args } = command;
  modelResponse = { completed: true, model: 'gpt-6-sol', effort: 'high', text: '', output: [{ type: 'function_call', name: 'prepare_activity_record', call_id: randomUUID(), arguments: JSON.stringify(args) }] };

  phase = 'FIN01_dropped_success_and_restart';
  const opening = (await http('/api/conversation', cookie, {})).body;
  const review = await turn(opening.session_id, cookie, 'I ate the synthetic toast.');
  await http(`/api/conversation/${opening.session_id}/played`, cookie, { reply_id: review.reply_id });
  dropNextSuccess = true; let disconnected = false;
  try { await turn(opening.session_id, cookie, 'save this change'); } catch { disconnected = true; }
  check('fin01_actual_http_response_dropped', disconnected && responseDrops === 1);
  const held = await care.pendingActivityCommand(actorSession); check('fin01_pending_survives_dropped_success', held);
  const originalReceipt = await care.activityReceipt(actorSession, held.command.idempotency_key); check('fin01_original_receipt_committed', originalReceipt);
  check('fin01_single_activity_before_restart', (await care.ledger(actorSession)).entries.length === 1);
  await app!.close(); app = undefined; restartCount++; await startServer(source.url);
  cookie = await login(email, password); actorSession = session(cookie);
  const reopened = (await http('/api/conversation', cookie, {})).body;
  const recovered = await turn(reopened.session_id, cookie, 'I ate the synthetic toast.');
  check('fin01_reconciles_original_receipt_after_service_restart_and_relogin', recovered.acknowledgement_required && recovered.text.includes('was saved'));
  check('fin01_no_second_model_call', modelCalls === 1);
  check('fin01_same_pending_command_after_relogin', (await care.pendingActivityCommand(actorSession))?.command.idempotency_key === held.command.idempotency_key);
  await http(`/api/conversation/${reopened.session_id}/received`, '', { reply_id: recovered.reply_id }, 401);
  await http(`/api/conversation/${reopened.session_id}/received`, cookie, { reply_id: recovered.reply_id, command_id: randomUUID() }, 400);
  await http(`/api/conversation/${reopened.session_id}/received`, cookie, { reply_id: recovered.reply_id });
  await http(`/api/conversation/${reopened.session_id}/received`, cookie, { reply_id: recovered.reply_id });
  check('fin01_acknowledgement_clears_pending_once', await care.pendingActivityCommand(actorSession) === null);
  check('fin01_single_activity_after_reconciliation', (await care.ledger(actorSession)).entries.length === 1);
  check('fin01_single_original_receipt', (await pool.query('select 1 from companion_local.append_only_mutations where participant_id=$1 and command_id=$2', [ownerId, held.command.idempotency_key])).rows.length === 1);

  phase = 'FIN03_obsolete_grant_navigation';
  await care.holdActivityCommand(actorSession, command);
  await pool.query("update companion_local.role_grants set granted_at=granted_at+interval '1 second' where actor_id=$1", [ownerId]);
  const fresh = (await http('/api/conversation', cookie, {})).body;
  const navigation = await turn(fresh.session_id, cookie, 'Show my meals');
  check('fin03_meals_navigation_after_obsolete_intent', navigation.navigate === 'meals');
  check('fin03_obsolete_unsaved_intent_removed', await care.pendingActivityCommand(actorSession) === null);
  check('fin03_obsolete_command_never_written', await care.activityReceipt(actorSession, command.idempotency_key) === null);
  check('fin03_tasks_navigation_remains_available', (await turn(fresh.session_id, cookie, 'Show my tasks')).navigate === 'tasks');
  check('fin03_no_model_inference', modelCalls === 1);

  phase = 'FIN02_effective_meal_reminders';
  // A deterministic synthetic clock exercises 09:30 and 10:30 through the running HTTP service.
  now = new Date(localDate + 'T13:30:00Z');
  const mealEmail = 'synthetic-meal@example.invalid', mealPassword = randomBytes(24).toString('base64url');
  const mealActor = await bootstrapLocalUser(pool, { email: mealEmail, password: mealPassword, role: 'client', display_name: 'Synthetic meal participant', time_zone: 'America/Toronto' });
  const mealCookie = await login(mealEmail, mealPassword), mealSession = session(mealCookie);
  await http('/api/setup', mealCookie, { expected_revision: 0, display_name: 'Synthetic meal participant', time_zone: 'America/Toronto', preferences: '', tasks: [],
    meal_options: [{ name: 'Toast', slots: ['breakfast'] }, { name: 'Porridge', slots: ['breakfast'] }, { name: 'Soup', slots: ['lunch'] }, { name: 'Rice', slots: ['dinner'] }] });
  await http('/api/local-day/commands', mealCookie, { type: 'set_prompt_preferences', idempotency_key: randomUUID(), expected_revision: 0, confirmed: true,
    preferences: { enabled: true, meal_times: { breakfast: '09:30', lunch: null, dinner: null }, appointment_lead_minutes: 30,
      quiet_start: '21:00', quiet_end: '08:00', foreground_speech: false, browser_notifications: false } });
  await http('/api/commands', mealCookie, { type: 'start_or_resume_checkin', idempotency_key: randomUUID(), local_date: localDate, expected_revision: 0, payload: {} });
  const accept = async (breakfast = 'Toast') => {
    const today = (await http('/api/today', mealCookie)).body;
    const meals = today.meal_options.filter((m: any) => m.name !== (breakfast === 'Toast' ? 'Porridge' : 'Toast')).map((m: any) => ({ slot: m.slots[0], option_id: m.id }));
    const proposal = (await http('/api/commands', mealCookie, { type: 'propose_day_plan', idempotency_key: randomUUID(), local_date: localDate, expected_revision: today.checkin.revision, payload: { task_ids: [], meals } })).body;
    return (await http('/api/commands', mealCookie, { type: 'accept_day_plan', idempotency_key: randomUUID(), local_date: localDate, expected_revision: proposal.revision, payload: { proposal_id: proposal.plan.id } })).body;
  };
  const firstPlan = await accept();
  const breakfast = (await http('/api/activity', mealCookie)).body.options.find((x: any) => x.kind === 'meal' && x.meal_slot === 'breakfast' && x.title === 'Toast'); check('fin02_breakfast_occurrence_available', breakfast);
  await http('/api/activity/commands', mealCookie, { type: 'reschedule_activity', idempotency_key: randomUUID(), local_date: localDate, expected_revision: breakfast.revision,
    payload: { activity_id: breakfast.id, scheduled_at: localDate + 'T14:30:00Z', reason: 'Synthetic reviewed later breakfast' } });
  const secondPlan = await accept(); check('fin02_plan_reaccepted', secondPlan.plan.id !== firstPlan.plan.id);
  check('fin02_no_obsolete_0930_reminder', (await http('/api/prompts/claim', mealCookie, {})).body === null);
  now = new Date(localDate + 'T14:30:00Z');
  const moved = (await http('/api/prompts/claim', mealCookie, {})).body;
  check('fin02_reminder_uses_1030_effective_time', moved?.due_at === localDate + 'T14:30:00.000Z' && moved.message.includes('Toast'));
  const meal = (await care.ledger(mealSession)).entries.find(x => x.id === breakfast.id)!;
  await http('/api/activity/commands', mealCookie, { type: 'record_activity', idempotency_key: randomUUID(), local_date: localDate, expected_revision: meal.revision,
    payload: { activity_id: meal.id, status: 'deferred', occurred_at: null, notes: 'Synthetic client postponed breakfast' } });
  await accept();
  check('fin02_deferral_survives_reacceptance', (await http('/api/prompts/claim', mealCookie, {})).body === null);
  await http(`/api/prompts/${moved.id}/ack`, mealCookie, { claim_token: moved.claim_token, channel: 'in_app' }, 409);
  check('fin02_same_occurrence_kept', (await care.ledger(mealSession)).entries.find(x => x.id === breakfast.id)?.status === 'deferred');
  counts.synthetic_actors = 2;

  phase = 'encrypted_legacy_restore';
  for (const through of ['012_operations.sql', '013_activity_recovery.sql', '014_intake_kind.sql']) {
    phase = 'legacy_' + through.slice(0, 3) + '_create';
    const legacy = await database(through), restored = await database();
    phase = 'legacy_' + through.slice(0, 3) + '_seed';
    const identity = await bootstrapLocalUser(legacy.pool, { email: 'legacy@example.invalid', password: 'synthetic-legacy-password', role: 'client', display_name: 'Synthetic legacy participant' });
    const activityId = randomUUID(), commandId = randomUUID();
    await legacy.pool.query(`insert into companion_local.append_only_mutations(participant_id,command_id,command,result,event_type,actor_id)
      values($1,$2,$3,$4,'ActivityReported',$5)`, [identity.participant_id, commandId,
      JSON.stringify({ type: 'record_activity', idempotency_key: commandId }), JSON.stringify({ activity_id: activityId }), identity.user_id]);
    await legacy.pool.query(`insert into companion_local.activity_records(id,participant_id,local_date,kind,title,source_id,meal_slot,plan_id,unplanned,scheduled_at,status,occurred_at,notes,portion,revision,last_action,recorded_at,updated_at,last_actor_id,last_command_id)
      values($1,$2,$3,'meal','Synthetic historical toast',null,'breakfast',null,true,null,'completed',$4,'',null,1,'reported',$4,$4,$2,$5)`, [activityId, identity.participant_id, localDate, now, commandId]);
    phase = 'legacy_' + through.slice(0, 3) + '_export';
    const snapshot = await exportSnapshot(legacy.pool, databaseIdentity(legacy.url), 'companion_local', false, through), encryptionKey = randomBytes(32);
    const encrypted = encryptSnapshot(snapshot, encryptionKey), decoded = decryptSnapshot(encrypted, encryptionKey);
    check('restore_' + through.slice(0, 3) + '_encrypted_roundtrip', !encrypted.includes(Buffer.from('Synthetic historical toast')) && decoded.tables.activity_records.length === 1);
    phase = 'legacy_' + through.slice(0, 3) + '_restore';
    await restoreSnapshot(restored.pool, decoded, databaseIdentity(restored.url));
    const row = (await restored.pool.query('select id,participant_id,last_actor_id,last_command_id,intake_kind from companion_local.activity_records')).rows[0];
    check('restore_' + through.slice(0, 3) + '_history_and_unknown_intake_preserved', row.id === activityId && row.participant_id === identity.participant_id && row.last_actor_id === identity.user_id && row.last_command_id === commandId && row.intake_kind === 'unknown');
    check('restore_' + through.slice(0, 3) + '_no_sessions_or_preferences_invented', (await restored.pool.query('select (select count(*)::int from companion_local.sessions) as sessions,(select count(*)::int from companion_local.client_preferences) as preferences')).rows.every(row => row.sessions === 0 && row.preferences === 0));
  }
  status = 'passed';
  if (process.argv.includes('--keep-alive')) {
    phase = 'browser_window'; now = new Date();
    const stopFile = `.local/probes/final-audit-http-${randomUUID()}.stop`;
    await writeFile('.local/probes/final-audit-http-browser.json', JSON.stringify({ origin, email, password, stop_file: stopFile,
      synthetic_only: true, speech_stub: true, reasoner_stub: true, expires_in_minutes: 30 }), { mode: 0o600 });
    console.log(JSON.stringify({ status: 'browser_ready', origin, synthetic_only: true, speech_stub: true, checks_passed: Object.values(checks).filter(Boolean).length }));
    await new Promise<void>(resolve => {
      const finish = () => { clearInterval(timer); clearTimeout(timeout); resolve(); };
      const timer = setInterval(() => { void access(stopFile).then(finish, () => {}); }, 1000);
      const timeout = setTimeout(finish, 30 * 60000);
      process.once('SIGINT', finish); process.once('SIGTERM', finish);
    });
  }
} catch {
  console.error(JSON.stringify({ status: 'failed', phase, checks_passed: Object.values(checks).filter(Boolean).length, checks_failed: Object.keys(checks).filter(key => !checks[key]) }));
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  for (const connection of pools) await connection.end().catch(() => {});
  let cleanup = true;
  for (const name of created.reverse()) {
    try { await admin.query('drop database ' + quoted(name) + ' with (force)'); }
    catch { cleanup = false; }
  }
  await admin.end().catch(() => {});
  checks.disposable_databases_removed = cleanup;
  counts.disposable_databases = created.length; counts.http_response_drops = responseDrops; counts.app_service_restarts = restartCount; counts.synthetic_model_calls = modelCalls;
  await mkdir('.local/probes', { recursive: true });
  await writeFile(evidenceFile, JSON.stringify({ created_at: new Date().toISOString(), status, phase, actual_postgresql: true, actual_listening_http: true,
    synthetic_only: true, actual_provider_inference: false, actual_speech: false, participant_acceptance: false, checks, counts,
    migrations: migrationSnapshot.map(file => ({ name: file.name, sha256: createHash('sha256').update(file.sql).digest('hex') })), elapsed_ms: Date.now() - started }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: cleanup ? status : 'cleanup_failed', checks_passed: Object.values(checks).filter(Boolean).length,
    checks_total: Object.keys(checks).length, disposable_databases_removed: cleanup, evidence: evidenceFile }));
  if (!cleanup) process.exitCode = 1;
}
