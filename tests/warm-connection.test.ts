import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { PlanSocket, WarmPlanReasoner } from '../src/server/chatgpt-plan/warm-connection.js';
import { PlanStore, type PlanState } from '../src/server/chatgpt-plan/storage.js';
import { createPlanRequest, inferenceUsageFromError, reasoningCandidates } from '../src/server/chatgpt-plan/inference.js';
import { dialogueConversationGuidance } from '../src/server/dialogue-replies.js';
import { ownerTestWarmConnection, ownerTestQuickConversation, ownerTestIncrementalConversation, ownerTestTelemetryPolicy, type OwnerTestSettings } from '../src/server/owner-test-config.js';
import { NANCY_POLICY_VERSION, type InferenceBinding, type InferenceScope } from '../src/server/inference-binding.js';
import type { ResolveCaregiverInference } from '../src/server/caregiver-inference.js';
import { ApiError } from '../src/server/errors.js';
import { safeEvent } from '../src/server/telemetry.js';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.restoreAllMocks(); });
class FakeSocket extends EventEmitter {
  readyState = WebSocket.CONNECTING as number;
  sent: any[] = [];
  answer = 'A fresh answer.';
  refuse = false;
  hold = false;
  wrongModel = false;
  omitAggregate = false;
  afterCompleted?: () => void;
  constructor() { super(); queueMicrotask(() => { this.readyState = WebSocket.OPEN; this.emit('open'); }); }
  event(event: unknown) { this.emit('message', Buffer.from(JSON.stringify(event))); }
  send(raw: string, callback: (error?: Error) => void) {
    const body = JSON.parse(raw); this.sent.push(body); callback();
    queueMicrotask(() => {
      if (this.hold) return;
      if (this.refuse) return this.event({ type: 'error', error: { code: 'subscription_sharing_usage_limit_exceeded' } });
      if (body.generate !== false) this.event({ type: 'response.output_text.delta', delta: this.answer });
      const output = body.generate === false ? [] : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: this.answer }] }];
      if (this.omitAggregate) output.forEach((item, output_index) => this.event({ type: 'response.output_item.done', item, output_index }));
      this.event({ type: 'response.completed', response: { id: 'resp_synthetic_' + this.sent.length, status: 'completed',
        model: this.wrongModel ? 'wrong-model' : 'gpt-6-sol', ...(this.omitAggregate ? {} : { output }),
        usage: { input_tokens: 10, output_tokens: body.generate === false ? 0 : 4, total_tokens: body.generate === false ? 10 : 14 } } });
      this.afterCompleted?.();
    });
  }
  close() { this.readyState = WebSocket.CLOSED; this.emit('close'); }
  terminate() { this.close(); }
}
function transport(incremental = false, configure?: (socket: FakeSocket) => void) {
  const sockets: FakeSocket[] = [];
  const socket = new PlanSocket(() => { const fake = new FakeSocket(); configure?.(fake); sockets.push(fake); return fake as unknown as WebSocket; }, incremental);
  cleanups.push(() => socket.close());
  return { socket, sockets };
}
function bound(incremental = false) {
  const owner = randomUUID(), participant = randomUUID();
  const state: PlanState = { hostId: 'urn:uuid:synthetic-host', accounts: { 'client:subject': {
    issuer: 'https://auth.openai.com', subject: 'subject', clientId: 'client', idToken: 'synthetic-id', accessToken: 'synthetic-access',
    refreshToken: 'synthetic-refresh', scopes: ['chatgpt.tokens.use.direct'], expiresAt: Date.now() + 3600000,
  } }, nancyBinding: { actorId: owner, accountKey: 'client:subject', hostId: 'urn:uuid:synthetic-host', bindingId: randomUUID() } };
  const store = { load: vi.fn(async () => structuredClone(state)) } as unknown as PlanStore;
  const transports: ReturnType<typeof transport>[] = [], metrics: any[] = [];
  const reasoner = new WarmPlanReasoner(store, owner, participant, metric => metrics.push(metric), () => { const t = transport(incremental); transports.push(t); return t.socket; });
  cleanups.push(() => reasoner.releaseConnection());
  const scope = { actor_id: owner, client_id: participant, active_role: 'client' as const, login_session_id: randomUUID(), grant_revision: 'synthetic-v1', policy_version: 'synthetic-policy' };
  return { reasoner, state, store, scope, metrics, transports };
}
const pinned = createPlanRequest(reasoningCandidates['sol-low']);
const account = { issuer: 'https://auth.openai.com' as const, subject: 'synthetic', clientId: 'synthetic', idToken: '', refreshToken: '',
  accessToken: 'synthetic-access', scopes: ['chatgpt.tokens.use.direct'], expiresAt: Date.now() + 3600000 };

