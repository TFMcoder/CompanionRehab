/** Opt-in live owner-practice probe. All care writes go to a newly created disposable database. */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { loadEnvironment, configFromEnv } from '../src/server/config.js';
import { LocalCare, bootstrapLocalUser } from '../src/server/local-care.js';
import { localCareMigrations } from '../src/server/local-migrations.js';
import { PlanStore, defaultPlanPath } from '../src/server/chatgpt-plan/storage.js';
import { PlanReasoner } from '../src/server/plan-reasoner.js';
import { ConversationService, type ConversationTurnMetric } from '../src/server/conversation.js';
import { TaskRequestService } from '../src/server/task-requests.js';
import { createLocalFeatures } from '../src/server/local-features.js';
import { RuntimeLog } from '../src/server/telemetry.js';
import type { Session } from '../src/server/session.js';

loadEnvironment();
const config = configFromEnv();
if (!config.databaseUrl || !config.planUserId || !config.sessionKey) throw new Error('Local owner-practice configuration is required.');
const base = new URL(config.databaseUrl);
if (!['127.0.0.1','localhost','::1'].includes(base.hostname) || base.port !== '55432') throw new Error('Probe requires the configured loopback PostgreSQL.');
const name = 'nancy_meal_probe_' + randomUUID().replaceAll('-', '');
const url = (database: string) => { const result = new URL(base); result.pathname = '/' + database; return result.toString(); };
const admin = new Client({ connectionString: url('postgres') });
const evidence = { status: 'running', observed_at: new Date().toISOString(), synthetic_only: true, checks: {} as Record<string,boolean>, timings_ms: [] as number[], database_removed: false };
const check = (key: string, value: unknown) => { evidence.checks[key] = !!value; if (!value) throw new Error(key); };
let care: LocalCare | undefined, conversation: ConversationService | undefined, log: RuntimeLog | undefined, session: Session | undefined, created = false;
try {
  await admin.connect();
  await admin.query(`create database "${name}"`); created = true;
  // Fixed synthetic participant time makes the reported local meal time reproducible on every run.
  const clock = () => new Date('2026-10-13T16:35:00.000Z');
  care = new LocalCare({ connectionString: url(name), clock });
  for (const migration of localCareMigrations) await care.pool.query(await readFile('db/' + migration, 'utf8'));
  const password = randomBytes(24).toString('base64url');
  const seed = await bootstrapLocalUser(care.pool, { email:'seed@example.invalid',password,role:'client',display_name:'Synthetic Client',time_zone:'America/Toronto' });
  // The existing owner alone runs inference. Reuse that actor ID only inside this isolated fixture;
  // never change the encrypted account binding, production grants or owner-practice restrictions.
  await care.pool.query(`insert into companion_local.accounts(id,email,password_salt,password_hash)
    select $1,'probe@example.invalid',password_salt,password_hash from companion_local.accounts where id=$2`, [config.planUserId,seed.user_id]);
  await care.pool.query(`insert into companion_local.participant_profiles(id,display_name,time_zone) values($1,'Synthetic Client','America/Toronto')`, [config.planUserId]);
  await care.pool.query(`insert into companion_local.role_grants(participant_id,actor_id,role) values($1,$1,'client')`, [config.planUserId]);
  session = await care.login('probe@example.invalid', password);
  const before = await care.today(session);
  check('empty_meal_options_plan_and_ledger', !before.meal_options.length && !before.checkin && !before.activity_ledger?.entries.length);
  const reasoner = new PlanReasoner(new PlanStore(defaultPlanPath, config.sessionKey), config.planUserId);
  const metrics: ConversationTurnMetric[] = [];
  log = new RuntimeLog(care.pool);
  conversation = new ConversationService(care,reasoner,config.planUserId,clock,undefined,metric => {
    metrics.push(metric);
    const { actor_id,conversation_id,turn_id,outcome,...measurements } = metric;
    log!.record({kind:'conversation',actor_id,conversation_id,turn_id,outcome:outcome==='completed'?'ok':outcome==='failed'?'error':'interrupted',measurements});
  },undefined,new TaskRequestService(care.pool,{clock}),createLocalFeatures(care.pool));
  const started = await conversation.start(session);
  let review;
  for (const text of ['I finished my lunch.','I had tomato soup.','I finished it at 12:23 p.m. today. Please record that; I do not know the portion.']) {
    const start = performance.now();
    review = await conversation.turn(started.session_id,session,randomUUID(),text);
    evidence.timings_ms.push(Math.round(performance.now()-start));
    check('no_write_before_confirmation', !review.changed && (await care.ledger(session)).summary.meals_eaten === 0);
    conversation.played(started.session_id,session,review.reply_id);
  }
  check('model_prepared_unplanned_report', review?.text.includes('Say save this change to confirm.') && metrics.at(-1)?.activity_outcome === 'review_prepared');
  const turn = randomUUID();
  const saved = await conversation.turn(started.session_id,session,turn,'Save this change');
  check('confirmed_save_receipt',saved.changed && saved.text === 'Your activity is recorded.');
  const replay = await conversation.turn(started.session_id,session,turn,'Save this change');
  check('confirmation_retry_replayed', replay.reply_id === saved.reply_id);
  const ledger = await care.ledger(session);
  check('one_durable_meal', ledger.entries.length === 1 && ledger.summary.meals_eaten === 1);
  check('food_slot_actual_time_and_unknown_portion', ledger.entries[0].kind === 'meal' && /tomato soup/i.test(ledger.entries[0].title)
    && ledger.entries[0].meal_slot === 'lunch' && ledger.entries[0].unplanned && ledger.entries[0].occurred_at === '2026-10-13T16:23:00.000Z' && ledger.entries[0].portion === null);
  check('one_receipt_and_event', (await care.pool.query("select count(*)::int as n from companion_local.append_only_mutations where event_type='ActivityReported'")).rows[0].n === 1
    && (await care.pool.query("select count(*)::int as n from companion_local.domain_events where event_type='ActivityReported'")).rows[0].n === 1);
  const reopened = new LocalCare({connectionString:url(name),clock});
  try { check('record_survives_new_connection',(await reopened.ledger(session)).summary.meals_eaten === 1); } finally { await reopened.close(); }
  await log.flush();
  const outcomes = (await care.pool.query("select measurements->>'activity_outcome' as outcome from companion_local.runtime_events order by recorded_at")).rows.map(row => row.outcome);
  check('preparation_and_save_logged_without_transcript', outcomes.includes('review_prepared') && outcomes.includes('saved')
    && !(await care.pool.query("select 1 from companion_local.runtime_events where measurements::text ilike '%tomato%'")).rowCount);
  evidence.status = 'passed';
} catch { evidence.status = 'failed'; process.exitCode = 1; }
finally {
  conversation?.close(); await log?.close();
  if (session) await care?.logout(session).catch(()=>{});
  await care?.close();
  if (created) { await admin.query(`drop database "${name}"`); evidence.database_removed = true; }
  await admin.end();
  await mkdir('.local/probes',{recursive:true});
  await writeFile('.local/probes/meal-recording-live.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
}
