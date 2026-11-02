import {generateKeyPairSync} from 'node:crypto';
import {SignJWT} from 'jose';
import {describe,it,expect,vi} from 'vitest';
import {createMicrosoftOAuthClient,MICROSOFT_CALENDAR_READ_SCOPES,MICROSOFT_CALENDAR_READ_SHARED_SCOPES,MICROSOFT_DELEGATED_SCOPES,type MicrosoftOAuthConfig,type MicrosoftTokenSet} from '../src/server/microsoft/oauth.js';

const tenantId='11111111-1111-4111-8111-111111111111',clientId='22222222-2222-4222-8222-222222222222',objectId='33333333-3333-4333-8333-333333333333';
const now=Date.parse('2026-11-01T12:00:00Z'),issuer=`https://login.microsoftonline.com/${tenantId}/v2.0`;
const signingKey=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...signingKey.publicKey.export({format:'jwk'}),kid:'calendar-key',use:'sig',alg:'RS256'};
function config(accessMode:MicrosoftOAuthConfig['accessMode']='calendar_read'):MicrosoftOAuthConfig{return {tenantId,clientId,expectedObjectId:objectId,redirectUri:'https://companion.example/api/microsoft/callback',certificate:{privateKeyPem,certificatePem},accessMode};}
function previous(scopes=[...MICROSOFT_CALENDAR_READ_SCOPES]):MicrosoftTokenSet{return {accessToken:'prior-calendar-access',refreshToken:'prior-calendar-refresh',expiresAt:new Date(now-1).toISOString(),scopes,identity:{tenantId,objectId}};}
function harness(scope=MICROSOFT_CALENDAR_READ_SCOPES.join(' '),identity=objectId,accessMode:MicrosoftOAuthConfig['accessMode']='calendar_read',options:{refreshIdentity?:string;signedTenantId?:string}={}){
 let nonce='';
 const requestedScopes=accessMode==='calendar_read_shared'?MICROSOFT_CALENDAR_READ_SHARED_SCOPES:MICROSOFT_CALENDAR_READ_SCOPES;
 const fetcher=vi.fn<typeof fetch>(async(url,init)=>{
  if(String(url).endsWith('/keys'))return Response.json({keys:[jwk]});
  const body=init?.body as URLSearchParams;
  expect(body.get('scope')).toBe(requestedScopes.join(' '));
  const refresh=body.get('grant_type')==='refresh_token';
  const id_token=await new SignJWT({iss:issuer,aud:clientId,sub:'synthetic-calendar-user',tid:options.signedTenantId??tenantId,oid:refresh?(options.refreshIdentity??identity):identity,ver:'2.0',iat:now/1000,nbf:now/1000-1,exp:now/1000+3600,nonce}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).sign(signingKey.privateKey);
  return Response.json({token_type:'Bearer',access_token:'calendar-access',refresh_token:'calendar-refresh',expires_in:3600,scope,...(!refresh||options.refreshIdentity!==undefined?{id_token}:{})});
 });
 const settings=config(accessMode),client=createMicrosoftOAuthClient(settings,{fetch:fetcher,now:()=>now}),attempt=client.beginAuthorization();nonce=attempt.nonce;
 return {settings,client,attempt,fetcher,exchange:()=>client.exchangeCode({code:'synthetic-code',codeVerifier:attempt.codeVerifier,nonce:attempt.nonce})};
}
describe('calendar-only delegated OAuth permission profile',()=>{
 it('requests only read permission and keeps selected mode immutable across authorize/exchange/refresh',async()=>{
  const h=harness();h.settings.accessMode=undefined;
  expect(new URL(h.attempt.authorizationUrl).searchParams.get('scope')).toBe(MICROSOFT_CALENDAR_READ_SCOPES.join(' '));
  expect(new URL(h.client.beginAuthorization().authorizationUrl).searchParams.get('scope')).not.toMatch(/Write|Mail/);
  const tokens=await h.exchange();expect(tokens.scopes).toEqual(MICROSOFT_CALENDAR_READ_SCOPES);
  expect((await h.client.refreshTokens(tokens)).scopes).toEqual(MICROSOFT_CALENDAR_READ_SCOPES);
 });
 it('preserves the existing primary requested permissions when mode is omitted',()=>{
  const settings=config();delete settings.accessMode;
  const client=createMicrosoftOAuthClient(settings,{now:()=>now});
  expect(new URL(client.beginAuthorization().authorizationUrl).searchParams.get('scope')).toBe(MICROSOFT_DELEGATED_SCOPES.join(' '));
 });
 it('accepts only the documented default email scope addition',async()=>{
  const h=harness([...MICROSOFT_CALENDAR_READ_SCOPES,'email'].join(' '));
  expect((await h.exchange()).scopes).toContain('email');
 });
 it.each(['Mail.Read','Mail.ReadWrite','Mail.Send','Calendars.ReadWrite','Files.Read'])('rejects extra delegated permission %s',async extra=>{
  const h=harness([...MICROSOFT_CALENDAR_READ_SCOPES,extra].join(' '));
  await expect(h.client.refreshTokens(previous())).rejects.toMatchObject({code:'invalid_scopes',scopeCheck:{unexpected_scope_count:1}});
 });
 it('requires Calendars.Read rather than accepting write permission as an equivalent',async()=>{
  const h=harness('openid profile offline_access User.Read Calendars.ReadWrite');
  await expect(h.exchange()).rejects.toMatchObject({code:'invalid_scopes',scopeCheck:{missing_graph_scopes:['Calendars.Read']}});
 });
 it('rejects broader persisted credentials before attempting refresh',async()=>{
  const h=harness();await expect(h.client.refreshTokens(previous([...MICROSOFT_DELEGATED_SCOPES]))).rejects.toMatchObject({code:'invalid_scopes'});
  expect(h.fetcher).not.toHaveBeenCalled();
 });
 it('rejects a different signed mailbox identity even in the configured tenant',async()=>{
  const h=harness(undefined,'44444444-4444-4444-8444-444444444444');
  await expect(h.exchange()).rejects.toMatchObject({code:'identity_not_allowed'});
 });
 it('requires an exact configured object ID and rejects unknown access modes',()=>{
  expect(()=>createMicrosoftOAuthClient({...config(),expectedObjectId:''})).toThrow();
  expect(()=>createMicrosoftOAuthClient({...config(),accessMode:'all' as 'calendar_read'})).toThrow();
 });
});

