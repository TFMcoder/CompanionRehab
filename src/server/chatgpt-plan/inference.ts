import { randomBytes } from 'node:crypto';
import { parseTokens, requiredScope, resource, tokenEndpoint, validateIdToken } from './oauth.js';
import type { PlanCredential } from './storage.js';

export const selectedModel = 'gpt-6-sol';
export const selectedEffort = 'high';
const responsesEndpoint = `${resource}/responses`;

export class PlanRequestError extends Error {
  constructor(readonly status: number, readonly code: string, readonly requestId?: string,
    readonly diagnostic?: { providerCode: string | null; providerType: string | null }) {
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

/** Provider-reported token counts. Missing values stay unknown, including absent breakdowns. */
export interface InferenceUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  cachedInputTokens?: number | null;
  reasoningOutputTokens?: number | null;
}
const usageKeys = ['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens', 'reasoningOutputTokens'] as const;
const tokenCount = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const errorUsage = new WeakMap<object, InferenceUsage>();

/** Preserve safe counts when an adapter maps errors; no provider payload/text is attached. */
export function attachInferenceUsage<T extends object>(error: T, usage: InferenceUsage | undefined): T {
  errorUsage.set(error, sumInferenceUsage([usage]));
  return error;
}
export function inferenceUsageFromError(error: unknown): InferenceUsage {
  return sumInferenceUsage([error && typeof error === 'object' ? errorUsage.get(error) : undefined]);
}

function readUsage(value: unknown): InferenceUsage {
  const raw = record(value);
  return { inputTokens: tokenCount(raw.input_tokens), outputTokens: tokenCount(raw.output_tokens), totalTokens: tokenCount(raw.total_tokens),
    cachedInputTokens: tokenCount(record(raw.input_tokens_details).cached_tokens),
    reasoningOutputTokens: tokenCount(record(raw.output_tokens_details).reasoning_tokens) };
}

/** Sum only complete observations for a field. Callers include failures/aborts as unknown, not zero. */
export function sumInferenceUsage(usages: readonly (InferenceUsage | undefined)[]): InferenceUsage {
  const total: InferenceUsage = {};
  for (const key of usageKeys) {
    let sum: number | null = usages.length ? 0 : null;
    for (const usage of usages) {
      const value = tokenCount(usage?.[key]);
      if (value === null || sum === null || !Number.isSafeInteger(sum + value)) { sum = null; break; }
      sum += value;
    }
    total[key] = sum;
  }
  return total;
}

export interface ProbeResult { completed: true; model: typeof selectedModel; effort: typeof selectedEffort;
  text: string; usage?: InferenceUsage; requestId?: string }
function responseError(payload: unknown, status: number, requestId?: string): PlanRequestError {
  const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const nested = data.error && typeof data.error === 'object' ? data.error as Record<string, unknown> : data;
  const known = new Set(['subscription_sharing_user_not_eligible', 'subscription_sharing_usage_limit_exceeded',
    'subscription_sharing_usage_unavailable', 'subscription_sharing_unsupported_capability',
    'subscription_sharing_route_not_supported', 'subscription_sharing_invalid_user',
    'subscription_sharing_user_unavailable', 'chatpass_v2_scope_not_authorized',
    'chatpass_v2_invalid_authorization_context']);
  const code = typeof nested.code === 'string' && known.has(nested.code) ? nested.code : `http_${status}`;
  const label = (value: unknown) => typeof value === 'string' && /^[a-z][a-z0-9_]{0,100}$/.test(value) ? value : null;
  return new PlanRequestError(status, code, requestId, { providerCode: label(nested.code), providerType: label(nested.type) });
}
export type OutputItem = Record<string, unknown>;
export interface CompletedTurn extends ProbeResult { output: OutputItem[] }
export interface SolHighTimingSample {
  promptId: 'morning' | 'meal_choice' | 'task_carryover';
  status: 'completed' | 'failed' | 'not_run';
  firstTextDeltaMs?: number;
  firstSpeakableMs?: number;
  completedMs?: number;
  usage?: ProbeResult['usage'];
  error?: { status?: number; code: string };
}
export interface SolHighTimingProbeResult {
  completed: boolean;
  model: typeof selectedModel;
  effort: typeof selectedEffort;
  samples: SolHighTimingSample[];
}
interface StreamTimingObserver {
  /** Tentative assistant text only; callers must wait for the validated final turn before publishing it. */
  textDelta?: (delta: string) => void;
  firstTextDelta?: (elapsedMs: number) => void;
  firstSpeakable?: (elapsedMs: number) => void;
  completed?: (elapsedMs: number, usage: ProbeResult['usage']) => void;
}
export async function requestSolHigh(account: PlanCredential, input: OutputItem[],
  options: { tools?: OutputItem[]; tool_choice?: 'required' | 'none' | 'auto'; instructions?: string } = {}, fetcher: typeof fetch = fetch,
  timing?: StreamTimingObserver, signal?: AbortSignal): Promise<CompletedTurn> {
  if (!account.scopes.includes(requiredScope)) throw new Error('ChatGPT plan use was not granted for this connection.');
  const started = performance.now();
  let observedText = '';
  let firstDeltaSeen = false;
  let firstSpeakableSeen = false;
  const findSpeakableBoundary = () => /[.!?]["'”’)]*(?:\s|$)/u.test(observedText.trimEnd());
  const response = await fetcher(responsesEndpoint, {
    method: 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: selectedModel, reasoning: { effort: selectedEffort },
      input, ...options,
      store: false, stream: true }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000),
  });
  const requestId = response.headers.get('x-request-id') || undefined;
  if (!response.ok) {
    let payload: unknown;
    try { payload = await response.json(); } catch { /* some admission errors are not JSON */ }
    throw responseError(payload, response.status, requestId);
  }
  if (!response.body) throw new Error('ChatGPT returned no response stream.');
  let text = '', completed: CompletedTurn | undefined, bytes = 0, pending = '';
  const finalizedItems = new Map<number, OutputItem>();
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
        if (item.type === 'response.output_text.delta' && typeof item.delta === 'string') {
          text = (text + item.delta).slice(0, 2000);
          if (!signal?.aborted) timing?.textDelta?.(item.delta);
          if (timing && item.delta.length > 0) {
            observedText = (observedText + item.delta).slice(-2000);
            if (!firstDeltaSeen) { firstDeltaSeen = true; timing.firstTextDelta?.(performance.now() - started); }
            // A sentence boundary is the earliest conservative unit suitable for speech.
            if (!firstSpeakableSeen && observedText.trim().length >= 8 && findSpeakableBoundary()) {
              firstSpeakableSeen = true; timing.firstSpeakable?.(performance.now() - started);
            }
          }
        }
        if (item.type === 'response.output_item.done') {
          const index = item.output_index;
          if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 100 || finalizedItems.has(index) ||
            !item.item || typeof item.item !== 'object' || Array.isArray(item.item)) throw new Error('Invalid ChatGPT response items.');
          finalizedItems.set(index, item.item as OutputItem);
        }
        if (item.type === 'response.failed' || item.type === 'error') {
          const detail = item.response && typeof item.response === 'object' ? item.response as Record<string, unknown> : {};
          throw attachInferenceUsage(responseError(item.type === 'error' ? item : detail, 0, requestId), readUsage(detail.usage));
        }
        if (item.type === 'response.incomplete') throw attachInferenceUsage(new Error('ChatGPT response was incomplete.'), readUsage(record(item.response).usage));
        if (item.type === 'response.completed') {
          const result = item.response && typeof item.response === 'object' ? item.response as Record<string, unknown> : {};
          if (result.status !== 'completed' || result.model !== selectedModel) throw new Error('ChatGPT completed with a different model or status.');
          const usage = readUsage(result.usage);
          // The plan stream can omit aggregated output at the terminal event.
          // Only completed item events are eligible for stateless continuation.
          const indexes = [...finalizedItems.keys()].sort((a, b) => a - b);
          if (indexes.some((index, position) => index !== position)) throw new Error('Invalid ChatGPT response items.');
          const output = Array.isArray(result.output) && result.output.length ? result.output : indexes.map(index => finalizedItems.get(index)!);
          if (output.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('Invalid ChatGPT response items.');
          if (timing && !firstSpeakableSeen && observedText.trim().length >= 8 && /[.!?]["'”’)]*$/u.test(observedText.trim())) {
            firstSpeakableSeen = true; timing.firstSpeakable?.(performance.now() - started);
          }
          timing?.completed?.(performance.now() - started, usage);
          completed = { completed: true, model: selectedModel, effort: selectedEffort, text, usage, requestId, output };
          break;
        }
      }
      if (completed) break;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!completed) throw new Error('ChatGPT stream ended without response.completed.');
  return completed;
}

