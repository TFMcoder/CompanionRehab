import type { ClientVoiceMetric } from '../shared/client-voice-metrics';

export interface VoiceTiming {
  inputMode: ClientVoiceMetric['input_mode'];
  inputAt: number;
  speechEndedAt: number | null;
  requestAt: number;
  repliedAt?: number;
}
const elapsed = (end: number, start: number | null | undefined) => start == null || !Number.isFinite(start)
  || !Number.isFinite(end) || end < start || end - start > 300_000 ? null : Math.round(end - start);

export function voiceTimingMetric(timing: VoiceTiming, reply: {reply_id: string; navigate?: string; changed?: boolean},
  playedAt: number, outputLatencySeconds: number | undefined): ClientVoiceMetric {
  return {
    reply_id: reply.reply_id, input_mode: timing.inputMode,
    scenario: timing.inputMode === 'opening' ? 'opening' : reply.navigate ? 'navigation' : reply.changed ? 'care_change' : 'conversation',
    session_phase: timing.inputMode === 'opening' ? 'first_reply' : 'continued_reply',
    endpointing_ms: timing.speechEndedAt === null ? null : elapsed(timing.requestAt, timing.speechEndedAt),
    request_ms: timing.repliedAt === undefined ? null : elapsed(timing.repliedAt, timing.requestAt),
    reply_to_playback_start_ms: elapsed(playedAt, timing.repliedAt),
    input_to_playback_start_ms: elapsed(playedAt, timing.inputAt),
    speech_end_to_playback_start_ms: elapsed(playedAt, timing.speechEndedAt),
    reported_output_latency_ms: typeof outputLatencySeconds === 'number' && outputLatencySeconds >= 0
      && Number.isFinite(outputLatencySeconds) && outputLatencySeconds <= 300 ? Math.round(outputLatencySeconds * 1000) : null,
    // Scheduling WebAudio playback cannot establish acoustic output or audibility.
    audible_response_ms: null,
  };
}

/** Best effort and off the speech path; never retry or include utterance/reply text. */
export function reportVoiceTiming(conversationId: string, metric: ClientVoiceMetric, signal: AbortSignal): void {
  try { void fetch(`/api/conversation/${encodeURIComponent(conversationId)}/timing`, {
    method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(metric), signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
  }).catch(() => undefined); } catch { /* Diagnostics cannot interrupt a reply. */ }
}
