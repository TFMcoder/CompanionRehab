# Microsoft 365 IT call: Nancy mail and calendar

Decision date: October 8, 2026 (America/Toronto). The owner explicitly put both read and write access in scope for Outlook mail and calendar. This supersedes the earlier calendar-read-only proposal. The connector is planned, not implemented or connected; no consent, credential, external write or live acceptance is implied.

Only Rob's existing Microsoft 365 account will be connected. The app registration identifies the connector software; it is not another user or mailbox. Nancy retains its local authentication and roles. Family and administrators need no Microsoft account for Nancy. IT manages the registration through its existing administrator account. No Azure hosting or Entra sign-in migration is part of this request.

Use this request with IT:

> Please register Nancy / Companion Rehab as a single-tenant Microsoft Entra web application for a pilot using only Rob's existing account. It needs delegated Microsoft Graph Calendars.ReadWrite, Mail.ReadWrite and Mail.Send for Rob's own mailbox/calendar, with User.Read and the identity/refresh scopes openid, profile and offline_access. Please confirm Exchange Online hosting, tenant consent and Conditional Access requirements, approve the intended local application and AI data flow, and provide the tenant/client IDs and a secure app-credential setup. We will provide the exact HTTPS callback and enforce user-reviewed actions within Nancy.

| Permission | Purpose |
| --- | --- |
| `Calendars.ReadWrite` | Read appointments and create, edit or remove events following the authorized user's review. |
| `Mail.ReadWrite` | Read messages and create/edit drafts; the permission also allows mail modification and deletion. Nancy must expose only approved operations. |
| `Mail.Send` | Send approved messages/replies. Mail.ReadWrite does not include sending. |
| `User.Read` | Resolve and verify the signed-in Microsoft account. |
| `openid profile offline_access` | Identity claims and refresh-token access, subject to tenant policy and revocation. |

Use **delegated** permissions, not tenant-wide application permissions or `.Shared` permissions for this pilot. OAuth permissions are broader than a selected calendar or mail folder; enforce the selected resources in the adapter. If the intended resource is a shared mailbox/calendar, record that before implementing a different access design. Microsoft documents these capabilities in the [Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference) and the [delegated authorization guide](https://learn.microsoft.com/en-us/graph/auth-v2-user).

IT owns these decisions and setup steps:

1. Confirm that the mailbox is hosted in Exchange Online; record the tenant ID, Rob's sign-in address and Entra user object ID, and the intended calendar. Reuse his existing eligible mailbox license.
2. At [Microsoft Entra admin center](https://entra.microsoft.com), open **Entra ID > App registrations > New registration**. Name it Nancy / Companion Rehab and select the organization only. IT can retain registration ownership; no new technical-lead Microsoft account is needed. Under API permissions, add Microsoft Graph delegated permissions above; grant administrator consent if tenant policy requires it. Restrict connector authorization to Rob's existing account. See [registration instructions](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app).
3. Agree a stable HTTPS origin and an exact **Web** redirect URI. Engineering must implement and supply the callback before enabling sign-in; no Microsoft callback currently exists. The temporary test hostname can change and is not the permanent registration. Retain authorization-code flow with PKCE, normal MFA and tenant controls. See [authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).
4. Agree server credential custody and rotation. Prefer a certificate for deployment; engineering can generate the private key locally and supply the public certificate for upload. A short-lived client secret may serve a supervised development pilot if IT permits it. Transfer secret values through the approved secure channel, never GitHub or chat. See [credential setup](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials).
5. Confirm Conditional Access permits the local runtime's token refresh and the user's Safari/MFA flow. Agree any required device management or network rules and the IT contact for sign-in diagnostics; do not disable MFA to make the integration work.
6. Approve which company mail/calendar fields may be stored locally and sent to the selected GPT route. Set the company retention and revocation boundary. A Graph grant alone does not authorize all downstream AI processing.
7. Nominate a permitted test mailbox/calendar and consenting test recipient for read, draft, send, update, cancellation and revocation checks. Provisioning permission is not evidence that these tests have passed.

Leave the call with tenant ID, application/client ID, approved scopes/consent status, pilot account/resource details, callback/domain agreement, credential method and expiry/rotation owner, data-use decision, Conditional Access requirements and the test contact. Passwords and private keys are not handoff requirements.

Nancy will use authenticated typed commands, exact reviewed recipients/content or event changes, scoped provider mappings and durable receipts. Family requests still require client acceptance. Event creation with attendees sends invitations, so the review must disclose attendees and external notifications; Microsoft confirms this in [Create event](https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0). Mail submission returning 202 means accepted for processing, not confirmed delivery; see [sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0). Unknown outcomes require reconciliation before any retry that could duplicate a send or invitation.

Ordinary Graph access within standard limits is generally included with the eligible Microsoft user license; confirm the actual account entitlement. This direct Graph design does not require adding Power Automate, Zapier or Microsoft 365 Copilot. The app stays local and the existing service budget applies. See [Graph API cost categories](https://learn.microsoft.com/en-us/graph/metered-api-overview).

The GPT account is independent of Microsoft authorization. The [current pricing page](https://learn.chatgpt.com/docs/pricing) lists the individual Plus plan at $20/month; confirm checkout currency and tax. A future account change requires app-specific OAuth, intended-user/runtime qualification, exact `gpt-6-sol` high inference and measured allowance. [Plus plan usage is shared across apps](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions); purchasing Plus does not prove sufficient capacity or qualify a pooled multi-user backend. No model, account or billing change has been made. Direct Graph adapters keep Microsoft authorization independent of GPT account migration; this does not imply using hosted connectors through the current [plan API route](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
