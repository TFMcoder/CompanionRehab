import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { commandSchema, planInput } from '../shared/contracts.js';
import type { CareCommand, Today, Receipt } from '../shared/contracts.js';
import { ApiError } from './errors.js';

export interface CareAccess {
  today(): Promise<Today>; command(c: CareCommand): Promise<Receipt>; receipt(key: string): Promise<Receipt | null>;
}
function commandKey(sessionId: string, callId: string) {
  const bytes = createHash('sha256').update(`${sessionId}:${callId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 0x40; bytes[8] = (bytes[8] & 63) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const empty = z.object({}).strict();
const edit = planInput.extend({ expected_revision: z.number().int().nonnegative() });
const accept = z.object({ proposal_id: z.string().uuid(), expected_revision: z.number().int().nonnegative() }).strict();
const object = (properties = {}, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const planProperties = {
  expected_revision: { type: 'integer', minimum: 0 },
  task_ids: { type: 'array', items: { type: 'string' }, maxItems: 20 },
  meals: { type: 'array', minItems: 3, maxItems: 3, items: object({ slot: { type: 'string', enum: ['breakfast', 'lunch', 'dinner'] }, option_id: { type: 'string' } }, ['slot', 'option_id']) },
};
export const voiceToolDefinitions = [
  ...['get_daily_brief', 'get_day_plan', 'get_next_planned_item', 'start_or_resume_checkin', 'review_day_plan'].map(name => ({ type: 'function', name, description: name === 'review_day_plan' ? 'Read the exact current proposal aloud before requesting acceptance. Required before accept_day_plan.' : `Get authorized current-day state: ${name}.`, parameters: object() })),
  ...['propose_day_plan', 'revise_day_plan'].map(name => ({ type: 'function', name, description: 'Create an unaccepted proposal using only exact task/meal IDs from the brief. Does not mark anything done or eaten.', parameters: object(planProperties, Object.keys(planProperties)) })),
  { type: 'function', name: 'accept_day_plan', description: 'Accept the exact reviewed proposal only after the person has said "Nancy, accept this plan" following the spoken review. Other assent is not sufficient.', parameters: object({ proposal_id: { type: 'string' }, expected_revision: { type: 'integer', minimum: 0 } }, ['proposal_id', 'expected_revision']) },
  { type: 'function', name: 'get_command_receipt', description: 'Resolve an unconfirmed change using the receipt key returned by a previous tool failure; never repeat a write blindly.', parameters: object({ key: { type: 'string' } }, ['key']) },
];

export class VoiceTools {
  private candidate: { id: string; revision: number; token: string; responseId?: string; completed: boolean; drained: boolean } | null = null;
  private reviewed: { id: string; revision: number } | null = null;
  private confirmed: { id: string; revision: number } | null = null;
  private speechItems = new Set<string>();
  private outputs = new Map<string, { signature: string; output: unknown }>();
  constructor(private access: CareAccess, private sessionId: string) {}
  observe(event: Record<string, any>) {
    if (event.type === 'response.created' && this.candidate && event.response?.metadata?.nancy_review === this.candidate.token)
      this.candidate.responseId = event.response.id;
    if (event.type === 'response.done' && this.candidate?.responseId && this.candidate.responseId === event.response?.id) {
      if (event.response.status === 'completed') this.candidate!.completed = true;
      else this.candidate = null;
    }
    if (event.type === 'output_audio_buffer.stopped' && this.candidate?.responseId && event.response_id === this.candidate.responseId)
      this.candidate.drained = true;
    if (this.candidate?.completed && this.candidate.drained) {
      this.reviewed = { id: this.candidate.id, revision: this.candidate.revision }; this.candidate = null; this.speechItems.clear();
    }
    if (event.type === 'input_audio_buffer.speech_started') {
      this.confirmed = null;
      this.candidate = null;
      this.speechItems.clear();
      if (this.reviewed && typeof event.item_id === 'string') this.speechItems.add(event.item_id);
    }
    if (event.type === 'conversation.item.input_audio_transcription.completed' && this.speechItems.delete(event.item_id)) {
      const words = String(event.transcript || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
      if (['nancy accept this plan', 'accept this plan', 'yes accept this plan'].includes(words)) this.confirmed = this.reviewed;
    }
    if (event.type === 'output_audio_buffer.cleared') { this.candidate = null; this.reviewed = null; this.confirmed = null; this.speechItems.clear(); }
  }
  async run(name: string, args: unknown, callId: string): Promise<any> {
    const signature = JSON.stringify([name, args]);
    const previous = this.outputs.get(callId);
    if (previous) {
      if (previous.signature !== signature) throw new ApiError(409, 'changed_call', 'That request changed. Review the plan again.');
      return previous.output;
    }
    const key = commandKey(this.sessionId, callId);
    let output: unknown;
    let writeAttempted = false;
    try {
      if (name === 'get_command_receipt') {
        const { key: receiptKey } = z.object({ key: z.string().uuid() }).strict().parse(args);
        output = { receipt: await this.access.receipt(receiptKey) };
      } else {
        if (['get_daily_brief', 'get_day_plan', 'get_next_planned_item', 'start_or_resume_checkin', 'review_day_plan'].includes(name)) empty.parse(args);
        else if (['propose_day_plan', 'revise_day_plan'].includes(name)) edit.parse(args);
        else if (name === 'accept_day_plan') accept.parse(args);
        else throw new ApiError(400, 'unknown_tool', 'That action is not available.');
        const today = await this.access.today();
        if (!today.profile) throw new ApiError(409, 'setup_required', 'Complete the task and meal setup first.');
        if (['get_daily_brief', 'get_day_plan'].includes(name)) output = today;
        else if (name === 'get_next_planned_item') output = { planned_tasks: today.checkin?.accepted?.tasks || [], note: 'No activity completion is tracked in this slice; do not infer completion or which item has been done.' };
        else if (name === 'review_day_plan') {
          const proposal = today.checkin?.proposal;
          if (!proposal || !today.checkin) throw new ApiError(409, 'no_proposal', 'Propose a plan first.');
          this.candidate = { id: proposal.id, revision: today.checkin.revision, token: randomUUID(), completed: false, drained: false }; this.reviewed = null; this.confirmed = null;
          output = { proposal, expected_revision: today.checkin.revision, review_token: this.candidate.token, read_aloud: `Here is the proposed plan. Tasks: ${proposal.tasks.map(t => t.title).join('; ') || 'none'}. Meals: ${proposal.meals.map(m => `${m.slot}: ${m.name}`).join('; ')}. To save exactly this plan, say Nancy, accept this plan. You can also ask for changes or use the Accept button.` };
        } else {
          const input = args as Record<string, any>;
          if (name === 'accept_day_plan') {
            if (!this.confirmed || this.confirmed.id !== input.proposal_id || this.confirmed.revision !== input.expected_revision)
              throw new ApiError(409, 'confirmation_required', 'Read the exact proposal aloud. After the review finishes, say Nancy, accept this plan, or use the Accept button.');
            this.confirmed = null;
          }
          const { expected_revision, ...payload } = input;
          const command = commandSchema.parse({ type: name, idempotency_key: key, local_date: today.local_date,
            expected_revision: name === 'start_or_resume_checkin' ? 0 : expected_revision, payload });
          writeAttempted = true;
          output = await this.access.command(command);
          if (name !== 'start_or_resume_checkin') { this.candidate = null; this.reviewed = null; this.speechItems.clear(); }
        }
      }
    } catch (error) {
      const unknown = writeAttempted && (!(error instanceof ApiError) || error.status >= 500);
      output = { error: error instanceof ApiError ? error.code : 'invalid_request',
        outcome: unknown ? 'unconfirmed' : 'rejected',
        message: unknown ? 'Save unconfirmed. Query get_command_receipt with receipt_key. Do not repeat this write or claim it was not saved.' : error instanceof ApiError ? error.message : 'Use the exact current task and meal IDs. Ask for clarification if the choice is ambiguous.', receipt_key: key };
    }
    this.outputs.set(callId, { signature, output });
    return output;
  }
}
