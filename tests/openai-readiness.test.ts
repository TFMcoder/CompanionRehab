import { describe, expect, it, vi } from 'vitest';
import { checkOpenAI } from '../scripts/check-openai.js';

describe('OpenAI private setup check', () => {
  it('makes no request without a key or explicit connection check', async () => {
    const fetcher = vi.fn();
    expect((await checkOpenAI({ fetcher })).status).toBe('missing_key');
    expect((await checkOpenAI({ key: 'synthetic-test-key', fetcher })).status).toBe('configured_not_checked');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('checks only the selected model and keeps visibility separate from inference and speech', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 'gpt-6-sol' })));
    const result = await checkOpenAI({ key: 'synthetic-test-key', connect: true, fetcher });
    expect(fetcher).toHaveBeenCalledWith('https://api.openai.com/v1/models/gpt-6-sol', expect.objectContaining({
      redirect: 'error', headers: { Authorization: 'Bearer synthetic-test-key' },
    }));
    expect(result).toMatchObject({ status: 'model_visible', reasoning_effort: 'high', inference_tested: false, speech_tested: false });
    expect(JSON.stringify(result)).not.toContain('synthetic-test-key');
  });

  it('does not expose provider error payloads or transport exception details', async () => {
    const key = 'synthetic-test-secret';
    const denied = await checkOpenAI({ key, connect: true, fetcher: vi.fn(async () => new Response(key, { status: 403 })) });
    const failed = await checkOpenAI({ key, connect: true, fetcher: vi.fn(async () => { throw new Error(key); }) });
    expect(denied.status).toBe('permission_denied');
    expect(failed.status).toBe('connection_failed');
    expect(JSON.stringify([denied, failed])).not.toContain(key);
  });

  it('does not treat a successful HTTP response with the wrong model as access confirmation', async () => {
    const result = await checkOpenAI({ key: 'synthetic-test-key', connect: true,
      fetcher: vi.fn(async () => new Response(JSON.stringify({ id: 'some-other-model' }))),
    });
    expect(result.status).toBe('unexpected_response');
  });
});
