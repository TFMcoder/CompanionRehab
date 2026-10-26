/** Only the separate owner process can select a private patched release. */
import{selectOwnerRelease}from'./owner-release.js';
import{writeFile,rename}from'node:fs/promises';import{join}from'node:path';
const entry=await selectOwnerRelease(process.cwd(),new URL('./owner-test-runtime.ts',import.meta.url));
await import(entry.href);
const proof=join(process.cwd(),'.local/owner-test/runtime/active-release.json');
try{await writeFile(proof+'.tmp',JSON.stringify({observed_at:new Date().toISOString(),pid:process.pid,entry:entry.href})+'\n');await rename(proof+'.tmp',proof);}catch{console.error('Owner release startup metadata is unavailable.');}
