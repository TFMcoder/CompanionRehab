import { createDevicePreview } from '../src/server/device-preview.js';

// No .env.local load: the public preview has no provider, database or session credentials.
const port = Number(process.env.PREVIEW_PORT || '8820');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port.');
const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
if (process.env.PREVIEW_PUBLIC_ORIGIN) {
  const origin = new URL(process.env.PREVIEW_PUBLIC_ORIGIN);
  if (origin.protocol !== 'https:' || origin.origin !== process.env.PREVIEW_PUBLIC_ORIGIN || origin.username || origin.password) throw new Error('Preview public address must be an HTTPS origin.');
  allowedHosts.push(origin.host);
}
const app = await createDevicePreview({ allowedHosts, samplePath: '.local/probes/nancy-local-voice.wav', sampleSha256: process.env.PREVIEW_SAMPLE_SHA256 });
await app.listen({ host: '127.0.0.1', port });
console.log(`Nancy device preview is running on http://127.0.0.1:${port}/preview`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
