# First connection: private OpenAI setup

Updated: 2026-10-04. This is the current first account-setup step for S01. It does not require a cloud database, and it does not make the older Supabase deployment runbook current. The revised local database/authentication and speech implementation remains in progress.

## Account-owner steps

1. Sign in to [OpenAI Platform](https://platform.openai.com/) and select the existing CompanionRehab project, or create a dedicated project if none exists.
2. Check [API billing](https://platform.openai.com/account/billing/overview). Reuse existing available API billing/credit. If funding is required, the account owner chooses the amount; no automatic top-up or purchase is implied by these instructions. GPT backend charges remain separate from the $50/month service budget.
3. Open [API keys](https://platform.openai.com/api-keys) in the selected project and create a project key named **Nancy local pilot**. Reuse an appropriate existing project key if one is already available privately. The account owner handles any sign-in/MFA or credential-creation restriction.
4. In the existing ignored `.env.local` at the repository root, place the value after `OPENAI_API_KEY=` and save. Change only that entry; preserve the session/backup keys and other settings. Do not paste the credential into chat, shell commands, documentation or GitHub.
5. Tell the agent **key saved** without including the value. If any dashboard step is unavailable, describe the message without sharing credentials.

The [official developer quickstart](https://developers.openai.com/api/docs/quickstart) documents dashboard API-key setup. [Production guidance](https://developers.openai.com/api/docs/guides/production-best-practices) describes environment-variable storage and account limits. The selected reasoning backend remains `gpt-6-sol`, high reasoning; account availability and actual inference still need verification.

## Agent-owned verification

`npm run readiness:openai` checks key presence without a network call or displaying the credential.

`npm run readiness:openai -- --connect` makes a read-only request for the selected model's metadata. It reports a fixed status and HTTP code, not the key or raw provider errors. A permission denial can mean the key lacks model-list/read access; it does not by itself establish that inference is unavailable.

Successful model visibility is not proof of working billing, Responses inference, transcription or speech output. The next agent step is a bounded synthetic inference/speech check, followed by actual device audio and the slice's required live tests. Keep real participant content out of connection probes.

The current app's older `npm run readiness` command still describes the Supabase baseline. Use the dedicated OpenAI check for this first step; do not provision Supabase to satisfy the historical check.

## Next human inputs, requested at the relevant step

- Intended device/browser, same-network or remote access, and participant time zone.
- Existing HTTPS hostname/tunnel account where available; the agent handles deployment and routing.
- Real-data consent and processing/retention choices after reviewing the agent's concrete proposal.
- A small genuine task list, meal choices and restrictions through private setup.
- Microphone/speaker participation and the real daily planning/reporting trial.

Database installation, application changes, authentication, commands, backup/restore, technical tests and deployment are engineering tasks. The account owner is not responsible for coding or manually running database migrations.
