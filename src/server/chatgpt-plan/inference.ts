import { parseTokens, requiredScope, resource, tokenEndpoint, validateIdToken } from './oauth.js';
import type { PlanCredential } from './storage.js';

export const selectedModel = 'gpt-6-sol';
export const selectedEffort = 'high';
const responsesEndpoint = `${resource}/responses`;

export class PlanRequestError extends Error {
  constructor(readonly status: number, readonly code: string, readonly requestId?: string) {
    super(`ChatGPT plan request failed: ${code} (HTTP ${status}).`);
  }
}
export async function refreshCredential(account: PlanCredential, fetcher: typeof fetch = fetch): Promise<PlanCredential> {
  const response = await fetcher(tokenEndpoint, {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: account.clientId, refresh_token: account.refreshToken, resource }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    let code = 'refresh_failed';
    try { const body = await response.json() as { error?: string }; if (['invalid_grant', 'invalid_client', 'invalid_refresh_token', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'].includes(body.error || '')) code = body.error!; } catch { /* diagnostic stays bounded */ }
    throw new PlanRequestError(response.status, code);
  }
  const tokens = parseTokens(await response.json());
  const identity = await validateIdToken(tokens.id_token, account.clientId, undefined, fetcher);
  if (identity.subject !== account.subject) throw new Error('Refreshed ChatGPT identity changed. Sign in again.');
  const scopes = tokens.scope.split(/\s+/).filter(Boolean);
  return { ...account, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, idToken: tokens.id_token,
    expiresAt: Date.now() + tokens.expires_in * 1000, scopes };
}

export interface ProbeResult { completed: true; model: typeof selectedModel; effort: typeof selectedEffort;
  text: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }; requestId?: string }
function responseError(payload: unknown, status: number, requestId?: string): PlanRequestError {
  const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const nested = data.error && typeof data.error === 'object' ? data.error as Record<string, unknown> : {};
  const known = new Set(['subscription_sharing_user_not_eligible', 'subscription_sharing_usage_limit_exceeded',
    'subscription_sharing_usage_unavailable', 'subscription_sharing_unsupported_capability',
    'subscription_sharing_route_not_supported', 'subscription_sharing_invalid_user',
    'subscription_sharing_user_unavailable', 'chatpass_v2_scope_not_authorized',
    'chatpass_v2_invalid_authorization_context']);
  const code = typeof nested.code === 'string' && known.has(nested.code) ? nested.code : `http_${status}`;
  return new PlanRequestError(status, code, requestId);
}
export async function probeSolHigh(account: PlanCredential, fetcher: typeof fetch = fetch): Promise<ProbeResult> {
  if (!account.scopes.includes(requiredScope)) throw new Error('ChatGPT plan use was not granted for this connection.');
  const response = await fetcher(responsesEndpoint, {
    method: 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: selectedModel, reasoning: { effort: selectedEffort },
      input: [{ role: 'user', content: 'This is a synthetic connection test. Reply with exactly READY.' }],
      store: false, stream: true }),
    signal: AbortSignal.timeout(45000),
  });
  const requestId = response.headers.get('x-request-id') || undefined;
  if (!response.ok) {
    let payload: unknown;
    try { payload = await response.json(); } catch { /* some admission errors are not JSON */ }
    throw responseError(payload, response.status, requestId);
  }
  if (!response.body) throw new Error('ChatGPT returned no response stream.');
  let text = '', completed: ProbeResult | undefined, bytes = 0, pending = '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1_000_000) throw new Error('ChatGPT response stream exceeded the probe limit.');
      pending += decoder.decode(chunk.value, { stream: true });
      pending = pending.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        const event = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
        const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data || data === '[DONE]') continue;
        let item: Record<string, unknown>;
        try { item = JSON.parse(data) as Record<string, unknown>; } catch { throw new Error('Invalid ChatGPT response stream.'); }
        if (item.type === 'response.output_text.delta' && typeof item.delta === 'string') text = (text + item.delta).slice(0, 2000);
        if (item.type === 'response.failed' || item.type === 'error') {
          const detail = item.response && typeof item.response === 'object' ? item.response as Record<string, unknown> : {};
          throw responseError(item.type === 'error' ? item : detail, 0, requestId);
        }
        if (item.type === 'response.incomplete') throw new Error('ChatGPT response was incomplete.');
        if (item.type === 'response.completed') {
          const result = item.response && typeof item.response === 'object' ? item.response as Record<string, unknown> : {};
          if (result.status !== 'completed' || result.model !== selectedModel) throw new Error('ChatGPT completed with a different model or status.');
          const rawUsage = result.usage && typeof result.usage === 'object' ? result.usage as Record<string, unknown> : {};
          const token = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
          const usage = { inputTokens: token(rawUsage.input_tokens), outputTokens: token(rawUsage.output_tokens), totalTokens: token(rawUsage.total_tokens) };
          completed = { completed: true, model: selectedModel, effort: selectedEffort, text, usage, requestId };
          break;
        }
      }
      if (completed) break;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!completed) throw new Error('ChatGPT stream ended without response.completed.');
  return completed;
}
