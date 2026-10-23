import { describe, expect, it } from 'vitest';
import { currentNutritionReference } from '../src/server/nutrition-reference.js';
import { prepareTurnContext } from '../src/server/prepared-context.js';
import { preparedFactReply } from '../src/server/prepared-answers.js';
import { dialogueChatReplies, dialogueChatReply } from '../src/server/dialogue-replies.js';
import { outlookUnavailableReply } from '../src/shared/fixed-speech.js';
import { conversationRequestReservation, providerRequestAccounting } from '../scripts/reasoning-test-budget.js';
import type { Today } from '../src/shared/contracts.js';
import { randomUUID } from 'node:crypto';
import { ownerTestQuickConversation, ownerTestWarmConnection, ownerTestTelemetryPolicy, type OwnerTestSettings } from '../src/server/owner-test-config.js';

const reference = currentNutritionReference();
describe('remaining owner-copy reply delay', () => {
  it('activates quick replies only with the exact bound warm-v2 selection', () => {
    const settings = { owner_actor_id: randomUUID(), participant_id: randomUUID(), origin: 'https://synthetic.example:10000' } as OwnerTestSettings;
    const selection = { schema_version: 1, owner_actor_id: settings.owner_actor_id, participant_id: settings.participant_id, origin: settings.origin,
      profile: 'sol-low', context_mode: 'prepared-v1', speech_mode: 'heart-latency-v1', read_mode: 'quick-v1', reply_mode: 'spoken-v1', meal_mode: 'ahead-v1', continuation_mode: 'dialogue-v1', chat_mode: 'ahead-v1', reference_mode: 'verified-v1', connection_mode: 'warm-v2' };
    expect(ownerTestQuickConversation(settings)).toBe(false);
    expect(ownerTestQuickConversation(settings, { ...selection, connection_mode: 'warm-v1' })).toBe(false);
    expect(ownerTestQuickConversation(settings, selection)).toBe(true);
    expect(ownerTestWarmConnection(settings, selection)).toBe(true);
    expect(ownerTestTelemetryPolicy('nancy-2026-10-21-v6', settings, selection)).toMatch(/-w2$/);
    expect(() => ownerTestQuickConversation(settings, { ...selection, participant_id: randomUUID() })).toThrow();
    expect(() => ownerTestQuickConversation(settings, { ...selection, profile: 'sol-none' })).toThrow();
  });
  it.each(['Is my Outlook connected?','Is Outlook available?','Does my Outlook have appointments?'])('keeps an opted-in read-only availability question on its scoped source route: %s', text => {
    const preparation = prepareTurnContext(text, reference, undefined, true, true);
    expect(preparation.mode).toBe('schedule');
    expect(preparedFactReply(text, preparation, {} as Today, false)).toBe(outlookUnavailableReply);
    expect(preparedFactReply(text, preparation, {} as Today, true)).toBeUndefined();
  });
  it('preserves previous routing without the exact opt-in', () => {
    expect(prepareTurnContext('Is my Outlook connected?', reference).mode).toBe('full');
    expect(dialogueChatReply('Please slow down.')).toBeUndefined();
  });
  it.each(['Please slow down.','Can we go a little slower?','One idea at a time, please.','Could we take the conversation one thing at a time?','I feel discouraged when a conversation moves too quickly. How could we make it easier?'])('answers a whole conversation-pacing request without inference: %s', text => {
    expect(dialogueChatReply(text, true)).toBe(dialogueChatReplies.pace);
  });
  it.each(['Please slow down. I have chest pain.','Can we go slower and save a meal?','I feel overwhelmed after taking medication.','One thing at a time: delete my appointments.','Please slow down; I want to hurt myself.','I feel discouraged when a conversation moves too quickly. Change my medicine.'])('does not absorb care intent or symptoms into a pace response: %s', text => {
    expect(dialogueChatReply(text, true)).toBeUndefined();
  });
  it.each(['Is my Outlook connected? Delete all events.','Can you send an email?','Is my medication dose safe?','Have I eaten breakfast and finished tasks?'])('preserves full care/action/clinical scope: %s', text => {
    expect(prepareTurnContext(text, reference, undefined, true, true).mode).toBe('full');
  });
});
describe('bounded provider test accounting', () => {
  it('reserves all permitted rounds, preparations and one foreground warmup', () => {
    expect(conversationRequestReservation(4)).toBe(27);
    expect(conversationRequestReservation(3)).toBe(22);
    expect(() => conversationRequestReservation(61)).toThrow();
    expect(() => conversationRequestReservation(1, 6)).toThrow();
  });
  it('counts the four actual stages behind the previous three-request reservation failure', () => {
    const events = [{stage:'connection_preparation',connection_warmup_requests:1},
      {stage:'model',model_calls:1},{stage:'conversation_preparation',model_calls:1},
      {stage:'conversation_preparation',model_calls:0},{stage:'model',model_calls:1},
      {model_calls:1},{model_calls:0}].map(measurements => ({ measurements }));
    expect(providerRequestAccounting(events)).toEqual({ known_attempts: 4, unknown_events: 0, attempted: 4 });
    expect(providerRequestAccounting(events).attempted).toBeLessThanOrEqual(conversationRequestReservation(4));
  });
  it('keeps missing preparation counts unknown, including cancellations', () => {
    expect(providerRequestAccounting([{measurements:{stage:'conversation_preparation'}}])).toEqual({known_attempts:0,unknown_events:1,attempted:null});
  });
});
