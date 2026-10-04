# Companion Rehab · Nancy

Nancy helps a participant plan the day through a user-initiated 10 AM voice check-in and a simple touch interface. S01 combines real task choices, meal options, reviewed proposals, explicit acceptance and durable plan history. Actual meal/task reporting follows in S02.

**Current status:** S01 adaptation in progress. The October 3 requirements specify local data storage, four roles, My Day voice/button navigation, meals as tasks, and GPT-6 Sol with high reasoning. The existing September 29 implementation is a baseline using Supabase and Realtime; it has not yet been adapted or live accepted under the new requirements. No paid service activation is claimed.

```powershell
npm ci
npm run check
npm start
```

Open `http://localhost:8787` to inspect the baseline. Its configuration still expects Supabase and Realtime; `.env.example` and readiness checks describe that baseline, not the revised local-data/Sol deployment. Keep real credentials and records in ignored private storage. Do not provision a cloud database just to satisfy the old readiness check.

- [Current product and technical decisions](docs/architecture/PRODUCT_DECISIONS_2026-10-03.md)
- [First connection: private OpenAI setup](docs/S01_FIRST_CONNECTION.md)
- [Baseline setup reference, pending local-data adaptation](docs/S01_SETUP.md)
- [Live-test runbook, pending revised deployment](docs/S01_LIVE_TEST.md)
- [Implementation roadmap](docs/ROADMAP.md) and [authoritative JSON](docs/roadmap/roadmap.json)
- [Human-required actions by slice](docs/HUMAN_ACTIONS.md)
- [Database migration](db/001_s01.sql)

The target Node/Fastify service serves the React client and owns durable care state in local PostgreSQL, with compatible local authentication and later migration to another server or cloud. GPT-6 Sol high provides reasoning through Responses, with a separate speech layer and validated server-owned tools. The service budget is $50/month excluding GPT, with CAD as the unconfirmed planning default and existing resources first. HTTPS routing connects the intended device during supervised tests.

Automated tests use synthetic data, a disposable PGlite PostgreSQL engine, browser DOM tests and provider doubles. They do not substitute for actual local database/auth deployment, GPT/speech, HTTPS, isolated restore or participant acceptance. Client **My Day**, family/friend **Support Team**, clinician **Clinician Partners** and administrator access are scoped separately. Full dashboards and recurring reminder automation remain outside S01.

## Product and nutrition references

The [original MVP brief](docs/MVP.md) preserves the source user stories and architectural background. The current roadmap and October 3 decisions take precedence over its earlier feature order, hosting and role assumptions.

| File | Purpose |
|---|---|
| [Meal library](docs/nutrition/meal-library.md) | Twenty familiar, portioned meal options with parseable recipe records, ingredients, preparation, allergen screening, substitutions and grocery-draft rules. |
| [Nutrition research knowledge base](docs/nutrition/research-knowledge-base.md) | Claim IDs, evidence limits, source-disclosure status, references, planning safeguards and agent acceptance scenarios. |

Load application permissions and the current private, human-approved care protocol before the knowledge-base runtime rules, relevant claims with their limitations, and selected recipe records. These references support proposals; they do not authorize clinical changes or grocery orders and are not an individual treatment plan.

Recipe quantities are explicit, but nutrient totals and glycemic loads have not been calculated. Do not invent them, treat missing values as zero or infer that a day meets a fixed target. Preserve raw, dry, drained and cooked quantity distinctions in grocery calculations. Application ingestion and authorization enforcement remain implementation work.
