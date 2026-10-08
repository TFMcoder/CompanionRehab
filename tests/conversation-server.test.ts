import { testAuthority, bindTestInference } from './helpers/inference.js';
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
  it('serves the validated prepared first sentence once and rejects it after interruption', async () => {
    const config = configFromEnv({ PUBLIC_ORIGIN: 'http://localhost:8787', DATABASE_URL: 'postgresql://local.invalid/synthetic', SESSION_KEY: randomBytes(32).toString('base64') });
    const session: Session = { user_id: randomUUID(), session_id: randomUUID(), issued_at: Date.now() / 1000, expires_at: Date.now() / 1000 + 3600, access_token: 'synthetic', refresh_token: 'synthetic' };
    const care = { authorize: vi.fn(async s => s), authority: () => testAuthority(session), today: vi.fn(async () => ({ profile: { id: session.user_id, display_name: 'Synthetic', time_zone: 'America/Toronto', preferences: '', revision: 0 }, local_date: '2026-10-05', tasks: [], meal_options: [], checkin: null })), close: vi.fn() } as unknown as CareService;
    const synthesize = vi.fn(async () => Buffer.from('prepared-synthetic-wave'));
    const conversation = new ConversationService(care, { bind: bindTestInference, respond: async (_i, _p, _t, _s, delta) => {
      delta?.('Which meal sounds good? ');
      return { completed: true, model: 'gpt-6-sol', effort: 'high', text: 'Which meal sounds good? We can discuss options.', output: [] };
    } }, session.user_id, undefined, synthesize);
    const app = await createApp(config, { care, conversation, speech: { synthesize, readiness: () => ({ kokoro: 'ready', asr: 'ready' }), close: vi.fn() } as unknown as LocalSpeech, revocations: new SessionRevocations() });
    const headers = { host: 'localhost:8787', origin: config.origin, cookie: `nancy_session=${sealSession(session, config.sessionKey!)}` };
    try {
      const start = (await app.inject({ method: 'POST', url: '/api/conversation', headers, payload: {} })).json();
      const turn = await app.inject({ method: 'POST', url: `/api/conversation/${start.session_id}/turn`, headers, payload: { turn_id: randomUUID(), text: 'Help me choose' } });
      expect(turn.statusCode).toBe(200);
      const path = `/api/conversation/${start.session_id}/speech?turn_id=${turn.json().reply_id}&part=0`;
      expect(synthesize).toHaveBeenCalledTimes(1);
      expect((await app.inject({ url: path, headers })).body).toBe('prepared-synthetic-wave');
      expect((await app.inject({ url: path, headers })).statusCode).toBe(200);
      expect(synthesize).toHaveBeenCalledTimes(1);
      await app.inject({ method: 'POST', url: `/api/conversation/${start.session_id}/interrupt`, headers, payload: {} });
      expect((await app.inject({ url: path, headers })).statusCode).toBe(404);
    } finally { await app.close(); }
  });
  it('protects replies, rejects arbitrary speech and binds a conversation to its login', async () => {
    const config = configFromEnv({ PUBLIC_ORIGIN: 'http://localhost:8787', DATABASE_URL: 'postgresql://local.invalid/synthetic', SESSION_KEY: randomBytes(32).toString('base64') });
    const session: Session = { user_id: randomUUID(), session_id: randomUUID(), issued_at: Date.now() / 1000, expires_at: Date.now() / 1000 + 3600, access_token: 'synthetic', refresh_token: 'synthetic' };
    const care = { authorize: vi.fn(async s => s), authority: () => testAuthority(session), today: vi.fn(async () => ({ profile: { id: session.user_id, display_name: 'Synthetic', time_zone: 'America/Toronto', preferences: '', revision: 0 }, local_date: '2026-10-05', tasks: [], meal_options: [], checkin: null })), logout: vi.fn(), close: vi.fn() } as unknown as CareService;
    const conversation = new ConversationService(care, { bind: bindTestInference, respond: vi.fn() }, session.user_id);
    const synthesize = vi.fn(async () => Buffer.from('synthetic-wave'));
    const readiness = vi.fn(() => ({ kokoro: 'ready', asr: 'ready' }));
    const speech = { synthesize, readiness, close: vi.fn() } as unknown as LocalSpeech;
    const app = await createApp(config, { care, conversation, speech, revocations: new SessionRevocations() });
    const headers = { host: 'localhost:8787', origin: config.origin, cookie: `nancy_session=${sealSession(session, config.sessionKey!)}` };
    try {
      expect((await app.inject({ url: '/api/config', headers })).json().voice_available).toBe(true);
      readiness.mockReturnValue({ kokoro: 'ready', asr: 'unavailable' });
      expect((await app.inject({ url: '/api/config', headers })).json().voice_available).toBe(false);
      expect((await app.inject({ method: 'POST', url: '/api/conversation', headers, payload: {} })).statusCode).toBe(503);
      readiness.mockReturnValue({ kokoro: 'ready', asr: 'ready' });
      expect((await app.inject({ method: 'POST', url: '/api/conversation', headers: { ...headers, cookie: '' }, payload: {} })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: '/api/conversation', headers: { ...headers, origin: 'https://other.invalid' }, payload: {} })).statusCode).toBe(403);
      const start = await app.inject({ method: 'POST', url: '/api/conversation', headers, payload: {} });
      expect(start.statusCode).toBe(200); const reply = start.json();
      const path = `/api/conversation/${reply.session_id}/speech?turn_id=${reply.reply_id}`;
      expect((await app.inject({ url: path + '&text=arbitrary', headers })).statusCode).toBe(400);
      expect((await app.inject({ url: path, headers: { ...headers, cookie: `nancy_session=${sealSession({ ...session, session_id: randomUUID() }, config.sessionKey!)}` } })).statusCode).toBe(404);
      expect((await app.inject({ url: path, headers })).statusCode).toBe(200);
      expect((await app.inject({ url: path, headers })).statusCode).toBe(200); expect(synthesize).toHaveBeenCalledTimes(1);
      const interruptPath = `/api/conversation/${reply.session_id}/interrupt`;
      expect((await app.inject({ method:'POST',url:interruptPath,headers:{...headers,cookie:''},payload:{} })).statusCode).toBe(401);
      expect((await app.inject({ method:'POST',url:interruptPath,headers:{...headers,cookie:`nancy_session=${sealSession({...session,session_id:randomUUID()},config.sessionKey!)}`},payload:{} })).statusCode).toBe(404);
      expect((await app.inject({ method:'POST',url:interruptPath,headers,payload:{} })).statusCode).toBe(200);
      expect((await app.inject({ url:path,headers })).statusCode).toBe(404);
      expect((await app.inject({ method:'POST',url:`/api/conversation/${reply.session_id}/played`,headers,payload:{reply_id:reply.reply_id} })).statusCode).toBe(404);
      expect((await app.inject({ method:'POST',url:`/api/conversation/${reply.session_id}/turn`,headers,payload:{turn_id:randomUUID(),text:'Show my meals'} })).statusCode).toBe(200);
      expect((await app.inject({ method: 'POST', url: '/api/voice', headers, payload: { sdp: 'legacy-offer' } })).statusCode).toBe(410);
      await app.inject({ method: 'POST', url: '/api/auth/logout', headers, payload: {} });
      expect((await app.inject({ url: path, headers })).statusCode).toBe(401);
    } finally { await app.close(); }
  });
});
