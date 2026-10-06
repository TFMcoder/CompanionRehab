# Preliminary client trial

This guide covers the October 6 S01/S02 trial preparation. The feature is still under review. The separate `nancy_client_trial` database is active with no tasks, meals, appointments, activity records or outbound intents; the `nancy_myday` practice database is preserved. Do not copy a sample task, meal, appointment, report or transcript into the client database.

Before a participant uses it, the engineering owner verifies the database separation, encrypted restore path, scoped sign-in, current application build, HTTPS route and absence of preview and test controls. The active address is recorded privately in `.local/runtime/my-day.json`; the owner sign-in is recorded privately in `.local/runtime/client-trial-login.txt`. Do not publish either value. The owner records sanitized evidence and keeps account details and care records private. These checks do not replace the S01 disposable live safety test or the participant's real-device acceptance. Do not run synthetic practice scripts against the client database.

The page and buttons become available while the selected speech workers warm. On the current host, recent startup checks observed HTTP ready in 224–334 ms and speech ready 4.2–11.3 seconds after startup. Wait for voice availability before judging Talk to Nancy; these startup figures do not measure a spoken turn on the iPhone.

## Using My Day

1. Open My Day on the selected iPhone in Safari and sign in with the assigned account. **Talk to Nancy** stays available from each client view.
2. The authorized owner enters genuine tasks, meal choices and any local appointment through the minimal private setup, with the participant's preferences and time zone. Enter urgency and a date or time only when known. Leave an unknown time unscheduled. If there are no appointments, leave the list empty. Review these facts in My Day before planning.
3. Ask Nancy what matters now. Review the proposed tasks and meals, then accept only the plan you actually want. A saved plan records an intention; it does not record that anything was done or eaten.
4. Open **Tasks** and **Meals** to check the simple names and known times. Open **Activity** to see actual reports. The views should agree with Nancy's spoken readback.
5. During an ordinary day, report a task when completed, a meal when eaten and an appointment when attended. Defer or reschedule a real pending item when appropriate. If a report is wrong, correct or void it and confirm that the history remains understandable.
6. Ask an ordinary nutrition or meal question. Nancy should identify the repository reference and its limits, respect supplied preferences and avoid treating a recipe as an approved meal or clinical instruction.

The participant may use buttons or voice. The 08:00–11:00 local morning window shapes suggestions but does not limit access; a conversation works at other times. Foreground **Hey Nancy** is optional and needs separate consent on the actual device. A closed browser or locked phone is not promised to listen or speak.

## Boundaries for this trial

Email and Asana are awaiting access. The selected Outlook account is Microsoft 365 work/school, but its calendar connector is also waiting for scoped authorization. My Day uses local appointment entries and does not send email, calendar changes or PM updates. Database records for future external mappings and held intents do not enable delivery.

The selected reasoning route is GPT-6 Sol high with Kokoro Heart speech. Successful use of the project owner's account does not establish another client's account or deployment eligibility. Confirm intended-user access, consent, actual iPhone/Safari voice behavior and provider limits before relying on a client trial result. No silent model or paid API fallback is enabled.

The care service keeps plans, factual reports, corrections, events and receipts as durable records. Operational logs keep bounded metadata for 14 days in the live database, separately from care history, without audio or transcripts. Existing encrypted snapshots retain their captured records; live-table pruning does not delete older backups. Nancy uses fresh authorized facts, a short recent conversation window and bounded repository nutrition retrieval. `AGENTS.md` and the roadmap guide engineering; they are not sent with each model turn. Repository nutrition is reference material with provenance, not clinical approval. Keep participant names, household details, transcripts, credentials and full private test evidence out of this public repository.

S01 remains **in progress** until its real conversation, safety and consent gates pass. S02 remains **awaiting live test** until a genuine day and factual ledger review occur. Synthetic or disposable checks can verify error paths but cannot stand in for those observations.
