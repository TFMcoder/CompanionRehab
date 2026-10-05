import { describe, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../src/server/app.js';
import { ConversationService } from '../src/server/conversation.js';
import { configFromEnv } from '../src/server/config.js';
import { sealSession, type Session } from '../src/server/session.js';
import type { CareService } from '../src/server/care-access.js';
import type { LocalSpeech } from '../src/server/local-speech.js';
import { SessionRevocations } from '../src/server/revocations.js';
describe('authenticated local voice routes', () => {
  it('protects replies, rejects arbitrary speech and binds a conversation to its login', async () => {
    const config = configFromEnv({ PUBLIC_ORIGIN: 'http://localhost:8787', DATABASE_URL: 'postgresql://local.invalid/synthetic', SESSION_KEY: randomBytes(32).toString('base64') });
    const session: Session = { user_id: randomUUID(), session_id: randomUUID(), issued_at: Date.now() / 1000, expires_at: Date.now() / 1000 + 3600, access_token: 'synthetic', refresh_token: 'synthetic' };
    const care = { authorize: vi.fn(async s => s), today: vi.fn(async () => ({ profile: { id: session.user_id, display_name: 'Synthetic', time_zone: 'America/Toronto', preferences: '', revision: 0 }, local_date: '2026-10-05', tasks: [], meal_options: [], checkin: null })), logout: vi.fn(), close: vi.fn() } as unknown as CareService;
    const conversation = new ConversationService(care, { respond: vi.fn() }, session.user_id);
    const synthesize = vi.fn(async () => Buffer.from('synthetic-wave'));
    const speech = { synthesize, close: vi.fn() } as unknown as LocalSpeech;
    const app = await createApp(config, { care, conversation, speech, revocations: new SessionRevocations() });
    const headers = { host: 'localhost:8787', origin: config.origin, cookie: `nancy_session=${sealSession(session, config.sessionKey!)}` };
    try {
      expect((await app.inject({ method: 'POST', url: '/api/conversation', headers: { ...headers, cookie: '' }, payload: {} })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: '/api/conversation', headers: { ...headers, origin: 'https://other.invalid' }, payload: {} })).statusCode).toBe(403);
      const start = await app.inject({ method: 'POST', url: '/api/conversation', headers, payload: {} });
      expect(start.statusCode).toBe(200); const reply = start.json();
      const path = `/api/conversation/${reply.session_id}/speech?turn_id=${reply.reply_id}`;
      expect((await app.inject({ url: path + '&text=arbitrary', headers })).statusCode).toBe(400);
      expect((await app.inject({ url: path, headers: { ...headers, cookie: `nancy_session=${sealSession({ ...session, session_id: randomUUID() }, config.sessionKey!)}` } })).statusCode).toBe(404);
      expect((await app.inject({ url: path, headers })).statusCode).toBe(200);
      expect((await app.inject({ url: path, headers })).statusCode).toBe(200); expect(synthesize).toHaveBeenCalledTimes(1);
      expect((await app.inject({ method: 'POST', url: '/api/voice', headers, payload: { sdp: 'legacy-offer' } })).statusCode).toBe(410);
      await app.inject({ method: 'POST', url: '/api/auth/logout', headers, payload: {} });
      expect((await app.inject({ url: path, headers })).statusCode).toBe(401);
    } finally { await app.close(); }
  });
});
