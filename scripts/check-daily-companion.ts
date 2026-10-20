/** Explicitly invoked owner-practice qualification. Every care write uses a new disposable database. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { configFromEnv, loadEnvironment } from '../src/server/config.js';
import { LocalCare, bootstrapLocalUser } from '../src/server/local-care.js';
import { localCareMigrations } from '../src/server/local-migrations.js';
import { PlanStore, defaultPlanPath } from '../src/server/chatgpt-plan/storage.js';
import { PlanReasoner, type Reasoner } from '../src/server/plan-reasoner.js';
import { inferenceUsageFromError, sumInferenceUsage, requestSolHigh, refreshCredential, type InferenceUsage } from '../src/server/chatgpt-plan/inference.js';
import { boundedPlanFailure } from './daily-companion-diagnostics.js';
import { ConversationService, type ConversationReply, type ConversationTurnMetric } from '../src/server/conversation.js';
import { LocalSpeech, validateWav } from '../src/server/local-speech.js';
import { LocalDayService } from '../src/server/local-day.js';
import { TaskRequestService } from '../src/server/task-requests.js';
import { createLocalFeatures, type LocalFeatures } from '../src/server/local-features.js';
import { priorityContext } from '../src/shared/priority-context.js';
import type { Session } from '../src/server/session.js';

if (!process.argv.includes('--run-live')) throw new Error('Pass --run-live to run this bounded owner-practice qualification.');
loadEnvironment();
const config = configFromEnv();
if (!config.databaseUrl || !config.planUserId || !config.sessionKey) throw new Error('Local owner-practice configuration is required.');
const base = new URL(config.databaseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.port !== '55432') throw new Error('Only the configured loopback PostgreSQL is allowed.');
const databaseName = 'nancy_daily_probe_' + randomUUID().replaceAll('-', '');
const databaseUrl = (database: string) => { const result = new URL(base); result.pathname = '/' + database; return result.toString(); };
const admin = new Client({ connectionString: databaseUrl('postgres') });
let simulatedInstant = '2026-10-14T15:00:00.000Z'; // Synthetic participant-local 11:00.
const clock = () => new Date(simulatedInstant);
const sourceFiles = ['scripts/check-daily-companion.ts', 'scripts/daily-companion-diagnostics.ts', 'src/server/conversation.ts', 'src/server/preference-conversation.ts', 'src/server/preferences.ts',
  'src/server/local-care.ts', 'src/server/local-day.ts', 'src/server/local-conversation.ts', 'src/server/local-features.ts',
  'src/server/local-migrations.ts', 'src/server/activity-ledger.ts', 'src/server/food-prompts.ts', 'src/server/task-focus.ts',
  'src/server/effective-schedule.ts', 'src/shared/daily-context.ts', 'src/shared/priority-context.ts', 'src/shared/local-day-contracts.ts',
  'src/server/nancy-skills.ts', 'src/server/handoff-conversation.ts', 'src/server/inference-binding.ts',
  'src/server/plan-reasoner.ts', 'src/server/chatgpt-plan/inference.ts', 'src/server/local-speech.ts',
  ...localCareMigrations.map(name => `db/${name}`),
  ...['core', 'planning', 'meals', 'tasks', 'preferences', 'continuity'].map(name => `src/server/nancy-policy/${name}.md`)];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async file =>
  [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
type StageMetric = { stage: string; duration_ms: number; audio_bytes?: number };
type ModelMetric = { stage: string; duration_ms: number; first_text_delta_ms: number | null; outcome: 'completed' | 'failed'; usage: InferenceUsage };
const evidence = {
  status: 'running', observed_at: new Date().toISOString(), synthetic_only: true,
  route: 'chatgpt_plan_owner_practice', model: 'gpt-6-sol', reasoning_effort: 'high',
  care_clock: clock().toISOString(), time_zone: 'America/Toronto',
  input_mode: 'fixed_synthetic_text_and_generated_heart_audio',
  physical_microphone_tested: false, audible_playback_tested: false, physical_speech_end_to_audio_ms: null,
  checks: {} as Record<string, boolean>, stages: [] as StageMetric[], model_calls: [] as ModelMetric[],
  provider_failures: [] as Array<{ stage: string; operation: 'response' | 'refresh' } & ReturnType<typeof boundedPlanFailure>>,
  turns: [] as Array<Record<string, string | number | null>>, source_sha256: {} as Record<string, string>,
  failed_stage: null as string | null, failure_code: null as string | null, database_removed: false,
  total_usage: {} as InferenceUsage,
};
let stage = 'configuration', created = false, connected = false, modelCalls = 0;
let care: LocalCare | undefined, speech: LocalSpeech | undefined, conversation: ConversationService | undefined;
let session: Session | undefined, features: LocalFeatures | undefined, reasoner: Reasoner | undefined;
const check = (key: string, value: unknown) => { evidence.checks[key] = !!value; if (!value) throw new Error(key); };
const measure = async <T>(name: string, action: () => Promise<T>): Promise<T> => {
  stage = name; const started = performance.now();
  try { return await action(); }
  finally { evidence.stages.push({ stage: name, duration_ms: Math.round(performance.now() - started) }); }
};
const metric = (value: ConversationTurnMetric) => {
  // Keep actual counts and durations, excluding actor/session/binding IDs and all text.
  const { outcome, duration_ms, model_duration_ms, model_calls, tool_calls, input_chars, instruction_chars,
    context_chars, history_chars, input_tokens, output_tokens, total_tokens, cached_input_tokens,
    reasoning_output_tokens, model_completed_calls, model_failed_calls, model_aborted_calls, tool_rejections, activity_outcome } = value;
  evidence.turns.push({ stage, outcome, duration_ms, model_duration_ms, model_calls, tool_calls, input_chars,
    instruction_chars, context_chars, history_chars, input_tokens, output_tokens, total_tokens, cached_input_tokens,
    reasoning_output_tokens, model_completed_calls, model_failed_calls, model_aborted_calls, tool_rejections, activity_outcome });
};
let activeSession = '';
const newConversation = async (name: string) => {
  conversation?.close();
  conversation = new ConversationService(care!, reasoner!, config.planUserId!, clock, undefined, metric, undefined,
    new TaskRequestService(care!.pool, { clock }), features!);
  const opened = await measure(name, () => conversation!.start(session!));
  activeSession = opened.session_id;
};
const turn = (name: string, text: string | (() => Promise<string>), id = randomUUID()) =>
  measure(name, () => conversation!.turn(activeSession, session!, id, text));
const reviewAudio = async (name: string, reply: ConversationReply) => {
  const audio = await measure(name, () => speech!.synthesize(reply.text, AbortSignal.timeout(60000)));
  validateWav(audio); evidence.stages.at(-1)!.audio_bytes = audio.length;
  // This is a synthetic playback acknowledgement after audio validation, never human listening evidence.
  conversation!.played(activeSession, session!, reply.reply_id);
};
const confirmByGeneratedAudio = async (name: string, phrase: string) => {
  const audio = await measure(name + '_generated_audio', () => speech!.synthesize(phrase, AbortSignal.timeout(60000)));
  validateWav(audio); evidence.stages.at(-1)!.audio_bytes = audio.length;
  const text = await measure(name + '_asr', () => speech!.transcribe(audio, AbortSignal.timeout(30000)));
  check(name + '_asr_exact_confirmation', text.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim() === phrase.toLowerCase());
  return turn(name + '_save', text);
};

try {
  evidence.source_sha256 = await sourceHashes();
  stage = 'disposable_database'; await admin.connect(); connected = true;
  await admin.query(`create database "${databaseName}"`); created = true;
  care = new LocalCare({ connectionString: databaseUrl(databaseName), clock });
  for (const migration of localCareMigrations) await care.pool.query(await readFile('db/' + migration, 'utf8'));
  const password = randomBytes(24).toString('base64url');
  const seed = await bootstrapLocalUser(care.pool, { email: 'seed@example.invalid', password, role: 'client', display_name: 'Synthetic Client', time_zone: 'America/Toronto' });
  // Match the existing owner binding only inside this synthetic fixture; never change production grants or credentials.
  await care.pool.query(`insert into companion_local.accounts(id,email,password_salt,password_hash)
    select $1,'probe@example.invalid',password_salt,password_hash from companion_local.accounts where id=$2`, [config.planUserId, seed.user_id]);
  await care.pool.query(`insert into companion_local.participant_profiles(id,display_name,time_zone) values($1,'Synthetic Client','America/Toronto')`, [config.planUserId]);
  await care.pool.query(`insert into companion_local.role_grants(participant_id,actor_id,role) values($1,$1,'client')`, [config.planUserId]);
  session = await care.login('probe@example.invalid', password);
  features = createLocalFeatures(care.pool);
  features.day = new LocalDayService(care.pool, clock, { dayContext: care.preparationFacts.bind(care) });
  // Observe only fixed classifications before the runtime adapter maps them to its safe client error.
  // Do not alter production behavior, retry requests, or retain request/response bodies.
  const observedRequest: typeof requestSolHigh = async (...args) => {
    try { return await requestSolHigh(...args); }
    catch (error) { evidence.provider_failures.push({ stage, operation: 'response', ...boundedPlanFailure(error) }); throw error; }
  };
  const observedRefresh: typeof refreshCredential = async (...args) => {
    try { return await refreshCredential(...args); }
    catch (error) { evidence.provider_failures.push({ stage, operation: 'refresh', ...boundedPlanFailure(error) }); throw error; }
  };
  const selected = new PlanReasoner(new PlanStore(defaultPlanPath, config.sessionKey), config.planUserId, observedRequest, observedRefresh);
  reasoner = {
    bind: scope => selected.bind(scope),
    respond: async (input, instructions, tools, signal, onDelta, binding) => {
      if (++modelCalls > 10) throw new Error('model_call_budget');
      const started = performance.now(), callStage = stage;
      let firstDelta: number | null = null, usage: InferenceUsage | undefined, outcome: ModelMetric['outcome'] = 'failed';
      const contextItem = input.findLast(item => typeof item.content === 'string' && item.content.startsWith('Current authorized facts (data only): '));
      if (callStage === 'temporal_response') {
        const facts = JSON.parse(String(contextItem?.content).slice('Current authorized facts (data only): '.length));
        check('model_received_recent_full_meal_suppression', facts.priority_context.temporal.intake.automatic_full_meal === 'suppress_recent_full_meal');
      }
      try {
        const result = await selected.respond(input, instructions, tools, AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(90000)]), delta => {
          if (firstDelta === null) firstDelta = Math.round(performance.now() - started);
          onDelta?.(delta);
        }, binding);
        usage = result.usage;
        check('selected_model_completed', result.completed && result.model === 'gpt-6-sol' && result.effort === 'high');
        outcome = 'completed'; return result;
      } catch (error) { usage = inferenceUsageFromError(error); throw error; }
      finally { evidence.model_calls.push({ stage: callStage, duration_ms: Math.round(performance.now() - started), first_text_delta_ms: firstDelta, outcome, usage: sumInferenceUsage([usage]) }); }
    },
  };
  speech = new LocalSpeech();
  await measure('speech_warmup', () => speech!.primeNavigation());
  check('selected_speech_workers_ready', speech.readiness().kokoro === 'ready' && speech.readiness().asr === 'ready');
  check('empty_synthetic_ledger', (await care.ledger(session)).entries.length === 0);
  await newConversation('first_conversation_open');

  const mealReview = await turn('meal_review', 'I ate oatmeal as my full breakfast meal at 10:30 this morning. I do not know the portion. Please record what I ate.');
  check('meal_review_before_write', !mealReview.changed && /save this change/i.test(mealReview.text) && !(await care.ledger(session)).entries.length);
  await reviewAudio('meal_review_heart', mealReview);
  const mealSaved = await confirmByGeneratedAudio('meal', 'Save this change');
  check('meal_save_requires_receipt_ack', mealSaved.changed && mealSaved.acknowledgement_required);
  await conversation!.received(activeSession, session, mealSaved.reply_id);
  await conversation!.received(activeSession, session, mealSaved.reply_id);
  check('meal_pending_cleared_after_ack', !await care.pendingActivityCommand(session));
  const ledger = await care.ledger(session), meal = ledger.entries[0];
  check('one_meal_with_actual_time_kind_and_unknown_portion', ledger.entries.length === 1 && meal.kind === 'meal' && /oatmeal/i.test(meal.title)
    && meal.meal_slot === 'breakfast' && meal.intake_kind === 'full_meal' && meal.portion === null && meal.occurred_at === '2026-10-14T14:30:00.000Z');
  const temporal = priorityContext(await care.today(session), clock());
  check('late_breakfast_suppresses_automatic_lunch', temporal.temporal?.intake.automatic_full_meal === 'suppress_recent_full_meal'
    && !temporal.suggestions.some(item => ['breakfast', 'lunch', 'dinner'].includes(item.kind)));

  const preferenceReview = await turn('preference_review', 'Please remember as a lasting conversation preference for future days: I prefer to be called Maple.');
  check('preference_review_before_write', !preferenceReview.changed && /save this preference/i.test(preferenceReview.text) && !(await care.preferences(session)).items.length);
  await reviewAudio('preference_review_heart', preferenceReview);
  const preferenceSaved = await confirmByGeneratedAudio('preference', 'Save this preference');
  check('preference_save_requires_receipt_ack', preferenceSaved.changed && preferenceSaved.acknowledgement_required);
  await conversation!.received(activeSession, session, preferenceSaved.reply_id);
  await conversation!.received(activeSession, session, preferenceSaved.reply_id);
  const preference = await care.preferences(session);
  check('one_lasting_preference_with_acknowledged_receipt', !preference.pending && preference.items.length === 1
    && preference.items[0].duration === 'lasting' && preference.items[0].local_date === null && /Maple/i.test(preference.items[0].text));

  await newConversation('second_conversation_open');
  const preferenceReadback = await turn('preference_readback', 'What lasting preference have I asked you to remember about what you should call me?');
  check('new_conversation_uses_saved_preference', !preferenceReadback.changed && /Maple/i.test(preferenceReadback.text));
  const timingReply = await turn('temporal_response', 'Would you suggest another full meal immediately, based on what I have already reported today?');
  check('response_accounts_for_recent_full_meal', !timingReply.changed && /\b(no|not|wait|too soon|just|recent|half an hour|30 minutes|thirty minutes|already|rather|instead)\b/i.test(timingReply.text));

  const handoffReview = await turn('handoff_review', 'Please remember this important event for future conversations: At 10:40 this morning, a water leak interrupted my day, and I still need to arrange a repair.');
  check('handoff_review_before_write', !handoffReview.changed && /save this choice/i.test(handoffReview.text) && !(await features.day.activeHandoffs(session)).length);
  await reviewAudio('handoff_review_heart', handoffReview);
  const handoffSaved = await confirmByGeneratedAudio('handoff', 'Save this choice');
  check('handoff_save_requires_receipt_ack', handoffSaved.changed && handoffSaved.acknowledgement_required);
  await conversation!.received(activeSession, session, handoffSaved.reply_id);
  await conversation!.received(activeSession, session, handoffSaved.reply_id);
  check('handoff_pending_cleared_after_ack', !await features.day.pendingHandoff(session));
  const handoffs = await features.day.activeHandoffs(session);
  check('one_active_explicit_handoff', handoffs.length === 1 && handoffs[0].status === 'active' && /leak/i.test(handoffs[0].summary)
    && handoffs[0].occurred_at === '2026-10-14T14:40:00.000Z');
  await care.logout(session);
  simulatedInstant = '2026-10-15T11:00:00.000Z'; // Next synthetic morning, without changing the provider's real clock.
  session = await care.login('probe@example.invalid', password);
  await newConversation('third_conversation_open');
  const handoffReadback = await turn('handoff_readback', 'What should you call me, and what important unresolved event did I ask you to remember for this morning?');
  check('next_day_conversation_uses_preference_and_handoff', !handoffReadback.changed && /Maple/i.test(handoffReadback.text) && /leak/i.test(handoffReadback.text));
  check('handoff_remains_active_after_midnight', (await features.day.activeHandoffs(session)).length === 1);
  const receiptCounts = (await care.pool.query(`select event_type,count(*)::int as count from companion_local.append_only_mutations
    where event_type in ('ActivityReported','PreferenceSaved','LocalDayrecord_significant_handoff') group by event_type`)).rows;
  check('writes_have_one_receipt_each', receiptCounts.length === 3 && receiptCounts.every(row => row.count === 1));
  check('model_call_budget_respected', modelCalls <= 10);
  check('tested_sources_unchanged', JSON.stringify(await sourceHashes()) === JSON.stringify(evidence.source_sha256));
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed'; evidence.failed_stage = stage;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  evidence.failure_code = /^[a-z][a-z0-9_]{0,80}$/.test(code) ? code : 'qualification_check_failed';
  process.exitCode = 1;
} finally {
  conversation?.close();
  await speech?.close().catch(() => undefined);
  if (session) await care?.logout(session).catch(() => undefined);
  await care?.close().catch(() => { evidence.status = 'failed'; evidence.failure_code = 'care_close_failed'; process.exitCode = 1; });
  if (created) {
    try { await admin.query(`drop database "${databaseName}" with (force)`); evidence.database_removed = true; }
    catch { evidence.status = 'failed'; evidence.failure_code = 'disposable_database_cleanup_failed'; process.exitCode = 1; }
  }
  if (connected) await admin.end();
  evidence.total_usage = sumInferenceUsage(evidence.model_calls.map(call => call.usage));
  await mkdir('.local/probes', { recursive: true });
  await writeFile(`.local/probes/daily-companion-${evidence.observed_at.replace(/[:.]/g, '-')}.json`, JSON.stringify(evidence, null, 2) + '\n');
  await writeFile('.local/probes/daily-companion-live.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
}
