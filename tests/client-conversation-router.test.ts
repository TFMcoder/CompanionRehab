import {describe,expect,it,vi} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {ClientConversationRouter,type ConversationRuntime} from '../src/server/conversation-router.js';
import {createApp} from '../src/server/app.js';
import {configFromEnv} from '../src/server/config.js';
import {sealSession,type Session} from '../src/server/session.js';
import {SessionRevocations} from '../src/server/revocations.js';
import {ApiError} from '../src/server/errors.js';
import {splitSpeechParts} from '../src/shared/speech-parts.js';
import type {CareService} from '../src/server/care-access.js';
import type {LocalSpeech} from '../src/server/local-speech.js';
import {ClientSessionRenewal} from '../src/server/client-session-renewal.js';

const methods=['voiceAccess','start','turn','speech','preparedAudio','played','received','interrupt','cancelTurn','end','endLogin','close','prepareMeals','mealPreparationStatus','prepareConversation','conversationPreparationStatus'] as const;
function runtime(partSize:120|72){return Object.fromEntries([['speechPartSize',partSize],...methods.map(method=>[method,vi.fn(async()=>method)])]) as unknown as ConversationRuntime;}
function session(userId=randomUUID()):Session{return{user_id:userId,session_id:randomUUID(),access_token:'synthetic-access',refresh_token:'synthetic-refresh',issued_at:Date.now()/1000,expires_at:Date.now()/1000+3600};}

