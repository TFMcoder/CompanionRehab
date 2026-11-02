import {createHash} from 'node:crypto';
import {readFileSync, realpathSync, statSync} from 'node:fs';
import {isAbsolute, relative, resolve, sep} from 'node:path';
import {z} from 'zod';

const sha256=z.string().regex(/^[a-f0-9]{64}$/);
const selectionSchema=z.object({
  version:z.literal(1),
  kokoroRuntime:z.string().min(1),
  pythonExecutable:z.string().min(1),
  kokoroLockSha256:sha256,
  pythonExecutableSha256:sha256,
}).strict();

function within(parent:string,target:string){
  const child=relative(parent,target);
  return child!==''&&!isAbsolute(child)&&child!=='..'&&!child.startsWith(`..${sep}`);
}
function privatePath(privateRoot:string,path:string,kind:'file'|'directory'){
  if(!isAbsolute(path))throw new Error('Invalid speech runtime selection.');
  const actual=realpathSync(path);
  if(!within(privateRoot,actual))throw new Error('Invalid speech runtime selection.');
  const stat=statSync(actual);
  if(kind==='file'?!stat.isFile():!stat.isDirectory())throw new Error('Invalid speech runtime selection.');
  return actual;
}
function digest(path:string){return createHash('sha256').update(readFileSync(path)).digest('hex');}

/** Explicit private deployment selection. Model, cache, voice and worker settings are not configurable here. */
export function speechDependencyPaths(root:string,configPath=process.env.NANCY_SPEECH_RUNTIME_CONFIG){
  const defaults={kokoroRuntime:resolve(root,'.local/speech/kokoro-runtime'),pythonExecutable:resolve(root,'.local/speech/runtime/venv/Scripts/python.exe')};
  if(configPath===undefined)return defaults;
  try{
    const privateRoot=realpathSync(resolve(root,'.local'));
    const file=privatePath(privateRoot,configPath,'file');
    if(statSync(file).size>16*1024)throw new Error('Invalid speech runtime selection.');
    const selected=selectionSchema.parse(JSON.parse(readFileSync(file,'utf8')));
    const kokoroRuntime=privatePath(privateRoot,selected.kokoroRuntime,'directory');
    const pythonExecutable=privatePath(privateRoot,selected.pythonExecutable,'file');
    const lock=privatePath(privateRoot,resolve(kokoroRuntime,'package-lock.json'),'file');
    // These hashes bind the reviewed selection, not the integrity of every dependency
    // or the Python base installation. Native/version qualification remains required.
    if(digest(lock)!==selected.kokoroLockSha256||digest(pythonExecutable)!==selected.pythonExecutableSha256)throw new Error('Invalid speech runtime selection.');
    for(const entry of ['kokoro-js/dist/kokoro.js','@huggingface/transformers/dist/transformers.node.mjs']){
      privatePath(privateRoot,resolve(kokoroRuntime,'node_modules',entry),'file');
    }
    return {kokoroRuntime,pythonExecutable};
  }catch{
    // An explicit broken selection must never silently resume the older runtime.
    throw new Error('The selected local speech runtime is unavailable or invalid.');
  }
}
