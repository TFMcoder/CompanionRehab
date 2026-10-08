import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

async function makeService(responseDelay = 5) {
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
  },r.text==='wait'?180:${responseDelay});
});
`, 'utf8');
  const spec = (kind: string) => ({ executable: process.execPath, args: [script, kind], cwd: dir, env: process.env });
  return new LocalSpeech({ workerSpecs: { kokoro: spec('kokoro'), asr: spec('asr') } });
}

// Run lifecycle failures in a real Node process, where an unobserved startup
// rejection terminates the server instead of merely failing a mocked promise.
async function workerLifecycleProbe(mode: 'initial-failure' | 'failed-restart' | 'recovery' | 'close-starting') {
  const dir = await mkdtemp(resolve(tmpdir(), 'nancy-worker-lifecycle-'));
  dirs.push(dir);
  const worker = resolve(dir, 'worker.mjs'), harness = resolve(dir, 'harness.mjs');
  await writeFile(worker, `import { createInterface } from 'node:readline';
import { existsSync, writeFileSync } from 'node:fs';
const [kind, mode, marker] = process.argv.slice(2);
if (kind === 'kokoro') {
  if (mode === 'initial-failure' || mode === 'failed-restart' && existsSync(marker)) process.exit(1);
  writeFileSync(marker, 'started');
}
if (mode !== 'close-starting') console.log(JSON.stringify({type:'ready'}));
createInterface({input:process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  if (request.text === 'crash') process.exit(1);
  console.log(JSON.stringify({type:'result', id:request.id, value:${JSON.stringify(fakeWav().toString('base64'))}}));
});
`, 'utf8');
  await writeFile(harness, `import assert from 'node:assert/strict';
import { LocalSpeech } from ${JSON.stringify(new URL('../src/server/local-speech.ts', import.meta.url).href)};
const mode = ${JSON.stringify(mode)};
const spec = kind => ({ executable:process.execPath, args:[${JSON.stringify(worker)},kind,mode,${JSON.stringify(resolve(dir, 'marker'))}], cwd:${JSON.stringify(dir)}, env:process.env });
const speech = new LocalSpeech({workerSpecs:{kokoro:spec('kokoro'),asr:spec('asr')}});
const waitFor = async test => {
  const deadline = Date.now() + 4000;
  while (!test()) { if (Date.now() > deadline) throw new Error('Worker state timed out.'); await new Promise(resolve => setTimeout(resolve,10)); }
};
try {
  if (mode === 'close-starting') {
    await speech.close();
    await new Promise(resolve => setTimeout(resolve,25));
    await assert.rejects(speech.ready(), /closed/);
    assert.deepEqual(speech.readiness(), {kokoro:'unavailable',asr:'unavailable'});
  } else if (mode === 'initial-failure') {
    await waitFor(() => speech.readiness().kokoro === 'unavailable');
    await assert.rejects(speech.ready(), /unavailable/);
  } else {
    await speech.ready();
    await assert.rejects(speech.synthesize('crash'), /unavailable/);
    await waitFor(() => speech.readiness().kokoro === (mode === 'recovery' ? 'ready' : 'unavailable'));
    if (mode === 'recovery') {
      await speech.ready();
      assert.equal((await speech.synthesize('The worker recovered.')).length, 46);
    } else {
      await assert.rejects(speech.ready(), /unavailable/);
    }
  }
  console.log(JSON.stringify({mode, survived:true, readiness:speech.readiness()}));
} finally { await speech.close(); }
`, 'utf8');
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx', harness], {
    cwd: resolve('.'), windowsHide: true, timeout: 10000,
  });
  expect(stderr).toBe('');
  return JSON.parse(stdout.trim()) as { mode: string; survived: boolean; readiness: { kokoro: string; asr: string } };
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

  it('keeps voice starting until navigation priming releases the worker, then accepts the greeting', async () => {
    const service = await makeService(40);
    try {
      const priming = service.primeNavigation();
      expect(service.primeNavigation()).toBe(priming);
      await service.ready();
      expect(service.readiness()).toEqual({ kokoro: 'starting', asr: 'ready' });
      await priming;
      expect(service.readiness()).toEqual({ kokoro: 'ready', asr: 'ready' });
      const greeting = await service.synthesize('Hi Sam, what can I help with?');
      // Six fixed acknowledgements (including Requests), one greeting; concurrent priming was shared.
      expect(greeting.readInt16LE(44)).toBe(7);
    } finally { await service.close(); }
  });

  it.each(['initial-failure', 'failed-restart', 'close-starting'] as const)(
    'keeps the host alive and reports unavailable after %s', async mode => {
      const result = await workerLifecycleProbe(mode);
      expect(result).toMatchObject({ mode, survived: true, readiness: { kokoro: 'unavailable' } });
    },
  );

  it('recovers a ready worker after failure and accepts a later synthesis request', async () => {
    expect(await workerLifecycleProbe('recovery')).toMatchObject({ survived: true, readiness: { kokoro: 'ready', asr: 'ready' } });
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
