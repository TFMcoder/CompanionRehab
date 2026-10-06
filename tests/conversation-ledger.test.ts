import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ConversationService, type ConversationTurnMetric } from '../src/server/conversation.js';
import { unavailable } from '../src/server/errors.js';
import type { CareService } from '../src/server/care-access.js';
import type { CompletedTurn } from '../src/server/chatgpt-plan/inference.js';
import type { Reasoner } from '../src/server/plan-reasoner.js';
import type { Session } from '../src/server/session.js';
import type { ActivityEntry, ActivityLedger, ActivityReceipt } from '../src/shared/activity-contracts.js';
import type { Today } from '../src/shared/contracts.js';

const session: Session = {
  user_id: randomUUID(), session_id: randomUUID(), issued_at: 1, expires_at: 9_999_999_999,
  access_token: 'synthetic-access', refresh_token: 'synthetic-refresh',
};
const mealId = randomUUID();
const mealSourceId = randomUUID();
const taskEntry: ActivityEntry = {
  id: randomUUID(), kind: 'task', title: 'Synthetic morning walk', local_date: '2026-10-05', source_id: randomUUID(),
  meal_slot: null, plan_id: randomUUID(), scheduled_at: '2026-10-05T13:15:00.000Z', status: 'completed', revision: 1,
  unplanned: false, occurred_at: '2026-10-05T13:25:00.000Z', recorded_at: '2026-10-05T13:30:00.000Z',
  updated_at: '2026-10-05T13:30:00.000Z', notes: 'Synthetic completed walk', portion: null, last_action: 'reported',
};
const ledger: ActivityLedger = {
  local_date: '2026-10-05',
  options: [{
    id: mealId, kind: 'meal', title: 'Synthetic oatmeal', local_date: '2026-10-05', source_id: mealSourceId,
    meal_slot: 'breakfast', plan_id: randomUUID(), scheduled_at: null, status: 'pending', revision: 0, unplanned: false,
  }, taskEntry],
  entries: [taskEntry], recent_entries: [taskEntry],
  summary: { tasks_completed: 1, meals_eaten: 0, appointments_attended: 0, deferred: 0 },
};
const today: Today = {
  profile: { id: session.user_id, display_name: 'Synthetic Client', time_zone: 'America/Toronto', preferences: '', revision: 1 },
  local_date: '2026-10-05', tasks: [], meal_options: [], checkin: null, activity_ledger: ledger,
  activity_reports: [{ target_id: taskEntry.source_id!, local_date: '2026-10-05', status: 'completed', occurred_at: taskEntry.occurred_at! }],
};

const textResponse = (text: string): CompletedTurn => ({
  completed: true, model: 'gpt-6-sol', effort: 'high', text,
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
});
const toolResponse = (name: string, args: object, callId = randomUUID()): CompletedTurn => ({
  completed: true, model: 'gpt-6-sol', effort: 'high', text: '',
  output: [{ type: 'function_call', name, call_id: callId, arguments: JSON.stringify(args) }],
});
const recordArgs = (activityId = mealId) => ({
  local_date: '2026-10-05', expected_revision: 0,
  payload: { activity_id: activityId, status: 'completed', occurred_at: '2026-10-05T14:00:00.000Z', notes: 'Ate breakfast', portion: 'one bowl' },
});
const savedEntry: ActivityEntry = {
  ...ledger.options[0], status: 'completed', revision: 1, occurred_at: '2026-10-05T14:00:00.000Z',
  recorded_at: '2026-10-05T14:01:00.000Z', updated_at: '2026-10-05T14:01:00.000Z', notes: 'Ate breakfast',
  portion: 'one bowl', last_action: 'reported',
};

let service: ConversationService | undefined;
afterEach(() => service?.close());

function harness(responses: CompletedTurn[], observeTurn?: (metric: ConversationTurnMetric) => void) {
  const receipt: ActivityReceipt = { command_id: randomUUID(), result: 'reported', entry: savedEntry, replayed: false };
  const care = {
    authorize: vi.fn(async value => value),
    today: vi.fn(async () => structuredClone(today)),
    ledger: vi.fn(async () => structuredClone(ledger)),
    activityCommand: vi.fn(async (_session, command) => ({ ...receipt, command_id: command.idempotency_key })),
    activityReceipt: vi.fn(async () => null),
    command: vi.fn(), receipt: vi.fn(),
  } as unknown as CareService;
  const respond = vi.fn();
  for (const response of responses) respond.mockResolvedValueOnce(response);
  service = new ConversationService(care, { respond } as Reasoner, session.user_id, () => new Date('2026-10-05T14:05:00.000Z'), undefined, observeTurn);
  return { service, care, respond, receipt };
}

