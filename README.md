# Companion Rehab

A voice-capable, tablet-first daily companion for rehabilitation, meals, routines and household work. The participant sees the present activity; an auditable care service manages plans, synchronization and progress behind it.

## Start here

[MVP product brief and proposed technical specification](docs/MVP.md) covers the participant and family experience, stakeholder user stories and acceptance conditions, release boundary, domain and event model, agent tool contract, Asana synchronization, privacy controls, and the later company Outlook integration boundary.

The first release is intended to prove one daily loop: Morning Boot → negotiated plan → sequential activities → voice/touch completion → Asana synchronization → deterministic score and family celebration. The document is the input to a more detailed feature and engineering roadmap, not an implementation claim.

## Working principles

- The care database is the operational source of truth; model conversation and Asana are interfaces to it.
- AI proposes or interprets; authenticated application services validate and commit state changes.
- Care protocols, permissions, scoring and family visibility are explicit, versioned and auditable.
- A dedicated Asana environment limits the household integration. Company Outlook access is a later, IT-approved integration scoped to the participant's mailbox and calendar.
- Real care records, credentials and identifying information do not belong in this public repository.

## Nutrition reference material

| File | Purpose |
|---|---|
| [Meal library](docs/nutrition/meal-library.md) | 20 familiar, portioned options: five each for breakfast, lunch, snack and dinner. Markdown with parseable YAML recipe records, ingredient quantities/states, batch yields, preparation, allergen screening, substitutions and grocery-draft rules. |
| [Nutrition research knowledge base](docs/nutrition/research-knowledge-base.md) | Compressed adaptation of the research guide: claim IDs, evidence limits, source-disclosure statuses, 32 linked references, fasting/medication safeguards, planning parameters and agent acceptance scenarios. |

**Agent loading order:** application permissions and the current private, human-approved care protocol → knowledge-base runtime/safety rules → relevant claims together with limitations and source status → selected recipe records. These files support proposals; they do not authorize clinical changes or place grocery orders. They contain no real participant profile and have not been clinically approved as an individual treatment plan.

Recipe quantities are explicit, but nutrient totals and glycemic loads have not been calculated. Do not invent them, infer that a day meets a fixed target, or treat a missing value as zero. Preserve the distinction between raw, dry, drained and cooked quantities when aggregating groceries. Application ingestion, validation and authorization enforcement remain implementation work; adding these documents does not implement those features.

## Next development artifact

Convert [the roadmap handoff section](docs/MVP.md#15-roadmap-handoff-for-codex) into prioritized epics, data/API contracts, implementation slices, acceptance tests and deployment gates. Resolve the listed product and privacy decisions with the relevant stakeholders before enrolling a real participant.
