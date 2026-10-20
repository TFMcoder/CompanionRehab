import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ConversationService } from '../src/server/conversation.js';
import type { CareService } from '../src/server/care-access.js';
import type { Session } from '../src/server/session.js';
import type { Today } from '../src/shared/contracts.js';
import { currentNutritionReference } from '../src/server/nutrition-reference.js';
import { testAuthority, bindTestInference } from './helpers/inference.js';

let service: ConversationService | undefined;
afterEach(() => service?.close());
const response = { completed: true, model: 'gpt-6-sol', effort: 'high', text: 'What would help?', output: [] };
function fixture() {
  const session: Session = { user_id: randomUUID(), session_id: randomUUID(), issued_at: 1, expires_at: 9999999999, access_token: 'synthetic', refresh_token: 'synthetic' };
  const today: Today = { profile: { id: session.user_id, display_name: 'Synthetic', time_zone: 'America/Toronto', preferences: '', revision: 1 }, local_date: '2026-10-14', tasks: [], meal_options: [], checkin: null };
  const care = { authorize: async (s: Session) => s, authority: () => testAuthority(session), today: async () => today } as unknown as CareService;
  const respond = vi.fn().mockResolvedValue(response);
  service = new ConversationService(care, { bind: bindTestInference, respond }, session.user_id, () => new Date('2026-10-14T15:00:00Z'));
  return { session, respond, service };
}

describe('Nancy guidance in conversation rounds', () => {
  it('keeps the same authorized functions across instruction profiles and ambiguous wording', async () => {
    const f = fixture(), started = await f.service.start(f.session);
    for (const text of ['I prefer one question at a time.', 'What task should I consider?', 'That one.']) {
      await f.service.turn(started.session_id, f.session, randomUUID(), text);
    }
    const tools = f.respond.mock.calls.map(call => call[2].map((tool: { name: string }) => tool.name));
    expect(tools[1]).toEqual(tools[0]); expect(tools[2]).toEqual(tools[0]);
    expect(tools[0]).toContain('get_nutrition_reference'); expect(tools[0]).toContain('prepare_activity_record');
    expect(f.respond.mock.calls[0][1]).not.toContain('# Nancy skill: tasks');
    expect(f.respond.mock.calls[1][1]).toContain('# Nancy skill: tasks');
    expect(f.respond.mock.calls[2][1]).toContain('# Nancy skill: meals');
  });

  it('adds nutrition guidance on an existing tool round without a routing inference call', async () => {
    const f = fixture();
    f.respond.mockResolvedValueOnce({ ...response, text: '', output: [{ type: 'function_call', name: 'get_nutrition_reference', call_id: randomUUID(), arguments: JSON.stringify({ kind: 'claim_index' }) }] });
    const started = await f.service.start(f.session);
    await f.service.turn(started.session_id, f.session, randomUUID(), 'I prefer simple choices.');
    expect(f.respond).toHaveBeenCalledTimes(2);
    const authority = currentNutritionReference().authorityContext().text;
    expect(f.respond.mock.calls[0][1]).not.toContain(authority);
    expect(f.respond.mock.calls[1][1]).toContain(authority);
    expect(f.respond.mock.calls[1][1]).toContain('# Nancy skill: meals');
    expect(f.respond.mock.calls[1][2]).toEqual(f.respond.mock.calls[0][2]);
    expect(f.respond.mock.calls[1][0].some((item: { type: string }) => item.type === 'function_call_output')).toBe(true);
  });
});
