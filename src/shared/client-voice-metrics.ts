import { z } from 'zod';

const duration = z.number().finite().min(0).max(300_000).nullable();
/** Browser observations, not proof that a person heard the speaker. No free text. */
export const clientVoiceMetricSchema = z.object({
  reply_id: z.string().uuid(),
  input_mode: z.enum(['opening', 'speech', 'typed']),
  scenario: z.enum(['opening', 'navigation', 'care_change', 'conversation']),
  session_phase: z.enum(['first_reply', 'continued_reply']),
  endpointing_ms: duration,
  request_ms: duration,
  reply_to_playback_start_ms: duration,
  input_to_playback_start_ms: duration,
  speech_end_to_playback_start_ms: duration,
  reported_output_latency_ms: duration,
  audible_response_ms: z.null(),
}).strict();
export type ClientVoiceMetric = z.infer<typeof clientVoiceMetricSchema>;
