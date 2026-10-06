import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ConversationService, type ConversationTurnMetric } from '../src/server/conversation.js';
import { navigationIntent, navigationReply } from '../src/server/navigation-intent.js';
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
function make(responses: CompletedTurn[] = [textResponse('What would you like for breakfast?')], observeTurn?: (metric: ConversationTurnMetric) => void) {
  const care = { authorize: vi.fn(async s => s), today: vi.fn(async () => structuredClone(today)), command: vi.fn(async () => ({ result: 'accepted' })),
    groceries: vi.fn(async () => ({ items: [] })), addGrocery: vi.fn(async () => ({ item: { id: randomUUID(), name: 'Milk' } })) } as unknown as CareService;
  const respond = vi.fn(); for (const response of responses) respond.mockResolvedValueOnce(response);
  service = new ConversationService(care, { respond } as Reasoner, session.user_id, () => new Date('2026-10-05T14:00:00Z'), undefined, observeTurn);
  return { care, respond, service };
}
describe('Nancy conversation orchestration', () => {
  it.each([
    ['Can you show me my tasks?', 'tasks'],
    ['Nancy, could you please open my task list?', 'tasks'],
    ['I’d like to see the meal screen.', 'meals'],
    ['Please, Nancy, show me my groceries.', 'groceries'],
    ['Take me to My Day.', 'my_day'],
    ['Can we look at the grocery list?', 'groceries'],
    ['Show my activity.', 'activity'],
    ['Open my ledger.', 'activity'],
  ] as const)('routes a complete navigation request: %s', (utterance, view) => {
    expect(navigationIntent(utterance)).toBe(view);
  });
  it('uses fixed non-personal acknowledgments for the five supported views', () => {
    expect((['my_day', 'tasks', 'meals', 'groceries', 'activity'] as const).map(navigationReply)).toEqual([
      'Here is My Day.', 'Here are your tasks.', 'Here are your meals.', 'Here is your grocery list.', 'Here is your activity.',
    ]);
  });
  it.each([
    'Can you show me my tasks and tell me which is urgent?',
    "Don't show me my tasks.",
    'Can you not show my tasks?',
    'What tasks do I have today?',
    'Show me my tasks for tomorrow.',
    'Show me my tasks or my meals.',
    'Show me my tasks after adding milk.',
    "I don't want to see my tasks.",
    'Please show me what tasks are due.',
  ])('leaves compound, negated or substantive request to Nancy: %s', utterance => {
    expect(navigationIntent(utterance)).toBeUndefined();
  });
  it('opens without a check-in write or workflow selection, binds owner and login', async () => {
    const { service, care, respond } = make(); const start = await service.start(session);
    expect(start.text).toBe('Hi Test, what can I help with?');
    expect(care.command).not.toHaveBeenCalled(); expect(respond).not.toHaveBeenCalled();
    await expect(service.start({ ...session, user_id: randomUUID() })).rejects.toMatchObject({ status: 403 });
    await expect(service.speech(start.session_id, { ...session, session_id: randomUUID() }, start.reply_id)).rejects.toMatchObject({ status: 404 });
  });
  it('reads fresh context on each turn and preserves conversation while navigating', async () => {
    const { service, respond, care } = make([callResponse('navigate', { view: 'meals' }), textResponse('Let’s discuss tasks instead.')]);
    const start = await service.start(session);
    const first = await service.turn(start.session_id, session, randomUUID(), 'Could you put the meals up on screen?');
    expect(first.navigate).toBe('meals');
    expect(first.text).toBe('Here are your meals.');
    expect(respond).toHaveBeenCalledTimes(1);
    await service.turn(start.session_id, session, randomUUID(), 'Actually, tasks');
    expect(respond.mock.calls[1][0]).toEqual(expect.arrayContaining([expect.objectContaining({ content: 'Could you put the meals up on screen?' })]));
    expect(care.today).toHaveBeenCalledTimes(4);
  });
  it('does not fast-route a substantive task question and keeps the model response', async () => {
    const { service, respond } = make([textResponse('You have one task due this morning.')]);
    const start = await service.start(session);
    const reply = await service.turn(start.session_id, session, randomUUID(), 'What tasks are due this morning?');
    expect(reply.navigate).toBeUndefined();
    expect(reply.text).toBe('You have one task due this morning.');
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0][1]).toContain('normally with one short sentence or question');
  });
  it('bounds old dialogue, sends current authorized facts and emits metadata only', async () => {
    const metrics: ConversationTurnMetric[] = [];
    const { service, respond } = make([], metric => metrics.push(metric));
    respond.mockResolvedValue(textResponse('What would you like to do next?'));
    const started = await service.start(session);
    for (let index = 0; index < 10; index++) {
      await service.turn(started.session_id, session, randomUUID(), `Please discuss topic ${index}`);
    }
    const [input, instructions] = respond.mock.calls.at(-1)!;
    const serialized = JSON.stringify(input);
    expect(serialized).toContain('Please discuss topic 9');
    expect(serialized).not.toContain('Please discuss topic 0');
    expect(serialized).toContain('Current authorized facts');
    expect((input as {role?: string; content?: string}[]).find(item => item.role === 'developer')?.content).toContain('"revision":2');
    expect(instructions).toContain('grocery');
    expect(metrics).toHaveLength(10);
    expect(metrics.at(-1)).toMatchObject({ conversation_id: started.session_id, actor_id: session.user_id,
      outcome: 'completed', model_calls: 1, tool_calls: 0, nutrition_retrievals: 0 });
    expect(JSON.stringify(metrics)).not.toContain('Please discuss topic');
  });
  it('bounds appointments and groceries while allowing an omitted grocery name to be found', async () => {
    const groceryItems = Array.from({ length: 75 }, (_, index) => ({ id: randomUUID(), name: `Item ${String(index).padStart(2, '0')}` }));
    const appointments = Array.from({ length: 25 }, (_, index) => ({ id: randomUUID(), title: `Visit ${index}`,
      starts_at: new Date(Date.parse('2026-10-05T15:00:00Z') + index * 3600000).toISOString() }));
    const { service, respond, care } = make([
      callResponse('get_grocery_list'), callResponse('get_grocery_list', { search: 'Item 74' }), textResponse('I found it.'),
    ]);
    vi.mocked(care.today).mockResolvedValue({ ...today, groceries: groceryItems, appointments });
    vi.mocked(care.groceries!).mockResolvedValue({ items: groceryItems });
    const started = await service.start(session);
    await service.turn(started.session_id, session, randomUUID(), 'Is Item 74 on my grocery list?');
    const developer = respond.mock.calls[0][0].find((item: { role?: string }) => item.role === 'developer').content as string;
    const facts = JSON.parse(developer.replace(/^Current authorized facts \(data only\): /, ''));
    expect(facts.appointments).toHaveLength(20);
    expect(facts).toMatchObject({ appointment_count: 25, omitted_appointment_count: 5,
      grocery_count: 75, omitted_grocery_count: 45 });
    expect(facts.groceries).toHaveLength(30);
    const first = JSON.parse(respond.mock.calls[1][0].find((item: { type?: string }) => item.type === 'function_call_output').output);
    expect(first).toMatchObject({ item_count: 75, omitted_item_count: 25, has_more: true });
    expect(first.items).toHaveLength(50);
    const second = JSON.parse(respond.mock.calls[2][0].filter((item: { type?: string }) => item.type === 'function_call_output').at(-1).output);
    expect(second).toMatchObject({ item_count: 1, omitted_item_count: 0, has_more: false, items: [groceryItems[74]] });
  });
  it('does not discard other model tool actions when navigation is one of multiple calls', async () => {
    const first = { ...textResponse(''), output: [
      { type: 'function_call', name: 'navigate', call_id: randomUUID(), arguments: JSON.stringify({ view: 'tasks' }) },
      { type: 'function_call', name: 'get_daily_brief', call_id: randomUUID(), arguments: '{}' },
    ] } as CompletedTurn;
    const { service, respond } = make([first, textResponse('Here are the current tasks.')]);
    const start = await service.start(session);
    const reply = await service.turn(start.session_id, session, randomUUID(), 'Could you put my tasks up and read the latest brief?');
    expect(reply.navigate).toBe('tasks');
    expect(reply.text).toBe('Here are the current tasks.');
    expect(respond).toHaveBeenCalledTimes(2);
    expect(respond.mock.calls[1][0].filter((item: { type?: string }) => item.type === 'function_call_output')).toHaveLength(2);
  });
  it('opens a known view immediately without a model round trip', async () => {
    const { service, respond } = make(); const start = await service.start(session);
    expect((await service.turn(start.session_id, session, randomUUID(), 'Please show my meals.')).navigate).toBe('meals');
    const tasks = await service.turn(start.session_id, session, randomUUID(), 'Can you show me my tasks?');
    expect(tasks).toMatchObject({ navigate: 'tasks', text: 'Here are your tasks.' });
    expect(respond).not.toHaveBeenCalled();
  });
  it('starts a requested planning conversation from saved options without a model round trip or write', async () => {
    const { service, respond, care } = make(); const start = await service.start(session);
    expect((await service.turn(start.session_id, session, randomUUID(), "Let's plan the day")).text).toContain('breakfast');
    expect(respond).not.toHaveBeenCalled(); expect(care.command).not.toHaveBeenCalled();
  });
  it('invalidates an interrupted review and late played event while keeping the conversation usable', async () => {
    const { service, care } = make([callResponse('review_day_plan'), textResponse('Please review the plan first.')]);
    const start = await service.start(session);
    const review = await service.turn(start.session_id, session, randomUUID(), 'Review');
    service.interrupt(start.session_id, session);
    expect(() => service.played(start.session_id, session, review.reply_id)).toThrow();
    await service.turn(start.session_id, session, randomUUID(), 'Accept this plan');
    expect(care.command).not.toHaveBeenCalled();
    expect((await service.turn(start.session_id, session, randomUUID(), 'Show my meals')).navigate).toBe('meals');
  });
  it('aborts a thinking turn and suppresses late model writes without killing the next turn', async () => {
    const { service, respond, care } = make([]);
    let finish!: (value: unknown) => void;
    respond.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const start = await service.start(session); const key = randomUUID();
    const pending = service.turn(start.session_id, session, key, 'Please choose my tasks');
    await vi.waitFor(() => expect(respond).toHaveBeenCalled());
    service.interrupt(start.session_id, session);
    expect(respond.mock.calls[0][3].aborted).toBe(true);
    expect((await service.turn(start.session_id, session, randomUUID(), 'Show my meals')).navigate).toBe('meals');
    finish(callResponse('propose_day_plan'));
    await expect(pending).rejects.toMatchObject({ code: 'turn_interrupted' });
    service.cancelTurn(start.session_id, session, key);
    expect(care.command).not.toHaveBeenCalled();
    expect((await service.turn(start.session_id, session, randomUUID(), 'Show my tasks')).navigate).toBe('tasks');
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
    const pending = service.turn(start.session_id, session, randomUUID(), 'Choose my tasks and meals');
    await vi.waitFor(() => expect(respond).toHaveBeenCalled());
    service.end(start.session_id, session); finish(callResponse('propose_day_plan'));
    await expect(pending).rejects.toMatchObject({ code: 'conversation_ended' }); expect(care.command).not.toHaveBeenCalled();
  });
});