function caregiverBound() {
  const ownerFixture = bound(), owner = ownerFixture.scope.actor_id, actor = randomUUID();
  const scope: InferenceScope = { ...ownerFixture.scope, actor_id: actor, policy_version: 'synthetic-client-policy-v1' };
  const access = { caregiver: true, policy: true, authorizationRef: 'sha256:' + 'a'.repeat(64),
    accountBindingId: ownerFixture.state.nancyBinding!.bindingId, hostId: ownerFixture.state.hostId,
    policyVersion: scope.policy_version, grantRevision: scope.grant_revision, loginSession: scope.login_session_id };
  const caregiver = vi.fn<ResolveCaregiverInference>(async current => {
    if (!access.caregiver || current.actor_id !== actor || current.client_id !== scope.client_id || current.active_role !== 'client') return;
    return { ownerActorId: owner, accountBindingId: access.accountBindingId, hostId: access.hostId, authorizationRef: access.authorizationRef };
  });
  const authorizeBinding = vi.fn(async (binding: InferenceBinding) => {
    if (!access.policy || binding.policy_version !== access.policyVersion || binding.grant_revision !== access.grantRevision
      || binding.login_session_id !== access.loginSession)
      throw new ApiError(403, 'client_rollout_changed', 'Synthetic client release changed.');
  });
  const configuration: { socket?: (socket: FakeSocket) => void } = {};
  const transports: ReturnType<typeof transport>[] = [], metrics: any[] = [];
  const options = { actorId: actor, clientId: scope.client_id, caregiver, authorizeBinding };
  const reasoner = new WarmPlanReasoner(ownerFixture.store, owner, scope.client_id, metric => metrics.push(metric), () => {
    const t = transport(false, socket => configuration.socket?.(socket)); transports.push(t); return t.socket;
  }, options);
  cleanups.push(() => reasoner.releaseConnection());
  return { ...ownerFixture, owner, actor, scope, access, caregiver, authorizeBinding, options, reasoner, configuration, transports, metrics };
}

const httpCompletion = () => new Response('data: ' + JSON.stringify({ type: 'response.completed', response: {
  status: 'completed', model: 'gpt-6-sol', output: [], usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 },
} }) + '\n\n');

