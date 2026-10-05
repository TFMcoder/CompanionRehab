import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync, sign, randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beginAuthorization, jwksEndpoint, readCallback, validateIdToken } from '../src/server/chatgpt-plan/oauth.js';
import { PlanStore, type PlanCredential } from '../src/server/chatgpt-plan/storage.js';
import { PlanRequestError, probeSolHigh } from '../src/server/chatgpt-plan/inference.js';
import { startPlanSetup } from '../src/server/chatgpt-plan/local.js';

const clientId = 'oaiapp_test123';
const credential: PlanCredential = { issuer: 'https://auth.openai.com', subject: 'subject-1', clientId,
  idToken: 'id-secret', accessToken: 'access-secret', refreshToken: 'refresh-secret',
  scopes: ['chatgpt.tokens.use.direct'], expiresAt: Date.now() + 3600_000 };
function mockedResponse(body: unknown, url = ''): Response {
  const response = new Response(JSON.stringify(body), { status: 200 });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

describe('ChatGPT plan OAuth boundaries', () => {
  it('uses dynamic registration with fresh state, nonce, and S256 PKCE', () => {
    const first = beginAuthorization('urn:uuid:test-host', 'http://127.0.0.1:54321/auth/callback');
    const second = beginAuthorization('urn:uuid:test-host', 'http://127.0.0.1:54321/auth/callback');
    const url = new URL(first.url);
    expect(url.origin).toBe('https://auth.openai.com');
    expect(url.searchParams.get('client_id')).toBe('dynamic_agent_client');
    expect(url.searchParams.get('agent_name_hint')).toBe('Companion Rehab');
    expect(url.searchParams.get('state')).not.toBe(second.attempt.state);
    expect(url.searchParams.get('nonce')).not.toBe(second.attempt.nonce);
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(first.attempt.verifier).digest('base64url'));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(() => beginAuthorization('host', 'http://localhost:54321/auth/callback')).toThrow();
  });
  it('rejects mismatched state, origin, duplicate state and client substitution', () => {
    const { attempt } = beginAuthorization('urn:uuid:test', 'http://127.0.0.1:54321/auth/callback');
    const path = `/auth/callback?code=abc&state=${attempt.state}&client_id=${clientId}`;
    expect(readCallback(`http://127.0.0.1:54321${path}`, attempt)).toEqual({ code: 'abc', clientId });
    expect(() => readCallback(`http://localhost:54321${path}`, attempt)).toThrow();
    expect(() => readCallback(`http://127.0.0.1:54321/auth/callback?code=abc&state=wrong&client_id=${clientId}`, attempt)).toThrow();
    expect(() => readCallback(`http://127.0.0.1:54321${path}&state=${attempt.state}`, attempt)).toThrow();
    const returning = beginAuthorization('urn:uuid:test', 'http://127.0.0.1:54321/auth/callback', credential).attempt;
    expect(() => readCallback(`http://127.0.0.1:54321/auth/callback?code=abc&state=${returning.state}&client_id=oaiapp_other`, returning)).toThrow();
  });
  it('checks OpenAI signature, issuer, audience and nonce before trusting identity', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' };
    const makeToken = (overrides: Record<string, unknown> = {}) => {
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ iss: 'https://auth.openai.com', aud: clientId,
        sub: 'subject-1', nonce: 'nonce-1', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
        ...overrides })).toString('base64url');
      const signature = sign('sha256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
      return `${header}.${payload}.${signature}`;
    };
    const fetcher = vi.fn(async () => mockedResponse({ keys: [jwk] }, jwksEndpoint)) as unknown as typeof fetch;
    expect(await validateIdToken(makeToken(), clientId, 'nonce-1', fetcher)).toEqual({ subject: 'subject-1' });
    await expect(validateIdToken(makeToken({ nonce: 'wrong' }), clientId, 'nonce-1', fetcher)).rejects.toThrow();
    await expect(validateIdToken(makeToken({ aud: 'other' }), clientId, 'nonce-1', fetcher)).rejects.toThrow();
    const tampered = makeToken().split('.'); tampered[1] = Buffer.from(JSON.stringify({ sub: 'other' })).toString('base64url');
    await expect(validateIdToken(tampered.join('.'), clientId, 'nonce-1', fetcher)).rejects.toThrow();
  });
});

describe('protected local state', () => {
  const path = resolve(`.local/runtime/chatgpt-plan-test-${randomBytes(6).toString('hex')}.enc`);
  afterEach(async () => { await rm(path, { force: true }); await rm(`${path}.lock`, { force: true }); });
  it('persists encrypted credentials and a stable host ID', async () => {
    const key = randomBytes(32), store = new PlanStore(path, key);
    const state = await store.load();
    state.accounts[`${clientId}:subject-1`] = credential;
    await store.save(state);
    expect((await readFile(path, 'utf8'))).not.toContain('access-secret');
    expect((await store.load()).hostId).toBe(state.hostId);
    await expect(new PlanStore(path, randomBytes(32)).load()).rejects.toThrow();
    expect(() => new PlanStore(resolve('.local-other/plan.enc'), key)).toThrow();
  });
  it('refuses concurrent setup helpers using the same credential file', async () => {
    const store = new PlanStore(path, randomBytes(32));
    const unlock = await store.lock();
    await expect(store.lock()).rejects.toThrow();
    await unlock();
  });
});

