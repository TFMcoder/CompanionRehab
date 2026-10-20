import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { voiceTimingMetric } from '../src/client/voice-timing';
import { clientVoiceMetricSchema } from '../src/shared/client-voice-metrics';
import { safeEvent } from '../src/server/telemetry';

describe('client voice timing observations', () => {
  const reply = {reply_id: randomUUID()};
  it('separates endpointing, server roundtrip and speech preparation from detected speech end', () => {
    const metric = voiceTimingMetric({inputMode:'speech',inputAt:100,speechEndedAt:100,requestAt:1000,repliedAt:1600}, reply, 2000, .03);
    expect(clientVoiceMetricSchema.parse(metric)).toMatchObject({endpointing_ms:900,request_ms:600,
      reply_to_playback_start_ms:400,speech_end_to_playback_start_ms:1900,reported_output_latency_ms:30,audible_response_ms:null});
  });
  it('preserves typed and greeting unknowns and does not describe a first reply as a cold worker', () => {
    const metric = voiceTimingMetric({inputMode:'opening',inputAt:10,speechEndedAt:null,requestAt:210,repliedAt:310},reply,410,undefined);
    expect(metric).toMatchObject({scenario:'opening',session_phase:'first_reply',input_to_playback_start_ms:400,
      endpointing_ms:null,speech_end_to_playback_start_ms:null,reported_output_latency_ms:null,audible_response_ms:null});
    expect(voiceTimingMetric({inputMode:'typed',inputAt:10,speechEndedAt:null,requestAt:10,repliedAt:30}, {...reply,navigate:'meals'},40,NaN))
      .toMatchObject({scenario:'navigation',session_phase:'continued_reply',speech_end_to_playback_start_ms:null});
  });
  it('never converts a missing/reversed observation or impossible latency into zero', () => {
    expect(voiceTimingMetric({inputMode:'speech',inputAt:100,speechEndedAt:100,requestAt:90},reply,80,-1))
      .toMatchObject({endpointing_ms:null,request_ms:null,input_to_playback_start_ms:null,reply_to_playback_start_ms:null,reported_output_latency_ms:null});
  });
  it('rejects private text, actor assignment, numeric strings and claimed audibility', () => {
    const metric = voiceTimingMetric({inputMode:'typed',inputAt:10,speechEndedAt:null,requestAt:10,repliedAt:30},reply,40,undefined);
    for (const extra of [{transcript:'private'}, {actor_id:randomUUID()}, {request_ms:'20'}, {audible_response_ms:30}, {request_ms:-1}])
      expect(clientVoiceMetricSchema.safeParse({...metric,...extra}).success).toBe(false);
  });
  it('keeps bounded numeric metadata and explicit unknowns in the existing log', () => {
    expect(safeEvent({kind:'conversation',outcome:'ok',measurements:{stage:'client_playback',input_mode:'speech',
      scenario:'conversation',session_phase:'continued_reply',endpointing_ms:950.2,audible_response_ms:null,
      reported_output_latency_ms:NaN,transcript:'private',reply:'private',request_ms:600_000}}).measurements)
      .toEqual({stage:'client_playback',input_mode:'speech',scenario:'conversation',session_phase:'continued_reply',
        endpointing_ms:950,audible_response_ms:null,reported_output_latency_ms:null,request_ms:null});
  });
});
