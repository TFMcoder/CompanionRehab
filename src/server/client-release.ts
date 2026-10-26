import {readFile,realpath,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,sep,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';

/** Separate from the owner test namespace; credentials remain in the workspace. */
export async function selectClientRelease(workspace:string,fallback:URL):Promise<URL>{
  const root=resolve(workspace),pointerPath=join(root,'.local/runtime/release.json');
  let pointer:unknown;
  try{pointer=JSON.parse(await readFile(pointerPath,'utf8'));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return fallback;throw Error('Client release pointer is invalid.');}
  if(!pointer||typeof pointer!=='object'||Array.isArray(pointer))throw Error('Client release pointer is invalid.');
  const p=pointer as Record<string,unknown>;
  if(p.schema_version!==1||typeof p.release_id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(p.release_id)
    ||typeof p.manifest_sha256!=='string'||!/^[a-f0-9]{64}$/.test(p.manifest_sha256)
    ||Object.keys(p).some(key=>!['schema_version','release_id','manifest_sha256'].includes(key)))throw Error('Client release pointer is invalid.');
  const expected=join(root,'.local/client/releases',p.release_id),release=await realpath(expected);
  if(release.toLowerCase()!==expected.toLowerCase())throw Error('Client release cannot redirect outside its private directory.');
  const bytes=await readFile(join(release,'release-manifest.json'));
  if(createHash('sha256').update(bytes).digest('hex')!==p.manifest_sha256)throw Error('Client release manifest changed.');
  const m=JSON.parse(bytes.toString()) as {schema_version?:unknown;entry?:unknown;implementation_revision?:unknown;files?:unknown};
  if(m.schema_version!==1||m.entry!=='src/server/client-runtime.ts'||typeof m.implementation_revision!=='string'
    ||!/^sha256:[a-f0-9]{64}$/.test(m.implementation_revision)||!m.files||typeof m.files!=='object'||Array.isArray(m.files))throw Error('Client release manifest is invalid.');
  const files=m.files as Record<string,unknown>,entries=Object.entries(files);
  if(!entries.length||entries.length>2000||!['src/server/client-runtime.ts','package.json','package-lock.json','dist/client/index.html'].every(file=>Object.hasOwn(files,file)))throw Error('Client release manifest is incomplete.');
  for(const [file,hash] of entries){
    const parts=file.split('/');
    const hidden=parts.some((part,index)=>part.startsWith('.')&&!(index===0&&(part==='.github'&&parts.length>1||(part==='.env.example'||part==='.gitignore')&&parts.length===1)));
    if(isAbsolute(file)||/[\\:\0]/.test(file)||parts.some(part=>!part||part==='.'||part==='..'||part==='node_modules')||hidden
      ||typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))throw Error('Client release contains an invalid source reference.');
    const path=await realpath(join(release,file));
    if(!path.toLowerCase().startsWith((release+sep).toLowerCase()))throw Error('Client release source cannot redirect outside its directory.');
    if(createHash('sha256').update(await readFile(path)).digest('hex')!==hash)throw Error('Client release source changed.');
  }
  const inspect=async(directory:string,prefix=''):Promise<void>=>{
    for(const item of await readdir(directory,{withFileTypes:true})){
      if(!prefix&&['node_modules','.local','release-manifest.json'].includes(item.name))continue;
      const relative=prefix+item.name;
      if(item.isDirectory())await inspect(join(directory,item.name),relative+'/');
      else if(!item.isFile()||!Object.hasOwn(files,relative))throw Error('Client release contains unqualified extra source.');
    }
  };
  await inspect(release);
  const manifest=JSON.parse(await readFile(join(release,'package.json'),'utf8'));
  for(const [name,version] of Object.entries({...manifest.dependencies,...manifest.devDependencies})){
    if(typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version)||!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name))throw Error('Client release dependencies must be exactly pinned.');
    const packagePath=await realpath(join(release,'node_modules',name,'package.json'));
    if(!packagePath.toLowerCase().startsWith((join(release,'node_modules')+sep).toLowerCase()))throw Error('Client release dependency cannot redirect outside its directory.');
    const installed=JSON.parse(await readFile(packagePath,'utf8'));
    if(installed.version!==version)throw Error('Client release installed dependency differs from its lockfile.');
  }
  return pathToFileURL(join(release,m.entry));
}
