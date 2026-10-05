"""Normalize the two manually generated official-demo fixtures; no inference/API."""
from pathlib import Path
import hashlib
import json
import numpy as np
import soundfile as sf

root = Path(__file__).resolve().parents[1] / '.local/probes/voice-eval/qwen'
samples = []
for sample in ('water', 'long'):
    source = root / f'serena-{sample}-raw.wav'
    pcm, rate = sf.read(source, dtype='float32')
    if pcm.ndim != 1 or rate != 24000 or len(pcm) > rate * 60 or not np.isfinite(pcm).all():
        raise ValueError('Unexpected demo waveform')
    rms, peak = float(np.sqrt(np.mean(pcm**2))), float(np.max(np.abs(pcm)))
    gain = min(0.1/max(rms, 1e-9), 0.98/max(peak, 1e-9))
    filename = f'serena-{sample}-1.wav'
    sf.write(root/filename, pcm*gain, rate, subtype='PCM_16')
    samples.append({'voice':'serena','sample':sample,'repeat':1,'file_name':filename,
                    'sha256':hashlib.sha256((root/filename).read_bytes()).hexdigest(),
                    'raw_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
                    'duration_seconds':len(pcm)/rate,'raw_rms':rms,'raw_peak':peak,'output_gain':gain})
receipt = {'model':'Qwen3-TTS-12Hz-1.7B-CustomVoice','voice':'Serena','language':'English',
           'source':'https://huggingface.co/spaces/Qwen/Qwen3-TTS',
           'runtime':'Official shared ZeroGPU demo; exact deployed checkpoint/runtime revisions unverified',
           'documented_precision':'bfloat16','documented_attention':'sdpa','streaming':False,
           'instructions':{'water':'Speak warmly and naturally, like a calm adult companion. Use a gentle question intonation and conversational pacing.',
                           'long':'Speak warmly and naturally, like a calm adult companion. Use varied, appropriate question intonation and conversational pacing.'},
           'latency':'Unmeasured: UI generation success and complete WAV verified; no model or rendered-audio instrumentation on hosted demo.',
           'data_origin':'Fixed synthetic catalogue submitted through official demo UI',
           'voice_acceptance':'pending human listening','samples':samples}
(root/'manifest.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'samples':len(samples),'durations':[s['duration_seconds'] for s in samples]}))
