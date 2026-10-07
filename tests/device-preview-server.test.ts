import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createDevicePreview } from '../src/server/device-preview.js';
import { kokoroSamples, kokoroVoices } from '../src/shared/kokoro-samples.js';

describe('public device preview isolation', () => {
  let root: string;
  const host = 'preview.example.invalid';
  const sample = Buffer.from('RIFF0000WAVEsynthetic-fixture');
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'nancy-preview-'));
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'preview.html'), '<!doctype html><title>Nancy device preview</title>');
    await writeFile(join(root, 'assets', 'preview-test.js'), 'console.log("synthetic")');
    await writeFile(join(root, 'assets', 'private.map'), 'private-source-map');
    await writeFile(join(root, '.env.local'), 'secret-fixture');
    await writeFile(join(root, 'sample.wav'), sample);
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const options = () => ({ staticRoot: root, allowedHosts: [host], samplePath: join(root, 'sample.wav'), sampleSha256: createHash('sha256').update(sample).digest('hex') });
  const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  async function makeKokoroManifest() {
    const directory = join(root, 'kokoro');
    await mkdir(directory);
    const samples = [];
    for (const voice of kokoroVoices) for (const entry of kokoroSamples) {
      const file_name = `${voice.id}-${entry.id}.wav`;
      const bytes = Buffer.from(`RIFF0000WAVEsynthetic-${voice.id}-${entry.id}`);
      await writeFile(join(directory, file_name), bytes);
      samples.push({ voice_id: voice.id, sample_id: entry.id, file_name, sha256: digest(bytes) });
    }
    const manifest = { schema_version: 1, model: 'Kokoro-82M', engine: 'kokoro-js', samples };
    const manifestPath = join(directory, 'manifest.json');
    const save = async () => {
      const bytes = Buffer.from(JSON.stringify(manifest));
      await writeFile(manifestPath, bytes);
      return { kokoroManifestPath: manifestPath, kokoroManifestSha256: digest(bytes) };
    };
    return { manifest, manifestPath, directory, save };
  }
  it('serves only built preview assets with no provider/care endpoints or arbitrary file access', async () => {
    const app = await createDevicePreview(options());
    try {
      const page = await app.inject({ url: '/preview', headers: { host } });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('Nancy device preview');
      expect(page.headers['content-security-policy']).toContain("connect-src 'none'");
      expect(page.headers['permissions-policy']).toContain('microphone=(self)');
      expect((await app.inject({ url: '/assets/preview-test.js', headers: { host } })).statusCode).toBe(200);
      for (const url of ['/api/today', '/api/voice', '/auth/callback', '/.env.local', '/.local/runtime/chatgpt-plan.enc', '/assets/private.map', '/assets/%2e%2e%2f.env.local', '/sample.wav']) {
        const denied = await app.inject({ url, headers: { host } });
        expect(denied.statusCode).toBeGreaterThanOrEqual(400);
        expect(denied.body).not.toMatch(/secret-fixture|private-source-map/);
      }
      expect((await app.inject({ url: '/health', headers: { host } })).json()).toMatchObject({ real_care_data: false, live_conversation: false });
    } finally { await app.close(); }
  });
  it('rejects wrong hosts and every write, including recording uploads', async () => {
    const app = await createDevicePreview(options());
    try {
      expect((await app.inject({ url: '/', headers: { host: 'other.example' } })).statusCode).toBe(403);
      for (const method of ['POST', 'PUT', 'DELETE'] as const) {
        expect((await app.inject({ method, url: '/api/voice', headers: { host }, payload: 'private audio' })).statusCode).toBe(405);
      }
    } finally { await app.close(); }
  });
  it('serves assets when the selected build root is a directory alias', async () => {
    const alias = join(root, 'build-alias');
    await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      const app = await createDevicePreview({ ...options(), staticRoot: alias });
      try {
        const response = await app.inject({ url: '/assets/preview-test.js', headers: { host } });
        expect(response.statusCode).toBe(200);
        expect(response.body).toBe('console.log("synthetic")');
      } finally { await app.close(); }
    } finally { await unlink(alias); }
  });
  it('rejects an assets directory alias that escapes the selected build root', async () => {
    const build = join(root, 'isolated-build');
    await mkdir(build);
    await writeFile(join(build, 'preview.html'), '<title>Preview</title>');
    const alias = join(build, 'assets');
    await symlink(join(root, 'assets'), alias, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      await expect(createDevicePreview({ ...options(), staticRoot: build })).rejects.toThrow('Preview assets escaped their build directory');
    } finally { await unlink(alias); }
  });
  it('serves only the pinned synthetic audio with mobile byte-range support', async () => {
    const app = await createDevicePreview(options());
    try {
      const full = await app.inject({ url: '/preview/voice-sample.wav', headers: { host } });
      expect(full.rawPayload).toEqual(sample);
      const partial = await app.inject({ url: '/preview/voice-sample.wav', headers: { host, range: 'bytes=0-11' } });
      expect(partial.statusCode).toBe(206);
      expect(partial.rawPayload).toEqual(sample.subarray(0, 12));
      expect(partial.headers['content-range']).toBe(`bytes 0-11/${sample.length}`);
      expect((await app.inject({ url: '/preview/voice-sample.wav', headers: { host, range: 'bytes=99999-' } })).statusCode).toBe(416);
    } finally { await app.close(); }
    await expect(createDevicePreview({ ...options(), sampleSha256: '0'.repeat(64) })).rejects.toThrow('pinned synthetic WAV');
  });
  it('reports an unavailable sample instead of serving unverified private audio', async () => {
    const app = await createDevicePreview({ staticRoot: root, allowedHosts: [host] });
    try { expect((await app.inject({ url: '/preview/voice-sample.wav', headers: { host } })).statusCode).toBe(503); }
    finally { await app.close(); }
  });
  it('serves only nine verified Kokoro auditions and handles iPhone byte ranges', async () => {
    const fixture = await makeKokoroManifest();
    const app = await createDevicePreview({ ...options(), ...await fixture.save() });
    try {
      for (const voice of kokoroVoices) for (const entry of kokoroSamples) {
        const url = `/preview/kokoro/${voice.id}/${entry.id}.wav`;
        const expected = await readFile(join(fixture.directory, `${voice.id}-${entry.id}.wav`));
        const response = await app.inject({ url, headers: { host } });
        expect(response.statusCode).toBe(200);
        expect(response.rawPayload).toEqual(expected);
        expect(response.headers['content-type']).toMatch(/^audio\/wav/);
        expect(response.headers['cache-control']).toBe('no-store');
      }
      const url = '/preview/kokoro/af_heart/morning.wav';
      const first = await app.inject({ url, headers: { host, range: 'bytes=0-11' } });
      expect(first.statusCode).toBe(206);
      expect(first.rawPayload).toEqual(Buffer.from('RIFF0000WAVE'));
      expect(first.headers['accept-ranges']).toBe('bytes');
      const suffix = await app.inject({ url, headers: { host, range: 'bytes=-4' } });
      expect(suffix.statusCode).toBe(206);
      expect(suffix.rawPayload.toString()).toBe('ning');
      const invalid = await app.inject({ url, headers: { host, range: 'bytes=99999-' } });
      expect(invalid.statusCode).toBe(416);
      expect(invalid.headers['content-range']).toMatch(/^bytes \*\//);
      for (const denied of ['/preview/kokoro/unknown/morning.wav', '/preview/kokoro/af_heart/unknown.wav', '/preview/kokoro/af_heart/%2e%2e.wav', '/preview/kokoro/manifest.json']) {
        expect((await app.inject({ url: denied, headers: { host } })).statusCode).toBe(404);
      }
      expect((await app.inject({ method: 'POST', url, headers: { host }, payload: 'audio' })).statusCode).toBe(405);
    } finally { await app.close(); }
  });
  it('keeps known Kokoro routes unavailable until a pinned manifest is provided', async () => {
    const app = await createDevicePreview(options());
    try {
      expect((await app.inject({ url: '/preview/kokoro/af_bella/meals.wav', headers: { host } })).statusCode).toBe(503);
      expect((await app.inject({ url: '/preview/kokoro/nope/meals.wav', headers: { host } })).statusCode).toBe(404);
    } finally { await app.close(); }
  });
  it('rejects a changed manifest, changed audio, and path substitution at startup', async () => {
    const fixture = await makeKokoroManifest();
    const pinned = await fixture.save();
    await expect(createDevicePreview({ ...options(), ...pinned, kokoroManifestSha256: '0'.repeat(64) })).rejects.toThrow('manifest did not match');
    await writeFile(join(fixture.directory, 'af_heart-morning.wav'), 'RIFF0000WAVEchanged');
    await expect(createDevicePreview({ ...options(), ...pinned })).rejects.toThrow('sample did not match');
    fixture.manifest.samples[0].file_name = '../sample.wav';
    await expect(createDevicePreview({ ...options(), ...await fixture.save() })).rejects.toThrow('unknown or duplicate sample');
  });
});
