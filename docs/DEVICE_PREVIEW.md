# Smartphone interface test

The October 5 owner request selects a smartphone browser for the next device test. A dedicated My Day preview is available for layout, navigation, speaker playback and a short microphone/playback check. It displays synthetic sample tasks and meals, with meals projected from the same task identities. It does not save or accept plans, call GPT, access care records or expose account setup.

Use the HTTPS link provided in the active conversation. The operator keeps the current URL and process information in ignored `.local/runtime/device-preview.json`; the temporary hostname is not published in this repository. Open it directly in Safari or Chrome on the smartphone. No app installation is required for the public test link.

1. Open My Day and switch between the task and meal views. Check text size, spacing and touch controls.
2. Tap **Hear Nancy’s sample voice** and confirm you can hear the fixed Windows Zira sample.
3. Under **Voice for this preview**, audition the installed English voices that your browser exposes, choose a pace and tap **Preview selected voice**. Only voices reported as local are offered; remote browser voices are excluded. The selection applies to this preview and is not a saved client preference. If the browser has no local English voices, it says so and the fixed sample remains available.
4. Start the microphone check when ready, approve the phone browser's microphone prompt, speak a short test phrase, stop and play it back. Recording stops automatically after ten seconds. The recording remains only in browser memory; it is never uploaded. Leaving the view or closing the page stops capture and discards the recording. Starting another audio check stops the previous one.

The owner approved the interface on October 5. Voice suitability and microphone results have not yet been reported. This is a device preview, not Nancy's live planning conversation. Full S01 still requires authenticated care commands, local PostgreSQL, actual speech/reasoning integration and both live acceptance scenarios. Testing a desktop browser at a phone-sized viewport does not prove smartphone audio or usability. Device operating system/browser details remain to be supplied. The [conversational voice decision](architecture/VOICE_AND_DAILY_COMPANION_2026-10-05.md) records free voice candidates, turn-taking, wake-word limits and the requested daily workflows.

## Operator implementation

The preview has a separate Vite entry (`preview.html`) and a dedicated `scripts/device-preview.ts` server. It binds only to `127.0.0.1:8820` by default and deliberately does not load `.env.local` or import the care, authentication or provider runtimes. Only GET/HEAD routes for the preview, compiled assets, health and one pinned synthetic WAV are available. All mutation/upload requests are rejected. The content security policy prevents browser network connections, and camera/location permissions are denied.

Build with `npm run build`, then use `npm run preview:device`. Set `PREVIEW_SAMPLE_SHA256` to the verified digest of the existing synthetic `.local/probes/nancy-local-voice.wav`; otherwise the voice sample is explicitly unavailable. Never point it at participant audio. `PREVIEW_PUBLIC_ORIGIN` optionally allows an exact HTTPS host when the reverse proxy preserves the public Host header.

The temporary test route uses the official Cloudflare `cloudflared` client and a Quick Tunnel to this dedicated server, with `--http-host-header 127.0.0.1:8820`. The installed binary is kept under ignored `.local/tools`, its release digest is checked, and both processes run in hidden windows. Do not publish the main service or the ChatGPT OAuth helper through this preview route.

Quick Tunnels require no Cloudflare account/domain, have no uptime guarantee and change hostname after restart. The computer, preview process and tunnel process must remain running. They do not support Server-Sent Events, so this temporary UI test route does not select the eventual integrated conversation deployment. See [Cloudflare's Quick Tunnel documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

Anyone with the temporary URL can view these public-safe samples. The microphone recording is never sent to this PC or Cloudflare. Existing Tailscale/MCP routes are preserved. Before adding private data or provider access, use the application's real authentication and complete the selected deployment qualification; do not extend this public sample server into a care-data gateway.
