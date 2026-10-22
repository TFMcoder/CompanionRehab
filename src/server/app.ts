import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { z, ZodError } from 'zod';
import { commandSchema, setupSchema, uuid } from '../shared/contracts.js';
import { missingConfig, type Config } from './config.js';
import { ApiError } from './errors.js';
import { openSession, sealSession, sessionLifetimeSeconds, type Session } from './session.js';
import { Supabase } from './supabase.js';
import { VoiceService } from './voice.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionRevocations } from './revocations.js';
import type { CareService } from './care-access.js';
import { LocalCare } from './local-care.js';
import type { ConversationService } from './conversation.js';
import type { LocalSpeech } from './local-speech.js';
import { groceryInput } from '../shared/contracts.js';
import { priorityContext } from '../shared/priority-context.js';
import { createHash, randomUUID } from 'node:crypto';
import type { RuntimeLog } from './telemetry.js';
import { splitSpeechParts } from '../shared/speech-parts.js';
import { activityCommandSchema, activityDate } from '../shared/activity-contracts.js';
import {preferenceCommandSchema} from '../shared/preference-contracts.js';
import { isIP } from 'node:net';
import { TaskRequestService } from './task-requests.js';
import { taskRequestCommandSchema, taskRequestDraftSchema } from '../shared/task-request-contracts.js';
import { createLocalFeatures, registerLocalFeatures, type LocalFeatures } from './local-features.js';
import { registerClientVoiceMetrics } from './client-voice-metrics.js';
import {registerMicrosoftRoutes,microsoftCallbackPath} from './microsoft/routes.js';
import {createMicrosoftRuntime} from './microsoft/runtime.js';
import type {MicrosoftService} from './microsoft/service.js';
import {NancySuggestions} from './nancy-suggestions.js';

