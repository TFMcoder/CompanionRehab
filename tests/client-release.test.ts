import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {selectClientRelease} from '../src/server/client-release';

const created:string[]=[];
afterEach(async()=>{for(const root of created.splice(0))await rm(root,{recursive:true,force:true});});
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'nancy-client-release-'));created.push(root);
  const release=join(root,'.local/client/releases/review-one'),runtime=join(root,'.local/runtime');
  await mkdir(runtime,{recursive:true});
  const files:Record<string,string>={
    'src/server/client-runtime.ts':'export const isolatedClientRelease=true;',
    'package.json':JSON.stringify({dependencies:{zod:'4.6.7'},devDependencies:{}}),
    'package-lock.json':'{"synthetic":true}',
    'dist/client/index.html':'<script type="module" src="/assets/app.js"></script>',
    'dist/client/assets/app.js':'export const version="review-one";',
  };
  for(const [file,text] of Object.entries(files)){await mkdir(dirname(join(release,file)),{recursive:true});await writeFile(join(release,file),text);}
  await mkdir(join(release,'node_modules/zod'),{recursive:true});
  await writeFile(join(release,'node_modules/zod/package.json'),JSON.stringify({version:'4.6.7'}));
  const manifest={schema_version:1,entry:'src/server/client-runtime.ts',implementation_revision:'sha256:'+'a'.repeat(64),files:Object.fromEntries(Object.entries(files).map(([file,text])=>[file,sha(text)]))};
  async function pointer(extra:Record<string,unknown>={}){
    const bytes=JSON.stringify(manifest);await writeFile(join(release,'release-manifest.json'),bytes);
    await writeFile(join(runtime,'release.json'),JSON.stringify({schema_version:1,release_id:'review-one',manifest_sha256:sha(bytes),...extra}));
  }
  await pointer();return {root,release,runtime,manifest,pointer,fallback:new URL('file:///synthetic/client-runtime.ts')};
}

describe('isolated live client release selection',()=>{
  it('retains the existing runtime when no explicit client release is selected',async()=>{
    const root=await mkdtemp(join(tmpdir(),'nancy-client-default-'));created.push(root);
    const fallback=new URL('file:///synthetic/client-runtime.ts');
    expect(await selectClientRelease(root,fallback)).toBe(fallback);
  });
  it('selects verified client code/assets without changing the workspace or owner pointer',async()=>{
    const f=await fixture(),cwd=process.cwd(),ownerRuntime=join(f.root,'.local/owner-test/runtime');
    await mkdir(ownerRuntime,{recursive:true});await writeFile(join(ownerRuntime,'release.json'),'synthetic owner pointer must not be read');
    const selected=await selectClientRelease(f.root,f.fallback);
    expect(selected.href).toBe(pathToFileURL(join(f.release,'src/server/client-runtime.ts')).href);
    expect(await readFile(new URL('../../dist/client/index.html',selected),'utf8')).toContain('/assets/app.js');
    expect(process.cwd()).toBe(cwd);
    expect(await readFile(join(ownerRuntime,'release.json'),'utf8')).toBe('synthetic owner pointer must not be read');
  });
  it('never treats an owner test pointer as a live client selection',async()=>{
    const root=await mkdtemp(join(tmpdir(),'nancy-owner-only-pointer-'));created.push(root);
    await mkdir(join(root,'.local/owner-test/runtime'),{recursive:true});
    await writeFile(join(root,'.local/owner-test/runtime/release.json'),JSON.stringify({schema_version:1,release_id:'owner-test',manifest_sha256:'a'.repeat(64)}));
    const fallback=new URL('file:///synthetic/client-runtime.ts');expect(await selectClientRelease(root,fallback)).toBe(fallback);
  });
  it.each(['src/server/client-runtime.ts','dist/client/assets/app.js'])('refuses changed selected code or assets instead of falling back: %s',async file=>{
    const f=await fixture();await writeFile(join(f.release,file),'changed after qualification');
    await expect(selectClientRelease(f.root,f.fallback)).rejects.toThrow('source changed');
  });
  it('refuses a changed manifest and mismatched installed dependency',async()=>{
    const f=await fixture();await writeFile(join(f.release,'release-manifest.json'),'{}');
    await expect(selectClientRelease(f.root,f.fallback)).rejects.toThrow('manifest changed');
    await f.pointer();await writeFile(join(f.release,'node_modules/zod/package.json'),'{"version":"4.1.12"}');
    await expect(selectClientRelease(f.root,f.fallback)).rejects.toThrow('installed dependency');
  });
  it.each([{release_id:'../owner-test'}, {unexpected:true}])('rejects traversal or extra pointer fields: %j',async override=>{
    const f=await fixture();await f.pointer(override);
    await expect(selectClientRelease(f.root,f.fallback)).rejects.toThrow('pointer');
  });
  it.each(['../outside','src/../../outside','.local/private.json','src/.env.local','src/file:stream','node_modules/zod/package.json'])('rejects unsafe or private manifest paths: %s',async file=>{
    const f=await fixture();f.manifest.files[file]='a'.repeat(64);await f.pointer();
    await expect(selectClientRelease(f.root,f.fallback)).rejects.toThrow('source reference');
  });
  it('requires the client runtime, revision and selected index page',async()=>{
    const wrong=await fixture();wrong.manifest.entry='src/server/owner-test-runtime.ts';await wrong.pointer();
    await expect(selectClientRelease(wrong.root,wrong.fallback)).rejects.toThrow('manifest is invalid');
    const revision=await fixture();revision.manifest.implementation_revision='unqualified';await revision.pointer();
    await expect(selectClientRelease(revision.root,revision.fallback)).rejects.toThrow('manifest is invalid');
    const missing=await fixture();delete missing.manifest.files['dist/client/index.html'];await missing.pointer();
    await expect(selectClientRelease(missing.root,missing.fallback)).rejects.toThrow('incomplete');
  });
  it('refuses unlisted stale source so an unqualified runtime cannot be imported later',async()=>{
    const f=await fixture();await writeFile(join(f.release,'src/server/obsolete.ts'),'export const stale=true;');
    await expect(selectClientRelease(f.root,f.fallback)).rejects.toThrow('unqualified extra source');
  });
});
