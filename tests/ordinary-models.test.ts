import {describe,it,expect} from 'vitest';
import {reasoningCandidates,validateReasoningProfile,selectedReasoning} from '../src/server/chatgpt-plan/inference.js';
import {ownerTestReasoning,type OwnerTestSettings} from '../src/server/owner-test-config.js';

describe('explicit ordinary-question comparison candidate',()=>{
 it('qualifies Luna/none without changing the selected production profile',()=>{
  expect(validateReasoningProfile(reasoningCandidates['luna-none'])).toEqual({model:'gpt-6-luna',effort:'none'});
  expect(selectedReasoning).toEqual({model:'gpt-6-sol',effort:'high'});
  const unsupported={...reasoningCandidates['luna-none'],service_tier:'fast'};
  expect(()=>validateReasoningProfile(unsupported)).toThrow();
 });
 it('does not make the comparison profile selectable as a whole owner care runtime',()=>{
  const settings={owner_actor_id:'00000000-0000-4000-8000-000000000001',participant_id:'00000000-0000-4000-8000-000000000002',origin:'https://synthetic.example:10000'} as OwnerTestSettings;
  expect(()=>ownerTestReasoning(settings,{schema_version:1,owner_actor_id:settings.owner_actor_id,participant_id:settings.participant_id,origin:settings.origin,profile:'luna-none'})).toThrow();
  expect(ownerTestReasoning(settings)).toEqual(selectedReasoning);
 });
});
