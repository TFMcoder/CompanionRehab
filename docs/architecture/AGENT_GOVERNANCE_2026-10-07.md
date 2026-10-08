# Nancy governance and implementation staging

Decision date: 2026-10-07. The owner approved the implementation discussion and requested documentation before code work. The authoritative contracts are `product_contract.agent_governance` and `product_contract.family_task_requests` in [roadmap.json](../roadmap/roadmap.json), schema 1.7.0.

The owner subsequently directed implementation of these checkpoints. S01 and the scoped S10 request increment are now `in_progress`; S02 remains `awaiting_live_test`. The request service, role homes, matching UI/voice commands, policy/data separation, immutable owner-account binding and numeric telemetry are implemented. See [the workflow/runbook](../FAMILY_REQUESTS.md) and [current engineering evidence](../evidence/S01-S10-GOVERNANCE-2026-10-07.json). Owner practice remains the only qualified production reasoning route; real recipients, sharing consent and intended-user microphone acceptance remain open. No paid service was added.

## Behaviour and authority

Keep one bounded Nancy agent with the existing care service. Nancy stays warm, brief, practical and responsive to client choice. The care service enforces grants, known constraints, exact-version approval, idempotency and receipts. Multiple runtime agents are unnecessary for sequential planning or scheduling. Independent engineering research/evaluation can use separate agents when authorized.

Compose compact versioned shared policy, applicable role policy, authorized preferences and fresh bounded facts. Preferences cannot relax access, consent or clinical limits. `AGENTS.md` governs development; it is not loaded into every Nancy turn. Retain GPT-6 Sol high and Kokoro Heart; voice selection is closed.

| Role | Request authority |
|---|---|
| Client | Review and accept the exact request, propose a change, or decline with a short reason; report actual activity separately. |
| Family/friend | Within client-specific grants, submit requests, inspect permitted status and volunteer to help. |
| Administrator | Manage scoped setup/access, request tasks and review permitted help/flags; cannot approve for the client. |
| Clinician | Access only explicitly permitted records; later dashboards/exports do not grant unrestricted access or approval powers. |

Only client approval creates an accepted task. Rejection with a confirmed short reason atomically creates family help and an administrator flag, without a task or penalty. Helpers volunteer; absent recipients leave visible unassigned help. Capacity review considers supplied effort, travel, rest, approved limits and client-reported capacity. Unknowns prompt clarification. Empty calendar time is not capacity; Nancy does not make clinical capacity judgments.

## Explicit conversation and inference binding

The pre-implementation audit at `8b11107d542d6431f4e3978650c135921c9df6f0` found `ConversationService` checked `ownerId` while `PlanReasoner` independently selected mutable `activeKey`, including after the refresh lock. The runtime now adopts the already-authorized owner connection once into an encrypted explicit account binding and resolves subsequent calls/refreshes by that identity. Changing `activeKey` cannot switch a running conversation. Removing `ownerId` is still not a multi-user router, and intended-user routes remain unqualified.

For each conversation and inference call, derive authority on the server: actor/login session, active role, client, current grant scope/revision, policy version, approved inference route and its specific account binding. The speaker, the client being discussed and inference account owner are distinct identities. Browser parameters and spoken claims cannot confer authority.

Resolve credentials by that binding and preserve identity through refresh, all model/tool rounds and result delivery. Recheck permissions independently at the care boundary. Scope changes or revocation cancel generation/playback and clear incompatible history and pending reviews. Late results cannot restore authority.

