import { describe, expect, it, vi } from 'vitest';
import { VoiceTools, type CareAccess } from '../src/server/voice-tools.js';
import { ApiError, unavailable } from '../src/server/errors.js';
import { commandSchema, type Today } from '../src/shared/contracts.js';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const today: Today = {
  profile: { id: id(1), display_name: 'Synthetic tester', time_zone: 'America/Toronto', preferences: '', revision: 1 },
  local_date: '2026-09-29', tasks: [{ id: id(2), title: 'Water plant', time_hint: null }],
  meal_options: [{ id: id(3), name: 'Toast', slots: ['breakfast'] }, { id: id(4), name: 'Soup', slots: ['lunch'] }, { id: id(5), name: 'Pasta', slots: ['dinner'] }],
  checkin: { id: id(6), local_date: '2026-09-29', revision: 1, accepted: null,
    proposal: { id: id(7), task_ids: [id(2)], tasks: [{ id: id(2), title: 'Water plant', time_hint: null }], meals: [
      { slot: 'breakfast', option_id: id(3), name: 'Toast' }, { slot: 'lunch', option_id: id(4), name: 'Soup' }, { slot: 'dinner', option_id: id(5), name: 'Pasta' },
    ], created_at: '2026-09-29T14:00:00Z' } },
};
function harness() {
  const access: CareAccess = {
    today: vi.fn().mockResolvedValue(structuredClone(today)),
    command: vi.fn(async c => { commandSchema.parse(c); return { command_id: c.idempotency_key, checkin_id: id(6), revision: 2, result: 'accepted' as const, plan: today.checkin!.proposal, replayed: false }; }),
    receipt: vi.fn().mockResolvedValue(null),
  };
  return { access, tools: new VoiceTools(access, id(10)) };
}
const acceptArgs = { proposal_id: id(7), expected_revision: 1 };
async function review(tools: VoiceTools) {
  const result = await tools.run('review_day_plan', {}, 'review');
  tools.observe({ type: 'response.created', response: { id: 'readout', metadata: { nancy_review: result.review_token } } });
  return result;
}
function playback(tools: VoiceTools, status = 'completed') {
  tools.observe({ type: 'response.done', response: { id: 'readout', status } });
  tools.observe({ type: 'output_audio_buffer.stopped', response_id: 'readout' });
}
function speech(tools: VoiceTools, transcript = 'Nancy, accept this plan.') {
  tools.observe({ type: 'input_audio_buffer.speech_started', item_id: 'speech' });
  tools.observe({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'speech', transcript });
}
describe('spoken proposal acceptance', () => {
  it('requires exact review response, completed playback and a subsequent explicit voice phrase', async () => {
    const { access, tools } = harness();
    expect((await tools.run('accept_day_plan', acceptArgs, 'premature')).error).toBe('confirmation_required');
    await review(tools); playback(tools); speech(tools);
    const result = await tools.run('accept_day_plan', acceptArgs, 'accept');
    expect(result.result).toBe('accepted');
    expect(access.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'accept_day_plan', payload: { proposal_id: id(7) }, local_date: today.local_date, expected_revision: 1 }));
    expect(await tools.run('accept_day_plan', acceptArgs, 'accept')).toEqual(result);
    expect(access.command).toHaveBeenCalledTimes(1);
    expect((await tools.run('accept_day_plan', acceptArgs, 'second_accept')).error).toBe('confirmation_required');
  });
  it.each(['cancelled', 'incomplete', 'failed'])('refuses %s audio even with an explicit phrase', async status => {
    const { tools, access } = harness(); await review(tools); playback(tools, status); speech(tools);
    expect((await tools.run('accept_day_plan', acceptArgs, status)).error).toBe('confirmation_required');
    expect(access.command).not.toHaveBeenCalled();
  });
  it.each(['generation_only', 'wrong_response', 'barge_in', 'ambiguous', 'text_injection'])('refuses %s as acceptance evidence', async mode => {
    const { tools, access } = harness(); await review(tools);
    if (mode === 'generation_only') tools.observe({ type: 'response.output_audio.done', response_id: 'readout' });
    if (mode === 'wrong_response') { tools.observe({ type: 'response.done', response: { id: 'other', status: 'completed' } }); tools.observe({ type: 'output_audio_buffer.stopped', response_id: 'other' }); }
    if (['ambiguous', 'text_injection', 'barge_in'].includes(mode)) playback(tools);
    if (mode === 'barge_in') tools.observe({ type: 'output_audio_buffer.cleared', response_id: 'readout' });
    if (mode === 'text_injection') tools.observe({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'not_from_microphone', transcript: 'Nancy, accept this plan.' });
    else speech(tools, mode === 'ambiguous' ? 'That might be good' : undefined);
    expect((await tools.run('accept_day_plan', acceptArgs, mode)).error).toBe('confirmation_required'); expect(access.command).not.toHaveBeenCalled();
  });
  it('uses the same strict command validator for proposals and rejects extra authority fields', async () => {
    const { tools, access } = harness();
    const input = { task_ids: [id(2)], meals: today.checkin!.proposal!.meals.map(({ slot, option_id }) => ({ slot, option_id })), expected_revision: 1 };
    await tools.run('propose_day_plan', input, 'propose');
    expect(access.command).toHaveBeenCalledWith(commandSchema.parse({ type: 'propose_day_plan', local_date: today.local_date, payload: { task_ids: input.task_ids, meals: input.meals }, expected_revision: 1, idempotency_key: vi.mocked(access.command).mock.calls[0][0].idempotency_key }));
    expect((await tools.run('propose_day_plan', { ...input, participant_id: id(99) }, 'bad')).outcome).toBe('rejected');
    expect(access.command).toHaveBeenCalledTimes(1);
  });
  it('ignores a late confirmation transcript from a superseded speech turn', async () => {
    const { tools, access } = harness(); await review(tools); playback(tools);
    tools.observe({ type: 'input_audio_buffer.speech_started', item_id: 'old' });
    tools.observe({ type: 'input_audio_buffer.speech_started', item_id: 'new' });
    tools.observe({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'old', transcript: 'Nancy, accept this plan.' });
    expect((await tools.run('accept_day_plan', acceptArgs, 'late')).error).toBe('confirmation_required');
    expect(access.command).not.toHaveBeenCalled();
  });
  it('reports an interrupted write as unconfirmed and resolves using a receipt without writing again', async () => {
    const { tools, access } = harness(); await review(tools); playback(tools); speech(tools);
    vi.mocked(access.command).mockRejectedValueOnce(unavailable());
    const result = await tools.run('accept_day_plan', acceptArgs, 'lost');
    expect(result.outcome).toBe('unconfirmed'); expect(result).not.toHaveProperty('saved');
    vi.mocked(access.receipt).mockResolvedValueOnce({ command_id: result.receipt_key, checkin_id: id(6), revision: 2, result: 'accepted', plan: today.checkin!.proposal, replayed: false });
    expect((await tools.run('get_command_receipt', { key: result.receipt_key }, 'lookup')).receipt.result).toBe('accepted');
    await tools.run('accept_day_plan', acceptArgs, 'lost'); expect(access.command).toHaveBeenCalledTimes(1);
  });
  it('does not elevate authorization refusal to permission or saved state', async () => {
    const { tools, access } = harness(); vi.mocked(access.today).mockRejectedValue(new ApiError(401, 'unauthorized', 'Please sign in.'));
    expect(await tools.run('get_daily_brief', {}, 'denied')).toMatchObject({ error: 'unauthorized', outcome: 'rejected' });
    expect(access.command).not.toHaveBeenCalled();
  });
});
