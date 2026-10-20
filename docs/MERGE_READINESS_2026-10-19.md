# Current design lock and merge preparation

The owner compared Current and Focus on October 19 and selected Current, then requested feature tests, a repository/code scan and preparation for local/GitHub merge. The [approved Current design](CURRENT_UI_DESIGN.md) is the production baseline. Focus remains preserved with the entry switch disabled, including for old review URLs.

The merge candidate includes the accumulated October 13–19 engineering work: factual intake and task records, reviewed preferences and day choices, interruption/receipt recovery, current-source reminders, additive local schema/backup support, permanent-client provisioning, the exact optional caregiver reasoning authorization, bounded account-bound Outlook context/new actions, and the simplified client interface. Current's source/build rollback remains independently verified. This is an engineering checkpoint, not a completed slice or a new provider/account exception.

## Review scope

The review inventories tracked and untracked public candidates and checks the full feature regression, actual disposable PostgreSQL paths, listening-HTTP recovery/restore behaviour, production build, dependency advisories, public/private boundaries and roadmap consistency. Critical-path source inspection covers:

- Durable session/role/grant checks, request-only authority binding and client-only acceptance.
- Exact caregiver actor/client/grant/account/host identity and fail-closed credential binding.
- Microsoft PKCE/nonce/signature/tenant/object validation, token encryption and selected-resource/Graph bounds.
- Reviewed provider dispatch, durable claims/receipts and read-only reconciliation after uncertain sends.
- Plan versus actual-report separation, version checks, intake timing and current reminder sources.
- Interrupted/late voice results, retained commands, scope changes and serialized device retries.
- Additive schema upgrades, encrypted care backups, restore compatibility and excluded live sessions/provider credentials.
- Client navigation/voice continuity, disabled production Focus selection and public artifact boundaries.

The automated scan is a bounded source/publication check, and the dependency audit uses registry advisories. Neither establishes an independent penetration test or full clinical/accessibility certification.

## Findings repaired

| Finding | Repair |
|---|---|
| The design experiment remained enabled after the owner chose Current. | Ship the disabled review switch and test the actual entry page, including an old Focus link. |
| Household person names remained in public documentation. | Replace them with role descriptions; keep private account/host/credential values and screenshots outside Git. |
| Two voice-choice tests combined fixed-date logins with real-clock feature authorization, so their fixture sessions expired as calendar time advanced. | Control Date in those tests while keeping database I/O/timers real, and explicitly test that an expired login is denied. No production expiry or permission rule was weakened. |
| README setup/status text still described superseded navigation and pending account activation. | Point to the locked design, current handoff and exact bounded operational connection, retaining outstanding live gates. |
| Public-boundary checks were not part of CI. | Add a location-only credential/private-artifact scan, synthetic regression cases and the same check to existing Linux/Windows CI. |

Final checks pass **963 tests with one optional skip across 105 files**, **219 actual disposable-PostgreSQL matrix checks**, and **67 listening-HTTP recovery/restore checks**. Typecheck/build, roadmap/generated view, dependency audit (zero advisories) and both publication scans pass.

Final measured results, source revisions and private evidence references are recorded in [the merge preparation evidence](evidence/MERGE-PREP-2026-10-19.json). The initial failed clock runs remain private diagnostic evidence; only completed final checks are reported as passing.

## Merge and deployment boundaries

The candidate is prepared on `codex/current-ui-merge-prep-2026-10-19` from the verified `main` base. Review the GitHub proposal and its CI result before merging. Local and GitHub `main` are not changed merely by preparation. The approved design lock is already served by changing only the static entry switch; application assets, backend service, Microsoft/caregiver configuration and care records are preserved. No schema migration, test email/invitation, microphone activation or real model request is part of this validation.

Genuine intended-person/iPhone/Safari use, remaining complete canonical matrices, real provider refresh/revocation/disconnect recovery, genuine-day usefulness and full slice/release acceptance remain open. Engineering merge readiness does not complete those human or release gates. Future database upgrades require the existing inspected backup/restore path; never reseed established care data as a merge step.
