import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Session } from './session.js';
import type { ConversationService } from './conversation.js';
import type { RuntimeLog } from './telemetry.js';
import { clientVoiceMetricSchema } from '../shared/client-voice-metrics.js';
import { uuid } from '../shared/contracts.js';
import { ApiError } from './errors.js';

/** Same authenticated session/reply authority as speech; a browser cannot assign an actor. */
export function registerClientVoiceMetrics(app: FastifyInstance, options: {
  sessions: WeakMap<FastifyRequest, Session>; conversation?: Pick<ConversationService,'speech'>; runtimeLog?: RuntimeLog;
  limit: (request: FastifyRequest, key: string, maximum: number) => void;
}) {
  const recorded = new Set<string>();
  app.post('/api/conversation/:id/timing', async request => {
    const session = options.sessions.get(request)!;
    options.limit(request, `voice-timing:${session.user_id}`, 40);
    const id = uuid.parse((request.params as {id: string}).id), metric = clientVoiceMetricSchema.parse(request.body);
    if (!options.conversation) throw new ApiError(503, 'voice_unavailable', 'Nancy voice is unavailable.');
    // speech() checks login, current grants, inference binding and retained reply.
    await options.conversation.speech(id, session, metric.reply_id);
    const key = `${session.session_id}:${id}:${metric.reply_id}`;
    if (!recorded.has(key)) {
      recorded.add(key); while (recorded.size > 512) recorded.delete(recorded.values().next().value!);
      const {reply_id, ...measurements} = metric;
      options.runtimeLog?.record({kind: 'conversation', outcome: 'ok', actor_id: session.user_id,
        conversation_id: id, turn_id: reply_id, measurements: {stage: 'client_playback', ...measurements}});
    }
    return {ok: true};
  });
}
