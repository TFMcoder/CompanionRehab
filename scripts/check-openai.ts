import { pathToFileURL } from 'node:url';
import { loadEnvironment } from '../src/server/config.js';

const model = 'gpt-6-sol';
type Status = 'missing_key' | 'configured_not_checked' | 'model_visible' | 'authentication_failed'
  | 'permission_denied' | 'model_unavailable_or_hidden' | 'rate_limited' | 'provider_unavailable'
  | 'connection_failed' | 'unexpected_response';

export async function checkOpenAI({ key, connect = false, fetcher = fetch }: {
  key?: string; connect?: boolean; fetcher?: typeof fetch;
}) {
  const result = (status: Status, httpStatus?: number) => ({
    model, reasoning_effort: 'high', status,
    ...(httpStatus === undefined ? {} : { http_status: httpStatus }),
    inference_tested: false, speech_tested: false,
    note: 'Model visibility is a read-only check, not proof that inference, billing or speech works. No care data is sent.',
  });
  if (!key?.trim()) return result('missing_key');
  if (!connect) return result('configured_not_checked');
  try {
    const response = await fetcher(`https://api.openai.com/v1/models/${model}`, {
      headers: { Authorization: `Bearer ${key.trim()}` },
      redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const statuses: Record<number, Status> = {
        401: 'authentication_failed', 403: 'permission_denied', 404: 'model_unavailable_or_hidden',
        429: 'rate_limited',
      };
      return result(statuses[response.status] ?? (response.status >= 500 ? 'provider_unavailable' : 'unexpected_response'), response.status);
    }
    const body: unknown = await response.json();
    const visible = typeof body === 'object' && body !== null && 'id' in body && body.id === model;
    return result(visible ? 'model_visible' : 'unexpected_response', response.status);
  } catch {
    // Provider/transport error text can contain request details. Return only a safe status.
    return result('connection_failed');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnvironment();
  const result = await checkOpenAI({ key: process.env.OPENAI_API_KEY, connect: process.argv.includes('--connect') });
  console.log(JSON.stringify(result, null, 2));
  if (!['configured_not_checked', 'model_visible'].includes(result.status)) process.exitCode = 1;
}
