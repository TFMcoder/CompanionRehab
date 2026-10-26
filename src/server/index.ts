/** The live client keeps its workspace/private state while selecting a pinned release. */
import {selectClientRelease} from './client-release.js';
import {mkdir,writeFile,rename} from 'node:fs/promises';
import {dirname,join} from 'node:path';

const entry=await selectClientRelease(process.cwd(),new URL('./client-runtime.ts',import.meta.url));
await import(entry.href);
const proof=join(process.cwd(),'.local/runtime/active-release.json');
try{
  await mkdir(dirname(proof),{recursive:true});
  await writeFile(proof+'.tmp',JSON.stringify({observed_at:new Date().toISOString(),pid:process.pid,entry:entry.href})+'\n');
  await rename(proof+'.tmp',proof);
}catch{console.error('Client release startup metadata is unavailable.');}