type RequestService = Pick<TaskRequestService, 'workspace'|'review'|'command'|'receipt'|'authorityRevision'>;
export async function createApp(config: Config, dependencies: { care?: CareService; voice?: VoiceService; conversation?: ConversationService; speech?: LocalSpeech; taskRequests?: RequestService; features?:LocalFeatures; microsoft?:MicrosoftService|null; staticRoot?: string; revocations?: SessionRevocations; runtimeLog?: RuntimeLog } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 100000, trustProxy: false, requestTimeout: 120000, genReqId: () => randomUUID(), requestIdHeader: false });
  const care: CareService = dependencies.care || (config.databaseUrl ? new LocalCare({ connectionString: config.databaseUrl }) : new Supabase(config));
  const voice = dependencies.voice || new VoiceService(config, care);
  const conversation = dependencies.conversation;
  const speech = dependencies.speech;
  const taskRequests = dependencies.taskRequests ?? (care instanceof LocalCare ? new TaskRequestService(care.pool) : undefined);
  const features=dependencies.features??(care instanceof LocalCare?createLocalFeatures(care.pool):undefined);
  const microsoft=Object.hasOwn(dependencies,'microsoft')?dependencies.microsoft??undefined:(care instanceof LocalCare?await createMicrosoftRuntime(config,care.pool):undefined);
  const speaking = new Map<string, AbortController>();
  const audioCache = new Map<string, Buffer>();
  const root = resolve(dependencies.staticRoot || 'dist/client');
  const sessions = new WeakMap<FastifyRequest, Session>();
  const started = new WeakMap<FastifyRequest, number>();
  app.addHook('onRequest', async request => { started.set(request, performance.now()); });
  app.addHook('onResponse', async (request, reply) => {
    if (!request.routeOptions.url?.startsWith('/api/')) return;
    const params = request.params as { id?: string } | undefined;
    const body = request.body as { turn_id?: string } | undefined;
    dependencies.runtimeLog?.record({ kind: 'http', outcome: reply.statusCode >= 400 ? 'error' : 'ok',
      actor_id: sessions.get(request)?.user_id, request_id: request.id,
      ...(request.routeOptions.url.startsWith('/api/conversation/') ? { conversation_id: params?.id, turn_id: body?.turn_id } : {}),
      measurements: { route: request.routeOptions.url, method: request.method, status_code: reply.statusCode, duration_ms: performance.now() - (started.get(request) ?? performance.now()) },
    });
  });
  const revoked = dependencies.revocations || new SessionRevocations(resolve('.local/runtime/revoked-sessions.json'));
  const limits = new Map<string, { starts: number; count: number }>();
  const limiter = setInterval(() => {
    for (const [key, entry] of limits) if (entry.starts + 60000 < Date.now()) limits.delete(key);
  }, 60000); limiter.unref();
  const cookieOptions = { httpOnly: true, secure: config.origin.startsWith('https:'), sameSite: 'strict' as const, path: '/', maxAge: 7 * 86400 };
  const sessionCookieName=z.enum(['nancy_session','nancy_test_session']).parse(config.sessionCookieName??'nancy_session');
  const setSession = (reply: FastifyReply, session: Session) => reply.setCookie(sessionCookieName, sealSession(session, config.sessionKey!), {...cookieOptions,maxAge:sessionLifetimeSeconds(session)});
  const sessionScope=async(session:Session)=>{
    const authority=await care.authority?.(session);
    const role=authority?.active_role??await care.role?.(session)??null;
    const requestRevision=await taskRequests?.authorityRevision(session)??null;
    const featureRevision=await features?.authorityRevision(session)??null;
    return {authority,role,scope_key:createHash('sha256').update(JSON.stringify([authority??{actor_id:session.user_id,login_session_id:session.session_id},requestRevision,featureRevision])).digest('hex')};
  };
  await app.register(cookie);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer')
      .header('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()')
      .header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (config.origin.startsWith('https:')) reply.header('Strict-Transport-Security', 'max-age=31536000');
    if (request.headers.host !== new URL(config.origin).host) throw new ApiError(403, 'wrong_host', 'This address is not enabled.');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin !== config.origin)
      throw new ApiError(403, 'wrong_origin', 'Open Nancy at the configured address before making changes.');
    const microsoftCallback=request.method==='GET'&&request.url.split('?')[0]===microsoftCallbackPath;
    if (request.url.startsWith('/api/') && !['/api/config', '/api/auth/login'].includes(request.url)&&!microsoftCallback) {
      if (missingConfig(config).length) throw new ApiError(503, 'not_configured', 'The care service has not been connected yet.');
      const current = openSession(request.cookies[sessionCookieName], config.sessionKey!);
      if (!current || revoked.has(current.session_id)) {if(current)await microsoft?.invalidateSession(current);throw new ApiError(401, 'unauthorized', 'Please sign in.');}
      let session:Session;
      try{session=await care.authorize(current);}catch(error){await microsoft?.invalidateSession(current);throw error;}
      sessions.set(request, session);
      if (session !== current) setSession(reply, session);
      const expectedScope=request.headers['x-nancy-scope'];
      if(expectedScope!==undefined){
        const currentScope=await sessionScope(session);
        if(typeof expectedScope!=='string'||expectedScope!==currentScope.scope_key)
          throw new ApiError(403,'scope_changed','Your account view changed. Sign in and review this change.');
        if(currentScope.authority)sessions.set(request,{...session,reviewed_authority:currentScope.authority});
      }
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
      if (error.status === 401) reply.clearCookie(sessionCookieName, cookieOptions);
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    }
    if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 413) return reply.code(413).send({ error: { code: 'too_large', message: 'That request is too large.' } });
    return reply.code(500).send({ error: { code: 'unexpected', message: 'Nancy could not finish that request. A save may be unconfirmed; check the plan before trying again.' } });
  });
  const localSpeechReady = () => !!conversation && speech?.readiness().kokoro === 'ready' && speech.readiness().asr === 'ready';
  const voiceAccess = async (session: Session) => {
    if (config.voiceTransport === 'local' && conversation?.voiceAccess) return conversation.voiceAccess(session);
    // Existing legacy/fixture routes remain owner-only; absence never widens access.
    return config.planUserId === session.user_id && (config.voiceTransport === 'local' ? !!conversation : !!config.openaiKey)
      ? { connection: 'owner_practice' as const, binding_ref: 'owner:' + session.user_id } : null;
  };
  app.get('/api/config', async () => ({ configured: missingConfig(config).length === 0, voice_available: missingConfig(config).length === 0 && (config.voiceTransport === 'local' ? localSpeechReady() : !!config.openaiKey), voice_transport: config.voiceTransport, synthetic: !!config.synthetic, assistant_name: 'Nancy', missing: missingConfig(config) }));
  app.post('/api/auth/login', async (request, reply) => {
    // Only a deliberately configured local cloudflared ingress may supply the
    // client identity. Never trust arbitrary X-Forwarded-For or remote peers.
    const forwarded = request.headers['cf-connecting-ip'];
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip);
    const clientAddress = config.trustedProxy === 'cloudflare-loopback' && loopback && typeof forwarded === 'string' && isIP(forwarded)
      ? forwarded : request.ip;
    limit(request, `login:${clientAddress}`, 20);
    if (missingConfig(config).length) throw new ApiError(503, 'not_configured', 'The care service has not been connected yet.');
    const { email, password, remember_device } = z.object({ email: z.email().max(254), password: z.string().min(1).max(256), remember_device:z.boolean().optional() }).strict().parse(request.body);
    const accountKey = createHash('sha256').update(email.toLowerCase()).digest('hex');
    limit(request, `login-account:${clientAddress}:${accountKey}`, 8);
    const session = await care.login(email, password, remember_device);
    setSession(reply, session); return { ok: true };
  });
  app.get('/api/auth/session', async request => {
    const session=sessions.get(request)!;
    const {authority,role,scope_key}=await sessionScope(session);
    const connection=!!authority && !!role && ['client','family_friend','administrator'].includes(role) ? await voiceAccess(session) : null;
    const voiceEligible=!!connection;
    // Only the privately enabled owner test service performs work; never delay sign-in on preparation.
    if(voiceEligible)void conversation?.prepareMeals?.(session).catch(()=>{});
    return {authenticated:true,actor_id:session.user_id,role,participant_id:authority?.client_id??null,
      scope_key,
      voice_eligible:voiceEligible,voice_connection:connection?.connection??null,voice_unavailable_reason:voiceEligible?null:'A qualified Nancy voice connection is not yet available for this account. You can use the buttons.',
      task_requests_available:!!taskRequests,local_features_available:!!features,microsoft_available:await microsoft?.eligible(session)??false};
  });
  app.get('/api/conversation/preparation',async request=>conversation?.mealPreparationStatus?.(sessions.get(request)!)??{state:'off'});
  app.post('/api/auth/logout', async (request, reply) => {
    const session = sessions.get(request)!;
    revoked.revoke(session.session_id, (session.issued_at+sessionLifetimeSeconds(session))*1000);
    await voice.endLogin(session.session_id);
    conversation?.endLogin(session.session_id);
    await microsoft?.endLogin(session);
    for (const [key, controller] of speaking) if (key.startsWith(session.session_id + ':')) { controller.abort(); speaking.delete(key); }
    for (const key of audioCache.keys()) if (key.startsWith(session.session_id + ':')) audioCache.delete(key);
    reply.clearCookie(sessionCookieName, cookieOptions);
    await care.logout(session);
    return { ok: true };
  });
  app.get('/api/today', async request => {
    const session=sessions.get(request)!;
    const before=await care.authority?.(session);
    const today=await care.today(session);
    if(today.profile&&today.role==='client'&&features){
      await features.day.prepare(session).catch(error=>{if(error instanceof ApiError&&[401,403].includes(error.status))throw error;});
    }
    await care.authorize(session);
    const after=await care.authority?.(session);
    if(JSON.stringify(before)!==JSON.stringify(after)||before&&today.profile&&(before.client_id!==today.profile.id||today.role&&before.active_role!==today.role))
      throw new ApiError(403,'scope_changed','Your care scope changed. Refresh My Day.');
    return today.profile?{...today,priority_context:priorityContext(today)}:today;
  });
  app.get('/api/priority-context', async request => priorityContext(await care.today(sessions.get(request)!)));
  registerLocalFeatures(app,{features,sessions,care,speech,voiceOwner:config.planUserId,voiceAccess:async session=>(await voiceAccess(session))?.binding_ref??null,limit});
  registerClientVoiceMetrics(app,{sessions,conversation,runtimeLog:dependencies.runtimeLog,limit});
  registerMicrosoftRoutes(app,{service:microsoft,sessions,origin:config.origin,limit,bindingCookieName:sessionCookieName==='nancy_test_session'?'nancy_test_microsoft_binding':'nancy_microsoft_binding'});
  const requestsService=()=>{
    if(!taskRequests)throw new ApiError(503,'requests_unavailable','Task requests are not available on this care connection.');
    return taskRequests;
  };
  app.get('/api/task-requests',async request=>requestsService().workspace(sessions.get(request)!));
  app.post('/api/task-requests/review',async request=>{
    limit(request,`request-review:${sessions.get(request)!.user_id}`,30);
    return requestsService().review(sessions.get(request)!,taskRequestDraftSchema.parse(request.body));
  });
  app.post('/api/task-requests/commands',async request=>{
    limit(request,`request-command:${sessions.get(request)!.user_id}`,30);
    return requestsService().command(sessions.get(request)!,taskRequestCommandSchema.parse(request.body));
  });
  app.get('/api/task-requests/receipts/:key',async request=>{
    const key=uuid.parse((request.params as {key:string}).key);
    const receipt=await requestsService().receipt(sessions.get(request)!,key);
    if(!receipt)throw new ApiError(404,'not_found','No saved request receipt is available yet. The change is still unconfirmed.');
    return receipt;
  });
  app.get('/api/activity',async request=>{
    if(!care.ledger)throw new ApiError(503,'ledger_unavailable','The activity ledger is unavailable.');
    const {date}=z.object({date:activityDate.optional()}).strict().parse(request.query);
    return care.ledger(sessions.get(request)!,date);
  });
  app.post('/api/activity/commands',async request=>{
    if(!care.activityCommand)throw new ApiError(503,'ledger_unavailable','The activity ledger is unavailable.');
    limit(request,`activity:${sessions.get(request)!.user_id}`,30);
    return care.activityCommand(sessions.get(request)!,activityCommandSchema.parse(request.body));
  });
  app.get('/api/activity/receipts/:key',async request=>{
    if(!care.activityReceipt)throw new ApiError(503,'ledger_unavailable','The activity ledger is unavailable.');
    const key=uuid.parse((request.params as {key:string}).key);
    const receipt=await care.activityReceipt(sessions.get(request)!,key);
    if(!receipt)throw new ApiError(404,'not_found','No saved activity receipt is available yet.');
    return receipt;
  });
  app.get('/api/groceries', async request => care.groceries ? care.groceries(sessions.get(request)!) : { items: [] });
  app.get('/api/preferences',async request=>{
    if(!care.preferences)throw new ApiError(503,'preferences_unavailable','Preferences are not available.');
    return care.preferences(sessions.get(request)!);
  });
  app.post('/api/preferences/commands',async request=>{
    if(!care.preferenceCommand)throw new ApiError(503,'preferences_unavailable','Preferences are not available.');
    limit(request,`preference:${sessions.get(request)!.user_id}`,30);
    return care.preferenceCommand(sessions.get(request)!,preferenceCommandSchema.parse(request.body));
  });
  app.get('/api/preferences/receipts/:key',async request=>{
    const receipt=await care.preferenceReceipt?.(sessions.get(request)!,uuid.parse((request.params as {key:string}).key));
    if(!receipt)throw new ApiError(404,'not_found','No saved preference receipt is available yet.');return receipt;
  });
  for(const action of ['retry','ack','discard'] as const)app.post(`/api/preferences/${action}`,async request=>{
    const {key}=z.object({key:uuid}).strict().parse(request.body),session=sessions.get(request)!;
    limit(request,`preference:${session.user_id}`,30);
    if(action==='retry'&&care.retryPreferenceCommand)return care.retryPreferenceCommand(session,key);
    if(action==='ack'&&care.acknowledgePreferenceCommand){await care.acknowledgePreferenceCommand(session,key);return {ok:true};}
    if(action==='discard'&&care.discardPreferenceCommand)return {discarded:await care.discardPreferenceCommand(session,key)};
    throw new ApiError(503,'preferences_unavailable','Preferences are not available.');
  });
  app.post('/api/groceries', async request => {
    if (!care.addGrocery) throw new ApiError(503, 'groceries_unavailable', 'The grocery list has not been connected.');
    limit(request, `grocery:${sessions.get(request)!.user_id}`, 30);
    return care.addGrocery(sessions.get(request)!, groceryInput.parse(request.body));
  });
  app.post('/api/appointments', async request => {
    if (!care.setAppointment) throw new ApiError(503, 'appointments_unavailable', 'Appointments have not been connected.');
    const input = z.object({ title: z.string().trim().min(1).max(160), starts_at: z.iso.datetime({ offset: true }), idempotency_key: uuid }).strict().parse(request.body);
    return care.setAppointment(sessions.get(request)!, input);
  });
  const localConversation = () => {
    if (!conversation || !speech || !localSpeechReady()) throw new ApiError(503, 'voice_unavailable', 'Nancy’s selected voice connection is unavailable. You can use the buttons.');
    return { conversation, speech };
  };
  const conversationId = (request: FastifyRequest) => uuid.parse((request.params as { id: string }).id);
  app.post('/api/conversation', async request => {
    const {purpose}=z.object({purpose:z.enum(['general','help','suggestions']).default('general')}).strict().parse(request.body);
    limit(request, `conversation:${sessions.get(request)!.user_id}`, 6);
    return localConversation().conversation.start(sessions.get(request)!,purpose);
  });
  app.get('/api/nancy-suggestions',async request=>{if(!(care instanceof LocalCare))throw new ApiError(503,'suggestions_unavailable','Suggestions are unavailable.');return new NancySuggestions(care.pool).workspace(sessions.get(request)!);});
  app.post('/api/conversation/:id/turn', async (request, reply) => {
    const { text, turn_id } = z.object({ text: z.string().trim().min(1).max(2000), turn_id: uuid }).strict().parse(request.body);
    limit(request, `turn:${sessions.get(request)!.user_id}`, 20);
    const id = conversationId(request), session = sessions.get(request)!;
    const active = localConversation().conversation;
    reply.raw.once('close', () => { if (!reply.raw.writableFinished) active.cancelTurn(id, session, turn_id); });
    return active.turn(id, session, turn_id, text);
  });
  app.post('/api/conversation/:id/audio', { bodyLimit: 2100000 }, async (request, reply) => {
    const { wav, turn_id } = z.object({ wav: z.string().min(60).max(2000000).regex(/^[A-Za-z0-9+/]+={0,2}$/), turn_id: uuid }).strict().parse(request.body);
    limit(request, `turn:${sessions.get(request)!.user_id}`, 20);
    const { conversation, speech } = localConversation();
    const audio = Buffer.from(wav, 'base64');
    const id = conversationId(request), session = sessions.get(request)!;
    const controller = new AbortController(), key = `${session.session_id}:${id}:asr`;
    if (speaking.has(key)) throw new ApiError(409, 'speech_busy', 'Nancy is still listening to the last turn.');
    speaking.set(key, controller);
    reply.raw.once('close', () => { if (!reply.raw.writableFinished) { controller.abort(); conversation.cancelTurn(id, session, turn_id); } });
    try { return await conversation.turn(id, session, turn_id, async () => {
      const asrStarted = performance.now(); let outcome: 'ok'|'error' = 'error';
      try { const text = await speech.transcribe(audio, controller.signal); outcome = 'ok'; return text; }
      finally { dependencies.runtimeLog?.record({kind: 'conversation', outcome, actor_id: session.user_id, conversation_id: id, turn_id,
        measurements: {stage: 'asr', duration_ms: performance.now() - asrStarted}}); }
    }, createHash('sha256').update(audio).digest('hex')); }
    finally { if (speaking.get(key) === controller) speaking.delete(key); }
  });
  app.get('/api/conversation/:id/speech', async (request, reply) => {
    const id = conversationId(request), session = sessions.get(request)!;
    const { turn_id, part } = z.object({ turn_id: uuid, part: z.coerce.number().int().min(0).max(31).optional() }).strict().parse(request.query);
    const { conversation, speech } = localConversation();
    const fullText = await conversation.speech(id, session, turn_id);
    const text = part === undefined ? fullText : splitSpeechParts(fullText,conversation.speechPartSize)[part];
    if (!text) throw new ApiError(404, 'reply_part_missing', 'That part of the reply is unavailable.');
    const cacheKey = `${session.session_id}:${id}:${turn_id}:${part ?? 'full'}`;
    let audio = audioCache.get(cacheKey);
    if (!audio) {
      limit(request, `speech:${session.user_id}`, 60);
      const key = `${session.session_id}:${id}:tts`;
      if (speaking.has(key)) throw new ApiError(409, 'speech_busy', 'Nancy is still preparing that reply.');
      const controller = new AbortController(); speaking.set(key, controller);
      reply.raw.once('close', () => { if (!reply.raw.writableFinished) controller.abort(); });
      try {
        audio = await conversation.preparedAudio(id, session, turn_id, text, controller.signal)
          ?? await speech.synthesize(text, controller.signal);
        await conversation.speech(id, session, turn_id);
      }
      finally { if (speaking.get(key) === controller) speaking.delete(key); }
      audioCache.set(cacheKey, audio);
      while (audioCache.size > 4) audioCache.delete(audioCache.keys().next().value!);
    }
    return reply.type('audio/wav').send(audio);
  });
  app.post('/api/conversation/:id/played', async request => {
    const { reply_id } = z.object({ reply_id: uuid }).strict().parse(request.body);
    localConversation().conversation.played(conversationId(request), sessions.get(request)!, reply_id); return { ok: true };
  });
  app.post('/api/conversation/:id/received', async request => {
    const {reply_id}=z.object({reply_id:uuid}).strict().parse(request.body);
    await localConversation().conversation.received(conversationId(request),sessions.get(request)!,reply_id);
    return {ok:true};
  });
  app.post('/api/conversation/:id/interrupt', async request => {
    z.object({}).strict().parse(request.body);
    const id = conversationId(request), session = sessions.get(request)!;
    localConversation().conversation.interrupt(id, session);
    for (const [key, controller] of speaking) if (key.startsWith(`${session.session_id}:${id}:`)) { speaking.delete(key); controller.abort(); }
    for (const key of audioCache.keys()) if (key.startsWith(`${session.session_id}:${id}:`)) audioCache.delete(key);
    return { ok: true };
  });
  app.delete('/api/conversation/:id', async request => {
    const id = conversationId(request), session = sessions.get(request)!;
    conversation?.end(id, session);
    for (const [key, controller] of speaking) if (key.startsWith(`${session.session_id}:${id}:`)) { controller.abort(); speaking.delete(key); }
    for (const key of audioCache.keys()) if (key.startsWith(`${session.session_id}:${id}:`)) audioCache.delete(key);
    return { ok: true };
  });
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
    if (config.voiceTransport === 'local') throw new ApiError(410, 'legacy_voice_disabled', 'Use Talk to Nancy for the selected Heart voice.');
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
    if (/^\/preview(?:[/.]|$)/i.test(pathname) || /^\/assets\/(?:preview|DevicePreview|StreamingAudition)[-.]/i.test(pathname)) return reply.code(404).send();
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root + sep)) return reply.code(404).send();
    try {
      if (!(await stat(path)).isFile()) return reply.code(404).send();
      const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
      if (!mime[extname(path)]) return reply.code(404).send();
      return reply.type(mime[extname(path)]).send(await readFile(path));
    } catch { return reply.code(404).type('text/plain').send('This page is unavailable.'); }
  });
  app.addHook('onClose', async () => { clearInterval(limiter); for (const controller of speaking.values()) controller.abort(); audioCache.clear(); conversation?.close(); await speech?.close(); await voice.close(); await dependencies.runtimeLog?.close(); await care.close?.(); });
  return app;
}
