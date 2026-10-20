import {beforeAll,afterAll,afterEach,describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {NancySuggestions} from '../src/server/nancy-suggestions';
import {ConversationService} from '../src/server/conversation';
import type {Reasoner} from '../src/server/plan-reasoner';
import type {InferenceBinding,InferenceScope} from '../src/server/inference-binding';
import type {CompletedTurn} from '../src/server/chatgpt-plan/inference';
import {createMicrosoftFixture,microsoftTestDatabase} from './helpers/microsoft-fixture';
import {LocalDayService} from '../src/server/local-day';
import {createLocalFeatures} from '../src/server/local-features';
const now=new Date('2026-10-19T16:00:00Z');
const say=(text='How can I help?'):CompletedTurn=>({completed:true,model:'gpt-6-sol',effort:'high',text,output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]});
const prepare=(suggestion:string):CompletedTurn=>({...say(''),output:[{type:'function_call',name:'prepare_nancy_suggestion',call_id:randomUUID(),arguments:JSON.stringify({suggestion})}]});
describe('voice product feedback, independent of care facts',()=>{
 let database:Awaited<ReturnType<typeof microsoftTestDatabase>>;const conversations:ConversationService[]=[];
 beforeAll(async()=>{database=await microsoftTestDatabase();});afterAll(async()=>database.close());afterEach(()=>{for(const service of conversations.splice(0))service.close();vi.restoreAllMocks();vi.useRealTimers();});
 async function fixture(){
  const f=await createMicrosoftFixture(database.pool,()=>now),suggestions=new NancySuggestions(database.pool,()=>now),respond=vi.fn<Reasoner['respond']>().mockResolvedValue(say()),account=randomUUID();
  const reasoner:Reasoner={bind:async(scope:InferenceScope):Promise<InferenceBinding>=>({...scope,route_id:'owner_practice',account_binding_id:account,qualification:'owner_practice'}),respond};
  const conversation=new ConversationService(f.care,reasoner,f.session.user_id,()=>now,undefined,undefined,undefined,undefined,undefined,undefined,undefined,suggestions);conversations.push(conversation);return {...f,suggestions,respond,conversation};
 }
 it('saves one exact actor-bound suggestion with a durable receipt and no care-plan write',async()=>{
  const f=await fixture(),command=await f.suggestions.prepare(f.session,'Use bigger buttons',randomUUID());expect(await f.suggestions.save(f.session,command)).toMatchObject({result:'saved',replayed:false});expect(await f.suggestions.save(f.session,command)).toMatchObject({replayed:true});
  expect(await f.suggestions.receipt(f.session,command.idempotency_key)).toMatchObject({result:'saved'});expect((await f.suggestions.workspace(f.session)).items).toHaveLength(1);expect((await f.suggestions.workspace(f.admin)).items[0].suggestion).toBe('Use bigger buttons');expect((await f.care.today(f.session)).checkin).toBeNull();
  await expect(f.suggestions.save(f.session,{...command,suggestion:'Different payload'})).rejects.toMatchObject({status:409});
 });
 it('isolates another participant and does not let an administrator submit as a client',async()=>{
  const f=await fixture(),other=await fixture(),command=await f.suggestions.prepare(f.session,'Synthetic feedback',randomUUID());await f.suggestions.save(f.session,command);
  expect((await other.suggestions.workspace(other.session)).items).toHaveLength(0);expect(await other.suggestions.receipt(other.session,command.idempotency_key)).toBeNull();await expect(f.suggestions.prepare(f.admin,'Admin impersonation',randomUUID())).rejects.toMatchObject({status:403});
 });
 it('rejects a revoked grant before saving feedback',async()=>{
  const f=await fixture(),command=await f.suggestions.prepare(f.session,'Synthetic feedback',randomUUID());await database.pool.query('update companion_local.role_grants set revoked_at=$2 where actor_id=$1',[f.session.user_id,now]);await expect(f.suggestions.save(f.session,command)).rejects.toMatchObject({status:401});
 });
 it('rejects a late feedback read if its care grant is revoked while the query is running',async()=>{
  const f=await fixture(),command=await f.suggestions.prepare(f.session,'Synthetic private feedback',randomUUID());await f.suggestions.save(f.session,command);
  const actual=database.pool.query.bind(database.pool);let revoked=false;
  vi.spyOn(database.pool,'query').mockImplementation((async(...args:any[])=>{const result=await (actual as any)(...args);if(!revoked&&typeof args[0]==='string'&&args[0].includes("command->>'suggestion'")){revoked=true;await actual('update companion_local.role_grants set revoked_at=$2 where actor_id=$1',[f.session.user_id,now]);}return result;}) as any);
  await expect(f.suggestions.workspace(f.session)).rejects.toMatchObject({status:401});
 });
 it.each([['help','what would you like a hand with?'],['suggestions','what would you like to improve about Nancy?']] as const)('opens the explicitly chosen %s conversation without inference or a write',async(purpose,opening)=>{
  const f=await fixture(),reply=await f.conversation.start(f.session,purpose);expect(reply.text).toContain(opening);expect(f.respond).not.toHaveBeenCalled();expect((await f.suggestions.workspace(f.session)).items).toHaveLength(0);
 });
 it('reads exact feedback aloud and requires full playback plus the immediately subsequent save phrase',async()=>{
  const f=await fixture(),started=await f.conversation.start(f.session);f.respond.mockResolvedValueOnce(prepare('Make the buttons clearer'));
  const review=await f.conversation.turn(started.session_id,f.session,randomUUID(),'I have a suggestion for improving Nancy.');expect(review.text).toContain('Make the buttons clearer');expect((await f.suggestions.workspace(f.session)).items).toHaveLength(0);
  f.conversation.played(started.session_id,f.session,review.reply_id);const turn=randomUUID();expect((await f.conversation.turn(started.session_id,f.session,turn,'Save this suggestion')).text).toContain('is saved');await f.conversation.turn(started.session_id,f.session,turn,'Save this suggestion');expect((await f.suggestions.workspace(f.session)).items).toHaveLength(1);
 });
 it.each(['unplayed','interrupt','ambiguous','topic_change'])('does not save a suggestion after %s',async mode=>{
  const f=await fixture(),started=await f.conversation.start(f.session);f.respond.mockResolvedValueOnce(prepare('Use bigger labels'));const review=await f.conversation.turn(started.session_id,f.session,randomUUID(),'I have a suggestion.');
  if(mode!=='unplayed')f.conversation.played(started.session_id,f.session,review.reply_id);if(mode==='interrupt')f.conversation.interrupt(started.session_id,f.session);if(mode==='topic_change')await f.conversation.turn(started.session_id,f.session,randomUUID(),'What is for dinner?');await f.conversation.turn(started.session_id,f.session,randomUUID(),mode==='ambiguous'?'yes':'save this suggestion');expect((await f.suggestions.workspace(f.session)).items).toHaveLength(0);
 });
 it('reconciles a committed suggestion after a lost save response without repeating it',async()=>{
  const f=await fixture(),started=await f.conversation.start(f.session);f.respond.mockResolvedValueOnce(prepare('Use a larger font'));const review=await f.conversation.turn(started.session_id,f.session,randomUUID(),'I have feedback.');f.conversation.played(started.session_id,f.session,review.reply_id);
  const actual=f.suggestions.save.bind(f.suggestions),save=vi.spyOn(f.suggestions,'save').mockImplementationOnce(async(...args)=>{await actual(...args);throw Error('lost response');});await expect(f.conversation.turn(started.session_id,f.session,randomUUID(),'save this suggestion')).rejects.toThrow();expect((await f.conversation.turn(started.session_id,f.session,randomUUID(),'Was it saved?')).text).toContain('is saved');expect(save).toHaveBeenCalledTimes(1);expect((await f.suggestions.workspace(f.session)).items).toHaveLength(1);
 });
 it('offers only the simplified authorized client navigation destinations',async()=>{
  const f=await fixture(),started=await f.conversation.start(f.session);await f.conversation.turn(started.session_id,f.session,randomUUID(),'What can you help me with?');const nav=f.respond.mock.calls[0][2].find(t=>t.name==='navigate');expect((nav?.parameters as any).properties.view.enum).toEqual(['my_day','tasks','meals','groceries','progress','ask_for_help','ways_to_use','suggestions']);expect(f.respond.mock.calls[0][1]).toContain('never ask them to type');
 });
 it('adds one reviewed task choice without replacing other tasks or accepting a day plan',async()=>{
  const f=await fixture(),day=new LocalDayService(database.pool,()=>now),revision=(await f.care.today(f.session)).profile!.revision;
  const command={type:'add_client_task' as const,idempotency_key:randomUUID(),confirmed:true as const,expected_profile_revision:revision,title:'Synthetic new task',urgency:'medium' as const,scheduled_date:'2026-10-19',scheduled_time:'18:30',duration_minutes:15};
  await day.command(f.session,command);expect(await day.command(f.session,command)).toMatchObject({replayed:true});const result=await f.care.today(f.session);expect(result.tasks.filter(t=>t.title===command.title)).toHaveLength(1);expect(result.checkin).toBeNull();expect(result.activity_ledger?.entries??[]).toHaveLength(0);
  await expect(day.command(f.session,{...command,idempotency_key:randomUUID(),title:'Stale task'})).rejects.toMatchObject({status:409});await expect(day.command(f.admin,{...command,idempotency_key:randomUUID()})).rejects.toMatchObject({status:403});
 });
 it('refuses ambiguous task wall times and preserves the task collection',async()=>{
  const f=await fixture(),day=new LocalDayService(database.pool,()=>now),revision=(await f.care.today(f.session)).profile!.revision;
  await expect(day.command(f.session,{type:'add_client_task',idempotency_key:randomUUID(),confirmed:true,expected_profile_revision:revision,title:'Ambiguous fixture',urgency:'low',scheduled_date:'2026-11-01',scheduled_time:'01:30',duration_minutes:null})).rejects.toMatchObject({status:400});expect((await f.care.today(f.session)).tasks).toHaveLength(0);
 });
 it('adds a local appointment once without an Outlook invitation or attendance report',async()=>{
  const f=await fixture(),day=new LocalDayService(database.pool,()=>now),command={type:'add_local_appointment' as const,idempotency_key:randomUUID(),confirmed:true as const,title:'Synthetic local appointment',starts_at:'2026-10-19T18:00:00-04:00'};
  await day.command(f.session,command);expect(await day.command(f.session,command)).toMatchObject({replayed:true});const today=await f.care.today(f.session);expect(today.appointments).toHaveLength(1);expect(today.activity_ledger?.entries??[]).toHaveLength(0);expect((await database.pool.query('select id from companion_local.microsoft_connections where actor_id=$1',[f.session.user_id])).rows).toHaveLength(0);
 });
 it.each(['add_client_task','add_local_appointment'] as const)('replaces manual %s entry with a fully played review and retained voice save',async type=>{
  // The session and services must share the synthetic date, even when this test
  // runs days later in CI. Timers and actual database I/O remain real.
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);
  const f=await fixture(),features={...createLocalFeatures(database.pool),day:new LocalDayService(database.pool,()=>now)},account=randomUUID();
  const reasoner:Reasoner={bind:async(scope:InferenceScope):Promise<InferenceBinding>=>({...scope,route_id:'owner_practice',account_binding_id:account,qualification:'owner_practice'}),respond:f.respond};
  const service=new ConversationService(f.care,reasoner,f.session.user_id,()=>now,undefined,undefined,undefined,undefined,features);conversations.push(service);const started=await service.start(f.session);
  const command=type==='add_client_task'?{type,title:'Synthetic task choice',urgency:'low',scheduled_date:'2026-10-19',scheduled_time:'18:30',duration_minutes:15,expected_profile_revision:(await f.care.today(f.session)).profile!.revision}:{type,title:'Synthetic local appointment',starts_at:'2026-10-19T18:00:00-04:00'};
  f.respond.mockResolvedValueOnce({...say(''),output:[{type:'function_call',name:'prepare_local_action',call_id:randomUUID(),arguments:JSON.stringify({family:'day',command})}]});const review=await service.turn(started.session_id,f.session,randomUUID(),'Please add this new item.');expect(review.text).toContain(type==='add_client_task'?'not an accepted day plan':'does not create an Outlook invitation');expect((await f.care.today(f.session)).tasks).toHaveLength(0);
  service.played(started.session_id,f.session,review.reply_id);const saved=await service.turn(started.session_id,f.session,randomUUID(),'Save this choice');expect(saved.changed).toBe(true);expect(saved.acknowledgement_required).toBe(true);await service.received(started.session_id,f.session,saved.reply_id);expect((await f.care.today(f.session)).checkin).toBeNull();
 });
 it('accepts the fixture login at its stated time and rejects it after expiry',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);const f=await fixture(),features=createLocalFeatures(database.pool);
  expect(await features.authorityRevision(f.session)).toBeTypeOf('string');
  vi.setSystemTime(new Date(now.getTime()+24*60*60_000));await expect(features.authorityRevision(f.session)).rejects.toMatchObject({status:401});
 });
});
