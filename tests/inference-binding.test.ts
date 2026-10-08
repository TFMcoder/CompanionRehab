import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PlanReasoner } from '../src/server/plan-reasoner.js';
import { PlanStore, accountKey, type PlanCredential, type PlanState } from '../src/server/chatgpt-plan/storage.js';
import { attachInferenceUsage, inferenceUsageFromError, PlanRequestError, requestSolHigh, refreshCredential,
  type CompletedTurn } from '../src/server/chatgpt-plan/inference.js';
import { NANCY_POLICY_VERSION, type InferenceScope } from '../src/server/inference-binding.js';

const completion: CompletedTurn = { completed: true, model: 'gpt-6-sol', effort: 'high', text: 'Synthetic response.', output: [],
  usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25, cachedInputTokens: 0, reasoningOutputTokens: 3 } };
const unknownUsage = { inputTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null, reasoningOutputTokens: null };

function fixture() {
  const owner = randomUUID();
  const scope: InferenceScope = { actor_id: owner, login_session_id: randomUUID(), active_role: 'client',
    client_id: randomUUID(), grant_revision: 'grant-1', policy_version: NANCY_POLICY_VERSION };
  const first: PlanCredential = { issuer: 'https://auth.openai.com', subject: 'synthetic-owner', clientId: 'oaiapp_fixture',
    idToken: 'synthetic-id', accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh',
    scopes: ['chatgpt.tokens.use.direct'], expiresAt: Date.now() + 3600000 };
  const other: PlanCredential = { ...first, subject: 'synthetic-other', accessToken: 'other-synthetic-access' };
  let state: PlanState = { hostId: `urn:uuid:${randomUUID()}`, activeKey: accountKey(first),
    accounts: { [accountKey(first)]: first, [accountKey(other)]: other } };
  const release = vi.fn(async () => {});
  const storage = { load: vi.fn(async () => structuredClone(state)),
    save: vi.fn(async (next: PlanState) => { state = structuredClone(next); }), lock: vi.fn(async () => release) };
  const request = vi.fn<typeof requestSolHigh>().mockResolvedValue(completion);
  const refresh = vi.fn<typeof refreshCredential>().mockImplementation(async account => ({ ...account, expiresAt: Date.now() + 3600000 }));
  const reasoner = new PlanReasoner(storage as unknown as PlanStore, owner, request, refresh);
  return { owner, scope, first, other, storage, release, request, refresh, reasoner, state: () => state };
}

