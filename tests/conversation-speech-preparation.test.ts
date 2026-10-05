import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ConversationService } from '../src/server/conversation.js';
import type { CareService } from '../src/server/care-access.js';
import type { Reasoner } from '../src/server/plan-reasoner.js';
import type { CompletedTurn } from '../src/server/chatgpt-plan/inference.js';
import type { Session } from '../src/server/session.js';

const session: Session = { user_id: randomUUID(), session_id: randomUUID(), issued_at: 1, expires_at: 9999999999, access_token: 'test', refresh_token: 'test' };
const response = (text: string): CompletedTurn => ({ completed: true, model: 'gpt-6-sol', effort: 'high', text,
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] });
let service: ConversationService;
afterEach(() => service?.close());
function fixture(prepare = vi.fn(async (_text: string, _signal: AbortSignal) => Buffer.from('synthetic-wave'))) {
  const care = { authorize: vi.fn(async s => s), today: vi.fn(async () => ({
    profile: { id: session.user_id, display_name: 'Synthetic', time_zone: 'America/Toronto', preferences: '', revision: 1 },
    local_date: '2026-10-05', tasks: [], meal_options: [], checkin: null,
  })) } as unknown as CareService;
  const respond = vi.fn<Reasoner['respond']>();
  service = new ConversationService(care, { respond }, session.user_id, undefined, prepare);
  return { prepare, respond, care };
}

describe('validated speculative speech preparation', () => {
  it('prepares during generation, then releases only the matching first part of a final reply', async () => {
    const { respond, prepare } = fixture();
    let finish!: (turn: CompletedTurn) => void;
    respond.mockImplementationOnce(async (_i, _p, _t, _s, delta) => {
      delta?.('What would you like for breakfast? ');
      return new Promise(resolve => { finish = resolve; });
    });
    const start = await service.start(session);
    const pending = service.turn(start.session_id, session, randomUUID(), 'Help me decide');
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    await expect(service.preparedAudio(start.session_id, session, randomUUID(), 'What would you like for breakfast?', new AbortController().signal)).rejects.toMatchObject({ code: 'reply_expired' });
    finish(response('What would you like for breakfast? We can discuss a few options.'));
    const reply = await pending;
    expect(await service.preparedAudio(start.session_id, session, reply.reply_id, 'What would you like for breakfast? ', new AbortController().signal)).toEqual(Buffer.from('synthetic-wave'));
    expect(await service.preparedAudio(start.session_id, session, reply.reply_id, 'We can discuss a few options.', new AbortController().signal)).toBeUndefined();
    await expect(service.preparedAudio(start.session_id, { ...session, session_id: randomUUID() }, reply.reply_id, reply.text, new AbortController().signal)).rejects.toMatchObject({ status: 404 });
  });

  it('discards a streamed phrase when the completed response differs or uses the wrong model', async () => {
    const { respond, prepare } = fixture();
    respond.mockImplementationOnce(async (_i, _p, _t, _s, delta) => { delta?.('A tentative answer. '); return response('A different final answer.'); });
    const start = await service.start(session);
    const reply = await service.turn(start.session_id, session, randomUUID(), 'Help me decide');
    expect(prepare.mock.calls[0][1].aborted).toBe(true);
    expect(await service.preparedAudio(start.session_id, session, reply.reply_id, reply.text, new AbortController().signal)).toBeUndefined();
    respond.mockImplementationOnce(async (_i, _p, _t, _s, delta) => { delta?.('Another tentative answer. '); return { ...response('Another tentative answer.'), model: 'unselected' } as unknown as CompletedTurn; });
    await expect(service.turn(start.session_id, session, randomUUID(), 'Try again')).rejects.toMatchObject({ code: 'wrong_model' });
    expect(prepare.mock.calls[1][1].aborted).toBe(true);
  });

  it('cancels tentative audio on interruption and prevents late promotion', async () => {
    const { respond, prepare } = fixture(); let finish!: (turn: CompletedTurn) => void;
    respond.mockImplementationOnce(async (_i, _p, _t, _s, delta) => { delta?.('A tentative answer. '); return new Promise(resolve => { finish = resolve; }); });
    const start = await service.start(session);
    const pending = service.turn(start.session_id, session, randomUUID(), 'Help me decide');
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    service.interrupt(start.session_id, session);
    expect(prepare.mock.calls[0][1].aborted).toBe(true);
    finish(response('A tentative answer. More details.'));
    await expect(pending).rejects.toMatchObject({ code: 'turn_interrupted' });
    expect((await service.turn(start.session_id, session, randomUUID(), 'Can you show me my tasks?')).navigate).toBe('tasks');
  });

  it('invalidates prepared audio on logout/end and treats preparation failure as an optimization miss', async () => {
    const { respond, prepare } = fixture();
    prepare.mockRejectedValueOnce(new Error('worker busy'));
    respond.mockImplementation(async (_i, _p, _t, _s, delta) => { delta?.('A final answer. '); return response('A final answer. More details.'); });
    const start = await service.start(session);
    const reply = await service.turn(start.session_id, session, randomUUID(), 'Help me decide');
    expect(await service.preparedAudio(start.session_id, session, reply.reply_id, 'A final answer. ', new AbortController().signal)).toBeUndefined();
    const next = await service.turn(start.session_id, session, randomUUID(), 'Tell me more');
    service.endLogin(session.session_id);
    expect(prepare.mock.calls[1][1].aborted).toBe(true);
    await expect(service.preparedAudio(start.session_id, session, next.reply_id, 'A final answer. ', new AbortController().signal)).rejects.toMatchObject({ status: 404 });
  });

  it('discards tentative narration when the model chooses a tool instead of a final message', async () => {
    const { respond, prepare } = fixture();
    respond.mockImplementationOnce(async (_i, _p, _t, _s, delta) => {
      delta?.('An unvalidated claim. ');
      return { ...response(''), output: [{ type: 'function_call', name: 'navigate', call_id: randomUUID(), arguments: '{"view":"tasks"}' }] };
    });
    const start = await service.start(session);
    const reply = await service.turn(start.session_id, session, randomUUID(), 'Where can I find what needs doing?');
    expect(reply.text).toBe('Here are your tasks.');
    expect(prepare.mock.calls[0][1].aborted).toBe(true);
    expect(await service.preparedAudio(start.session_id, session, reply.reply_id, reply.text, new AbortController().signal)).toBeUndefined();
  });
});
