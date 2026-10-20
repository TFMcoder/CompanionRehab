import { createHash, createPrivateKey, randomBytes, randomUUID, timingSafeEqual, X509Certificate, type KeyObject } from 'node:crypto';
import { createLocalJWKSet, jwtVerify, SignJWT, type JSONWebKeySet, type JWTPayload } from 'jose';

export const MICROSOFT_DELEGATED_SCOPES = Object.freeze([
  'openid', 'profile', 'offline_access', 'User.Read', 'Calendars.ReadWrite', 'Mail.ReadWrite', 'Mail.Send',
]);
const graphScopes = ['User.Read', 'Calendars.ReadWrite', 'Mail.ReadWrite', 'Mail.Send'];
// Entra can return this default OIDC scope even when it was not requested.
// Accept only this response addition; request scopes and account authority stay unchanged.
// https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-browser/FAQ.md
const tokenResponseScopes = [...MICROSOFT_DELEGATED_SCOPES, 'email'];
const guid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const authority = 'https://login.microsoftonline.com';
const responseLimit = 256 * 1024;
const maxTokenLength = 64 * 1024;

export interface MicrosoftOAuthConfig {
  tenantId: string;
  clientId: string;
  expectedObjectId: string;
  redirectUri: string;
  certificate: { privateKeyPem: string; certificatePem: string };
  allowLoopbackHttpForTests?: boolean;
}

export interface MicrosoftTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scopes: string[];
  identity: { tenantId: string; objectId: string };
}

export interface MicrosoftAuthorizationAttempt {
  authorizationUrl: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: string;
}

export type MicrosoftOAuthErrorCode = 'invalid_configuration' | 'invalid_exchange' | 'provider_unavailable'
  | 'reauthorization_required' | 'invalid_token_response' | 'identity_not_allowed' | 'invalid_id_token' | 'invalid_scopes';

const safeMessages: Record<MicrosoftOAuthErrorCode, string> = {
  invalid_configuration: 'Microsoft connection configuration is invalid.',
  invalid_exchange: 'Microsoft sign-in could not be completed. Start sign-in again.',
  provider_unavailable: 'Microsoft sign-in is unavailable. Start sign-in again later.',
  reauthorization_required: 'Microsoft requires sign-in and consent again.',
  invalid_token_response: 'Microsoft returned an invalid credential response.',
  identity_not_allowed: 'This Microsoft account is not approved for this connection.',
  invalid_id_token: 'Microsoft account identity could not be verified.',
  invalid_scopes: 'Microsoft did not return the approved delegated permissions.',
};

export class MicrosoftOAuthError extends Error {
  readonly httpStatus: number | null;
  readonly providerCodes: readonly number[];
  readonly scopeCheck: { missing_graph_scopes: readonly string[]; unexpected_scope_count: number | null; email_returned: boolean } | null;
  constructor(readonly code: MicrosoftOAuthErrorCode, diagnostic?: { httpStatus?: unknown; providerCodes?: unknown; scopeCheck?: { missingGraphScopes: string[]; unexpectedScopeCount: number; emailReturned: boolean } }) {
    super(safeMessages[code]);
    this.name = 'MicrosoftOAuthError';
    this.httpStatus = Number.isInteger(diagnostic?.httpStatus) && Number(diagnostic?.httpStatus) >= 100 && Number(diagnostic?.httpStatus) <= 599
      ? Number(diagnostic?.httpStatus) : null;
    this.providerCodes = Object.freeze(Array.isArray(diagnostic?.providerCodes)
      ? diagnostic.providerCodes.filter(value => Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000).slice(0, 4) : []);
    this.scopeCheck = diagnostic?.scopeCheck ? Object.freeze({
      missing_graph_scopes: Object.freeze(graphScopes.filter(scope => diagnostic.scopeCheck!.missingGraphScopes.includes(scope))),
      unexpected_scope_count: Number.isInteger(diagnostic.scopeCheck.unexpectedScopeCount) && diagnostic.scopeCheck.unexpectedScopeCount >= 0 && diagnostic.scopeCheck.unexpectedScopeCount <= 2048 ? diagnostic.scopeCheck.unexpectedScopeCount : null,
      email_returned: diagnostic.scopeCheck.emailReturned === true,
    }) : null;
  }
}

