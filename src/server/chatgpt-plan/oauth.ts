import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify, constants, type JsonWebKey } from 'node:crypto';
import type { PlanCredential } from './storage.js';

export const issuer = 'https://auth.openai.com';
export const resource = 'https://api.openai.com/v1';
export const authorizeEndpoint = `${issuer}/api/accounts/authorize`;
export const tokenEndpoint = `${issuer}/api/accounts/oauth/token`;
export const jwksEndpoint = `${issuer}/.well-known/jwks.json`;
export const requiredScope = 'chatgpt.tokens.use.direct';
const scope = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const b64 = (value: Buffer) => value.toString('base64url');
const random = (size = 32) => b64(randomBytes(size));
function same(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface Attempt {
  state: string; nonce: string; verifier: string; redirectUri: string;
  requestedClientId: string; previous?: PlanCredential; expiresAt: number;
}
export function beginAuthorization(hostId: string, redirectUri: string, previous?: PlanCredential): { attempt: Attempt; url: string } {
  const callback = new URL(redirectUri);
  if (callback.protocol !== 'http:' || callback.hostname !== '127.0.0.1' || callback.pathname !== '/auth/callback' || callback.search || callback.hash)
    throw new Error('OAuth callback must be an exact 127.0.0.1 loopback /auth/callback URL.');
  const attempt: Attempt = {
    state: random(), nonce: random(), verifier: random(64), redirectUri,
    requestedClientId: previous?.clientId || 'dynamic_agent_client', previous,
    expiresAt: Date.now() + 5 * 60_000,
  };
  const url = new URL(authorizeEndpoint);
  const params: Record<string, string> = {
    client_id: attempt.requestedClientId, ext_agent_host_id: hostId, response_type: 'code',
    redirect_uri: redirectUri, scope, resource, state: attempt.state, nonce: attempt.nonce,
    code_challenge_method: 'S256', code_challenge: b64(createHash('sha256').update(attempt.verifier).digest()),
  };
  if (previous) {
    params.id_token_hint = previous.idToken;
    if (previous.email) params.login_hint = previous.email;
  } else params.agent_name_hint = 'Companion Rehab';
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return { attempt, url: url.toString() };
}

export function readCallback(url: string, attempt: Attempt): { code: string; clientId: string } {
  const callback = new URL(url, attempt.redirectUri);
  if (Date.now() > attempt.expiresAt) throw new Error('Sign-in timed out. Start again.');
  if (callback.origin !== new URL(attempt.redirectUri).origin || callback.pathname !== '/auth/callback' || callback.hash)
    throw new Error('Unexpected sign-in callback.');
  if (callback.searchParams.getAll('state').length !== 1 || !same(callback.searchParams.get('state') || '', attempt.state))
    throw new Error('Sign-in state did not match. Start again.');
  if (callback.searchParams.has('error')) throw new Error('ChatGPT sign-in was declined or interrupted.');
  if (callback.searchParams.getAll('code').length !== 1 || !callback.searchParams.get('code')) throw new Error('Sign-in returned no code.');
  const returned = callback.searchParams.get('client_id');
  if (callback.searchParams.getAll('client_id').length > 1) throw new Error('Conflicting client IDs in callback.');
  if (attempt.previous) {
    if (returned && returned !== attempt.requestedClientId) throw new Error('Sign-in returned a different client registration.');
    return { code: callback.searchParams.get('code')!, clientId: attempt.requestedClientId };
  }
  if (!returned || !/^oaiapp_[A-Za-z0-9_-]+$/.test(returned)) throw new Error('Sign-in did not issue a valid client ID.');
  return { code: callback.searchParams.get('code')!, clientId: returned };
}

export interface TokenReply { access_token: string; refresh_token: string; id_token: string; token_type: string; expires_in: number; scope: string }
export async function exchangeCode(code: string, clientId: string, attempt: Attempt, fetcher: typeof fetch = fetch): Promise<TokenReply> {
  const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource });
  const response = await fetcher(tokenEndpoint, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`ChatGPT code exchange failed (HTTP ${response.status}). Start sign-in again.`);
  return parseTokens(await response.json());
}
export function parseTokens(value: unknown): TokenReply {
  if (!value || typeof value !== 'object') throw new Error('Invalid ChatGPT token response.');
  const data = value as Record<string, unknown>;
  if (typeof data.access_token !== 'string' || !data.access_token || typeof data.refresh_token !== 'string' || !data.refresh_token
    || typeof data.id_token !== 'string' || !data.id_token || data.token_type !== 'Bearer'
    || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0
    || typeof data.scope !== 'string') throw new Error('Invalid ChatGPT token response.');
  return data as unknown as TokenReply;
}

type JwtClaims = { iss?: unknown; aud?: unknown; exp?: unknown; iat?: unknown; nbf?: unknown; nonce?: unknown; sub?: unknown; email?: unknown };
export async function validateIdToken(token: string, clientId: string, nonce: string | undefined, fetcher: typeof fetch = fetch): Promise<{ subject: string; email?: string }> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(part => !part)) throw new Error('Invalid ChatGPT ID token.');
  let header: { alg?: string; kid?: string; typ?: string }, claims: JwtClaims;
  try { header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); }
  catch { throw new Error('Invalid ChatGPT ID token.'); }
  const audience = claims.aud === clientId || (Array.isArray(claims.aud) && claims.aud.length === 1 && claims.aud[0] === clientId);
  if (header.alg !== 'RS256' || !header.kid || claims.iss !== issuer
    || !audience || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000 - 5
    || typeof claims.iat !== 'number' || !Number.isFinite(claims.iat) || claims.iat > Date.now() / 1000 + 5
    || (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf) || claims.nbf > Date.now() / 1000 + 5))
    || (nonce !== undefined && (typeof claims.nonce !== 'string' || !same(claims.nonce, nonce)))
    || typeof claims.sub !== 'string' || !claims.sub) throw new Error('ChatGPT ID token claims did not validate.');
  const response = await fetcher(jwksEndpoint, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok || response.url !== jwksEndpoint) throw new Error('Could not load OpenAI signing keys.');
  const keys = (await response.json() as { keys?: (JsonWebKey & { kid?: string; use?: string; alg?: string })[] }).keys;
  const jwk = keys?.find(key => key.kid === header.kid && (!key.use || key.use === 'sig') && (!key.alg || key.alg === header.alg));
  if (!jwk || jwk.kty !== 'RSA')
    throw new Error('OpenAI signing key was not found.');
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  if (!verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(parts[2], 'base64url')))
    throw new Error('ChatGPT ID token signature did not validate.');
  return { subject: claims.sub, ...(typeof claims.email === 'string' ? { email: claims.email } : {}) };
}
