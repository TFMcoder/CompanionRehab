"""Run one bounded, CPU-only faster-whisper check against the synthetic SAPI WAV.

Setup (PowerShell, repository root):
  py -3.14 -m venv .local/speech/runtime/venv
  ./.local/speech/runtime/venv/Scripts/python.exe -m pip install --only-binary=:all: faster-whisper==1.2.1 ctranslate2==4.8.2 av==18.1.0
  ./.local/speech/runtime/venv/Scripts/python.exe ./scripts/check-local-asr.py

The model is fetched only from the official Systran Hugging Face repository at
the fixed commit below and the private receipt records its model.bin digest.
PyAV 18.1.0 is pinned because 19.0.1 rejected the metadata_errors keyword used
by faster-whisper 1.2.1 in the initial compatibility probe. CPU threads, input
length/size and worker time are bounded. The transcript is written only to
.local/probes/local-asr-result.json.
"""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import re
import subprocess
import sys
import time
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
INPUT_PATH = ROOT / ".local" / "probes" / "nancy-local-voice.wav"
RECEIPT_PATH = ROOT / ".local" / "probes" / "local-asr-result.json"
RUNTIME_DIR = ROOT / ".local" / "speech" / "runtime"
MODEL_CACHE_DIR = RUNTIME_DIR / "model-cache"
MODEL_ID = "Systran/faster-whisper-small.en"
MODEL_REVISION = "d1d751a5f8271d482d14ca55d9e2deeebbae577f"
MAX_AUDIO_SECONDS = 30.0
MAX_AUDIO_BYTES = 10 * 1024 * 1024
MAX_WORKER_SECONDS = 300
CPU_THREADS = 4
EXPECTED_TEXT = (
    "Hello, I am Nancy, your AI companion. "
    "This is a local voice connection test."
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalized(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def safe_error(exc: BaseException) -> str:
    base = exc
    while base.__cause__ is not None:
        base = base.__cause__
    message = str(base)
    message = re.sub(r"(?i)\b[A-Z]:\\[^\r\n\"<>|?*]*", "<local-path>", message)
    message = re.sub(r"[\r\n]+", " ", message)
    if len(message) > 300:
        message = message[:300]
    return f"{type(base).__name__}: {message or 'No additional safe detail is available.'}"


def write_receipt(receipt: dict[str, Any]) -> None:
    RECEIPT_PATH.parent.mkdir(parents=True, exist_ok=True)
    RECEIPT_PATH.write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def output_summary(receipt: dict[str, Any]) -> None:
    summary = {
        "status": receipt.get("status"),
        "asr_route": receipt.get("asr_route"),
        "model_id": receipt.get("model", {}).get("id"),
        "model_revision": receipt.get("model", {}).get("revision"),
        "compute": receipt.get("compute"),
        "audio_seconds": receipt.get("input", {}).get("duration_seconds"),
        "transcription_latency_ms": receipt.get("timing", {}).get("transcription_latency_ms"),
        "expected_text_match": receipt.get("expected_text_match"),
        "transcript_private_ref": receipt.get("transcript_private_ref"),
        "receipt_private_ref": ".local/probes/local-asr-result.json",
        "safe_errors": receipt.get("safe_errors", []),
    }
    print(json.dumps(summary, ensure_ascii=False))


def base_receipt() -> dict[str, Any]:
    return {
        "probe_id": "local-faster-whisper-asr-connection",
        "status": "failed",
        "created_at_utc": utc_now(),
        "data_origin": "synthetic_sapi_audio",
        "asr_route": "local faster-whisper on CPU; no remote inference",
        "input": {
            "artifact_private_ref": ".local/probes/nancy-local-voice.wav",
            "duration_seconds": None,
            "sample_rate_hz": None,
            "channels": None,
            "sample_width_bytes": None,
            "pcm_data_bytes": None,
            "has_nonzero_pcm": False,
        },
        "runtime": {
            "python": sys.version.split()[0],
            "platform": sys.platform,
            "packages": {},
            "locked_dependencies_private_ref": ".local/speech/runtime/installed-packages.txt",
        },
        "model": {
            "id": MODEL_ID,
            "source": "https://huggingface.co/Systran/faster-whisper-small.en",
            "revision": None,
            "license": "MIT",
            "model_bin_sha256": None,
            "model_bin_bytes": None,
        },
        "compute": {
            "device": "cpu",
            "compute_type": "int8",
            "cpu_threads": CPU_THREADS,
        },
        "timing": {
            "total_elapsed_ms": None,
            "model_resolve_and_download_ms": None,
            "model_load_ms": None,
            "transcription_latency_ms": None,
        },
        "transcript": None,
        "transcript_private_ref": ".local/probes/local-asr-result.json#transcript",
        "expected_text_match": None,
        "microphone_opened": False,
        "device_conversation_verified": False,
        "remote_service_used": False,
        "safe_errors": [],
    }


def inspect_input(receipt: dict[str, Any]) -> tuple[float, int]:
    if not INPUT_PATH.is_file():
        raise FileNotFoundError("The expected synthetic SAPI WAV is not available.")
    file_size = INPUT_PATH.stat().st_size
    if file_size > MAX_AUDIO_BYTES:
        raise ValueError("Synthetic WAV exceeds the 10 MiB input limit.")
    with wave.open(str(INPUT_PATH), "rb") as wav:
        channels = wav.getnchannels()
        sample_rate = wav.getframerate()
        sample_width = wav.getsampwidth()
        frames = wav.getnframes()
        duration = frames / sample_rate if sample_rate else 0.0
        if channels != 1 or sample_rate != 22050 or sample_width != 2:
            raise ValueError("Synthetic WAV format did not match mono 22050 Hz, 16-bit PCM.")
        if duration <= 0 or duration > MAX_AUDIO_SECONDS:
            raise ValueError("Synthetic WAV duration is outside the 0–30 second limit.")
        pcm = wav.readframes(frames)
        if len(pcm) != frames * channels * sample_width:
            raise ValueError("Synthetic WAV PCM data is truncated.")
        has_nonzero_pcm = any(pcm)
        if not has_nonzero_pcm:
            raise ValueError("Synthetic WAV PCM data is silent.")
    receipt["input"].update(
        {
            "duration_seconds": round(duration, 3),
            "sample_rate_hz": sample_rate,
            "channels": channels,
            "sample_width_bytes": sample_width,
            "pcm_data_bytes": len(pcm),
            "has_nonzero_pcm": has_nonzero_pcm,
        }
    )
    return duration, file_size


def run_worker() -> dict[str, Any]:
    receipt = base_receipt()
    started = time.perf_counter()
    try:
        _duration, _file_size = inspect_input(receipt)
        for package in (
            "faster-whisper",
            "ctranslate2",
            "av",
            "huggingface-hub",
            "tokenizers",
            "onnxruntime",
            "numpy",
            "PyYAML",
            "protobuf",
        ):
            receipt["runtime"]["packages"][package] = importlib.metadata.version(package)

        os.environ["OMP_NUM_THREADS"] = str(CPU_THREADS)
        os.environ["OPENBLAS_NUM_THREADS"] = str(CPU_THREADS)
        os.environ["MKL_NUM_THREADS"] = str(CPU_THREADS)
        os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
        os.environ["HF_HUB_ETAG_TIMEOUT"] = "15"
        os.environ["HF_HUB_DOWNLOAD_TIMEOUT"] = "45"

        from faster_whisper import WhisperModel
        from huggingface_hub import snapshot_download
        from huggingface_hub.errors import LocalEntryNotFoundError

        resolve_started = time.perf_counter()
        try:
            model_dir = snapshot_download(
                repo_id=MODEL_ID,
                revision=MODEL_REVISION,
                cache_dir=str(MODEL_CACHE_DIR),
                local_files_only=True,
            )
        except LocalEntryNotFoundError:
            model_dir = snapshot_download(
                repo_id=MODEL_ID,
                revision=MODEL_REVISION,
                cache_dir=str(MODEL_CACHE_DIR),
                local_files_only=False,
            )
        if Path(model_dir).name.lower() != MODEL_REVISION:
            raise RuntimeError("The model snapshot cache did not match the pinned commit SHA.")
        receipt["timing"]["model_resolve_and_download_ms"] = round(
            (time.perf_counter() - resolve_started) * 1000, 1
        )
        model_path = Path(model_dir) / "model.bin"
        if not model_path.is_file():
            raise FileNotFoundError("Pinned model snapshot is missing model.bin.")
        digest = hashlib.sha256()
        with model_path.open("rb") as model_file:
            for block in iter(lambda: model_file.read(1024 * 1024), b""):
                digest.update(block)
        receipt["model"].update(
            {
                "revision": MODEL_REVISION,
                "model_bin_sha256": digest.hexdigest(),
                "model_bin_bytes": model_path.stat().st_size,
            }
        )

        load_started = time.perf_counter()
        model = WhisperModel(
            str(model_dir),
            device="cpu",
            compute_type="int8",
            cpu_threads=CPU_THREADS,
            num_workers=1,
            local_files_only=True,
        )
        receipt["timing"]["model_load_ms"] = round((time.perf_counter() - load_started) * 1000, 1)

        transcription_started = time.perf_counter()
        segments, _metadata = model.transcribe(
            str(INPUT_PATH),
            language="en",
            beam_size=1,
            best_of=1,
            temperature=0.0,
            condition_on_previous_text=False,
            vad_filter=False,
        )
        transcript = " ".join(segment.text.strip() for segment in segments).strip()
        receipt["timing"]["transcription_latency_ms"] = round(
            (time.perf_counter() - transcription_started) * 1000, 1
        )
        if not transcript:
            raise RuntimeError("ASR returned an empty transcript for the synthetic phrase.")
        receipt["transcript"] = transcript
        receipt["expected_text_match"] = normalized(transcript) == normalized(EXPECTED_TEXT)
        if receipt["expected_text_match"]:
            receipt["status"] = "completed"
        else:
            receipt["status"] = "failed"
            receipt["safe_errors"].append("ASR transcript did not match the fixed synthetic phrase.")
    except Exception as exc:  # noqa: BLE001 - sanitized into the private probe receipt.
        receipt["safe_errors"].append(safe_error(exc))
    finally:
        receipt["timing"]["total_elapsed_ms"] = round((time.perf_counter() - started) * 1000, 1)
    return receipt


def main() -> int:
    RECEIPT_PATH.parent.mkdir(parents=True, exist_ok=True)
    if "--worker" in sys.argv:
        receipt = run_worker()
        print(json.dumps(receipt, ensure_ascii=False))
        return 0 if receipt["status"] == "completed" else 1

    started = time.perf_counter()
    try:
        worker = subprocess.run(
            [sys.executable, str(Path(__file__).resolve()), "--worker"],
            check=False,
            capture_output=True,
            text=True,
            timeout=MAX_WORKER_SECONDS,
            env={
                **os.environ,
                "OMP_NUM_THREADS": str(CPU_THREADS),
                "OPENBLAS_NUM_THREADS": str(CPU_THREADS),
                "MKL_NUM_THREADS": str(CPU_THREADS),
                "HF_HUB_DISABLE_TELEMETRY": "1",
                "HF_HUB_ETAG_TIMEOUT": "15",
                "HF_HUB_DOWNLOAD_TIMEOUT": "45",
            },
        )
        receipt = json.loads(worker.stdout)
        if worker.returncode != 0 and receipt.get("status") == "completed":
            receipt["status"] = "failed"
            receipt["safe_errors"].append("The bounded ASR worker exited unexpectedly.")
    except subprocess.TimeoutExpired:
        receipt = base_receipt()
        receipt["safe_errors"].append(f"ASR worker exceeded the {MAX_WORKER_SECONDS}-second limit.")
        receipt["timing"]["total_elapsed_ms"] = round((time.perf_counter() - started) * 1000, 1)
    except Exception as exc:  # noqa: BLE001 - sanitized into the private probe receipt.
        receipt = base_receipt()
        receipt["safe_errors"].append(safe_error(exc))
        receipt["timing"]["total_elapsed_ms"] = round((time.perf_counter() - started) * 1000, 1)

    write_receipt(receipt)
    output_summary(receipt)
    return 0 if receipt["status"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
