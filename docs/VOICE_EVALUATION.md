# Voice evaluation runbook

This runbook generates a repeatable set of synthetic speech examples for local audition and latency screening. The only text inputs are the 11 fixtures in [`src/shared/voice-evaluation.json`](../src/shared/voice-evaluation.json). Do not add participant speech, care details, or transcripts. We have not accepted a production voice, and the S01 live gate has not passed.

Run only one model at a time. The host has 16 GB RAM, an AMD Ryzen 7 8845HS, and an RTX 4050 with 6 GB VRAM. Cold loading, model download and generation compete for memory and CPU. Keep each model's output directory and manifest; do not compare a cached repeat against another model's cold start. The commands below use the portable Python 3.11.17 and `uv` copies under ignored `.local/`; they do not change system Python or global packages.

## Pocket TTS on CPU

The qualified runtime is Python 3.11.17, `pocket-tts==3.3.0`, `torch==2.10.0+cpu`, NumPy 2.4.6, SoundFile 0.13.1 and Hugging Face Hub 1.33.0. Inference was measured on CPU with 2 Torch intra-op threads and 1 inter-op thread. The English model is `english_2026-09`; the script replaces the standard cloning checkpoint with the pinned **without-voice-cloning** checkpoint (`e7205b6ee50e654a5ea19f0e9df2b0813b05e921`) and pins both voice embeddings (`4e1e0a3e611c51c0b4ed8174fc10f32a54644303`). It does not fall back to another model.

If the portable runtime has already been provisioned, skip the bootstrap lines. Otherwise use the existing system Python only to place the pinned `uv` package into ignored storage, then use uv to install portable Python. No global package installation is required. Create the isolated venv and install the pinned CPU runtime:

```powershell
$root = (Get-Location).Path
$uv = Join-Path $root '.local/tools/uv-runtime/bin/uv.exe'
if (-not (Test-Path $uv)) {
  python -m pip install --no-cache-dir --disable-pip-version-check --target (Join-Path $root '.local/tools/uv-runtime') 'uv==0.12.23'
}
$env:UV_CACHE_DIR = (Join-Path (Get-Location) '.local/speech/uv-cache')
$env:UV_PYTHON_INSTALL_DIR = (Join-Path $root '.local/speech/python')
& $uv python install 3.11.17
$py311 = (Resolve-Path .local/speech/python/cpython-3.11.17-windows-x86_64-none/python.exe).Path
& $uv venv --python $py311 .local/speech/pocket-eval
$pocketPython = (Join-Path (Get-Location) '.local/speech/pocket-eval/Scripts/python.exe')
& $uv pip install --python $pocketPython --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple -r scripts/voice-eval-pocket.requirements.txt
```

Generate both voices across all fixtures once, then get three repeats of the short water question and long conversation for Alba at two threads:

```powershell
& $pocketPython scripts/pocket-voice-eval.py --threads 2 --voices alba anna --output .local/probes/voice-eval/pocket
& $pocketPython scripts/pocket-voice-eval.py --threads 2 --voices alba --samples water long --repeats 3 --output .local/probes/voice-eval/pocket-normalized-repeats
```

The first command produces 22 WAVs; the second produces six. The manifest records versions, checkpoint and voice pins, precision, thread counts, cold-load time, per-chunk timings, full generation time, real-time factor and file hashes. Pocket accepts the complete text before generation, then yields audio chunks. Its measured first chunk is a valid audio-streaming timing; it does not measure incremental text input. The fixed fixture “Your appointment is on October seventh, at 2:30 PM. Let’s leave at 1:45...” is synthesized with curly apostrophes converted to ASCII and those two clock strings spoken as “two thirty P M” and “one forty-five”; the numeric values do not change. This exception exists only for the fixed audition catalogue. The model keeps warm voice states within the process. The preview worker starts with `--serve`, runs a discarded water-phrase warmup after loading the pinned model and voices, and announces readiness only after that warmup; it reports load and warmup durations separately.

## Kokoro CPU baseline

The matched baseline uses only Heart (`af_heart`), speed 1, fp32, CPU, 4 intra-op and 1 inter-op threads. The pinned model is `onnx-community/Kokoro-82M-v1.0-ONNX` at revision `1939ad2a8e416c0acfeecc08a694d14ef25f2231`.

Install and run the matched 11-fixture baseline:

```powershell
npm install --prefix .local/speech/kokoro-runtime --save-exact kokoro-js@1.2.1 @huggingface/transformers@3.8.1 phonemizer@1.2.1 onnxruntime-node@1.21.0 --no-audit --no-fund
node node_modules/tsx/dist/cli.mjs scripts/benchmark-kokoro-voice.ts
```

