// Create a pinned public catalogue from ONLY the known synthetic experiment outputs.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import catalogue from '../src/shared/voice-evaluation.json';
const root = resolve('.local/probes/voice-eval');
const samples: { model: string; voice: string; sample: string; file_name: string; sha256: string }[] = [];
for (const model of ['pocket', 'kokoro', 'nano', 'qwen']) {
  let manifest: any;
  try { manifest = JSON.parse(await readFile(resolve(root, model, 'manifest.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
  for (const item of manifest.samples) {
    if (item.repeat !== 1) continue;
    const voice = item.voice || item.voice_id;
    const sample = item.sample || item.sample_id;
    if (!catalogue.samples.some(s => s.id === sample) || !['alba', 'anna', 'af_heart', 'serena'].includes(voice) ||
        !/^[a-z0-9_-]+\.wav$/.test(item.file_name)) throw new Error('Unexpected synthetic catalogue entry.');
    const file = resolve(root, model, item.file_name);
    if ((await stat(file)).size > 8_000_000) throw new Error('Sample exceeds limit.');
    const bytes = await readFile(file);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== item.sha256) throw new Error('Synthetic sample checksum mismatch.');
    samples.push({ model, voice, sample, file_name: relative(root, file).replaceAll('\\', '/'), sha256 });
  }
}
const bytes = Buffer.from(JSON.stringify({ schema_version: 1, data_origin: catalogue.data_origin, samples }, null, 2) + '\n');
await writeFile(resolve(root, 'manifest.json'), bytes);
console.log(JSON.stringify({ samples: samples.length, PREVIEW_EVALUATION_SHA256: createHash('sha256').update(bytes).digest('hex') }));
