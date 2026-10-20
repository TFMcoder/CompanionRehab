import {execFileSync} from 'node:child_process';
import {readFile,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export interface PublicFinding {path:string;rule:string;line?:number}
/** Reports locations only. Never echo a matched credential or private payload. */
export function publicFileFindings(path:string,text:string):PublicFinding[]{
 const normalized=path.replaceAll('\\','/'),findings:PublicFinding[]=[];
 if(/(^|\/)(?:\.local|\.git|node_modules|dist|coverage)\//.test(normalized)||/(^|\/)\.env(?:\.|$)/.test(normalized)&&normalized!=='.env.example'||/\.(?:sqlite3?|db|pfx|p12|key|pem|wav|mp3|m4a)$/i.test(normalized))findings.push({path:normalized,rule:'private-or-generated-file'});
 const patterns:[string,RegExp][]=[
  ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/]{32,}/g],
  ['openai-key',/\bsk-(?:(?:proj|svcacct)-)?[A-Za-z0-9_-]{24,}/g],
  ['github-token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g],
  ['aws-key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['literal-jwt',/\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g],
 ];
 for(const [rule,pattern] of patterns)for(const match of text.matchAll(pattern))findings.push({path:normalized,rule,line:text.slice(0,match.index).split('\n').length});
 if(normalized.startsWith('docs/evidence/')&&normalized.endsWith('.json')){
  const sensitive=new Set(['access_token','refresh_token','id_token','private_key','password','transcript','audio_base64']);
  const inspect=(value:unknown)=>{if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(sensitive.has(key)&&typeof item==='string'&&item.trim())findings.push({path:normalized,rule:'private-evidence-payload'});inspect(item);}};
  try{inspect(JSON.parse(text));}catch{findings.push({path:normalized,rule:'invalid-evidence-json'});}
 }
 return findings;
}

export async function checkPublicBoundary(){
 const paths=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8',maxBuffer:8*1024*1024}).split('\0').filter(Boolean))].sort();
 const findings:PublicFinding[]=[];
 for(const path of paths){let stat;try{stat=await lstat(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}if(!stat.isFile()||stat.isSymbolicLink()){findings.push({path,rule:'unexpected-file-type'});continue;}const bytes=await readFile(path);findings.push(...publicFileFindings(path,bytes.includes(0)?'':bytes.toString('utf8')));}
 console.log(JSON.stringify({files_scanned:paths.length,findings,passed:findings.length===0}));
 if(findings.length)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await checkPublicBoundary();