describe('owner-practice inference account binding', () => {
  it('adopts the authorized owner once and ignores later setup active-account selection across calls', async () => {
    const f = fixture();
    const binding = await f.reasoner.bind(f.scope);
    expect(binding).toMatchObject({ ...f.scope, route_id: 'chatgpt_plan_owner_practice', qualification: 'owner_practice' });
    expect(Object.isFrozen(binding)).toBe(true);
    expect(f.storage.save).toHaveBeenCalledTimes(1);
    f.state().activeKey = accountKey(f.other);
    expect(await f.reasoner.bind(f.scope)).toEqual(binding);
    await f.reasoner.respond([], 'Synthetic policy', [], undefined, undefined, binding);
    await f.reasoner.respond([], 'Synthetic policy', [], undefined, undefined, binding);
    expect(f.request.mock.calls.map(call => accountKey(call[0]))).toEqual([accountKey(f.first), accountKey(f.first)]);
    expect(f.storage.save).toHaveBeenCalledTimes(1);
  });

  it('keeps the bound account when activeKey changes while acquiring the refresh lock', async () => {
    const f = fixture(); const binding = await f.reasoner.bind(f.scope);
    f.state().accounts[accountKey(f.first)].expiresAt = 0;
    f.storage.lock.mockImplementation(async () => { f.state().activeKey = accountKey(f.other); return f.release; });
    await f.reasoner.respond([], 'Synthetic policy', [], undefined, undefined, binding);
    expect(accountKey(f.refresh.mock.calls[0][0])).toBe(accountKey(f.first));
    expect(accountKey(f.request.mock.calls[0][0])).toBe(accountKey(f.first));
    expect(f.state().nancyBinding?.accountKey).toBe(accountKey(f.first));
    expect(f.state().activeKey).toBe(accountKey(f.other));
    expect(f.release).toHaveBeenCalledTimes(2);
  });

  it('does not let another actor bind or use an owner credential, even with a copied binding ID', async () => {
    const f = fixture(); const otherActor = randomUUID();
    await expect(f.reasoner.bind({ ...f.scope, actor_id: otherActor })).rejects.toMatchObject({ status: 403, code: 'reasoning_not_linked' });
    expect(f.storage.load).not.toHaveBeenCalled();
    const binding = await f.reasoner.bind(f.scope);
    await expect(f.reasoner.respond([], '', [], undefined, undefined, { ...binding, actor_id: otherActor }))
      .rejects.toMatchObject({ status: 403, code: 'reasoning_binding_changed' });
    await expect(f.reasoner.respond([], '', [])).rejects.toMatchObject({ status: 403, code: 'reasoning_binding_changed' });
    expect(f.request).not.toHaveBeenCalled();
  });

  it.each(['binding', 'credential', 'host'] as const)('fails closed when the %s disappears or changes before inference', async part => {
    const f = fixture(); const binding = await f.reasoner.bind(f.scope);
    if (part === 'binding') delete f.state().nancyBinding;
    if (part === 'credential') delete f.state().accounts[accountKey(f.first)];
    if (part === 'host') f.state().hostId = `urn:uuid:${randomUUID()}`;
    f.state().activeKey = accountKey(f.other);
    await expect(f.reasoner.respond([], '', [], undefined, undefined, binding)).rejects.toMatchObject({ status: expect.any(Number) });
    expect(f.request).not.toHaveBeenCalled(); expect(f.refresh).not.toHaveBeenCalled();
  });

  it('rejects a changed refreshed subject before persisting or invoking inference', async () => {
    const f = fixture(); const binding = await f.reasoner.bind(f.scope);
    f.state().accounts[accountKey(f.first)].expiresAt = 0;
    f.refresh.mockResolvedValue({ ...f.first, subject: 'changed-synthetic-subject' });
    await expect(f.reasoner.respond([], '', [], undefined, undefined, binding)).rejects.toMatchObject({ status: 403, code: 'reasoning_binding_changed' });
    expect(f.storage.save).toHaveBeenCalledTimes(1); expect(f.request).not.toHaveBeenCalled();
    expect(f.state().nancyBinding?.accountKey).toBe(accountKey(f.first));
    expect(f.release).toHaveBeenCalledTimes(2);
  });

  it('rejects completed results if the credential is revoked while inference is running', async () => {
    const f = fixture(); const binding = await f.reasoner.bind(f.scope);
    f.request.mockImplementation(async () => { delete f.state().accounts[accountKey(f.first)]; return completion; });
    const error = await f.reasoner.respond([], '', [], undefined, undefined, binding).catch(error => error);
    expect(error).toMatchObject({ code: 'reasoning_binding_unavailable' });
    expect(inferenceUsageFromError(error)).toEqual(completion.usage);
    expect(f.request).toHaveBeenCalledTimes(1);
  });

  it('maps quota failure without provider text and preserves actual failure usage', async () => {
    const f = fixture(); const binding = await f.reasoner.bind(f.scope);
    f.request.mockRejectedValue(attachInferenceUsage(new PlanRequestError(429, 'subscription_sharing_usage_limit_exceeded'), { inputTokens: 20 }));
    const error = await f.reasoner.respond([], '', [], undefined, undefined, binding).catch(error => error);
    expect(error).toMatchObject({ status: 429, code: 'reasoning_limit' });
    expect(inferenceUsageFromError(error)).toEqual({ ...unknownUsage, inputTokens: 20 });
    f.request.mockRejectedValue(new Error('private provider error'));
    const missing = await f.reasoner.respond([], '', [], undefined, undefined, binding).catch(error => error);
    expect(missing).toMatchObject({ status: 503, code: 'reasoning_unavailable' });
    expect(String(missing)).not.toContain('private provider');
    expect(inferenceUsageFromError(missing)).toEqual(unknownUsage);
  });

  it('keeps an aborted request and its supplied usage distinct from a completed call', async () => {
    const f = fixture(); const binding = await f.reasoner.bind(f.scope); const controller = new AbortController();
    const abort = attachInferenceUsage(new DOMException('Synthetic abort', 'AbortError'), { inputTokens: 12, outputTokens: 0 });
    f.request.mockImplementation(async () => { controller.abort(); throw abort; });
    const error = await f.reasoner.respond([], '', [], controller.signal, undefined, binding).catch(error => error);
    expect(error).toBe(abort);
    expect(inferenceUsageFromError(error)).toEqual({ ...unknownUsage, inputTokens: 12, outputTokens: 0 });
  });

  it('retains consumed tokens if a completed provider result is discarded after interruption', async () => {
    const f = fixture(); const binding = await f.reasoner.bind(f.scope); const controller = new AbortController();
    f.request.mockImplementation(async () => { controller.abort(); return completion; });
    const error = await f.reasoner.respond([], '', [], controller.signal, undefined, binding).catch(error => error);
    expect(error).toMatchObject({ name: 'AbortError' });
    expect(inferenceUsageFromError(error)).toEqual(completion.usage);
  });
});
