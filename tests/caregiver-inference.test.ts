import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { dailyLoopDatabase } from './helpers/daily-loop-database.js';
import { bootstrapLocalUser, LocalCare } from '../src/server/local-care.js';
import { caregiverInferencePath, resolveCaregiverInference, type CaregiverInferenceConfig } from '../src/server/caregiver-inference.js';
import { PlanReasoner } from '../src/server/plan-reasoner.js';
import { accountKey, type PlanCredential, type PlanState, type PlanStore } from '../src/server/chatgpt-plan/storage.js';
import { inferenceUsageFromError, type CompletedTurn, type requestSolHigh } from '../src/server/chatgpt-plan/inference.js';
import { NANCY_POLICY_VERSION, bindingRef } from '../src/server/inference-binding.js';
import { ConversationService } from '../src/server/conversation.js';
import { createApp } from '../src/server/app.js';
import { configFromEnv } from '../src/server/config.js';
import { sealSession, type Session } from '../src/server/session.js';
import { SessionRevocations } from '../src/server/revocations.js';
import type { LocalSpeech } from '../src/server/local-speech.js';

const completion: CompletedTurn = { completed: true, model: 'gpt-6-sol', effort: 'high', text: 'Synthetic answer.',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Synthetic answer.' }] }],
  usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25, cachedInputTokens: 0, reasoningOutputTokens: 3 } };

