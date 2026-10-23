import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { PlanSocket, WarmPlanReasoner } from '../src/server/chatgpt-plan/warm-connection.js';
import { PlanStore, type PlanState } from '../src/server/chatgpt-plan/storage.js';
import { createPlanRequest, reasoningCandidates } from '../src/server/chatgpt-plan/inference.js';
import { dialogueConversationGuidance } from '../src/server/dialogue-replies.js';
import { ownerTestWarmConnection, ownerTestTelemetryPolicy, type OwnerTestSettings } from '../src/server/owner-test-config.js';
import { NANCY_POLICY_VERSION } from '../src/server/inference-binding.js';
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
  constructor() { super(); queueMicrotask(() => { this.readyState = WebSocket.OPEN; this.emit('open'); }); }
  event(event: unknown) { this.emit('message', Buffer.from(JSON.stringify(event))); }
  send(raw: string, callback: (error?: Error) => void) {
    const body = JSON.parse(raw); this.sent.push(body); callback();
    queueMicrotask(() => {
      if (this.hold) return;
      if (this.refuse) return this.event({ type: 'error', error: { code: 'subscription_sharing_usage_limit_exceeded' } });
      if (body.generate !== false) this.event({ type: 'response.output_text.delta', delta: this.answer });
      this.event({ type: 'response.completed', response: { id: 'resp_synthetic_' + this.sent.length, status: 'completed',
        model: this.wrongModel ? 'wrong-model' : 'gpt-6-sol', output: body.generate === false ? [] : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: this.answer }] }],
        usage: { input_tokens: 10, output_tokens: body.generate === false ? 0 : 4, total_tokens: body.generate === false ? 10 : 14 } } });
    });
  }
  close() { this.readyState = WebSocket.CLOSED; this.emit('close'); }
  terminate() { this.close(); }
}
function transport() {
  const sockets: FakeSocket[] = [];
  const socket = new PlanSocket(() => { const fake = new FakeSocket(); sockets.push(fake); return fake as unknown as WebSocket; });
  cleanups.push(() => socket.close());
  return { socket, sockets };
}
function bound() {
  const owner = randomUUID(), participant = randomUUID();
  const state: PlanState = { hostId: 'urn:uuid:synthetic-host', accounts: { 'client:subject': {
    issuer: 'https://auth.openai.com', subject: 'subject', clientId: 'client', idToken: 'synthetic-id', accessToken: 'synthetic-access',
    refreshToken: 'synthetic-refresh', scopes: ['chatgpt.tokens.use.direct'], expiresAt: Date.now() + 3600000,
  } }, nancyBinding: { actorId: owner, accountKey: 'client:subject', hostId: 'urn:uuid:synthetic-host', bindingId: randomUUID() } };
  const store = { load: vi.fn(async () => structuredClone(state)) } as unknown as PlanStore;
  const transports: ReturnType<typeof transport>[] = [], metrics: any[] = [];
  const reasoner = new WarmPlanReasoner(store, owner, participant, metric => metrics.push(metric), () => { const t = transport(); transports.push(t); return t.socket; });
  cleanups.push(() => reasoner.releaseConnection());
  const scope = { actor_id: owner, client_id: participant, active_role: 'client' as const, login_session_id: randomUUID(), grant_revision: 'synthetic-v1', policy_version: 'synthetic-policy' };
  return { reasoner, state, store, scope, metrics, transports };
}
const pinned = createPlanRequest(reasoningCandidates['sol-low']);
const account = { issuer: 'https://auth.openai.com' as const, subject: 'synthetic', clientId: 'synthetic', idToken: '', refreshToken: '',
  accessToken: 'synthetic-access', scopes: ['chatgpt.tokens.use.direct'], expiresAt: Date.now() + 3600000 };

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
