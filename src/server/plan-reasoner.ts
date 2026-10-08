import { randomUUID } from 'node:crypto';
import { ApiError } from './errors.js';
import { PlanStore, accountKey, type PlanState, type PlanCredential } from './chatgpt-plan/storage.js';
import { requestSolHigh, refreshCredential, PlanRequestError, attachInferenceUsage, inferenceUsageFromError, type OutputItem, type CompletedTurn } from './chatgpt-plan/inference.js';
import type { InferenceBinding, InferenceScope } from './inference-binding.js';

export interface Reasoner {
  bind(scope: InferenceScope): Promise<InferenceBinding>;
  respond(input: OutputItem[], instructions: string, tools: OutputItem[], signal?: AbortSignal,
    onTextDelta?: (delta: string) => void, binding?: InferenceBinding): Promise<CompletedTurn>;
}

/** One explicitly bound application user, one app-specific OAuth account; no shared fallback. */
export class PlanReasoner implements Reasoner {
  private busy = false;
  constructor(private store: PlanStore, private ownerId: string,
    private request = requestSolHigh, private refresh = refreshCredential) {}
  async available() {
    try { await this.ownerBinding(); return true; } catch { return false; }
  }
  private account(state: PlanState): PlanCredential {
    const bound = state.nancyBinding;
    const account = bound && state.accounts[bound.accountKey];
    if (!bound || bound.actorId !== this.ownerId || bound.hostId !== state.hostId || !account?.refreshToken
      || accountKey(account) !== bound.accountKey)
      throw new ApiError(503, 'reasoning_binding_unavailable', 'Nancy’s account connection needs review. You can use the buttons.');
    return account;
  }
  private async ownerBinding(): Promise<NonNullable<PlanState['nancyBinding']>> {
    let state = await this.store.load();
    if (!state.nancyBinding) {
      // Adopt the already-authorized owner connection once. All later calls and
      // refreshes resolve by this binding, never by the setup helper's activeKey.
      const unlock = await this.store.lock();
      try {
        state = await this.store.load();
        if (!state.nancyBinding) {
          const account = state.activeKey && state.accounts[state.activeKey];
          if (!account || !account.refreshToken || accountKey(account) !== state.activeKey)
            throw new ApiError(503, 'reasoning_unavailable', 'Connect Nancy’s owner practice account locally.');
          state.nancyBinding = { actorId: this.ownerId, accountKey: accountKey(account), hostId: state.hostId, bindingId: randomUUID() };
          await this.store.save(state);
        }
      } finally { await unlock(); }
    }
    this.account(state);
    return state.nancyBinding!;
  }
  async bind(scope: InferenceScope): Promise<InferenceBinding> {
    if (scope.actor_id !== this.ownerId)
      throw new ApiError(403, 'reasoning_not_linked', 'Nancy’s reasoning connection is not qualified for this sign-in. You can use the buttons.');
    const bound = await this.ownerBinding();
    return Object.freeze({ ...scope, route_id: 'chatgpt_plan_owner_practice', account_binding_id: bound.bindingId, qualification: 'owner_practice' });
  }
  private assertBinding(state: PlanState, binding: InferenceBinding | undefined) {
    if (!binding || binding.actor_id !== this.ownerId || binding.route_id !== 'chatgpt_plan_owner_practice'
      || binding.qualification !== 'owner_practice' || binding.account_binding_id !== state.nancyBinding?.bindingId)
      throw new ApiError(403, 'reasoning_binding_changed', 'This conversation’s account connection changed. Start a new conversation.');
    return this.account(state);
  }
  async respond(input: OutputItem[], instructions: string, tools: OutputItem[], signal?: AbortSignal,
    onTextDelta?: (delta: string) => void, binding?: InferenceBinding) {
    signal?.throwIfAborted();
    if (this.busy) throw new ApiError(409, 'reasoning_busy', 'Nancy is finishing another response. Please try again in a moment.');
    this.busy = true;
    let completed: CompletedTurn | undefined;
    try {
      let state = await this.store.load();
      let account = this.assertBinding(state, binding);
      if (account.expiresAt - Date.now() < 60000) {
        // The setup helper and runtime may read concurrently, but only one can rotate credentials.
        const unlock = await this.store.lock().catch(() => { throw new ApiError(503, 'connection_setup_open', 'Close the local ChatGPT setup helper so Nancy can renew this connection.'); });
        try {
          state = await this.store.load(); account = this.assertBinding(state, binding);
          if (account.expiresAt - Date.now() < 60000) {
            const refreshed = await this.refresh(account);
            if (accountKey(refreshed) !== state.nancyBinding!.accountKey)
              throw new ApiError(403, 'reasoning_binding_changed', 'Nancy’s refreshed account does not match this conversation.');
            account = refreshed;
            state.accounts[state.nancyBinding!.accountKey] = account; await this.store.save(state);
          }
        } finally { await unlock(); }
      }
      signal?.throwIfAborted();
      this.assertBinding(await this.store.load(), binding);
      const result = await this.request(account, input, { instructions, tools, tool_choice: 'auto' }, fetch, { textDelta: onTextDelta }, signal);
      completed = result;
      signal?.throwIfAborted();
      this.assertBinding(await this.store.load(), binding);
      return result;
    } catch (error) {
      // Consumption remains factual even when access changes before delivery.
      if (completed?.usage && error && typeof error === 'object') attachInferenceUsage(error, completed.usage);
      if (error instanceof ApiError) throw error;
      if (signal?.aborted) throw error;
      const mapped = error instanceof PlanRequestError && error.code.includes('usage_limit')
        ? new ApiError(429, 'reasoning_limit', 'The ChatGPT plan usage limit was reached. You can continue using the buttons.')
        : new ApiError(503, 'reasoning_unavailable', 'Nancy could not complete the selected Sol-high response. Check the plan before trying again; touch is available.');
      throw attachInferenceUsage(mapped, inferenceUsageFromError(error));
    } finally { this.busy = false; }
  }
}
