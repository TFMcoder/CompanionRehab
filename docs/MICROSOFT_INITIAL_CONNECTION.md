# Initial Microsoft connection

**October 19 Outlook conversations and tests verified:** The caregiver expressly approved selected Calendar/Inbox content in Nancy conversations and the exact disposable email/invitation tests. The tested increment is deployed without changing the existing Microsoft consent, exact client/account binding, credentials or caregiver Pro route. One test email is verified as sent; one 15-minute test invitation is verified at 18:00 Toronto time. Both receipts survive reopening, and Nancy correctly retrieves the event time through the live conversation route. Nine existing care tables are unchanged. See [current evidence](evidence/OUTLOOK-CONVERSATIONS-2026-10-19.json) and [the scoped runbook](MICROSOFT_CONVERSATIONS.md). Recipient delivery, attendee acceptance and full person/device/S06 acceptance remain open. Earlier read-only/no-model stopping points below are historical and superseded for this exact approved scope.

**October 19 connected and restricted:** The intended client is Nancy's sole Microsoft assignee, Assignment required is saved, and all seven existing delegated scopes have administrator consent. Fresh client OAuth, exact signed/Graph identity, encrypted storage, main Calendar/Inbox selection, a complete bounded read and persistence after reload are verified. The deployed response validator now accepts Entra's documented default OIDC `email` metadata without requesting more permissions or weakening account/care checks. The original All-queue request still says Not reviewed; actual grants are independently verified and reviewer policy is unchanged. Full real refresh/revocation/disconnect recovery remains open. No provider writes or provider-content disclosure to Nancy reasoning occurred. See [current evidence](evidence/MICROSOFT-CONNECTED-2026-10-19.json). Reuse the completed setup and preserve the active caregiver connection.

**Earlier October 19 read-only checkpoint (superseded):** The user completed fresh client Microsoft sign-in far enough to submit an administrator approval request. Explicitly authorized read-only Entra inspection verified the correct Nancy application, intended requester and callback, with the request **Not reviewed**. It is in All requests; the administrator's My Pending queue is empty. The configured seven permissions below remain delegated; no admin-consented permissions are shown. No consent/access setting was changed, and Nancy still reports not connected. Standard portal administrator consent can apply tenant-wide, so review the intended restriction before granting it. After consent, start a fresh client Outlook authorization, then select approved resources and perform bounded reads. Do not repeat account provisioning, password recovery or completed registration setup. See [checkpoint evidence](evidence/MICROSOFT-CONSENT-REVIEW-2026-10-19.json). S06-H03 and live acceptance remain open.

October 17, 2026 engineering increment. The owner authorized resuming the Microsoft portion of S06 and stopping after secure connection setup, explicit resource selection and bounded reads. S06 remains in progress; this increment does not complete its reviewed write, Asana or intended-client acceptance requirements.

## Implemented boundary

The local care service owns the connection. A private configuration binds exactly one Nancy client actor and participant to one Microsoft tenant and account object ID. An administrator's Entra management access does not establish permission to use that client's mailbox. Other Nancy roles and accounts cannot borrow the connection.

Authorization uses the tenant-specific code flow, PKCE, a nonce and a certificate assertion. The callback is **`/api/microsoft/callback`**. This supersedes the unimplemented `/api/integrations/microsoft/callback` path proposed in the October 13 historical preflight. Nancy's Strict session cookie is preserved: a separate short-lived HttpOnly Lax cookie binds the provider return, then the original authenticated same-origin session finishes the exchange. Callback codes are encrypted while staged; denial, replay, expiration, logout and changed grants invalidate the attempt.

Credential ciphertext uses AES-256-GCM with connection, local actor, participant, tenant and Microsoft account bound as authenticated context. Refresh is serialized by a database row lock. Disconnect deletes local tokens and choices; it does not erase Outlook records or revoke the app's tenant consent. Backups deliberately omit Microsoft tokens, pending authorization and connection state. A restored database requires a fresh connection.

The Outlook screen is visible only to the configured eligible client. It requires explicit calendar/folder selection and an explicit read. It shows today's appointments and message previews, including retrieval time and partial-result notices. Provider content is rendered as text. Selected IDs are validated again on the server; fixed Graph endpoints, page/record/byte/time limits and repeated local-authority checks bound each read. Requests do not send mail or alter calendars. Provider content is not passed to Nancy reasoning and is not copied into accepted plans or factual meal/task records.

The initial selector exposes the account's own calendars and top-level mail folders, with at most five selections of each. Nested-folder navigation is not exposed in this UI increment.

The registration's previously agreed delegated permissions remain `openid`, `profile`, `offline_access`, `User.Read`, `Calendars.ReadWrite`, `Mail.ReadWrite` and `Mail.Send`. The wider registration does not enable write methods in this increment. Any future reviewed-write implementation needs its own acceptance evidence. Complete pagination is not an atomic provider snapshot or proof of deletion.

## Activation configuration

Absent `NANCY_MICROSOFT_CONFIG`, the connector is disabled. That environment variable points to an ignored private JSON file. Do not put real identifiers, tokens, certificate keys, household content or full private evidence in the public repository.

