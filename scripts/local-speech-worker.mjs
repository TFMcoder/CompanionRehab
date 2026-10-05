import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const runtime = resolve(process.env.KOKORO_RUNTIME || join(root, '.local/speech/kokoro-runtime'));
const cache = resolve(process.env.KOKORO_CACHE || join(root, '.local/speech/kokoro-cache'));
const localImport = name => import(pathToFileURL(join(runtime, 'node_modules', name)).href);
// The parent validates at 1,500 source characters; the narrow "rehab" ->
// "reehab" synthesis alias can expand an all-matching input by at most 20%.
const maxTextChars = 1800;
const maxAudioSeconds = 45;
const maxWavBytes = 10 * 1024 * 1024;
let tts;
let active = null;

function output(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function validateAudio(audio) {
  const pcm = audio.audio;
  if (audio.sampling_rate !== 24000 || !(pcm instanceof Float32Array) || pcm.length === 0 || pcm.length > audio.sampling_rate * maxAudioSeconds) {
    throw new Error('Audio outside bounds');
  }
  let peak = 0;
  for (const value of pcm) {
    if (!Number.isFinite(value)) throw new Error('Invalid audio');
    peak = Math.max(peak, Math.abs(value));
  }
  if (peak > 5) throw new Error('Invalid audio');
  if (peak > 0.99) for (let index = 0; index < pcm.length; index++) pcm[index] *= 0.99 / peak;
  const dataBytes = pcm.length * 2;
  if (dataBytes + 44 > maxWavBytes) throw new Error('Invalid WAV');
  const wav = Buffer.allocUnsafe(44 + dataBytes);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(audio.sampling_rate, 24);
  wav.writeUInt32LE(audio.sampling_rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < pcm.length; index++) {
    const value = Math.max(-1, Math.min(1, pcm[index]));
    wav.writeInt16LE(Math.round(value < 0 ? value * 32768 : value * 32767), 44 + index * 2);
  }
  return wav;
}

async function main() {
  const [{ KokoroTTS }, { StyleTextToSpeech2Model, AutoTokenizer, env }] = await Promise.all([
    localImport('kokoro-js/dist/kokoro.js'), localImport('@huggingface/transformers/dist/transformers.node.mjs'),
  ]);
  env.allowLocalModels = false;
  env.cacheDir = cache;
  const modelId = 'onnx-community/Kokoro-82M-v1.0-ONNX';
  const revision = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
  const options = { revision, cache_dir: cache, dtype: 'fp32', device: 'cpu', session_options: { intraOpNumThreads: 4, interOpNumThreads: 1 } };
  const [model, tokenizer] = await Promise.all([
    StyleTextToSpeech2Model.from_pretrained(modelId, options),
    AutoTokenizer.from_pretrained(modelId, { revision, cache_dir: cache }),
  ]);
  tts = new KokoroTTS(model, tokenizer);
  validateAudio(await tts.generate('This is a synthetic voice service warmup.', { voice: 'af_heart', speed: 1 }));
  output({ type: 'ready' });
  const lines = createInterface({ input: process.stdin });
  lines.on('line', line => {
    let request;
    try { request = JSON.parse(line); } catch { return; }
    if (request?.type === 'cancel' && typeof request.id === 'string') {
      if (active?.id === request.id) active.cancelled = true;
      return;
    }
    if (request?.type !== 'synthesize' || typeof request.id !== 'string' || typeof request.text !== 'string' ||
        request.text.trim().length === 0 || request.text.length > maxTextChars || active) {
      if (typeof request?.id === 'string') output({ type: 'error', id: request.id, code: 'invalid_or_busy' });
      return;
    }
    const job = { id: request.id, cancelled: false };
    active = job;
    void (async () => {
      try {
        const audio = await tts.generate(request.text, { voice: 'af_heart', speed: 1 });
        const wav = validateAudio(audio);
        if (job.cancelled) output({ type: 'cancelled', id: request.id });
        else output({ type: 'result', id: request.id, value: wav.toString('base64') });
      } catch {
        output({ type: 'error', id: request.id, code: 'synthesis_failed' });
      } finally { if (active === job) active = null; }
    })();
  });
  await new Promise(resolveClosed => lines.once('close', resolveClosed));
}

main().catch(() => { process.exitCode = 1; });
