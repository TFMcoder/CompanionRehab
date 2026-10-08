# Product decisions: roles, My Day, local storage and Nancy

Source: The project owner's October 3, 2026 product clarification and explicit follow-up selection of **GPT-6 Sol — high**. These decisions are recorded in `product_contract` and the affected slices of [the canonical roadmap](../roadmap/roadmap.json), schema 1.3.0. They supersede earlier conflicting hosting, role and model assumptions. They describe the target; they do not claim these changes are implemented.

The [October 4 connectivity decision](PRODUCT_DECISIONS_2026-10-04.md) updates the reasoning access priority to qualify existing ChatGPT-plan usage first, with independent speech and conditional MCP. That decision introduced schema 1.4.0; the October 7 amendment below is recorded in current schema 1.6.0. Local care storage, My Day and the exact Sol-high selection below remain in force.

## October 7 amendment: family task requests

The later [October 7 governance decision](AGENT_GOVERNANCE_2026-10-07.md), recorded in schema 1.7.0, defines the approved staging: S01 policy/data and telemetry hardening, a complete request UI/server engineering checkpoint, then qualified role-bounded Nancy voice and matching UI. UI-only delivery does not complete the request increment or S01/S02/full S10. Intended-client qualification and unfinished S01 work advance alongside it. Per-conversation and per-call actor/role/client/inference-account binding is required; shared owner credentials or global account switching cannot enable family voice.

The owner amended family/friend permissions to include **Request Tasks**, available to both scoped family/friend and administrator accounts through Nancy voice and matching UI. This is a recorded product contract, not a claim that the workflow is implemented. The machine-readable definition is `product_contract.family_task_requests` in roadmap schema 1.6.0.

- A requester supplies the task name, suggested priority, date and time. Nancy clarifies missing information and reviews authorized schedule context, effort, rest and client-stated daily capacity. Calendar space alone does not establish capacity, and unshared appointment or clinical details must not be exposed to the requester.
- After requester confirmation, the client receives a **request**. Only that client can approve the reviewed task and timing. Family, administrators and Nancy cannot make that decision for the client. Pending requests stay separate from accepted tasks; acceptance never means completion.
- On rejection, Nancy gently asks for a short reason. No detailed clinical justification is required, and pausing the conversation never causes acceptance. Confirmed rejection, the reason, a linked help request for other authorized family members and a scoped administrator flag commit together. Helpers volunteer; the task does not silently return to the client. Rejection is not a failure or an achievement penalty.
- Support Team gains Request a task, sent requests and Help needed. My Day gains a small Requests area with voice and button acceptance/rejection. Minimal administrator controls gain rejection/help review. All reads, tools, decisions and delivery remain scoped to the current actor, role, client and sharing grants.
- Initial routing uses durable in-app inboxes. It does not depend on Microsoft 365, Asana, achievements or the full administrator dashboard. Existing foreground wake limitations remain; this does not implement background Hey Nancy listening or external messaging.

The owner wants this family/administrator configuration as the next scoped increment while Microsoft 365 access is pending. The request workflow belongs to S10, with its own automated/live scenarios and human actions; the full slice retains its achievement dependency and unfinished client acceptance gates. Reuse this owner direction when recording implementation overlap; do not request the same feature authorization again.

## Ownership and access (October 3 baseline)

The project owner is both administrator and technical lead. That resolves responsibility for provider/project decisions. It does not establish that an API key, account connection, HTTPS hostname or intended device is available to the application. Reuse existing authorized access and decisions; only actual missing access remains outstanding. Local PostgreSQL deployment, authentication adaptation, migrations and debugging are engineering work.

## Roles and homes

| Role | Home | Scope | Delivery |
|---|---|---|---|
| Client | **My Day** | Narrow conversational home; own tasks, today's meals, grocery list and achievements | Tasks/meals in S01; groceries S05; achievement UI designed in S09 |
| Family/friend | **Support Team** | Consented tasks/meals and achievements, client-approved task requests, optional completion/reschedule notifications and help/encouragement | Role/home boundary S01; request increment next; full family features S10 |
| Clinician | **Clinician Partners** | Authorized data exports and dashboards configured for clinical archetypes | Role/home boundary S01; working dashboards/exports S12 |
| Administrator | Minimal setup initially; full operations dashboard later | Accounts, scoped grants and task/meal setup; operations | Setup S01; dashboard S11 |

Client, family/friend and administrator interactions are principally voice. Every role has a UI path for its available features. Role-specific landing routes in S01 must honestly show what is available; they are not evidence that later features have shipped. The administrator home label remains an implementation working label, not a user-selected screen name.

