import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { VoiceService } from '../src/server/voice.js';
import { configFromEnv } from '../src/server/config.js';
import type { Supabase } from '../src/server/supabase.js';
import type { Session } from '../src/server/session.js';

class Socket extends EventEmitter {
  readyState = WebSocket.OPEN;
  sent: any[] = [];
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { if (this.readyState === WebSocket.OPEN) { this.readyState = WebSocket.CLOSED as 1; this.emit('close'); } }
  event(value: unknown) { this.emit('message', Buffer.from(JSON.stringify(value))); }
}
const session: Session = { user_id: randomUUID(), session_id: randomUUID(), issued_at: Date.now() / 1000, expires_at: Date.now() / 1000 + 3600, access_token: 'synthetic-user-token', refresh_token: 'synthetic-refresh' };
function harness() {
  const config = configFromEnv({ OPENAI_API_KEY: 'synthetic-server-key', VOICE_SESSION_MINUTES: '1', VOICE_DAILY_MINUTES: '2' });
  const care = { authorize: vi.fn(async s => s), today: vi.fn(async () => ({ profile: { id: session.user_id }, local_date: '2026-09-29', tasks: [], meal_options: [], checkin: null })), command: vi.fn(async c => ({ command_id: c.idempotency_key, result: 'resumed' })), receipt: vi.fn() } as unknown as Supabase;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => String(url).endsWith('/hangup') ? new Response(null, { status: 200 }) : new Response('synthetic-answer', { status: 201, headers: { location: '/v1/realtime/calls/rtc_synthetic' } }));
  const socket = new Socket();
  const connect = vi.fn(() => { queueMicrotask(() => socket.emit('open')); return socket as unknown as WebSocket; });
  const service = new VoiceService(config, care, fetcher, connect);
  return { config, care, fetcher, socket, connect, service };
}
describe('Realtime server adapter (synthetic provider)', () => {
  it('attaches authenticated sideband before returning SDP, batches tool results and ends only for its owner', async () => {
    const h = harness();
    try {
      const result = await h.service.start(session, 'synthetic-offer');
      expect(result.sdp).toBe('synthetic-answer');
      const form = h.fetcher.mock.calls[0][1]!.body as FormData;
      const settings = JSON.parse(form.get('session') as string);
      expect(settings.audio.input.transcription.model).toBe('gpt-4o-mini-transcribe');
      expect(settings.audio.output.voice).toBe('marin');
      expect(h.connect).toHaveBeenCalledWith('wss://api.openai.com/v1/realtime?call_id=rtc_synthetic', expect.objectContaining({ headers: { Authorization: 'Bearer synthetic-server-key' } }));
      const event = { type: 'response.done', response: { status: 'completed', output: [
        { type: 'function_call', name: 'get_daily_brief', arguments: '{}', call_id: 'brief' },
        { type: 'function_call', name: 'start_or_resume_checkin', arguments: '{}', call_id: 'start' },
      ] } };
      h.socket.event(event);
      await vi.waitFor(() => expect(h.socket.sent.filter(x => x.type === 'response.create')).toHaveLength(1));
      expect(h.socket.sent.filter(x => x.type === 'conversation.item.create')).toHaveLength(2);
      expect(h.care.command).toHaveBeenCalledTimes(1);
      h.socket.event(event);
      await vi.waitFor(() => expect(h.socket.sent.filter(x => x.type === 'response.create')).toHaveLength(2));
      expect(h.care.command).toHaveBeenCalledTimes(1);
      await h.service.end(result.session_id, randomUUID()); expect(h.service.status(result.session_id, session.user_id).active).toBe(true);
      await h.service.endLogin(session.session_id); expect(h.service.status(result.session_id, session.user_id).active).toBe(false);
      expect(h.fetcher.mock.calls.some(([url]) => String(url).endsWith('/rtc_synthetic/hangup'))).toBe(true);
    } finally { await h.service.close(); }
  });
  it('refuses a second simultaneous conversation and shuts down on provider failure', async () => {
    const h = harness();
    try {
      const result = await h.service.start(session, 'synthetic-offer');
      await expect(h.service.start(session, 'another-offer')).rejects.toMatchObject({ code: 'already_talking' });
      h.socket.event({ type: 'error', error: { message: 'synthetic failure' } });
      await vi.waitFor(() => expect(h.service.status(result.session_id, session.user_id).active).toBe(false));
      expect(h.care.command).not.toHaveBeenCalled();
    } finally { await h.service.close(); }
  });
  it('refuses to execute incomplete response tools and unavailable voice', async () => {
    const h = harness();
    try {
      await h.service.start(session, 'synthetic-offer');
      h.socket.event({ type: 'response.done', response: { status: 'cancelled', output: [{ type: 'function_call', name: 'start_or_resume_checkin', arguments: '{}', call_id: 'cancelled' }] } });
      expect(h.care.command).not.toHaveBeenCalled();
      const disconnected = new VoiceService({ ...h.config, openaiKey: undefined }, h.care);
      await expect(disconnected.start(session, 'synthetic-offer')).rejects.toMatchObject({ code: 'voice_unavailable' });
    } finally { await h.service.close(); }
  });
});