const timingPrompts = [
  { id: 'morning', text: 'Synthetic latency benchmark. In one short, speakable sentence, greet Nancy’s listener and ask whether they want to plan breakfast or tasks.' },
  { id: 'meal_choice', text: 'Synthetic latency benchmark. In one short, speakable sentence, offer a choice between toast and yogurt for breakfast.' },
  { id: 'task_carryover', text: 'Synthetic latency benchmark. In one short, speakable sentence, gently ask whether the listener wants to revisit one unfinished task.' },
] as const;

/** Three fixed synthetic requests through the existing app-authenticated Sol/high route. */
export async function probeSolHighFirstSpeakable(account: PlanCredential, fetcher: typeof fetch = fetch): Promise<SolHighTimingProbeResult> {
  const samples: SolHighTimingSample[] = [];
  for (let index = 0; index < timingPrompts.length; index++) {
    const prompt = timingPrompts[index]!;
    const sample: SolHighTimingSample = { promptId: prompt.id, status: 'failed' };
    try {
      const turn = await requestSolHigh(account, [{ role: 'user', content: prompt.text }], {}, fetcher, {
        firstTextDelta: elapsedMs => { sample.firstTextDeltaMs = Number(elapsedMs.toFixed(1)); },
        firstSpeakable: elapsedMs => { sample.firstSpeakableMs = Number(elapsedMs.toFixed(1)); },
        completed: (elapsedMs, usage) => { sample.completedMs = Number(elapsedMs.toFixed(1)); sample.usage = usage; },
      });
      sample.status = 'completed';
      samples.push(sample);
      if (!turn.completed) break;
    } catch (error) {
      sample.error = error instanceof PlanRequestError
        ? { status: error.status, code: error.code }
        : { code: error instanceof Error && error.message === 'ChatGPT response was incomplete.' ? 'incomplete' : 'request_failed' };
      samples.push(sample);
      for (const remaining of timingPrompts.slice(index + 1)) samples.push({ promptId: remaining.id, status: 'not_run' });
      break;
    }
  }
  return { completed: samples.length === timingPrompts.length && samples.every(sample => sample.status === 'completed'),
    model: selectedModel, effort: selectedEffort, samples };
}

