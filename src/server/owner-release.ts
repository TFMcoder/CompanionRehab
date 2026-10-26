import{readFile,realpath,readdir}from'node:fs/promises';
import{createHash}from'node:crypto';
import{resolve,join,sep,isAbsolute}from'node:path';
import{pathToFileURL}from'node:url';

/** Owner-only release selection. The main/Dad entry never imports this module.
 * A pinned private source/dependency tree avoids replacing shared node_modules. */
export async function selectOwnerRelease(workspace:string,fallback:URL):Promise<URL>{
  const root=resolve(workspace),pointerPath=join(root,'.local/owner-test/runtime/release.json');
  let pointer:unknown;
  try{pointer=JSON.parse(await readFile(pointerPath,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return fallback;throw new Error('Owner release pointer is invalid.');}
  if(!pointer||typeof pointer!=='object')throw new Error('Owner release pointer is invalid.');
  const p=pointer as Record<string,unknown>;
  if(p.schema_version!==1||typeof p.release_id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(p.release_id)||typeof p.manifest_sha256!=='string'||!/^[a-f0-9]{64}$/.test(p.manifest_sha256)||Object.keys(p).some(k=>!['schema_version','release_id','manifest_sha256'].includes(k)))throw new Error('Owner release pointer is invalid.');
  const expected=join(root,'.local/owner-test/releases',p.release_id),release=await realpath(expected);
  if(release.toLowerCase()!==expected.toLowerCase())throw new Error('Owner release cannot redirect outside its private directory.');
  const bytes=await readFile(join(release,'release-manifest.json'));
  if(createHash('sha256').update(bytes).digest('hex')!==p.manifest_sha256)throw new Error('Owner release manifest changed.');
  const m=JSON.parse(bytes.toString()) as {schema_version?:unknown;entry?:unknown;files?:unknown};
  if(m.schema_version!==1||m.entry!=='src/server/owner-test-runtime.ts'||!m.files||typeof m.files!=='object'||Array.isArray(m.files))throw new Error('Owner release manifest is invalid.');
  const entries=Object.entries(m.files);
  if(!entries.length||entries.length>2000||!Object.hasOwn(m.files,m.entry)||!Object.hasOwn(m.files,'package-lock.json')||!Object.hasOwn(m.files,'package.json'))throw new Error('Owner release manifest is incomplete.');
  for(const[file,hash]of entries){
    if(isAbsolute(file)||file.includes('\\')||file.split('/').some(s=>!s||s==='.'||s==='..')||(file.startsWith('.')&&!file.startsWith('.github/')&&file!=='.env.example'&&file!=='.gitignore')||file.startsWith('node_modules/')||typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))throw new Error('Owner release contains an invalid source reference.');
    const path=await realpath(join(release,file));
    if(!path.toLowerCase().startsWith((release+sep).toLowerCase()))throw new Error('Owner release source cannot redirect outside its directory.');
    if(createHash('sha256').update(await readFile(path)).digest('hex')!==hash)throw new Error('Owner release source changed.');
  }
  const inspect=async(directory:string,prefix=''):Promise<void>=>{
    for(const item of await readdir(directory,{withFileTypes:true})){
      if(!prefix&&['node_modules','.local','release-manifest.json'].includes(item.name))continue;
      const relative=prefix+item.name;
      if(item.isDirectory())await inspect(join(directory,item.name),relative+'/');
      else if(!item.isFile()||!Object.hasOwn(m.files!,relative))throw new Error('Owner release contains unqualified extra source.');
    }
  };
  await inspect(release);
  // Verify the installed runtime packages agree with this release's manifest.
  const manifest=JSON.parse(await readFile(join(release,'package.json'),'utf8'));
  for(const[name,version]of Object.entries({...manifest.dependencies,...manifest.devDependencies})){
    if(typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version)||typeof name!=='string'||!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name))throw new Error('Owner release dependencies must be exactly pinned.');
    const installed=JSON.parse(await readFile(join(release,'node_modules',name,'package.json'),'utf8'));
    if(installed.version!==version)throw new Error('Owner release installed dependency differs from its lockfile.');
  }
  return pathToFileURL(join(release,m.entry));
}