The active ignored `.local/integrations/microsoft/connection.json` now binds the owner-approved permanent Nancy client actor and existing participant to the verified Microsoft object ID. Both activation and local-preview approval are true; `NANCY_MICROSOFT_CONFIG` points to that file and the supervised backend has restarted successfully. The earlier `connection.pending.json` is a preparation artifact, not the runtime configuration. Certificate, private key and encryption key remain restricted locally; the exact Web callback and matching public certificate are already registered. Reuse these files rather than generating replacements. Configuration activation does not establish Microsoft consent or a successful provider read.

```json
{
  "enabled": true,
  "localDataUseApproved": true,
  "tenantId": "<approved tenant UUID>",
  "clientId": "<existing application UUID>",
  "expectedObjectId": "<client's Microsoft account object UUID>",
  "actorId": "<client's permanent Nancy actor UUID>",
  "participantId": "<addressed Nancy participant UUID>",
  "redirectUri": "https://<approved Nancy host>/api/microsoft/callback",
  "certificateFile": "certificate.pem",
  "privateKeyFile": "private-key.pem",
  "encryptionKeyFile": "encryption-key.base64"
}
```

File references resolve relative to that private JSON. The encryption key is 32 random bytes encoded as canonical base64. Use an RSA certificate/key pair of at least 2048 bits; upload only the public certificate to the existing Entra registration. Restrict the private directory with Windows ACLs to the runtime owner and required system/backup identity. Preserve the encryption key separately from the database, and verify rotation/restore before daily reliance. Invalid configured settings stop startup rather than silently choosing another account. Production requires the exact existing HTTPS origin plus the callback path.

Registration edit access, the Web redirect, public certificate, Microsoft directory identity and owner-confirmed local-preview approval are verified. The distinct permanent Nancy actor and active runtime binding are installed. Migration `db/018_microsoft.sql` is already installed and verified; do not replay it. Next, manually sign into Nancy as the addressed client, use **More → Outlook → Connect Outlook**, and complete that client's Microsoft sign-in/MFA and consent. Select only the agreed calendar and mail folders. Technical administrator sign-in and client consent are separate steps. Actual mailbox access remains unverified.

The role grant is IT-confirmed in the October 15 reply. October 17 portal verification confirms administrator MFA, successful registration edits, one Web redirect, one matching certificate and all seven agreed delegated permissions. The intended client's exact directory identity/object ID, enabled Member account and active existing Microsoft 365 Business Standard license are verified privately. These do not prove actual mailbox access. No application permissions or tenant-wide consent were added. The owner subsequently approved permanent-client activation for UI/Outlook testing: a fresh encrypted backup, exact re-review and 27 actual-database/configuration checks passed. Original care history and owner credentials are preserved; owner client-practice access is retired and administrator access is active. Intended-client voice remains unqualified and the owner's inference credential was not transferred. See [activation evidence](evidence/MICROSOFT-CLIENT-ACTIVATION-2026-10-17.json). Local calendar/mail previews are approved; GPT disclosure and provider writes are outside this approval.

Automatic approval review rejected programmatic decryption/password entry in the browser. Do not retry that route or bypass it with an API session. The owner must open the ignored interactive credential viewer and manually sign into Nancy; the viewer refuses redirected output. Microsoft password/MFA and consent also require the intended user's interaction. No password is stored in this public repository or printed into task logs.

The deployment gap discovered during handoff resumption is repaired. `scripts/upgrade-local-schema.ts` uses the tested `src/server/local-schema-upgrade.ts` inspection/apply path for reviewed additions through 018. Partial tables/columns/indexes, stale review and preservation failures are refused; failed transactions roll back. The established database upgraded after encrypted backup and an isolated restore rehearsal; a repeat run reported `already_current`. The supervised backend and public HTTPS/voice checks pass. See [migration evidence](evidence/MICROSOFT-MIGRATION-2026-10-17.json). Do not replay all historical migrations with `scripts/local-care-migrate.ts`.

## Verification and stopping point

See [sanitized evidence](evidence/MICROSOFT-INITIAL-2026-10-17.json) for exact current results. Automated checks cover signed identity claims, certificate assertions, credential tampering, selected resources, pagination, callback cookies/origins, revocation, refresh, disconnect and UI recovery. A running local portal with a disposable PostgreSQL database exercises the actual browser/UI/HTTP/database path using an injected synthetic Microsoft provider. That is distinct from live Microsoft OAuth and Graph acceptance, which remain open.

Next provider acceptance must verify the intended client's own account, exact consent/selection, a real bounded read, token refresh, authorization loss, disconnect and recovery. No mail or appointment write should be included in that initial activation check. Stop after this increment until the owner resumes later S06 work.

Provider behavior references: [certificate credentials](https://learn.microsoft.com/en-us/entra/identity-platform/certificate-credentials), [authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [calendar view](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0), [immutable Outlook IDs](https://learn.microsoft.com/en-us/graph/outlook-immutable-id).