export async function probeSolHigh(account: PlanCredential, fetcher: typeof fetch = fetch): Promise<ProbeResult> {
  const { output: _output, ...result } = await requestSolHigh(account,
    [{ role: 'user', content: 'This is a synthetic connection test. Reply with exactly READY.' }], {}, fetcher);
  return result;
}

export interface ToolProbeResult extends ProbeResult { toolRoundTrip: true; requests: 2 }
export class ToolProbeError extends Error {
  constructor(readonly diagnostic: { itemSummaries: Record<string, unknown>[]; usage: ProbeResult['usage'] }) {
    super('Synthetic tool call was not authorized.');
  }
}
/** A fixed, read-only fixture. This is transport qualification, not a care-command dispatcher. */
export async function probeSolHighTools(account: PlanCredential, fetcher: typeof fetch = fetch): Promise<ToolProbeResult> {
  const input: OutputItem[] = [{ role: 'user', content: 'Synthetic connection test: call nancy_probe.get_probe_value once for target_id synthetic-target-1. After receiving the result, reply with exactly its verification_token value.' }];
  const tools: OutputItem[] = [{ type: 'namespace', name: 'nancy_probe', description: 'Read-only synthetic connection fixture. No care records.',
    tools: [{ type: 'function', name: 'get_probe_value', description: 'Read the synthetic fixture verification token.', strict: true,
      parameters: { type: 'object', properties: { target_id: { type: 'string', enum: ['synthetic-target-1'] } }, required: ['target_id'], additionalProperties: false } }] }];
  const first = await requestSolHigh(account, input, { tools, tool_choice: 'required' }, fetcher);
  // Fail closed on every unexpected item/call before evaluating the only local fixture.
  const calls = first.output.filter(item => item.type === 'function_call');
  const call = calls[0];
  if (calls.length !== 1 || first.output.some(item => !['reasoning', 'message', 'function_call'].includes(String(item.type))) ||
    call.namespace !== 'nancy_probe' || call.name !== 'get_probe_value' ||
    typeof call.call_id !== 'string' || !call.call_id || call.call_id.length > 256 ||
    (call.status !== undefined && call.status !== 'completed') || typeof call.arguments !== 'string') {
    const label = (value: unknown) => typeof value === 'string' && /^[\w.-]{1,100}$/.test(value) ? value : null;
    throw new ToolProbeError({ itemSummaries: first.output.map(item => ({ type: label(item.type), namespace: label(item.namespace),
      name: label(item.name), status: label(item.status), hasCallId: typeof item.call_id === 'string', hasArguments: typeof item.arguments === 'string' })), usage: first.usage });
  }
  let args: unknown;
  try { args = JSON.parse(call.arguments); } catch { throw new Error('Synthetic tool call was not authorized.'); }
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== 1 ||
    (args as Record<string, unknown>).target_id !== 'synthetic-target-1') throw new Error('Synthetic tool call was not authorized.');
  const verificationToken = `nancy-fixture-${randomBytes(16).toString('hex')}`;
  // Replay all output items, including encrypted reasoning, for stateless HTTP continuation.
  const second = await requestSolHigh(account, [...input, ...first.output,
    { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ verification_token: verificationToken }) }],
    { tools, tool_choice: 'none' }, fetcher);
  const finalText = second.output.filter(item => item.type === 'message' && item.role === 'assistant' && item.status === 'completed')
    .flatMap(item => Array.isArray(item.content) ? item.content : [])
    .filter(item => item && item.type === 'output_text' && typeof item.text === 'string').map(item => item.text).join('');
  if (second.output.some(item => !['reasoning', 'message'].includes(String(item.type))) || finalText.trim() !== verificationToken) {
    throw new Error('Synthetic tool result was not verified.');
  }
  return { completed: true, model: selectedModel, effort: selectedEffort, text: 'Synthetic tool round trip verified.', toolRoundTrip: true, requests: 2,
    usage: sumInferenceUsage([first.usage, second.usage]), requestId: second.requestId };
}
