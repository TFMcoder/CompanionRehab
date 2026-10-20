import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';
import {localCareMigrations} from '../../src/server/local-migrations.js';
import {LocalCare,bootstrapLocalUser} from '../../src/server/local-care.js';
import {MicrosoftService,type MicrosoftOAuth,type MicrosoftServiceConfig} from '../../src/server/microsoft/service.js';
import type {MicrosoftTokenSet} from '../../src/server/microsoft/oauth.js';
import type {GraphCalendar,GraphMailFolder,GraphCalendarEvent,GraphMessage,GraphCollection} from '../../src/server/microsoft/graph.js';
import {pglitePool} from './pglite-pool.js';

export async function microsoftTestDatabase(){
 let db:PGlite|undefined,pool:Pool;
 const external=process.env.MICROSOFT_TEST_DATABASE_URL;
 if(external){const url=new URL(external);if(!['localhost','127.0.0.1'].includes(url.hostname)||!/^\/nancy_microsoft_[a-z0-9_]+$/.test(url.pathname)||url.search||url.hash)throw new Error('Use an isolated loopback nancy_microsoft_* test database.');pool=new Pool({connectionString:external,max:5});}
 else{db=new PGlite();pool=pglitePool(db) as unknown as Pool;}
 try{
  // Multiple test files may share this explicitly disposable database sequentially.
  // Several historical migrations create non-idempotent triggers, so apply once.
  const current=(await pool.query("select to_regclass('companion_local.microsoft_oauth_pending') as present")).rows[0].present;
  if(!current)for(const file of localCareMigrations){const sql=await readFile(new URL('../../db/'+file,import.meta.url),'utf8');if(db)await db.exec(sql);else await pool.query(sql);}
 }catch(error){if(db)await db.close();else await pool.end();throw error;}
 return {pool,close:async()=>{if(db)await db.close();else await pool.end();}};
}
/** All provider data and credentials are synthetic; this fixture never accesses Microsoft. */
export async function createMicrosoftFixture(pool:Pool,clock=()=>new Date()){
 const password='Synthetic-outlook-fixture-only-29!',email=`microsoft-${randomUUID()}@example.invalid`;
 const user=await bootstrapLocalUser(pool,{email,password,role:'client',display_name:'Synthetic Outlook client',time_zone:'America/Toronto'});
 const administrator=await bootstrapLocalUser(pool,{email:`admin-${randomUUID()}@example.invalid`,password,role:'administrator',participant_id:user.participant_id});
 const care=new LocalCare({pool,clock}),session=await care.login(email,password);
 const admin=await care.login((await pool.query('select email from companion_local.accounts where id=$1',[administrator.user_id])).rows[0].email,password);
 const settings:MicrosoftServiceConfig={tenantId:randomUUID(),clientId:randomUUID(),expectedObjectId:randomUUID(),actorId:user.user_id,participantId:user.participant_id,redirectUri:'http://localhost:8787/api/microsoft/callback',encryptionKey:randomBytes(32)};
 let latest:{state:string;nonce:string;codeVerifier:string}|undefined;
 const calls={exchange:0,refresh:0,calendar:0,mail:0};
 let tokens:MicrosoftTokenSet={accessToken:'synthetic-access-token',refreshToken:'synthetic-refresh-token',expiresAt:new Date(clock().getTime()+3600000).toISOString(),scopes:['User.Read','Calendars.ReadWrite','Mail.ReadWrite','Mail.Send'],identity:{tenantId:settings.tenantId,objectId:settings.expectedObjectId}};
 const oauth:MicrosoftOAuth={beginAuthorization(){latest={state:randomUUID(),nonce:randomUUID(),codeVerifier:randomUUID()};return {...latest,authorizationUrl:'https://login.microsoftonline.com/synthetic?state='+latest.state,expiresAt:new Date(clock().getTime()+600000).toISOString()};},async exchangeCode(){calls.exchange++;return tokens;},async refreshTokens(){calls.refresh++;tokens={...tokens,accessToken:'synthetic-refreshed-'+calls.refresh,refreshToken:'synthetic-refresh-'+calls.refresh,expiresAt:new Date(clock().getTime()+3600000).toISOString()};return tokens;}};
 const list=<T>(items:T[]):GraphCollection<T>=>({items,fetchedAt:clock().toISOString(),complete:true,truncation:null});
 const calendar:GraphCalendar={id:'calendar-approved',name:'Synthetic calendar',owner:{name:'Synthetic',address:'synthetic@example.invalid'},canEdit:true,isDefault:true,changeKey:'v1',etag:'v1',fetchedAt:clock().toISOString()};
 const folder:GraphMailFolder={id:'folder-approved',displayName:'Synthetic inbox',parentFolderId:null,childFolderCount:0,totalItemCount:1,unreadItemCount:1,fetchedAt:clock().toISOString()};
 const event:GraphCalendarEvent={id:'event-one',calendarId:calendar.id,subject:'Synthetic appointment',start:clock().toISOString(),end:new Date(clock().getTime()+3600000).toISOString(),isAllDay:false,isCancelled:false,isOrganizer:true,type:'singleInstance',seriesMasterId:null,iCalUId:'synthetic',changeKey:'v1',etag:'v1',lastModifiedAt:clock().toISOString(),location:null,organizer:null,attendees:[],transactionId:null,fetchedAt:clock().toISOString()};
 const message:GraphMessage={id:'mail-one',folderId:folder.id,subject:'Synthetic message',from:{name:'Synthetic sender',address:'synthetic@example.invalid'},to:[],cc:[],bcc:[],receivedAt:clock().toISOString(),sentAt:null,lastModifiedAt:clock().toISOString(),isDraft:false,isRead:false,hasAttachments:false,preview:'Synthetic preview; no household information.',changeKey:'v1',etag:'v1',internetMessageId:null,fetchedAt:clock().toISOString()};
 const graph={async verifyIdentity(){return{id:settings.expectedObjectId,displayName:'Synthetic',mail:'synthetic@example.invalid',userPrincipalName:'synthetic@example.invalid',fetchedAt:clock().toISOString()};},async listCalendars(){return list([calendar]);},async listMailFolders(){return list([folder]);},async calendarView(){calls.calendar++;return list([event]);},async listMessages(){calls.mail++;return list([message]);}};
 const service=new MicrosoftService(pool,settings,oauth,{clock,graph:()=>graph});
 async function connect(){const begun=await service.begin(session);await service.callback({state:latest!.state,code:'synthetic-code'},begun.browserBinding);await service.finish(session,begun.browserBinding);return begun;}
 return {pool,care,settings,oauth,graph,service,session,admin,email,password,calls,connect,latest:()=>latest!,getTokens:()=>tokens,setTokens:(next:MicrosoftTokenSet)=>{tokens=next;}};
}
