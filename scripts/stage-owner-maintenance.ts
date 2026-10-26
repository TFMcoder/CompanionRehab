/** Stage public source only; credentials and installed main packages are never copied. */
import{execFileSync}from'node:child_process';import{mkdir,readFile,writeFile,copyFile,lstat,realpath}from'node:fs/promises';import{resolve,join,dirname}from'node:path';import{createHash}from'node:crypto';
const workspace=resolve('.'),id='maintenance-2026-10-25',release=join(workspace,'.local/owner-test/releases',id);
try{const p=JSON.parse(await readFile('.local/owner-test/runtime/release.json','utf8'));if(p.release_id===id)throw Error('Never restage an active owner release.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
await mkdir(release,{recursive:true});if((await realpath(release)).toLowerCase()!==release.toLowerCase())throw Error('Owner release path redirects elsewhere.');
const roots=new Set(['package.json','package-lock.json','tsconfig.json','vite.config.ts','vitest.config.ts','index.html','preview.html','safari-test.html','asana-test.html','.env.example','.gitignore','README.md','AGENTS.md']);
const listed=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8',maxBuffer:8e6}).split('\0').filter(Boolean);
const files=[...new Set(listed.filter(p=>roots.has(p)||/^(src|tests|scripts|db|docs|\.github)\//.test(p)))].sort();
try{const prior=JSON.parse(await readFile(join(release,'release-manifest.json'),'utf8'));for(const file of Object.keys(prior.files??{}))if(!files.includes(file))throw Error('Inactive owner candidate contains obsolete source; stage a fresh release directory.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
const hashes:Record<string,string>={};
for(const file of files){const source=join(workspace,file);let s;try{s=await lstat(source);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}if(!s.isFile()||s.isSymbolicLink())throw Error('Only ordinary public source files may be staged.');const bytes=await readFile(source);await mkdir(dirname(join(release,file)),{recursive:true});await copyFile(source,join(release,file));hashes[file]=createHash('sha256').update(bytes).digest('hex');}
if(!hashes['src/server/owner-test-runtime.ts'])throw Error('Owner runtime entry was not staged.');
const revision=execFileSync(process.execPath,['--import','tsx','scripts/implementation-revision.ts'],{encoding:'utf8'}).trim();
const manifest={schema_version:1,entry:'src/server/owner-test-runtime.ts',implementation_revision:revision,files:hashes};
await writeFile(join(release,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({owner_source_staged:true,files:Object.keys(hashes).length,revision,main_dependencies_written:false,credentials_copied:false,release_activated:false}));
