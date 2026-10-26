import{afterEach,describe,expect,it}from'vitest';
import{mkdtemp,mkdir,writeFile,readFile,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{pathToFileURL}from'node:url';import{createHash}from'node:crypto';
import{selectOwnerRelease}from'../src/server/owner-release';
const created:string[]=[];afterEach(async()=>{for(const root of created.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'nancy-owner-release-'));created.push(root);
 const release=join(root,'.local/owner-test/releases/review-one'),runtime=join(root,'.local/owner-test/runtime');await mkdir(join(release,'src/server'),{recursive:true});await mkdir(runtime,{recursive:true});
 const files={'src/server/owner-test-runtime.ts':'export const synthetic=true;','package.json':JSON.stringify({dependencies:{zod:'4.6.7'},devDependencies:{}}),'package-lock.json':'{"synthetic":true}'};
 for(const[file,text]of Object.entries(files))await writeFile(join(release,file),text);
 await mkdir(join(release,'node_modules/zod'),{recursive:true});await writeFile(join(release,'node_modules/zod/package.json'),JSON.stringify({version:'4.6.7'}));
 const manifest={schema_version:1,entry:'src/server/owner-test-runtime.ts',files:Object.fromEntries(Object.entries(files).map(([n,text])=>[n,createHash('sha256').update(text).digest('hex')]))};
 async function pointer(){const bytes=JSON.stringify(manifest);await writeFile(join(release,'release-manifest.json'),bytes);await writeFile(join(runtime,'release.json'),JSON.stringify({schema_version:1,release_id:'review-one',manifest_sha256:createHash('sha256').update(bytes).digest('hex')}));}
 await pointer();return{root,release,runtime,manifest,pointer,fallback:new URL('file:///synthetic/fallback.ts')};
}
describe('private owner release selection',()=>{
 it('retains the ordinary owner entry when no explicit release exists',async()=>{const root=await mkdtemp(join(tmpdir(),'nancy-owner-empty-'));created.push(root);const fallback=new URL('file:///synthetic/fallback.ts');expect(await selectOwnerRelease(root,fallback)).toBe(fallback);});
 it('loads only the verified owner source tree with matching installed dependencies',async()=>{const f=await fixture();expect((await selectOwnerRelease(f.root,f.fallback)).href).toBe(pathToFileURL(join(f.release,'src/server/owner-test-runtime.ts')).href);});
 it('refuses changed source instead of silently falling back',async()=>{const f=await fixture();await writeFile(join(f.release,'src/server/owner-test-runtime.ts'),'changed');await expect(selectOwnerRelease(f.root,f.fallback)).rejects.toThrow('source changed');});
 it('refuses a changed manifest and an installed dependency mismatch',async()=>{const f=await fixture();await writeFile(join(f.release,'release-manifest.json'),'{}');await expect(selectOwnerRelease(f.root,f.fallback)).rejects.toThrow('manifest changed');await f.pointer();await writeFile(join(f.release,'node_modules/zod/package.json'),'{"version":"4.1.12"}');await expect(selectOwnerRelease(f.root,f.fallback)).rejects.toThrow('installed dependency');});
 it('refuses traversal and unexpected release-pointer fields',async()=>{const f=await fixture();await writeFile(join(f.runtime,'release.json'),JSON.stringify({schema_version:1,release_id:'../outside',manifest_sha256:'a'.repeat(64)}));await expect(selectOwnerRelease(f.root,f.fallback)).rejects.toThrow('pointer');});
 it('rejects a source path outside the pinned release',async()=>{const f=await fixture();(f.manifest.files as Record<string,string>)['../outside']='a'.repeat(64);await f.pointer();await expect(selectOwnerRelease(f.root,f.fallback)).rejects.toThrow('source reference');});
 it('requires the package manifest hash and refuses stale unlisted source',async()=>{const f=await fixture();delete (f.manifest.files as Record<string,string>)['package.json'];await f.pointer();await expect(selectOwnerRelease(f.root,f.fallback)).rejects.toThrow('incomplete');const other=await fixture();await writeFile(join(other.release,'src/server/obsolete.ts'),'export const stale=true;');await expect(selectOwnerRelease(other.root,other.fallback)).rejects.toThrow('unqualified extra source');});
});
