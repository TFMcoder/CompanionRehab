import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import type {Pool} from 'pg';
const calls=vi.hoisted(()=>({oauth:vi.fn(()=>({})),service:vi.fn()}));
vi.mock('../src/server/microsoft/oauth.js',()=>({createMicrosoftOAuthClient:calls.oauth}));
vi.mock('../src/server/microsoft/service.js',()=>({MicrosoftService:class {constructor(...args:unknown[]){calls.service(...args);}}}));
import {createSecondaryMicrosoftRuntime} from '../src/server/microsoft/runtime.js';
import {configFromEnv} from '../src/server/config.js';
const config=configFromEnv({PUBLIC_ORIGIN:'https://nancy.example.invalid:8443'}),pool={} as Pool;
const parent=resolve('.local/test-temp');let directory:string;
const primaryKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey,calendarKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;
const primary={enabled:true,localDataUseApproved:true,modelUseApproved:true,reviewedWritesApproved:true,preparationApproved:true,tenantId:'10000000-0000-4000-8000-000000000001',clientId:'10000000-0000-4000-8000-000000000002',expectedObjectId:'10000000-0000-4000-8000-000000000003',actorId:'10000000-0000-4000-8000-000000000004',participantId:'10000000-0000-4000-8000-000000000005',redirectUri:config.origin+'/api/microsoft/callback',certificateFile:'cert.pem',privateKeyFile:'key.pem',encryptionKeyFile:'encryption.key'};
const secondary={...primary,clientId:'10000000-0000-4000-8000-000000000007',certificateFile:'calendar-cert.pem',privateKeyFile:'calendar-key.pem',expectedObjectId:'10000000-0000-4000-8000-000000000006',accessMode:'calendar_read',reviewedWritesApproved:false,sourceLabel:'Additional approved calendar'};
beforeEach(async()=>{calls.oauth.mockClear();calls.service.mockClear();await mkdir(parent,{recursive:true});directory=await mkdtemp(join(parent,'microsoft-calendar-config-'));await Promise.all([writeFile(join(directory,'primary.json'),JSON.stringify(primary)),writeFile(join(directory,'secondary.json'),JSON.stringify(secondary)),writeFile(join(directory,'cert.pem'),'Synthetic certificate'),writeFile(join(directory,'key.pem'),primaryKey.export({format:'pem',type:'pkcs8'})),writeFile(join(directory,'calendar-cert.pem'),'Separate synthetic certificate'),writeFile(join(directory,'calendar-key.pem'),calendarKey.export({format:'pem',type:'pkcs8'})),writeFile(join(directory,'encryption.key'),Buffer.alloc(32,7).toString('base64'))]);vi.stubEnv('NANCY_MICROSOFT_CONFIG',join(directory,'primary.json'));vi.stubEnv('NANCY_MICROSOFT_CALENDAR_CONFIG',join(directory,'secondary.json'));});
afterEach(async()=>{vi.unstubAllEnvs();if(directory){const absolute=resolve(directory);if(!absolute.startsWith(parent+sep)||!absolute.includes('microsoft-calendar-config-'))throw Error('Unsafe fixture cleanup');await rm(absolute,{recursive:true,force:true});}});
describe('separately reviewed calendar-only runtime',()=>{
 it('does nothing when absent or explicitly disabled',async()=>{
  vi.stubEnv('NANCY_MICROSOFT_CALENDAR_CONFIG','');expect(await createSecondaryMicrosoftRuntime(config,pool)).toBeUndefined();vi.stubEnv('NANCY_MICROSOFT_CALENDAR_CONFIG',join(directory,'secondary.json'));await writeFile(join(directory,'secondary.json'),JSON.stringify({enabled:false}));expect(await createSecondaryMicrosoftRuntime(config,pool)).toBeUndefined();expect(calls.oauth).not.toHaveBeenCalled();expect(calls.service).not.toHaveBeenCalled();
 });
 it('binds both OAuth and storage to exact read-only mode without changing primary setup',async()=>{
  const before=await readFile(join(directory,'primary.json'));expect(await createSecondaryMicrosoftRuntime(config,pool)).toBeDefined();expect(calls.oauth).toHaveBeenCalledWith(expect.objectContaining({accessMode:'calendar_read',expectedObjectId:secondary.expectedObjectId,redirectUri:primary.redirectUri}));expect(calls.service).toHaveBeenCalledWith(pool,expect.objectContaining({accessMode:'calendar_read',reviewedWritesApproved:false,actorId:primary.actorId,participantId:primary.participantId,sourceLabel:secondary.sourceLabel}),expect.anything(),expect.anything());expect(await readFile(join(directory,'primary.json'))).toEqual(before);
 });
 it.each(['actorId','participantId','tenantId','clientId','redirectUri','expectedObjectId','reviewedWritesApproved','accessMode'])('rejects an incompatible %s before constructing a provider',async field=>{
  const bad={...secondary,[field]:field==='redirectUri'?'https://other.example.invalid/api/microsoft/callback':field==='clientId'?primary.clientId:field==='expectedObjectId'?primary.expectedObjectId:field==='reviewedWritesApproved'?true:field==='accessMode'?'full':'20000000-0000-4000-8000-000000000009'};
  await writeFile(join(directory,'secondary.json'),JSON.stringify(bad));await expect(createSecondaryMicrosoftRuntime(config,pool)).rejects.toThrow('Additional Microsoft calendar configuration');expect(calls.oauth).not.toHaveBeenCalled();
 });
 it('requires the existing primary setup and separate app credentials',async()=>{
  vi.stubEnv('NANCY_MICROSOFT_CONFIG','');await expect(createSecondaryMicrosoftRuntime(config,pool)).rejects.toThrow();vi.stubEnv('NANCY_MICROSOFT_CONFIG',join(directory,'primary.json'));
  for(const field of ['certificateFile','privateKeyFile'] as const){await writeFile(join(directory,'secondary.json'),JSON.stringify({...secondary,[field]:primary[field]}));await expect(createSecondaryMicrosoftRuntime(config,pool)).rejects.toThrow();}expect(calls.oauth).not.toHaveBeenCalled();
 });
 it('rejects the primary identity even when its UUID uses different letter case',async()=>{
  const id='abcdefab-cdef-4abc-8abc-abcdefabcdef';await writeFile(join(directory,'primary.json'),JSON.stringify({...primary,expectedObjectId:id}));await writeFile(join(directory,'secondary.json'),JSON.stringify({...secondary,expectedObjectId:id.toUpperCase()}));
  await expect(createSecondaryMicrosoftRuntime(config,pool)).rejects.toThrow('Additional Microsoft calendar configuration');expect(calls.oauth).not.toHaveBeenCalled();
 });
 it('rejects reuse of the primary key even under a different PEM encoding',async()=>{
  await writeFile(join(directory,'calendar-key.pem'),primaryKey.export({format:'pem',type:'pkcs1'}));
  await expect(createSecondaryMicrosoftRuntime(config,pool)).rejects.toThrow('Additional Microsoft calendar configuration');expect(calls.oauth).not.toHaveBeenCalled();
 });
 it('compares UUID scope bindings without case sensitivity and retains the exact callback',async()=>{
  const actorId='abcdefab-cdef-4abc-8abc-abcdefabcdef';await writeFile(join(directory,'primary.json'),JSON.stringify({...primary,actorId}));await writeFile(join(directory,'secondary.json'),JSON.stringify({...secondary,actorId:actorId.toUpperCase()}));
  expect(await createSecondaryMicrosoftRuntime(config,pool)).toBeDefined();expect(calls.service).toHaveBeenCalledWith(pool,expect.objectContaining({actorId,redirectUri:primary.redirectUri}),expect.anything(),expect.anything());
 });
 it('binds a shared calendar to the existing signer and an exact distinct owner',async()=>{
  const shared={...secondary,accessMode:'calendar_read_shared',expectedObjectId:primary.expectedObjectId,calendarOwnerId:secondary.expectedObjectId};
  await writeFile(join(directory,'secondary.json'),JSON.stringify(shared));expect(await createSecondaryMicrosoftRuntime(config,pool)).toBeDefined();
  expect(calls.oauth).toHaveBeenCalledWith(expect.objectContaining({accessMode:'calendar_read_shared',expectedObjectId:primary.expectedObjectId}));
  expect(calls.service).toHaveBeenCalledWith(pool,expect.objectContaining({accessMode:'calendar_read_shared',expectedObjectId:primary.expectedObjectId,calendarOwnerId:secondary.expectedObjectId}),expect.anything(),expect.anything());
 });
 it.each(['missing_owner','same_owner','different_signer','owner_on_own_mode'])('rejects unsafe shared calendar configuration: %s',async kind=>{
  const shared={...secondary,accessMode:kind==='owner_on_own_mode'?'calendar_read':'calendar_read_shared',expectedObjectId:kind==='different_signer'||kind==='owner_on_own_mode'?secondary.expectedObjectId:primary.expectedObjectId,
   ...(kind==='missing_owner'?{}:{calendarOwnerId:kind==='same_owner'?primary.expectedObjectId:secondary.expectedObjectId})};
  await writeFile(join(directory,'secondary.json'),JSON.stringify(shared));await expect(createSecondaryMicrosoftRuntime(config,pool)).rejects.toThrow();expect(calls.service).not.toHaveBeenCalled();
 });
});
