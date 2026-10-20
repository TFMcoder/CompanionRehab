import {readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import type {Pool} from 'pg';
import {z} from 'zod';
import type {Config} from '../config.js';
import {createMicrosoftOAuthClient} from './oauth.js';
import {MicrosoftService} from './service.js';

const setup=z.object({enabled:z.literal(true),localDataUseApproved:z.literal(true),modelUseApproved:z.boolean().default(false),reviewedWritesApproved:z.boolean().default(false),tenantId:z.uuid(),clientId:z.uuid(),expectedObjectId:z.uuid(),actorId:z.uuid(),participantId:z.uuid(),redirectUri:z.url(),certificateFile:z.string().min(1),privateKeyFile:z.string().min(1),encryptionKeyFile:z.string().min(1)}).strict();
/** Optional private setup. Merely creating an Entra registration never enables mailbox access. */
export async function createMicrosoftRuntime(config:Config,pool:Pool):Promise<MicrosoftService|undefined>{
 const file=process.env.NANCY_MICROSOFT_CONFIG;
 if(!file)return undefined;
 try{
  const absolute=resolve(file),raw=JSON.parse(await readFile(absolute,'utf8'));
  if(raw.enabled===false)return undefined;
  const settings=setup.parse(raw);
  if(settings.redirectUri!==config.origin+'/api/microsoft/callback')throw new Error();
  // Real runtime requires HTTPS; HTTP exists only in direct, injected disposable tests.
  if(!config.origin.startsWith('https:'))throw new Error();
  const directory=dirname(absolute);
  const [certificatePem,privateKeyPem,keyText]=await Promise.all([settings.certificateFile,settings.privateKeyFile,settings.encryptionKeyFile].map(path=>readFile(resolve(directory,path),'utf8')));
  const key=Buffer.from(keyText.trim(),'base64');
  if(key.length!==32||key.toString('base64')!==keyText.trim())throw new Error();
  const oauth=createMicrosoftOAuthClient({...settings,certificate:{certificatePem,privateKeyPem}});
  return new MicrosoftService(pool,{...settings,encryptionKey:key},oauth,{reportConnectionFailure:failure=>{
   console.warn(JSON.stringify({event:'microsoft_connection_failure',...failure}));
  }});
 }catch{throw new Error('Microsoft private configuration is invalid or unavailable. Check its approved identities, HTTPS callback and credential files.');}
}
