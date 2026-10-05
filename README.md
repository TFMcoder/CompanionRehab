# Companion Rehab · Nancy

Nancy helps a participant plan the day through one **Talk to Nancy** button and independent My Day, task, meal and grocery views. The 08:00–11:00 local morning routine includes breakfast, day planning and existing exercise/rehab tasks; the preferred 10 AM check-in is never an access restriction. Actual meal/task reporting follows in S02.

**Current status:** a local My Day development pilot now combines PostgreSQL/auth, GPT-6 Sol high, local transcription, Kokoro Heart speech and versioned plan acceptance. Live synthetic planning, generated-audio acceptance, replay, sign-in readback and encrypted restore have run against real services. S01 remains in progress: actual iPhone/participant acceptance and the remaining roadmap contracts are not complete. No paid service was activated. See the [local My Day runbook](docs/LOCAL_MY_DAY.md).

**Smartphone interface preview:** a separate My Day page now supports sample task/meal navigation, Nancy's fixed voice sample and an in-browser microphone/playback check. Use the temporary HTTPS link provided privately in the active conversation. It does not save plans or run live Nancy reasoning. See [device preview and operating notes](docs/DEVICE_PREVIEW.md).

```powershell
npm ci
npm run check
npm start
```

Open `http://localhost:8787` after configuring the local runtime in the runbook. The application reads `.env.local` and ignored `.local/runtime/local-care.env`; old Supabase/Realtime scripts remain historical references, not a runtime fallback. Keep credentials and records in ignored private storage. The existing public sample preview is separate from the authenticated app; public exposure of the new care routes requires the specific owner approval recorded in the roadmap.

Run `npm run connect:chatgpt` for the separate local ChatGPT-plan qualification helper. It opens no public port and uses an app-specific OAuth connection, encrypted local credentials and fixed synthetic GPT-6 Sol high text/tool tests. The owner's real connection and synthetic tool round trip succeeded on October 4; local speech generation and recognition also passed separate probes. Its printed loopback address is for this computer only; it is not My Day and must not be published through a tunnel. See the first-connection guide for evidence, usage limits and the remaining qualification gates.

- [Current product and technical decisions](docs/architecture/PRODUCT_DECISIONS_2026-10-03.md)
- [First connection: ChatGPT-plan qualification](docs/S01_FIRST_CONNECTION.md)
- [October 4 connectivity and subscription decision](docs/architecture/PRODUCT_DECISIONS_2026-10-04.md)
- [Baseline setup reference, pending local-data adaptation](docs/S01_SETUP.md)
- [Live-test runbook, pending revised deployment](docs/S01_LIVE_TEST.md)
- [Implementation roadmap](docs/ROADMAP.md) and [authoritative JSON](docs/roadmap/roadmap.json)
- [Human-required actions by slice](docs/HUMAN_ACTIONS.md)
- [Local database schema](db/002_local_care.sql) and [historical Supabase migration](db/001_s01.sql)

The Node/Fastify service serves the React client and owns durable care state in local PostgreSQL. GPT-6 Sol high is linked to one explicitly bound owner care account for the synthetic pilot; the intended participant's eligibility, sign-in and deployment still require qualification. A Secure MCP Tunnel is optional tool transport. API-key billing is an explicit fallback decision. The service budget is $50/month excluding GPT, with CAD as the unconfirmed planning default and existing resources first.

Automated tests use synthetic data, a disposable PGlite PostgreSQL engine, browser DOM tests and provider doubles. They do not substitute for actual local database/auth deployment, GPT/speech, HTTPS, isolated restore or participant acceptance. Client **My Day**, family/friend **Support Team**, clinician **Clinician Partners** and administrator access are scoped separately. Full dashboards and recurring reminder automation remain outside S01.

## Product and nutrition references

The [original MVP brief](docs/MVP.md) preserves the source user stories and architectural background. The current roadmap and October 3 decisions take precedence over its earlier feature order, hosting and role assumptions.

| File | Purpose |
|---|---|
| [Meal library](docs/nutrition/meal-library.md) | Twenty familiar, portioned meal options with parseable recipe records, ingredients, preparation, allergen screening, substitutions and grocery-draft rules. |
| [Nutrition research knowledge base](docs/nutrition/research-knowledge-base.md) | Claim IDs, evidence limits, source-disclosure status, references, planning safeguards and agent acceptance scenarios. |

Load application permissions and the current private, human-approved care protocol before the knowledge-base runtime rules, relevant claims with their limitations, and selected recipe records. These references support proposals; they do not authorize clinical changes or grocery orders and are not an individual treatment plan.

Recipe quantities are explicit, but nutrient totals and glycemic loads have not been calculated. Do not invent them, treat missing values as zero or infer that a day meets a fixed target. Preserve raw, dry, drained and cooked quantity distinctions in grocery calculations. Application ingestion and authorization enforcement remain implementation work.