describe('explicit exact-client caregiver warm transport', () => {
  beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No real provider requests are allowed in this synthetic transport suite.')); });
  it('requires complete exact-target options without changing the owner default', async () => {
    const f = caregiverBound();
    for (const options of [
      { ...f.options, actorId: f.owner }, { ...f.options, actorId: 'invalid' }, { ...f.options, clientId: randomUUID() },
      { ...f.options, caregiver: undefined }, { ...f.options, authorizeBinding: undefined }, { ...f.options, fallback: true },
    ]) expect(() => new WarmPlanReasoner(f.store, f.owner, f.scope.client_id, undefined, undefined, options as any)).toThrow(RangeError);
    const ownerOnly = new WarmPlanReasoner(f.store, f.owner, f.scope.client_id);
    await expect(ownerOnly.bind(f.scope)).rejects.toMatchObject({ code: 'experiment_owner_only' });
    const ownerBinding = await ownerOnly.bind({ ...f.scope, actor_id: f.owner });
    expect(ownerBinding).toMatchObject({ qualification: 'owner_practice', route_id: 'chatgpt_plan_owner_practice' });
    expect(f.transports).toHaveLength(0);
  });
  it('retains the actual speaker, existing account owner, host and authorization on binding', async () => {
    const f = caregiverBound(), binding = await f.reasoner.bind(f.scope);
    expect(binding).toMatchObject({ ...f.scope, route_id: 'chatgpt_plan_caregiver', qualification: 'caregiver_authorized',
      account_owner_actor_id: f.owner, account_binding_id: f.access.accountBindingId, authorization_ref: f.access.authorizationRef });
    expect(Object.isFrozen(binding)).toBe(true);
    expect(f.caregiver).toHaveBeenCalledWith(expect.objectContaining(f.scope));
    expect(f.authorizeBinding).toHaveBeenCalledWith(binding);
    expect(f.state.nancyBinding!.actorId).toBe(f.owner);
  });
  it.each(['actor_id', 'client_id', 'active_role'] as const)('denies another %s before connection', async key => {
    const f = caregiverBound();
    await expect(f.reasoner.bind({ ...f.scope, [key]: key === 'active_role' ? 'administrator' : randomUUID() })).rejects.toMatchObject({ status: 403 });
    expect(f.caregiver).not.toHaveBeenCalled(); expect(f.transports).toHaveLength(0);
  });
  it.each(['login_session_id', 'grant_revision', 'policy_version', 'account_binding_id', 'authorization_ref', 'route_id', 'qualification', 'account_owner_actor_id'] as const)(
    'rejects a copied binding with changed %s before opening a lane', async key => {
      const f = caregiverBound(), binding = await f.reasoner.bind(f.scope), changed = { ...binding, [key]: randomUUID() } as InferenceBinding;
      await expect(f.reasoner.warmConnection(changed, new AbortController().signal)).rejects.toMatchObject({ status: 403 });
      await expect(f.reasoner.respond([], dialogueConversationGuidance, [], undefined, undefined, changed)).rejects.toMatchObject({ status: 403 });
      expect(f.transports).toHaveLength(0);
    });
  it('prepares only static policy and uses the same caregiver-bound parser for fresh ordinary replies', async () => {
    const f = caregiverBound(), binding = await f.reasoner.bind(f.scope), conversation = randomUUID();
    await f.reasoner.warmConnection(binding, new AbortController().signal, conversation);
    const socket = f.transports[0].sockets[0], firstInput = [{ role: 'user', content: 'Fresh authorized dialogue.' }];
    expect(socket.sent[0]).toMatchObject({ generate: false, input: [], model: 'gpt-6-sol', reasoning: { effort: 'low' }, store: false });
    expect(socket.sent[0].tools ?? []).toEqual([]); expect(socket.sent[0]).not.toHaveProperty('service_tier');
    const response = await f.reasoner.respond(firstInput, dialogueConversationGuidance, [], undefined, undefined, binding);
    expect(response).toMatchObject({ completed: true, model: 'gpt-6-sol', effort: 'low', text: 'A fresh answer.' });
    expect(socket.sent[1]).toMatchObject({ input: firstInput, previous_response_id: 'resp_synthetic_1' });
    const next = [{ role: 'user', content: 'Complete changed facts and a new question.' }];
    await f.reasoner.respond(next, dialogueConversationGuidance, [], undefined, undefined, binding);
    expect(socket.sent[2]).toMatchObject({ input: next }); expect(socket.sent[2]).not.toHaveProperty('previous_response_id');
    expect(f.metrics[0]).toMatchObject({ actor_id: f.actor, conversation_id: conversation, connection_warmup_requests: 1, outcome: 'completed' });
    expect(f.caregiver.mock.calls.length).toBeGreaterThan(4); expect(f.authorizeBinding.mock.calls.length).toBeGreaterThan(4);
  });
  it('rejects caregiver revocation before a warm request and clears an incompatible existing lane', async () => {
    const f = caregiverBound(), binding = await f.reasoner.bind(f.scope);
    await f.reasoner.warmConnection(binding, new AbortController().signal);
    const socket = f.transports[0].sockets[0]; f.access.caregiver = false;
    await expect(f.reasoner.warmConnection(binding, new AbortController().signal)).rejects.toMatchObject({ code: 'caregiver_authorization_changed' });
    expect(socket.sent).toHaveLength(1); expect(socket.readyState).toBe(WebSocket.CLOSED);
  });
  it('rejects changed rollout policy before generation without HTTP fallback', async () => {
    const f = caregiverBound(), binding = await f.reasoner.bind(f.scope), http = vi.spyOn(globalThis, 'fetch');
    await f.reasoner.warmConnection(binding, new AbortController().signal);
    const socket = f.transports[0].sockets[0]; f.access.policy = false;
    await expect(f.reasoner.respond([], dialogueConversationGuidance, [], undefined, undefined, binding)).rejects.toMatchObject({ code: 'client_rollout_changed' });
    expect(socket.sent).toHaveLength(1); expect(socket.readyState).toBe(WebSocket.CLOSED); expect(http).not.toHaveBeenCalled();
  });
  it.each(['caregiver', 'policy'] as const)('discards preparation when %s access changes in flight, retaining supplied usage', async kind => {
    const f = caregiverBound(), binding = await f.reasoner.bind(f.scope);
    f.configuration.socket = socket => { socket.afterCompleted = () => { f.access[kind] = false; }; };
    await f.reasoner.warmConnection(binding, new AbortController().signal);
    const socket = f.transports[0].sockets[0];
    expect(socket.readyState).toBe(WebSocket.CLOSED); expect(socket.sent).toHaveLength(1);
    expect(f.metrics[0]).toMatchObject({ connection_warmup_requests: 1, input_tokens: 10, output_tokens: 0, total_tokens: 10 });
    expect(f.metrics[0].outcome).not.toBe('completed');
    await expect(f.reasoner.respond([], dialogueConversationGuidance, [], undefined, undefined, binding)).rejects.toMatchObject({ status: 403 });
    expect(socket.sent).toHaveLength(1);
  });
  it('discards a completed reply when rollout policy changes before disclosure and preserves actual usage', async () => {
    const f = caregiverBound(), binding = await f.reasoner.bind(f.scope);
    await f.reasoner.warmConnection(binding, new AbortController().signal);
    const socket = f.transports[0].sockets[0]; socket.afterCompleted = () => { f.access.policy = false; };
    const error = await f.reasoner.respond([], dialogueConversationGuidance, [], undefined, undefined, binding).catch(error => error);
    expect(error).toMatchObject({ code: 'client_rollout_changed' }); expect(inferenceUsageFromError(error).totalTokens).toBe(14);
    expect(socket.readyState).toBe(WebSocket.CLOSED); expect(socket.sent).toHaveLength(2);
  });
  it.each(['host', 'binding', 'owner'] as const)('rejects a changed immutable %s before transmission', async kind => {
    const f = caregiverBound(), binding = await f.reasoner.bind(f.scope);
    await f.reasoner.warmConnection(binding, new AbortController().signal);
    if (kind === 'host') f.state.hostId = 'urn:uuid:changed-synthetic-host';
    if (kind === 'binding') f.state.nancyBinding!.bindingId = randomUUID();
    if (kind === 'owner') f.state.nancyBinding!.actorId = randomUUID();
    await expect(f.reasoner.respond([], dialogueConversationGuidance, [], undefined, undefined, binding)).rejects.toMatchObject({ status: 403 });
    expect(f.transports[0].sockets[0].sent).toHaveLength(1);
  });
  it('starts a fresh lane only after a new legitimate login/grant/policy has been rebound', async () => {
    const f = caregiverBound(), binding = await f.reasoner.bind(f.scope);
    await f.reasoner.warmConnection(binding, new AbortController().signal);
    const old = f.transports[0].sockets[0], changed = { ...f.scope, login_session_id: randomUUID(), grant_revision: 'synthetic-v2', policy_version: 'synthetic-client-policy-v2' };
    Object.assign(f.access, { loginSession: changed.login_session_id, grantRevision: changed.grant_revision, policyVersion: changed.policy_version });
    const next = await f.reasoner.bind(changed);
    expect(old.readyState).toBe(WebSocket.CLOSED);
    await f.reasoner.respond([], dialogueConversationGuidance, [], undefined, undefined, next);
    expect(f.transports).toHaveLength(2); expect(f.transports[1].sockets[0].sent[0]).not.toHaveProperty('previous_response_id');
  });
  it('keeps care/tool requests on the same caregiver-bound HTTP profile', async () => {
    const f = caregiverBound(), binding = await f.reasoner.bind(f.scope), http = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => httpCompletion());
    await f.reasoner.warmConnection(binding, new AbortController().signal);
    await f.reasoner.respond([{ role: 'user', content: 'Fresh care facts.' }], 'Existing care policy.', [{ type: 'function', name: 'scoped_tool' }], undefined, undefined, binding);
    expect(http).toHaveBeenCalledOnce();
    const body = JSON.parse(String(http.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ model: 'gpt-6-sol', reasoning: { effort: 'low' }, store: false, tools: [{ type: 'function', name: 'scoped_tool' }] });
    expect(body).not.toHaveProperty('previous_response_id');
    expect(new Headers(http.mock.calls[0][1]?.headers).get('authorization')).toBe('Bearer synthetic-access');
    expect(f.transports[0].sockets[0].sent).toHaveLength(1);
  });
  it('rejects HTTP care results when policy changes in flight, without retry or account fallback', async () => {
    const f = caregiverBound(), binding = await f.reasoner.bind(f.scope);
    const http = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { f.access.policy = false; return httpCompletion(); });
    const error = await f.reasoner.respond([], 'Existing care policy.', [{ type: 'function', name: 'scoped_tool' }], undefined, undefined, binding).catch(error => error);
    expect(error).toMatchObject({ code: 'client_rollout_changed' }); expect(inferenceUsageFromError(error).totalTokens).toBe(25);
    expect(http).toHaveBeenCalledOnce(); expect(f.transports).toHaveLength(0);
  });
  it('cancels targeted pending generation without a partial completed response', async () => {
    const f = caregiverBound(), binding = await f.reasoner.bind(f.scope);
    await f.reasoner.warmConnection(binding, new AbortController().signal);
    const socket = f.transports[0].sockets[0]; socket.hold = true;
    const result = f.reasoner.respond([], dialogueConversationGuidance, [], undefined, undefined, binding);
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    f.reasoner.releaseConnection(binding);
    await expect(result).rejects.toMatchObject({ code: 'reasoning_unavailable' }); expect(socket.readyState).toBe(WebSocket.CLOSED);
  });
  it('rechecks policy after awaiting preparation before it can generate a response', async () => {
    const f = caregiverBound(), binding = await f.reasoner.bind(f.scope);
    f.configuration.socket = socket => { socket.hold = true; };
    const warm = f.reasoner.warmConnection(binding, new AbortController().signal);
    await vi.waitFor(() => expect(f.transports[0]?.sockets[0]?.sent).toHaveLength(1));
    const socket = f.transports[0].sockets[0], checksBefore = f.authorizeBinding.mock.calls.length;
    const answer = f.reasoner.respond([], dialogueConversationGuidance, [], undefined, undefined, binding).catch(error => error);
    await vi.waitFor(() => expect(f.authorizeBinding.mock.calls.length).toBe(checksBefore + 1));
    f.access.policy = false;
    socket.event({ type: 'response.completed', response: { id: 'resp_synthetic_warm', status: 'completed', model: 'gpt-6-sol', output: [], usage: { input_tokens: 10, output_tokens: 0, total_tokens: 10 } } });
    await warm; expect(await answer).toMatchObject({ status: 403 });
    expect(socket.sent).toHaveLength(1); expect(socket.readyState).toBe(WebSocket.CLOSED);
  });
  it('retains the same eighteen-attempt context-only preparation cap for the targeted runtime', async () => {
    const f = caregiverBound(), binding = await f.reasoner.bind(f.scope);
    for (let i = 0; i < 20; i++) await f.reasoner.warmConnection(binding, new AbortController().signal);
    expect(f.metrics).toHaveLength(18); expect(f.transports).toHaveLength(18);
  });
});

