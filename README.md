# Companion Rehab · Nancy

**Current design:** the owner selected and locked Current on October 19 after comparing it with Focus. Read [the approved client design](docs/CURRENT_UI_DESIGN.md), [current roadmap](docs/ROADMAP.md) and [continuation handoff](docs/HANDOFF_2026-10-18.md). The green top Talk to Nancy banner and five-tab navigation are the production baseline. Focus is preserved with its review switch disabled.

Nancy helps a participant plan the day through **Talk to Nancy**, a read-only day timeline and exactly five client tabs: Tasks, Meals, Groceries, Progress and Ask for Help. Client changes use reviewed voice commands; staff setup remains separately scoped. The daily rhythm prefers 06:00–09:00 for breakfast, planning and existing exercise/rehab, with optional catch-up until 11:00; evening preparation starts around 16:00 and discretionary tasks aim to finish by 20:00. These participant-local windows guide suggestions without restricting access. Actual reports remain separate from proposed and accepted plans.

**Implemented pilot:** local PostgreSQL/auth, GPT-6 Sol high, local transcription, Kokoro Heart speech, versioned plan acceptance, factual meal/task reports, preferences, interruption recovery and consented foreground prompts. Commands retain exact receipts through lost responses and restarts. The account-bound [Outlook increment](docs/MICROSOFT_CONVERSATIONS.md) adds selected Calendar/Inbox context and exact reviewed new email/invitation actions. [Current qualification evidence](docs/ROADMAP.md) distinguishes automated/disposable-service checks from intended-person, iPhone/Safari, genuine-day and full-slice acceptance; those live gates remain open. See the [local runbook](docs/LOCAL_MY_DAY.md).

**Preliminary client trial:** the active authenticated My Day interface uses a separate database prepared without sample care records. Talk to Nancy uses the selected Heart voice and Sol-high reasoning. The earlier audition/preview is excluded from the product build. Follow the [client trial guide](docs/CLIENT_TRIAL.md); genuine participant consent, intended-user account eligibility and physical iPhone/Safari acceptance remain open.

```powershell
npm run scan:public
npm run check
```

`npm run check` builds into ignored verification output and does not publish to the active client directory. Run installation and maintenance checks in an isolated checkout/release when this computer is serving a live client: `npm ci` or `npm install` in the live checkout replaces dependencies used on its next restart. `npm run build` remains an explicit production build and must be treated as deployment when the service uses `dist/client`; it is not part of routine verification. Start the service only through the selected local runbook after reviewing its database and runtime identity.

The owner maintenance copy uses its own pinned dependencies and source under ignored `.local/owner-test/releases/`, selected by a validated private owner-only release pointer. Dad's entry does not read that pointer. The existing root `node_modules` and Dad's active assets remain separate from owner patch qualification; the workspace's updated manifest/lockfile describes the maintenance candidate, not a silent upgrade of the live installation.

Open the configured `PUBLIC_ORIGIN` after following the local runbook (`http://localhost:8787` for a local-only setup). The application reads `.env.local` and ignored `.local/runtime/local-care.env`; old Supabase/Realtime scripts remain historical references, not a runtime fallback. Keep credentials and records in ignored private storage. The temporary authenticated HTTPS route is owner-authorized; its current address is stored privately and depends on this computer staying online.

Run `npm run connect:chatgpt` for the separate local ChatGPT-plan qualification helper. It opens no public port and uses an app-specific OAuth connection, encrypted local credentials and fixed synthetic GPT-6 Sol high text/tool tests. The owner's real connection and synthetic tool round trip succeeded on October 4; local speech generation and recognition also passed separate probes. Its printed loopback address is for this computer only; it is not My Day and must not be published through a tunnel. See the first-connection guide for evidence, usage limits and the remaining qualification gates.