async function begin(service: ConversationService) {
  return service.start(session);
}

describe('Nancy factual ledger and nutrition tools', () => {
  it.each(['get_daily_brief', 'get_day_plan'])('keeps %s tool replies within the current fact shape', async name => {
    const { service, respond } = harness([toolResponse(name, {}), textResponse('Breakfast is pending.')]);
    const started = await begin(service);
    await service.turn(started.session_id, session, randomUUID(), 'What is happening today?');
    const output = respond.mock.calls[1][0].find((item: { type?: string }) => item.type === 'function_call_output');
    const facts = JSON.parse(output.output);
    expect(facts.activity_ledger.options.map((item: { id: string }) => item.id)).toContain(mealId);
    expect(facts.activity_ledger.summary.tasks_completed).toBe(1);
    expect(facts.activity_ledger).not.toHaveProperty('entries');
    expect(facts.activity_ledger).not.toHaveProperty('recent_entries');
    expect(facts.checkin).toBeNull();
  });
  it('bounds factual options without repeating notes and lets Nancy find an omitted exact activity', async () => {
    const entries = Array.from({ length: 105 }, (_, index): ActivityEntry => ({ ...taskEntry,
      id: randomUUID(), title: `Synthetic item ${String(index).padStart(3, '0')}`,
      notes: 'Private note '.repeat(40), revision: index + 1 }));
    const fullLedger: ActivityLedger = { ...ledger, options: entries, entries, recent_entries: entries,
      summary: { ...ledger.summary, tasks_completed: entries.length } };
    const expanded: Today = { ...today, activity_ledger: fullLedger };
    const { service, care, respond } = harness([
      toolResponse('get_activity_ledger', {}),
      toolResponse('get_activity_ledger', { search: 'Synthetic item 104' }),
      textResponse('I found the requested activity.'),
    ]);
    vi.mocked(care.today).mockResolvedValue(expanded);
    vi.mocked(care.ledger!).mockResolvedValue(fullLedger);
    const started = await begin(service);
    await service.turn(started.session_id, session, randomUUID(), 'Find my last activity');
    const context = respond.mock.calls[0][0].find((item: { role?: string }) => item.role === 'developer').content as string;
    const facts = JSON.parse(context.replace(/^Current authorized facts \(data only\): /, ''));
    expect(facts.activity_ledger.options).toHaveLength(40);
    expect(facts.activity_ledger).toMatchObject({ option_count: 105, omitted_option_count: 65, has_more: true });
    expect(context).not.toContain('Private note');
    const first = JSON.parse(respond.mock.calls[1][0].find((item: { type?: string }) => item.type === 'function_call_output').output);
    expect(first).toMatchObject({ option_count: 105, omitted_option_count: 5,
      entry_count: 105, omitted_entry_count: 65, recent_entry_count: 0, omitted_recent_entry_count: 0, has_more: true });
    expect(first.options).toHaveLength(100);
    expect(first.options[0]).not.toHaveProperty('notes');
    const searched = JSON.parse(respond.mock.calls[2][0].filter((item: { type?: string }) => item.type === 'function_call_output').at(-1).output);
    expect(searched.options).toEqual([expect.objectContaining({ id: entries[104].id, revision: 105 })]);
    expect(searched.has_more).toBe(false);
  });
  it('reads fresh factual ledger state into every reasoned turn', async () => {
    const { service, respond } = harness([textResponse('Your walk is saved as completed, and breakfast is still pending.')]);
    const started = await begin(service);
    await service.turn(started.session_id, session, randomUUID(), 'What have I done and what is next?');
    const developer = respond.mock.calls[0][0].find((item: { role?: string; content?: string }) => item.role === 'developer' && item.content?.startsWith('Current authorized facts'));
    expect(developer.content).toContain(taskEntry.id);
    expect(developer.content).toContain(mealId);
    expect(developer.content).toContain('"tasks_completed":1');
    expect(developer.content).not.toContain('recent_entries');
    // Live Responses normalization once forced both mutually exclusive targets,
    // preventing every report. Keep provider optional fields optional; server
    // validation and spoken confirmation enforce the actual command contract.
    const recordTool=respond.mock.calls[0][2].find((item: {name?:string})=>item.name==='prepare_activity_record');
    expect(recordTool.strict).toBe(false);
    expect(recordTool.parameters.properties.payload.required).not.toContain('unplanned');
  });

  it('prepares an exact activity review without writing and requires completed playback before confirmation', async () => {
    const { service, care } = harness([toolResponse('prepare_activity_record', recordArgs())]);
    const started = await begin(service);
    const review = await service.turn(started.session_id, session, randomUUID(), 'I ate my oatmeal at ten.');
    expect(review.text).toContain('Record Synthetic oatmeal as eaten');
    expect(review.text).toContain('Say save this change to confirm');
    expect(care.ledger).toHaveBeenCalledWith(session, '2026-10-05');
    expect(care.activityCommand).not.toHaveBeenCalled();

    service.played(started.session_id, session, review.reply_id);
    const confirmation = await service.turn(started.session_id, session, randomUUID(), 'Save this change');
    expect(confirmation).toMatchObject({ changed: true, text: 'Your activity is recorded.' });
    expect(care.activityCommand).toHaveBeenCalledTimes(1);
    expect(care.activityCommand).toHaveBeenCalledWith(session, expect.objectContaining({
      type: 'record_activity', local_date: '2026-10-05', expected_revision: 0,
      payload: expect.objectContaining({ activity_id: mealId, status: 'completed' }),
    }));
  });

  it('does not save an unheard review or an interrupted review acknowledged late', async () => {
    const first = harness([
      toolResponse('prepare_activity_record', recordArgs()),
      textResponse('Please listen to the review before saving it.'),
    ]);
    const started = await begin(first.service);
    await first.service.turn(started.session_id, session, randomUUID(), 'I ate breakfast.');
    const unheard = await first.service.turn(started.session_id, session, randomUUID(), 'Save this change');
    expect(unheard.text).toContain('listen');
    expect(first.care.activityCommand).not.toHaveBeenCalled();
    first.service.close();

    const second = harness([
      toolResponse('prepare_activity_record', recordArgs()),
      textResponse('That old report is no longer pending.'),
    ]);
    const restarted = await begin(second.service);
    const review = await second.service.turn(restarted.session_id, session, randomUUID(), 'I ate breakfast.');
    second.service.interrupt(restarted.session_id, session);
    expect(() => second.service.played(restarted.session_id, session, review.reply_id)).toThrow();
    const stale = await second.service.turn(restarted.session_id, session, randomUUID(), 'Save this change');
    expect(stale.text).toContain('no longer pending');
    expect(second.care.activityCommand).not.toHaveBeenCalled();
  });

  it('rejects model-invented activity IDs before any care write', async () => {
    const unknown = randomUUID();
    const { service, care, respond } = harness([
      toolResponse('prepare_activity_record', recordArgs(unknown)),
      textResponse('Which exact activity did you mean?'),
    ]);
    const started = await begin(service);
    const reply = await service.turn(started.session_id, session, randomUUID(), 'Mark another meal done.');
    expect(reply.text).toContain('Which exact activity');
    expect(care.activityCommand).not.toHaveBeenCalled();
    const output = respond.mock.calls[1][0].find((item: { type?: string }) => item.type === 'function_call_output');
    expect(JSON.parse(output.output)).toMatchObject({ error: 'unknown_activity', outcome: 'rejected' });
  });

  it('resolves an unconfirmed write through its exact receipt without issuing a duplicate command', async () => {
    const { service, care } = harness([toolResponse('prepare_activity_record', recordArgs())]);
    vi.mocked(care.activityCommand!).mockRejectedValueOnce(unavailable());
    vi.mocked(care.activityReceipt!).mockImplementationOnce(async (_session, key) => ({ command_id: key, result: 'reported', entry: savedEntry, replayed: false }));
    const started = await begin(service);
    const review = await service.turn(started.session_id, session, randomUUID(), 'I ate breakfast.');
    service.played(started.session_id, session, review.reply_id);
    const confirmationId = randomUUID();
    const saved = await service.turn(started.session_id, session, confirmationId, 'Record it');
    expect(saved.text).toBe('Your activity is recorded.');
    expect(care.activityCommand).toHaveBeenCalledTimes(1);
    const issued = vi.mocked(care.activityCommand!).mock.calls[0][1];
    expect(care.activityReceipt).toHaveBeenCalledWith(session, issued.idempotency_key);
    expect(await service.turn(started.session_id, session, confirmationId, 'Record it')).toEqual(saved);
    expect(care.activityCommand).toHaveBeenCalledTimes(1);
    expect(care.activityReceipt).toHaveBeenCalledTimes(1);
  });

  it('returns repository claim IDs, document hashes and safety boundaries with nutrition answers', async () => {
    const metrics: ConversationTurnMetric[] = [];
    const { service, respond } = harness([
      toolResponse('get_nutrition_reference', { kind: 'claims', ids: ['C01'] }),
      textResponse('The reference supports a cautious, preference-aware option; it is not clinical authorization.'),
    ], metric => metrics.push(metric));
    const started = await begin(service);
    const reply = await service.turn(started.session_id, session, randomUUID(), 'What does the nutrition evidence say?');
    const output = respond.mock.calls[1][0].find((item: { type?: string }) => item.type === 'function_call_output');
    const reference = JSON.parse(output.output);
    expect(reference.items[0]).toMatchObject({ id: 'C01' });
    expect(reference.items[0].allowedInterpretation).toEqual(expect.any(String));
    expect(reference.items[0].limitation).toEqual(expect.any(String));
    expect(reference.sources[0]).toMatchObject({ documentId: 'CR_NUTRITION_EVIDENCE_V1', path: 'docs/nutrition/research-knowledge-base.md' });
    expect(reference.sources[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(reference.limitations.join(' ')).toContain('not clinical authorization');
    expect(reply.nutrition_refs).toEqual([expect.objectContaining({
      document_id: 'CR_NUTRITION_EVIDENCE_V1', path: 'docs/nutrition/research-knowledge-base.md', sha256: reference.sources[0].sha256, items: ['C01'],
    })]);
    expect(respond.mock.calls[0][1]).toContain('Do not diagnose');
    expect(respond.mock.calls[0][1]).toContain('A recipe record is not an approved meal');
    expect(respond.mock.calls[0][1]).not.toContain('130-170');
    expect(metrics[0]).toMatchObject({ model_calls: 2, tool_calls: 1, nutrition_retrievals: 1,
      nutrition_refs: [{ document_id: 'CR_NUTRITION_EVIDENCE_V1', sha256: reference.sources[0].sha256, items: ['C01'] }] });
    expect(metrics[0].instruction_chars).toBeGreaterThan(0);
    expect(metrics[0].context_chars).toBeGreaterThan(0);
    expect(metrics[0].history_chars).toBeGreaterThan(0);
    expect(JSON.stringify(metrics[0])).not.toContain('cautious, preference-aware');
  });
  it('provides a complete first recipe in one bounded nutrition tool round', async () => {
    const { service, respond } = harness([
      toolResponse('get_nutrition_reference', { kind: 'recipe_options', category: 'breakfast' }),
      textResponse('Berry yogurt is one breakfast idea. Shall we check whether the ingredients suit you?'),
    ]);
    const started = await begin(service);
    const reply = await service.turn(started.session_id, session, randomUUID(), 'Give me one breakfast idea.');
    expect(respond).toHaveBeenCalledTimes(2);
    const output = respond.mock.calls[1][0].find((item: { type?: string }) => item.type === 'function_call_output');
    const options = JSON.parse(output.output);
    expect(options.items[0]).toMatchObject({ id: 'B01', recipeYaml: expect.any(String) });
    expect(options.items[1]).not.toHaveProperty('recipeYaml');
    expect(options.characterCount).toBeLessThanOrEqual(10_000);
    expect(reply.nutrition_refs).toEqual(expect.arrayContaining([expect.objectContaining({
      document_id: 'CR_NUTRITION_MEALS_V1', sha256: options.sources[0].sha256, items: ['B01', 'B02'],
    })]));
  });

  it('returns a rejected tool result for unknown nutrition references', async () => {
    const { service, respond } = harness([
      toolResponse('get_nutrition_reference', { kind: 'claims', ids: ['C99'] }),
      textResponse('I could not verify that reference ID.'),
    ]);
    const started = await begin(service);
    const reply = await service.turn(started.session_id, session, randomUUID(), 'Tell me about claim C99.');
    const output = respond.mock.calls[1][0].find((item: { type?: string }) => item.type === 'function_call_output');
    expect(JSON.parse(output.output)).toEqual(expect.objectContaining({ error: 'invalid_input', outcome: 'rejected' }));
    expect(reply.nutrition_refs).toBeUndefined();
  });
});
