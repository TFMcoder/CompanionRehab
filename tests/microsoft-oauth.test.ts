import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, X509Certificate } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { createMicrosoftOAuthClient, MICROSOFT_DELEGATED_SCOPES, MicrosoftOAuthError, type MicrosoftOAuthConfig, type MicrosoftTokenSet } from '../src/server/microsoft/oauth.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const clientId = '22222222-2222-4222-8222-222222222222';
const objectId = '33333333-3333-4333-8333-333333333333';
const otherId = '44444444-4444-4444-8444-444444444444';
const now = Date.parse('2026-10-17T12:00:00Z');
const seconds = now / 1000;
const signingKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rotatedKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...signingKey.publicKey.export({ format: 'jwk' }), kid: 'synthetic-key', use: 'sig', alg: 'RS256' };
const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
const tokenEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

function config(overrides: Partial<MicrosoftOAuthConfig> = {}): MicrosoftOAuthConfig {
  return { tenantId, clientId, expectedObjectId: objectId, redirectUri: 'https://companion.example/api/microsoft/callback',
    certificate: { privateKeyPem, certificatePem }, ...overrides };
}

async function idToken(nonce: string, claims: JWTPayload = {}, useRotated = false) {
  return new SignJWT({ iss: issuer, aud: clientId, sub: 'synthetic-subject', tid: tenantId, oid: objectId, ver: '2.0',
    iat: seconds, nbf: seconds - 1, exp: seconds + 3600, nonce, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: useRotated ? 'rotated-key' : jwk.kid })
    .sign(useRotated ? rotatedKey.privateKey : signingKey.privateKey);
}

function harness(options: { claims?: JWTPayload; tokenChanges?: Record<string, unknown>; rotated?: boolean } = {}) {
  let nonce = '';
  let keyReads = 0;
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/discovery/v2.0/keys')) {
      keyReads++;
      return Response.json({ keys: options.rotated && keyReads > 1
        ? [{ ...rotatedKey.publicKey.export({ format: 'jwk' }), kid: 'rotated-key', use: 'sig', alg: 'RS256' }] : [jwk] });
    }
    expect(String(url)).toBe(tokenEndpoint);
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return Response.json({ token_type: 'Bearer', access_token: 'opaque-access-token', refresh_token: 'opaque-refresh-token', expires_in: 3600,
      scope: MICROSOFT_DELEGATED_SCOPES.join(' '), id_token: await idToken(nonce, options.claims, options.rotated), ...options.tokenChanges });
  });
  const client = createMicrosoftOAuthClient(config(), { fetch: fetcher, now: () => now });
  const attempt = client.beginAuthorization();
  nonce = attempt.nonce;
  return { client, attempt, fetcher, exchange: () => client.exchangeCode({ code: 'single-use-code', codeVerifier: attempt.codeVerifier, nonce: attempt.nonce }) };
}

function previous(overrides: Partial<MicrosoftTokenSet> = {}): MicrosoftTokenSet {
  return { accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: new Date(now - 1000).toISOString(),
    scopes: [...MICROSOFT_DELEGATED_SCOPES], identity: { tenantId, objectId }, ...overrides };
}

