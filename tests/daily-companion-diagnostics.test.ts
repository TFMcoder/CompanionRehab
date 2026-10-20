import { describe, expect, it } from 'vitest';
import { PlanRequestError } from '../src/server/chatgpt-plan/inference.js';
import { boundedPlanFailure } from '../scripts/daily-companion-diagnostics.js';

describe('synthetic qualification failure metadata', () => {
  it('retains bounded HTTP/provider classifications without request IDs', () => {
    const error = new PlanRequestError(429, 'http_429', 'private-request-id', { providerCode: 'rate_limit_exceeded', providerType: 'rate_limit_error' });
    expect(boundedPlanFailure(error)).toEqual({ status: 429, code: 'http_429', providerCode: 'rate_limit_exceeded', providerType: 'rate_limit_error' });
  });

  it('drops arbitrary sensitive labels, status values and all message text', () => {
    const error = new PlanRequestError(9999, 'private_account_token', 'private-request-id', { providerCode: 'private_subject', providerType: 'private_transcript' });
    expect(boundedPlanFailure(error)).toEqual({ status: null, code: 'unrecognized_provider_error', providerCode: null, providerType: null });
    expect(JSON.stringify(boundedPlanFailure(new Error('private care transcript')))).not.toContain('private');
  });

  it('distinguishes allowlisted parser and network failures without copying messages or causes', () => {
    expect(boundedPlanFailure(new Error('Invalid ChatGPT response stream.')).code).toBe('invalid_stream');
    expect(boundedPlanFailure(new Error('private request details', { cause: { code: 'ECONNRESET', token: 'private-token' } })).code).toBe('network_econnreset');
    expect(boundedPlanFailure(new Error('private request details', { cause: { code: 'private_account' } })).code).toBe('unclassified_error');
  });
});
