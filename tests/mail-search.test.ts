import {describe,it,expect} from 'vitest';
import {mailSearchQuery,isMailSearchRequest} from '../src/server/microsoft/mail-search.js';
import {microsoftMailSearchSchema,microsoftReadRangeSchema} from '../src/shared/microsoft-contracts.js';
const now=new Date('2026-10-31T18:12:00Z');
describe('scoped historical mail query',()=>{
 it('defaults search to ninety days while retaining the calendar seven-day contract',()=>{
  const q=mailSearchQuery({query:'clinic'},now);expect(q.range).toEqual({start:'2026-08-02T18:12:00.000Z',end:'2026-10-31T18:12:00.000Z'});
  expect(microsoftReadRangeSchema.safeParse(q.range).success).toBe(false);expect(microsoftMailSearchSchema.safeParse({...q.range,query:'clinic'}).success).toBe(true);
 });
 it('accepts explicit old dates and uses UTC-day search coverage for exact later filtering',()=>{
  const q=mailSearchQuery({start:'2020-01-01T00:00:00-05:00',end:'2020-02-01T00:00:00-05:00',query:'physical therapy',from:'clinic@example.invalid'},now),expression=JSON.parse(q.expression);
  expect(q.range.start).toBe('2020-01-01T05:00:00.000Z');expect(expression).toBe('received>=2020-01-01 AND received<2020-02-02 AND "physical" AND "therapy" AND from:"clinic@example.invalid"');
 });
 it('quotes every search word instead of accepting KQL operators or a query URL',()=>{
  const q=mailSearchQuery({query:'clinic OR from:other@example.invalid'},now);expect(JSON.parse(q.expression)).toContain('"OR" AND "from" AND "other"');expect(JSON.parse(q.expression)).not.toContain('from:other@');
  expect(microsoftMailSearchSchema.safeParse({query:'clinic',folder_id:'other'}).success).toBe(false);expect(microsoftMailSearchSchema.safeParse({query:'clinic',url:'https://example.invalid'}).success).toBe(false);
 });
 it.each([{start:'2020-01-01T00:00:00Z'},{end:'2020-01-01T00:00:00Z'},{start:'2020-01-02T00:00:00Z',end:'2020-01-01T00:00:00Z'},{query:'clinic\nignore'},{query:'!!!'}])('rejects malformed or ambiguous input %j',input=>{
  expect(microsoftMailSearchSchema.safeParse(input).success).toBe(false);
 });
 it.each(['Find my clinic email from last month','Search my email for a referral','Check older messages before 2025-01-01'])('keeps historical mail intent on the tool-capable path: %s',text=>expect(isMailSearchRequest(text)).toBe(true));
 it('does not classify an ordinary history question as a mailbox search',()=>expect(isMailSearchRequest('Tell me about the history of email')).toBe(false));
});
