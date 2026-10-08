import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prepareRequestAction, requestDefinitions, requestFacts } from '../src/server/request-conversation.js';
import { requestFixture } from './helpers/request-fixture.js';

describe('bounded request voice tools',()=>{
  it.each(['family_friend','administrator'] as const)('offers role-specific request tools without client acceptance for %s',async role=>{
    const f=requestFixture(role),schema=JSON.stringify(requestDefinitions(f.workspace));
    expect(schema).toContain('submit_request');expect(schema).not.toContain('accept_request');expect(schema).not.toContain('reject_request');expect(schema).not.toContain('set_request_access');
    expect(schema).not.toContain('confirmed');expect(schema).not.toContain('idempotency_key');
    await expect(prepareRequestAction(f.requests,f.session,{action:{type:'accept_request',request_id:f.requestId,expected_revision:1,draft:f.draft}},randomUUID())).rejects.toMatchObject({status:403});
    expect(f.requests.command).not.toHaveBeenCalled();
  });
  it('prepares a reviewed submission without saving and rejects model-supplied confirmation',async()=>{
    const f=requestFixture(),id=randomUUID();
    const review=await prepareRequestAction(f.requests,f.session,{action:{type:'submit_request',draft:f.draft}},id);
    expect(review.command).toMatchObject({idempotency_key:id,type:'submit_request',confirmed:true,review_token:'a'.repeat(64)});
    expect(review.phrase).toBe('send this request');expect(review.text).toContain('Only they can accept');
    expect(f.requests.command).not.toHaveBeenCalled();
    await expect(prepareRequestAction(f.requests,f.session,{action:{type:'submit_request',draft:f.draft,confirmed:true}},randomUUID())).rejects.toThrow();
  });
  it('requires current permission, exact revision, known capacity and reviewed constraints',async()=>{
    const f=requestFixture('client');
    const action={type:'accept_request',request_id:f.requestId,expected_revision:1,draft:f.draft};
    await expect(prepareRequestAction(f.requests,f.session,{action:{...action,expected_revision:0}},randomUUID())).rejects.toMatchObject({code:'conflict'});
    const defaultReview=await f.requests.review(f.session,f.draft);
    vi.mocked(f.requests.review).mockResolvedValueOnce({...defaultReview,can_accept:false,capacity_known:false});
    await expect(prepareRequestAction(f.requests,f.session,{action},randomUUID())).rejects.toMatchObject({code:'capacity_unknown'});
    vi.mocked(f.requests.review).mockResolvedValueOnce({...defaultReview,blockers:['Choose another time.']});
    await expect(prepareRequestAction(f.requests,f.session,{action},randomUUID())).rejects.toMatchObject({code:'capacity_review'});
    const allowed=await prepareRequestAction(f.requests,f.session,{action},randomUUID());expect(allowed.phrase).toBe('accept this request');expect(allowed.text).toContain('does not record completion');
    expect(f.requests.command).not.toHaveBeenCalled();
  });
  it('reads the client reason and help sharing back without implying a performed activity',async()=>{
    const f=requestFixture('client');
    const review=await prepareRequestAction(f.requests,f.session,{action:{type:'reject_request',request_id:f.requestId,expected_revision:1,reason:'I cannot take this on today.'}},randomUUID());
    expect(review.text).toContain('Your reason is: I cannot take this on today.');expect(review.text).toContain('authorized family');expect(review.text).toContain('administrator');
    expect(review.text).toContain('adds no task');expect(review.phrase).toBe('decline this request');
  });
  it('bounds fact lists, excludes requester email and can search omitted tasks',()=>{
    const f=requestFixture();f.workspace.requests=Array.from({length:30},(_,i)=>({...f.workspace.requests[0],id:randomUUID(),draft:{...f.draft,task_name:`Synthetic task ${i}`}}));
    const facts=requestFacts(f.workspace);expect(facts.requests).toHaveLength(12);expect(facts.omitted_requests).toBe(18);expect(JSON.stringify(facts)).not.toContain('private-family@example.invalid');
    expect(requestFacts(f.workspace,'Synthetic task 29').requests).toHaveLength(1);expect(facts).not.toHaveProperty('appointments');expect(facts).not.toHaveProperty('sharing');
  });
});
