// @vitest-environment jsdom
import {afterEach,describe,it,expect,vi} from 'vitest';
import {keepConversationAwake} from '../src/client/conversation-awake';
afterEach(()=>{vi.restoreAllMocks();});
describe('foreground conversation screen wake lock',()=>{
 it('requests only a visible screen lock, releases on Stop and reacquires after browser release',async()=>{
  let visible='visible';vi.spyOn(document,'visibilityState','get').mockImplementation(()=>visible as DocumentVisibilityState);
  const sentinel={released:false,release:vi.fn(async()=>{})};const request=vi.fn(async()=>sentinel);
  Object.defineProperty(navigator,'wakeLock',{configurable:true,value:{request}});
  const stop=keepConversationAwake();await vi.waitFor(()=>expect(request).toHaveBeenCalledWith('screen'));
  visible='hidden';document.dispatchEvent(new Event('visibilitychange'));expect(request).toHaveBeenCalledTimes(1);
  sentinel.released=true;visible='visible';document.dispatchEvent(new Event('visibilitychange'));await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(2));
  stop();expect(sentinel.release).toHaveBeenCalledTimes(1);document.dispatchEvent(new Event('visibilitychange'));expect(request).toHaveBeenCalledTimes(2);
 });
 it('releases a late grant after stopping and tolerates denied or unsupported requests',async()=>{
  vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');let grant!:(value:WakeLockSentinel)=>void;
  const release=vi.fn(async()=>{});Object.defineProperty(navigator,'wakeLock',{configurable:true,value:{request:()=>new Promise(r=>{grant=r;})}});
  const stop=keepConversationAwake();stop();grant({release} as unknown as WakeLockSentinel);await vi.waitFor(()=>expect(release).toHaveBeenCalledTimes(1));
  Object.defineProperty(navigator,'wakeLock',{configurable:true,value:{request:vi.fn().mockRejectedValue(new DOMException('Denied','NotAllowedError'))}});
  const denied=keepConversationAwake();await Promise.resolve();denied();
  Object.defineProperty(navigator,'wakeLock',{configurable:true,value:undefined});keepConversationAwake()();
 });
});