describe('explicit caregiver connection with independent care authority', () => {
  let db: Awaited<ReturnType<typeof dailyLoopDatabase>>;
  const cleanups: Array<() => Promise<unknown> | void> = [];
  beforeAll(async () => { db = await dailyLoopDatabase(); });
  afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
  afterAll(async () => { await db?.close(); });
  async function fixture() {
    const password = 'synthetic-caregiver-fixture', email = randomUUID() + '@example.invalid';
    const client = await bootstrapLocalUser(db.pool, { email, password, role: 'client', display_name: 'Synthetic client' });
    const ownerEmail = randomUUID() + '@example.invalid';
    const owner = await bootstrapLocalUser(db.pool, { email: ownerEmail, password, role: 'administrator', participant_id: client.participant_id });
    const care = new LocalCare({ pool: db.pool }), session = await care.login(email, password);
    const ownerSession = await care.login(ownerEmail, password);
    const grants = (await db.pool.query('select id,actor_id from companion_local.role_grants where participant_id=$1', [client.participant_id])).rows;
    const path = resolve('.local/probes/caregiver-test-' + randomUUID() + '.json');
    cleanups.push(() => rm(path, { force: true }));
    const credential: PlanCredential = { issuer: 'https://auth.openai.com', subject: 'synthetic-owner', clientId: 'oaiapp_fixture',
      idToken: 'synthetic-id', accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh',
      scopes: ['chatgpt.tokens.use.direct'], expiresAt: Date.now() + 3600000 };
    const alternate: PlanCredential = { ...credential, subject: 'synthetic-alternate' };
    let state: PlanState = { hostId: 'urn:uuid:' + randomUUID(), activeKey: accountKey(credential),
      accounts: { [accountKey(credential)]: credential, [accountKey(alternate)]: alternate },
      nancyBinding: { actorId: owner.user_id, accountKey: accountKey(credential), hostId: '', bindingId: randomUUID() } };
    state.nancyBinding!.hostId = state.hostId;
    const config: CaregiverInferenceConfig = { schema_version: 1, enabled: true, authorization_id: randomUUID(),
      approved_by_actor_id: owner.user_id, client_actor_id: client.user_id, participant_id: client.participant_id,
      caregiver_role: 'administrator', caregiver_grant_id: grants.find(g => g.actor_id === owner.user_id).id,
      client_grant_id: grants.find(g => g.actor_id === client.user_id).id, account_binding_id: state.nancyBinding!.bindingId,
      host_id: state.hostId, approved_at: new Date().toISOString(), authorization_ref: 'synthetic fixture authorization' };
    const save = async (value: unknown = config) => writeFile(path, JSON.stringify(value), { mode: 0o600 });
    await save();
    const storage = { load: vi.fn(async () => structuredClone(state)), save: vi.fn(async (value: PlanState) => { state = structuredClone(value); }),
      lock: vi.fn(async () => async () => {}) };
    const request = vi.fn<typeof requestSolHigh>(async () => completion);
    const refresh = vi.fn(async (account: PlanCredential) => ({ ...account, expiresAt: Date.now() + 3600000 }));
    const resolver = resolveCaregiverInference(path, owner.user_id, db.pool);
    const reasoner = new PlanReasoner(storage as unknown as PlanStore, owner.user_id, request, refresh, resolver);
    const scope = { ...await care.authority(session), policy_version: NANCY_POLICY_VERSION };
    return { care, session, ownerSession, client, owner, config, save, path, credential, alternate, state: () => state,
      storage, request, refresh, resolver, reasoner, scope };
  }

  it('binds only the named client and exposes distinct speaker, care profile and account owner', async () => {
    const f = await fixture(), binding = await f.reasoner.bind(f.scope);
    expect(binding).toMatchObject({ actor_id: f.client.user_id, client_id: f.client.participant_id,
      account_owner_actor_id: f.owner.user_id, qualification: 'caregiver_authorized', route_id: 'chatgpt_plan_caregiver' });
    expect(binding.authorization_ref).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Object.isFrozen(binding)).toBe(true);
    await f.reasoner.respond([], 'Synthetic policy', [], undefined, undefined, binding);
    expect(accountKey(f.request.mock.calls[0][0])).toBe(accountKey(f.credential));
    expect(f.storage.save).not.toHaveBeenCalled();
    expect((await f.reasoner.bind({ ...await f.care.authority(f.ownerSession), policy_version: NANCY_POLICY_VERSION })).qualification).toBe('owner_practice');
  });

  it.each(['actor', 'participant', 'role'] as const)('rejects another %s and copied route claims without a model call', async field => {
    const f = await fixture();
    const other = { ...f.scope, ...(field === 'actor' ? { actor_id: randomUUID() } : field === 'participant' ? { client_id: randomUUID() } : { active_role: 'administrator' as const }) };
    await expect(f.reasoner.bind(other)).rejects.toMatchObject({ code: 'reasoning_not_linked' });
    const bound = await f.reasoner.bind(f.scope);
    await expect(f.reasoner.respond([], '', [], undefined, undefined, { ...bound, ...other })).rejects.toMatchObject({ status: 403 });
    expect(f.request).not.toHaveBeenCalled();
  });

  it('retains owner-only defaults with no authorization and fails closed on invalid local files', async () => {
    const f = await fixture();
    expect(() => caregiverInferencePath('../outside.json')).toThrow();
    await f.save({ ...f.config, enabled: false });
    await expect(f.reasoner.bind(f.scope)).rejects.toMatchObject({ code: 'reasoning_not_linked' });
    await f.save({ ...f.config, extra: 'untrusted field' });
    await expect(f.reasoner.bind(f.scope)).rejects.toMatchObject({ code: 'caregiver_connection_unavailable' });
    expect(await f.reasoner.available()).toBe(true);
    await rm(f.path);await expect(f.reasoner.bind(f.scope)).rejects.toMatchObject({ code: 'reasoning_not_linked' });
    expect(f.request).not.toHaveBeenCalled();
  });

  it.each(['caregiver', 'client'] as const)('stops use when the %s grant is revoked', async who => {
    const f = await fixture(), binding = await f.reasoner.bind(f.scope);
    await db.pool.query('update companion_local.role_grants set revoked_at=now() where id=$1', [who === 'caregiver' ? f.config.caregiver_grant_id : f.config.client_grant_id]);
    await expect(f.reasoner.respond([], '', [], undefined, undefined, binding)).rejects.toMatchObject({ code: 'caregiver_authorization_changed' });
    expect(f.request).not.toHaveBeenCalled();
  });

  it.each(['caregiver', 'client'] as const)('stops use when the %s account is disabled', async who => {
    const f = await fixture(), binding = await f.reasoner.bind(f.scope);
    await db.pool.query('update companion_local.accounts set disabled_at=now() where id=$1', [who === 'caregiver' ? f.owner.user_id : f.client.user_id]);
    await expect(f.reasoner.respond([], '', [], undefined, undefined, binding)).rejects.toMatchObject({ code: 'caregiver_authorization_changed' });
    expect(f.request).not.toHaveBeenCalled();
  });

  it('keeps the immutable account through refresh and refuses a changed host or account binding', async () => {
    const f = await fixture(), binding = await f.reasoner.bind(f.scope);
    f.state().activeKey = accountKey(f.alternate);f.state().accounts[accountKey(f.credential)].expiresAt = 0;
    await f.reasoner.respond([], '', [], undefined, undefined, binding);
    expect(accountKey(f.refresh.mock.calls[0][0])).toBe(accountKey(f.credential));
    expect(accountKey(f.request.mock.calls[0][0])).toBe(accountKey(f.credential));
    await f.save({ ...f.config, host_id: 'urn:uuid:' + randomUUID() });
    await expect(f.reasoner.bind(f.scope)).rejects.toMatchObject({ code: 'caregiver_binding_changed' });
    await f.save({ ...f.config, account_binding_id: randomUUID() });
    await expect(f.reasoner.bind(f.scope)).rejects.toMatchObject({ code: 'caregiver_binding_changed' });
  });

  it('invalidates existing bindings after an authorization change and discards a late revoked response with actual usage', async () => {
    const f = await fixture(), binding = await f.reasoner.bind(f.scope);
    f.config.authorization_id = randomUUID();await f.save();
    expect(bindingRef(await f.reasoner.bind(f.scope))).not.toBe(bindingRef(binding));
    await expect(f.reasoner.respond([], '', [], undefined, undefined, binding)).rejects.toMatchObject({ code: 'caregiver_authorization_changed' });
    const current = await f.reasoner.bind(f.scope);
    f.request.mockImplementation(async () => { await f.save({ ...f.config, enabled: false });return completion; });
    const error = await f.reasoner.respond([], '', [], undefined, undefined, current).catch(error => error);
    expect(error.code).toBe('caregiver_authorization_changed');expect(inferenceUsageFromError(error)).toEqual(completion.usage);
  });

  it('uses the same authenticated HTTP conversation, speech and opted-in wake paths; revocation stops all three', async () => {
    const f = await fixture(), conversation = new ConversationService(f.care, f.reasoner, f.owner.user_id);
    const key = randomBytes(32), config = configFromEnv({ PUBLIC_ORIGIN: 'https://caregiver.invalid', SESSION_KEY: key.toString('base64'),
      DATABASE_URL: 'postgres://fixture-unused', NANCY_PLAN_USER_ID: f.owner.user_id });
    const speech = { readiness: () => ({ asr: 'ready', kokoro: 'ready' }), transcribe: vi.fn(async () => 'Hey Nancy'),
      synthesize: vi.fn(async () => Buffer.from('synthetic-wav')), close: vi.fn() } as unknown as LocalSpeech;
    const app = await createApp(config, { care: f.care, conversation, speech, microsoft: null, revocations: new SessionRevocations() });
    cleanups.push(() => app.close());
    const headers = (s: Session) => ({ cookie: 'nancy_session=' + sealSession(s, key), origin: config.origin, host: new URL(config.origin).host });
    expect((await app.inject({ url: '/api/auth/session', headers: headers(f.session) })).json()).toMatchObject({
      voice_eligible: true, voice_connection: 'caregiver_authorized', actor_id: f.client.user_id, participant_id: f.client.participant_id });
    const opened = await app.inject({ method: 'POST', url: '/api/conversation', headers: headers(f.session), payload: {} });
    expect(opened.statusCode).toBe(200);const reply = opened.json();
    expect(reply.text).toBe('Hi Synthetic client, what can I help with?');
    expect((await app.inject({ url: `/api/conversation/${reply.session_id}/speech?turn_id=${reply.reply_id}`, headers: headers(f.session) })).statusCode).toBe(200);
    const consent = await app.inject({ method: 'POST', url: '/api/wake/consent', headers: headers(f.session), payload: { enabled: true } });
    expect(consent.statusCode).toBe(200);
    await f.save({ ...f.config, enabled: false });
    expect((await app.inject({ url: '/api/auth/session', headers: headers(f.session) })).json()).toMatchObject({ voice_eligible: false, voice_connection: null });
    expect((await app.inject({ url: `/api/conversation/${reply.session_id}/speech?turn_id=${reply.reply_id}`, headers: headers(f.session) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/wake/consent', headers: headers(f.session), payload: { enabled: true } })).statusCode).toBe(403);
    expect(f.request).not.toHaveBeenCalled();
  });
});
