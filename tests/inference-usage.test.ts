import { describe, expect, it, vi } from 'vitest';
import { attachInferenceUsage, inferenceUsageFromError, requestSolHigh, sumInferenceUsage } from '../src/server/chatgpt-plan/inference.js';
import type { PlanCredential } from '../src/server/chatgpt-plan/storage.js';

const credential: PlanCredential = { issuer: 'https://auth.openai.com', subject: 'fixture-subject', clientId: 'oaiapp_fixture',
  idToken: 'fixture-id', accessToken: 'fixture-access', refreshToken: 'fixture-refresh', scopes: ['chatgpt.tokens.use.direct'], expiresAt: 1 };
const unknownUsage = { inputTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null, reasoningOutputTokens: null };
function stream(usage?: unknown, terminal = 'response.completed', model = 'gpt-6-sol') {
  return new Response(`data: ${JSON.stringify({ type: terminal, response: { status: terminal.slice('response.'.length), model,
    output: [], usage, error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'private provider detail' } } })}\n\n`,
  { headers: { 'Content-Type': 'text/event-stream' } });
}
const input = [{ role: 'user', content: 'Synthetic usage check.' }];

describe('provider-reported inference usage', () => {
  it('retains exact numeric totals and nested cache/reasoning counts from validated completion', async () => {
    const completed = vi.fn();
    const result = await requestSolHigh(credential, input, {}, vi.fn(async () => stream({ input_tokens: 120, output_tokens: 75,
      total_tokens: 195, input_tokens_details: { cached_tokens: 100 }, output_tokens_details: { reasoning_tokens: 50 } })), { completed });
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 75, totalTokens: 195, cachedInputTokens: 100, reasoningOutputTokens: 50 });
    expect(completed).toHaveBeenCalledExactlyOnceWith(expect.any(Number), result.usage);
  });

  it('keeps missing usage explicitly unknown and does not infer total tokens from known components', async () => {
    const missing = await requestSolHigh(credential, input, {}, vi.fn(async () => stream()));
    expect(missing.usage).toEqual(unknownUsage);
    expect(JSON.parse(JSON.stringify(missing.usage))).toEqual(unknownUsage);
    const partial = await requestSolHigh(credential, input, {}, vi.fn(async () => stream({ input_tokens: 120, output_tokens: 0 })));
    expect(partial.usage).toEqual({ ...unknownUsage, inputTokens: 120, outputTokens: 0 });
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '125', true, [], {}, null])('does not coerce malformed count %j', async value => {
    const result = await requestSolHigh(credential, input, {}, vi.fn(async () => stream({ input_tokens: value, output_tokens: value,
      total_tokens: value, input_tokens_details: { cached_tokens: value }, output_tokens_details: { reasoning_tokens: value } })));
    expect(result.usage).toEqual(unknownUsage);
  });

  it('accepts actual zero observations but not absent or malformed breakdown objects', async () => {
    const result = await requestSolHigh(credential, input, {}, vi.fn(async () => stream({ input_tokens: 0, output_tokens: 0, total_tokens: 0,
      input_tokens_details: 'cached_tokens: 0', output_tokens_details: [] })));
    expect(result.usage).toEqual({ ...unknownUsage, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

  it.each(['response.failed', 'response.incomplete'])('keeps supplied %s usage without claiming completion', async terminal => {
    const completed = vi.fn();
    const error = await requestSolHigh(credential, input, {}, vi.fn(async () => stream({ input_tokens: 20, output_tokens: 7,
      output_tokens_details: { reasoning_tokens: 7 } }, terminal)), { completed }).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(completed).not.toHaveBeenCalled();
    expect(inferenceUsageFromError(error)).toEqual({ ...unknownUsage, inputTokens: 20, outputTokens: 7, reasoningOutputTokens: 7 });
    expect(JSON.stringify(error)).not.toContain('private provider detail');
  });

  it('does not claim completed usage after transport abort, wrong model or truncated stream', async () => {
    const completed = vi.fn();
    const fetchers = [vi.fn(async () => { throw new DOMException('Synthetic abort', 'AbortError'); }),
      vi.fn(async () => stream({ input_tokens: 20 }, 'response.completed', 'another-model')),
      vi.fn(async () => new Response('data: {"type":"response.output_text.delta","delta":"Partial"}\n\n'))];
    for (const fetcher of fetchers) {
      const error = await requestSolHigh(credential, input, {}, fetcher, { completed }).catch(error => error);
      expect(error).toBeInstanceOf(Error);
      expect(inferenceUsageFromError(error)).toEqual(unknownUsage);
    }
    expect(completed).not.toHaveBeenCalled();
  });

  it('sums only fully observed fields across tool rounds and includes unknown failed calls', () => {
    const first = { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 0, reasoningOutputTokens: 10 };
    const second = { inputTokens: 150, outputTokens: 40, totalTokens: 190, cachedInputTokens: 100, reasoningOutputTokens: 20 };
    expect(sumInferenceUsage([first, second])).toEqual({ inputTokens: 250, outputTokens: 60, totalTokens: 310, cachedInputTokens: 100, reasoningOutputTokens: 30 });
    expect(sumInferenceUsage([first, { ...second, cachedInputTokens: undefined }])).toEqual({ inputTokens: 250, outputTokens: 60,
      totalTokens: 310, cachedInputTokens: null, reasoningOutputTokens: 30 });
    expect(sumInferenceUsage([first, undefined])).toEqual(unknownUsage);
    expect(sumInferenceUsage([])).toEqual(unknownUsage);
    expect(sumInferenceUsage([{ inputTokens: Number.MAX_SAFE_INTEGER }, { inputTokens: 1 }]).inputTokens).toBeNull();
  });

  it('preserves only safe counts across mapped errors without serializing provider details', () => {
    const original = attachInferenceUsage(new Error('private provider error'), { inputTokens: 25, outputTokens: Number.NaN });
    const mapped = attachInferenceUsage(new Error('Reasoning unavailable.'), inferenceUsageFromError(original));
    expect(inferenceUsageFromError(mapped)).toEqual({ ...unknownUsage, inputTokens: 25 });
    const mutableCopy = inferenceUsageFromError(mapped); mutableCopy.inputTokens = 0;
    expect(inferenceUsageFromError(mapped).inputTokens).toBe(25);
    expect(JSON.stringify(mapped)).toBe('{}');
    expect(inferenceUsageFromError({ usage: { inputTokens: 999 } })).toEqual(unknownUsage);
  });
});
