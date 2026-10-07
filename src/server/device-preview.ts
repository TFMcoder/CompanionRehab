import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { kokoroSamples, kokoroVoices } from '../shared/kokoro-samples.js';
import evaluation from '../shared/voice-evaluation.json';
import { attachPreviewVoiceStream, type VoiceStreamOptions } from './preview-voice-stream.js';

export interface PreviewOptions {
  staticRoot?: string;
  allowedHosts: string[];
  samplePath?: string;
  sampleSha256?: string;
  kokoroManifestPath?: string;
  kokoroManifestSha256?: string;
  evaluationManifestPath?: string;
  evaluationManifestSha256?: string;
  voiceStream?: Omit<VoiceStreamOptions, 'allowedHosts'>;
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const isWav = (bytes: Buffer) => bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE';

function sendWav(request: FastifyRequest, reply: FastifyReply, bytes: Buffer) {
  reply.header('Accept-Ranges', 'bytes').type('audio/wav');
  const range = request.headers.range;
  if (!range) return reply.send(bytes);
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  const invalid = () => reply.code(416).header('Content-Range', `bytes */${bytes.length}`).send();
  if (!match || (!match[1] && !match[2])) return invalid();
  if ((match[1] && !Number.isSafeInteger(Number(match[1]))) || (match[2] && !Number.isSafeInteger(Number(match[2])))) return invalid();
  const suffix = !match[1];
  const start = suffix ? bytes.length - Math.min(bytes.length, Number(match[2])) : Number(match[1]);
  const end = suffix || !match[2] ? bytes.length - 1 : Math.min(Number(match[2]), bytes.length - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= bytes.length) return invalid();
  return reply.code(206).header('Content-Range', `bytes ${start}-${end}/${bytes.length}`).send(bytes.subarray(start, end + 1));
}

/** Public-safe, read-only device preview. Deliberately imports no care/auth/provider runtime. */
export async function createDevicePreview(options: PreviewOptions) {
  // Compare canonical paths on both sides: Windows TEMP may use an 8.3 alias.
  const root = await realpath(resolve(options.staticRoot || 'dist/client'));
  const files = new Map<string, { bytes: Buffer; mime: string }>();
  const html = await readFile(resolve(root, 'preview.html'));
  const assetRoot = await realpath(resolve(root, 'assets'));
  if (!assetRoot.startsWith(root + sep)) throw new Error('Preview assets escaped their build directory.');
  for (const entry of await readdir(assetRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[a-zA-Z0-9_.-]+\.(js|css|svg)$/.test(entry.name)) continue;
    const path = await realpath(resolve(assetRoot, entry.name));
    if (!path.startsWith(assetRoot + sep)) throw new Error('Preview asset escaped its build directory.');
    const bytes = await readFile(path);
    if (bytes.length > 5_000_000) throw new Error('Preview asset exceeds its size limit.');
    files.set(`/assets/${entry.name}`, { bytes, mime: entry.name.endsWith('.css') ? 'text/css; charset=utf-8' : entry.name.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript; charset=utf-8' });
  }
  // Never expose an arbitrary local audio file. The operator pins the known synthetic fixture.
  let sample: Buffer | undefined;
  if (options.samplePath && options.sampleSha256 && /^[a-f0-9]{64}$/.test(options.sampleSha256)) {
    const bytes = await readFile(options.samplePath);
    if (bytes.length > 2_000_000 || !isWav(bytes) || sha256(bytes) !== options.sampleSha256) throw new Error('Preview sample did not match the pinned synthetic WAV.');
    sample = bytes;
  }
  const kokoro = new Map<string, Buffer>();
  if (options.kokoroManifestPath || options.kokoroManifestSha256) {
    if (!options.kokoroManifestPath || !options.kokoroManifestSha256 || !/^[a-f0-9]{64}$/.test(options.kokoroManifestSha256)) {
      throw new Error('Preview Kokoro manifest requires a path and pinned SHA-256.');
    }
    const manifestPath = await realpath(options.kokoroManifestPath);
    const manifestDir = dirname(manifestPath);
    if ((await stat(manifestPath)).size > 16_384) throw new Error('Preview Kokoro manifest exceeds its size limit.');
    const manifestBytes = await readFile(manifestPath);
    if (manifestBytes.length > 16_384 || sha256(manifestBytes) !== options.kokoroManifestSha256) {
      throw new Error('Preview Kokoro manifest did not match its pinned SHA-256.');
    }
    let manifest: unknown;
    try { manifest = JSON.parse(manifestBytes.toString('utf8')); }
    catch { throw new Error('Preview Kokoro manifest is invalid JSON.'); }
    const expected = new Set(kokoroVoices.flatMap((voice) => kokoroSamples.map((entry) => `${voice.id}/${entry.id}`)));
    if (!manifest || typeof manifest !== 'object' ||
      (manifest as any).schema_version !== 1 || (manifest as any).model !== 'Kokoro-82M' || (manifest as any).engine !== 'kokoro-js' ||
      !Array.isArray((manifest as any).samples) || (manifest as any).samples.length !== expected.size) {
      throw new Error('Preview Kokoro manifest has an unsupported catalogue.');
    }
    let totalBytes = 0;
    for (const item of (manifest as any).samples) {
      if (!item || typeof item !== 'object' || typeof item.voice_id !== 'string' || typeof item.sample_id !== 'string' ||
        typeof item.file_name !== 'string' || typeof item.sha256 !== 'string') throw new Error('Preview Kokoro manifest has an invalid sample.');
      const key = `${item.voice_id}/${item.sample_id}`;
      if (!expected.delete(key) || item.file_name !== `${item.voice_id}-${item.sample_id}.wav` || !/^[a-f0-9]{64}$/.test(item.sha256)) {
        throw new Error('Preview Kokoro manifest has an unknown or duplicate sample.');
      }
      const path = await realpath(resolve(manifestDir, item.file_name));
      if (!path.startsWith(manifestDir + sep)) throw new Error('Preview Kokoro sample escaped its manifest directory.');
      if ((await stat(path)).size > 8_000_000) throw new Error('Preview Kokoro sample exceeds its size limit.');
      const bytes = await readFile(path);
      totalBytes += bytes.length;
      if (bytes.length > 8_000_000 || totalBytes > 72_000_000 || !isWav(bytes) || sha256(bytes) !== item.sha256) {
        throw new Error('Preview Kokoro sample did not match its pinned synthetic WAV.');
      }
      kokoro.set(key, bytes);
    }
    if (expected.size !== 0) throw new Error('Preview Kokoro manifest is missing samples.');
  }
  const app = Fastify({ logger: false, trustProxy: false, bodyLimit: 1024, requestTimeout: 10000 });
  const evaluationAudio = new Map<string, Buffer>();
  if (options.evaluationManifestPath || options.evaluationManifestSha256) {
    if (!options.evaluationManifestPath || !/^[a-f0-9]{64}$/.test(options.evaluationManifestSha256 || '')) throw new Error('Evaluation manifest must be pinned.');
    const manifestPath = await realpath(options.evaluationManifestPath);
    if ((await stat(manifestPath)).size > 65_536) throw new Error('Evaluation manifest too large.');
    const bytes = await readFile(manifestPath);
    if (sha256(bytes) !== options.evaluationManifestSha256) throw new Error('Evaluation manifest digest mismatch.');
    const manifest = JSON.parse(bytes.toString('utf8'));
    if (manifest.schema_version !== 1 || !Array.isArray(manifest.samples) || manifest.samples.length > 55) throw new Error('Invalid evaluation manifest.');
    let total = 0;
    for (const item of manifest.samples) {
      const key = `${item.model}/${item.voice}/${item.sample}`;
      const knownVoice = (item.model === 'pocket' && ['alba', 'anna'].includes(item.voice)) ||
        (item.model === 'kokoro' && item.voice === 'af_heart') || (item.model === 'nano' && item.voice === 'alba') ||
        (item.model === 'qwen' && item.voice === 'serena' && ['water', 'long'].includes(item.sample));
      if (!knownVoice || !evaluation.samples.some(s => s.id === item.sample) || evaluationAudio.has(key) ||
        typeof item.file_name !== 'string' || !/^[a-z0-9_/-]+\.wav$/.test(item.file_name) || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Invalid evaluation sample.');
      const path = await realpath(resolve(dirname(manifestPath), item.file_name));
      if (!path.startsWith(dirname(manifestPath) + sep) || (await stat(path)).size > 8_000_000) throw new Error('Evaluation audio exceeds its boundary.');
      const audio = await readFile(path);
      total += audio.length;
      if (total > 128_000_000 || !isWav(audio) || sha256(audio) !== item.sha256) throw new Error('Evaluation audio digest mismatch.');
      evaluationAudio.set(key, audio);
    }
  }
  const stream = options.voiceStream ? attachPreviewVoiceStream(app.server, { ...options.voiceStream, allowedHosts: options.allowedHosts }) : undefined;
  if (stream) app.addHook('onClose', async () => stream.close());
  const connectPolicy = stream ? "'self' " + options.voiceStream!.allowedOrigins.map(origin => {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error('Invalid stream origin.');
    return origin.replace(/^http/, 'ws');
  }).join(' ') : "'none'";
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer').header('X-Robots-Tag', 'noindex, nofollow')
      .header('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()')
      .header('Content-Security-Policy', `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src ${connectPolicy}; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
    if (!options.allowedHosts.includes(request.headers.host || '')) return reply.code(403).send('This preview address is not enabled.');
    if (!['GET', 'HEAD'].includes(request.method)) return reply.code(405).header('Allow', 'GET, HEAD').send('This preview is read-only.');
  });
  for (const path of ['/', '/preview', '/preview/']) app.get(path, async (_request, reply) => reply.type('text/html; charset=utf-8').send(html));
  app.get('/health', async () => ({ ok: true, mode: 'device_preview', real_care_data: false, live_conversation: false,
    synthetic_stream_ready: stream?.isReady() ?? false, synthetic_stream_startup: stream?.startup() }));
  app.get('/preview/voice-eval/:model/:voice/:sample.wav', async (request, reply) => {
    const { model, voice, sample } = request.params as { model: string; voice: string; sample: string };
    const bytes = evaluationAudio.get(`${model}/${voice}/${sample}`);
    if (!bytes) return reply.code(404).send('Synthetic sample unavailable.');
    return sendWav(request, reply, bytes);
  });
  app.get('/preview/voice-sample.wav', async (request, reply) => {
    if (!sample) return reply.code(503).send('The synthetic voice sample is unavailable.');
    return sendWav(request, reply, sample);
  });
  app.get('/preview/kokoro/:voice/:sample.wav', async (request, reply) => {
    const { voice, sample: sampleId } = request.params as { voice: string; sample: string };
    const key = `${voice}/${sampleId}`;
    if (!kokoroVoices.some((entry) => entry.id === voice) || !kokoroSamples.some((entry) => entry.id === sampleId)) {
      return reply.code(404).send('Not found.');
    }
    const bytes = kokoro.get(key);
    if (!bytes) return reply.code(503).send('The synthetic Kokoro sample is unavailable.');
    return sendWav(request, reply, bytes);
  });
  app.get('/assets/:name', async (request, reply) => {
    const asset = files.get(`/assets/${(request.params as { name: string }).name}`);
    return asset ? reply.type(asset.mime).send(asset.bytes) : reply.code(404).send('Not found.');
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).type('text/plain').send('Not found.'));
  app.setErrorHandler((_error, _request, reply) => reply.code(400).send('Preview request could not be processed.'));
  return app;
}