function same(left: string, right: string): boolean {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function tokenString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxTokenLength && !/[\u0000-\u0020\u007f]/.test(value);
}

function delegatedScopes(value: unknown): string[] {
  if (typeof value !== 'string' || !value || value.length > 2048) throw new MicrosoftOAuthError('invalid_scopes');
  const scopes = [...new Set(value.trim().split(/\s+/).map(scope => scope.startsWith('https://graph.microsoft.com/')
    ? scope.slice('https://graph.microsoft.com/'.length) : scope))];
  if (scopes.some(scope => !tokenResponseScopes.includes(scope)) || graphScopes.some(scope => !scopes.includes(scope)))
    throw new MicrosoftOAuthError('invalid_scopes', { scopeCheck: {
      missingGraphScopes: graphScopes.filter(scope => !scopes.includes(scope)),
      unexpectedScopeCount: scopes.filter(scope => !tokenResponseScopes.includes(scope)).length,
      emailReturned: scopes.includes('email'),
    } });
  return scopes;
}

/** Fixed tenant endpoints and a configured exact callback avoid discovery or redirect injection. */
export function validateMicrosoftOAuthConfig(config: MicrosoftOAuthConfig): void {
  try {
    if (![config.tenantId, config.clientId, config.expectedObjectId].every(value => typeof value === 'string' && guid.test(value)))
      throw new Error();
    const callback = new URL(config.redirectUri);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(callback.hostname);
    if (callback.username || callback.password || callback.search || callback.hash || callback.pathname !== '/api/microsoft/callback'
      || callback.href !== config.redirectUri || (callback.protocol !== 'https:'
        && !(config.allowLoopbackHttpForTests === true && callback.protocol === 'http:' && loopback))) throw new Error();
    if (!config.certificate || typeof config.certificate.privateKeyPem !== 'string' || typeof config.certificate.certificatePem !== 'string')
      throw new Error();
  } catch { throw new MicrosoftOAuthError('invalid_configuration'); }
}

