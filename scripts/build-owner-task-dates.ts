/** Build the date-only task review repair without writing the live Current build. */
import{build}from'vite';
import{readFile,writeFile}from'node:fs/promises';
import{resolve}from'node:path';
import{ownerTestDirectory,ownerTestSchema,ownerTestIndex}from'../src/server/owner-test-config.js';
const settings=ownerTestSchema.parse(JSON.parse(await readFile(ownerTestDirectory+'/config.json','utf8')));
const current=await readFile(ownerTestDirectory+'/client/index.html','utf8'),notice=current.match(/<aside class="owner-test-notice"[^>]*>[\s\S]*?<\/aside>/)?.[0];
if(!notice||settings.port!==8788)throw Error('Expected the existing owner-only Current page.');
const out=resolve('.local/asana-voice-2026-10-24/client-build');
await build({configFile:false,define:{__NANCY_OWNER_TASK_DATES__:'true'},build:{outDir:out,emptyOutDir:true,rollupOptions:{input:{app:'index.html'}}}});
const html=ownerTestIndex(await readFile(out+'/index.html','utf8')).replace(/<aside class="owner-test-notice"[^>]*>[\s\S]*?<\/aside>/,notice);
await writeFile(out+'/index.html',html);
console.log('Built only the owner task-date preview; live client assets and voice settings were not written.');
