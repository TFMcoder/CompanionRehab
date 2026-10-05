// Fixed synthetic Kokoro baseline, matched to scripts/pocket-voice-eval.py.
// Run only after Pocket finishes; this script is intentionally not auto-run.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cpus } from 'node:os';

const root = resolve('.');
const runtime = resolve('.local/speech/kokoro-runtime');
const cache = resolve('.local/speech/kokoro-cache');
const output = resolve('.local/probes/voice-eval/kokoro');
const modelId = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const modelRevision = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
const voice = 'af_heart';
const sampleRate = 24000;
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const localImport = (name: string) => import(pathToFileURL(join(runtime, 'node_modules', name)).href);
const packageInfo = async (name: string) => JSON.parse(await readFile(join(runtime, 'node_modules', name, 'package.json'), 'utf8')) as { version: string };

type Fixture = { id: string; label: string; text: string };
type KokoroAudio = { audio: Float32Array; sampling_rate: number; toWav?: () => Uint8Array };

function pcm16Wav(samples: Float32Array, rate: number): Buffer {
  const dataBytes = samples.length * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    wav.writeInt16LE(Math.round(value < 0 ? value * 32768 : value * 32767), 44 + i * 2);
  }
  return wav;
}

async function main() {
  const invocationStart = performance.now();
  const catalog = JSON.parse(await readFile(resolve('src/shared/voice-evaluation.json'), 'utf8')) as {
    schema_version: number; data_origin: string; samples: Fixture[];
  };
  if (catalog.schema_version !== 1 || catalog.samples.length !== 11) throw new Error('Unexpected voice evaluation fixture catalog.');

  await mkdir(output, { recursive: true });
  await mkdir(cache, { recursive: true });
  const version = await packageInfo('kokoro-js');
  const transformersVersion = await packageInfo('@huggingface/transformers');
  const phonemizerVersion = await packageInfo('phonemizer');
  const ortVersion = await packageInfo('onnxruntime-node');
  const versions = {
    'kokoro-js': version.version,
    '@huggingface/transformers': transformersVersion.version,
    phonemizer: phonemizerVersion.version,
    'onnxruntime-node': ortVersion.version,
  };
  if (versions['kokoro-js'] !== '1.2.1' || versions['@huggingface/transformers'] !== '3.8.1' || versions.phonemizer !== '1.2.1' || versions['onnxruntime-node'] !== '1.21.0') {
    throw new Error('Unqualified Kokoro runtime version; use the pinned isolated runtime.');
  }

  const importStart = performance.now();
  const { KokoroTTS } = await localImport('kokoro-js/dist/kokoro.js') as { KokoroTTS: new (model: unknown, tokenizer: unknown) => { generate(text: string, options: { voice: string; speed: number }): Promise<KokoroAudio> } };
  const { StyleTextToSpeech2Model, AutoTokenizer, env } = await localImport('@huggingface/transformers/dist/transformers.node.mjs') as {
    StyleTextToSpeech2Model: { from_pretrained(id: string, options: Record<string, unknown>): Promise<{ dispose(): Promise<void> }> };
    AutoTokenizer: { from_pretrained(id: string, options: Record<string, unknown>): Promise<unknown> };
    env: { allowLocalModels: boolean; cacheDir: string };
  };
  const importMs = Number((performance.now() - importStart).toFixed(2));
  env.allowLocalModels = false;
  env.cacheDir = cache;
  const options = { revision: modelRevision, cache_dir: cache };

  const modelStart = performance.now();
  console.log(`Loading pinned Kokoro fp32 model on CPU; first-time download included in cold-load time.`);
  const [model, tokenizer] = await Promise.all([
    StyleTextToSpeech2Model.from_pretrained(modelId, {
      ...options, dtype: 'fp32', device: 'cpu', session_options: { intraOpNumThreads: 4, interOpNumThreads: 1 },
    }),
    AutoTokenizer.from_pretrained(modelId, options),
  ]);
  const modelLoadMs = Number((performance.now() - modelStart).toFixed(2));
  const coldLoadIncludingImportMs = Number((performance.now() - invocationStart).toFixed(2));
  const tts = new KokoroTTS(model, tokenizer);
  const voicePath = join(runtime, 'node_modules/kokoro-js/voices', `${voice}.bin`);
  const voiceSha256 = sha256(await readFile(voicePath));
  const samples: Record<string, unknown>[] = [];

  try {
    for (const fixture of catalog.samples) {
      const repeats = fixture.id === 'water' || fixture.id === 'long' ? 3 : 1;
      for (let repeat = 1; repeat <= repeats; repeat++) {
        const trace = randomUUID();
        const acceptedAt = performance.now();
        const generated = await tts.generate(fixture.text, { voice, speed: 1 });
        const fullUtteranceMs = Number((performance.now() - acceptedAt).toFixed(2));
        const pcm = generated.audio;
        const rate = generated.sampling_rate;
        if (!(pcm instanceof Float32Array) || !pcm.length || rate !== sampleRate || pcm.length > rate * 60) {
          throw new Error(`Invalid audio from ${voice}/${fixture.id}/${repeat}.`);
        }
        let sumSquares = 0;
        let peak = 0;
        for (const value of pcm) {
          if (!Number.isFinite(value)) throw new Error('Non-finite generated audio.');
          sumSquares += value * value;
          peak = Math.max(peak, Math.abs(value));
        }
        const rawRms = Math.sqrt(sumSquares / pcm.length);
        if (rawRms < 0.005 || peak < 0.0001) throw new Error(`Silent/invalid audio from ${voice}/${fixture.id}/${repeat}.`);
        const gain = Math.min(0.1 / Math.max(rawRms, 1e-9), 0.98 / Math.max(peak, 1e-9));
        const normalized = Float32Array.from(pcm, value => value * gain);
        const normalizedRms = Math.sqrt(normalized.reduce((sum, value) => sum + value * value, 0) / normalized.length);
        const normalizedPeak = normalized.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
        if (normalizedPeak > 0.980001 || !Number.isFinite(normalizedRms)) throw new Error('Invalid normalized audio.');

        const wav = pcm16Wav(normalized, rate);
        const filename = `${voice}-${fixture.id}-${repeat}.wav`;
        await writeFile(join(output, `${filename}.tmp`), wav);
        await rename(join(output, `${filename}.tmp`), join(output, filename));
        const durationSeconds = pcm.length / rate;
        const result = {
          trace_uuid: trace, voice_id: voice, sample_id: fixture.id, repeat,
          file_name: filename, text: fixture.text, sha256: sha256(wav), bytes: wav.length,
          sample_rate: rate, sample_format: 'PCM_16', duration_seconds: Number(durationSeconds.toFixed(3)),
          first_model_audio_ms: fullUtteranceMs, full_utterance_ms: fullUtteranceMs,
          native_audio_streaming: false, incremental_text_input: false,
          real_time_factor: Number((fullUtteranceMs / 1000 / durationSeconds).toFixed(3)),
          raw_rms: Number(rawRms.toFixed(6)), raw_peak: Number(peak.toFixed(6)),
          output_gain: Number(gain.toFixed(6)), output_rms: Number(normalizedRms.toFixed(6)), output_peak: Number(normalizedPeak.toFixed(6)),
        };
        samples.push(result);
        console.log(JSON.stringify(result));
      }
    }

    const manifest = {
      schema_version: 1, engine: 'kokoro-js', model: 'Kokoro-82M', model_id: modelId,
      model_revision: modelRevision, voice_id: voice, voice_sha256: voiceSha256,
      precision: 'fp32', device: 'cpu', speed: 1,
      threads: { intra_op: 4, inter_op: 1 }, generated_at: new Date().toISOString(),
      import_ms: importMs, model_load_including_download_ms: modelLoadMs,
      cold_load_including_import_ms: coldLoadIncludingImportMs,
      runtime_versions: versions,
      runtime_lock_sha256: sha256(await readFile(join(runtime, 'package-lock.json'))),
      node_version: process.version, cpu: cpus()[0]?.model,
      sample_rate: sampleRate, sample_format: 'PCM_16', target_rms: 0.1, peak_ceiling: 0.98,
      native_audio_streaming: false, incremental_text_input: false,
      data_origin: catalog.data_origin, samples,
    };
    const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
    await writeFile(join(output, 'manifest.json.tmp'), bytes);
    await rename(join(output, 'manifest.json.tmp'), join(output, 'manifest.json'));
    console.log(`KOKORO_VOICE_EVAL_MANIFEST_SHA256=${sha256(bytes)}`);
  } finally {
    await model.dispose();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Kokoro benchmark failed.');
  process.exitCode = 1;
});
