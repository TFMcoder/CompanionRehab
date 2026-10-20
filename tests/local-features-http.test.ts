import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/server/app.js';
import { configFromEnv } from '../src/server/config.js';
import { bootstrapLocalUser, LocalCare } from '../src/server/local-care.js';
import { localCareMigrations } from '../src/server/local-migrations.js';
import { SessionRevocations } from '../src/server/revocations.js';
import { sealSession, type Session } from '../src/server/session.js';
import type { LocalSpeech } from '../src/server/local-speech.js';
import type { ConversationService } from '../src/server/conversation.js';
import { pglitePool } from './helpers/pglite-pool.js';

const now = new Date('2026-10-13T14:00:00Z');
const password = 'synthetic-local-feature-password';
function disposableUrl(value: string) {
  const url = new URL(value);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || !/^\/nancy_features_[a-z0-9_]+$/.test(url.pathname)
      || url.search || url.hash) throw new Error('Use a disposable loopback nancy_features database.');
  return value;
}
function wav() {
  const audio = Buffer.alloc(44 + 2_000 * 2);
  audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16_000, 24); audio.writeUInt32LE(32_000, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write('data', 36); audio.writeUInt32LE(2_000 * 2, 40);
  return audio.toString('base64');
}

describe('local feature HTTP with durable local identity', () => {
  let db: PGlite | undefined, pool: Pool, care: LocalCare, app: Awaited<ReturnType<typeof createApp>>;
  let owner: Session, family: Session, clinician: Session;
  let ownerId: string, familyId: string;
  let config: ReturnType<typeof configFromEnv>;
  const transcribe = vi.fn(async () => 'Hey Nancy');
  const routes = ['/api/meals-groceries', '/api/local-day', '/api/programs', '/api/support-team',
    '/api/progress?from=2026-10-13&to=2026-10-13', '/api/operations'];
  const headers = (session: Session) => ({ host: 'localhost:8787', origin: 'http://localhost:8787',
    cookie: `nancy_session=${sealSession(session, config.sessionKey!)}` });
  beforeAll(async () => {
    // All feature services must observe the same date as LocalCare. Otherwise
    // real time eventually expires these fixed-date HTTP fixture sessions.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const external = process.env.LOCAL_FEATURE_HTTP_URL;
    if (external) {
      const own = new URL(disposableUrl(external));
      for (const peer of [process.env.LOCAL_FEATURE_BACKUP_SOURCE_URL, process.env.LOCAL_FEATURE_BACKUP_TARGET_URL])
        if (peer && new URL(disposableUrl(peer)).pathname === own.pathname) throw new Error('Use distinct disposable feature databases.');
      pool = new Pool({ connectionString: external, max: 1 });
    }
    else { db = new PGlite(); pool = pglitePool(db) as unknown as Pool; }
    for (const file of localCareMigrations) {
      const sql = await readFile(new URL(`../db/${file}`, import.meta.url), 'utf8');
      if (db) await db.exec(sql); else await pool.query(sql);
    }
    const participant = await bootstrapLocalUser(pool, { email: 'http-owner@example.invalid', password,
      role: 'client', display_name: 'Synthetic owner', time_zone: 'America/Toronto' });
    const relative = await bootstrapLocalUser(pool, { email: 'http-family@example.invalid', password,
      role: 'family_friend', participant_id: participant.participant_id });
    await bootstrapLocalUser(pool, { email: 'http-clinician@example.invalid', password,
      role: 'clinician', participant_id: participant.participant_id });
    ownerId = participant.user_id; familyId = relative.user_id;
    care = new LocalCare({ pool, clock: () => now });
    owner = await care.login('http-owner@example.invalid', password);
    family = await care.login('http-family@example.invalid', password);
    clinician = await care.login('http-clinician@example.invalid', password);
    config = configFromEnv({ PUBLIC_ORIGIN: 'http://localhost:8787', DATABASE_URL: 'postgresql://localhost/synthetic',
      SESSION_KEY: randomBytes(32).toString('base64'), NANCY_PLAN_USER_ID: ownerId });
    const speech = { readiness: () => ({ asr: 'ready', kokoro: 'ready' }), transcribe,
      synthesize: vi.fn(), close: vi.fn() } as unknown as LocalSpeech;
    const conversation = { close: vi.fn() } as unknown as ConversationService;
    app = await createApp(config, { care, speech, conversation, revocations: new SessionRevocations() });
  });
  afterAll(async () => {
    try { await app?.close(); if (db) await db.close(); else await pool?.end(); }
    finally { vi.useRealTimers(); }
  });

  it('auto-registers each feature on real LocalCare, authenticates, and rejects invalid origin/schema', async () => {
    for (const url of routes) {
      expect((await app.inject({ url, headers: { host: 'localhost:8787' } })).statusCode).toBe(401);
      const response = await app.inject({ url, headers: headers(owner) });
      expect(response.statusCode, `${url}: ${response.body}`).toBe(200);
    }
    expect((await app.inject({ url: '/api/auth/session', headers: headers(owner) })).json())
      .toMatchObject({ local_features_available: true, voice_eligible: true });
    expect((await app.inject({ method: 'POST', url: '/api/prompts/claim', headers: { ...headers(owner), origin: 'https://outside.invalid' }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/prompts/claim', headers: headers(owner), payload: { actor_id: familyId } })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/progress?from=2026-10-14&to=2026-10-13', headers: headers(owner) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/meals-groceries/commands', headers: headers(owner), payload: { type: 'add_grocery', idempotency_key: randomUUID(), actor_id: familyId } })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/programs/receipts/not-a-uuid', headers: headers(owner) })).statusCode).toBe(400);
  });

  it('enforces role, consent, and revocation before new feature reads or local ASR', async () => {
    const phrase = { wav: wav(), consent_token: randomUUID() };
    expect((await app.inject({ url: '/api/meals-groceries', headers: headers(family) })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/progress?from=2026-10-13&to=2026-10-13', headers: headers(clinician) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/wake/recognize', headers: headers(family), payload: phrase })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/wake/recognize', headers: headers(clinician), payload: phrase })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/wake/recognize', headers: { ...headers(owner), origin: 'https://outside.invalid' }, payload: phrase })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/wake/recognize', headers: headers(owner), payload: { ...phrase, actor_id: familyId } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/wake/recognize', headers: headers(owner), payload: phrase })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/wake/consent', headers: headers(owner), payload: { enabled: false } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/wake/consent', headers: headers(family), payload: { enabled: true } })).statusCode).toBe(403);
    expect(transcribe).not.toHaveBeenCalled();
    const issued = (await app.inject({ method: 'POST', url: '/api/wake/consent', headers: headers(owner), payload: { enabled: true } })).json();
    expect(issued.consent_token).toMatch(/^[0-9a-f-]{36}$/);
    expect((await app.inject({ method: 'POST', url: '/api/wake/recognize', headers: headers(owner), payload: { ...phrase, consent_token: issued.consent_token } })).json()).toEqual({ detected: true });
    expect(transcribe).toHaveBeenCalledTimes(1);
    const second = (await app.inject({ method: 'POST', url: '/api/wake/consent', headers: headers(owner), payload: { enabled: true } })).json();
    expect((await app.inject({ method: 'POST', url: '/api/wake/consent/revoke', headers: headers(owner), payload: { consent_token: second.consent_token } })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: 'POST', url: '/api/wake/recognize', headers: headers(owner), payload: { ...phrase, consent_token: second.consent_token } })).statusCode).toBe(403);
    expect(transcribe).toHaveBeenCalledTimes(1);
    await pool.query('update companion_local.role_grants set revoked_at=$2 where participant_id=$1 and actor_id=$3', [ownerId, now, familyId]);
    expect((await app.inject({ url: '/api/support-team', headers: headers(family) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/wake/recognize', headers: headers(family), payload: phrase })).statusCode).toBe(401);
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it('does not reuse one program command key for a separate local feature write', async () => {
    const idempotency_key = randomUUID();
    const created = await app.inject({ method: 'POST', url: '/api/programs/commands', headers: headers(owner), payload: {
      type: 'create_program', idempotency_key, confirmed: true,
      draft: { title: 'Synthetic single-key routine', kind: 'routine', protected_start: null, protected_end: null,
        rest_minutes: 0, steps: [{ id: 'step', title: 'Step', instruction: 'Synthetic instruction.', optional: false,
          depends_on: [], estimated_minutes: 5 }] },
    } });
    expect(created.statusCode, created.body).toBe(200);
    const otherCommands = [
      { url: '/api/meals-groceries/commands', payload: { type: 'add_grocery', idempotency_key,
        item: { name: 'Synthetic tea', amount: 1, unit: 'box' }, proposal_id: null, expected_proposal_revision: null } },
      { url: '/api/local-day/commands', payload: { type: 'set_prompt_preferences', idempotency_key, expected_revision: 0,
        confirmed: true, preferences: { enabled: false, meal_times: { breakfast: null, lunch: null, dinner: null },
          appointment_lead_minutes: 30, quiet_start: '21:00', quiet_end: '08:00', foreground_speech: false, browser_notifications: false } } },
      { url: '/api/progress/commands', payload: { type: 'request_data_export', idempotency_key,
        from: '2026-10-13', to: '2026-10-13', format: 'json', fields: ['local_date', 'status'] } },
    ];
    for (const attempt of otherCommands) {
      const response = await app.inject({ method: 'POST', url: attempt.url, headers: headers(owner), payload: attempt.payload });
      expect(response.statusCode, `${attempt.url}: ${response.body}`).toBe(409);
    }
    expect((await pool.query('select count(*)::int n from companion_local.program_receipts where command_id=$1', [idempotency_key])).rows[0].n).toBe(1);
    expect((await pool.query('select count(*)::int n from companion_local.append_only_mutations where command_id=$1', [idempotency_key])).rows[0].n).toBe(1);
  });
});
