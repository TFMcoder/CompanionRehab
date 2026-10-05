# First connection: qualify existing ChatGPT-plan reasoning

Updated: 2026-10-04. Follow the [selected connectivity direction](architecture/PRODUCT_DECISIONS_2026-10-04.md): qualify existing ChatGPT-plan reasoning first, independent speech second, then the integrated local care service and My Day. The private API key is already saved. The revised local database/authentication and speech implementation remains in progress.

## Current result

The owner created the CompanionRehab project and saved a restricted pilot key privately. The actual model metadata check passed for `gpt-6-sol`; bounded Responses-high and speech requests returned HTTP 429. See the [sanitized connection record](evidence/S01-OPENAI-CONNECTION-2026-10-04.json). No successful inference, audio, device conversation or S01 live acceptance is claimed.

Do not repeat key setup. Subscription qualification is now the selected next step under the [Cerberus addendum](architecture/CERBERUS_REUSE_ASSESSMENT.md#october-4-addendum-mcp-tunnel-and-subscription-reasoning). The tunnel carries tool calls; supported ChatGPT-plan inference has separate account, model, deployment and usage limits. The local OAuth/Responses qualification helper is implemented and has reached OpenAI's final permission screen; consent and actual subscription inference remain pending. This helper is not the integrated Nancy runtime. See the [preparation evidence](evidence/S01-CHATGPT-PLAN-PREP-2026-10-04.json).

## Agent-owned next steps

1. Inspect the supported ChatGPT-plan integration and actual local runtime. Establish the intended account/user and local/remote deployment eligibility. Prepare app-specific supported sign-in with the minimum permissions; do not copy Cerberus credentials or assume shared entitlement.
2. Implement the small reasoning adapter and prove a bounded synthetic `gpt-6-sol` high turn plus authorized tool round trip. Record runtime/auth/model/effort and observed allowance/usage; exercise renewal, revocation and quota refusal. No automatic paid API fallback.
3. Independently qualify available local or low-cost hosted speech input/output. Test genuine microphone input and audible output on the intended device, with measured latency/interruption behavior and stated costs. Plan usage and MCP do not establish voice support.
4. Connect the qualified paths to local PostgreSQL/auth, shared typed task/meal commands and My Day HTTPS. Use local MCP or Secure MCP Tunnel only if a supported caller needs it; a tool tunnel is not the browser web origin.
5. Run S01-LIVE2 disposable safety/restore checks before S01-LIVE1's consented real plan. Provider probes alone cannot complete either gate.

The [plan integration guide](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt), [app-server guide](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server) and [current limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) define the supported path. Exact-model access requires successful inference; a model catalog is insufficient. The documented flow excludes audio input/transcription and hosted Responses MCP/connectors.

## Conditional API fallback and existing diagnostic

If subscription qualification reveals a concrete blocker, prepare the supported alternatives and cost implications for an explicit owner choice. Reuse the existing key if API billing is selected; only then guide remaining steps on [API billing](https://platform.openai.com/account/billing/overview). The owner selects any funding amount. No automatic purchase, top-up, new key or recurring upgrade is implied. A hosted speech choice may require separate API access even if reasoning uses the subscription.

`npm run readiness:openai` checks key presence without a network call or displaying the credential.

`npm run readiness:openai -- --connect` makes a read-only request for the selected model's metadata. It reports a fixed status and HTTP code, not the key or raw provider errors. A permission denial can mean the key lacks model-list/read access; it does not by itself establish that inference is unavailable.

Successful model visibility is not proof of working billing, Responses inference, transcription or speech output. These commands check the API-key path only; they do not test a ChatGPT-plan connection. Keep real participant content out of all connection probes.

The app's older `npm run readiness` command describes the Supabase baseline. Do not provision Supabase to satisfy that historical check.

## Next human inputs, requested at the relevant step

- Intended device/browser, same-network or remote access, and participant time zone.
- Intended user's eligible ChatGPT account/plan and only the missing sign-in/consent steps for the prepared route; administrator ownership alone does not supply every user's entitlement.
- Existing HTTPS hostname/tunnel account where available; the agent handles deployment and routing.
- Secure MCP Tunnel ownership/workspace access only if that optional transport is selected for a supported caller.
- Real-data consent and processing/retention choices after reviewing the agent's concrete proposal.
- A small genuine task list, meal choices and restrictions through private setup.
- Microphone/speaker participation and the real daily planning/reporting trial.

Database installation, application changes, authentication, commands, backup/restore, technical tests and deployment are engineering tasks. The account owner is not responsible for coding or manually running database migrations.

## Local ChatGPT connection helper

`npm run connect:chatgpt` starts the local, operator-only connection helper and prints its loopback address. Open that address on this computer, choose **Continue with ChatGPT**, and review OpenAI's actual account/plan consent screen. The callback uses `127.0.0.1`; a public tunnel is unnecessary for this sign-in. The helper is separate from My Day and must not be exposed through Tailscale, Cloudflare or an MCP tunnel.

This qualification uses the documented public-client OAuth flow and Responses endpoint. It requests identity and explicit ChatGPT-plan usage, keeps app-specific credentials encrypted under ignored `.local/` using the existing `SESSION_KEY`, and never borrows Cerberus or Codex credentials. Protect both the encrypted file and `.env.local`; encryption does not make a publicly readable key safe.

After sign-in, run the fixed synthetic **Sol-high connection test** from the helper. It uses `gpt-6-sol`, high effort and `store: false`, with one tiny fixed prompt, a 45-second local timeout and a response-size limit. The current plan preview does not support `max_output_tokens`: these safeguards are not a hard token/spend cap, and closing a connection does not prove that remote work stopped. Review allowance in ChatGPT usage settings. It has no care tools or real participant inputs. Successful sign-in alone does not establish model access. Only a validated completed response counts as this connection probe; interrupted, incomplete, quota-denied and wrong-model results remain failures. This does not select the production route or satisfy either S01 live scenario.

The helper does not enable the existing Realtime/Supabase application as the revised MVP. Remaining integration includes typed care tools, per-client account binding, independent speech, local PostgreSQL/authentication and the actual device's HTTPS route. Keep `reasoning_route.active_route` unset until the qualification contract is met.

Read-only routing inspection found an existing Tailscale connection and HTTPS configuration on this computer. This is a candidate for private device access, not a chosen or tested Nancy route. Preserve its existing services; identify the intended device and access scope before adding a route. No additional OpenAI MCP tunnel is required for the direct local OAuth/Responses probe.

## Local speech-output probe

`powershell.exe -NoProfile -File ./scripts/check-local-speech.ps1` generates a fixed synthetic Nancy sample using an installed Windows voice and writes a receipt plus WAV under ignored `.local/probes/`. The final October 4 authorized local run generated valid nonzero PCM using Zira: 6.939 seconds of audio in 53.9 ms of synthesis time. The initial sandboxed attempt was denied; no Windows security setting was changed to obtain the successful run.

This is a $0 incremental speech-output candidate, not a final voice selection or a conversation test. It opens no microphone and calls no remote speech service. Audible playback, the intended device, recognition accuracy, response latency and interruption behavior still need live qualification. Keep the WAV and full local receipt private; the public evidence contains only sanitized technical observations.