describe('one-client conversation routing',()=>{
  it.each(['voiceAccess','start','prepareMeals','mealPreparationStatus'] as const)('routes %s by its authenticated session, preserving all arguments',async method=>{
    const client=session(),other=session(),ordinary=runtime(120),selected=runtime(72),router=new ClientConversationRouter(client.user_id,ordinary,selected);
    for(const [actor,target,unused] of [[client,selected,ordinary],[other,ordinary,selected]] as const){
      const args=[actor,'synthetic-extra'];await (router[method] as any)(...args);
      expect(target[method]).toHaveBeenCalledWith(...args);expect(unused[method]).toHaveBeenCalledTimes(actor===client?0:1);
    }
  });
  it.each(['turn','speech','preparedAudio','played','received','interrupt','cancelTurn','end','prepareConversation','conversationPreparationStatus'] as const)('routes %s by its authenticated session rather than a conversation identifier',async method=>{
    const client=session(),other=session(),ordinary=runtime(120),selected=runtime(72),router=new ClientConversationRouter(client.user_id,ordinary,selected),id=randomUUID();
    await (router[method] as any)(id,client,'synthetic-extra');expect(selected[method]).toHaveBeenCalledWith(id,client,'synthetic-extra');expect(ordinary[method]).not.toHaveBeenCalled();
    await (router[method] as any)(id,other,'synthetic-extra');expect(ordinary[method]).toHaveBeenCalledWith(id,other,'synthetic-extra');expect(selected[method]).toHaveBeenCalledOnce();
  });
  it('does not fall back to another actor’s service after selected-route revocation',async()=>{
    const client=session(),ordinary=runtime(120),selected=runtime(72),router=new ClientConversationRouter(client.user_id,ordinary,selected);
    vi.mocked(selected.turn).mockRejectedValueOnce(new ApiError(403,'client_rollout_changed','Synthetic revocation'));
    await expect(router.turn(randomUUID(),client,randomUUID(),'Synthetic question')).rejects.toMatchObject({code:'client_rollout_changed'});
    expect(ordinary.turn).not.toHaveBeenCalled();
  });
  it('closes both private runtimes and clears a revoked login from both',()=>{
    const ordinary=runtime(120),selected=runtime(72),router=new ClientConversationRouter(randomUUID(),ordinary,selected),login=randomUUID();
    router.endLogin(login);router.close();for(const target of [ordinary,selected]){expect(target.endLogin).toHaveBeenCalledWith(login);expect(target.close).toHaveBeenCalledOnce();}
  });
  it('selects each actor’s speech size, including a nested session-specific selector',()=>{
    const client=session(),other=session(),ordinary=runtime(120),selected=runtime(72),router=new ClientConversationRouter(client.user_id,ordinary,selected);
    expect(router.speechPartSizeFor(client)).toBe(72);expect(router.speechPartSizeFor(other)).toBe(120);
    selected.speechPartSizeFor=vi.fn(()=>120 as const);expect(router.speechPartSizeFor(client)).toBe(120);expect(selected.speechPartSizeFor).toHaveBeenCalledWith(client);
  });
  it('serves the complete selected 72-character and ordinary 120-character HTTP speech sequences without loss',async()=>{
    const client=session(),other=session(),ordinary=runtime(120),selected=runtime(72),router=new ClientConversationRouter(client.user_id,ordinary,selected);
    const text='This deliberately long synthetic sentence carries enough words to cross both speech boundaries and prove the browser receives every word in the selected order. A second complete sentence follows.';
    for(const target of [ordinary,selected]){vi.mocked(target.speech).mockResolvedValue(text);vi.mocked(target.preparedAudio).mockResolvedValue(undefined);vi.mocked(target.prepareConversation).mockResolvedValue(undefined);vi.mocked(target.turn).mockImplementation(async(_id,_session,_turn,input)=>({text:typeof input==='function'?await input():input}) as any);}
    const config=configFromEnv({PUBLIC_ORIGIN:'https://nancy-client.example.invalid:8443',PORT:'8787',DATABASE_URL:'postgresql://synthetic.invalid/unused',SESSION_KEY:randomBytes(32).toString('base64'),VOICE_TRANSPORT:'local',NANCY_PLAN_USER_ID:other.user_id});
    const care={authorize:async(s:Session)=>s,authority:async(s:Session)=>({actor_id:s.user_id,login_session_id:s.session_id,active_role:'client',client_id:s.user_id,grant_revision:'synthetic-v1'}),close:async()=>{}} as unknown as CareService;
    const synthesize=vi.fn(async(part:string)=>Buffer.from(part));
    const transcribe=vi.fn(async()=> 'Synthetic ordinary speech');
    const speech={synthesize,transcribe,readiness:()=>({kokoro:'ready',asr:'ready'}),close:vi.fn(async()=>{})} as unknown as LocalSpeech;
    const selectedSynthesize=vi.fn(async(part:string)=>Buffer.from(part));
    const selectedTranscribe=vi.fn(async()=> 'Synthetic selected speech');
    const selectedSpeech={synthesize:selectedSynthesize,transcribe:selectedTranscribe,readiness:()=>({kokoro:'ready',asr:'ready'}),close:vi.fn(async()=>{})} as unknown as LocalSpeech;
    const app=await createApp(config,{care,conversation:router,speech,clientSpeech:{actorId:client.user_id,speech:selectedSpeech},clientSessionRenewal:new ClientSessionRenewal(other.user_id,client.user_id,config.origin),microsoft:null,revocations:new SessionRevocations()});
    try{
      for(const [actor,size,target] of [[client,72,selected],[other,120,ordinary]] as const){
        const id=randomUUID(),reply=randomUUID(),parts=splitSpeechParts(text,size),received:string[]=[];
        const headers={host:new URL(config.origin).host,origin:config.origin,cookie:'nancy_session='+sealSession(actor,config.sessionKey!)};
        for(let part=0;part<parts.length;part++){
          const response=await app.inject({url:`/api/conversation/${id}/speech?turn_id=${reply}&part=${part}`,headers});
          expect(response.statusCode).toBe(200);expect(response.body).toBe(parts[part]);received.push(response.body);
        }
        expect(received.join('')).toBe(text);expect(vi.mocked(target.prepareConversation).mock.calls.map(call=>call[4])).toEqual(parts.map((_,index)=>index===parts.length-1));
        const missing=await app.inject({url:`/api/conversation/${id}/speech?turn_id=${reply}&part=${parts.length}`,headers});expect(missing.statusCode).toBe(404);
        const captured=await app.inject({method:'POST',url:`/api/conversation/${id}/audio`,headers,payload:{turn_id:randomUUID(),wav:Buffer.alloc(64).toString('base64')}});expect(captured.statusCode).toBe(200);expect(captured.json().text).toBe(actor===client?'Synthetic selected speech':'Synthetic ordinary speech');
      }
      expect(splitSpeechParts(text,72).length).toBeGreaterThan(splitSpeechParts(text,120).length);
      expect(selectedSynthesize.mock.calls.map(call=>call[0])).toEqual(splitSpeechParts(text,72));
      expect(synthesize.mock.calls.map(call=>call[0])).toEqual(splitSpeechParts(text,120));
      expect(selectedTranscribe).toHaveBeenCalledOnce();expect(transcribe).toHaveBeenCalledOnce();
    }finally{await app.close();}
    expect(speech.close).toHaveBeenCalledOnce();expect(selectedSpeech.close).toHaveBeenCalledOnce();
  });
});
