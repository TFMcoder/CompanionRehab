/** Isolated owner build: never overwrites the live Current client. */
import{build}from'vite';import{readFile,writeFile}from'node:fs/promises';import{resolve}from'node:path';
import{ownerTestDirectory,ownerTestSchema,ownerTestIndex}from'../src/server/owner-test-config.js';
const settings=ownerTestSchema.parse(JSON.parse(await readFile(ownerTestDirectory+'/config.json','utf8')));
if(settings.port!==8788)throw Error('Expected the separate owner copy.');
const current=await readFile(ownerTestDirectory+'/client/index.html','utf8'),notice=current.match(/<aside class="owner-test-notice"[^>]*>[\s\S]*?<\/aside>/)?.[0];
if(!notice)throw Error('Missing owner practice notice.');
const out=resolve('.local/voice-startup-2026-10-24/client-build');
await build({configFile:false,define:{__NANCY_OWNER_TASK_DATES__:'true',__NANCY_OWNER_VOICE_STARTUP__:'true'},build:{outDir:out,emptyOutDir:true,rollupOptions:{input:{app:'index.html',safari:'safari-test.html'}}}});
await writeFile(out+'/index.html',ownerTestIndex(await readFile(out+'/index.html','utf8')).replace(/<aside class="owner-test-notice"[^>]*>[\s\S]*?<\/aside>/,notice));
console.log('Built the owner-only voice startup repair; live assets and all voice/model settings were not written.');