/** Only the care service may persist and consume state, bound to its actor/session/browser. */
export function createMicrosoftOAuthClient(config: MicrosoftOAuthConfig, options: { fetch?: typeof fetch; now?: () => number } = {}) {
  validateMicrosoftOAuthConfig(config);
  // Copy identifiers so a mutable config cannot change authority between token rounds.
  const tenantId = config.tenantId.toLowerCase(), clientId = config.clientId.toLowerCase();
  const objectId = config.expectedObjectId.toLowerCase(), redirectUri = config.redirectUri;
  const tokenEndpoint = `${authority}/${tenantId}/oauth2/v2.0/token`;
  const issuer = `${authority}/${tenantId}/v2.0`;
  const jwksEndpoint = `${authority}/${tenantId}/discovery/v2.0/keys`;
  const fetcher = options.fetch ?? fetch, now = options.now ?? Date.now;
  let privateKey: KeyObject, certificate: X509Certificate;
  try {
    privateKey = createPrivateKey(config.certificate.privateKeyPem);
    certificate = new X509Certificate(config.certificate.certificatePem);
    if (privateKey.asymmetricKeyType !== 'rsa' || (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
      || !certificate.checkPrivateKey(privateKey)) throw new Error();
  } catch { throw new MicrosoftOAuthError('invalid_configuration'); }
  const thumbprint = createHash('sha256').update(certificate.raw).digest('base64url');
  let cachedKeys: { resolver: ReturnType<typeof createLocalJWKSet>; loadedAt: number } | undefined;

  async function jsonRequest(url: string, init: RequestInit, signal?: AbortSignal): Promise<Record<string, unknown>> {
    try {
      const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
      requestSignal.throwIfAborted();
      const response = await fetcher(url, { ...init, redirect: 'error', signal: requestSignal });
      if (response.redirected || (response.url && response.url !== url)) throw new MicrosoftOAuthError('provider_unavailable');
      if (Number(response.headers.get('content-length') ?? 0) > responseLimit) {
        await response.body?.cancel();
        throw new MicrosoftOAuthError('invalid_token_response');
      }
      if (!response.body) throw new MicrosoftOAuthError('invalid_token_response');
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      const cancelBody = () => { void reader.cancel().catch(() => undefined); };
      requestSignal.addEventListener('abort', cancelBody, { once: true });
      if (requestSignal.aborted) cancelBody();
      let length = 0;
      try {
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          length += item.value.byteLength;
          if (length > responseLimit) { await reader.cancel(); throw new MicrosoftOAuthError('invalid_token_response'); }
          chunks.push(item.value);
        }
        requestSignal.throwIfAborted();
      } finally { requestSignal.removeEventListener('abort', cancelBody); reader.releaseLock(); }
      let payload: unknown;
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new MicrosoftOAuthError('invalid_token_response'); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new MicrosoftOAuthError('invalid_token_response');
      const data = payload as Record<string, unknown>;
      if (!response.ok || data.error !== undefined) {
        const diagnostic = { httpStatus: response.status, providerCodes: data.error_codes };
        if (['invalid_grant', 'interaction_required', 'consent_required', 'login_required', 'access_denied'].includes(String(data.error)))
          throw new MicrosoftOAuthError('reauthorization_required', diagnostic);
        throw new MicrosoftOAuthError('provider_unavailable', diagnostic);
      }
      return data;
    } catch (error) {
      if (error instanceof MicrosoftOAuthError) throw error;
      // Provider bodies and lower-level errors can contain codes, tokens or tenant data.
      throw new MicrosoftOAuthError('provider_unavailable');
    }
  }

  async function signingKeys(force = false, signal?: AbortSignal) {
    if (!force && cachedKeys && now() - cachedKeys.loadedAt < 10 * 60_000) return cachedKeys.resolver;
    const data = await jsonRequest(jwksEndpoint, { headers: { Accept: 'application/json' } }, signal);
    if (!Array.isArray(data.keys) || !data.keys.length || data.keys.length > 100) throw new MicrosoftOAuthError('invalid_id_token');
    try {
      const resolver = createLocalJWKSet(data as unknown as JSONWebKeySet);
      cachedKeys = { resolver, loadedAt: now() };
      return resolver;
    } catch { throw new MicrosoftOAuthError('invalid_id_token'); }
  }

  async function verifyIdentity(idToken: unknown, expectedNonce?: string, signal?: AbortSignal): Promise<MicrosoftTokenSet['identity']> {
    if (signal?.aborted) throw new MicrosoftOAuthError('provider_unavailable');
    if (!tokenString(idToken)) throw new MicrosoftOAuthError('invalid_id_token');
    let claims: JWTPayload;
    const verification = {
      algorithms: ['RS256'], issuer, audience: clientId, clockTolerance: 30, currentDate: new Date(now()),
      requiredClaims: ['iss', 'aud', 'exp', 'iat', 'nbf', 'sub', 'tid', 'oid', 'ver', ...(expectedNonce ? ['nonce'] : [])],
    };
    try {
      try { claims = (await jwtVerify(idToken, await signingKeys(false, signal), verification)).payload; }
      catch (error) {
        // Refresh public signing keys once for rotation; never repeat the code exchange.
        if ((error as { code?: string }).code !== 'ERR_JWKS_NO_MATCHING_KEY') throw error;
        claims = (await jwtVerify(idToken, await signingKeys(true, signal), verification)).payload;
      }
    } catch (error) {
      if (error instanceof MicrosoftOAuthError && error.code === 'provider_unavailable') throw error;
      throw new MicrosoftOAuthError('invalid_id_token');
    }
    if (signal?.aborted) throw new MicrosoftOAuthError('provider_unavailable');
    if (claims.ver !== '2.0' || claims.aud !== clientId || typeof claims.sub !== 'string' || !claims.sub
      || typeof claims.iat !== 'number' || claims.iat > now() / 1000 + 30 || typeof claims.exp !== 'number' || claims.exp <= claims.iat
      || (expectedNonce !== undefined && (typeof claims.nonce !== 'string' || !same(claims.nonce, expectedNonce))))
      throw new MicrosoftOAuthError('invalid_id_token');
    if (typeof claims.tid !== 'string' || claims.tid.toLowerCase() !== tenantId
      || typeof claims.oid !== 'string' || claims.oid.toLowerCase() !== objectId)
      throw new MicrosoftOAuthError('identity_not_allowed');
    return { tenantId, objectId };
  }

  async function assertion(): Promise<string> {
    const instant = now(), seconds = Math.floor(instant / 1000);
    if (Date.parse(certificate.validFrom) > instant || Date.parse(certificate.validTo) <= instant)
      throw new MicrosoftOAuthError('invalid_configuration');
    try {
      return await new SignJWT({}).setProtectedHeader({ alg: 'PS256', typ: 'JWT', 'x5t#S256': thumbprint })
        .setIssuer(clientId).setSubject(clientId).setAudience(tokenEndpoint).setIssuedAt(seconds)
        .setNotBefore(seconds).setExpirationTime(seconds + 300).setJti(randomUUID()).sign(privateKey);
    } catch { throw new MicrosoftOAuthError('invalid_configuration'); }
  }

  async function requestTokens(grant: Record<string, string>, signal?: AbortSignal) {
    if (signal?.aborted) throw new MicrosoftOAuthError('provider_unavailable');
    const body = new URLSearchParams({ ...grant, client_id: clientId, scope: MICROSOFT_DELEGATED_SCOPES.join(' '),
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: await assertion() });
    return jsonRequest(tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body }, signal);
  }

  function tokens(data: Record<string, unknown>, identity: MicrosoftTokenSet['identity'], priorRefresh?: string): MicrosoftTokenSet {
    const refreshToken = data.refresh_token === undefined ? priorRefresh : data.refresh_token;
    if (data.token_type !== 'Bearer' || !tokenString(data.access_token) || !tokenString(refreshToken)
      || typeof data.expires_in !== 'number' || !Number.isInteger(data.expires_in) || data.expires_in <= 0 || data.expires_in > 172_800)
      throw new MicrosoftOAuthError('invalid_token_response');
    return { accessToken: data.access_token, refreshToken, expiresAt: new Date(now() + data.expires_in * 1000).toISOString(),
      scopes: delegatedScopes(data.scope), identity };
  }

  return {
    beginAuthorization(): MicrosoftAuthorizationAttempt {
      const state = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url');
      const codeVerifier = randomBytes(64).toString('base64url');
      const url = new URL(`${authority}/${tenantId}/oauth2/v2.0/authorize`);
      url.search = new URLSearchParams({ client_id: clientId, response_type: 'code', response_mode: 'query', redirect_uri: redirectUri,
        scope: MICROSOFT_DELEGATED_SCOPES.join(' '), state, nonce, prompt: 'select_account', code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(codeVerifier).digest('base64url') }).toString();
      return { authorizationUrl: url.toString(), state, nonce, codeVerifier, expiresAt: new Date(now() + 10 * 60_000).toISOString() };
    },
    async exchangeCode(input: { code: string; codeVerifier: string; nonce: string }, signal?: AbortSignal): Promise<MicrosoftTokenSet> {
      if (!tokenString(input.code) || !/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier) || !/^[A-Za-z0-9_-]{43,128}$/.test(input.nonce))
        throw new MicrosoftOAuthError('invalid_exchange');
      const data = await requestTokens({ grant_type: 'authorization_code', code: input.code, code_verifier: input.codeVerifier, redirect_uri: redirectUri }, signal);
      return tokens(data, await verifyIdentity(data.id_token, input.nonce, signal));
    },
    async refreshTokens(previous: MicrosoftTokenSet, signal?: AbortSignal): Promise<MicrosoftTokenSet> {
      if (!previous?.identity || previous.identity.tenantId !== tenantId || previous.identity.objectId !== objectId)
        throw new MicrosoftOAuthError('identity_not_allowed');
      if (!tokenString(previous.refreshToken)) throw new MicrosoftOAuthError('invalid_token_response');
      delegatedScopes(previous.scopes.join(' '));
      const data = await requestTokens({ grant_type: 'refresh_token', refresh_token: previous.refreshToken }, signal);
      // An ID token is optional on refresh; when supplied, its signed account must still match.
      const identity = data.id_token === undefined ? { tenantId, objectId } : await verifyIdentity(data.id_token, undefined, signal);
      return tokens(data, identity, previous.refreshToken);
    },
  };
}

export type MicrosoftOAuthClient = ReturnType<typeof createMicrosoftOAuthClient>;
