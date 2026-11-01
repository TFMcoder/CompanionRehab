# October 31 reported-use conversation repair

**Later October31 update:** The reviewed repairs are now enabled on the existing exact client test route, with Heart, account bindings and care records preserved. Read [the client rollout and later-test preparation](CLIENT_REPAIR_2026-10-31.md) for current scope, final regression, positive older-mail retrieval and deployed timing. The owner-only state below is the earlier checkpoint; actual person/device/save/send acceptance remains open.

The repaired candidate is enabled only in the owner practice copy: `feedback-v3-2026-10-31`, `sha256:a101f2810eb3812850b377e01a78d746193e51e13e85f27bbd11747d5f83c784`. Dad remains on `device-latency-2026-10-27`. Heart, Current, Sol-low, exact account/host/grants, both original releases and care records are preserved. No API billing, root dependency install, migration, credential copying or real care/provider write occurred.

Natural dinner requests select a validated exact library recipe. The app provides its title, yield, quantities, steps and authenticated recipe-page link; the link is to Nancy’s library, not an invented external original. The selected recipe remains available through view changes and trimmed history. A recipe suggestion, accepted meal, grocery approval and report of eating remain distinct.

Missing ingredients are compared with saved pantry and current unacquired list quantities. One complete ingredient review precedes the batch; stale snapshots and unknown units require review. Partial failures stay unconfirmed, and explicit retries use the same per-item keys. Empty lists cannot become email reviews: Nancy offers to create one, retaining the recent recipe through a heard affirmative response. Grocery email content is assembled from current saved items on the server. Recipe emails contain exact quantities, steps and a link. The authenticated client’s own address is resolved on the server; a complete email review still precedes one clear send confirmation. No actual outbound mail was sent in this trial.

Save Suggestions becomes available only after the current feedback/preference/personal-context review finishes playback and its acknowledgement succeeds. It sends the existing typed confirmation with the exact review identifier; stale, unheard, duplicate and changed-scope submissions cannot bypass care approval. Product feedback does not silently become a care preference or clinical instruction. A private audit found requested personal context absent; no real health facts were added. Client confirmation remains necessary.

Long turns receive a separate fixed Heart cue after input recognition. Cue timing is not useful-answer latency and never marks an action review as heard. The owner trial uses longer speech pieces. Complete short messages already retrieved under exact selected-folder/message authority are read literally, with the received date, without another reasoning call. Ambiguous, partial, unavailable and long/truncated messages retain their limitations. The ordinary recent Inbox and calendar windows stay unchanged; on-demand mail search accepts independent older date ranges. Medical context concerns appointment administration, without inferred clinical urgency or invented bookings.

| Question | Before: useful audio ready | Final: useful audio ready | Final audio parts |
|---|---:|---:|---:|
| inbox | 9.44s | 5.39s | 2 |
| message | 4.24s | 1.67s | 2 |
| dinner | not measured | 3.93s | 2 |
| existing grocery email request (read-only fixture) | not measured | 8.19s | 2 |

The grocery case encountered a preexisting nonempty owner list; its raw empty-list expectation failed and is retained in the assessment. The list was preserved. The empty-list refusal and received create-list offer are verified in disposable SQL fixtures, not claimed as an actual empty owner-list voice trial. A measurement harness assertion also mistakenly required the reasoning policy label on ASR events; actual numeric events reconciled and closed that ledger.

These are single recorded-ASR → existing owner Pro/tools → native Heart HTTP-handler samples, not medians or audible phone measurements. The first candidate passed its offline suite but failed the live dinner-card assertion and made the full message slower; it was rolled back and repaired. That failure remains in the evidence. All attempts are accounted for in fresh closed ledgers, with unknowns preserved. The separate real Graph GET-only probe accepted a ninety-day selected-folder search with zero expected matches; it does not establish positive older-mail accuracy.

Validation: 1695 full regression passes, 2 optional skips across 139 files on `sha256:a101f2810eb3812850b377e01a78d746193e51e13e85f27bbd11747d5f83c784`. The final frozen source passed typecheck/build; no source changes followed this suite. Desktop browser checks at320/430px verify the save control, linked quantities, one synthetic save and no horizontal overflow. Silent fixture playback is not Heart listening acceptance. 19 known Pro attempts across successful and failed model-bearing runs; no unknown accounting. All protected file/care/session/binding preservation checks pass.

Actual person/iPhone/Safari audio flow, genuine preferences/context, older matching mail, real reviewed recipe/grocery email delivery and medical scheduling remain awaiting live test. Native audio architectures work directly with speech; the current selected subscription flow does not support audio input, and Nancy retains its separate speech/Heart path. See [Realtime architecture](https://developers.openai.com/api/docs/guides/realtime) and [subscription-flow limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations). No voice or billing route was changed.

[Sanitized evidence](evidence/CONVERSATION-REPAIR-2026-10-31.json). Private details, synthetic recordings and context findings remain ignored locally.