Retain owner-only practice until intended routes qualify. Separate logins alone are insufficient. The September 29 [SIWC terms](https://openai.com/policies/sign-in-with-chatgpt-terms/) require user-controlled runtime arrangements and local user-controlled persistent token storage; they prohibit subscription sharing and another person's activity triggering inference on the authenticated account. Document the real deployment against the [supported integration](https://developers.openai.com/siwc/token-sharing-open-source). Encryption on an administrator machine does not itself establish eligibility. If the intended arrangement cannot qualify, prepare a supported alternative and costs for owner decision; never silently change billing or model.

UI commands and durable inbox creation need no inference. Family submission must not automatically invoke a recipient's subscription. Client-initiated review may use that client's qualified route. This enables engineering progress while qualification proceeds, but does not satisfy the required voice experience.

## Trust, privacy and measurements

`conversation.ts` now passes human-authored profile/task/appointment/request facts as clearly delimited lower-trust data, separately from fixed shared and role policy. Saved facts may supersede stale history without becoming instructions. Injection regressions cover disclosure, role elevation and fabricated approval. [OpenAI's safety guidance](https://developers.openai.com/api/docs/guides/agent-builder-safety) recommends keeping untrusted variables out of developer messages. Prompts do not replace server enforcement or prove immunity.

Filter context and tool results by purpose, client and grants. Requesters can receive bounded availability summaries without unshared appointment details. Before real-data inference, prepare minimum outbound fields and purpose-specific consent, processing and retention choices. Local PostgreSQL and `store:false` do not establish zero provider retention or residency. Keep raw transcripts, audio and credentials out of operational logs and the public repository. Preserve private incident/rollback evidence using sanitized references.

Include numeric telemetry in the first S01 hardening work: actual per-call/turn input/output tokens, cached/reasoning tokens where supplied, model/tool counts, policy version, opaque binding reference, outcome and stage latency. Missing or aborted usage remains unknown where no provider value exists; character counts are not tokens. Keep bounded asynchronous logging and 14-day operational retention separate from care receipts and backup retention.

Establish comparable baselines, then optimize repeated context, definitions and model rounds. Test stable policy/tool prefixes without assuming cache hits. Single generated-audio probes do not establish latency percentiles or participant acceptance. [October 6 audit evidence](../evidence/S01-S02-AUDIT-REPAIRS-2026-10-06.json) is a historical baseline, not a pass for new criteria.

Retain the current direct Responses HTTP/SSE adapter unless evidence warrants a change. Follow [plan preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations): supported function/custom tools remain server-owned; hosted MCP/connectors and fields including `max_output_tokens`, `max_tool_calls`, `background` and `prompt_cache_retention` are unsupported. Enforce application budgets locally. Optional MCP transport does not provide inference entitlement, care authorization, speech or My Day HTTPS.

## Checkpoints and evidence

These checkpoints sit inside existing slices; they do not create an infrastructure milestone or change full-slice dependencies.

| Checkpoint | Work and exit |
|---|---|
| GOV-01: S01 hardening | Separate policy/data, add numeric telemetry and explicit binding design/tests while retaining owner isolation. Client, injection, account-refresh/scope and metadata regressions pass; actual service checks are recorded without implying intended-client qualification. |
| GOV-02: request UI/server | Complete submission, client decision, accepted task or rejection/help/flag, acknowledgement/resolution and scoped views. Real isolated PostgreSQL and browser checks cover retries, races, stale/withdrawn requests, revocation and no-helper cases. This is an engineering checkpoint only. |
| GOV-03: complete voice/UI increment | Integrate bounded family/admin/client voice using qualified routes. Consenting microphone trials and matching UI prove submission, client decisions, capacity clarification, voluntary help and admin review, with interruption and scope checks. UI-only evidence cannot complete the increment. |
| GOV-04: existing client acceptance | Alongside request development, finish S01 engineering/account/device qualification, then the genuine-day S02 ledger trial. Preserve all human/slice gates and continue S03/S04 by dependency order. This work need not wait for GOV-03. |

Reuse TypeScript/Fastify/React/PostgreSQL, typed commands, receipts, Vitest and isolated database probes. No new framework or paid service is required. Record existing authorization for S10 implementation overlap when code starts; documentation alone does not start implementation. Full S10 achievements and broader notifications keep their dependencies.

Account/runtime qualification blocks intended-user reasoning. Real sharing recipients, consent, content and device participation block dependent live testing. Neither blocks reversible UI/server/schema/test preparation. Microsoft 365, Asana, achievements, full dashboards and tunnel provisioning are not request-increment prerequisites.

Remaining S01 gaps include consented foreground wake implementation/qualification, richer meal alternatives/portions, genuine iPhone/Safari acceptance, complete provider-loss/revocation/allowance scenarios and stable HTTPS qualification. Policy/data separation, explicit binding and the basic role homes now have engineering implementation and regression evidence. Meal/task identity and moved-task repairs remain covered, including durable accepted-request occurrences. Consent, remote-processing boundaries and S02 genuine-day review remain open. Button fallback does not pass wake acceptance, and accepted plans do not prove performed activity.
