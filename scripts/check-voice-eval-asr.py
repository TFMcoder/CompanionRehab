"""Offline intelligibility smoke-check; not a naturalness/voice-acceptance test."""
import argparse
from difflib import SequenceMatcher
import json
from pathlib import Path
import re
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--models', nargs='+', choices=['pocket', 'kokoro', 'nano', 'qwen'], default=['pocket', 'kokoro', 'nano', 'qwen'])
parser.add_argument('--directories', nargs='+', help='Named folders inside the ignored voice-eval directory, instead of --models')
parser.add_argument('--output', default='asr.json', help='Receipt filename inside the ignored voice-eval directory')
args = parser.parse_args()
if any(Path(name).name != name or name in ('.', '..') for name in (args.directories or []) + [args.output]):
    parser.error('Use plain directory and receipt names without path components')
catalogue = json.loads((ROOT/'src/shared/voice-evaluation.json').read_text('utf-8'))
expected = {entry['id']: entry['text'] for entry in catalogue['samples']}
cache = ROOT/'.local/speech/runtime/model-cache/models--Systran--faster-whisper-small.en/snapshots/d1d751a5f8271d482d14ca55d9e2deeebbae577f'
from faster_whisper import WhisperModel
start = time.perf_counter()
model = WhisperModel(str(cache), device='cpu', compute_type='int8', cpu_threads=4, local_files_only=True)
load_ms = (time.perf_counter()-start)*1000
def words(text):
    return re.sub(r'[^a-z0-9 ]', '', text.lower().replace('’', "'")).split()
results = []
for candidate in args.directories or args.models:
    directory = ROOT/'.local/probes/voice-eval'/candidate
    for path in sorted(directory.glob('*-1.wav')):
        sample_id = path.stem.split('-')[-2]
        if sample_id not in expected:
            continue
        started = time.perf_counter()
        segments, info = model.transcribe(str(path), language='en', beam_size=5, vad_filter=False)
        transcript = ' '.join(segment.text.strip() for segment in segments)
        latency = (time.perf_counter()-started)*1000
        exact = words(transcript) == words(expected[sample_id])
        results.append({'trace':str(uuid.uuid4()), 'model':candidate, 'file_name':path.name, 'sample':sample_id,
                        'transcription_ms':round(latency,2),'audio_duration_seconds':info.duration,
                        'normalized_exact':exact,'word_sequence_similarity':round(SequenceMatcher(None,words(expected[sample_id]),words(transcript)).ratio(),3),
                        'transcript':transcript})
        print(json.dumps({key:value for key,value in results[-1].items() if key != 'transcript'}),flush=True)
receipt = {'model':'faster-whisper-small.en','revision':cache.name,'device':'cpu','precision':'int8',
           'threads':4,'model_load_ms':round(load_ms,2),'data_origin':'Fixed synthetic audition WAVs',
           'interpretation':'ASR disagreement needs listening review; this does not establish naturalness or physical audibility.',
           'results':results}
(ROOT/'.local/probes/voice-eval'/args.output).write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