describe('shared-calendar read-only delegated OAuth permission profile',()=>{
 const sharedScopes=MICROSOFT_CALENDAR_READ_SHARED_SCOPES.join(' '),otherObjectId='44444444-4444-4444-8444-444444444444';
 const sharedHarness=(scope=sharedScopes,identity=objectId,options:{refreshIdentity?:string;signedTenantId?:string}={})=>harness(scope,identity,'calendar_read_shared',options);
 const sharedPrevious=()=>previous([...MICROSOFT_CALENDAR_READ_SHARED_SCOPES]);

 it('uses the exact shared read profile across authorization, exchange and refresh despite config mutation',async()=>{
  const h=sharedHarness();h.settings.accessMode='calendar_read';h.settings.expectedObjectId=otherObjectId;
  expect(new URL(h.attempt.authorizationUrl).searchParams.get('scope')).toBe(sharedScopes);
  expect(new URL(h.client.beginAuthorization().authorizationUrl).searchParams.get('scope')).toBe(sharedScopes);
  expect(sharedScopes).not.toMatch(/Mail|Write/);
  const tokens=await h.exchange();expect(tokens.scopes).toEqual(MICROSOFT_CALENDAR_READ_SHARED_SCOPES);
  expect(tokens.identity).toEqual({tenantId,objectId});
  expect((await h.client.refreshTokens(tokens)).scopes).toEqual(MICROSOFT_CALENDAR_READ_SHARED_SCOPES);
 });

 it('allows the documented response-only email addition and normalized Graph scope prefix',async()=>{
  const h=sharedHarness('openid profile offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Calendars.Read.Shared email');
  const tokens=await h.exchange();expect(tokens.scopes).toEqual([...MICROSOFT_CALENDAR_READ_SHARED_SCOPES,'email']);
  expect((await h.client.refreshTokens(tokens)).scopes).toEqual(tokens.scopes);
 });

 it.each(['Mail.Read','Mail.Read.Shared','Mail.ReadWrite','Mail.ReadWrite.Shared','Mail.Send','Mail.Send.Shared','Calendars.ReadWrite','Calendars.ReadWrite.Shared','Calendars.Read','Files.Read'])('rejects response scope expansion %s during both exchange and refresh',async extra=>{
  const h=sharedHarness(sharedScopes+' '+extra);
  await expect(h.exchange()).rejects.toMatchObject({code:'invalid_scopes',scopeCheck:{unexpected_scope_count:1}});
  await expect(h.client.refreshTokens(sharedPrevious())).rejects.toMatchObject({code:'invalid_scopes',scopeCheck:{unexpected_scope_count:1}});
 });

 it('requires shared read scope and does not substitute own-calendar or write permissions',async()=>{
  for(const substitute of ['Calendars.Read','Calendars.ReadWrite','Calendars.ReadWrite.Shared']){
   const h=sharedHarness('openid profile offline_access User.Read '+substitute);
   await expect(h.exchange()).rejects.toMatchObject({code:'invalid_scopes',scopeCheck:{missing_graph_scopes:['Calendars.Read.Shared']}});
  }
 });

 it.each([{label:'primary',scopes:MICROSOFT_DELEGATED_SCOPES},{label:'own-calendar',scopes:MICROSOFT_CALENDAR_READ_SCOPES}])('refuses incompatible persisted $label permissions before refreshing',async({scopes})=>{
  const h=sharedHarness();await expect(h.client.refreshTokens(previous([...scopes]))).rejects.toMatchObject({code:'invalid_scopes'});
  expect(h.fetcher).not.toHaveBeenCalled();
 });

 it('does not accept a shared-calendar token in the own-calendar profile',async()=>{
  const h=harness();await expect(h.client.refreshTokens(sharedPrevious())).rejects.toMatchObject({code:'invalid_scopes'});
  expect(h.fetcher).not.toHaveBeenCalled();
 });

 it('requires the configured signer rather than accepting a different calendar-owner identity',async()=>{
  const h=sharedHarness(undefined,otherObjectId);
  await expect(h.exchange()).rejects.toMatchObject({code:'identity_not_allowed'});
 });

 it('refuses a different tenant in a valid signed identity token',async()=>{
  const h=sharedHarness(undefined,objectId,{signedTenantId:'55555555-5555-4555-8555-555555555555'});
  await expect(h.exchange()).rejects.toMatchObject({code:'identity_not_allowed'});
 });

 it('rejects wrong persisted signer before network access and changed signed identity on refresh',async()=>{
  const before=sharedHarness(),wrong=sharedPrevious();wrong.identity.objectId=otherObjectId;
  await expect(before.client.refreshTokens(wrong)).rejects.toMatchObject({code:'identity_not_allowed'});
  expect(before.fetcher).not.toHaveBeenCalled();
  const refresh=sharedHarness(undefined,objectId,{refreshIdentity:otherObjectId});
  await expect(refresh.client.refreshTokens(sharedPrevious())).rejects.toMatchObject({code:'identity_not_allowed'});
 });
});

