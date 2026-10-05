import { describe, expect, it, vi } from 'vitest';
import { probeSolHighTools } from '../src/server/chatgpt-plan/inference.js';
import type { PlanCredential } from '../src/server/chatgpt-plan/storage.js';

const credential: PlanCredential = { issuer: 'https://auth.openai.com', subject: 'fixture-subject', clientId: 'oaiapp_fixture',
  idToken: 'fake-id', accessToken: 'fake-access', refreshToken: 'fake-refresh', scopes: ['chatgpt.tokens.use.direct'], expiresAt: Date.now() + 3600_000 };
const call = { type: 'function_call', name: 'get_probe_value', namespace: 'nancy_probe', call_id: 'call_fixture',
  arguments: JSON.stringify({ target_id: 'synthetic-target-1' }), status: 'completed' };
const reasoning = { type: 'reasoning', id: 'rs_fixture', summary: [], encrypted_content: 'opaque-fixture' };
function stream(output: unknown[], text = '', terminal = 'response.completed'): Response {
  return new Response(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\n` +
    `data: ${JSON.stringify({ type: terminal, response: { status: 'completed', model: 'gpt-6-sol', output, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } })}\n\n`,
  { headers: { 'Content-Type': 'text/event-stream' } });
}
describe('subscription tool transport qualification', () => {
  it('uses an exact namespace/target and replays all response items before verifying the tool output in a second completion', async () => {
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.openai.com/v1/responses');
      expect(init.headers).toMatchObject({ Authorization: 'Bearer fake-access' });
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ model: 'gpt-6-sol', reasoning: { effort: 'high' }, store: false, stream: true });
      expect(body.previous_response_id).toBeUndefined();
      expect(body.max_output_tokens).toBeUndefined();
      expect(body.tools[0]).toMatchObject({ type: 'namespace', name: 'nancy_probe', tools: [{ type: 'function', name: 'get_probe_value', strict: true }] });
      if (fetcher.mock.calls.length === 1) {
        expect(body.tool_choice).toBe('required');
        expect(JSON.stringify(body.input)).not.toContain('nancy-fixture-');
        return stream([reasoning, call]);
      }
      expect(body.tool_choice).toBe('none');
      expect(body.input.slice(1, 3)).toEqual([reasoning, call]);
      expect(body.input[3]).toMatchObject({ type: 'function_call_output', call_id: 'call_fixture' });
      const token = JSON.parse(body.input[3].output).verification_token;
      expect(token).toMatch(/^nancy-fixture-[0-9a-f]{32}$/);
      return stream([{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: token }] }], token);
    });
    expect(await probeSolHighTools(credential, fetcher as unknown as typeof fetch)).toMatchObject({ toolRoundTrip: true, requests: 2,
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 }, text: 'Synthetic tool round trip verified.' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['another namespace', [{ ...call, namespace: 'care' }]],
    ['an unknown function', [{ ...call, name: 'run_shell' }]],
    ['a different target', [{ ...call, arguments: '{"target_id":"real-person"}' }]],
    ['extra arguments', [{ ...call, arguments: '{"target_id":"synthetic-target-1","command":"write"}' }]],
    ['malformed arguments', [{ ...call, arguments: '{' }]],
    ['duplicate calls', [call, call]],
    ['missing calls', [reasoning]],
    ['another tool type', [call, { type: 'custom_tool_call' }]],
    ['incomplete function', [{ ...call, status: 'incomplete' }]],
  ])('rejects %s before returning any local fixture result', async (_name, output) => {
    const fetcher = vi.fn(async () => stream(output));
    await expect(probeSolHighTools(credential, fetcher as unknown as typeof fetch)).rejects.toThrow('not authorized');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not accept invented final text, incomplete responses or another tool call as success', async () => {
    for (const second of [stream([{ type: 'message' }], 'invented'), stream([], '', 'response.incomplete'), stream([call])]) {
      const fetcher = vi.fn().mockResolvedValueOnce(stream([call])).mockResolvedValueOnce(second);
      await expect(probeSolHighTools(credential, fetcher as typeof fetch)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });
  it('does not fall back or retry when plan allowance refuses the second request', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(stream([call])).mockResolvedValueOnce(new Response(
      JSON.stringify({ error: { code: 'subscription_sharing_usage_limit_exceeded' } }), { status: 429 }));
    await expect(probeSolHighTools(credential, fetcher as typeof fetch)).rejects.toMatchObject({ status: 429, code: 'subscription_sharing_usage_limit_exceeded' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('requires the token in the authoritative completed message, not just a stream delta', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      if (fetcher.mock.calls.length === 1) return stream([call]);
      const body = JSON.parse(String(init.body));
      return stream([{ type: 'message', role: 'assistant', status: 'completed', content: [] }], JSON.parse(body.input.at(-1).output).verification_token);
    });
    await expect(probeSolHighTools(credential, fetcher as unknown as typeof fetch)).rejects.toThrow('not verified');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('reconstructs finalized items when the plan terminal event omits aggregated output', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const items = fetcher.mock.calls.length === 1 ? [reasoning, call] : [{ type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.parse(body.input.at(-1).output).verification_token }] }];
      if (fetcher.mock.calls.length === 2) expect(body.input.slice(1, 3)).toEqual([reasoning, call]);
      const events = items.map((item, index) => ({ type: 'response.output_item.done', output_index: index, item }));
      return new Response([...events, { type: 'response.completed', response: { status: 'completed', model: 'gpt-6-sol', output: [] } }]
        .map(item => `data: ${JSON.stringify(item)}\n\n`).join(''));
    });
    expect(await probeSolHighTools(credential, fetcher as unknown as typeof fetch)).toMatchObject({ toolRoundTrip: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
