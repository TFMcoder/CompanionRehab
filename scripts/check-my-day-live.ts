import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { LocalSpeech } from '../src/server/local-speech.js';

// Explicit synthetic owner qualification. Outputs only sanitized assertions/timings.
const origin = process.env.MY_DAY_TEST_ORIGIN || 'http://localhost:8787';
const login = JSON.parse(await readFile('.local/runtime/owner-pilot-login.json', 'utf8'));
let cookie = '';
const observations: Record<string, unknown> = { observed_at: new Date().toISOString(), data: 'synthetic owner pilot', model: 'gpt-6-sol', effort: 'high', voice: 'af_heart', checks: [] };
const checks = observations.checks as Array<Record<string, unknown>>;
async function call(path: string, payload?: unknown, method = payload === undefined ? 'GET' : 'POST') {
  const started = performance.now();
  const response = await fetch(origin + path, { method, headers: { origin, ...(cookie ? { cookie } : {}), ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(110000) });
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie')!.split(';')[0];
  const result = response.headers.get('content-type')?.includes('audio/wav') ? Buffer.from(await response.arrayBuffer()) : await response.json();
  if (!response.ok) throw new Error(`${path.replace(/[a-f0-9-]{36}/g, ':id')}: HTTP ${response.status}, ${result.error?.code || 'failed'}`);
  checks.push({ route: path.replace(/[a-f0-9-]{36}/g, ':id'), status: response.status, elapsed_ms: Math.round(performance.now() - started) });
  return result;
}
let active: string | undefined;
async function speak(reply: { reply_id: string; speech_parts?: number }) {
  let firstMs = 0;
  for (let part = 0; part < (reply.speech_parts || 1); part++) {
    const started = performance.now();
    const wav = await call(`/api/conversation/${active}/speech?turn_id=${reply.reply_id}&part=${part}`);
    if (!Buffer.isBuffer(wav) || wav.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Speech part is not WAV.');
    if (part === 0) firstMs = Math.round(performance.now() - started);
  }
  await call(`/api/conversation/${active}/played`, { reply_id: reply.reply_id });
  return firstMs;
}
try {
  await call('/api/auth/login', { email: login.email, password: login.password });
  const today = await call('/api/today');
  if (today.profile.display_name !== 'Practice Day') throw new Error('Only the explicitly synthetic profile may run this probe.');
  const start = await call('/api/conversation', {}); active = start.session_id;
  observations.greeting_first_audio_ms = await speak(start);
  const navigate = await call(`/api/conversation/${active}/turn`, { turn_id: randomUUID(), text: 'Please show my meals.' });
  if (navigate.navigate !== 'meals') throw new Error('Voice command did not select meals.');
  const plan = await call(`/api/conversation/${active}/turn`, { turn_id: randomUUID(), text: 'Let us plan today. Include my three existing tasks. Choose oatmeal with berries for breakfast, vegetable soup and toast for lunch, and lentil pasta for dinner. Keep the existing times. Please propose this plan and read it back for review.' });
  let review = plan;
  if (!review.text.toLowerCase().includes('say accept this plan')) review = await call(`/api/conversation/${active}/turn`, { turn_id: randomUUID(), text: 'Please read the exact proposed plan for review now.' });
  const proposed = await call('/api/today');
  if (!proposed.checkin?.proposal) throw new Error('No plan proposal saved.');
  if (proposed.checkin?.accepted?.id === proposed.checkin.proposal.id) throw new Error('Unconfirmed proposal was accepted early.');
  observations.plan_first_audio_ms = await speak(review);
  const fixtures = new LocalSpeech();
  let acceptance: Buffer;
  try { await fixtures.ready(); acceptance = await fixtures.synthesize('Accept this plan.'); }
  finally { await fixtures.close(); }
  const turn_id = randomUUID();
  const accepted = await call(`/api/conversation/${active}/audio`, { turn_id, wav: acceptance.toString('base64') });
  if (!accepted.changed || !/saved/i.test(accepted.text)) throw new Error('Spoken synthetic acceptance was not confirmed.');
  const after = await call('/api/today');
  if (after.checkin.accepted.id !== proposed.checkin.proposal.id) throw new Error('Accepted plan does not match exact review.');
  await call(`/api/conversation/${active}/audio`, { turn_id, wav: acceptance.toString('base64') });
  const replay = await call('/api/today');
  if (replay.checkin.revision !== after.checkin.revision) throw new Error('Audio replay duplicated a commit.');
  await call(`/api/conversation/${active}`, undefined, 'DELETE'); active = undefined;
  await call('/api/auth/logout', {});
  await call('/api/auth/login', { email: login.email, password: login.password });
  const reload = await call('/api/today');
  if (reload.checkin.accepted.id !== after.checkin.accepted.id) throw new Error('Saved plan did not survive relogin.');
  observations.status = 'passed'; observations.accepted_version = reload.checkin.accepted.version; observations.audio_acceptance_replay = 'one commit';
  console.log(JSON.stringify({ status: 'passed', checks: checks.length, accepted_version: reload.checkin.accepted.version, data: 'synthetic only; no microphone/device acceptance' }));
} catch (error) {
  observations.status = 'failed'; observations.error = error instanceof Error ? error.message : 'failed';
  console.log(JSON.stringify({ status: 'failed', error: observations.error, checks_completed: checks.length })); process.exitCode = 1;
} finally {
  if (active) await call(`/api/conversation/${active}`, undefined, 'DELETE').catch(() => {});
  if (cookie) await call('/api/auth/logout', {}).catch(() => {});
  await writeFile('.local/probes/my-day-live.json', JSON.stringify(observations, null, 2), { mode: 0o600 });
}
