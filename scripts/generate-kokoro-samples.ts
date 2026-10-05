// Local audition generator only: no participant input, credentials or remote inference.
// Install the isolated runtime as documented in docs/DEVICE_PREVIEW.md.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cpus } from 'node:os';
import { kokoroSamples, kokoroVoices } from '../src/shared/kokoro-samples.js';

async function main() {
  const runtime = resolve('.local/speech/kokoro-runtime');
  const output = resolve('.local/probes/kokoro');
  const modelId = 'onnx-community/Kokoro-82M-v1.0-ONNX';
  const modelRevision = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
  const cache = resolve('.local/speech/kokoro-cache');
  const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
  const localImport = (name: string) => import(pathToFileURL(join(runtime, 'node_modules', name)).href);
  const packageInfo = async (name: string) => JSON.parse(await readFile(join(runtime, 'node_modules', name, 'package.json'), 'utf8')) as { version: string };

  const versions = {
    'kokoro-js': (await packageInfo('kokoro-js')).version,
    '@huggingface/transformers': (await packageInfo('@huggingface/transformers')).version,
    'phonemizer': (await packageInfo('phonemizer')).version,
    'onnxruntime-node': (await packageInfo('onnxruntime-node')).version,
  };
  if (versions['kokoro-js'] !== '1.2.1' || versions['@huggingface/transformers'] !== '3.8.1' || versions.phonemizer !== '1.2.1' || versions['onnxruntime-node'] !== '1.21.0') {
    throw new Error('Unqualified runtime version; reinstall the documented pinned runtime.');
  }
  await mkdir(output, { recursive: true });
  await mkdir(cache, { recursive: true });
  const { KokoroTTS } = await localImport('kokoro-js/dist/kokoro.js');
  const { StyleTextToSpeech2Model, AutoTokenizer, env } = await localImport('@huggingface/transformers/dist/transformers.node.mjs');
  env.allowLocalModels = false;
  env.cacheDir = cache;
  const options = { revision: modelRevision, cache_dir: cache };
  const loadStarted = performance.now();
  console.log('Loading pinned Kokoro fp32 model on local CPU (initial download may take a few minutes).');
  // Use the public constructor because KokoroTTS.from_pretrained does not forward revision.
  const [model, tokenizer] = await Promise.all([
    StyleTextToSpeech2Model.from_pretrained(modelId, {
      ...options, dtype: 'fp32', device: 'cpu', session_options: { intraOpNumThreads: 4, interOpNumThreads: 1 },
    }),
    AutoTokenizer.from_pretrained(modelId, options),
  ]);
  const tts = new KokoroTTS(model, tokenizer);
  const loadMs = Math.round(performance.now() - loadStarted);
  const samples = [];
  try {
    for (const voice of kokoroVoices) {
      for (const sample of kokoroSamples) {
        const started = performance.now();
        const audio = await tts.generate(sample.text, { voice: voice.id, speed: 1 });
        const generationMs = Math.round(performance.now() - started);
        const pcm: Float32Array = audio.audio;
        const rate: number = audio.sampling_rate;
        const duration = pcm.length / rate;
        let sumSquares = 0;
        let peak = 0;
        for (const value of pcm) {
          if (!Number.isFinite(value)) throw new Error('Non-finite generated audio.');
          sumSquares += value * value;
          peak = Math.max(peak, Math.abs(value));
        }
        const rms = Math.sqrt(sumSquares / pcm.length);
        if (rate !== 24000 || duration < 3 || duration > 60 || rms < 0.005 || peak > 5) {
          throw new Error(`Invalid or silent audio for ${voice.id}/${sample.id}: duration=${duration}, rms=${rms}, peak=${peak}.`);
        }
        // Neural output can slightly exceed PCM's range. Reduce the entire clip uniformly
        // when needed, preserving dynamics instead of clipping peaks or altering its pace.
        const gain = peak > 0.99 ? 0.99 / peak : 1;
        if (gain !== 1) for (let index = 0; index < pcm.length; index++) pcm[index] *= gain;
        const wav = Buffer.from(audio.toWav());
        if (wav.length > 8 * 1024 * 1024 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
          throw new Error('Invalid generated WAV.');
        }
        const fileName = `${voice.id}-${sample.id}.wav`;
        await writeFile(join(output, `${fileName}.tmp`), wav);
        await rename(join(output, `${fileName}.tmp`), join(output, fileName));
        const result = {
          voice_id: voice.id, sample_id: sample.id, file_name: fileName,
          text: sample.text, sha256: sha256(wav), bytes: wav.length,
          sampling_rate: rate, duration_seconds: Number(duration.toFixed(3)),
          generation_ms: generationMs, real_time_factor: Number((generationMs / 1000 / duration).toFixed(3)),
          raw_rms: Number(rms.toFixed(5)), raw_peak: Number(peak.toFixed(5)), output_gain: Number(gain.toFixed(6)),
        };
        samples.push(result);
        console.log(`${voice.label} / ${sample.label}: ${result.duration_seconds}s audio in ${generationMs}ms`);
      }
    }
    const voiceDigests = Object.fromEntries(await Promise.all(kokoroVoices.map(async voice => [
      voice.id, sha256(await readFile(join(runtime, 'node_modules/kokoro-js/voices', `${voice.id}.bin`))),
    ])));
    const manifest = {
      schema_version: 1, model: 'Kokoro-82M', engine: 'kokoro-js', model_id: modelId,
      model_revision: modelRevision, dtype: 'fp32', device: 'cpu', speed: 1,
      threads: { intra_op: 4, inter_op: 1 }, generated_at: new Date().toISOString(),
      load_including_download_ms: loadMs, runtime_versions: versions,
      runtime_lock_sha256: sha256(await readFile(join(runtime, 'package-lock.json'))),
      voice_sha256: voiceDigests, node_version: process.version, cpu: cpus()[0]?.model,
      data_origin: 'Fixed synthetic catalogue; no participant data', samples,
    };
    const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
    await writeFile(join(output, 'manifest.json.tmp'), bytes);
    await rename(join(output, 'manifest.json.tmp'), join(output, 'manifest.json'));
    console.log(`PREVIEW_KOKORO_MANIFEST_SHA256=${sha256(bytes)}`);
  } finally {
    await model.dispose();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Kokoro audition generation failed.');
  process.exitCode = 1;
});
