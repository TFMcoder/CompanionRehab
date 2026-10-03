import { describe, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/app.js';
import { configFromEnv } from '../src/server/config.js';
import { sealSession, openSession, type Session } from '../src/server/session.js';
import { SessionRevocations } from '../src/server/revocations.js';
import { Supabase } from '../src/server/supabase.js';
import { unavailable } from '../src/server/errors.js';
const config = configFromEnv({ PUBLIC_ORIGIN: 'http://localhost:8787', SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic', SESSION_KEY: randomBytes(32).toString('base64') });
const session: Session = { user_id: randomUUID(), session_id: randomUUID(), access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_at: Date.now() / 1000 + 3600, issued_at: Date.now() / 1000 };
const headers = { host: 'localhost:8787', origin: config.origin, cookie: `nancy_session=${sealSession(session, config.sessionKey!)}` };
function careDouble() {
  return { authorize: vi.fn(async s => s), login: vi.fn(async () => session), logout: vi.fn(async () => undefined), today: vi.fn(async () => ({ profile: null })), setup: vi.fn(), command: vi.fn(), receipt: vi.fn() } as unknown as Supabase;
}
describe('HTTP/session boundaries', () => {
  it('rejects cross-origin writes and wrong host before touching authenticated state', async () => {
    const care = careDouble(), app = await createApp(config, { care, revocations: new SessionRevocations() });
    try {
      expect((await app.inject({ method: 'POST', url: '/api/commands', headers: { ...headers, origin: 'https://unrelated.example' }, payload: {} })).statusCode).toBe(403);
      expect((await app.inject({ url: '/api/today', headers: { ...headers, host: 'unrelated.example' } })).statusCode).toBe(403);
      expect(care.authorize).not.toHaveBeenCalled(); expect(care.command).not.toHaveBeenCalled();
      expect((await app.inject({ url: '/api/today', headers: { host: headers.host } })).statusCode).toBe(401);
      const r = await app.inject({ url: '/api/config', headers: { host: headers.host } });
      expect(r.body).not.toMatch(/synthetic-access|synthetic-refresh|sb_publishable/);
      expect(r.json()).toMatchObject({ configured: true, voice_available: false, assistant_name: 'Nancy' });
      expect(r.headers['cache-control']).toBe('no-store');
    } finally { await app.close(); }
  });
  it('validates touch commands and retains honest ambiguity for provider errors', async () => {
    const care = careDouble(), app = await createApp(config, { care, revocations: new SessionRevocations() });
    try {
      const command = { type: 'start_or_resume_checkin', idempotency_key: randomUUID(), local_date: '2026-09-29', expected_revision: 0, payload: {} };
      expect((await app.inject({ method: 'POST', url: '/api/commands', headers, payload: { ...command, actor_id: randomUUID() } })).statusCode).toBe(400);
      expect(care.command).not.toHaveBeenCalled();
      vi.mocked(care.command).mockRejectedValueOnce(unavailable());
      const unknown = await app.inject({ method: 'POST', url: '/api/commands', headers, payload: command });
      expect(unknown.statusCode).toBe(503); expect(unknown.body).toContain('unconfirmed');
      vi.mocked(care.receipt).mockResolvedValueOnce(null);
      const receipt = await app.inject({ url: `/api/receipts/${command.idempotency_key}`, headers });
      expect(receipt.statusCode).toBe(404); expect(receipt.body).toContain('still unconfirmed');
      expect(care.command).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });
  it('encrypts the cookie and persists logout revocation through an API restart', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'nancy-session-test-'));
    const path = join(temp, 'revocations.json');
    const care = careDouble();
    let app = await createApp(config, { care, revocations: new SessionRevocations(path) });
    try {
      const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { host: headers.host, origin: headers.origin }, payload: { email: 'synthetic@example.invalid', password: 'synthetic-only' } });
      expect(login.statusCode).toBe(200);
      const cookie = String(login.headers['set-cookie']);
      expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict'); expect(cookie).not.toContain('synthetic-access');
      expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers, payload: {} })).statusCode).toBe(200);
      await app.close();
      app = await createApp(config, { care, revocations: new SessionRevocations(path) });
      expect((await app.inject({ url: '/api/today', headers })).statusCode).toBe(401);
      expect(openSession(sealSession(session, config.sessionKey!), config.sessionKey!)).toEqual(session);
      expect(openSession(sealSession(session, config.sessionKey!), randomBytes(32))).toBeNull();
    } finally { await app.close(); await rm(temp, { recursive: true }); }
  });
  it('serves only public build files, including when paths are encoded', async () => {
    const app = await createApp(config, { care: careDouble(), revocations: new SessionRevocations() });
    try {
      for (const path of ['/.env.local', '/../package.json', '/%2e%2e/package.json', '/..%5cpackage.json', '/C:/Windows/win.ini', '/api/does-not-exist']) {
        const r = await app.inject({ url: path, headers }); expect(r.statusCode).toBe(404); expect(r.body).not.toContain('dependencies');
      }
    } finally { await app.close(); }
  });
});
describe('Supabase gateway', () => {
  it('uses only the public key and current user JWT for RPC; transport failures stay ambiguous', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ profile: null })).mockRejectedValueOnce(new Error('Private transport diagnostics'));
    const care = new Supabase(config, fetcher);
    await care.today(session);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://synthetic.supabase.co/rest/v1/rpc/nancy_today');
    expect(init?.headers).toEqual({ apikey: config.supabaseKey, Authorization: 'Bearer synthetic-access', 'Content-Type': 'application/json' });
    await expect(care.command(session, { type: 'start_or_resume_checkin', expected_revision: 0, idempotency_key: randomUUID(), local_date: '2026-09-29', payload: {} })).rejects.toMatchObject({ status: 503, code: 'unavailable' });
  });
  it('serializes rotating refresh tokens and verifies the returned user', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => String(url).includes('grant_type=refresh_token')
      ? Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }) : Response.json({ id: session.user_id }));
    const care = new Supabase(config, fetcher), expired = { ...session, expires_at: 0 };
    const result = await Promise.all([care.authorize(expired), care.authorize(expired)]);
    expect(result[0].access_token).toBe('new-access'); expect(result[0]).toEqual(result[1]);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('refresh_token'))).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/user'))).toHaveLength(2);
  });
  it('refuses privileged runtime keys and insecure public origins', () => {
    expect(() => configFromEnv({ SUPABASE_PUBLISHABLE_KEY: 'sb_secret_test' })).toThrow(/never/);
    const jwt = `a.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.b`;
    expect(() => configFromEnv({ SUPABASE_ANON_KEY: jwt })).toThrow(/service_role/);
    expect(() => configFromEnv({ PUBLIC_ORIGIN: 'http://nancy.example.com' })).toThrow(/HTTPS/);
  });
});
