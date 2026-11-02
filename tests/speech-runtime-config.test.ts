import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {speechDependencyPaths} from '../src/server/speech-runtime-config.js';

const roots:string[]=[];
afterEach(()=>{
  vi.unstubAllEnvs();
  for(const root of roots.splice(0)){
    if(dirname(root)!==resolve(tmpdir())||!basename(root).startsWith('nancy-speech-selection-'))throw new Error('Unexpected speech test cleanup target.');
    rmSync(root,{recursive:true,force:true});
  }
});
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'nancy-speech-selection-'));roots.push(root);
  const kokoroRuntime=join(root,'.local','speech-candidate','kokoro');
  const pythonExecutable=join(root,'.local','speech-candidate','python','python.exe');
  const lock=join(kokoroRuntime,'package-lock.json');
  for(const entry of ['kokoro-js/dist/kokoro.js','@huggingface/transformers/dist/transformers.node.mjs']){
    const target=join(kokoroRuntime,'node_modules',entry);mkdirSync(resolve(target,'..'),{recursive:true});writeFileSync(target,'synthetic fixture');
  }
  mkdirSync(resolve(pythonExecutable,'..'),{recursive:true});writeFileSync(pythonExecutable,'synthetic executable fixture');writeFileSync(lock,'{"lockfileVersion":3}');
  const digest=(file:string)=>createHash('sha256').update(readFileSync(file)).digest('hex');
  const data={version:1,kokoroRuntime,pythonExecutable,kokoroLockSha256:digest(lock),pythonExecutableSha256:digest(pythonExecutable)};
  const config=join(root,'.local','speech-selection.json');
  const save=(changes:Record<string,unknown>={})=>writeFileSync(config,JSON.stringify({...data,...changes}));save();
  return {root,config,data,save,lock};
}
describe('reviewed speech dependency selection',()=>{
  it('leaves the original default paths unchanged without a selector',()=>{
    vi.stubEnv('NANCY_SPEECH_RUNTIME_CONFIG',undefined);
    const root=resolve('nonexistent-default-root');
    expect(speechDependencyPaths(root)).toEqual({kokoroRuntime:resolve(root,'.local/speech/kokoro-runtime'),pythonExecutable:resolve(root,'.local/speech/runtime/venv/Scripts/python.exe')});
  });
  it('selects only the reviewed dependency paths from an explicit private manifest',()=>{
    const f=fixture();vi.stubEnv('NANCY_SPEECH_RUNTIME_CONFIG',f.config);
    expect(speechDependencyPaths(f.root)).toEqual({kokoroRuntime:f.data.kokoroRuntime,pythonExecutable:f.data.pythonExecutable});
  });
  it.each(['voice','model','cache','workerScript','heartProfile'])('rejects an attempted %s override',key=>{
    const f=fixture();f.save({[key]:'unreviewed'});expect(()=>speechDependencyPaths(f.root,f.config)).toThrow(/unavailable or invalid/);
  });
  it('fails closed when a reviewed lock or executable changes',()=>{
    const f=fixture();writeFileSync(f.lock,'changed lock');expect(()=>speechDependencyPaths(f.root,f.config)).toThrow(/unavailable or invalid/);
    writeFileSync(f.lock,'{"lockfileVersion":3}');writeFileSync(f.data.pythonExecutable,'changed executable');expect(()=>speechDependencyPaths(f.root,f.config)).toThrow(/unavailable or invalid/);
  });
  it('rejects a relative or non-private configured path',()=>{
    const f=fixture();f.save({kokoroRuntime:'.local/speech-candidate/kokoro'});expect(()=>speechDependencyPaths(f.root,f.config)).toThrow(/unavailable or invalid/);
    const external=join(f.root,'python.exe');writeFileSync(external,'synthetic executable fixture');f.save({pythonExecutable:external});expect(()=>speechDependencyPaths(f.root,f.config)).toThrow(/unavailable or invalid/);
    expect(()=>speechDependencyPaths(f.root,'.local/speech-selection.json')).toThrow(/unavailable or invalid/);
  });
  it('rejects a private junction that resolves outside private storage',()=>{
    const f=fixture();const external=join(f.root,'external');mkdirSync(external);
    writeFileSync(join(external,'python.exe'),'synthetic executable fixture');
    const junction=join(f.root,'.local','escape');symlinkSync(external,junction,'junction');
    f.save({pythonExecutable:join(junction,'python.exe')});
    expect(()=>speechDependencyPaths(f.root,f.config)).toThrow(/unavailable or invalid/);
  });
  it('rejects missing worker dependencies despite matching lock and executable hashes',()=>{
    const f=fixture();unlinkSync(join(f.data.kokoroRuntime,'node_modules/kokoro-js/dist/kokoro.js'));
    expect(()=>speechDependencyPaths(f.root,f.config)).toThrow(/unavailable or invalid/);
  });
  it('rejects a missing or malformed explicit selector instead of falling back',()=>{
    const f=fixture();for(const value of ['',join(f.root,'.local','missing.json')])expect(()=>speechDependencyPaths(f.root,value)).toThrow(/unavailable or invalid/);
    writeFileSync(f.config,'{');expect(()=>speechDependencyPaths(f.root,f.config)).toThrow(/unavailable or invalid/);
    f.save({version:2});expect(()=>speechDependencyPaths(f.root,f.config)).toThrow(/unavailable or invalid/);
  });
});
