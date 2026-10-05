import { ApiError } from './errors.js';
import { PlanStore, accountKey } from './chatgpt-plan/storage.js';
import { requestSolHigh, refreshCredential, PlanRequestError, type OutputItem, type CompletedTurn } from './chatgpt-plan/inference.js';

export interface Reasoner { respond(input: OutputItem[], instructions: string, tools: OutputItem[], signal?: AbortSignal): Promise<CompletedTurn> }

/** One explicitly bound application user, one app-specific OAuth account; no shared fallback. */
export class PlanReasoner implements Reasoner {
  private busy = false;
  constructor(private store: PlanStore) {}
  async available() {
    try { const state = await this.store.load(); return !!(state.activeKey && state.accounts[state.activeKey]?.refreshToken); }
    catch { return false; }
  }
  async respond(input: OutputItem[], instructions: string, tools: OutputItem[], signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.busy) throw new ApiError(409, 'reasoning_busy', 'Nancy is finishing another response. Please try again in a moment.');
    this.busy = true;
    try {
      let state = await this.store.load();
      let account = state.activeKey ? state.accounts[state.activeKey] : undefined;
      if (!account?.refreshToken) throw new ApiError(503, 'reasoning_unavailable', 'The selected ChatGPT connection needs to be connected locally. Touch is available.');
      if (account.expiresAt - Date.now() < 60000) {
        // The setup helper and runtime may read concurrently, but only one can rotate credentials.
        const unlock = await this.store.lock().catch(() => { throw new ApiError(503, 'connection_setup_open', 'Close the local ChatGPT setup helper so Nancy can renew this connection.'); });
        try {
          state = await this.store.load(); account = state.activeKey ? state.accounts[state.activeKey] : undefined;
          if (!account?.refreshToken) throw new ApiError(503, 'reasoning_unavailable', 'Connect the selected ChatGPT account locally.');
          if (account.expiresAt - Date.now() < 60000) {
            account = await refreshCredential(account);
            state.accounts[accountKey(account)] = account; await this.store.save(state);
          }
        } finally { await unlock(); }
      }
      signal?.throwIfAborted();
      return await requestSolHigh(account, input, { instructions, tools, tool_choice: 'auto' }, fetch, undefined, signal);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof PlanRequestError && error.code.includes('usage_limit')) throw new ApiError(429, 'reasoning_limit', 'The ChatGPT plan usage limit was reached. You can continue using the buttons.');
      throw new ApiError(503, 'reasoning_unavailable', 'Nancy could not complete the selected Sol-high response. Check the plan before trying again; touch is available.');
    } finally { this.busy = false; }
  }
}
