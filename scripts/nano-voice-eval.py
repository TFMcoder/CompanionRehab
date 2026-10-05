"""Revision-pinned, synthetic-only Chatterbox Nano voice evaluation.

`prepare` downloads the official checkpoint subset and licensed reference audio,
without loading the model. `evaluate` runs fixed catalog text on CPU. Both keep
all downloads and generated audio under the ignored .local directory.
"""

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".local/speech/nano-cache"
os.environ.setdefault("HF_HOME", str(CACHE))
os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_DISABLE_XET"] = "1"

MODEL_REPO = "ResembleAI/chatterbox-nano"
MODEL_REVISION = "71ccd1d0081b430592cea481f4307e764e07bc64"
SOURCE_COMMIT = "5de7a54aa4e5e2baadb0182dde554908b48b85c2"
MODEL_FILES = (
    "ve.safetensors",
    "t3_nano_v1.safetensors",
    "s3gen_meanflow.safetensors",
    "added_tokens.json",
    "merges.txt",
    "special_tokens_map.json",
    "tokenizer_config.json",
    "vocab.json",
)
REFERENCE_REPO = "kyutai/tts-voices"
REFERENCE_REVISION = "a73033b41726c0ae2f11647b426f04088ef8bb60"
REFERENCE_FILE = "alba-mackenna/casual.wav"
REFERENCE_SHA256 = "46264e83cb99115c3d210260e029117566d9c64f20266d10daa78107759ede3e"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def prepare(offline: bool) -> tuple[Path, Path]:
    from huggingface_hub import hf_hub_download, snapshot_download

    model_dir = Path(snapshot_download(
        repo_id=MODEL_REPO,
        revision=MODEL_REVISION,
        allow_patterns=list(MODEL_FILES),
        local_files_only=offline,
    ))
    missing = [name for name in MODEL_FILES if not (model_dir / name).is_file()]
    if missing:
        raise RuntimeError(f"Incomplete pinned Nano checkpoint: {missing}")
    if (model_dir / "conds.pt").exists():
        raise RuntimeError("Unexpected built-in voice in selected checkpoint directory")

    reference = Path(hf_hub_download(
        repo_id=REFERENCE_REPO,
        revision=REFERENCE_REVISION,
        filename=REFERENCE_FILE,
        local_files_only=offline,
    ))
    actual_hash = sha256(reference)
    if actual_hash != REFERENCE_SHA256:
        raise RuntimeError(f"Alba reference checksum mismatch: {actual_hash}")
    return model_dir, reference


