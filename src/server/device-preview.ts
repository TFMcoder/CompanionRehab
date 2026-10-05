import Fastify from 'fastify';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';

export interface PreviewOptions {
  staticRoot?: string;
  allowedHosts: string[];
  samplePath?: string;
  sampleSha256?: string;
}

/** Public-safe, read-only device preview. Deliberately imports no care/auth/provider runtime. */
export async function createDevicePreview(options: PreviewOptions) {
  const root = resolve(options.staticRoot || 'dist/client');
  const files = new Map<string, { bytes: Buffer; mime: string }>();
  const html = await readFile(resolve(root, 'preview.html'));
  const assetRoot = resolve(root, 'assets');
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
    if (bytes.length > 2_000_000 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' ||
      createHash('sha256').update(bytes).digest('hex') !== options.sampleSha256) throw new Error('Preview sample did not match the pinned synthetic WAV.');
    sample = bytes;
  }
  const app = Fastify({ logger: false, trustProxy: false, bodyLimit: 1024, requestTimeout: 10000 });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer').header('X-Robots-Tag', 'noindex, nofollow')
      .header('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()')
      .header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'none'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (!options.allowedHosts.includes(request.headers.host || '')) return reply.code(403).send('This preview address is not enabled.');
    if (!['GET', 'HEAD'].includes(request.method)) return reply.code(405).header('Allow', 'GET, HEAD').send('This preview is read-only.');
  });
  for (const path of ['/', '/preview', '/preview/']) app.get(path, async (_request, reply) => reply.type('text/html; charset=utf-8').send(html));
  app.get('/health', async () => ({ ok: true, mode: 'device_preview', real_care_data: false, live_conversation: false }));
  app.get('/preview/voice-sample.wav', async (request, reply) => {
    if (!sample) return reply.code(503).send('The synthetic voice sample is unavailable.');
    reply.header('Accept-Ranges', 'bytes').type('audio/wav');
    const range = request.headers.range;
    if (!range) return reply.send(sample);
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const invalid = () => reply.code(416).header('Content-Range', `bytes */${sample!.length}`).send();
    if (!match || (!match[1] && !match[2])) return invalid();
    const start = match[1] ? Number(match[1]) : Math.max(0, sample.length - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), sample.length - 1) : sample.length - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= sample.length) return invalid();
    return reply.code(206).header('Content-Range', `bytes ${start}-${end}/${sample.length}`).send(sample.subarray(start, end + 1));
  });
  app.get('/assets/:name', async (request, reply) => {
    const asset = files.get(`/assets/${(request.params as { name: string }).name}`);
    return asset ? reply.type(asset.mime).send(asset.bytes) : reply.code(404).send('Not found.');
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).type('text/plain').send('Not found.'));
  app.setErrorHandler((_error, _request, reply) => reply.code(400).send('Preview request could not be processed.'));
  return app;
}
