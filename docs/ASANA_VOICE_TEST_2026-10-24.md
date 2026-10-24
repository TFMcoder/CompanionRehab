# Imported Asana tasks through the Nancy voice service

October 24, 2026. The owner authorized planning, rescheduling and completion tests in the separate practice copy, preserving Heart, Dad's setup and no API billing. The recorded-speech functional checkpoint passes. Physical microphone capture and human-audible playback remain awaiting_live_test.

## What actually ran

The deployed Current Talk button reached microphone/audio startup, then reported that permission had not finished within twenty seconds. No successful physical microphone session is claimed. Instead, fifteen bounded submissions used locally generated synthetic speech through the same authenticated `/api/conversation/:id/audio` endpoint as Talk to Nancy. These exercised actual local ASR, the existing owner Pro reasoner, native selected Heart output, reviewed commands, durable receipts and SQL records. One submission was an exact duplicate retry. Full WAV reply parts were validated; the harness simulated the playback acknowledgement required before confirmation. It does not establish that a person heard the review or that Safari microphone/endpointing/network behavior works.

The actual practice flow:

1. Nancy correctly distinguished the grocery tasks on October 26 and October 28, and the unscheduled imported task.
2. The synthetic speaker selected only the imported undated task and the three existing practice meals for today's plan. The proposal remained unaccepted during review; recorded “Accept this plan” saved the reviewed version. Grocery dates were retained.
3. A request to move the imported task to 17:00 Toronto time prepared a review without changing its schedule. Recorded “Save this change” saved 21:00 UTC, with pending status and no actual occurrence time. Nancy correctly said that scheduling was not completion.
4. A synthetic completion report again prepared review first. Its confirmation saved one completed task report with a separate occurrence time. An exact repeated audio/turn request returned the same reply without another completion. Meals remained planned, not reported eaten.
5. Nancy asked which grocery task the speaker meant, rather than choosing one. Neither grocery task changed.
6. Following the owner-only service restart, Nancy retrieved the existing completion and its reported time from the saved ledger. The imported local task/plan/activity mapping is verified.
7. A fresh read from actual Asana confirms all twelve source tasks, versions and mappings remain unchanged. Nancy's plan/activity updates do not write back to this read-only source.

## Repairs found by the test

One source-status answer added an unsupported apology about an earlier statement. The owner-preparation path now adds fixed trusted guidance for imported Asana copies: distinguish Nancy saves from external provider writes and ground claims about prior actions/statements in recent history or receipts. It adds no source text to trusted instructions, no tool capability and no extra lookup. Default client prompts do not receive this addition. The repeated ambiguity/source-status questions no longer include the unsupported apology and clearly distinguish Nancy from Asana. This observed repair is not a guarantee that future generated wording is infallible.

The actual Tasks screen also omitted dates for date-only imported tasks, making the two grocery entries look identical. An owner-only build flag now displays their existing literal dates while keeping unknown times unknown. The default build keeps its prior behavior; Dad's active assets are untouched. The existing Current layout, CSS, voice controls, model label and Heart selection are preserved. The prior owner index is retained privately for rollback. The deployed practice UI shows Monday, October 26 and Wednesday, October 28, plus the saved task completion.

## Evidence and limits

The [sanitized evidence](evidence/ASANA-VOICE-2026-10-24.json) records exact source revisions, tests, accounting and the remaining device gate. The main recorded command sequence ran at the pre-repair source; three current-server recorded-speech retests cover clarification, source-status wording and restart-persistent completion. Command enforcement/data logic did not change. Final automated checks cover the combined server repair and the owner-only date display. The final UI verification uses the repaired practice bundle.

Seventy-five final checks verify original rows in thirty care tables, the exact authorized practice deltas, source immutability, duplicate prevention, both supervisors, Dad's process, configuration and unchanged design assets, with the reviewed owner-index change/rollback checked separately. The practice deltas are one check-in, one proposal, one accepted plan, three plan receipts, five events and one task activity record, plus the two append-only activity receipts. These synthetic records are intentionally retained for review and are not genuine care acceptance evidence.

The engineering ledger is closed at sixteen observed existing-Pro attempts, including preparation and warmups, below the unchanged cap of ninety-six. A three-turn wording retest and the bounded UI reload/preparation reservation were declared before execution. Unknown request counts are zero. No API-funded inference, paid service, model change, voice change, provider task writes or live-client restart occurred. Only the verified owner child restarted for the server repair; the owner date bundle required no server restart. Synthetic endpoint durations are not claimed as phone latency or human audibility, and no speed improvement is asserted.

The iPhone question is a read-only follow-up: open the existing test origin in Safari, tap Talk to Nancy, allow the microphone if asked, and ask whether the fixture task was completed today. The actual phone result remains unobserved until the owner reports it and the appropriate device evidence is reviewed. The broader Wi-Fi/cellular study, genuine-day/client acceptance, production Asana identity, revocation/webhooks/writeback and full slice gates remain open. No completed slice or human action is inferred from these synthetic tests.

The prompt repair keeps explicit history and trusted application policy separate; see [OpenAI conversation and reasoning-state guidance](https://developers.openai.com/api/docs/guides/reasoning). That provider guidance does not establish success for this application; the actual scoped tests above are the evidence.
