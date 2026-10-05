"""Isolated, fixed-text Pocket benchmark and cancellable warm NDJSON worker.

No user text, microphone, care data, credentials, network listener or paid API.
Weights/configs and voice embeddings are revision-pinned by pocket-tts 3.3.0.
The non-cloning checkpoint is selected explicitly; no gated-model fallback.
"""
import argparse
import base64
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import queue
import sys
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("HF_HOME", str(ROOT / ".local/speech/pocket-cache"))
os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
CATALOG = json.loads((ROOT / "src/shared/voice-evaluation.json").read_text("utf-8"))
TEXTS = {s["id"]: s["text"] for s in CATALOG["samples"]}
VOICES = ("alba", "anna")
PRINT_LOCK = threading.Lock()


def speakable_text(text):
    # English audition ASR flagged curly contractions and colon clock notation.
    # Only these fixed synthetic catalogue clocks are expanded here. In the care
    # application, render times from validated typed values, never guess a time.
    text = text.replace("’", "'").replace("‘", "'")
    return text.replace("2:30 PM", "two thirty P M").replace("1:45", "one forty-five")


def emit(event):
    with PRINT_LOCK:
        print(json.dumps(event, separators=(",", ":")), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--threads", type=int, choices=(2, 4, 8), default=2)
    parser.add_argument("--voices", nargs="+", choices=VOICES, default=["alba", "anna"])
    parser.add_argument("--samples", nargs="+", choices=list(TEXTS), default=list(TEXTS))
    parser.add_argument("--repeats", type=int, choices=(1, 3), default=1)
    parser.add_argument("--output", default=".local/probes/voice-eval/pocket")
    args = parser.parse_args()
    start = time.perf_counter()
    import numpy as np
    import soundfile as sf
    import torch
    import pocket_tts
    from pocket_tts import TTSModel
    if importlib.metadata.version("pocket-tts") != "3.3.0":
        raise RuntimeError("Expected pinned pocket-tts 3.3.0")
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    torch.manual_seed(42)
    package_config = Path(pocket_tts.__file__).parent / "config/english_2026-09.yaml"
    config_text = package_config.read_text("utf-8")
    full_weights = "hf://kyutai/pocket-tts/languages/english_2026-09/model.safetensors@983151f13aaeab1b13c1e5e3c2c383d49a9edf3f"
    weights = "hf://kyutai/pocket-tts-without-voice-cloning/languages/english_2026-09/model.safetensors@e7205b6ee50e654a5ea19f0e9df2b0813b05e921"
    if full_weights not in config_text or weights not in config_text:
        raise RuntimeError("Package config changed; requalify pins")
    config_dir = ROOT / ".local/speech/pocket-config"
    config_dir.mkdir(parents=True, exist_ok=True)
    config = config_dir / "english_2026-09.yaml"
    config.write_text(config_text.replace(full_weights, weights), encoding="utf-8")
    # Suppress optional package stdout so NDJSON remains unambiguous.
    from contextlib import redirect_stdout
    with redirect_stdout(sys.stderr):
        model = TTSModel.load_model(config=config, temp=0.3, sampler_decode_steps=1)
        states = {voice: model.get_state_for_audio_prompt(
            f"hf://kyutai/pocket-tts-without-voice-cloning/languages/english_2026-09/embeddings/{voice}.safetensors@4e1e0a3e611c51c0b4ed8174fc10f32a54644303"
        ) for voice in args.voices}
    load_ms = round((time.perf_counter() - start) * 1000, 2)
    runtime = {name: importlib.metadata.version(name) for name in ("pocket-tts", "torch", "numpy", "soundfile", "huggingface-hub")}

    def generate(voice, sample, trace, stop, stream=False):
        accepted = time.perf_counter()
        chunks, timeline = [], []
        if stream:
            emit({"type": "accepted", "trace": trace, "rate": model.sample_rate})
        with redirect_stdout(sys.stderr) if not stream else redirect_stdout(sys.stdout):
            for chunk in model.generate_audio_stream(states[voice], speakable_text(TEXTS[sample]), copy_state=True, stop=stop):
                elapsed = round((time.perf_counter() - accepted) * 1000, 2)
                pcm = chunk.detach().cpu().numpy().astype("<f4")
                if stop.is_set():
                    break
                if not np.isfinite(pcm).all() or len(pcm) > model.sample_rate * 5:
                    raise RuntimeError("Invalid model audio")
                timeline.append({"at_ms": elapsed, "samples": len(pcm)})
                chunks.append(pcm)
                if stream:
                    # Fixed per-voice audition gain; a final safety clamp bounds unforeseen peaks.
                    # Matched prerecorded comparisons use whole-clip RMS normalization instead.
                    delivery_pcm = np.clip(pcm * 0.8, -0.98, 0.98).astype("<f4")
                    emit({"type": "audio", "trace": trace, "seq": len(chunks)-1, "model_elapsed_ms": elapsed,
                          "pcm": base64.b64encode(delivery_pcm.tobytes()).decode("ascii")})
                if sum(len(c) for c in chunks) > model.sample_rate * 60:
                    stop.set()
        elapsed = round((time.perf_counter() - accepted) * 1000, 2)
        result = {"trace": trace, "voice": voice, "sample": sample, "first_chunk_ms": timeline[0]["at_ms"] if timeline else None,
                  "generation_ms": elapsed, "duration_seconds": sum(len(c) for c in chunks)/model.sample_rate,
                  "chunks": timeline, "cancelled": stop.is_set()}
        result["synthesis_text"] = speakable_text(TEXTS[sample])
        if stream:
            emit({"type": "cancelled" if stop.is_set() else "complete", "trace": trace,
                  "generation_ms": elapsed, "first_chunk_ms": result["first_chunk_ms"], "chunks": len(chunks)})
        return result, np.concatenate(chunks) if chunks else np.empty(0, dtype="float32")

    if args.serve:
        # Pay lazy kernel/setup cost before reporting readiness, never during Dad's first reply.
        warm_started = time.perf_counter()
        generate(args.voices[0], "water", "startup-warmup", threading.Event())
        warmup_ms = round((time.perf_counter() - warm_started) * 1000, 2)
        torch.manual_seed(42)
        jobs = queue.Queue(maxsize=1)
        active = {"trace": None, "stop": None}
        lock = threading.Lock()
        def reader():
            for line in sys.stdin:
                try:
                    if len(line) > 1024:
                        continue
                    message = json.loads(line)
                    trace = message.get("trace")
                    if not isinstance(trace, str) or len(trace) > 64:
                        continue
                    with lock:
                        if message.get("type") == "cancel" and active["trace"] == trace:
                            active["stop"].set()
                        elif message.get("type") == "start":
                            if message.get("voice") not in states or message.get("sample") not in TEXTS or active["trace"]:
                                emit({"type": "error", "trace": trace, "code": "busy_or_invalid"})
                                continue
                            active.update(trace=trace, stop=threading.Event())
                            jobs.put_nowait(message)
                except (ValueError, queue.Full, AttributeError):
                    continue
            with lock:
                if active["stop"]:
                    active["stop"].set()
            jobs.put(None)
        threading.Thread(target=reader, daemon=True).start()
        emit({"type": "ready", "load_ms": load_ms, "warmup_ms": warmup_ms, "runtime": runtime, "threads": args.threads})
        while True:
            job = jobs.get()
            if job is None:
                break
            try:
                generate(job["voice"], job["sample"], job["trace"], active["stop"], True)
            except Exception as error:
                emit({"type": "error", "trace": job["trace"], "code": type(error).__name__})
            finally:
                with lock:
                    active.update(trace=None, stop=None)
        return

    output = (ROOT / args.output).resolve()
    if not output.is_relative_to(ROOT / ".local/probes"):
        raise RuntimeError("Output must stay in ignored local probes")
    output.mkdir(parents=True, exist_ok=True)
    results = []
    for voice in args.voices:
        for sample in args.samples:
            for repeat in range(args.repeats):
                result, pcm = generate(voice, sample, str(uuid.uuid4()), threading.Event())
                if not len(pcm) or result["cancelled"]:
                    raise RuntimeError("Empty or overlong generation")
                rms, peak = float(np.sqrt(np.mean(pcm**2))), float(np.max(np.abs(pcm)))
                # Uniform gain only; matched target RMS, peak-safe, no pitch/time changes.
                gain = min(0.1 / max(rms, 1e-9), 0.98 / max(peak, 1e-9))
                filename = f"{voice}-{sample}-{repeat+1}.wav"
                sf.write(output / filename, pcm * gain, model.sample_rate, subtype="PCM_16")
                result.update(file_name=filename, sha256=hashlib.sha256((output / filename).read_bytes()).hexdigest(),
                              raw_rms=rms, raw_peak=peak, output_gain=gain, repeat=repeat+1,
                              real_time_factor=result["generation_ms"]/1000/result["duration_seconds"])
                results.append(result)
                emit({k: v for k, v in result.items() if k != "chunks"})
    receipt = {"model": "Pocket TTS", "checkpoint": weights, "language": "english_2026-09", "runtime": runtime,
               "precision": "fp32", "device": "cpu", "threads": args.threads, "interop_threads": 1,
               "temperature": 0.3, "sampler_decode_steps": 1, "eos_threshold": -4, "seed": 42,
               "load_including_download_ms": load_ms, "streaming": "native waveform; complete text input",
               "text_normalization": "ASCII apostrophes; fixed catalogue clocks verbalized without changing their values",
               "data_origin": CATALOG["data_origin"], "samples": results}
    (output / "manifest.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    emit({"type": "finished", "load_ms": load_ms, "samples": len(results)})


if __name__ == "__main__":
    main()