// Existing synthetic, never-registered certificate used only by offline tests.

const certificatePem = "-----BEGIN CERTIFICATE-----\nMIIC2jCCAcKgAwIBAgIIEb8SkM+ixYYwDQYJKoZIhvcNAQELBQAwLTErMCkGA1UE\nAxMiQ29tcGFuaW9uUmVoYWIgU3ludGhldGljIFRlc3QgT25seTAeFw0yNjAxMDEw\nMDAwMDBaFw0zMDAxMDEwMDAwMDBaMC0xKzApBgNVBAMTIkNvbXBhbmlvblJlaGFi\nIFN5bnRoZXRpYyBUZXN0IE9ubHkwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK\nAoIBAQDzdBBCur43xbKhwu4ecwyuFiB6N74QraOeo2I29lc4+wvwsBZikslNetzV\nQXjg/am4g0e6ovwNUPa55nh9e7PRF2FWRWdl3ChAJC5l/NSO12sY81M4t8TiNRDa\nQeDHq8aTNvdxr77YBUOu6zqyzBMxfdIUNkiidMYOlyEmG3WJYPFntkUgqT8rTkBC\nVpwThfnemECtmeTSrrm3GROWBvAcsXk9PRn0FP6tZojzRkEDJdzcHLUnqbo510nk\notCRaGfBUSqJmOvXUWW5Vt9xvXlUmltrZGI13b+8nrolew38hYRAudyOgACUddQC\ni3jPK2IVQcMgD05QS/ntx58euvgJAgMBAAEwDQYJKoZIhvcNAQELBQADggEBAN/c\nhNKZDMEnfs1hkOL1CvTWoMfF3Jtc/b1RreFMLA4D+8bFUqIY/kpX5edtj0HZpig2\nOSEG9+XSrusYX5Tu636NEOr8r3IMPItYm5Iu3GYnuBA2gQS+qIc+Zeci2Eg8xtDH\nIxaWSjGyDn8gmN45Vmeg/Qe4JuFx18RZWJj2CNV1GxOoNVHQwAD1eAS84ws1IJd2\nUu/yMrLPcXFQNUqVZXeogcmXioNW9tEkfb6OaK6sGWpIY0ia06MqmILTvKz2Mw7o\nhd3RGlO1H+jSZBZkD5ys7aP9bwiplfG99qVUZO3sRDh6Enw0sPDKvVXtZ1SqK8GW\ndwG0opCYxmaZJ4Npsj4=\n-----END CERTIFICATE-----";
const privateKeyPem = "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDzdBBCur43xbKh\nwu4ecwyuFiB6N74QraOeo2I29lc4+wvwsBZikslNetzVQXjg/am4g0e6ovwNUPa5\n5nh9e7PRF2FWRWdl3ChAJC5l/NSO12sY81M4t8TiNRDaQeDHq8aTNvdxr77YBUOu\n6zqyzBMxfdIUNkiidMYOlyEmG3WJYPFntkUgqT8rTkBCVpwThfnemECtmeTSrrm3\nGROWBvAcsXk9PRn0FP6tZojzRkEDJdzcHLUnqbo510nkotCRaGfBUSqJmOvXUWW5\nVt9xvXlUmltrZGI13b+8nrolew38hYRAudyOgACUddQCi3jPK2IVQcMgD05QS/nt\nx58euvgJAgMBAAECggEBAKWtfsNqwrjB2ecr+VDPivmOJVwHQ1mmUYtMNTKiQomM\nj3uk2hcLPeN0kYSvocu71Ry0esQQ1udZCg9JQQZkgOLyvlMvuEYhpWLBPLI7dYwg\nHcpFDYWzylEHPAjMfGRmCiV1ar/7ki0AqCcJ/lBfgVBVB/qpVpT4UzDquKxuU3bB\nJrJ2QzlZZxn6f3xsRA/XAd/zqEKbpwp1luD99wz9ircff1kI7oaqTs+0hLr12VIg\nrZa6vjeTDYtg5muPSXKdlksntpveqjS9fS9eeQeCQDxh3Y2wfcPwDadQFz5ge+sg\nIHfCpU2Pil8qbwMNVei2pdf+yIJq15znR4Xud7p4RGECgYEA9bVkW0n35GRo2hzY\nYbFR03NYA3JeB22TIsegD2R3khBXAvjwWN7+EhuXdeFkvVv0QOdikp6RIHOIxim1\ndv6RhDXzXB15iZaYBq3Ff2MLLpPHSbhTJgtFRXjm3hGcEvZ13kVJqtCjZdNX+XGT\nN74c/flCrlanCRH1PIY22muzuxcCgYEA/aZ9gQ2V8C3KweY9nem9ZJmBfUC4wXyj\nRfzmNlILZaTicBCMFFYbQUdySsXepIgMjdD0PYXUGwviIn5TrNw5VaZJXLSlEN1D\nwszGdKQNlLyuAExy7nIO/HMHK6oe11LcYb8snjOpri+GYGO23A4u3UCRSQk3Q1D9\nCLpqWOvgWd8CgYAy31Cc+g6iMgvnhOtkJrN7ZTlG1WoUfaJmJBDGvxVmn410ZxhU\nPi86jo3ocTdLYXuL6JxnIP+JSYJ7DO2uany0c/skClI8o3psf5QRkO8iwKQVZl2I\n1fKMtMCQH/NBldfHom7jN/lsvrpLQjGp6+nSx8X/lJ9W6GnvExbOWFhJFwKBgQCA\nbe84C8fyX009VjW2oiX6LNtqrv2dQl1tT3rE4E/S/GSGt2ol1d9g8ysEfyGXDyfE\nGpvAFuXpd9/c9Teq26rQGi0lGnZFjrMDjCmj33jc6Zf0oMDEyM2btyZXToDlJ5hc\nia6uv5vXjUqtvW9WBnxmHI4ze84WcIheBf1Y3r2u4wKBgCTohYsmyaLdwgQxkK0h\nCN3qNJgJR6FGs2dbBvpqUQcnEhF9Vf0RZac6CNNede2NT9mWuNrV8rCUWtsuk7pA\n4d5+oJaR957mrfXJdDH2InqleZ/CxIm8sR4115GbLc0y4onULEeV1LOoHG/qSvOe\nOjm8d72ngRrpLMATrtQUNZd7\n-----END PRIVATE KEY-----";
