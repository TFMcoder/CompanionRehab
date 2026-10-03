import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { z, ZodError } from 'zod';
import { commandSchema, setupSchema, uuid } from '../shared/contracts.js';
import { missingConfig, type Config } from './config.js';
import { ApiError } from './errors.js';
import { openSession, sealSession, type Session } from './session.js';
import { Supabase } from './supabase.js';
import { VoiceService } from './voice.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionRevocations } from './revocations.js';

export async function createApp(config: Config, dependencies: { care?: Supabase; voice?: VoiceService; staticRoot?: string; revocations?: SessionRevocations } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 100000, trustProxy: false, requestTimeout: 45000 });
  const care = dependencies.care || new Supabase(config);
  const voice = dependencies.voice || new VoiceService(config, care);
  const root = resolve(dependencies.staticRoot || 'dist/client');
  const sessions = new WeakMap<FastifyRequest, Session>();
  const revoked = dependencies.revocations || new SessionRevocations(resolve('.local/runtime/revoked-sessions.json'));
  const limits = new Map<string, { starts: number; count: number }>();
  const limiter = setInterval(() => {
    for (const [key, entry] of limits) if (entry.starts + 60000 < Date.now()) limits.delete(key);
  }, 60000); limiter.unref();
  const cookieOptions = { httpOnly: true, secure: config.origin.startsWith('https:'), sameSite: 'strict' as const, path: '/', maxAge: 7 * 86400 };
  const setSession = (reply: FastifyReply, session: Session) => reply.setCookie('nancy_session', sealSession(session, config.sessionKey!), cookieOptions);
  await app.register(cookie);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer')
      .header('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()')
      .header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (config.origin.startsWith('https:')) reply.header('Strict-Transport-Security', 'max-age=31536000');
    if (request.headers.host !== new URL(config.origin).host) throw new ApiError(403, 'wrong_host', 'This address is not enabled.');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin !== config.origin)
      throw new ApiError(403, 'wrong_origin', 'Open Nancy at the configured address before making changes.');
    if (request.url.startsWith('/api/') && !['/api/config', '/api/auth/login'].includes(request.url)) {
      if (missingConfig(config).length) throw new ApiError(503, 'not_configured', 'The care service has not been connected yet.');
      const current = openSession(request.cookies.nancy_session, config.sessionKey!);
      if (!current || revoked.has(current.session_id)) throw new ApiError(401, 'unauthorized', 'Please sign in.');
      const session = await care.authorize(current);
      sessions.set(request, session);
      if (session !== current) setSession(reply, session);
    }
  });
  const limit = (request: FastifyRequest, key: string, maximum: number) => {
    const bucket = limits.get(key);
    const active = bucket && bucket.starts + 60000 > Date.now() ? bucket : { starts: Date.now(), count: 0 };
    active.count++; limits.set(key, active);
    if (active.count > maximum) throw new ApiError(429, 'rate_limited', 'Please wait a minute before trying again.');
  };
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: { code: 'invalid_input', message: 'Check the information and choices, then try again.' } });
    if (error instanceof ApiError) {
      if (error.status === 401) reply.clearCookie('nancy_session', cookieOptions);
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    }
    if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 413) return reply.code(413).send({ error: { code: 'too_large', message: 'That request is too large.' } });
    return reply.code(500).send({ error: { code: 'unexpected', message: 'Nancy could not finish that request. A save may be unconfirmed; check the plan before trying again.' } });
  });
  app.get('/api/config', async () => ({ configured: missingConfig(config).length === 0, voice_available: missingConfig(config).length === 0 && !!config.openaiKey, assistant_name: 'Nancy', missing: missingConfig(config) }));
  app.post('/api/auth/login', async (request, reply) => {
    limit(request, `login:${request.ip}`, 8);
    if (missingConfig(config).length) throw new ApiError(503, 'not_configured', 'The care service has not been connected yet.');
    const { email, password } = z.object({ email: z.email().max(254), password: z.string().min(1).max(256) }).strict().parse(request.body);
    const session = await care.login(email, password);
    setSession(reply, session); return { ok: true };
  });
  app.get('/api/auth/session', async () => ({ authenticated: true }));
  app.post('/api/auth/logout', async (request, reply) => {
    const session = sessions.get(request)!;
    revoked.revoke(session.session_id, session.issued_at * 1000 + 7 * 86400000);
    await voice.endLogin(session.session_id);
    reply.clearCookie('nancy_session', cookieOptions);
    await care.logout(session);
    return { ok: true };
  });
  app.get('/api/today', async request => care.today(sessions.get(request)!));
  app.post('/api/setup', async request => {
    limit(request, `setup:${sessions.get(request)!.user_id}`, 10);
    return care.setup(sessions.get(request)!, setupSchema.parse(request.body));
  });
  app.post('/api/commands', async request => {
    limit(request, `command:${sessions.get(request)!.user_id}`, 60);
    return care.command(sessions.get(request)!, commandSchema.parse(request.body));
  });
  app.get('/api/receipts/:key', async request => {
    const key = uuid.parse((request.params as { key: string }).key);
    const receipt = await care.receipt(sessions.get(request)!, key);
    if (!receipt) throw new ApiError(404, 'not_found', 'No receipt is available yet. The change is still unconfirmed.');
    return receipt;
  });
  app.post('/api/voice', async (request, reply) => {
    limit(request, `voice:${sessions.get(request)!.user_id}`, 3);
    const { sdp } = z.object({ sdp: z.string().min(10).max(80000) }).strict().parse(request.body);
    let disconnected = false;
    let id: string | undefined;
    const session = sessions.get(request)!;
    reply.raw.once('close', () => {
      if (!reply.raw.writableFinished) { disconnected = true; if (id) void voice.end(id, session.user_id); }
    });
    const result = await voice.start(session, sdp); id = result.session_id;
    if (disconnected) await voice.end(id, session.user_id);
    return result;
  });
  app.get('/api/voice/:id', async request => {
    const session = sessions.get(request)!;
    try { await care.today(session); } catch (error) { await voice.endLogin(session.session_id); throw error; }
    return voice.status(uuid.parse((request.params as { id: string }).id), session.user_id);
  });
  app.delete('/api/voice/:id', async request => { await voice.end(uuid.parse((request.params as { id: string }).id), sessions.get(request)!.user_id); return { ok: true }; });
  // Serve only built public files. No SPA fallback for API paths or arbitrary filesystem paths.
  app.get('/*', async (request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ error: { code: 'not_found', message: 'That action does not exist.' } });
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(request.url, config.origin).pathname); } catch { return reply.code(400).send(); }
    if (pathname.includes('\\') || pathname.includes('\0') || pathname.includes(':')) return reply.code(404).send();
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root + sep)) return reply.code(404).send();
    try {
      if (!(await stat(path)).isFile()) return reply.code(404).send();
      const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
      if (!mime[extname(path)]) return reply.code(404).send();
      return reply.type(mime[extname(path)]).send(await readFile(path));
    } catch { return reply.code(404).type('text/plain').send('Build Nancy first: npm run build'); }
  });
  app.addHook('onClose', async () => { clearInterval(limiter); await voice.close(); });
  return app;
}