This yields 15 WAVs: one pass for each fixture, with three passes each for water and long. The manifest separates import time, model-load time and total cold load including imports. Kokoro returns a full utterance, so the recorded first-model-audio time equals full-utterance generation time; this is not streaming latency. `scripts/generate-kokoro-samples.ts` separately regenerates the earlier nine-clip audition (Heart, Bella, Emma; three selected scripts) under `.local/probes/kokoro/`.

## Chatterbox Nano

Nano has a separate isolated environment. Its frozen runtime uses Python 3.11.17, `chatterbox-tts==0.1.7` from source commit `5de7a54aa4e5e2baadb0182dde554908b48b85c2`, `torch==2.6.0+cu124`, `torchaudio==2.6.0+cu124`, fp32, four Torch CPU threads and one inter-op thread. The source commit is essential: the published PyPI package with the same version lacked Nano support. The complete frozen dependency list is [`voice-eval-nano.requirements.txt`](../scripts/voice-eval-nano.requirements.txt); it includes `setuptools==80.9.0` for the Perth `pkg_resources` dependency. Preserve manifests as the evidence for the exact runtime, device, CUDA memory and results of each run.

Create the CUDA venv separately from Pocket. The CUDA wheel index supplies the `+cu124` PyTorch pair; PyPI supplies the remaining pinned packages:

```powershell
& $uv venv --python $py311 .local/speech/nano-eval
$nanoPython = (Join-Path $root '.local/speech/nano-eval/Scripts/python.exe')
& $uv pip install --python $nanoPython --index-url https://download.pytorch.org/whl/cu124 --extra-index-url https://pypi.org/simple -r scripts/voice-eval-nano.requirements.txt
```

Using that environment, first download and checksum the pinned weights and licensed reference without loading the model, then run three repeats each of the short and long fixtures on CUDA:

```powershell
$nanoPython = '.local/speech/nano-eval/Scripts/python.exe'
& $nanoPython scripts/nano-voice-eval.py prepare --threads 4
& $nanoPython scripts/nano-voice-eval.py evaluate --device cuda --threads 4 --samples water long --repeats 3
```

The model checkpoint is revision `71ccd1d0081b430592cea481f4307e764e07bc64`. For an isolated CPU comparison, use the same environment with `--device cpu`; outputs go under `nano-cpu` unless `--output` is specified. The code takes complete text and returns a complete waveform; it has no first-audio streaming measure, so its `first_audio_ms` field equals full generation time. The script uses Alba MacKenna's licensed reference recording to condition the voice; it does not use a participant recording. Use `--offline` only after `prepare` has populated the exact pinned cache.

## Offline ASR intelligibility screen

`scripts/check-voice-eval-asr.py` runs the pinned local `Systran/faster-whisper-small.en` model (commit `d1d751a5f8271d482d14ca55d9e2deeebbae577f`) on CPU/int8 with four threads. It expects the already-populated cache under `.local/speech/runtime/model-cache`; it performs no cloud request. The isolated ASR venv can be bootstrapped with the same Python and uv variables above:

```powershell
& $uv venv --python $py311 .local/speech/runtime/venv
$asrPython = (Join-Path $root '.local/speech/runtime/venv/Scripts/python.exe')
& $uv pip install --python $asrPython --only-binary=:all: 'faster-whisper==1.2.1' 'ctranslate2==4.8.2' 'av==18.1.0' 'huggingface-hub==1.33.0'
```

If the pinned ASR snapshot is not yet cached, download that exact revision once (this uses the local Hugging Face Hub package and public model, with no login):

```powershell
& $asrPython -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='Systran/faster-whisper-small.en', revision='d1d751a5f8271d482d14ca55d9e2deeebbae577f', cache_dir='.local/speech/runtime/model-cache')"
```

Run after the target WAV manifests have been generated. `--directories` takes folder names under `.local/probes/voice-eval`; it transcribes the first repeat (`*-1.wav`) in each. Use only folders that exist. The receipt stays under the ignored probe directory:

```powershell
& $asrPython scripts/check-voice-eval-asr.py --directories pocket-2threads kokoro nano qwen --output asr-20261005.json
```

