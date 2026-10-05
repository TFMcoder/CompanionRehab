import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createDevicePreview } from '../src/server/device-preview.js';

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
});
