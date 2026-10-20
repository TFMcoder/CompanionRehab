import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {ApiError} from '../errors.js';
import {localAuthority,localTransaction,canonicalJson,saveLocalCommand,previousLocalCommand,type LocalAuthority,type LocalDb} from '../local-authority.js';
import type {Session} from '../session.js';
import {MicrosoftGraphClient,MicrosoftGraphError} from './graph.js';
import {sealMicrosoftSecret,openMicrosoftSecret} from './credential-storage.js';
import {MicrosoftOAuthError,type MicrosoftTokenSet} from './oauth.js';
import {microsoftSelectionSchema,microsoftReadRangeSchema,microsoftPrepareSchema,microsoftConfirmSchema,type MicrosoftAction,type MicrosoftActionReview,type MicrosoftActionReceipt,type MicrosoftActionState,type MicrosoftSelection,type MicrosoftReadRange,type MicrosoftStatus} from '../../shared/microsoft-contracts.js';

export interface MicrosoftServiceConfig {tenantId:string;clientId:string;expectedObjectId:string;actorId:string;participantId:string;redirectUri:string;encryptionKey:Buffer;modelUseApproved?:boolean;reviewedWritesApproved?:boolean}
export interface MicrosoftOAuth {
 beginAuthorization():{authorizationUrl:string;state:string;nonce:string;codeVerifier:string;expiresAt:string};
 exchangeCode(input:{code:string;codeVerifier:string;nonce:string},signal?:AbortSignal):Promise<MicrosoftTokenSet>;
 refreshTokens(previous:MicrosoftTokenSet,signal?:AbortSignal):Promise<MicrosoftTokenSet>;
}
type Graph=Pick<MicrosoftGraphClient,'verifyIdentity'|'listCalendars'|'listMailFolders'|'calendarView'|'listMessages'> & Partial<Pick<MicrosoftGraphClient,'getMessage'|'getCalendarEvent'|'createMailDraft'|'sendCreatedDraft'|'inspectCreatedMessage'|'createCalendarEvent'>>;
type PreparedAction={action:MicrosoftAction;scope:string;expires_at:string;time_zone:string;account:string;calendar_name:string|null};
type ActionPhase='claim'|'provider'|'accepted'|'verified'|'unknown'|'failed';
const phases:ActionPhase[]=['claim','provider','accepted','verified','unknown','failed'];
function phaseKey(id:string,phase:ActionPhase){const hex=hash(id+':microsoft-action:'+phase);return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;}
type Row={id:string;participant_id:string;actor_id:string;grant_fingerprint:string;configuration_fingerprint:string;tenant_id:string;object_id:string;state:'connected'|'disconnected'|'reconnect_required';token_ciphertext:string|null;selected_calendar_ids:string[];selected_mail_folder_ids:string[];revision:number;last_read_at:Date|string|null;last_error:string|null};
type Pending={id:string;actor_id:string;participant_id:string;login_session_id:string;state_hash:string;browser_hash:string;grant_fingerprint:string;configuration_fingerprint:string;pending_ciphertext:string;stage:string;expires_at:Date|string};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const time=(value:Date|string|null)=>value?new Date(value).toISOString():null;
const authorizationError=()=>new ApiError(403,'microsoft_scope_changed','Microsoft access changed. Reconnect using the approved client account.');
export type MicrosoftConnectionStage='token_exchange'|'token_identity'|'care_authority'|'graph_identity';
export interface MicrosoftConnectionFailure {stage:MicrosoftConnectionStage;code:string;http_status:number|null;provider_codes:readonly number[];scope_check:MicrosoftOAuthError['scopeCheck']}
const oauthFailureCodes=new Set(['invalid_configuration','invalid_exchange','provider_unavailable','reauthorization_required','invalid_token_response','identity_not_allowed','invalid_id_token','invalid_scopes']);
const graphFailureCodes=new Set(['invalid_input','invalid_response','account_mismatch','resource_denied','unsafe_pagination','provider_error','network_error','timeout','response_too_large']);
/** Report only fixed codes and bounded numbers. Error messages/provider bodies may contain secrets. */
function connectionFailure(stage:MicrosoftConnectionStage,error:unknown):MicrosoftConnectionFailure{
 if(error instanceof MicrosoftOAuthError&&oauthFailureCodes.has(error.code))return {stage,code:'oauth_'+error.code,http_status:error.httpStatus,provider_codes:error.providerCodes,scope_check:error.scopeCheck};
 if(error instanceof MicrosoftGraphError&&graphFailureCodes.has(error.code))return {stage,code:'graph_'+error.code,http_status:Number.isInteger(error.status)&&Number(error.status)>=100&&Number(error.status)<=599?error.status:null,provider_codes:[],scope_check:null};
 return {stage,code:error instanceof ApiError&&[401,403].includes(error.status)?'care_authorization_changed':'unexpected_failure',http_status:null,provider_codes:[],scope_check:null};
}
/** One app-specific connection, scoped to the approved client. The provider identity never establishes local care authority. */
export class MicrosoftService {
 private fingerprint:string;
 constructor(private pool:Pool,private config:MicrosoftServiceConfig,private oauth:MicrosoftOAuth,private options:{clock?:()=>Date;operationTimeoutMs?:number;reportConnectionFailure?:(failure:MicrosoftConnectionFailure)=>void;graph?:(token:string,calendars:string[],folders:string[],signal?:AbortSignal,beforeRequest?:()=>Promise<void>)=>Graph}={}) {
  if(config.encryptionKey.length!==32)throw new Error('Microsoft encryption key must contain 32 bytes.');
  this.config=config={...config,tenantId:config.tenantId.toLowerCase(),clientId:config.clientId.toLowerCase(),expectedObjectId:config.expectedObjectId.toLowerCase(),actorId:config.actorId.toLowerCase(),participantId:config.participantId.toLowerCase()};
  this.fingerprint=hash(canonicalJson([config.tenantId,config.clientId,config.expectedObjectId,config.actorId,config.participantId,config.redirectUri]));
 }
 private now(){return this.options.clock?.()??new Date();}
 private context(id:string){return {connectionId:id,actorId:this.config.actorId,participantId:this.config.participantId,tenantId:this.config.tenantId,objectId:this.config.expectedObjectId};}
 private seal(id:string,value:unknown){return sealMicrosoftSecret(JSON.stringify(value),this.config.encryptionKey,this.context(id));}
 private open<T>(id:string,value:string):T{return JSON.parse(openMicrosoftSecret(value,this.config.encryptionKey,this.context(id))) as T;}
 private graph(token:string,calendars:string[]=[],folders:string[]=[],signal?:AbortSignal,beforeRequest?:()=>Promise<void>):Graph{return this.options.graph?.(token,calendars,folders,signal,beforeRequest)??new MicrosoftGraphClient({accessToken:token,expectedAccountId:this.config.expectedObjectId,allowedCalendarIds:calendars,allowedMailFolderIds:folders,clock:()=>this.now(),signal,beforeRequest});}
 private eligibleScope(ctx:LocalAuthority){return ctx.role==='client'&&ctx.actor===this.config.actorId&&ctx.participant===this.config.participantId;}
 async eligible(session:Session){return this.eligibleScope(await localAuthority(this.pool,session,this.now()));}
 private async authority(db:LocalDb,session:Session){const ctx=await localAuthority(db,session,this.now());if(!this.eligibleScope(ctx))throw authorizationError();return ctx;}
 private async recheck(db:LocalDb,session:Session,ctx:LocalAuthority,lock=false){const next=lock?await localAuthority(db,session,this.now(),true):await this.authority(db,session);if(!this.eligibleScope(next)||next.actor!==ctx.actor||next.participant!==ctx.participant||next.role!==ctx.role||next.grant!==ctx.grant)throw authorizationError();}
 private async erase(db:LocalDb,actor:string,participant?:string){
  await db.query('delete from companion_local.microsoft_oauth_pending where actor_id=$1'+(participant?' and participant_id=$2':''),participant?[actor,participant]:[actor]);
  await db.query("update companion_local.microsoft_connections set token_ciphertext=null,state='reconnect_required',selected_calendar_ids='{}',selected_mail_folder_ids='{}',last_read_at=null,last_error='authorization_changed',revision=revision+1,updated_at=$2 where actor_id=$1 and state='connected'"+(participant?' and participant_id=$3':''),participant?[actor,this.now(),participant]:[actor,this.now()]);
 }
 private async checked<T>(session:Session,work:(ctx:LocalAuthority)=>Promise<T>):Promise<T>{
  try{return await work(await this.authority(this.pool,session));}
  catch(error){if(error instanceof ApiError&&[401,403].includes(error.status))await this.erase(this.pool,session.user_id);throw error;}
 }
 /** Clear a pending authorization on logout or rejected local-session authorization; persistent tokens are invalidated separately after fresh scope checks. */
 async endLogin(session:Session){await this.pool.query('delete from companion_local.microsoft_oauth_pending where login_session_id=$1 and actor_id=$2',[session.session_id,session.user_id]);}
 async invalidateSession(session:Session){await this.endLogin(session);await this.erase(this.pool,session.user_id);}
 private async row(db:LocalDb,ctx:LocalAuthority,lock=false):Promise<Row|undefined>{return (await db.query('select * from companion_local.microsoft_connections where participant_id=$1 and actor_id=$2'+(lock?' for update':''),[ctx.participant,ctx.actor])).rows[0];}
 private matches(row:Row,ctx:LocalAuthority){return row.grant_fingerprint===ctx.grant&&row.configuration_fingerprint===this.fingerprint&&row.tenant_id===this.config.tenantId&&row.object_id===this.config.expectedObjectId;}
 private statusOf(row?:Row):MicrosoftStatus{return {available:true,eligible:true,state:row?.state??'disconnected',revision:row?.revision??0,selected_calendar_ids:row?.selected_calendar_ids??[],selected_mail_folder_ids:row?.selected_mail_folder_ids??[],last_read_at:time(row?.last_read_at??null),last_error:row?.last_error??null,model_disclosure_enabled:this.config.modelUseApproved===true&&row?.state==='connected',...(this.config.reviewedWritesApproved?{reviewed_writes_enabled:row?.state==='connected'}:{})};}
 /** Conversation binding changes on selection, disconnect, reconnect or disclosure/action consent changes. */
 async authorityRevision(session:Session){const status=await this.status(session);return hash(canonicalJson([status.eligible,status.state,status.revision,this.config.modelUseApproved===true,this.config.reviewedWritesApproved===true]));}
 async status(session:Session):Promise<MicrosoftStatus>{
  try{
  const ctx=await localAuthority(this.pool,session,this.now());
  if(!this.eligibleScope(ctx)){await this.erase(this.pool,ctx.actor);return {...this.statusOf(),eligible:false};}
  let row=await this.row(this.pool,ctx);
  if(row&&row.state==='connected'&&!this.matches(row,ctx)){await this.erase(this.pool,ctx.actor,ctx.participant);row=await this.row(this.pool,ctx);}
  return this.statusOf(row);
  }catch(error){if(error instanceof ApiError&&[401,403].includes(error.status))await this.erase(this.pool,session.user_id);throw error;}
 }
 async begin(session:Session):Promise<{authorization_url:string;browserBinding:string}>{return this.checked(session,async ctx=>{
  const start=this.oauth.beginAuthorization(),id=randomUUID(),browserBinding=randomBytes(32).toString('base64url'),now=this.now();
  await localTransaction(this.pool,async db=>{
   await this.recheck(db,session,ctx);
   const previous=await this.row(db,ctx,true);if(previous&&!this.matches(previous,ctx))await this.erase(db,ctx.actor,ctx.participant);
   await db.query('delete from companion_local.microsoft_oauth_pending where login_session_id=$1 or expires_at<=$2',[session.session_id,now]);
   await db.query(`insert into companion_local.microsoft_oauth_pending(id,state_hash,browser_hash,actor_id,participant_id,login_session_id,grant_fingerprint,configuration_fingerprint,pending_ciphertext,stage,created_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'authorizing',$10,$11)`,
    [id,hash(start.state),hash(browserBinding),ctx.actor,ctx.participant,session.session_id,ctx.grant,this.fingerprint,this.seal(id,{codeVerifier:start.codeVerifier,nonce:start.nonce}),now,new Date(Math.min(Date.parse(start.expiresAt),now.getTime()+600000))]);
  });return {authorization_url:start.authorizationUrl,browserBinding};
 });}
 /** Only the short-lived Lax cookie is accepted here. No Graph access occurs until authenticated same-origin finish. */
 async callback(input:{state:string;code?:string;error?:string},browserBinding?:string):Promise<void>{
  if(!browserBinding||!input.state||input.state.length>512||browserBinding.length>128)throw new ApiError(400,'microsoft_authorization_expired','Start the Microsoft connection again.');
  const accepted=await localTransaction(this.pool,async db=>{
   const pending=(await db.query('select * from companion_local.microsoft_oauth_pending where state_hash=$1 for update',[hash(input.state)])).rows[0] as Pending|undefined;
   if(!pending||pending.browser_hash!==hash(browserBinding)||pending.stage!=='authorizing'||new Date(pending.expires_at)<=this.now())throw new ApiError(400,'microsoft_authorization_expired','Start the Microsoft connection again.');
   const active=(await db.query(`select s.role,g.id,g.granted_at from companion_local.sessions s join companion_local.accounts a on a.id=s.actor_id join companion_local.role_grants g on g.actor_id=s.actor_id and g.participant_id=s.participant_id and g.role=s.role where s.id=$1 and s.actor_id=$2 and s.participant_id=$3 and s.expires_at>$4 and s.revoked_at is null and a.disabled_at is null and g.revoked_at is null`,[pending.login_session_id,pending.actor_id,pending.participant_id,this.now()])).rows[0];
   if(!active||active.role!=='client'||hash(canonicalJson([active.id,active.granted_at,active.role]))!==pending.grant_fingerprint||pending.configuration_fingerprint!==this.fingerprint){await db.query('delete from companion_local.microsoft_oauth_pending where id=$1',[pending.id]);return false;}
   // Provider denial is consumed without recording its potentially sensitive description.
   if(input.error||!input.code){await db.query('delete from companion_local.microsoft_oauth_pending where id=$1',[pending.id]);return false;}
   if(input.code.length>16000)throw new ApiError(400,'invalid_input','The Microsoft response was invalid.');
   const prior=this.open<{codeVerifier:string;nonce:string}>(pending.id,pending.pending_ciphertext);
   await db.query("update companion_local.microsoft_oauth_pending set stage='returned',pending_ciphertext=$2 where id=$1",[pending.id,this.seal(pending.id,{...prior,code:input.code})]);
   return true;
  });
  if(!accepted)throw new ApiError(400,'microsoft_connection_cancelled','The Microsoft connection was not completed. Start again when ready.');
 }
 async finish(session:Session,browserBinding?:string):Promise<MicrosoftStatus>{return this.checked(session,async ctx=>{
  if(!browserBinding)throw new ApiError(400,'microsoft_authorization_expired','Start the Microsoft connection again.');
  // Claim before the remote exchange: uncertain/failed exchanges require fresh authorization, never code replay.
  const pending=await localTransaction(this.pool,async db=>{
   const row=(await db.query("update companion_local.microsoft_oauth_pending set stage='exchanging' where login_session_id=$1 and actor_id=$2 and stage='returned' returning *",[session.session_id,ctx.actor])).rows[0] as Pending|undefined;
   return row;
  });
  if(!pending||pending.browser_hash!==hash(browserBinding)||pending.participant_id!==ctx.participant||pending.grant_fingerprint!==ctx.grant||pending.configuration_fingerprint!==this.fingerprint||new Date(pending.expires_at)<=this.now()){if(pending)await this.endLogin(session);throw new ApiError(400,'microsoft_authorization_expired','Start the Microsoft connection again.');}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(1,Math.min(45000,this.options.operationTimeoutMs??45000)));timer.unref();
  try{
  let tokens:MicrosoftTokenSet;
  let stage:MicrosoftConnectionStage='token_exchange';
  try{tokens=await this.oauth.exchangeCode(this.open(pending.id,pending.pending_ciphertext),controller.signal);stage='token_identity';this.validateTokens(tokens);stage='care_authority';await this.recheck(this.pool,session,ctx);stage='graph_identity';await this.graph(tokens.accessToken,[],[],controller.signal,()=>this.recheck(this.pool,session,ctx)).verifyIdentity();}
  catch(error){try{this.options.reportConnectionFailure?.(connectionFailure(stage,error));}catch{/* Diagnostics must not bypass cleanup or change authorization. */}await this.endLogin(session);if(error instanceof ApiError&&[401,403].includes(error.status))throw error;throw new ApiError(400,'microsoft_connection_failed','Microsoft could not connect the approved account. Start the connection again.');}
  await localTransaction(this.pool,async db=>{
   await db.query('select id from companion_local.participant_profiles where id=$1 for update',[ctx.participant]);
   await this.recheck(db,session,ctx,true);
   const claim=(await db.query('delete from companion_local.microsoft_oauth_pending where id=$1 and expires_at>$2 returning id',[pending.id,this.now()])).rows[0];
   if(!claim)throw new ApiError(409,'microsoft_connection_cancelled','This Microsoft connection was cancelled.');
   const current=await this.row(db,ctx,true),id=current?.id??randomUUID();
   await db.query(`insert into companion_local.microsoft_connections(id,participant_id,actor_id,grant_fingerprint,configuration_fingerprint,tenant_id,object_id,state,token_ciphertext,connected_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,'connected',$8,$9,$9)
    on conflict(participant_id,actor_id) do update set grant_fingerprint=excluded.grant_fingerprint,configuration_fingerprint=excluded.configuration_fingerprint,tenant_id=excluded.tenant_id,object_id=excluded.object_id,state='connected',token_ciphertext=excluded.token_ciphertext,selected_calendar_ids='{}',selected_mail_folder_ids='{}',revision=microsoft_connections.revision+1,connected_at=excluded.connected_at,updated_at=excluded.updated_at,last_read_at=null,last_error=null`,
    [id,ctx.participant,ctx.actor,ctx.grant,this.fingerprint,this.config.tenantId,this.config.expectedObjectId,this.seal(id,tokens),this.now()]);
  });return this.status(session);
  }finally{clearTimeout(timer);}
 });}
 private validateTokens(tokens:MicrosoftTokenSet){if(tokens.identity.tenantId!==this.config.tenantId||tokens.identity.objectId!==this.config.expectedObjectId||!tokens.accessToken||!tokens.refreshToken||!Number.isFinite(Date.parse(tokens.expiresAt)))throw authorizationError();}
 private async connected<T>(session:Session,work:(graph:Graph,row:Row,db:PoolClient)=>Promise<T>):Promise<T>{return this.checked(session,async ctx=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(1,Math.min(45000,this.options.operationTimeoutMs??45000)));timer.unref();
  try{return await localTransaction(this.pool,async db=>{
   await this.recheck(db,session,ctx);
   const row=await this.row(db,ctx,true);
   if(!row||row.state!=='connected'||!row.token_ciphertext)throw new ApiError(409,'microsoft_not_connected','Connect Microsoft first.');
   if(!this.matches(row,ctx))throw authorizationError();
   let tokens:MicrosoftTokenSet;
   try{tokens=this.open(row.id,row.token_ciphertext);this.validateTokens(tokens);}catch{throw authorizationError();}
   // The database row lock serializes refresh across processes, selections and disconnects.
   if(Date.parse(tokens.expiresAt)<=this.now().getTime()+60000){
    try{tokens=await this.oauth.refreshTokens(tokens,controller.signal);this.validateTokens(tokens);}catch{throw new ApiError(403,'microsoft_reconnect_required','Microsoft needs you to reconnect.');}
    await this.recheck(db,session,ctx);
    await db.query('update companion_local.microsoft_connections set token_ciphertext=$2,updated_at=$3 where id=$1',[row.id,this.seal(row.id,tokens),this.now()]);
   }
   await this.recheck(db,session,ctx);
   let result:T;
   try{result=await work(this.graph(tokens.accessToken,row.selected_calendar_ids,row.selected_mail_folder_ids,controller.signal,()=>this.recheck(db,session,ctx)),row,db);}
   catch(error){if(error instanceof MicrosoftGraphError||error instanceof ApiError&&![401,403].includes(error.status)){await this.recheck(db,session,ctx,true);return {error} as const;}throw error;}
   await this.recheck(db,session,ctx,true);
   await db.query('update companion_local.microsoft_connections set last_read_at=$2,last_error=null where id=$1',[row.id,this.now()]);
   return {value:result} as const;
  }).then(outcome=>{if('error'in outcome)throw outcome.error;return outcome.value;});}catch(error){
   if(error instanceof ApiError)throw error;
   const code=error&&typeof error==='object'&&'code'in error?String(error.code):'';
   if(/identity|account|unauthorized|authentication|invalid_token|access_denied|forbidden/.test(code)||error instanceof MicrosoftGraphError&&[401,403].includes(error.status??0)){await this.erase(this.pool,ctx.actor,ctx.participant);throw new ApiError(403,'microsoft_reconnect_required','Microsoft needs you to reconnect.');}
   await this.pool.query("update companion_local.microsoft_connections set last_error='provider_unavailable' where actor_id=$1 and participant_id=$2",[ctx.actor,ctx.participant]);
   throw new ApiError(502,'microsoft_unavailable','Microsoft is unavailable. Previously read information may be out of date.');
  }finally{clearTimeout(timer);}
 });}
 async resources(session:Session){return this.connected(session,async graph=>({calendars:await graph.listCalendars(),mail_folders:await graph.listMailFolders()}));}
 async calendarContext(session:Session,input:MicrosoftReadRange){const range=microsoftReadRangeSchema.parse(input);return this.connected(session,async(graph,row)=>{const calendars=[];for(const id of row.selected_calendar_ids)calendars.push({id,result:await graph.calendarView(id,range)});return {source:'microsoft' as const,fetched_at:this.now().toISOString(),calendars};});}
 async select(session:Session,input:MicrosoftSelection):Promise<MicrosoftStatus>{
  const selection=microsoftSelectionSchema.parse(input);
  await this.connected(session,async(graph,row,db)=>{
   if(row.revision!==selection.expected_revision)throw new ApiError(409,'microsoft_selection_changed','The connection changed. Reload and choose again.');
   const calendars=await graph.listCalendars(),folders=await graph.listMailFolders();
   if(selection.calendar_ids.some(id=>!calendars.items.some(item=>item.id===id))||selection.mail_folder_ids.some(id=>!folders.items.some(item=>item.id===id)))throw new ApiError(400,'microsoft_resource_unavailable','Choose resources listed for the connected account.');
   await db.query('update companion_local.microsoft_connections set selected_calendar_ids=$2,selected_mail_folder_ids=$3,revision=revision+1,updated_at=$4 where id=$1',[row.id,selection.calendar_ids,selection.mail_folder_ids,this.now()]);
  });return this.status(session);
 }
 async read(session:Session,input:MicrosoftReadRange){const range=microsoftReadRangeSchema.parse(input);return this.connected(session,async(graph,row)=>{
  const calendars=[],mail_folders=[];
  for(const id of row.selected_calendar_ids)calendars.push({id,result:await graph.calendarView(id,range)});
  for(const id of row.selected_mail_folder_ids)mail_folders.push({id,result:await graph.listMessages(id,range)});
  return {source:'microsoft' as const,fetched_at:this.now().toISOString(),calendars,mail_folders,model_disclosure_enabled:this.config.modelUseApproved===true};
 });}
 async conversationContext(session:Session,input:MicrosoftReadRange){
  const status=await this.status(session);
  if(!status.eligible||!status.model_disclosure_enabled)return {source:'microsoft',state:status.state==='connected'?'not_authorized':status.state};
  try{const context=await this.read(session,input);let remainingEvents=20,remainingMessages=12;return {source:'microsoft',state:'fresh',fetched_at:context.fetched_at,range:input,
   calendars:context.calendars.map(({id,result})=>{const items=result.items.slice(0,remainingEvents);remainingEvents-=items.length;return {id,fetched_at:result.fetchedAt,complete:result.complete&&result.items.length===items.length,omitted:result.items.length-items.length,truncation:result.truncation,events:items.map(e=>({id:e.id,subject:e.subject.slice(0,200),start:e.start,end:e.end,cancelled:e.isCancelled,location:e.location?.slice(0,200)??null}))};}),
   mail_folders:context.mail_folders.map(({id,result})=>{const items=result.items.slice(0,remainingMessages);remainingMessages-=items.length;return {id,fetched_at:result.fetchedAt,complete:result.complete&&result.items.length===items.length,omitted:result.items.length-items.length,truncation:result.truncation,messages:items.map(m=>({id:m.id,subject:m.subject.slice(0,200),from:m.from,received_at:m.receivedAt,is_read:m.isRead,preview:m.preview.slice(0,500)}))};})};
  }catch(error){if(error instanceof ApiError&&[401,403].includes(error.status))throw error;return {source:'microsoft',state:'unavailable',fetched_at:null,warning:'Do not infer availability or an empty Inbox from this failed read.'};}
 }
 async conversationMessage(session:Session,folderId:string,messageId:string){
  if(!this.config.modelUseApproved)throw new ApiError(403,'microsoft_disclosure_disabled','Outlook conversation use is not enabled.');
  return this.connected(session,async(graph,row)=>{if(!row.selected_mail_folder_ids.includes(folderId)||!graph.getMessage)throw authorizationError();const item=await graph.getMessage(folderId,messageId);return {source:'microsoft',fetched_at:item.fetchedAt,id:item.id,subject:item.subject,from:item.from,to:item.to,body_text:item.bodyText.slice(0,5000),body_truncated:item.bodyText.length>5000};});
 }
 private actionScope(ctx:LocalAuthority,row:Row){return hash(canonicalJson([ctx.grant,row.id,row.revision,this.fingerprint,this.config.reviewedWritesApproved===true]));}
 private actionEnabled(){if(!this.config.reviewedWritesApproved)throw new ApiError(403,'microsoft_writes_disabled','Reviewed Outlook actions are not enabled.');}
 private async prepared(db:LocalDb,ctx:LocalAuthority,id:string):Promise<PreparedAction>{
  const record=(await db.query("select actor_id,result,event_type from companion_local.append_only_mutations where participant_id=$1 and command_id=$2",[ctx.participant,id])).rows[0];
  if(!record||record.actor_id!==ctx.actor||record.event_type!=='microsoft_action_prepared')throw new ApiError(404,'microsoft_action_missing','That Outlook review is not available.');
  try{return this.open<PreparedAction>(id,record.result.ciphertext);}catch{throw new ApiError(409,'microsoft_review_changed','Review the Outlook action again.');}
 }
 private review(id:string,data:PreparedAction):MicrosoftActionReview{return {action_id:id,action:data.action,review_token:hash(canonicalJson(data)),expires_at:data.expires_at,time_zone:data.time_zone,account:data.account,calendar_name:data.calendar_name};}
 async actionReview(session:Session,id:string){this.actionEnabled();const ctx=await this.authority(this.pool,session),data=await this.prepared(this.pool,ctx,id),row=await this.row(this.pool,ctx);if(!row||row.state!=='connected'||!this.matches(row,ctx)||data.scope!==this.actionScope(ctx,row)||Date.parse(data.expires_at)<=this.now().getTime())throw new ApiError(409,'microsoft_review_expired','This Outlook review expired or its access changed. Prepare a fresh review.');return this.review(id,data);}
 async prepareAction(session:Session,input:unknown):Promise<MicrosoftActionReview>{
  this.actionEnabled();const parsed=microsoftPrepareSchema.parse(input),command={idempotency_key:parsed.idempotency_key,payload_hash:hash(canonicalJson(parsed.action))};
  return this.connected(session,async(graph,row,db)=>{
   const ctx=await this.authority(db,session),prior=await previousLocalCommand(db,ctx,parsed.idempotency_key,command,'microsoft_action_prepared');
   if(prior){const data=await this.prepared(db,ctx,parsed.idempotency_key);if(data.scope!==this.actionScope(ctx,row)||Date.parse(data.expires_at)<=this.now().getTime())throw new ApiError(409,'microsoft_review_expired','Review this Outlook action again.');return this.review(parsed.idempotency_key,data);}
   let action=parsed.action,calendarName:string|null=null;
   if(action.kind==='send_mail'&&!row.selected_mail_folder_ids.length)throw new ApiError(409,'microsoft_selection_required','Select an Inbox before preparing mail.');
   if(action.kind==='create_event'){
    const calendars=(await graph.listCalendars()).items.filter(c=>row.selected_calendar_ids.includes(c.id)&&c.canEdit===true);
    const calendarId=action.calendar_id;
    const selected=calendarId?calendars.find(c=>c.id===calendarId):calendars.length===1?calendars[0]:undefined;
    if(!selected)throw new ApiError(409,'microsoft_calendar_required','Choose one selected writable calendar.');
    action={...action,calendar_id:selected.id,start:new Date(action.start).toISOString(),end:new Date(action.end).toISOString()};calendarName=selected.name;
   }
   const identity=await graph.verifyIdentity(),account=identity.mail??identity.userPrincipalName;
   if(!account)throw new ApiError(409,'microsoft_identity_unavailable','The sending account could not be verified.');
   const data:PreparedAction={action,scope:this.actionScope(ctx,row),expires_at:new Date(this.now().getTime()+15*60000).toISOString(),time_zone:ctx.zone,account,calendar_name:calendarName};
   await saveLocalCommand(db,ctx,command,{ciphertext:this.seal(parsed.idempotency_key,data)},'microsoft_action_prepared',this.now().toISOString().slice(0,10),{kind:action.kind});
   return this.review(parsed.idempotency_key,data);
  });
 }
 private async phase(db:LocalDb,ctx:LocalAuthority,id:string,phase:ActionPhase,state:MicrosoftActionState,providerId?:string){
  const command={idempotency_key:phaseKey(id,phase),action_id:id,phase};
  if(await previousLocalCommand(db,ctx,command.idempotency_key,command,'microsoft_action_'))return;
  const result={state,at:this.now().toISOString(),...(providerId?{provider_ciphertext:this.seal(id,{id:providerId})}:{})};
  await saveLocalCommand(db,ctx,command,result,'microsoft_action_'+phase,this.now().toISOString().slice(0,10),{state});
 }
 private async phaseRows(db:LocalDb,ctx:LocalAuthority,id:string){return (await db.query('select command,result,event_type from companion_local.append_only_mutations where participant_id=$1 and actor_id=$2 and command_id=any($3::uuid[])',[ctx.participant,ctx.actor,phases.map(p=>phaseKey(id,p))])).rows;}
 private receiptOf(id:string,data:PreparedAction,rows:Awaited<ReturnType<MicrosoftService['phaseRows']>>):MicrosoftActionReceipt{
  const order=['verified','failed','unknown','accepted','provider','claim'],latest=order.map(p=>rows.find(r=>r.command.phase===p)).find(Boolean);
  const state:MicrosoftActionState=latest?.result.state??'prepared';
  const message=state==='verified'?(data.action.kind==='send_mail'?'The email is present as sent in Outlook. Recipient delivery is not confirmed.':'The event and its invitation details are saved in Outlook. Attendee acceptance is not confirmed.'):
   state==='accepted'?'Microsoft accepted the request. Its final result is not yet verified.':state==='prepared'?'Review the exact details before sending.':state==='failed'?'This attempt failed. Review Outlook before preparing another action.':'The outcome is uncertain. Do not send again; check this receipt and Outlook first.';
  return {action_id:id,kind:data.action.kind,state,updated_at:latest?.result.at??data.expires_at,message};
 }
 async actionReceipt(session:Session,id:string,reconcile=false):Promise<MicrosoftActionReceipt>{
  this.actionEnabled();const ctx=await this.authority(this.pool,session),data=await this.prepared(this.pool,ctx,id);let rows=await this.phaseRows(this.pool,ctx,id);
  if(reconcile&&!rows.some(r=>r.command.phase==='verified')){
   const record=rows.find(r=>r.command.phase==='provider');
   if(record?.result.provider_ciphertext){
    const providerId=this.open<{id:string}>(id,record.result.provider_ciphertext).id;
    try{await this.connected(session,async(graph,row,db)=>{
     const current=await this.authority(db,session);if(data.scope!==this.actionScope(current,row))throw authorizationError();
     let verified=false;
     if(data.action.kind==='send_mail'&&graph.inspectCreatedMessage){const m=await graph.inspectCreatedMessage(providerId);verified=!m.is_draft&&!!m.sent_at&&m.subject===data.action.subject&&canonicalJson(m.to.map(x=>x.toLowerCase()).sort())===canonicalJson(data.action.to.map(x=>x.toLowerCase()).sort());}
     if(data.action.kind==='create_event'&&graph.getCalendarEvent){const e=await graph.getCalendarEvent(data.action.calendar_id!,providerId);verified=!e.isCancelled&&e.subject===data.action.subject&&e.start===data.action.start&&e.end===data.action.end&&e.transactionId===id&&canonicalJson(e.attendees.map(x=>x.address.toLowerCase()).sort())===canonicalJson(data.action.attendees.map(x=>x.toLowerCase()).sort());}
     if(verified)await this.phase(db,current,id,'verified','verified');
    });}catch(error){if(error instanceof ApiError&&[401,403].includes(error.status))throw error;/* A failed read never repeats a write or claims failure/delivery. */}
    rows=await this.phaseRows(this.pool,ctx,id);
   }
  }
  return this.receiptOf(id,data,rows);
 }
 async recentActions(session:Session){this.actionEnabled();const ctx=await this.authority(this.pool,session);const rows=(await this.pool.query("select command_id from companion_local.append_only_mutations where participant_id=$1 and actor_id=$2 and event_type='microsoft_action_prepared' order by created_at desc limit 10",[ctx.participant,ctx.actor])).rows;return Promise.all(rows.map(r=>this.actionReceipt(session,r.command_id)));}
 async confirmAction(session:Session,input:unknown):Promise<MicrosoftActionReceipt>{
  this.actionEnabled();const parsed=microsoftConfirmSchema.parse(input);
  // The committed claim precedes ALL provider mutations. A crash, retry or competing process can never replay a send.
  const claim=await localTransaction(this.pool,async db=>{
   const ctx=await this.authority(db,session),row=await this.row(db,ctx,true);if(!row||row.state!=='connected'||!this.matches(row,ctx))throw authorizationError();
   const data=await this.prepared(db,ctx,parsed.action_id);if(this.review(parsed.action_id,data).review_token!==parsed.review_token)throw new ApiError(409,'microsoft_review_changed','Review the exact Outlook action again.');
   const rows=await this.phaseRows(db,ctx,parsed.action_id);if(rows.length)return {claimed:false,data};
   if(data.scope!==this.actionScope(ctx,row)||Date.parse(data.expires_at)<=this.now().getTime())throw new ApiError(409,'microsoft_review_expired','Review this Outlook action again.');
   await this.recheck(db,session,ctx,true);await this.phase(db,ctx,parsed.action_id,'claim','submitting');return {claimed:true,data};
  });
  if(!claim.claimed)return {...await this.actionReceipt(session,parsed.action_id,true),replayed:true};
  let providerMutationStarted=false;
  try{
   await this.connected(session,async(graph,row,db)=>{
    const ctx=await this.authority(db,session);if(claim.data.scope!==this.actionScope(ctx,row))throw authorizationError();
    // Do not roll back the durable provider identifier if a later send is uncertain.
    if(claim.data.action.kind==='send_mail'){
     if(!graph.createMailDraft)throw new ApiError(503,'microsoft_write_unavailable','Outlook sending is not available.');
     providerMutationStarted=true;const draft=await graph.createMailDraft(claim.data.action);
     await this.phase(db,ctx,parsed.action_id,'provider','submitting',draft.id);
    }else{
     if(!graph.createCalendarEvent)throw new ApiError(503,'microsoft_write_unavailable','Outlook event creation is not available.');
     providerMutationStarted=true;const event=await graph.createCalendarEvent(claim.data.action,parsed.action_id);
     await this.phase(db,ctx,parsed.action_id,'provider','accepted',event.id);await this.phase(db,ctx,parsed.action_id,'accepted','accepted');
    }
   });
   if(claim.data.action.kind==='send_mail')await this.connected(session,async(graph,row,db)=>{
    const ctx=await this.authority(db,session);if(claim.data.scope!==this.actionScope(ctx,row)||!graph.sendCreatedDraft)throw authorizationError();
    const provider=(await this.phaseRows(db,ctx,parsed.action_id)).find(r=>r.command.phase==='provider');
    const providerId=this.open<{id:string}>(parsed.action_id,provider.result.provider_ciphertext).id;
    await graph.sendCreatedDraft(providerId);await this.phase(db,ctx,parsed.action_id,'accepted','accepted');
   });
  }catch{
   // Do not record text from Graph or treat a timeout as a safe-to-retry failure.
   await localTransaction(this.pool,async db=>{const ctx=await this.authority(db,session);await this.phase(db,ctx,parsed.action_id,providerMutationStarted?'unknown':'failed',providerMutationStarted?'unknown':'failed');}).catch(()=>{});
  }
  return this.actionReceipt(session,parsed.action_id,true);
 }
 async disconnect(session:Session):Promise<MicrosoftStatus>{return this.checked(session,async ctx=>{
  await localTransaction(this.pool,async db=>{
   await this.recheck(db,session,ctx);const row=await this.row(db,ctx,true);
   await db.query('delete from companion_local.microsoft_oauth_pending where actor_id=$1 and participant_id=$2',[ctx.actor,ctx.participant]);
   if(row)await db.query("update companion_local.microsoft_connections set state='disconnected',token_ciphertext=null,selected_calendar_ids='{}',selected_mail_folder_ids='{}',last_read_at=null,last_error=null,revision=revision+1,updated_at=$2 where id=$1",[row.id,this.now()]);
  });return this.status(session);
 });}
}