describe('Microsoft delegated authorization', () => {
  it('keeps provider diagnostics bounded and excludes strings, descriptions and credentials', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: 'invalid_client',
      error_description: 'private credential and tenant details', error_codes: [700027, 'private-token', -1, null, 1.5, 2_000_000_000, 700016, 7000215, 7000222, 1] }, { status: 400 }));
    const client = createMicrosoftOAuthClient(config(), { fetch: fetcher, now: () => now });
    const attempt = client.beginAuthorization();
    const failure = await client.exchangeCode({ code: 'single-use-private-code', codeVerifier: attempt.codeVerifier, nonce: attempt.nonce }).catch(error => error);
    expect(failure).toMatchObject({ code: 'provider_unavailable', httpStatus: 400, providerCodes: [700027, 700016, 7000215, 7000222] });
    expect(JSON.stringify(failure)).not.toMatch(/private|credential|tenant details/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('creates independent random state, nonce and S256 PKCE at the exact tenant/callback', () => {
    const { client, attempt } = harness();
    const url = new URL(attempt.authorizationUrl);
    expect(url.origin + url.pathname).toBe(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`);
    expect(url.searchParams.get('redirect_uri')).toBe(config().redirectUri);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('response_mode')).toBe('query');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(attempt.codeVerifier).digest('base64url'));
    expect(url.searchParams.get('scope')?.split(' ')).toEqual(MICROSOFT_DELEGATED_SCOPES);
    expect(url.searchParams.get('nonce')).toBe(attempt.nonce);
    expect(url.searchParams.get('state')).toBe(attempt.state);
    expect(attempt.state).not.toBe(attempt.nonce);
    expect(client.beginAuthorization().state).not.toBe(attempt.state);
    expect(Date.parse(attempt.expiresAt) - now).toBe(600_000);
    expect(url.toString()).not.toContain(attempt.codeVerifier);
  });

  it.each(['http://companion.example/api/microsoft/callback', 'https://companion.example/wrong',
    'https://companion.example/api/microsoft/callback?forward=evil', 'https://companion.example/api/microsoft/callback#fragment',
    'https://user:password@companion.example/api/microsoft/callback', 'http://127.0.0.1/api/microsoft/callback'])
  ('rejects unsafe or ambiguous callback %s', redirectUri => {
    expect(() => createMicrosoftOAuthClient(config({ redirectUri }))).toThrow('configuration is invalid');
  });

  it('allows HTTP loopback only when explicitly enabled, never another host', () => {
    expect(() => createMicrosoftOAuthClient(config({ redirectUri: 'http://127.0.0.1:8812/api/microsoft/callback', allowLoopbackHttpForTests: true }))).not.toThrow();
    expect(() => createMicrosoftOAuthClient(config({ redirectUri: 'http://elsewhere.example/api/microsoft/callback', allowLoopbackHttpForTests: true }))).toThrow();
  });

  it.each(['common', 'organizations', '11111111-1111-4111-8111-111111111111/evil'])('rejects non-specific tenant %s', value => {
    expect(() => createMicrosoftOAuthClient(config({ tenantId: value }))).toThrow();
  });

  it('checks the private key matches the configured certificate', () => {
    expect(() => createMicrosoftOAuthClient(config({ certificate: { certificatePem,
      privateKeyPem: rotatedKey.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString() } }))).toThrow();
  });

  it('exchanges a code with a verifiable certificate assertion and validated account identity', async () => {
    const h = harness();
    const result = await h.exchange();
    expect(result).toEqual({ accessToken: 'opaque-access-token', refreshToken: 'opaque-refresh-token', scopes: MICROSOFT_DELEGATED_SCOPES,
      expiresAt: new Date(now + 3_600_000).toISOString(), identity: { tenantId, objectId } });
    const body = h.fetcher.mock.calls.find(call => String(call[0]) === tokenEndpoint)![1]!.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('single-use-code');
    expect(body.get('code_verifier')).toBe(h.attempt.codeVerifier);
    expect(body.get('redirect_uri')).toBe(config().redirectUri);
    expect(body.has('client_secret')).toBe(false);
    expect(body.get('client_assertion_type')).toBe('urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
    const assertion = await jwtVerify(body.get('client_assertion')!, createPublicKey(certificatePem),
      { algorithms: ['PS256'], audience: tokenEndpoint, issuer: clientId, currentDate: new Date(now) });
    expect(assertion.protectedHeader['x5t#S256']).toBe(createHash('sha256').update(new X509Certificate(certificatePem).raw).digest('base64url'));
    expect(assertion.payload.sub).toBe(clientId);
    expect(assertion.payload.exp! - assertion.payload.iat!).toBe(300);
    expect(assertion.payload.jti).toBeTruthy();
  });

  it.each([
    ['wrong issuer', { iss: `https://login.microsoftonline.com/${otherId}/v2.0` }],
    ['wrong audience', { aud: otherId }], ['multiple audiences', { aud: [clientId, otherId] }],
    ['expired token', { exp: seconds - 60 }], ['future token', { nbf: seconds + 60 }], ['future issue time', { iat: seconds + 60 }],
    ['wrong nonce', { nonce: 'different' }], ['wrong version', { ver: '1.0' }], ['missing subject', { sub: '' }],
    ['missing expiry', { exp: undefined }], ['missing nonce', { nonce: undefined }],
  ] as [string, JWTPayload][])('rejects signed ID token with %s', async (_label, claims) => {
    await expect(harness({ claims }).exchange()).rejects.toMatchObject({ code: 'invalid_id_token' });
  });

  it.each([{ oid: otherId }, { tid: otherId }, { oid: undefined, email: 'intended@example.com' }])
  ('never uses email or another account as the approved object identity', async claims => {
    await expect(harness({ claims }).exchange()).rejects.toBeInstanceOf(MicrosoftOAuthError);
  });

  it('rejects unsigned and invalidly signed ID tokens', async () => {
    await expect(harness({ tokenChanges: { id_token: 'eyJhbGciOiJub25lIn0.e30.' } }).exchange()).rejects.toMatchObject({ code: 'invalid_id_token' });
    const invalid = await new SignJWT({ iss: issuer, aud: clientId, exp: seconds + 3600 }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).sign(rotatedKey.privateKey);
    await expect(harness({ tokenChanges: { id_token: invalid } }).exchange()).rejects.toMatchObject({ code: 'invalid_id_token' });
  });

  it('loads rotated signing keys without repeating the code exchange', async () => {
    const h = harness({ rotated: true });
    await expect(h.exchange()).resolves.toMatchObject({ identity: { tenantId, objectId } });
    expect(h.fetcher.mock.calls.filter(call => String(call[0]) === tokenEndpoint)).toHaveLength(1);
    expect(h.fetcher.mock.calls.filter(call => String(call[0]).endsWith('/keys'))).toHaveLength(2);
  });

  it.each([undefined, 'User.Read', 'User.Read email', 'User.Read Calendars.ReadWrite Mail.ReadWrite Mail.Send Directory.Read.All',
    'User.Read Calendars.ReadWrite Mail.ReadWrite Mail.Send email Directory.Read.All',
    'User.Read Calendars.ReadWrite Mail.ReadWrite Mail.Send https://other.example/email', '.default'])
  ('fails closed on missing, reduced or expanded permissions', async scope => {
    await expect(harness({ tokenChanges: { scope } }).exchange()).rejects.toMatchObject({ code: 'invalid_scopes' });
  });

  it('normalizes only Microsoft Graph resource-prefixed delegated scopes', async () => {
    const scope = ['User.Read', 'Calendars.ReadWrite', 'Mail.ReadWrite', 'Mail.Send'].map(s => `https://graph.microsoft.com/${s}`).join(' ');
    await expect(harness({ tokenChanges: { scope } }).exchange()).resolves.toMatchObject({ scopes: ['User.Read', 'Calendars.ReadWrite', 'Mail.ReadWrite', 'Mail.Send'] });
  });

  it('accepts Entra default OIDC email metadata without requesting more access or using it as identity', async () => {
    const scope = [...MICROSOFT_DELEGATED_SCOPES, 'email'].join(' ');
    const h = harness({ tokenChanges: { scope } });
    await expect(h.exchange()).resolves.toMatchObject({ scopes: [...MICROSOFT_DELEGATED_SCOPES, 'email'], identity: { tenantId, objectId } });
    expect(new URL(h.attempt.authorizationUrl).searchParams.get('scope')).toBe(MICROSOFT_DELEGATED_SCOPES.join(' '));
    expect((h.fetcher.mock.calls.find(call => String(call[0]) === tokenEndpoint)![1]!.body as URLSearchParams).get('scope')).toBe(MICROSOFT_DELEGATED_SCOPES.join(' '));
    await expect(h.client.refreshTokens(previous({ scopes: [...MICROSOFT_DELEGATED_SCOPES, 'email'] }))).resolves.toMatchObject({ identity: { tenantId, objectId } });
    await expect(harness({ claims: { oid: otherId, email: 'approved@example.invalid' }, tokenChanges: { scope } }).exchange()).rejects.toMatchObject({ code: 'identity_not_allowed' });
  });

  it('diagnoses a provider scope mismatch without retaining unapproved scope text', async () => {
    const failure = await harness({ tokenChanges: { scope: 'User.Read email private-unapproved-scope' } }).exchange().catch(error => error);
    expect(failure).toMatchObject({ code: 'invalid_scopes', scopeCheck: {
      missing_graph_scopes: ['Calendars.ReadWrite', 'Mail.ReadWrite', 'Mail.Send'], unexpected_scope_count: 1, email_returned: true,
    } });
    expect(JSON.stringify(failure)).not.toContain('private-unapproved-scope');
  });

  it.each([{ expires_in: -1 }, { expires_in: '3600' }, { token_type: 'basic' }, { access_token: '' }, { refresh_token: '' }])
  ('rejects malformed token metadata', async tokenChanges => {
    await expect(harness({ tokenChanges }).exchange()).rejects.toMatchObject({ code: 'invalid_token_response' });
  });

  it('preserves the old refresh token only when Microsoft omits a replacement', async () => {
    const h = harness({ tokenChanges: { refresh_token: undefined, id_token: undefined } });
    await expect(h.client.refreshTokens(previous())).resolves.toMatchObject({ refreshToken: 'old-refresh', identity: { tenantId, objectId } });
    const body = h.fetcher.mock.calls[0][1]!.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('old-refresh');
    expect(body.has('code')).toBe(false);
  });

  it('returns rotated refresh credentials and revalidates an optional refreshed identity', async () => {
    const h = harness({ tokenChanges: { refresh_token: 'rotated-refresh' } });
    await expect(h.client.refreshTokens(previous())).resolves.toMatchObject({ refreshToken: 'rotated-refresh' });
    await expect(harness({ claims: { oid: otherId } }).client.refreshTokens(previous())).rejects.toMatchObject({ code: 'identity_not_allowed' });
  });

  it('rejects another stored identity before sending a refresh token', async () => {
    const h = harness();
    await expect(h.client.refreshTokens(previous({ identity: { tenantId, objectId: otherId } }))).rejects.toMatchObject({ code: 'identity_not_allowed' });
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it('redacts provider errors and makes no automatic exchange or refresh retry', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: 'invalid_grant', error_description: 'SECRET CODE TOKEN EMAIL' }, { status: 400 }));
    const client = createMicrosoftOAuthClient(config(), { fetch: fetcher, now: () => now });
    await expect(client.refreshTokens(previous())).rejects.toMatchObject({ code: 'reauthorization_required', message: 'Microsoft requires sign-in and consent again.' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockRejectedValueOnce(new Error('SECRET request body'));
    const attempt = client.beginAuthorization();
    await expect(client.exchangeCode({ code: 'secret-code', nonce: attempt.nonce, codeVerifier: attempt.codeVerifier })).rejects.toMatchObject({ code: 'provider_unavailable', message: 'Microsoft sign-in is unavailable. Start sign-in again later.' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('bounds streamed response bytes and rejects redirected credentials', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('a'.repeat(270_000)));
    const client = createMicrosoftOAuthClient(config(), { fetch: fetcher, now: () => now });
    await expect(client.refreshTokens(previous())).rejects.toMatchObject({ code: 'invalid_token_response' });
    fetcher.mockResolvedValueOnce(Object.defineProperty(Response.json({}), 'url', { value: 'https://other.example/token' }));
    await expect(client.refreshTokens(previous())).rejects.toMatchObject({ code: 'provider_unavailable' });
  });

  it('rejects expired application certificates before sending credentials', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createMicrosoftOAuthClient(config(), { fetch: fetcher, now: () => Date.parse('2031-01-01T00:00:00Z') });
    await expect(client.refreshTokens(previous())).rejects.toMatchObject({ code: 'invalid_configuration' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not send code or refresh credentials after the operation is aborted', async () => {
    const h = harness(), controller = new AbortController();
    controller.abort();
    await expect(h.client.refreshTokens(previous(), controller.signal)).rejects.toMatchObject({ code: 'provider_unavailable' });
    await expect(h.client.exchangeCode({ code: 'single-use-code', nonce: h.attempt.nonce, codeVerifier: h.attempt.codeVerifier }, controller.signal))
      .rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it('cancels an unfinished response body when the shared operation is aborted', async () => {
    const controller = new AbortController(), cancelled = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async () => {
      setTimeout(() => controller.abort(), 5);
      return new Response(new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode('{')); }, cancel: cancelled }));
    });
    const client = createMicrosoftOAuthClient(config(), { fetch: fetcher, now: () => now });
    await expect(client.refreshTokens(previous(), controller.signal)).rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(cancelled).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

// Synthetic, never-registered certificate and key used only by offline tests.
const certificatePem = "-----BEGIN CERTIFICATE-----\nMIIC2jCCAcKgAwIBAgIIEb8SkM+ixYYwDQYJKoZIhvcNAQELBQAwLTErMCkGA1UE\nAxMiQ29tcGFuaW9uUmVoYWIgU3ludGhldGljIFRlc3QgT25seTAeFw0yNjAxMDEw\nMDAwMDBaFw0zMDAxMDEwMDAwMDBaMC0xKzApBgNVBAMTIkNvbXBhbmlvblJlaGFi\nIFN5bnRoZXRpYyBUZXN0IE9ubHkwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK\nAoIBAQDzdBBCur43xbKhwu4ecwyuFiB6N74QraOeo2I29lc4+wvwsBZikslNetzV\nQXjg/am4g0e6ovwNUPa55nh9e7PRF2FWRWdl3ChAJC5l/NSO12sY81M4t8TiNRDa\nQeDHq8aTNvdxr77YBUOu6zqyzBMxfdIUNkiidMYOlyEmG3WJYPFntkUgqT8rTkBC\nVpwThfnemECtmeTSrrm3GROWBvAcsXk9PRn0FP6tZojzRkEDJdzcHLUnqbo510nk\notCRaGfBUSqJmOvXUWW5Vt9xvXlUmltrZGI13b+8nrolew38hYRAudyOgACUddQC\ni3jPK2IVQcMgD05QS/ntx58euvgJAgMBAAEwDQYJKoZIhvcNAQELBQADggEBAN/c\nhNKZDMEnfs1hkOL1CvTWoMfF3Jtc/b1RreFMLA4D+8bFUqIY/kpX5edtj0HZpig2\nOSEG9+XSrusYX5Tu636NEOr8r3IMPItYm5Iu3GYnuBA2gQS+qIc+Zeci2Eg8xtDH\nIxaWSjGyDn8gmN45Vmeg/Qe4JuFx18RZWJj2CNV1GxOoNVHQwAD1eAS84ws1IJd2\nUu/yMrLPcXFQNUqVZXeogcmXioNW9tEkfb6OaK6sGWpIY0ia06MqmILTvKz2Mw7o\nhd3RGlO1H+jSZBZkD5ys7aP9bwiplfG99qVUZO3sRDh6Enw0sPDKvVXtZ1SqK8GW\ndwG0opCYxmaZJ4Npsj4=\n-----END CERTIFICATE-----";
const privateKeyPem = "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDzdBBCur43xbKh\nwu4ecwyuFiB6N74QraOeo2I29lc4+wvwsBZikslNetzVQXjg/am4g0e6ovwNUPa5\n5nh9e7PRF2FWRWdl3ChAJC5l/NSO12sY81M4t8TiNRDaQeDHq8aTNvdxr77YBUOu\n6zqyzBMxfdIUNkiidMYOlyEmG3WJYPFntkUgqT8rTkBCVpwThfnemECtmeTSrrm3\nGROWBvAcsXk9PRn0FP6tZojzRkEDJdzcHLUnqbo510nkotCRaGfBUSqJmOvXUWW5\nVt9xvXlUmltrZGI13b+8nrolew38hYRAudyOgACUddQCi3jPK2IVQcMgD05QS/nt\nx58euvgJAgMBAAECggEBAKWtfsNqwrjB2ecr+VDPivmOJVwHQ1mmUYtMNTKiQomM\nj3uk2hcLPeN0kYSvocu71Ry0esQQ1udZCg9JQQZkgOLyvlMvuEYhpWLBPLI7dYwg\nHcpFDYWzylEHPAjMfGRmCiV1ar/7ki0AqCcJ/lBfgVBVB/qpVpT4UzDquKxuU3bB\nJrJ2QzlZZxn6f3xsRA/XAd/zqEKbpwp1luD99wz9ircff1kI7oaqTs+0hLr12VIg\nrZa6vjeTDYtg5muPSXKdlksntpveqjS9fS9eeQeCQDxh3Y2wfcPwDadQFz5ge+sg\nIHfCpU2Pil8qbwMNVei2pdf+yIJq15znR4Xud7p4RGECgYEA9bVkW0n35GRo2hzY\nYbFR03NYA3JeB22TIsegD2R3khBXAvjwWN7+EhuXdeFkvVv0QOdikp6RIHOIxim1\ndv6RhDXzXB15iZaYBq3Ff2MLLpPHSbhTJgtFRXjm3hGcEvZ13kVJqtCjZdNX+XGT\nN74c/flCrlanCRH1PIY22muzuxcCgYEA/aZ9gQ2V8C3KweY9nem9ZJmBfUC4wXyj\nRfzmNlILZaTicBCMFFYbQUdySsXepIgMjdD0PYXUGwviIn5TrNw5VaZJXLSlEN1D\nwszGdKQNlLyuAExy7nIO/HMHK6oe11LcYb8snjOpri+GYGO23A4u3UCRSQk3Q1D9\nCLpqWOvgWd8CgYAy31Cc+g6iMgvnhOtkJrN7ZTlG1WoUfaJmJBDGvxVmn410ZxhU\nPi86jo3ocTdLYXuL6JxnIP+JSYJ7DO2uany0c/skClI8o3psf5QRkO8iwKQVZl2I\n1fKMtMCQH/NBldfHom7jN/lsvrpLQjGp6+nSx8X/lJ9W6GnvExbOWFhJFwKBgQCA\nbe84C8fyX009VjW2oiX6LNtqrv2dQl1tT3rE4E/S/GSGt2ol1d9g8ysEfyGXDyfE\nGpvAFuXpd9/c9Teq26rQGi0lGnZFjrMDjCmj33jc6Zf0oMDEyM2btyZXToDlJ5hc\nia6uv5vXjUqtvW9WBnxmHI4ze84WcIheBf1Y3r2u4wKBgCTohYsmyaLdwgQxkK0h\nCN3qNJgJR6FGs2dbBvpqUQcnEhF9Vf0RZac6CNNede2NT9mWuNrV8rCUWtsuk7pA\n4d5+oJaR957mrfXJdDH2InqleZ/CxIm8sR4115GbLc0y4onULEeV1LOoHG/qSvOe\nOjm8d72ngRrpLMATrtQUNZd7\n-----END PRIVATE KEY-----";
