import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { LocalSpeech, validateSpeechText, validateWav } from '../src/server/local-speech.js';

const dirs: string[] = [];
function fakeWav() {
  const wav = Buffer.alloc(44);
  wav.write('RIFF', 0); wav.writeUInt32LE(36, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(0, 40);
  return wav;
}

async function makeService() {
  const dir = await mkdtemp(resolve(tmpdir(), 'nancy-local-speech-'));
  dirs.push(dir);
  const script = resolve(dir, 'fake-worker.mjs');
  const audio = fakeWav().toString('base64');
  await writeFile(script, `import { createInterface } from 'node:readline';
const kind=process.argv[2];
console.log(JSON.stringify({type:'ready'}));
for await (const line of createInterface({input:process.stdin})) {
  const r=JSON.parse(line);
  if (r.text==='wait') await new Promise(resolve=>setTimeout(resolve,10000));
  console.log(JSON.stringify({type:'result',id:r.id,value:kind==='kokoro'?${JSON.stringify(audio)}:'Synthetic hello.'}));
}
`, 'utf8');
  const spec = (kind: string) => ({ executable: process.execPath, args: [script, kind], cwd: dir, env: process.env });
  return new LocalSpeech({ workerSpecs: { kokoro: spec('kokoro'), asr: spec('asr') } });
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('LocalSpeech input bounds and worker lifecycle', () => {
  it('validates only bounded text and WAV inputs', () => {
    expect(validateSpeechText('  Hello Nancy.  ')).toBe('Hello Nancy.');
    expect(() => validateSpeechText('  ')).toThrow(RangeError);
    expect(() => validateSpeechText('x'.repeat(1501))).toThrow(RangeError);
    expect(() => validateWav(fakeWav())).not.toThrow();
    expect(() => validateWav(Buffer.from('not audio'))).toThrow(RangeError);
  });

  it('keeps each worker warm and returns audio/transcript without writing request content', async () => {
    const service = await makeService();
    try {
      await service.ready();
      expect(service.readiness()).toEqual({ kokoro: 'ready', asr: 'ready' });
      expect(await service.synthesize('Synthetic sample.')).toEqual(fakeWav());
      expect(await service.transcribe(fakeWav())).toBe('Synthetic hello.');
    } finally { await service.close(); }
  });

  it('aborts an in-flight worker and warms a replacement before the next request', async () => {
    const service = await makeService();
    const controller = new AbortController();
    try {
      await service.ready();
      const pending = service.synthesize('wait', controller.signal);
      await new Promise(resolve => setTimeout(resolve, 30));
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      await service.ready();
      expect(await service.synthesize('The worker recovered.')).toEqual(fakeWav());
    } finally { await service.close(); }
  });
});
