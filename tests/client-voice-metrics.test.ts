import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { registerClientVoiceMetrics } from '../src/server/client-voice-metrics';
import { voiceTimingMetric } from '../src/client/voice-timing';

describe('scoped client timing endpoint', () => {
  it('derives the actor and verifies every retained reply before de-duplicating metadata', async () => {
    const app = Fastify(), sessions = new WeakMap(), record = vi.fn(), speech = vi.fn(async () => 'Never logged');
    const actor = randomUUID(), session = {user_id:actor,session_id:randomUUID()}, id = randomUUID(), reply = randomUUID();
    app.addHook('onRequest',async req=>{sessions.set(req,session);});
    registerClientVoiceMetrics(app,{sessions,conversation:{speech} as any,runtimeLog:{record} as any,limit:vi.fn()});
    const payload=voiceTimingMetric({inputMode:'typed',inputAt:10,speechEndedAt:null,requestAt:10,repliedAt:30},{reply_id:reply},40,undefined);
    try {
      for(let i=0;i<2;i++)expect((await app.inject({method:'POST',url:`/api/conversation/${id}/timing`,payload})).statusCode).toBe(200);
      expect(speech).toHaveBeenCalledTimes(2);expect(speech).toHaveBeenCalledWith(id,session,reply);
      expect(record).toHaveBeenCalledTimes(1);expect(record.mock.calls[0][0]).toMatchObject({actor_id:actor,conversation_id:id,turn_id:reply,measurements:{stage:'client_playback'}});
      expect(JSON.stringify(record.mock.calls)).not.toContain('Never logged');
      speech.mockRejectedValueOnce(new Error('Revoked'));
      expect((await app.inject({method:'POST',url:`/api/conversation/${id}/timing`,payload})).statusCode).toBe(500);
      expect(record).toHaveBeenCalledTimes(1);
    } finally {await app.close();}
  });
});
