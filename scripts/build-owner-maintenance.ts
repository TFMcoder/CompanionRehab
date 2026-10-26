/** Build the owner release with its own patched dependencies and existing settings. */
import{build}from'vite';import{readFile,writeFile}from'node:fs/promises';import{resolve,join}from'node:path';
import{ownerTestSchema,ownerTestIndex}from'../src/server/owner-test-config.js';
const flag=process.argv.indexOf('--workspace'),workspace=flag>=0?resolve(process.argv[flag+1]??''):undefined;
if(!workspace||resolve('.').toLowerCase()!==join(workspace,'.local/owner-test/releases/maintenance-2026-10-25').toLowerCase())throw Error('Build only from the staged owner maintenance release.');
const settings=ownerTestSchema.parse(JSON.parse(await readFile(join(workspace,'.local/owner-test/config.json'),'utf8')));
if(settings.port!==8788)throw Error('Owner port mismatch.');
const current=await readFile(join(workspace,'.local/owner-test/client/index.html'),'utf8'),notice=current.match(/<aside class="owner-test-notice"[^>]*>[\s\S]*?<\/aside>/)?.[0];
if(!notice)throw Error('Existing owner notice missing.');
const out=join(workspace,'.local/maintenance-2026-10-25/client-build');
await build({configFile:false,define:{__NANCY_OWNER_TASK_DATES__:'true',__NANCY_OWNER_VOICE_STARTUP__:'true'},build:{outDir:out,emptyOutDir:true,rollupOptions:{input:{app:'index.html',safari:'safari-test.html',asana:'asana-test.html'}}}});
await writeFile(join(out,'index.html'),ownerTestIndex(await readFile(join(out,'index.html'),'utf8')).replace(/<aside class="owner-test-notice"[^>]*>[\s\S]*?<\/aside>/,notice));
console.log('Built owner maintenance assets with isolated patched dependencies; no live assets or voice settings written.');
