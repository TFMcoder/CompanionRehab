import { PlanRequestError } from '../src/server/chatgpt-plan/inference.js';

const providerCodes = new Set([
  'subscription_sharing_user_not_eligible', 'subscription_sharing_usage_limit_exceeded',
  'subscription_sharing_usage_unavailable', 'subscription_sharing_unsupported_capability',
  'subscription_sharing_route_not_supported', 'subscription_sharing_invalid_user',
  'subscription_sharing_user_unavailable', 'chatpass_v2_scope_not_authorized',
  'chatpass_v2_invalid_authorization_context', 'rate_limit_exceeded', 'insufficient_quota',
  'invalid_api_key', 'invalid_request_error', 'server_error', 'internal_server_error',
  'internal_error', 'authentication_error', 'permission_denied', 'invalid_grant',
  'invalid_client', 'invalid_refresh_token', 'refresh_token_expired',
  'refresh_token_invalidated', 'refresh_token_reused', 'refresh_failed',
]);
const providerTypes = new Set([
  'invalid_request_error', 'authentication_error', 'permission_error',
  'rate_limit_error', 'server_error', 'insufficient_quota', 'api_error',
]);
const protocolErrors = new Map([
  ['ChatGPT returned no response stream.', 'missing_stream'],
  ['ChatGPT response stream exceeded the probe limit.', 'stream_size_limit'],
  ['Invalid ChatGPT response stream.', 'invalid_stream'],
  ['Invalid ChatGPT response items.', 'invalid_output_items'],
  ['ChatGPT response was incomplete.', 'incomplete_response'],
  ['ChatGPT completed with a different model or status.', 'unexpected_model_or_status'],
  ['ChatGPT stream ended without response.completed.', 'incomplete_stream'],
  ['ChatGPT plan use was not granted for this connection.', 'required_scope_missing'],
]);
const networkCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);

/** Fixed labels only: never retain provider messages, arbitrary codes, payloads or request/account IDs. */
export function boundedPlanFailure(error: unknown) {
  if (error instanceof PlanRequestError) {
    const status = Number.isInteger(error.status) && (error.status === 0 || error.status >= 100 && error.status <= 599) ? error.status : null;
    return {
      status,
      code: providerCodes.has(error.code) || status !== null && error.code === `http_${status}` ? error.code : 'unrecognized_provider_error',
      providerCode: providerCodes.has(error.diagnostic?.providerCode ?? '') ? error.diagnostic!.providerCode : null,
      providerType: providerTypes.has(error.diagnostic?.providerType ?? '') ? error.diagnostic!.providerType : null,
    };
  }
  let code = 'unclassified_error';
  if (error instanceof Error) {
    if (protocolErrors.has(error.message)) code = protocolErrors.get(error.message)!;
    else if (error.name === 'TimeoutError') code = 'timeout';
    else if (error.name === 'AbortError') code = 'aborted';
    else {
      const cause = error.cause && typeof error.cause === 'object' ? error.cause as Record<string, unknown> : {};
      if (typeof cause.code === 'string' && networkCodes.has(cause.code)) code = 'network_' + cause.code.toLowerCase();
    }
  }
  return { status: null, code, providerCode: null, providerType: null };
}
