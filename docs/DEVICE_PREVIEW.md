# Smartphone interface test

The October 5 owner request selects a smartphone browser for the next device test. A dedicated My Day preview is available for layout, navigation, speaker playback and a short microphone/playback check. It displays synthetic sample tasks and meals, with meals projected from the same task identities. It does not save or accept plans, call GPT, access care records or expose account setup.

Use the HTTPS link provided in the active conversation. The operator keeps the current URL and process information in ignored `.local/runtime/device-preview.json`; the temporary hostname is not published in this repository. The confirmed target is **iPhone with Safari**. Open the link directly in Safari. No app installation is required for the public test link.

1. Open My Day and switch between the task and meal views. Check text size, spacing and touch controls.
2. In the Kokoro audition, compare **Heart**, **Bella** and **Emma** using the same script. Heart and Bella are American English voices; Emma is British English. Choose **Plan the day**, **Choose a meal** or **Revisit a task**, then tap the play button. Stop or change the selection to end playback. The text below the selectors is the exact synthetic script.
3. These nine clips were generated on the local PC using Kokoro-82M. Playback does not use the phone's installed voice engine. It is a pre-generated sound comparison, not a live conversation or a saved client preference. Older browser/Windows voices remain under a collapsed comparison section; they were rejected as production candidates.
4. Start the microphone check when ready, approve the phone browser's microphone prompt, speak a short test phrase, stop and play it back. Recording stops automatically after ten seconds. The recording remains only in browser memory; it is never uploaded. Leaving the view or closing the page stops capture and discards the recording. Starting another audio check stops the previous one.

The owner approved the interface on October 5. The owner subsequently rejected the preview voices as robotic; they are not accepted production voices. Microphone and integrated conversation acceptance remain pending. This is a device preview, not Nancy's live planning conversation. Full S01 still requires authenticated care commands, local PostgreSQL, actual speech/reasoning integration and both live acceptance scenarios. Testing a desktop browser at a phone-sized viewport does not prove smartphone audio or usability. Device/browser selection is confirmed; record the iOS version during the real-device test. The [conversational voice decision](architecture/VOICE_AND_DAILY_COMPANION_2026-10-05.md) records free voice candidates, turn-taking, wake-word limits and the requested daily workflows.

## Operator implementation

The preview has a separate Vite entry (`preview.html`) and a dedicated `scripts/device-preview.ts` server. It binds only to `127.0.0.1:8820` by default and deliberately does not load `.env.local` or import the care, authentication or provider runtimes. Only GET/HEAD routes for the preview, compiled assets, health and pinned synthetic WAVs are available. All mutation/upload requests are rejected. The content security policy prevents browser network connections, and camera/location permissions are denied.

Build with `npm run build`, then use `npm run preview:device`. Set `PREVIEW_SAMPLE_SHA256` to the verified digest of the existing synthetic `.local/probes/nancy-local-voice.wav`; otherwise the voice sample is explicitly unavailable. Never point it at participant audio. `PREVIEW_PUBLIC_ORIGIN` optionally allows an exact HTTPS host when the reverse proxy preserves the public Host header.

### Local Kokoro audition

Install the isolated runtime in ignored storage; it is not a production care-service dependency:

```powershell
npm install --prefix .local/speech/kokoro-runtime --save-exact kokoro-js@1.2.1 @huggingface/transformers@3.8.1 phonemizer@1.2.1 onnxruntime-node@1.21.0 --no-audit --no-fund
node node_modules/tsx/dist/cli.mjs scripts/generate-kokoro-samples.ts
```

The generator uses only `src/shared/kokoro-samples.ts`, never participant input. It downloads the ONNX model at commit `1939ad2a8e416c0acfeecc08a694d14ef25f2231` on first use and then uses the local cache. Synthesis runs on CPU in fp32 with four inference threads and normal speed. The manifest records dependency versions, the runtime lock digest, bundled voice hashes, output hashes, duration and actual generation time. Only clips whose peaks exceed the PCM range receive uniform gain reduction; phrasing and speed are unchanged. Weights, dependency lock, WAVs and receipts remain under ignored `.local/`.

Set `PREVIEW_KOKORO_MANIFEST_SHA256` to the printed manifest digest before starting the preview server. It verifies `.local/probes/kokoro/manifest.json` and all nine exact catalogue filenames before listening. It rejects changed hashes, duplicate/unknown entries, path escapes and oversized files. Known clips return 503 when not configured; unknown routes return 404. Byte-range requests support mobile media playback. Restart only the preview server after generating a new catalogue; the existing tunnel can stay running.

This is local inference with no paid speech API. The [upstream Kokoro implementation](https://github.com/hexgrad/kokoro) and [ONNX model](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) publish Apache-2.0 licenses. Keep dependency notices, including the bundled eSpeak phonemizer, with the isolated runtime; packaging/distribution qualification is separate from this local audition. [Audition evidence](evidence/S01-KOKORO-AUDITION-2026-10-05.json) records actual results and remaining phone/human acceptance.

The temporary test route uses the official Cloudflare `cloudflared` client and a Quick Tunnel to this dedicated server, with `--http-host-header 127.0.0.1:8820`. The installed binary is kept under ignored `.local/tools`, its release digest is checked, and both processes run in hidden windows. Do not publish the main service or the ChatGPT OAuth helper through this preview route.

Quick Tunnels require no Cloudflare account/domain, have no uptime guarantee and change hostname after restart. The computer, preview process and tunnel process must remain running. They do not support Server-Sent Events, so this temporary UI test route does not select the eventual integrated conversation deployment. See [Cloudflare's Quick Tunnel documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

Anyone with the temporary URL can view these public-safe samples. The microphone recording is never sent to this PC or Cloudflare. Existing Tailscale/MCP routes are preserved. Before adding private data or provider access, use the application's real authentication and complete the selected deployment qualification; do not extend this public sample server into a care-data gateway.