The default `--models pocket kokoro nano qwen` scans their default folders; use `--directories` to compare named experiment folders such as `pocket-raw` and `pocket-normalized-screen`. The receipt records each recognized transcript locally, exact-match after lowercase/punctuation normalization, and a word-sequence similarity ratio. These are screening signals, not WER, forced alignment, naturalness, comprehensibility, or a hearing test. ASR may disagree because of contractions, spoken time expansion or punctuation conventions; review the audio and text together before interpreting a mismatch. The October 5 narrow normalization screen removed the flagged contraction and clock-value mismatches in six retest clips. The subsequent full 22-clip Pocket catalogue had 19 normalized exact matches; the remaining three differ only in omelet/omelette spelling or date/time formatting, with correct numerical values. This is an ASR screening result, not human voice acceptance. Raw pre-normalization evidence is preserved separately.

Complete dependency snapshots are saved in [`voice-eval-pocket.requirements.txt`](../scripts/voice-eval-pocket.requirements.txt) and [`voice-eval-nano.requirements.txt`](../scripts/voice-eval-nano.requirements.txt). Pocket requires the PyTorch CPU index for its `+cpu` wheel; Nano requires `https://download.pytorch.org/whl/cu124` for its CUDA wheels. Retain the exact source commit when installing Nano; no global Python packages were changed.

## Qwen official demo