describe('synthetic Sol-high probe', () => {
  function stream(events: string[]): Response {
    const contents = events.map(event => `data: ${event}\n\n`).join('');
    return new Response(new ReadableStream({ start(controller) {
      for (const byte of new TextEncoder().encode(contents)) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } }), { status: 200, headers: { 'Content-Type': 'text/event-stream', 'x-request-id': 'req-test' } });
  }
  it('sends only fixed synthetic input with exact model/effort and requires completed terminal event', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.redirect).toBe('error');
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ model: 'gpt-6-sol', reasoning: { effort: 'high' }, store: false, stream: true });
      expect(body.input[0].content).toContain('synthetic connection test');
      expect(body.tools).toBeUndefined();
      return stream([JSON.stringify({ type: 'response.output_text.delta', delta: 'READY' }),
        JSON.stringify({ type: 'response.completed', response: { status: 'completed', model: 'gpt-6-sol', usage: { input_tokens: 20, output_tokens: 10 } } })]);
    }) as unknown as typeof fetch;
    expect(await probeSolHigh(credential, fetcher)).toMatchObject({ completed: true, model: 'gpt-6-sol', effort: 'high', text: 'READY', usage: { inputTokens: 20, outputTokens: 10 } });
  });
  it('does not call partial text or a quota failure a completed inference', async () => {
    const incomplete = vi.fn(async () => stream([JSON.stringify({ type: 'response.output_text.delta', delta: 'READY' })])) as unknown as typeof fetch;
    await expect(probeSolHigh(credential, incomplete)).rejects.toThrow('without response.completed');
    const quota = vi.fn(async () => stream([JSON.stringify({ type: 'response.output_text.delta', delta: 'READY' }),
      JSON.stringify({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } })])) as unknown as typeof fetch;
    await expect(probeSolHigh(credential, quota)).rejects.toMatchObject({ code: 'subscription_sharing_usage_limit_exceeded' });
    const wrong = vi.fn(async () => stream([JSON.stringify({ type: 'response.completed', response: { status: 'completed', model: 'gpt-6.1-sol' } })])) as unknown as typeof fetch;
    await expect(probeSolHigh(credential, wrong)).rejects.toThrow('different model');
  });
  it('preserves status and request id while suppressing unknown provider error text', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'raw_secret', message: 'sensitive provider text' } }), { status: 403, headers: { 'x-request-id': 'req-test' } })) as unknown as typeof fetch;
    await expect(probeSolHigh(credential, fetcher)).rejects.toMatchObject({ status: 403, code: 'http_403', requestId: 'req-test' } satisfies Partial<PlanRequestError>);
  });
});

describe('local browser boundary', () => {
  const path = resolve(`.local/runtime/chatgpt-local-test-${randomBytes(6).toString('hex')}.enc`);
  afterEach(async () => { await rm(path, { force: true }); await rm(`${path}.lock`, { force: true }); });
  it('requires same-origin POST and a matching browser cookie before OAuth callback exchange', async () => {
    const setup = await startPlanSetup(new PlanStore(path, randomBytes(32)), vi.fn() as unknown as typeof fetch);
    try {
      const page = await fetch(setup.url);
      // Chromium may suppress POST Origin with no-referrer; keep it for local forms.
      expect(page.headers.get('referrer-policy')).toBe('same-origin');
      const html = await page.text();
      const csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1];
      const cookie = page.headers.get('set-cookie')?.split(';')[0];
      expect(csrf && cookie).toBeTruthy();
      const blocked = await fetch(new URL('/start', setup.url), { method: 'POST', body: new URLSearchParams({ csrf: csrf! }), headers: { Cookie: cookie! }, redirect: 'manual' });
      expect(blocked.status).toBe(403);
      const started = await fetch(new URL('/start', setup.url), { method: 'POST', body: new URLSearchParams({ csrf: csrf! }), headers: { Cookie: cookie!, Origin: new URL(setup.url).origin }, redirect: 'manual' });
      expect(started.status).toBe(303);
      const auth = new URL(started.headers.get('location')!);
      expect(auth.origin).toBe('https://auth.openai.com');
      const callback = new URL('/auth/callback', setup.url);
      callback.searchParams.set('code', 'secret-code'); callback.searchParams.set('state', auth.searchParams.get('state')!); callback.searchParams.set('client_id', clientId);
      const rejected = await fetch(callback, { redirect: 'manual' });
      expect(rejected.status).toBe(400);
      expect(await rejected.text()).not.toContain('secret-code');
    } finally { await setup.close(); }
  });
});
