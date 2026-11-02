import {readFile} from 'node:fs/promises';
import {createHash,createPublicKey} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import type {Pool} from 'pg';
import {z} from 'zod';
import type {Config} from '../config.js';
import {createMicrosoftOAuthClient} from './oauth.js';
import {MicrosoftService} from './service.js';

const setup=z.object({enabled:z.literal(true),localDataUseApproved:z.literal(true),modelUseApproved:z.boolean().default(false),reviewedWritesApproved:z.boolean().default(false),preparationApproved:z.boolean().default(false),tenantId:z.uuid(),clientId:z.uuid(),expectedObjectId:z.uuid(),actorId:z.uuid(),participantId:z.uuid(),redirectUri:z.url(),certificateFile:z.string().min(1),privateKeyFile:z.string().min(1),encryptionKeyFile:z.string().min(1)}).strict();
const calendarSetup=setup.extend({accessMode:z.enum(['calendar_read','calendar_read_shared']),calendarOwnerId:z.uuid().optional(),reviewedWritesApproved:z.literal(false).default(false),sourceLabel:z.string().trim().min(1).max(80).refine(value=>!/[\u0000-\u001f\u007f]/.test(value)).optional()}).strict();
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

/** One separately reviewed calendar source, bound to the existing client/app host. */
export async function createSecondaryMicrosoftRuntime(config:Config,pool:Pool):Promise<MicrosoftService|undefined>{
 const file=process.env.NANCY_MICROSOFT_CALENDAR_CONFIG;
 if(!file)return undefined;
 try{
  const absolute=resolve(file),raw=JSON.parse(await readFile(absolute,'utf8'));
  if(raw.enabled===false)return undefined;
  const settings=calendarSetup.parse(raw),primaryFile=process.env.NANCY_MICROSOFT_CONFIG;
  for(const field of ['actorId','participantId','tenantId','clientId','expectedObjectId'] as const)settings[field]=settings[field].toLowerCase();
  if(settings.calendarOwnerId)settings.calendarOwnerId=settings.calendarOwnerId.toLowerCase();
  if(!primaryFile||!config.origin.startsWith('https:')||settings.redirectUri!==config.origin+'/api/microsoft/callback')throw Error();
  const primaryPath=resolve(primaryFile),primary=setup.parse(JSON.parse(await readFile(primaryPath,'utf8')));
  if((['actorId','participantId','tenantId'] as const).some(key=>settings[key]!==primary[key].toLowerCase())||settings.redirectUri!==primary.redirectUri)throw Error();
  // Entra returns previously consented resource scopes for the same app/user.
  // A distinct registration keeps existing Mail/Write consent out of this token
  // and prevents new shared-read consent from breaking primary token refresh.
  // https://learn.microsoft.com/en-us/entra/msal/javascript/browser/resources-and-scopes
  if(settings.clientId===primary.clientId.toLowerCase())throw Error();
  if(settings.accessMode==='calendar_read_shared'){
   if(settings.expectedObjectId!==primary.expectedObjectId.toLowerCase()||!settings.calendarOwnerId||settings.calendarOwnerId===settings.expectedObjectId)throw Error();
  }else if(settings.calendarOwnerId||settings.expectedObjectId===primary.expectedObjectId.toLowerCase())throw Error();
  const directory=dirname(absolute),primaryDirectory=dirname(primaryPath);
  const [certificatePem,privateKeyPem,keyText,primaryCertificate,primaryPrivateKey]=await Promise.all([
   readFile(resolve(directory,settings.certificateFile),'utf8'),readFile(resolve(directory,settings.privateKeyFile),'utf8'),readFile(resolve(directory,settings.encryptionKeyFile),'utf8'),
   readFile(resolve(primaryDirectory,primary.certificateFile),'utf8'),readFile(resolve(primaryDirectory,primary.privateKeyFile),'utf8'),
  ]);
  const hash=(value:string)=>createHash('sha256').update(value.trim()).digest('hex');
  const publicKey=(pem:string)=>createPublicKey(pem).export({type:'spki',format:'der'});
  if(hash(certificatePem)===hash(primaryCertificate)||publicKey(privateKeyPem).equals(publicKey(primaryPrivateKey)))throw Error();
  const key=Buffer.from(keyText.trim(),'base64');if(key.length!==32||key.toString('base64')!==keyText.trim())throw Error();
  const oauth=createMicrosoftOAuthClient({...settings,certificate:{certificatePem,privateKeyPem}});
  return new MicrosoftService(pool,{...settings,encryptionKey:key},oauth,{reportConnectionFailure:failure=>{
   console.warn(JSON.stringify({event:'microsoft_calendar_connection_failure',...failure}));
  }});
 }catch{throw Error('Additional Microsoft calendar configuration is invalid or unavailable. Check its reviewed account, existing app/client binding, HTTPS callback and credential files.');}
}
