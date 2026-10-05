"""Warm, offline faster-whisper worker. Audio and transcript exist only in memory."""

from __future__ import annotations

import base64
from io import BytesIO
import json
import os
from pathlib import Path
import sys
import threading
import wave

ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = "Systran/faster-whisper-small.en"
MODEL_REVISION = "d1d751a5f8271d482d14ca55d9e2deeebbae577f"
MAX_WAV_BYTES = 10 * 1024 * 1024
MAX_SECONDS = 45.0
CPU_THREADS = 4
output_lock = threading.Lock()

os.environ["OMP_NUM_THREADS"] = str(CPU_THREADS)
os.environ["OPENBLAS_NUM_THREADS"] = str(CPU_THREADS)
os.environ["MKL_NUM_THREADS"] = str(CPU_THREADS)
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"


def emit(value: dict) -> None:
    with output_lock:
        sys.stdout.write(json.dumps(value, separators=(",", ":"), ensure_ascii=True) + "\n")
        sys.stdout.flush()


def inspect_wav(raw: bytes) -> None:
    if len(raw) < 44 or len(raw) > MAX_WAV_BYTES:
        raise ValueError("audio_bounds")
    with wave.open(BytesIO(raw), "rb") as wav:
        if wav.getcomptype() != "NONE" or wav.getnchannels() != 1 or wav.getsampwidth() != 2:
            raise ValueError("audio_format")
        rate = wav.getframerate()
        frames = wav.getnframes()
        duration = frames / rate if rate else 0
        if not 8000 <= rate <= 48000 or duration <= 0 or duration > MAX_SECONDS:
            raise ValueError("audio_bounds")


def main() -> int:
    import importlib.metadata
    from faster_whisper import WhisperModel
    from faster_whisper.audio import decode_audio
    from huggingface_hub import snapshot_download
    import numpy as np

    expected = {"faster-whisper": "1.2.1", "ctranslate2": "4.8.2", "av": "18.1.0"}
    if any(importlib.metadata.version(name) != version for name, version in expected.items()):
        raise RuntimeError("runtime_unqualified")
    cache = ROOT / ".local" / "speech" / "runtime" / "model-cache"
    model_dir = snapshot_download(repo_id=MODEL_ID, revision=MODEL_REVISION,
                                  cache_dir=str(cache), local_files_only=True)
    if Path(model_dir).name.lower() != MODEL_REVISION or not (Path(model_dir) / "model.bin").is_file():
        raise RuntimeError("model_unqualified")
    model = WhisperModel(str(model_dir), device="cpu", compute_type="int8", cpu_threads=CPU_THREADS,
                         num_workers=1, local_files_only=True)
    # Exercise the warmed inference path on synthetic silence; discard all output.
    warm_segments, _ = model.transcribe(np.zeros(16000, dtype=np.float32), language="en", beam_size=1,
                                        best_of=1, temperature=0.0, condition_on_previous_text=False, vad_filter=False)
    for _ in warm_segments:
        pass
    emit({"type": "ready"})
    active: dict | None = None
    active_lock = threading.Lock()

    def transcribe_job(request_id: str, encoded: str, job: dict) -> None:
        nonlocal active
        try:
            raw = base64.b64decode(encoded, validate=True)
            inspect_wav(raw)
            audio = decode_audio(BytesIO(raw), sampling_rate=16000)
            if not isinstance(audio, np.ndarray) or audio.ndim != 1 or len(audio) == 0 or len(audio) > int(16000 * MAX_SECONDS):
                raise ValueError("audio_bounds")
            segments, _metadata = model.transcribe(audio, language="en", beam_size=1, best_of=1, temperature=0.0,
                                                  condition_on_previous_text=False, vad_filter=False)
            transcript = " ".join(segment.text.strip() for segment in segments).strip()
            if len(transcript) > 4000:
                raise ValueError("transcript_bounds")
            with active_lock:
                emit({"type": "cancelled" if job["cancelled"] else "result", "id": request_id,
                      **({} if job["cancelled"] else {"value": transcript})})
                if active is job:
                    active = None
        except Exception:
            # Do not print exception text: decoder errors can contain input paths or text.
            with active_lock:
                emit({"type": "cancelled" if job["cancelled"] else "error", "id": request_id,
                      **({} if job["cancelled"] else {"code": "transcription_failed"})})
                if active is job:
                    active = None

    for line in sys.stdin:
        if len(line) > (MAX_WAV_BYTES * 2):
            continue
        try:
            request = json.loads(line)
        except (ValueError, TypeError):
            continue
        request_id = request.get("id") if isinstance(request, dict) else None
        if not isinstance(request_id, str):
            continue
        if request.get("type") == "cancel":
            with active_lock:
                if active is not None and active["id"] == request_id:
                    active["cancelled"] = True
            continue
        if request.get("type") != "transcribe" or not isinstance(request.get("wav"), str):
            emit({"type": "error", "id": request_id, "code": "invalid_request"})
            continue
        job = {"id": request_id, "cancelled": False}
        with active_lock:
            if active is not None:
                emit({"type": "error", "id": request_id, "code": "busy"})
                continue
            active = job
        threading.Thread(target=transcribe_job, args=(request_id, request["wav"], job), daemon=True).start()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        # Startup failures are intentionally silent to avoid leaking runtime or input details.
        raise SystemExit(1)
