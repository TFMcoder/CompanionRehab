import {beforeAll,afterAll,afterEach,describe,it,expect,vi} from 'vitest';
import {randomBytes} from 'node:crypto';
import {createApp} from '../src/server/app.js';
import {configFromEnv} from '../src/server/config.js';
import {sealSession} from '../src/server/session.js';
import {MicrosoftService} from '../src/server/microsoft/service.js';
import {createMicrosoftFixture,microsoftTestDatabase} from './helpers/microsoft-fixture.js';

describe('explicitly disconnected Microsoft runtime isolation',()=>{
 let database:Awaited<ReturnType<typeof microsoftTestDatabase>>,f:Awaited<ReturnType<typeof createMicrosoftFixture>>;
 const config=configFromEnv({PUBLIC_ORIGIN:'http://localhost:8787',DATABASE_URL:'postgresql://localhost/synthetic',SESSION_KEY:randomBytes(32).toString('base64')});
 beforeAll(async()=>{database=await microsoftTestDatabase();f=await createMicrosoftFixture(database.pool);});
 afterAll(async()=>database.close());
 afterEach(()=>vi.unstubAllEnvs());
 function inheritedConfig(){
  // An isolated practice/test runtime must never attempt these inherited paths.
  vi.stubEnv('NANCY_MICROSOFT_CONFIG','.local/test-temp/nonexistent-primary-private-config.json');
  vi.stubEnv('NANCY_MICROSOFT_CALENDAR_CONFIG','.local/test-temp/nonexistent-secondary-private-config.json');
 }
 const headers=()=>({host:'localhost:8787',cookie:'nancy_session='+sealSession(f.session,config.sessionKey!)});
 it('disabling Microsoft disables implicit secondary loading despite inherited configuration',async()=>{
  inheritedConfig();const app=await createApp(config,{care:f.care,microsoft:null});
  try{
   for(const url of ['/api/microsoft','/api/microsoft/calendar-source']){
    const response=await app.inject({url,headers:headers()});expect(response.statusCode,response.body).toBe(200);expect(response.json()).toMatchObject({available:false,state:'not_configured'});
   }
  }finally{await app.close();}
 });
 it('an explicit disabled secondary never reads inherited setup alongside an injected primary',async()=>{
  inheritedConfig();const app=await createApp(config,{care:f.care,microsoft:f.service,secondaryMicrosoft:null});
  try{
   const response=await app.inject({url:'/api/microsoft/calendar-source',headers:headers()});expect(response.statusCode,response.body).toBe(200);expect(response.json().state).toBe('not_configured');
   expect((await app.inject({url:'/api/microsoft',headers:headers()})).json().available).toBe(true);
  }finally{await app.close();}
 });
 it('retains deliberate explicit service injection while primary is disabled',async()=>{
  inheritedConfig();const secondary=new MicrosoftService(database.pool,{...f.settings,accessMode:'calendar_read'},f.oauth);
  const app=await createApp(config,{care:f.care,microsoft:null,secondaryMicrosoft:secondary});
  try{
   expect((await app.inject({url:'/api/microsoft',headers:headers()})).json().state).toBe('not_configured');
   const response=await app.inject({url:'/api/microsoft/calendar-source',headers:headers()});expect(response.statusCode,response.body).toBe(200);expect(response.json()).toMatchObject({available:true,access_mode:'calendar_read',state:'disconnected'});
  }finally{await app.close();}
 });
});
