import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { LocalSpeech, kokoroPronunciationInput, validateSpeechText, validateWav } from '../src/server/local-speech.js';

const dirs: string[] = [];
function fakeWav() {
  const wav = Buffer.alloc(46);
  wav.write('RIFF', 0); wav.writeUInt32LE(38, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(2, 40); wav.writeInt16LE(1, 44);
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
let active;
let synthCount=0;
createInterface({input:process.stdin}).on('line', line => {
  const r=JSON.parse(line);
  if(r.type==='cancel') { if(active?.id===r.id) active.cancelled=true; return; }
  const job={id:r.id,cancelled:false}; active=job;
  setTimeout(()=>{
    if(job.cancelled) console.log(JSON.stringify({type:'cancelled',id:r.id}));
    else {
      let value='Synthetic hello.';
      if(kind==='kokoro') {
        const wav=Buffer.from(${JSON.stringify(audio)},'base64');
        wav.writeUInt32LE(2,40); wav.writeUInt32LE(38,4);
        wav.writeInt16LE(++synthCount,44);
        value=wav.toString('base64');
      }
      console.log(JSON.stringify({type:'result',id:r.id,value}));
    }
    if(active===job) active=undefined;
  },r.text==='wait'?180:5);
});
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

  it('applies REEhab pronunciation only to the synthesis input', () => {
    expect(kokoroPronunciationInput('Rehab helps after rehab.')).toBe('Reehab helps after reehab.');
    expect(kokoroPronunciationInput('rehabilitation and prehab')).toBe('rehabilitation and prehab');
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

  it('caches exact greeting audio in bounded memory and returns a defensive copy', async () => {
    const service = await makeService();
    try {
      await service.ready();
      const first = await service.synthesize('Hi Sam, what can I help with?');
      const second = await service.synthesize('Hi Sam, what can I help with?');
      expect(first).toEqual(second);
      first[44] = 0;
      expect(second[44]).toBe(1);
      expect(await service.synthesize('Please help with exercise.')).not.toEqual(second);
    } finally { await service.close(); }
  });

  it('primes only fixed navigation acknowledgements and never caches arbitrary care answers', async () => {
    const service = await makeService();
    try {
      await service.primeNavigation();
      const first = await service.synthesize('Here are your tasks.');
      expect(await service.synthesize('Here are your tasks.')).toEqual(first);
      const careAnswer = await service.synthesize('Your appointment is at ten.');
      expect(await service.synthesize('Your appointment is at ten.')).not.toEqual(careAnswer);
      const controller = new AbortController(); controller.abort();
      await expect(service.synthesize('Here are your tasks.', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    } finally { await service.close(); }
  });

  it('suppresses cancelled output and queues one next request behind the still-warm worker', async () => {
    const service = await makeService();
    const controller = new AbortController();
    try {
      await service.ready();
      const pending = service.synthesize('wait', controller.signal);
      await new Promise(resolve => setTimeout(resolve, 30));
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      // The native call is still draining; one following request waits rather than
      // killing/reloading the expensive warm model or failing as busy.
      expect(await service.synthesize('The worker recovered.')).toEqual(fakeWav());
      expect(service.readiness()).toEqual({ kokoro: 'ready', asr: 'ready' });
    } finally { await service.close(); }
  });
});