describe('owner-only prepared Pro connection', () => {
  it('prepares no human input or output, then sends full fresh dialogue through the same parser', async () => {
    const f = bound(), binding = await f.reasoner.bind(f.scope);
    await f.reasoner.warmConnection(binding, new AbortController().signal);
    const first = f.transports[0].sockets[0];
    expect(first.sent[0]).toMatchObject({ type: 'response.create', generate: false, input: [], model: 'gpt-6-sol', reasoning: { effort: 'low' }, store: false });
    expect(first.sent[0]).not.toHaveProperty('stream'); expect(first.sent[0]).not.toHaveProperty('service_tier');
    const input = [{ role: 'user', content: 'Fresh authorized facts and question.' }], delta = vi.fn();
    const result = await f.reasoner.respond(input, dialogueConversationGuidance, [], undefined, delta, binding);
    expect(result.completed).toBe(true); expect(result.text).toBe('A fresh answer.'); expect(delta).toHaveBeenCalledWith('A fresh answer.');
    expect(first.sent[1]).toMatchObject({ input, previous_response_id: 'resp_synthetic_1' });
    await f.reasoner.respond([{ role: 'user', content: 'Changed fresh facts.' }], dialogueConversationGuidance, [], undefined, undefined, binding);
    expect(first.sent[2]).toMatchObject({ input: [{ role: 'user', content: 'Changed fresh facts.' }] });
    expect(first.sent[2]).not.toHaveProperty('previous_response_id');
    expect(f.metrics[0]).toMatchObject({ outcome: 'completed', model_calls: 0, connection_warmup_requests: 1, output_tokens: 0, reasoning_output_tokens: null });
  });
  it.each(['actor_id','client_id','active_role'] as const)('rejects changed %s before connecting', async key => {
    const f = bound(); await expect(f.reasoner.bind({ ...f.scope, [key]: key === 'active_role' ? 'administrator' : randomUUID() })).rejects.toMatchObject({ status: 403 });
    expect(f.transports).toHaveLength(0);
  });
  it('revalidates the account after warmup and before generated disclosure', async () => {
    const f = bound(), binding = await f.reasoner.bind(f.scope);
    await f.reasoner.warmConnection(binding, new AbortController().signal); f.state.nancyBinding!.bindingId = randomUUID();
    await expect(f.reasoner.respond([], dialogueConversationGuidance, [], undefined, undefined, binding)).rejects.toMatchObject({ status: 403 });
    expect(f.transports[0].sockets[0].sent).toHaveLength(1);
  });
  it('associates warmup accounting with the actual conversation even before its first model turn', async () => {
    const f = bound(), binding = await f.reasoner.bind(f.scope), conversationId = randomUUID();
    await f.reasoner.warmConnection(binding, new AbortController().signal, conversationId);
    expect(f.metrics[0]).toMatchObject({ conversation_id: conversationId, actor_id: f.scope.actor_id, connection_warmup_requests: 1 });
  });
  it('clears the prior connection on grant, session or policy changes', async () => {
    const f = bound(), binding = await f.reasoner.bind(f.scope);
    await f.reasoner.warmConnection(binding, new AbortController().signal);
    const changed = await f.reasoner.bind({ ...f.scope, grant_revision: 'synthetic-v2', login_session_id: randomUUID(), policy_version: 'changed' });
    await f.reasoner.respond([], dialogueConversationGuidance, [], undefined, undefined, changed);
    expect(f.transports[0].sockets[0].readyState).toBe(WebSocket.CLOSED);
    expect(f.transports[1].sockets[0].sent[0]).not.toHaveProperty('previous_response_id');
  });
  it('stops on provider refusal without HTTP fallback or retry', async () => {
    const f = bound(), binding = await f.reasoner.bind(f.scope); const http = vi.spyOn(globalThis, 'fetch');
    await f.reasoner.warmConnection(binding, new AbortController().signal); f.transports[0].sockets[0].refuse = true;
    await expect(f.reasoner.respond([], dialogueConversationGuidance, [], undefined, undefined, binding)).rejects.toMatchObject({ code: 'reasoning_limit' });
    expect(http).not.toHaveBeenCalled(); expect(f.transports[0].sockets[0].sent).toHaveLength(2);
  });
  it('never returns a delta as a completed reply when the final model is wrong', async () => {
    const f = bound(), binding = await f.reasoner.bind(f.scope);
    await f.reasoner.warmConnection(binding, new AbortController().signal); f.transports[0].sockets[0].wrongModel = true;
    await expect(f.reasoner.respond([], dialogueConversationGuidance, [], undefined, undefined, binding)).rejects.toMatchObject({ code: 'reasoning_unavailable' });
  });
  it('cancels active work and forgets the warm parent on conversation end', async () => {
    const f = bound(), binding = await f.reasoner.bind(f.scope);
    await f.reasoner.warmConnection(binding, new AbortController().signal); f.transports[0].sockets[0].hold = true;
    const pending = f.reasoner.respond([], dialogueConversationGuidance, [], undefined, undefined, binding);
    await vi.waitFor(() => expect(f.transports[0].sockets[0].sent).toHaveLength(2));
    f.reasoner.releaseConnection(binding); await expect(pending).rejects.toMatchObject({ code: 'reasoning_unavailable' });
    expect(f.transports[0].sockets[0].readyState).toBe(WebSocket.CLOSED);
  });
  it('uses the existing HTTP profile for care/tool work, without injecting cached private state', async () => {
    const f = bound(), binding = await f.reasoner.bind(f.scope);
    const http = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', model: 'gpt-6-sol', output: [] } }) + '\n\n'));
    await f.reasoner.warmConnection(binding, new AbortController().signal);
    await f.reasoner.respond([{ role: 'user', content: 'Fresh care facts.' }], 'Existing care policy.', [{ type: 'function', name: 'scoped_tool' }], undefined, undefined, binding);
    expect(http).toHaveBeenCalledTimes(1); const body = JSON.parse(String(http.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ model: 'gpt-6-sol', reasoning: { effort: 'low' }, store: false }); expect(body).not.toHaveProperty('previous_response_id');
    expect(f.transports[0].sockets[0].sent).toHaveLength(1);
  });
  it('limits context-only warmups to eighteen attempts per runtime', async () => {
    const f = bound(), binding = await f.reasoner.bind(f.scope);
    for (let i = 0; i < 20; i++) await f.reasoner.warmConnection(binding, new AbortController().signal);
    expect(f.metrics).toHaveLength(18);
  });
  it('cancels a pending stream without a dangling reader or partial result', async () => {
    const t = transport(), cancel = new AbortController();
    let fake: FakeSocket;
    const socket = new PlanSocket(() => { fake = new FakeSocket(); fake.hold = true; return fake as unknown as WebSocket; });
    cleanups.push(() => socket.close());
    const pending = pinned(account, [], { instructions: 'Test', tools: [] }, (url, init) => socket.fetch(url, init, false), undefined, cancel.signal);
    await vi.waitFor(() => expect(fake?.sent).toHaveLength(1)); cancel.abort(); await expect(pending).rejects.toThrow();
    expect(fake!.readyState).toBe(WebSocket.CLOSED);
    const completedSignal = new AbortController();
    const job = pinned(account, [], { instructions: 'Test', tools: [] }, (url, init) => t.socket.fetch(url, init, false), undefined, completedSignal.signal);
    await vi.waitFor(() => expect(t.sockets[0]?.sent).toHaveLength(1));
    // This also exercises terminal cleanup after a successful already-closed stream.
    await job; completedSignal.abort(); t.socket.close();
  });
  it.each([{ model: 'gpt-6-luna' }, { service_tier: 'ultrafast' }, { tools: [{ type: 'web_search' }] }, { store: true }])('rejects unsupported settings %j', async mutation => {
    const t = transport(); await expect(t.socket.fetch('https://api.openai.com/v1/responses', { headers: { Authorization: 'Bearer synthetic' }, body: JSON.stringify({ input: [], model: 'gpt-6-sol', reasoning: { effort: 'low' }, store: false, stream: true, ...mutation }) }, false)).rejects.toThrow();
    expect(t.sockets).toHaveLength(0);
  });
  it('keeps the flag default-off, exact-bound and diagnostically identifiable', () => {
    const f = bound(), settings = { owner_actor_id: f.scope.actor_id, participant_id: f.scope.client_id, origin: 'https://synthetic.example:10000' } as OwnerTestSettings;
    const selection = { schema_version: 1, owner_actor_id: settings.owner_actor_id, participant_id: settings.participant_id, origin: settings.origin,
      profile: 'sol-low', context_mode: 'prepared-v1', speech_mode: 'heart-latency-v1', read_mode: 'quick-v1', reply_mode: 'spoken-v1', meal_mode: 'ahead-v1', continuation_mode: 'dialogue-v1', chat_mode: 'ahead-v1', reference_mode: 'verified-v1', connection_mode: 'warm-v1' };
    expect(ownerTestWarmConnection(settings)).toBe(false); expect(ownerTestWarmConnection(settings, selection)).toBe(true);
    expect(() => ownerTestWarmConnection(settings, { ...selection, owner_actor_id: randomUUID() })).toThrow();
    expect(() => ownerTestWarmConnection(settings, { ...selection, reference_mode: undefined })).toThrow();
    const label = ownerTestTelemetryPolicy(NANCY_POLICY_VERSION, settings, selection); expect(label.length).toBeLessThanOrEqual(64); expect(label).toContain('-w1');
    expect(safeEvent({ kind: 'conversation', outcome: 'ok', measurements: { stage: 'connection_preparation', connection_warmup_requests: 1, input_tokens: null, transcript: 'never log this' } }).measurements).toEqual({ stage: 'connection_preparation', connection_warmup_requests: 1, input_tokens: null });
  });
});

