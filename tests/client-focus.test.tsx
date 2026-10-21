// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
vi.mock('../src/client/local-voice',()=>({startLocalVoice:vi.fn()}));
vi.mock('../src/client/voice',()=>({startVoice:vi.fn()}));
vi.mock('../src/client/pending-commands',()=>({PendingCommands:class {snapshot=[];async activate(){}async deactivate(){}subscribe(){return()=>{};}}}));
import {App} from '../src/client/App';
import {startLocalVoice} from '../src/client/local-voice';
import {resolveClientLayout} from '../src/client/client-layout';
import {clientBackend,clientResponse} from './helpers/client-interface-fixture';

afterEach(()=>{cleanup();document.querySelector('meta[name="nancy-focus-review"]')?.remove();document.documentElement.removeAttribute('data-nancy-focus');document.documentElement.style.removeProperty('--nancy-focus-dock-height');vi.restoreAllMocks();vi.resetAllMocks();vi.unstubAllGlobals();window.history.replaceState(null,'','/');});
function review(search='?layout=focus',enabled=true){const meta=document.createElement('meta');meta.name='nancy-focus-review';meta.content=enabled?'enabled':'disabled';document.head.append(meta);window.history.replaceState(null,'','/'+search);}
function voice(){let options!:Parameters<typeof startLocalVoice>[0];const handle={stop:vi.fn(async()=>{}),interrupt:vi.fn(),sendText:vi.fn(async()=>{})};vi.mocked(startLocalVoice).mockImplementation(async input=>{options=input;input.onReady?.(handle);input.onState('listening');return handle;});return {handle,options:()=>options};}
describe('opt-in Focus review and Current rollback',()=>{
 it('ships the owner-approved Current layout even when an old Focus review link is opened',async()=>{
  const entry=new DOMParser().parseFromString(readFileSync('index.html','utf8'),'text/html');
  const switchElement=entry.querySelector('meta[name="nancy-focus-review"]');
  expect(switchElement?.getAttribute('content')).toBe('disabled');document.head.append(switchElement!.cloneNode(true));window.history.replaceState(null,'','/?layout=focus');
  clientBackend();const view=render(<App/>);await screen.findByRole('button',{name:'Talk to Nancy'});expect(view.container.querySelector('.client-focus')).toBeNull();expect(screen.getByText('Ask Nancy about your day, meals, or anything you need help with.')).toBeInTheDocument();expect(startLocalVoice).not.toHaveBeenCalled();
 });
 it.each(['','?layout=current','?layout=other','?layout=Focus','?layout=focus&layout=current','?layout=focus&layout=focus'])('keeps %s on Current even when the experiment is enabled',search=>{expect(resolveClientLayout(search,true)).toBe('current');});
 it('requires both the explicit review link and its deployment switch',()=>{expect(resolveClientLayout('?layout=focus',false)).toBe('current');expect(resolveClientLayout('?layout=focus',true)).toBe('focus');});
 it('keeps the ordinary URL on the existing layout without microphone or extra navigation',async()=>{
  review('');clientBackend();const view=render(<App/>);await screen.findByRole('button',{name:'Talk to Nancy'});expect(view.container.querySelector('.client-focus')).toBeNull();expect(document.documentElement).not.toHaveAttribute('data-nancy-focus');expect(screen.getByRole('heading',{name:'Ready when you are'})).toBeInTheDocument();expect(screen.getByText('Ask Nancy about your day, meals, or anything you need help with.')).toBeInTheDocument();expect(startLocalVoice).not.toHaveBeenCalled();
 });
 it('opens Focus with one centered-dock entry and the same five read-only views, without starting voice',async()=>{
  review();const backend=clientBackend({local:true,microsoft:true});const view=render(<App/>);const talk=await screen.findByRole('button',{name:'Talk to Nancy'});expect(talk.closest('section')).toHaveClass('focus-voice-dock');expect(document.documentElement).toHaveAttribute('data-nancy-focus','true');expect(screen.getAllByRole('button',{name:'Talk to Nancy'})).toHaveLength(1);
  expect(within(screen.getByRole('navigation',{name:'My Day views'})).getAllByRole('button').map(b=>b.textContent)).toEqual(['Tasks','Meals','Groceries','Progress','Ask for Help']);expect(view.container.querySelectorAll('input,select,textarea')).toHaveLength(0);expect(startLocalVoice).not.toHaveBeenCalled();expect(backend.fetch.mock.calls.filter(([url,init])=>init?.method==='POST'&&!String(url).startsWith('/api/prompts/'))).toHaveLength(0);
 });
 it('preserves one active conversation and its visible Talk and Stop controls without interruption across views',async()=>{
  review();const v=voice();clientBackend();render(<App/>);fireEvent.click(await screen.findByRole('button',{name:'Talk to Nancy'}));await screen.findByRole('button',{name:'Stop voice'});act(()=>{v.options().onState('speaking');v.options().onTranscript('nancy','Your conversation stays here.');});
  for(const name of ['Meals','Tasks','Groceries','Progress','Ask for Help','Ways to use Nancy','Suggestions for Nancy'])fireEvent.click(screen.getByRole('button',{name}));
  expect(screen.getByText('Your conversation stays here.')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Talk to Nancy'})).toBeDisabled();expect(screen.getByRole('button',{name:'Talk to Nancy'}).closest('section')).toHaveClass('focus-voice-dock');expect(screen.queryByRole('button',{name:'Interrupt Nancy'})).not.toBeInTheDocument();expect(v.handle.interrupt).not.toHaveBeenCalled();expect(startLocalVoice).toHaveBeenCalledTimes(1);expect(v.handle.stop).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Stop voice'}));await waitFor(()=>expect(v.handle.stop).toHaveBeenCalledTimes(1));expect(screen.getByRole('button',{name:'Talk to Nancy'})).toBeEnabled();
 });
 it('does not change layout or restart voice when the URL is edited during a conversation',async()=>{
  review();const v=voice();clientBackend();render(<App/>);fireEvent.click(await screen.findByRole('button',{name:'Talk to Nancy'}));await screen.findByRole('button',{name:'Stop voice'});act(()=>{window.history.replaceState(null,'','/');window.dispatchEvent(new PopStateEvent('popstate'));});expect(screen.getByRole('button',{name:'Talk to Nancy'}).closest('section')).toHaveClass('focus-voice-dock');expect(startLocalVoice).toHaveBeenCalledTimes(1);expect(v.handle.stop).not.toHaveBeenCalled();
 });
 it('returns an opt-in review URL to Current when the deployment switch is off',async()=>{
  review('?layout=focus',false);clientBackend();const view=render(<App/>);await screen.findByRole('button',{name:'Talk to Nancy'});expect(view.container.querySelector('.client-focus')).toBeNull();expect(document.documentElement).not.toHaveAttribute('data-nancy-focus');expect(startLocalVoice).not.toHaveBeenCalled();
 });
 it('does not bypass sign-in through the review link',async()=>{
  review();const backend=clientBackend({override:path=>path==='/api/auth/session'?clientResponse({error:{code:'unauthenticated',message:'Please sign in.'}},401):undefined});const view=render(<App/>);await screen.findByRole('button',{name:'Sign in'});expect(view.container.querySelector('.client-focus')).toBeNull();expect(screen.queryByRole('button',{name:'Talk to Nancy'})).not.toBeInTheDocument();expect(backend.fetch.mock.calls.some(([url])=>url==='/api/today')).toBe(false);
 });
 it('stops voice and drops previous private conversation text on a scope change in Focus',async()=>{
  review();const v=voice(),backend=clientBackend();render(<App/>);fireEvent.click(await screen.findByRole('button',{name:'Talk to Nancy'}));await screen.findByRole('button',{name:'Stop voice'});act(()=>v.options().onTranscript('nancy','Old private conversation'));backend.state.scope='new-client-scope';act(()=>window.dispatchEvent(new Event('nancy:scope-changed')));await waitFor(()=>expect(v.handle.stop).toHaveBeenCalledTimes(1));expect(screen.queryByText('Old private conversation')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Talk to Nancy'})).toBeEnabled();
 });
 it('reserves the measured dock height after wrapping, then restores existing document settings on exit',async()=>{
  review();clientBackend();let height=154,resize!:()=>void;const disconnect=vi.fn();vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){return {height:this.classList.contains('focus-voice-dock')?height:0} as DOMRect;});vi.stubGlobal('ResizeObserver',class {constructor(fn:()=>void){resize=fn;}observe(){}disconnect=disconnect;});document.documentElement.setAttribute('data-nancy-focus','prior');document.documentElement.style.setProperty('--nancy-focus-dock-height','12px');
  const view=render(<App/>);await screen.findByRole('button',{name:'Talk to Nancy'});expect(document.documentElement.style.getPropertyValue('--nancy-focus-dock-height')).toBe('154px');height=310;act(()=>resize());expect(document.documentElement.style.getPropertyValue('--nancy-focus-dock-height')).toBe('310px');view.unmount();expect(disconnect).toHaveBeenCalled();expect(document.documentElement.getAttribute('data-nancy-focus')).toBe('prior');expect(document.documentElement.style.getPropertyValue('--nancy-focus-dock-height')).toBe('12px');
 });
});
