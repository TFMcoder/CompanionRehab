# Separate owner test environment

The owner requested a duplicate database and login for personal testing on October 21, 2026. The test copy duplicates the current application schema and locked Current client, with synthetic tasks and meal options. It does not copy the live participant's care records, account password, Microsoft connection, tokens, sessions or permissions. The older practice database is preserved independently.

The deployed address and login remain in ignored `.local/owner-test/` files. The test site is labelled **Nancy Test — practice data only**. Its HTTPS origin uses port 10000; the live application keeps port 8443 and its existing assets. The existing service on port 443 is also preserved. Tailscale's [Funnel CLI](https://tailscale.com/docs/reference/tailscale-cli/funnel) supports an independent port-specific route; never reset the whole Funnel configuration to change this test site.

## Isolation contract

- A new `nancy_owner_test` database and restricted `nancy_owner_test` PostgreSQL role own the copied schema and synthetic records. The role cannot create roles/databases, act as superuser, replicate, or access the live care tables.
- The tester is the actual existing account owner, with a new local test password and synthetic participant profile. Retaining that owner's stable actor identity permits only the existing owner-practice reasoning binding. The runtime checks that the immutable owner/account/host binding already exists; it does not create a new provider binding, copy credentials, use another active account or enable a caregiver resolver.
- The existing encrypted owner connection is referenced in place, with its existing refresh lock. The test session encryption key, login/revocation records, browser origin and cookie names are separate. Both application and failed Microsoft-callback cookie cleanup are isolated, so test logout or errors cannot clear live-site cookies.
- The test runtime constructs no Microsoft service and does not read Microsoft certificates, keys, tokens or configuration. Calendar/inbox/action routes remain unavailable. Model-facing Outlook capability is false. No API-key fallback or billing change is enabled.
- Care, reminders, preferences, recovery receipts, metadata and suggestions use the test database. No real clinical protocol is seeded. A practice plan or report is not real participant acceptance.

## Operation

`scripts/create-owner-test.ts --apply` is an explicitly invoked, one-time provisioner. It requires the established local configuration, refuses an existing named test database/role/configuration, applies the canonical schema only to the fresh target, creates its own synthetic profile and seeds a small example task/meal list. It never resets an established database. Do not rerun it to repair an existing login or environment.

`scripts/install-owner-test.ps1` installs the separate **Nancy Owner Test** limited Windows task, using the existing hidden launcher. `scripts/run-local-demo.mjs --owner-test` supervises only the test process on loopback port 8788, with its own state, launch marker, logs and lock under `.local/owner-test/runtime/`. The live supervisor's default paths and port remain unchanged. The computer, internet connection and the same Windows sign-in are still required.

The private `Open-Nancy-Test-Login.cmd` opens `scripts/show-owner-test-login.ts` in a human-only TTY. Copy the test password there; do not capture the viewer output in logs or repository evidence. The current client has no self-service password-change flow.

The October 21 owner-authorized [speed/quality comparison](REASONING_COMPARISON_2026-10-21.md) may select an explicitly reviewed experimental model/effort in this copy. Its separate private `reasoning-experiment.json` must match the exact owner, synthetic participant and origin; selection is pinned at startup. Main never reads it, and alternate profiles are rejected on caregiver routes. Absence retains Sol/high, with no automatic fallback. Preserve the previous selection/absence and entry page before a guarded test-only restart. The production client remains Sol/high until a separate owner review.

The test route can be taken offline independently with `tailscale funnel --https=10000 off`. This preserves test records and the other routes; it does not stop the Windows task. Stop or remove only the named test task after separately checking its recorded process identity. Never stop the shared PostgreSQL cluster or live Nancy task to manage a test copy.

## Verification and limits

The isolation suite checks strict database/profile configuration, independent encrypted cookies, unchanged production defaults, failed-callback cookie cleanup and the locked test entry. Actual local PostgreSQL/HTTP tests check restricted-role denial, synthetic writes and idempotency, absence of test profile/record IDs in the live database, owner-only reasoning eligibility, disabled Outlook and unchanged live runtime/configuration. One bounded synthetic owner-practice Sol-high request and Heart audio qualify that operational route separately from the synthetic regression suite.

Current measured results are recorded in [sanitized evidence](evidence/OWNER-TEST-2026-10-21.json). Phone microphone/audible acceptance, genuine intended-participant use, genuine-day usefulness and full slice completion remain open. A tester using dummy records does not satisfy those gates.

The October 22 [prepared-context trial](CONTEXT_PREPARATION_2026-10-22.md) adds the default-off `context_mode: prepared-v1` only in this exact private selection. It preloads public recipe details and uses fresh care facts, bounded local quotes and smaller read-only requests. The previous Sol/low selection/entry are saved privately for rollback; main and the live client remain unchanged. Conversational latency remains open despite faster exact lookups.

The October 22 [Heart speed trial](HEART_SPEECH_DELAY_2026-10-22.md) adds the exact private `speech_mode: heart-latency-v1` alongside prepared Sol/low. It retains Heart and normal speaking speed, uses twelve local CPU threads and smaller validated speech pieces, and prepares one public availability clip. It is labelled “prepared context + Heart speed trial”. Removing this selection through the saved test-only rollback restores the previous behavior; main is unchanged. Subjective phone/listening acceptance stays open.
