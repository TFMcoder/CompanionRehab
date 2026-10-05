import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { accountKey, type PlanCredential, type PlanState, PlanStore } from './storage.js';
import { beginAuthorization, exchangeCode, readCallback, requiredScope, validateIdToken, issuer, type Attempt } from './oauth.js';
import { probeSolHigh, probeSolHighTools, refreshCredential, type ProbeResult } from './inference.js';
import { PlanRequestError, ToolProbeError } from './inference.js';

const host = '127.0.0.1';
const htmlHeaders = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
  // Preserve the Origin header on local form POSTs; suppress cross-origin referrers.
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'none'; style-src 'self' 'unsafe-inline'; form-action 'self' https://auth.openai.com; frame-ancestors 'none'; base-uri 'none'" };
function escape(value: string): string { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!); }
function render(content: string, csrf: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Companion Rehab ChatGPT connection</title>
  <style>body{font:18px system-ui;max-width:42rem;margin:3rem auto;padding:0 1rem;line-height:1.5;background:#faf9f6;color:#1d2935}button{font:inherit;padding:.65rem 1rem;margin:.35rem;border-radius:.5rem;background:#174778;color:white;border:0;cursor:pointer}form{display:inline-block}p{max-width:38rem}</style>
  <h1>Companion Rehab connection</h1><p>This local setup connects your own ChatGPT account to synthetic reasoning tests. It uses your ChatGPT plan allowance. It does not access ChatGPT conversations or send care records in these tests.</p><p>The text test sends one request; the read-only synthetic tool test sends at most two. Both use GPT-6 Sol with high reasoning effort and a 45-second local timeout per request. The ChatGPT usage settings control plan limits. There is no API-key fallback.</p>
  ${content}<p><a href="https://chatgpt.com/#settings/usage">Review plan usage and app limits</a></p>
  <form method="post" action="/start"><input type="hidden" name="csrf" value="${csrf}"><button>Continue with ChatGPT</button></form>
  <form method="post" action="/new"><input type="hidden" name="csrf" value="${csrf}"><button>Add another account</button></form></html>`;
}
function send(res: ServerResponse, code: number, body: string, cookie?: string): void {
  res.writeHead(code, { ...htmlHeaders, ...(cookie ? { 'Set-Cookie': cookie } : {}) }); res.end(body);
}
function redirect(res: ServerResponse, location: string, cookie?: string): void { res.writeHead(303, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...(cookie ? { 'Set-Cookie': cookie } : {}) }); res.end(); }
function cookieIs(req: IncomingMessage, name: string, value: string): boolean {
  return !!req.headers.cookie?.split(';').some(part => part.trim() === `${name}=${value}`);
}
function safeNotice(error: unknown): string {
  if (error instanceof PlanRequestError) return error.message;
  const known = new Set(['Sign-in timed out. Start again.', 'Unexpected sign-in callback.', 'Sign-in state did not match. Start again.',
    'ChatGPT sign-in was declined or interrupted.', 'Sign-in returned no code.', 'Conflicting client IDs in callback.',
    'Sign-in returned a different client registration.', 'Sign-in did not issue a valid client ID.',
    'ChatGPT ID token claims did not validate.', 'ChatGPT ID token signature did not validate.',
    'OpenAI signing key was not found.', 'Could not load OpenAI signing keys.',
    'Sign-in returned a different ChatGPT account.', 'Refreshed ChatGPT identity changed. Sign in again.',
    'ChatGPT plan permission is missing.', 'ChatGPT plan use was not granted for this connection.',
    'ChatGPT response was incomplete.', 'ChatGPT stream ended without response.completed.',
    'ChatGPT completed with a different model or status.', 'ChatGPT returned no response stream.',
    'Synthetic tool call was not authorized.', 'Synthetic tool result was not verified.']);
  return error instanceof Error && known.has(error.message) ? error.message : 'Connection failed. Check the account or try again.';
}
async function form(req: IncomingMessage): Promise<URLSearchParams> {
  let body = '';
  for await (const chunk of req) { body += chunk.toString(); if (body.length > 4096) throw new Error('Request too large.'); }
  return new URLSearchParams(body);
}
function active(state: PlanState): PlanCredential | undefined { return state.activeKey ? state.accounts[state.activeKey] : undefined; }

export async function startPlanSetup(store: PlanStore, fetcher: typeof fetch = fetch): Promise<{ url: string; close: () => Promise<void> }> {
  const unlock = await store.lock();
  try {
  let state = await store.load();
  await store.save(state); // Persists a stable host ID before the first authorization.
  let attempt: Attempt | undefined;
  let notice = '';
  let result: ProbeResult | undefined;
  let csrf = randomBytes(32).toString('base64url');
  let browserBinding: string | undefined;
  let working = false;
  const server = createServer(async (req, res) => {
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Listener is unavailable.');
      const origin = `http://${host}:${address.port}`;
      if (req.headers.host !== `${host}:${address.port}` || req.socket.remoteAddress !== host) { send(res, 403, 'Forbidden'); return; }
      const path = new URL(req.url || '/', origin);
      if (path.pathname === '/auth/callback' && req.method === 'GET') {
        if (!attempt || !browserBinding || !cookieIs(req, 'plan_oauth_binding', browserBinding) || working) { send(res, 400, 'No matching sign-in is pending.'); return; }
        working = true;
        const pending = attempt;
        try {
          let callback;
          try { callback = readCallback(path.toString(), pending); }
          catch (error) { if (path.searchParams.get('error') && path.searchParams.get('state') === pending.state) { attempt = undefined; browserBinding = undefined; } throw error; }
          const { code, clientId } = callback;
          attempt = undefined; browserBinding = undefined; // One use, including an exchange failure.
          const tokens = await exchangeCode(code, clientId, pending, fetcher);
          const identity = await validateIdToken(tokens.id_token, clientId, pending.nonce, fetcher);
          if (pending.previous && identity.subject !== pending.previous.subject) throw new Error('Sign-in returned a different ChatGPT account.');
          const account: PlanCredential = { issuer, subject: identity.subject, email: identity.email,
            clientId, idToken: tokens.id_token, accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
            scopes: tokens.scope.split(/\s+/).filter(Boolean), expiresAt: Date.now() + tokens.expires_in * 1000 };
          const key = accountKey(account);
          state.accounts[key] = account; state.activeKey = key;
          await store.save(state);
          notice = account.scopes.includes(requiredScope) ? 'ChatGPT sign-in completed. The reasoning test is ready.'
            : 'Signed in, but ChatGPT plan usage permission was not granted. Reasoning remains unavailable.';
          result = undefined;
          redirect(res, '/', 'plan_oauth_binding=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); return;
        } finally { working = false; }
      }
      if (path.pathname === '/' && req.method === 'GET') {
        const current = active(state);
        const connected = current?.accessToken && current.scopes.includes(requiredScope);
        const info = current ? `<p>Selected ChatGPT account: ${connected ? 'plan usage connected' : 'sign-in required or plan permission missing'}.</p>` : '<p>No ChatGPT account is connected.</p>';
        const probe = connected ? `<form method="post" action="/probe"><input type="hidden" name="csrf" value="${csrf}"><button>Run synthetic GPT-6 Sol high test</button></form><form method="post" action="/tools-probe"><input type="hidden" name="csrf" value="${csrf}"><button>Run synthetic tool round trip</button></form>` : '';
        const previous = result ? `<p>Completed: ${result.model}, effort ${result.effort}. Input tokens: ${result.usage?.inputTokens ?? 'unknown'}; output tokens: ${result.usage?.outputTokens ?? 'unknown'}.</p>` : '';
        const choices = Object.entries(state.accounts).map(([key], index) => `<form method="post" action="/select"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="account" value="${escape(key)}"><button>Select account ${index + 1}</button></form>`).join('');
        const disconnect = current?.refreshToken ? `<form method="post" action="/disconnect"><input type="hidden" name="csrf" value="${csrf}"><button>Disconnect selected account</button></form>` : '';
        send(res, 200, render(`${info}<p role="status">${escape(notice)}</p>${previous}${probe}${choices}${disconnect}`, csrf),
          `plan_setup_csrf=${csrf}; HttpOnly; SameSite=Lax; Path=/`); return;
      }
      if (req.method !== 'POST' || !['/start', '/new', '/select', '/probe', '/tools-probe', '/disconnect'].includes(path.pathname)) { send(res, 404, 'Not found.'); return; }
      if (req.headers.origin !== origin || !cookieIs(req, 'plan_setup_csrf', csrf)) { send(res, 403, 'Forbidden'); return; }
      const fields = await form(req);
      if (fields.get('csrf') !== csrf || fields.getAll('csrf').length !== 1) { send(res, 403, 'Forbidden'); return; }
      if (working) { send(res, 409, 'A connection request is already running.'); return; }
      csrf = randomBytes(32).toString('base64url');
      if (path.pathname === '/select') {
        const key = fields.get('account');
        if (!key || !state.accounts[key]) { send(res, 400, 'Unknown account.'); return; }
        working = true;
        try { state.activeKey = key; attempt = undefined; browserBinding = undefined; await store.save(state); result = undefined; notice = 'Account selected.'; redirect(res, '/'); return; }
        finally { working = false; }
      }
      if (path.pathname === '/start' || path.pathname === '/new') {
        const previous = path.pathname === '/start' ? active(state) : undefined;
        const built = beginAuthorization(state.hostId, `${origin}/auth/callback`, previous);
        attempt = built.attempt;
        browserBinding = randomBytes(32).toString('base64url');
        notice = ''; result = undefined;
        // The authorization URL may contain id_token_hint. Send only to the browser, never logs or HTML.
        redirect(res, built.url, `plan_oauth_binding=${browserBinding}; HttpOnly; SameSite=Lax; Path=/auth/callback`); return;
      }
      working = true;
      try {
        const current = active(state);
        if (!current) { send(res, 400, 'No account selected.'); return; }
        if (path.pathname === '/probe' || path.pathname === '/tools-probe') {
          if (!current.scopes.includes(requiredScope)) throw new Error('ChatGPT plan permission is missing.');
          let usable = current;
          if (current.expiresAt - Date.now() < 60_000) {
            usable = await refreshCredential(current, fetcher);
            state.accounts[accountKey(usable)] = usable; await store.save(state);
          }
          result = path.pathname === '/tools-probe' ? await probeSolHighTools(usable, fetcher) : await probeSolHigh(usable, fetcher);
          notice = path.pathname === '/tools-probe' ? 'Synthetic tool round trip verified through the ChatGPT plan route. No care records were accessed.'
            : 'Synthetic text reasoning completed through the ChatGPT plan route.';
        } else {
          let revoked = false;
          try {
            const discovery = await fetcher(`${issuer}/.well-known/openid-configuration`, { redirect: 'error', signal: AbortSignal.timeout(10000) });
            const metadata = await discovery.json() as { revocation_endpoint?: string };
            if (discovery.ok && metadata.revocation_endpoint?.startsWith(`${issuer}/`)) {
              const response = await fetcher(metadata.revocation_endpoint, { method: 'POST', redirect: 'error',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ token: current.refreshToken, token_type_hint: 'refresh_token', client_id: current.clientId }),
                signal: AbortSignal.timeout(15000) });
              revoked = response.ok;
            }
          } catch { /* Local sign-out still stops use; remote revocation may need Settings. */ }
          state.accounts[accountKey(current)] = { ...current, accessToken: '', refreshToken: '', idToken: '', scopes: [], expiresAt: 0 };
          attempt = undefined; browserBinding = undefined;
          await store.save(state);
          notice = revoked ? 'Disconnected and remote session revoked.' : 'Disconnected locally. Remote revocation was not confirmed; remove app access in ChatGPT Settings if needed.';
          result = undefined;
        }
      } finally { working = false; }
      redirect(res, '/');
    } catch (error) {
      if (error instanceof ToolProbeError || error instanceof PlanRequestError) {
        // Only bounded descriptors/codes; no arguments, reasoning, account IDs or credentials.
        try {
          await mkdir('.local/probes', { recursive: true });
          await writeFile('.local/probes/chatgpt-probe-rejection.json', JSON.stringify({ observedAt: new Date().toISOString(), ...error.diagnostic }, null, 2), { mode: 0o600 });
        } catch { /* A diagnostic write must not crash the local helper. */ }
      }
      result = undefined;
      notice = safeNotice(error);
      // Never echo callback URL, authorization code, tokens, or raw provider body.
      redirect(res, '/');
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, host, () => { server.off('error', reject); resolve(); }); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not start loopback listener.');
  return { url: `http://${host}:${address.port}/`, close: async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await unlock(); } };
  } catch (error) { await unlock(); throw error; }
}
