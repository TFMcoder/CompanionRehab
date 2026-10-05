# Nancy connectivity and subscription qualification

Decision date: 2026-10-04, America/Toronto. The owner asked to revise the roadmap after identifying Cerberus's Secure MCP Tunnel and subscription-backed reasoning patterns. This updates the connectivity priority in the [canonical roadmap](../roadmap/roadmap.json), schema 1.4.0. The October 3 product, role, local-storage and exact model decisions remain in force.

## Selected direction

Qualify **existing ChatGPT-plan usage for `gpt-6-sol` with high reasoning first**, before asking for API funding. Adapt a small supported local reasoning adapter, using Codex app-server or a supported Responses integration after checking account and deployment eligibility. Keep the React My Day interface and the independent local care service. A ChatGPT-only interface or general OpenClaw integration is not selected.

This selects the next implementation and qualification path. It does not assert that Nancy currently uses a subscription, has completed inference or has working voice. The canonical `reasoning_route.active_route` and qualification evidence remain null until a route is actually qualified.

## Four separate connections

| Connection | Decision and qualification |
|---|---|
| Reasoning | Prefer an eligible existing ChatGPT plan. Verify the intended user/deployment, exact Sol/high completion, typed tool support, bounded usage, renewal/revocation and quota behavior. Use app-specific supported authentication; do not copy Cerberus credentials or assume one administrator subscription covers every client. |
| Speech | Independently qualify microphone/transcription and audible output. Compare available local and low-cost hosted options against clarity, latency, interruptions, privacy and cost. The documented plan-usage flow excludes audio input/transcription; no final speech model is selected by the earlier rejected API probe. |
| Care tools | Prefer server-owned functions or local MCP. Reuse Secure MCP Tunnel only if a concrete supported ChatGPT/Codex caller needs private local tools. It is optional and cannot replace care-service role/client authorization. Hosted MCP/connectors are unsupported on the documented ChatGPT-plan Responses flow. |
| Browser access | Independently qualify My Day HTTPS for the intended tablet/device. Evaluate the existing domain and free Cloudflare features first. Secure MCP Tunnel does not provide the public browser origin. |

OpenAI's [plan integration guide](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt), [Codex app-server guide](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) and [Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) support these distinctions. Local/open-source eligibility does not automatically establish eligibility for a paid or remotely hosted multi-user deployment; check the actual intended configuration.

## S01 execution order

1. Confirm account, intended-user and deployment eligibility; prepare only the missing sign-in/consent steps.
2. Prove bounded synthetic Sol-high reasoning and an authorized tool round trip using the chosen supported subscription adapter. A model catalog or metadata response is insufficient.
3. Prove independent speech input/output with synthetic audio and the actual intended microphone/speaker.
4. Integrate both with local PostgreSQL/auth, shared typed task/meal commands and My Day. Local database/UI work may proceed while external qualification is pending. Add an MCP tunnel only for a demonstrated caller need.
5. Run disposable S01-LIVE2 safety, provider/account-failure, permission, restart and isolated-restore checks. Then run S01-LIVE1's consented real 10 AM planning conversation.

S02 actual reporting, S03 recovery and S04 repeat-day check-ins retain their order. No infrastructure-only slice or dashboard prerequisite is added.

## Cost and human-action boundary

Reuse the saved private API key and existing access. If the subscription route cannot support the intended use, record the precise blocker and prepare the supported alternatives and costs. Separately billed API reasoning is an explicit owner decision; no automatic fallback, top-up, model substitution or subscription upgrade. Any funded speech path is reviewed independently. Track plan allowance and metered GPT costs separately; non-GPT speech and services remain inside the $50/month ceiling, with CAD as the planning default.

S01-H02 covers only missing sign-in/account consent, intended-user eligibility decisions, conditional API funding and conditional HTTPS/MCP ownership steps. Engineering, setup, runtime adaptation and testing stay with the agent. No human action or live gate is marked complete by this roadmap revision.

## Observed state

The [October 4 connection evidence](../evidence/S01-OPENAI-CONNECTION-2026-10-04.json) records successful private API-key model visibility and HTTP 429 responses from bounded reasoning and speech probes. No successful inference, generated audio or device trial occurred. Existing keys and private financial/account details remain outside the public repository. Cerberus source provenance and historical/current-runtime limitations are recorded in the [reuse assessment](CERBERUS_REUSE_ASSESSMENT.md).