The only Qwen samples were made manually through the [official Qwen3-TTS Space](https://huggingface.co/spaces/Qwen/Qwen3-TTS), selecting its Serena English CustomVoice and entering the fixed water and long fixture text with the prompt instructions in the receipt. Download the two complete WAVs into `.local/probes/voice-eval/qwen/` as `serena-water-raw.wav` and `serena-long-raw.wav`, then package them:

```powershell
.local/speech/pocket-eval/Scripts/python.exe scripts/package-qwen-demo.py
```

This step only normalizes and hashes the downloaded audio; it runs no inference. The official model family and source repository are Apache-2.0, but the Space's deployed checkpoint/runtime revision has not been pinned. The manifest therefore marks runtime provenance and latency as unverified/unmeasured. It records only demo completion and complete-waveform availability, not a model timing.

## Shared audio packaging and preview

The matched voice-evaluation WAVs from Pocket, Kokoro, Nano and Qwen use uniform gain toward RMS 0.1, reduced as needed to keep peak at or below 0.98, then PCM 16-bit. This changes level only; it does not alter pitch or playback speed. The earlier nine-clip Kokoro audition is peak-safe only (it does not target RMS). Live Pocket preview chunks use a separate fixed 0.8 gain with a peak clamp; they are not the normalized benchmark WAVs. Keep raw and normalized Qwen downloads distinct.

After all desired local manifests exist, package only the first repeat of each fixture for the browser audition:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/package-voice-eval.ts
```

Build and launch the read-only synthetic preview with the printed evaluation-manifest SHA-256. `PREVIEW_EVALUATION_SHA256` enables the packaged matched WAVs, `PREVIEW_KOKORO_MANIFEST_SHA256` enables the older nine-clip Kokoro audition, and `PREVIEW_POCKET_STREAM=1` enables the live synthetic Pocket WebSocket. The stream starts a separate worker with the isolated Pocket Python, loads only cached pinned files (`HF_HUB_OFFLINE=1`), and warms a discarded water phrase before reporting ready. Startup load and warmup measurements are available separately from request timings. This is Pocket on CPU; Nano has no live route here. The stream accepts only fixed fixture IDs and the `alba`/`anna` choices. `PREVIEW_PUBLIC_ORIGIN` must be the exact HTTPS origin that users open; Quick Tunnel requires forwarding the original local Host header:

```powershell
npm run build
$env:PREVIEW_SAMPLE_SHA256 = '<verified synthetic sample SHA-256>'
$env:PREVIEW_EVALUATION_SHA256 = '<printed PREVIEW_EVALUATION_SHA256>'
$env:PREVIEW_KOKORO_MANIFEST_SHA256 = '<printed PREVIEW_KOKORO_MANIFEST_SHA256>'
$env:PREVIEW_POCKET_STREAM = '1'
$env:PREVIEW_PUBLIC_ORIGIN = 'https://<current-quick-tunnel-host>'
npm run preview:device
```

Run the temporary Cloudflare tunnel in a separate terminal:

```powershell
& .local/tools/cloudflared-2026.9.3.exe tunnel --url http://127.0.0.1:8820 --http-host-header 127.0.0.1:8820
```

The URL is temporary, anyone holding it can access the synthetic clips, and neither the tunnel nor preview server is an authenticated care-data route. A Quick Tunnel provides no uptime guarantee. See [`docs/DEVICE_PREVIEW.md`](DEVICE_PREVIEW.md) for the operator boundaries and the actual iPhone/Safari checks. Do not send personal or care text to any public demo.

To reproduce worker cancellation separately from browser rendering, set the exact already-approved preview origin and run the fixed-script probe. It requests the long Alba sample, cancels after ten native chunks, checks the cancellation terminal and starts a recovery water question. It stores no PCM or arbitrary text:

```powershell
$env:PREVIEW_PROBE_ORIGIN = 'https://<current-quick-tunnel-host>'
node node_modules/tsx/dist/cli.mjs scripts/probe-voice-stream.ts
```

For browser timings, tap Connect once, then run three short and three long repeats through the public URL. Download each timing record after the sample finishes; test Stop during generation separately. The live test measures synthetic text availability to browser-rendered audio, not a microphone-to-meaningful-answer conversation. The local ChatGPT-plan setup helper also offers a three-prompt first-speakable timing probe; it uses the existing app-authorized account and selected Sol/high, and records only timings/status/usage under ignored storage.

## Reading results

Use medians and min–max ranges for repeated timings; samples are too few to report percentiles or claim stable service latency. Include the repeat count, cold/warm state, device, thread count and whether a figure means first audio or complete audio. Treat each model's actual manifest as the source of truth for revisions and runtime. Do not infer results for runs that were not made.

Human listening and the intended iPhone/Safari test remain pending for these newer samples. Playback or a successful download is not voice acceptance. No S01 live acceptance gate is passed by this runbook.

## License and attribution notes

Keep the relevant license files and attribution with any retained or distributed audio/model artifacts. The repository stores only synthetic experiment code and sanitized references; the local checkpoints, raw audio and manifests stay in ignored `.local/` storage.

- **Pocket TTS:** the Python project code is MIT; the selected [without-voice-cloning checkpoint](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning) is separately declared CC BY 4.0. The selected `alba` reference is `alba-mackenna/casual.wav`, voice-acted by Alba MacKenna and released CC BY 4.0; credit “Alba MacKenna; Kyutai tts-voices.” The selected `anna` reference resolves in official code to `vctk/p228_023_enhanced.wav`; the VCTK portion of the voice repository declares CC BY 4.0. Individual voice terms are documented in the [Kyutai voice repository](https://huggingface.co/kyutai/tts-voices) and mapped in [Pocket's official voice-reference code](https://github.com/kyutai-labs/pocket-tts/blob/main/pocket_tts/utils/utils.py); do not assume all voices share one license.
- **Kokoro:** `kokoro-js` and the pinned ONNX model repository declare Apache-2.0. Preserve the package-lock and third-party notices, including the phonemizer/eSpeak dependency notices, if redistributing.
- **Chatterbox Nano:** the pinned source code and model repository declare MIT. The Alba reference recording is CC BY 4.0 and needs the same Alba/Kyutai attribution above.
- **Qwen:** the Qwen3-TTS model repository declares Apache-2.0. The shared demo's exact deployed weights and runtime are unpinned in this evaluation, so keep that provenance limitation with the WAV receipt.
- **Azure Speech F0:** the service is hosted and proprietary; no model files or audio were tested here. F0 is listed as 500,000 neural TTS characters per month free, with the separate real-time limit of 20 transactions per 60 seconds and 10 minutes per request. Creating a Speech resource still requires an Azure subscription. New Azure free-account signup requires account/phone/card verification and may place a temporary authorization hold. No subscription/resource was created; account eligibility and deployment terms are unqualified. If the owner later asks to trial it, use an F0 resource and avoid accidental S0/pay-as-you-go selection. See [Azure pricing](https://azure.microsoft.com/en-us/pricing/details/speech/), [official TTS quotas](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits), [Jenny voice styles](https://learn.microsoft.com/en-us/azure/cognitive-services/speech-service/language-support?tabs=stt), and [Azure signup details](https://learn.microsoft.com/en-us/training/modules/create-an-azure-account/1-introduction).
- **Hugging Face ZeroGPU:** the Qwen demo is a shared public demo, not a dependable Nancy speech endpoint. Official docs list 2 GPU-minutes/day for unauthenticated users and 5 minutes/day for free accounts; queue priority depends on remaining quota, and public Gradio Spaces can return results through queue-based APIs. Dynamic allocation and shared quota mean queue/cold-start/availability behavior must be treated as variable. The demo runtime was not pinned, its two clips were not latency-timed, and the account quota in effect was not checked. See [ZeroGPU quotas and queue priority](https://huggingface.co/docs/hub/main/spaces-zerogpu) and [Spaces API queue behavior](https://huggingface.co/docs/hub/en/spaces-api-endpoints).