def main() -> None:
    catalog = json.loads((ROOT / "src/shared/voice-evaluation.json").read_text("utf-8"))
    texts = {sample["id"]: sample["text"] for sample in catalog["samples"]}
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "evaluate"))
    parser.add_argument("--offline", action="store_true", help="Use only pinned cached files")
    parser.add_argument("--threads", type=int, choices=(2, 4, 8), default=4)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--samples", nargs="+", choices=list(texts), default=["water", "long"])
    parser.add_argument("--repeats", type=int, choices=(1, 3), default=1)
    parser.add_argument("--repeat-samples", nargs="+", choices=list(texts), default=None)
    parser.add_argument("--output", default=None)
    args = parser.parse_args()

    distribution = importlib.metadata.distribution("chatterbox-tts")
    if distribution.version != "0.1.7":
        raise RuntimeError("Expected pinned chatterbox-tts 0.1.7")
    direct_url = distribution.read_text("direct_url.json")
    if not direct_url or json.loads(direct_url).get("vcs_info", {}).get("commit_id") != SOURCE_COMMIT:
        raise RuntimeError("Expected pinned Nano-enabled official source commit")
    model_dir, reference = prepare(args.offline)
    print(json.dumps({
        "type": "prepared", "source_commit": SOURCE_COMMIT, "model_revision": MODEL_REVISION,
        "model_bytes": sum((model_dir / name).stat().st_size for name in MODEL_FILES),
        "reference_revision": REFERENCE_REVISION,
        "reference_sha256": REFERENCE_SHA256,
    }), flush=True)
    if args.action == "prepare":
        return

    import numpy as np
    import soundfile as sf
    import torch
    from chatterbox.tts_turbo import ChatterboxTurboTTS

    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    torch.manual_seed(42)
    if args.device == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA requested but unavailable in pinned PyTorch runtime")
        cuda_free_before, cuda_total = torch.cuda.mem_get_info()
        if cuda_free_before < 3 * 1024 ** 3:
            raise RuntimeError(f"CUDA free memory too low for Nano trial: {cuda_free_before} bytes")
        torch.cuda.manual_seed_all(42)
    else:
        cuda_free_before = cuda_total = None
    load_start = time.perf_counter()
    model = ChatterboxTurboTTS.from_local(model_dir, device=args.device, nano=True)
    model.prepare_conditionals(reference)
    if args.device == "cuda":
        torch.cuda.synchronize()
    load_ms = round((time.perf_counter() - load_start) * 1000, 2)
    output_arg = args.output or (
        ".local/probes/voice-eval/nano" if args.device == "cuda"
        else ".local/probes/voice-eval/nano-cpu"
    )
    output = (ROOT / output_arg).resolve()
    if not output.is_relative_to((ROOT / ".local/probes").resolve()):
        raise RuntimeError("Output must stay in ignored local probes")
    output.mkdir(parents=True, exist_ok=True)
    runtime = {name: importlib.metadata.version(name) for name in (
        "chatterbox-tts", "torch", "torchaudio", "transformers", "numpy", "soundfile", "huggingface-hub"
    )}
    results = []
    for sample_id in args.samples:
        count = args.repeats if args.repeat_samples is None or sample_id in args.repeat_samples else 1
        for repeat in range(1, count + 1):
            if args.device == "cuda":
                torch.cuda.synchronize()
                torch.cuda.reset_peak_memory_stats()
            started_ns = time.perf_counter_ns()
            trace_id = str(uuid.uuid4())
            waveform = model.generate(texts[sample_id])
            if args.device == "cuda":
                torch.cuda.synchronize()
            returned_ns = time.perf_counter_ns()
            generation_ms = round((returned_ns - started_ns) / 1_000_000, 2)
            pcm = waveform.detach().cpu().numpy().reshape(-1).astype("float32")
            if not len(pcm) or not np.isfinite(pcm).all() or len(pcm) > model.sr * 60:
                raise RuntimeError(f"Invalid audio for {sample_id}")
            rms = float(np.sqrt(np.mean(pcm ** 2)))
            peak = float(np.max(np.abs(pcm)))
            gain = min(0.1 / max(rms, 1e-9), 0.98 / max(peak, 1e-9))
            filename = f"alba-{sample_id}-{repeat}.wav"
            audio_file = output / filename
            sf.write(audio_file, pcm * gain, model.sr, subtype="PCM_16")
            duration = len(pcm) / model.sr
            result = {
                "voice": "alba", "voice_id": "alba", "voice_label": "Alba MacKenna casual",
                "trace_id": trace_id,
                "accepted_monotonic_ns": started_ns,
                "returned_monotonic_ns": returned_ns,
                "sample": sample_id, "repeat": repeat,
                "file_name": filename, "sha256": sha256(audio_file),
                "generation_ms": generation_ms,
                "first_audio_ms": generation_ms,
                "duration_seconds": duration,
                "real_time_factor": generation_ms / 1000 / duration,
                "raw_rms": rms, "raw_peak": peak, "output_gain": gain,
            }
            if args.device == "cuda":
                result["cuda_peak_allocated_bytes"] = torch.cuda.max_memory_allocated()
            results.append(result)
            print(json.dumps({"type": "sample", **result}), flush=True)

    manifest = {
        "model": "Chatterbox Nano", "voice": "alba", "voice_id": "alba",
        "voice_label": "Alba MacKenna casual", "source_commit": SOURCE_COMMIT,
        "source_url": "https://github.com/resemble-ai/chatterbox", "source_license": "MIT",
        "model_repo": MODEL_REPO, "model_license": "MIT",
        "model_revision": MODEL_REVISION, "model_files": list(MODEL_FILES),
        "reference_repo": REFERENCE_REPO, "reference_revision": REFERENCE_REVISION,
        "reference_file": REFERENCE_FILE, "reference_sha256": REFERENCE_SHA256,
        "reference_credit": "Alba MacKenna; Kyutai tts-voices",
        "reference_license": "CC BY 4.0",
        "reference_url": "https://huggingface.co/kyutai/tts-voices/blob/main/alba-mackenna/casual.wav",
        "runtime": runtime, "device": args.device,
        "precision": str(next(model.t3.parameters()).dtype),
        "cuda_device_name": torch.cuda.get_device_name() if args.device == "cuda" else None,
        "cuda_free_before_bytes": cuda_free_before, "cuda_total_bytes": cuda_total,
        "threads": args.threads, "seed": 42,
        "temperature": 0.8, "top_p": 0.95, "top_k": 1000,
        "repetition_penalty": 1.2,
        "load_and_reference_conditioning_ms": load_ms,
        "streaming": "complete text input; complete waveform return",
        "normalization": "uniform RMS 0.1 target, capped at peak 0.98; PCM16",
        "data_origin": catalog["data_origin"], "samples": results,
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"type": "finished", "samples": len(results), "load_ms": load_ms}), flush=True)


if __name__ == "__main__":
    main()