- [Current product and technical decisions](docs/architecture/PRODUCT_DECISIONS_2026-10-03.md)
- [First connection: ChatGPT-plan qualification](docs/S01_FIRST_CONNECTION.md)
- [October 4 connectivity and subscription decision](docs/architecture/PRODUCT_DECISIONS_2026-10-04.md)
- [Baseline setup reference, pending local-data adaptation](docs/S01_SETUP.md)
- [Live-test runbook, pending revised deployment](docs/S01_LIVE_TEST.md)
- [Implementation roadmap](docs/ROADMAP.md) and [authoritative JSON](docs/roadmap/roadmap.json)
- [Human-required actions by slice](docs/HUMAN_ACTIONS.md)
- [Local database schema](db/002_local_care.sql) and [historical Supabase migration](db/001_s01.sql)

The Node/Fastify service serves the React client and owns durable care state in local PostgreSQL. Permanent intended-client activation and the exact [caregiver-authorized reasoning connection](docs/CAREGIVER_REASONING_CONNECTION.md) are operationally qualified on the current host. That optional private authorization preserves the actual speaker, exact client/grants, immutable owner account and host; the default restriction for everyone else stays owner-only. Application approval is not a provider-issued exception. No API/model fallback, general pooled access or hosting migration is enabled. A Secure MCP Tunnel is optional tool transport. The service budget is $50/month excluding GPT, with CAD as the unconfirmed planning default and existing resources first.

Automated tests use synthetic data, disposable PGlite/PostgreSQL, browser DOM tests and provider doubles. Separate listening-HTTP, backup/restore and deployed-browser checks supply bounded engineering evidence. They do not substitute for intended-person/device or genuine-day acceptance. Client **My Day**, family/friend **Support Team**, clinician **Clinician Partners** and administrator access are scoped separately. Full dashboards remain in their later slices. Opted-in foreground prompts preserve consent, current sources and client approval; closed-page speech is not promised.

Nancy's short trusted core and named application skills live in [nancy-policy](src/server/nancy-policy/core.md). The application chooses bounded guidance without another routing-model call; permissions, reviews, versions and receipts remain in the care service. Fresh authorized facts and human text are data. No context crawler, persistent transcript memory or background reasoning loop is used. Quiet preparation never starts a microphone or authorizes outreach. Consented foreground prompts require an available supported page; closed-browser speech and push remain unqualified. Numeric voice timing is recorded without transcripts or audio, with unobserved stages left unknown.

GitHub Actions runs type checking, regression tests, the production build, dependency audit and roadmap consistency on Windows and Linux. It has read-only repository permissions and no access to private care data, voice models or credentials. `scripts/audit-ledger-probe.ts` runs identity and reschedule regressions in a fresh disposable database on the qualified local PostgreSQL server; `scripts/activity-ledger-probe.ts` also exercises encrypted restore.

## Product and nutrition references

The [original MVP brief](docs/MVP.md) preserves the source user stories and architectural background. The current roadmap and October 3 decisions take precedence over its earlier feature order, hosting and role assumptions.

| File | Purpose |
|---|---|
| [Meal library](docs/nutrition/meal-library.md) | Twenty familiar, portioned meal options with parseable recipe records, ingredients, preparation, allergen screening, substitutions and grocery-draft rules. |
| [Nutrition research knowledge base](docs/nutrition/research-knowledge-base.md) | Claim IDs, evidence limits, source-disclosure status, references, planning safeguards and agent acceptance scenarios. |

Load application permissions and the current private, human-approved care protocol before the knowledge-base runtime rules, relevant claims with their limitations, and selected recipe records. These references support proposals; they do not authorize clinical changes or grocery orders and are not an individual treatment plan.

Nancy retrieves bounded claims and recipe excerpts from these files with document status and hashes. Recipe discovery supports search, pagination and exclusion of declined choices; all twenty recipes are reachable without loading the entire library into each turn. These tools operate through the authenticated care service. Recipe quantities are explicit, but nutrient totals and glycemic loads have not been calculated. Do not invent them, treat missing values as zero or infer that a day meets a fixed target. Preserve raw, dry, drained and cooked quantity distinctions in grocery calculations.
