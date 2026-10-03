import { randomUUID, createHash } from 'node:crypto';
import type { Config } from './config.js';
import { ApiError, unavailable } from './errors.js';
import type { Session } from './session.js';
import type { Today, Receipt, SetupInput, CareCommand } from '../shared/contracts.js';

export class Supabase {
  private refreshing = new Map<string, Promise<Session>>();
  constructor(private config: Config, private fetcher: typeof fetch = fetch) {}
  private async request(path: string, init: RequestInit, token?: string): Promise<any> {
    if (!this.config.supabaseUrl || !this.config.supabaseKey) throw new ApiError(503, 'not_configured', 'The care service has not been connected yet.');
    let response: Response;
    try {
      response = await this.fetcher(this.config.supabaseUrl + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(12000),
        headers: { apikey: this.config.supabaseKey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
    } catch { throw unavailable(); }
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { code?: string; message?: string };
      if (response.status === 401 || response.status === 403 || data.code === '42501')
        throw new ApiError(401, 'unauthorized', 'Please sign in again.');
      if (response.status === 429) throw new ApiError(429, 'rate_limited', 'Please wait a moment before trying again.');
      if (data.code === 'P0001' || data.code === '23505' || data.code === '40001')
        throw new ApiError(409, 'conflict', 'The plan or setup has changed. Refresh and review it before continuing.');
      if (response.status === 400 || data.code === '22023' || data.code === '22P02')
        throw new ApiError(400, 'invalid_input', 'The request could not be used. Check the choices and try again.');
      throw unavailable();
    }
    if (response.status === 204) return null;
    return response.json().catch(() => { throw unavailable(); });
  }
  async login(email: string, password: string): Promise<Session> {
    const data = await this.request('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (!data.user?.id || !data.access_token || !data.refresh_token) throw unavailable();
    return { access_token: data.access_token, refresh_token: data.refresh_token, user_id: data.user.id,
      expires_at: Date.now() / 1000 + data.expires_in, issued_at: Date.now() / 1000, session_id: randomUUID() };
  }
  async authorize(session: Session): Promise<Session> {
    let current = session;
    if (current.expires_at < Date.now() / 1000 + 90) {
      const key = createHash('sha256').update(session.refresh_token).digest('hex');
      let pending = this.refreshing.get(key);
      if (!pending) {
        pending = this.request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token }) })
          .then(data => ({ ...session, access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() / 1000 + data.expires_in }));
        this.refreshing.set(key, pending);
        const timer = setTimeout(() => this.refreshing.delete(key), 30000); timer.unref();
      }
      current = await pending;
    }
    // Online user verification is deliberate; JWT decoding alone is not authorization.
    const user = await this.request('/auth/v1/user', { method: 'GET' }, current.access_token);
    if (user.id !== current.user_id || user.banned_until && new Date(user.banned_until).getTime() > Date.now())
      throw new ApiError(401, 'unauthorized', 'Please sign in again.');
    return current;
  }
  logout(session: Session) { return this.request('/auth/v1/logout?scope=local', { method: 'POST' }, session.access_token); }
  private rpc<T>(session: Session, name: string, body = {}): Promise<T> {
    return this.request(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(body) }, session.access_token);
  }
  today(s: Session) { return this.rpc<Today>(s, 'nancy_today'); }
  setup(s: Session, input: SetupInput) { return this.rpc<Today>(s, 'nancy_setup', { p_input: input }); }
  command(s: Session, command: CareCommand) { return this.rpc<Receipt>(s, 'nancy_command', { p_command: command }); }
  receipt(s: Session, key: string) { return this.rpc<Receipt | null>(s, 'nancy_receipt', { p_key: key }); }
}
