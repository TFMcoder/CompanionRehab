# October 21 live-test repairs

The owner reported long waits, accidental speech interruption, repeated sign-in and microphone prompts, an off-screen Talk control, missing meal personalization and unavailable Outlook context. This is evidence of an incomplete real-device experience, not acceptance of the full slice.

## Measured findings

The recent diagnostic sample contains 26 completed server turns (median 6,352 ms; slowest 17,655 ms), 19 speech-end-to-browser-playback-start observations (median 10,009 ms; slowest 26,546 ms), and 15 interrupted turns. These are mixed recent service observations, not a controlled before/after benchmark or proof of sound reaching the person. Actual audible-response timing remains unknown. Private raw numeric evidence is kept outside the repository.

An ordinary reply performed a selected Outlook read before reasoning. Calendar and Inbox reads were sequential. The conversation's automatic context covered today; the existing tool supported wider intervals, but required date arithmetic. Inbox retrieval shared the calendar's interval and could miss older appointment messages. Local authorization failure could erase a persistent Outlook connection. At inspection the connection required reconnecting and its token/resource selections had already been cleared. Deleted credentials are not recovered from an old backup.

The authorized profile did not contain the reported ongoing dietary context. The repository already supplies a type 2 diabetes reference and recipe library, but retrieval was dependent on model tool calls. Its provenance instruction could also encourage spoken technical references.

Three bounded synthetic owner-practice model requests were used for the repair checks, not intended-client acceptance. The first three-meal request used one model round and four local reference retrievals, but took 9,361 ms from typed request through the first audio part becoming available. Compact choice summaries reduced the preload from 11,298 to 3,103 characters and observed input from 10,081 to 7,615 tokens; the follow-up still took 8,862 ms, with 7,741 ms in the selected model call. These single samples had different provider-cache observations and do not establish a general latency improvement. Model latency remains a material open issue. No model/effort change or API fallback was made.

## Implemented behavior

- Current stays selected. Its green Talk panel is centered and sticky at the top, with safe-area clearance. Talk stays visible during a conversation; Stop remains available. The default five tabs and preserved Focus rollback remain.
- Automatic acoustic interruption and visible Interrupt controls are removed. Microphone samples are discarded while preparing/playing a reply; they do not cancel it or queue a later command. Explicit Stop, logout, revoked scope and internal cancellation protections remain.
- The synthesis-only alias for “cyclic” uses the requested short initial vowel. The displayed text and care records retain the original spelling.
- Relevant meal-choice questions receive bounded real repository claims and breakfast/lunch/dinner recipe options before the first model call. Provenance remains in metadata. Nancy uses plain language and retains allergy, medication, portion and clinical-approval uncertainty.
- Confirmed preferences and active client-reported context remain available in later conversations. A lasting preference or self-reported health note still needs the client's exact review/confirmation. A reported condition is not a diagnosis by Nancy or a prescribed diet. No clinical target or permanent real-person note is created by this repair.
- The login screen offers an unchecked “Keep me signed in on this device for 30 days” choice. Access tokens still rotate, the absolute server deadline is enforced, and logout, disabled accounts and revoked grants remain effective. Ordinary logins retain seven days. Cookies remain encrypted, HttpOnly and SameSite, with Secure on HTTPS. This is bounded trusted-device sign-in, not anonymous or unlimited access.
- A foreground conversation requests a screen wake lock when supported and releases it on Stop. It does not promise listening or continuous conversation with a manually locked phone, a closed page or an unavailable browser permission.
- Ways to use Nancy explains Safari's per-site microphone Allow setting. The application never grants permission itself or keeps a stopped microphone running to avoid a prompt.

## Outlook preparation and recovery

Local browser expiry now cancels only its pending sign-in attempt. Persistent Outlook credentials are erased for actual account/grant/configuration/provider invalidation or deliberate disconnect, rather than ordinary browser expiry. Temporary refresh outages preserve still-authorized credentials; corrupted credentials fail closed.

Conversation tools accept an explicit local date and one to seven local days, including a daylight-saving transition. The selected Inbox has an independent recent-seven-day lookback. Calendar and Inbox reads run concurrently and are fully drained before their authorization transaction is released. Interactive context/calendar reads have an eight-second provider budget and a 1.5-second row-lock wait; failed reads never imply an empty Inbox or free time.

Ordinary unrelated replies no longer wait for Graph or carry mailbox contents into the prompt. Relevant questions can use a dated prepared snapshot for at most five minutes; explicit current-availability/refresh requests read again. Selection changes, reconnect, disconnect, grants and reviewed writes invalidate prepared context.

The existing durable scheduler can perform separately authorized read-only morning preparation from 06:00 until 11:00 in the participant's time zone, refreshing no more often than every five minutes. Startup within that window catches up; outside it, reads remain available on demand. The exact persistent client/account/grant binding is checked before every request and before commit. Snapshots and attempt times survive restart in the existing Microsoft connection row, encrypted under a separate prepared-payload purpose. No new queue, model request, reminder, accepted plan, completed activity, message, invitation or microphone activation is created. A distinct private `preparationApproved` flag defaults off; prior conversation disclosure alone does not enable this work.

This prepares selected facts and possible appointment-message context. Unread does not mean unanswered. Inbox-only access cannot establish all outgoing replies or confirm a scheduling conflict. The recipe index is the deployed repository library; a scheduled job does not fetch arbitrary GitHub changes into trusted application policy.

The eligible client can use `/?setup=outlook` or the FAQ's connection action for the existing account-bound sign-in/resource-selection screen. This adds no permanent tab and does not bypass local login or Microsoft identity checks. The isolated owner test instance continues to have Outlook disabled. Existing tenant consent, sole-user assignment, seven delegated scopes and the exact caregiver reasoning route are preserved.

## Evidence and remaining gates

See [sanitized test/deployment evidence](evidence/LIVE-TEST-REPAIRS-2026-10-21.json). Encrypted backups and private static/runtime rollback material remain outside Git. Migrations 019/020 are additive; the schema inspector rejects partial or out-of-order application, and earlier 018/019 encrypted care backups remain restorable. No provider credentials or prepared mailbox snapshot are included in care backups.

Physical iPhone permission persistence, sticky placement with Safari's bars, long pauses, wake-lock behavior, pronunciation and conversational usability require a new intended-person device run. Restoring Outlook requires the approved person's interactive sign-in and selected resources because the earlier token was deleted; tenant approval is not repeated. Actual provider refresh/revocation and a real scheduled morning read remain open until observed. General diabetes meal examples do not supply missing prescribed clinical instructions. No full slice is marked complete.

## Primary references checked

- [Apple's Safari privacy settings](https://support.apple.com/en-ie/guide/iphone/iphb01fc3c85/27/ios/27) describe microphone Ask/Deny/Allow and per-site exceptions.
- [The W3C Screen Wake Lock specification](https://www.w3.org/TR/screen-wake-lock/) limits screen locks to active visible documents and allows the browser/system to release them. [WebKit's Safari 18.4 notes](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/) also document support in Home Screen web apps. This does not establish locked-screen voice support for Nancy.
- [CDC diabetes meal planning](https://www.cdc.gov/diabetes/healthy-eating/diabetes-meal-planning.html) supports balanced meal planning and individual needs rather than an invented carbohydrate prescription. The application retains the repository's more detailed source limitations.
- [Official OpenAI latency guidance](https://developers.openai.com/api/docs/guides/latency-optimization) supports reducing unnecessary sequential work and model round trips. It is not a measured performance guarantee for this subscription route; the selected model, effort, Heart voice and billing boundary remain unchanged.
