// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
vi.mock('../src/client/local-voice',()=>({startLocalVoice:vi.fn()}));
vi.mock('../src/client/voice',()=>({startVoice:vi.fn()}));
vi.mock('../src/client/pending-commands',()=>({PendingCommands:class {snapshot=[];async activate(){}async deactivate(){}subscribe(){return()=>{};}}}));
import {App} from '../src/client/App';
import {clientBackend,clientResponse} from './helpers/client-interface-fixture';
afterEach(()=>{cleanup();vi.resetAllMocks();vi.unstubAllGlobals();window.history.replaceState(null,'','/');});
describe('live-test sign-in and narrowly scoped Outlook recovery',()=>{
 it('offers optional trusted-device sign-in and sends only the explicit choice',async()=>{
  let signed=false;const backend=clientBackend({override:(path,init)=>{
   if(path==='/api/auth/session'&&!signed)return clientResponse({error:{code:'unauthorized',message:'Sign in.'}},401);
   if(path==='/api/auth/login'){signed=true;return clientResponse({ok:true});}
  }});
  render(<App/>);const choice=await screen.findByRole('checkbox',{name:'Keep me signed in on this device for 30 days'});expect(choice).not.toBeChecked();
  fireEvent.change(screen.getByLabelText('Email'),{target:{value:'synthetic@example.invalid'}});fireEvent.change(screen.getByLabelText('Password'),{target:{value:'Synthetic-login-test-only!'}});fireEvent.click(choice);fireEvent.click(screen.getByRole('button',{name:'Sign in'}));
  await screen.findByRole('button',{name:'Talk to Nancy'});const login=backend.fetch.mock.calls.find(([path])=>path==='/api/auth/login');expect(JSON.parse(String(login?.[1]?.body)).remember_device).toBe(true);
 });
 it('opens the existing consent-bound connector setup only for the eligible client and only on its review link',async()=>{
  window.history.replaceState(null,'','/?setup=outlook');
  clientBackend({microsoft:true,override:path=>path==='/api/microsoft'?clientResponse({available:true,eligible:true,state:'reconnect_required',revision:3,selected_calendar_ids:[],selected_mail_folder_ids:[],last_read_at:null,last_error:'authorization_changed',model_disclosure_enabled:false}):undefined});
  render(<App/>);expect(await screen.findByRole('button',{name:'Connect Outlook'})).toBeInTheDocument();expect(screen.getByRole('region',{name:'Outlook setup'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Done with Outlook setup'}));expect(screen.queryByRole('region',{name:'Outlook setup'})).not.toBeInTheDocument();expect(window.location.search).toBe('');expect(screen.getByRole('button',{name:'Talk to Nancy'})).toBeEnabled();
 });
 it('cannot expose Outlook setup through a query string on an account without the connector',async()=>{
  window.history.replaceState(null,'','/?setup=outlook');const backend=clientBackend({microsoft:false});render(<App/>);await screen.findByRole('button',{name:'Talk to Nancy'});
  expect(screen.queryByRole('region',{name:'Outlook setup'})).not.toBeInTheDocument();expect(backend.fetch.mock.calls.some(([path])=>path==='/api/microsoft')).toBe(false);
 });
});