const context = (name = 'Alex', instant = '2026-10-22T19:00:00.000Z') => ({ role: 'user', content: 'Current authorized facts (data only): ' + JSON.stringify({ profile: { display_name: name }, current_instant: instant, local_date: '2026-10-22', connector_availability: { microsoft_state: 'unavailable' } }) });
const question = { role: 'user', content: 'Why does metal feel colder?' };
const firstInput = () => [{ role: 'assistant', content: 'What would you like to discuss?' }, question, context()];
const continueInput = (input: any[], text: string, name = 'Alex') => [...input.slice(0, -1), { role: 'assistant', content: text }, { role: 'user', content: 'Is tails more likely now?' }, context(name, '2026-10-22T19:01:00.000Z')];
const invoke = (t: ReturnType<typeof transport>, input: any[], instructions = dialogueConversationGuidance, token = account.accessToken) =>
  pinned({ ...account, accessToken: token }, input, { instructions, tools: [] }, (url, init) => t.socket.fetch(url, init, false));

describe('opt-in incremental ordinary conversation', () => {
  it('chains only the latest validated response, including omitted terminal aggregate output, and always sends fresh facts', async () => {
    const t = transport(true), input = firstInput();
    const job = invoke(t, input); await vi.waitFor(() => expect(t.sockets[0]?.sent).toHaveLength(1));
    const a = await job;
    expect(t.socket.acceptResponse(input, dialogueConversationGuidance, a)).toEqual({ incrementalContextHit: 0, inputItems: 3, fullInputItems: 3 });
    t.sockets[0].omitAggregate = true;
    const next = continueInput(input, a.text), b = await invoke(t, next);
    expect(t.sockets[0].sent[1]).toMatchObject({ previous_response_id: 'resp_synthetic_1', input: next.slice(-2), store: false });
    expect(t.socket.acceptResponse(next, dialogueConversationGuidance, b)).toEqual({ incrementalContextHit: 1, inputItems: 2, fullInputItems: 5 });
    const third = continueInput(next, b.text);
    third[third.length - 1] = context('Alex', '2026-10-22T19:02:00.000Z');
    await invoke(t, third);
    expect(t.sockets[0].sent[2]).toMatchObject({ previous_response_id: 'resp_synthetic_2', input: third.slice(-2) });
    expect(t.sockets[0].sent[2].input.at(-1)).toEqual(third.at(-1));
  });
  it('does not chain a completed event until parser and bound-account validation have accepted the response', async () => {
    const t = transport(true), input = firstInput(), a = await invoke(t, input);
    await invoke(t, continueInput(input, a.text));
    expect(t.sockets[0].sent[1]).not.toHaveProperty('previous_response_id');
  });
  it.each(['policy', 'truncated', 'intervening_reply', 'changed_history', 'missing_context', 'extra_user'] as const)('starts fresh for %s without retrying or appending stale history', async change => {
    const t = transport(true), input = firstInput(), a = await invoke(t, input);
    t.socket.acceptResponse(input, dialogueConversationGuidance, a);
    let next = continueInput(input, a.text), policy = dialogueConversationGuidance;
    if (change === 'policy') policy += '\nChanged trusted policy.';
    if (change === 'truncated') next = next.slice(2);
    if (change === 'intervening_reply') next.splice(next.length - 2, 0, { role: 'assistant', content: 'A local reply.' });
    if (change === 'changed_history') next[0] = { role: 'assistant', content: 'Corrected history.' };
    if (change === 'missing_context') next[next.length - 1] = { role: 'user', content: 'Not a current snapshot.' };
    if (change === 'extra_user') next.splice(next.length - 2, 0, { role: 'user', content: 'Another unsatisfied request.' });
    await invoke(t, next, policy);
    expect(t.sockets[0].sent).toHaveLength(2);
    expect(t.sockets[0].sent[1]).toMatchObject({ input: next });
    expect(t.sockets[0].sent[1]).not.toHaveProperty('previous_response_id');
  });
  it('rejects a commit for different input, then sends full context', async () => {
    const t = transport(true), input = firstInput(), a = await invoke(t, input);
    expect(t.socket.acceptResponse([...input.slice(0, -1), context('Different')], dialogueConversationGuidance, a)).toBeUndefined();
    await invoke(t, continueInput(input, a.text));
    expect(t.sockets[0].sent[1]).not.toHaveProperty('previous_response_id');
  });
  it.each(['profile', 'removed_fact', 'source', 'date', 'invalid_clock'] as const)('discards old model state when %s changes', async change => {
    const t = transport(true), input = firstInput(), a = await invoke(t, input);
    t.socket.acceptResponse(input, dialogueConversationGuidance, a);
    const next = continueInput(input, a.text), facts = JSON.parse(next.at(-1)!.content.slice('Current authorized facts (data only): '.length));
    if (change === 'profile') facts.profile.display_name = 'Sam';
    if (change === 'removed_fact') delete facts.profile.display_name;
    if (change === 'source') facts.connector_availability.microsoft_state = 'connected';
    if (change === 'date') facts.local_date = '2026-10-23';
    if (change === 'invalid_clock') facts.current_instant = { instruction: 'untrusted text' };
    next[next.length - 1] = { role: 'user', content: 'Current authorized facts (data only): ' + JSON.stringify(facts) };
    await invoke(t, next);
    expect(t.sockets[0].sent[1]).toMatchObject({ input: next });
    expect(t.sockets[0].sent[1]).not.toHaveProperty('previous_response_id');
  });
  it.each(['token', 'close'] as const)('clears response lineage on %s change', async change => {
    const t = transport(true), input = firstInput(), a = await invoke(t, input);
    t.socket.acceptResponse(input, dialogueConversationGuidance, a);
    if (change === 'close') t.socket.close();
    const next = continueInput(input, a.text);
    await invoke(t, next, dialogueConversationGuidance, change === 'token' ? 'renewed-same-bound-account' : account.accessToken);
    expect(t.sockets).toHaveLength(2);
    expect(t.sockets[1].sent[0]).toMatchObject({ input: next });
    expect(t.sockets[1].sent[0]).not.toHaveProperty('previous_response_id');
  });
  it('does not commit a reply when its immutable account binding changes before delivery', async () => {
    const f = bound(true), binding = await f.reasoner.bind(f.scope);
    await f.reasoner.warmConnection(binding, new AbortController().signal);
    const socket = f.transports[0].sockets[0], oldBinding = f.state.nancyBinding!.bindingId;
    socket.afterCompleted = () => { f.state.nancyBinding!.bindingId = randomUUID(); };
    await expect(f.reasoner.respond(firstInput(), dialogueConversationGuidance, [], undefined, undefined, binding)).rejects.toMatchObject({ status: 403 });
    socket.afterCompleted = undefined; f.state.nancyBinding!.bindingId = oldBinding;
    await f.reasoner.respond(firstInput(), dialogueConversationGuidance, [], undefined, undefined, binding);
    expect(socket.sent[2]).not.toHaveProperty('previous_response_id');
  });
  it('returns numeric transmission metadata only after a fully validated bound response', async () => {
    const f = bound(true), binding = await f.reasoner.bind(f.scope), input = firstInput();
    await f.reasoner.warmConnection(binding, new AbortController().signal);
    const a = await f.reasoner.respond(input, dialogueConversationGuidance, [], undefined, undefined, binding);
    const b = await f.reasoner.respond(continueInput(input, a.text), dialogueConversationGuidance, [], undefined, undefined, binding);
    expect(b.transport).toEqual({ incrementalContextHit: 1, inputItems: 2, fullInputItems: 5 });
    expect(safeEvent({ kind: 'conversation', outcome: 'ok', measurements: { stage: 'model', input_items: 2, full_input_items: 5,
      incremental_context_hit: 1, previous_response_id: 'resp_private', history: 'never log', transcript: 'never log' } }).measurements)
      .toEqual({ stage: 'model', input_items: 2, full_input_items: 5, incremental_context_hit: 1 });
  });
  it('selects incremental state only for the exact startup-bound warm-v3 owner experiment', () => {
    const f = bound(), settings = { owner_actor_id: f.scope.actor_id, participant_id: f.scope.client_id, origin: 'https://synthetic.example:10000' } as OwnerTestSettings;
    const selection = { schema_version: 1, owner_actor_id: settings.owner_actor_id, participant_id: settings.participant_id, origin: settings.origin,
      profile: 'sol-low', context_mode: 'prepared-v1', speech_mode: 'heart-latency-v1', read_mode: 'quick-v1', reply_mode: 'spoken-v1', meal_mode: 'ahead-v1', continuation_mode: 'dialogue-v1', chat_mode: 'ahead-v1', reference_mode: 'verified-v1', connection_mode: 'warm-v3' };
    expect(ownerTestIncrementalConversation(settings)).toBe(false);
    expect(ownerTestIncrementalConversation(settings, selection)).toBe(true);
    expect(ownerTestIncrementalConversation(settings, { ...selection, connection_mode: 'warm-v2' })).toBe(false);
    expect(ownerTestQuickConversation(settings, selection)).toBe(true);
    expect(ownerTestTelemetryPolicy(NANCY_POLICY_VERSION, settings, selection)).toMatch(/-w3$/);
    expect(() => ownerTestIncrementalConversation(settings, { ...selection, owner_actor_id: randomUUID() })).toThrow();
    expect(() => ownerTestIncrementalConversation(settings, { ...selection, profile: 'sol-none' })).toThrow();
    expect(() => ownerTestIncrementalConversation(settings, { ...selection, reference_mode: undefined })).toThrow();
  });
});
