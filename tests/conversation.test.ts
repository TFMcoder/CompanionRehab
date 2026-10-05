import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ConversationService } from '../src/server/conversation.js';
import type { CareService } from '../src/server/care-access.js';
import type { Reasoner } from '../src/server/plan-reasoner.js';
import type { CompletedTurn } from '../src/server/chatgpt-plan/inference.js';
import type { Session } from '../src/server/session.js';
import type { Today } from '../src/shared/contracts.js';
const session: Session = { user_id: randomUUID(), session_id: randomUUID(), issued_at: 1, expires_at: 9999999999, access_token: 'test', refresh_token: 'test' };
const today: Today = { profile: { id: session.user_id, display_name: 'Test', time_zone: 'America/Toronto', preferences: '', revision: 1 }, local_date: '2026-10-05', tasks: [], meal_options: [], checkin: { id: randomUUID(), local_date: '2026-10-05', revision: 2, accepted: null, proposal: { id: randomUUID(), created_at: '', task_ids: [], tasks: [], meals: [] } } };
const textResponse = (text: string) => ({ completed: true as const, model: 'gpt-6-sol' as const, effort: 'high' as const, text, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] });
const callResponse = (name: string, args = {}) => ({ ...textResponse(''), output: [{ type: 'function_call', name, call_id: randomUUID(), arguments: JSON.stringify(args) }] });
let service: ConversationService | undefined;
afterEach(() => service?.close());
function make(responses: CompletedTurn[] = [textResponse('What would you like for breakfast?')]) {
  const care = { authorize: vi.fn(async s => s), today: vi.fn(async () => structuredClone(today)), command: vi.fn(async () => ({ result: 'accepted' })), addGrocery: vi.fn(async () => ({ item: { id: randomUUID(), name: 'Milk' } })) } as unknown as CareService;
  const respond = vi.fn(); for (const response of responses) respond.mockResolvedValueOnce(response);
  service = new ConversationService(care, { respond } as Reasoner, session.user_id, () => new Date('2026-10-05T14:00:00Z'));
  return { care, respond, service };
}
describe('Nancy conversation orchestration', () => {
  it('opens without a check-in write or workflow selection, binds owner and login', async () => {
    const { service, care, respond } = make(); const start = await service.start(session);
    expect(start.text).toContain('What would you like to do?'); expect(start.text).toContain('breakfast');
    expect(care.command).not.toHaveBeenCalled(); expect(respond).not.toHaveBeenCalled();
    await expect(service.start({ ...session, user_id: randomUUID() })).rejects.toMatchObject({ status: 403 });
    await expect(service.speech(start.session_id, { ...session, session_id: randomUUID() }, start.reply_id)).rejects.toMatchObject({ status: 404 });
  });
  it('reads fresh context on each turn and preserves conversation while navigating', async () => {
    const { service, respond, care } = make([callResponse('navigate', { view: 'meals' }), textResponse('Here are your meal choices.'), textResponse('Let’s discuss tasks instead.')]);
    const start = await service.start(session);
    const first = await service.turn(start.session_id, session, randomUUID(), 'I would like to see the meal screen');
    expect(first.navigate).toBe('meals');
    await service.turn(start.session_id, session, randomUUID(), 'Actually, tasks');
    expect(respond.mock.calls[2][0]).toEqual(expect.arrayContaining([expect.objectContaining({ content: 'I would like to see the meal screen' })]));
    expect(care.today).toHaveBeenCalledTimes(4);
  });
  it('opens a known view immediately without a model round trip', async () => {
    const { service, respond } = make(); const start = await service.start(session);
    expect((await service.turn(start.session_id, session, randomUUID(), 'Please show my meals.')).navigate).toBe('meals');
    expect(respond).not.toHaveBeenCalled();
  });
  it('requires completed exact review then explicit acceptance, with idempotent replay', async () => {
    const { service, care } = make([callResponse('review_day_plan')]);
    const start = await service.start(session);
    const review = await service.turn(start.session_id, session, randomUUID(), 'Review my plan');
    service.played(start.session_id, session, review.reply_id);
    const key = randomUUID();
    const result = await service.turn(start.session_id, session, key, 'Accept this plan');
    expect(result.text).toContain('saved');
    expect(care.command).toHaveBeenCalledWith(session, expect.objectContaining({ type: 'accept_day_plan', expected_revision: 2, payload: { proposal_id: today.checkin!.proposal!.id } }));
    expect(await service.turn(start.session_id, session, key, 'Accept this plan')).toEqual(result);
    expect(care.command).toHaveBeenCalledTimes(1);
    await expect(service.turn(start.session_id, session, key, 'Changed')).rejects.toMatchObject({ code: 'changed_turn' });
  });
  it('does not accept an interrupted review or model-invented accept tool', async () => {
    const { service, care } = make([callResponse('review_day_plan'), callResponse('accept_day_plan'), textResponse('Please review the plan first.')]);
    const start = await service.start(session);
    await service.turn(start.session_id, session, randomUUID(), 'Review');
    const result = await service.turn(start.session_id, session, randomUUID(), 'Accept this plan');
    expect(result.text).toContain('review'); expect(care.command).not.toHaveBeenCalled();
  });
  it('waits for grocery readback confirmation and never repeats a committed add on retry', async () => {
    const { service, care } = make([callResponse('suggest_grocery', { name: 'Milk', quantity: '1 litre' })]);
    const start = await service.start(session);
    const ask = await service.turn(start.session_id, session, randomUUID(), 'We have no milk');
    expect(care.addGrocery).not.toHaveBeenCalled(); service.played(start.session_id, session, ask.reply_id);
    const key = randomUUID(); await service.turn(start.session_id, session, key, 'Yes please'); await service.turn(start.session_id, session, key, 'Yes please');
    expect(care.addGrocery).toHaveBeenCalledTimes(1);
  });
  it('suppresses writes from a late model result after End', async () => {
    const { service, respond, care } = make([]);
    let finish!: (value: unknown) => void;
    respond.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const start = await service.start(session);
    const pending = service.turn(start.session_id, session, randomUUID(), 'Plan today');
    await vi.waitFor(() => expect(respond).toHaveBeenCalled());
    service.end(start.session_id, session); finish(callResponse('propose_day_plan'));
    await expect(pending).rejects.toMatchObject({ code: 'conversation_ended' }); expect(care.command).not.toHaveBeenCalled();
  });
});
