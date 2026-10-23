import {z} from 'zod';
import {clientVoiceMetricSchema} from './client-voice-metrics.js';

export const safariScenarios = [
  {id:'opening',title:'Start Nancy',say:'Tap Talk to Nancy. Listen to the greeting.',check:'Allow the microphone if asked. This measures opening this conversation, not a cold server.'},
  {id:'breakfast',title:'Choose breakfast',say:'What would you suggest for breakfast?',check:'Does she give a practical suggestion that fits the test profile? Do not accept a plan.'},
  {id:'ingredient',title:'Change an ingredient',say:'Could you suggest an alternative with no eggs?',check:'Does she remember breakfast and respect no eggs? A suggestion does not mean you ate it.'},
  {id:'general',title:'Ask something new',say:'How do the teeth of a zipper stay together?',check:'Look for interlocking teeth guided together by the slider. This is an accuracy check, not a prepared answer requirement.'},
  {id:'followup',title:'Follow the conversation',say:'Could you explain that more simply?',check:'Does she stay on the zipper question and use easier language?'},
  {id:'schedule',title:'Ask about another day',say:'Can you check my Outlook appointments for next Wednesday?',check:'Outlook is deliberately disconnected in this copy. She should explain that limit and must not invent appointments.'},
  {id:'pause',title:'Pause while speaking',say:'Can you suggest… [pause for two seconds] …a simple lunch with no eggs?',check:'Say the words, not the bracketed instruction. Note whether Nancy submits the first fragment or misses the rest. This deliberately tests the existing silence rule.'},
  {id:'resume',title:'Return after locking the phone',say:'Lock the phone for ten seconds, unlock it and return here. Then ask: What were we discussing?',check:'The screen lock may interrupt audio. Use Talk to Nancy again if needed. A new conversation may not remember the old one; rate what actually happens.'},
] as const;
export const scenarioId=z.enum(['opening','breakfast','ingredient','general','followup','schedule','pause','resume']);
const duration=z.number().finite().min(0).max(300_000).nullable();
export const safariDetailSchema=z.object({
  audio_headers_ms:duration,audio_download_ms:duration,audio_decode_ms:duration,audio_preparation_server_ms:duration,
  audio_bytes:z.number().int().min(0).max(10_000_000).nullable(),
  sample_rate:z.number().int().min(8000).max(192000).nullable(),
  context_state:z.enum(['running','suspended','interrupted','closed','unknown']),
}).strict();
export const safariSampleSchema=z.object({
  id:z.string().uuid(),scenario_id:scenarioId,conversation_id:z.string().uuid(),turn_id:z.string().uuid().nullable(),
  metric:clientVoiceMetricSchema,detail:safariDetailSchema,
}).strict();
export const safariRatingSchema=z.object({
  heard_after_detected_end_ms:duration,heard_after_input_ms:duration,
  transcript:z.enum(['correct','partly_wrong','wrong','not_sure']),
  answer:z.enum(['correct','partly_wrong','wrong','not_sure']),
  responsiveness:z.enum(['comfortable','noticeable_wait','too_slow','no_audio']),
  problem:z.enum(['none','cut_me_off','missed_words','lost_context','audio_gap','permission','lock_resume','other']),
}).strict();
export const safariRunInput=z.object({id:z.string().uuid(),network:z.enum(['wifi','cellular']),
  browser:z.enum(['safari','other','unknown']),audio:z.enum(['phone_speaker','headphones','bluetooth']),
  condition:z.enum(['new_page','repeat']),}).strict();
export type SafariSample=z.infer<typeof safariSampleSchema>;
export type SafariRating=z.infer<typeof safariRatingSchema>;
export type SafariDetail=z.infer<typeof safariDetailSchema>;
export type SafariRunInput=z.infer<typeof safariRunInput>;
