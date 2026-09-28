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

## Next development artifact

Convert [the roadmap handoff section](docs/MVP.md#15-roadmap-handoff-for-codex) into prioritized epics, data/API contracts, implementation slices, acceptance tests and deployment gates. Resolve the listed product and privacy decisions with the relevant stakeholders before enrolling a real participant.
