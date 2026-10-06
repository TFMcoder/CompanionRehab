import { configFromEnv, loadEnvironment } from './config.js';
import { createApp } from './app.js';
import { LocalCare } from './local-care.js';
import { LocalSpeech } from './local-speech.js';
import { PlanStore, defaultPlanPath } from './chatgpt-plan/storage.js';
import { PlanReasoner } from './plan-reasoner.js';
import { ConversationService } from './conversation.js';
import { RuntimeLog } from './telemetry.js';
const startedAt = performance.now();
loadEnvironment();
const config = configFromEnv();
const care = config.databaseUrl ? new LocalCare({ connectionString: config.databaseUrl }) : undefined;
const runtimeLog = care ? new RuntimeLog(care.pool) : undefined;
const reasoner = config.sessionKey && config.planUserId ? new PlanReasoner(new PlanStore(defaultPlanPath, config.sessionKey)) : undefined;
const speech = config.voiceTransport === 'local' && care && reasoner && await reasoner.available() ? new LocalSpeech() : undefined;
const conversation = speech && care && reasoner ? new ConversationService(care, reasoner, config.planUserId!, undefined, (text, signal) => speech.synthesize(text, signal), metric => {
  const { actor_id, conversation_id, turn_id, outcome, ...measurements } = metric;
  runtimeLog?.record({ kind: 'conversation', actor_id, conversation_id, turn_id, outcome: outcome === 'completed' ? 'ok' : outcome === 'failed' ? 'error' : 'interrupted', measurements });
}) : undefined;
const app = await createApp(config, { care, speech, conversation, runtimeLog });
await app.listen({ host: '127.0.0.1', port: config.port });
runtimeLog?.record({ kind: 'startup', outcome: 'ready', measurements: { stage: 'http_ready', duration_ms: performance.now() - startedAt } });
console.log(`Nancy is running at ${config.origin}.`);
// HTTP/touch comes online immediately. Warm the selected speech workers without delaying sign-in.
if (speech) void speech.primeNavigation().then(() => {
  runtimeLog?.record({ kind: 'startup', outcome: 'ready', measurements: { stage: 'speech_ready', duration_ms: performance.now() - startedAt } });
}).catch(() => {
  runtimeLog?.record({ kind: 'startup', outcome: 'unavailable', measurements: { stage: 'speech_warmup', duration_ms: performance.now() - startedAt } });
  console.error('Local speech could not become ready. Touch remains available.');
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
