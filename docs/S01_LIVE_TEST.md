# S01 live acceptance — operator run sheet

**Deployment revision required — October 3, 2026:** The procedure below targets the September 29 Supabase/Realtime baseline. Initial storage is now local on this machine, and the selected brain is GPT-6 Sol high with separate speech. Before executing acceptance, update this run sheet to the revised [S01 contracts](roadmap/roadmap.json): four scoped roles/homes, My Day voice/button navigation, task urgency/date/time, shared meal/task identities, actual local PostgreSQL/auth and encrypted isolated local restore. Do not treat old cloud setup steps as a requirement. See [current decisions](architecture/PRODUCT_DECISIONS_2026-10-03.md).

Status: **not run**. This file is a procedure, not evidence of a pass. Automated PostgreSQL/provider-double tests do not satisfy either live gate. Keep recordings, credentials, participant data and complete observations in private storage; publish only sanitized evidence references.

## Prerequisites

- Record the implementation revision with `npx tsx scripts/implementation-revision.ts` and rerun `npm run check` after code changes.
- Confirm configured Supabase, OpenAI model entitlement, hostname, an isolated restore target, and two disposable invited accounts. Use the built app over HTTPS on the intended browser.
- Resolve S01-H01/H02 access and the device/browser. Do not use meaningful participant records until LIVE2 passes and S01-H03/H06 are resolved.
- Start a private observation record: UTC time, device/browser, local timezone, observer, provider/project references, data origin, revision and the scenario ID. Preserve no API keys or raw request headers in public evidence.

## S01-LIVE2 — disposable cloud safety first

1. Sign in as disposable user A and supply plainly synthetic tasks/meal options. Confirm the configured local date. Start a check-in, propose and explicitly accept a plan. Query Today and the command receipt through the actual API; compare accepted IDs, revision and meal/task names.
2. In a separate authenticated test session, submit the exact same command/key and then change its payload under that key. Expect one committed result for the duplicate and refusal for the changed payload. Race two commands at the same revision and verify one succeeds and the other conflicts. Verify event/version counts privately in the real database.
3. Sign in as disposable user B. Try A's task, option, proposal and receipt IDs through the real API. Confirm no cross-participant read or write. An unauthenticated call must fail. Revoke A's grant privately and confirm existing voice/touch sessions cannot read/write; restore the disposable authorization only through the authorized administrator setup.
4. Talk to Nancy: hear a real response, propose meals and tasks, interrupt the spoken review, and try vague assent. Confirm nothing is accepted. Complete a fresh review, say “Nancy, accept this plan,” then compare the actual committed plan to the spoken readback. Test microphone denied, audio playback blocked and Stop while connecting.
5. Interrupt the API/provider connection around a disposable write. Confirm the UI/Nancy reports an unconfirmed result and uses receipt lookup without writing again. Check both a pre-commit failure and a committed result whose response was lost. Reconnect and use touch; test a delayed older view response cannot replace a newer state.
6. Restart the local API and tunnel. Sign back in if needed and compare the accepted plan/history/receipt to step 1. Confirm signed-out sessions and revoked grants remain denied after restart.
7. Export an encrypted disposable backup with the administrative CLI, copy it to separate protected storage, and restore into the isolated empty target. Compare every care table and exact accepted-plan/receipt readback. Verify separate Auth identity mapping and record the recovery scope. Do not restore into active care history.
8. Record observed pass/fail per step, actual provider usage/cost, and private evidence references. Only mark LIVE2 pass if every relevant step passed for the current revision. A failed step returns the slice to engineering work.

## S01-LIVE1 — real 10 AM check-in

After LIVE2 passes, privately record the participant's consent/data boundary, actual ordinary task/meal choices, timezone and any existing approved restrictions. At 10:00 in that zone, open Nancy on the intended device with the participant. Complete a real spoken brief, discuss choices, hear the full proposal and explicitly accept it. Read the saved result through both voice and touch, revise one meal choice, explicitly accept the new version, refresh, and compare the retained versions. Confirm the text, speech pace, microphone, audible output and controls are usable.

Store full evidence privately. Update the canonical JSON with genuine results and associated human-action evidence. Do not record the participant's transcript or identifiable meal/task details in this public run sheet. S01 is complete only when its automated/live criteria and applicable slice-completion human actions all pass.