Family/friend permissions include the requested read access, their own notification preferences, help/encouragement and the October 7 Request Tasks capability. A request is distinct from directly assigning, editing or rescheduling an accepted client task. Clinical exports are not implied. Access is client/resource scoped and revocable. A role name alone cannot grant access to every client's records.

Clinical archetypes are **Diabetes, Neurorehab, Psychologist / Psychiatrist, Family doctor, and OT / PSW / DSW**. They configure dashboard content, not authorization. S12 includes exports as an explicit feature. Its human actions require clinical partners to review concrete measure definitions and export scope; dashboard design and clinical targets are not prerequisites for S01–S04.

## My Day and task semantics

The task form presents three simple properties: **what**, **urgency (High, Medium, Low)** and **scheduled date/time**. Keep identity, source, version and audit metadata in the underlying records. Persist the scheduled instant and participant time-zone context; display local date/time. Until a time is supplied, show an explicit unscheduled state instead of inventing one.

**Meals are tasks.** A planned meal has a shared task occurrence identity with meal-specific details, visible in both the task list and meal view. The implementation must avoid two competing task ledgers or duplicate completion counts. Meal choices and nutritional details can remain specialized records linked to that identity.

Proposals, accepted plans and actual activity remain separate. S01 schedules and accepts a plan. S02 records performed tasks, meals eaten, corrections and explicit rescheduling, including old/new schedule values and versions. A suggested or accepted meal is never automatically marked eaten.

Voice navigation and buttons use the same typed destination registry and permission checks. S01 supports My Day, task and day-meal views; groceries and achievements become available with their slices. Unknown, unauthorized or unshipped destinations produce an honest explanation. Opening a view does not change a plan or report an activity.

S10 adds recipient-specific opt-in notifications for **committed task completion** and **committed rescheduling**, including meals. Preferences and client sharing consent are separate. Recheck access at delivery, honor opt-out/revocation, and avoid duplicate effective notifications. Suggestions alone cannot trigger completion alerts.

## Local data and migration

Initial durable data lives on **this computer**, with migration later to another local server or cloud provider. The S01 engineering target is local PostgreSQL with a compatible local identity/session deployment. Qualify the deployment and authentication implementation before claiming readiness. Supabase cloud provisioning is no longer an initial dependency; the existing Supabase-specific adapter is a baseline to adapt.

Keep the React/TypeScript/Vite and Node/Fastify application, care-service ownership of durable state, typed commands, schema migrations, scoped authorization, immutable versions, events and transactional receipts. Preserve stable identifiers and grants across tested encrypted export/restore and any later migration. Keep backup keys separate from exports. No new paid service has been selected or activated; the $50/month service ceiling excluding GPT remains, using CAD as the unconfirmed planning currency.

Local storage does not make GPT or speech processing local. The remaining real-data review covers remote processing, routing, backups and retention. No raw audio is retained by default, and private records, credentials and full live evidence stay outside this public repository.

## Nancy reasoning and speech

The explicit model selection is **`gpt-6-sol` with `reasoning.effort: high`**. Use the Responses API for its server-owned tool calls. The [official GPT-6 Sol model documentation](https://developers.openai.com/api/docs/models/gpt-6-sol) lists high reasoning and directs tool-using integrations to Responses; the model does not support audio input/output.

S01 therefore needs a separate speech input/output layer around this reasoning backend. Select and qualify that layer through actual voice latency, interruption, task-planning and cost tests. Do not simply substitute `gpt-6-sol` into the existing Realtime audio endpoint or let a different speech model silently replace the selected reasoning model. Any speech service may carry the conversation, but authorized care actions still pass through the same validated command boundary as buttons.

Cerberus supplies the already assessed small utilities and proposal/receipt/version/recovery patterns. Its dictation feature is not two-way Nancy voice; its planned morning preparation is not an implemented scheduler. The 10 AM routine remains user initiated in the client's configured time zone.

## Implementation and evidence consequence

S01 returns to **`in_progress`** because the September 29 code does not implement the revised local hosting, four-role, navigation, task or reasoning contracts. Its 43 passing baseline tests and implementation fingerprint remain in [historical evidence](../evidence/S01-2026-09-29.json). Canonical current-contract test results are cleared; no new application or live pass is asserted.

Adapt and test S01 first, then keep the sequence: S02 actual reporting/rescheduling, S03 interruption recovery, S04 repeated daily check-ins and reviewed carryover. Do not add an infrastructure-only stage or pull dashboards ahead of that working client slice.

S01-LIVE2 must exercise the actual local database/authentication deployment, remote GPT/speech, scoped roles, HTTPS and isolated restore with disposable records. It precedes S01-LIVE1's consenting client conversation and real plan. Local synthetic PostgreSQL tests remain valuable regression evidence but do not substitute for either live test.
