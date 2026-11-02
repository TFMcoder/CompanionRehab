// @vitest-environment jsdom
import {StrictMode} from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {MicrosoftConnection,type MicrosoftClientService} from '../src/client/MicrosoftConnection';
import {microsoftUnavailable,type MicrosoftStatus,type MicrosoftResources} from '../src/shared/microsoft-contracts';

const stamp='2026-11-01T17:00:00Z';
const connected:MicrosoftStatus={available:true,eligible:true,state:'connected',revision:1,selected_calendar_ids:[],selected_mail_folder_ids:[],last_read_at:null,last_error:null,model_disclosure_enabled:true,reviewed_writes_enabled:false,access_mode:'calendar_read',source_label:'Additional approved calendar'};
const resources:MicrosoftResources={calendars:{items:[{id:'calendar-extra',name:'Approved appointments',owner:null,canEdit:false,isDefault:true,changeKey:null,etag:null,fetchedAt:stamp}],complete:true,truncation:null,fetchedAt:stamp},mail_folders:{items:[],complete:true,truncation:null,fetchedAt:stamp}};
function service(status=connected){return {status:vi.fn(async()=>status),connect:vi.fn(async()=>({authorization_url:'https://login.microsoftonline.com/10000000-0000-4000-8000-000000000001/oauth2/v2.0/authorize?state=synthetic'})),finish:vi.fn(async()=>connected),resources:vi.fn(async()=>resources),select:vi.fn(async input=>({...connected,revision:2,selected_calendar_ids:input.calendar_ids})),context:vi.fn(async()=>({source:'microsoft' as const,fetched_at:stamp,calendars:[],mail_folders:[],model_disclosure_enabled:true})),disconnect:vi.fn(async()=>({...connected,state:'disconnected' as const}))} satisfies MicrosoftClientService;}
const props={scopeKey:'synthetic-scope',localDate:'2026-11-01',timeZone:'America/Toronto'};
afterEach(()=>{cleanup();window.history.replaceState(null,'','/');});
describe('additional calendar-only setup',()=>{
 it('is absent when no optional source is configured',async()=>{
  const api=service(microsoftUnavailable);render(<MicrosoftConnection service={api} {...props} calendarOnly/>);
  await waitFor(()=>expect(screen.queryByLabelText('Additional Outlook calendar connection')).not.toBeInTheDocument());expect(api.connect).not.toHaveBeenCalled();
 });
 it('surfaces missing coverage and connects only by an explicit action',async()=>{
  const api=service({...connected,state:'disconnected'}),navigate=vi.fn();render(<MicrosoftConnection service={api} {...props} calendarOnly navigate={navigate}/>);
  await screen.findByText('Additional approved calendar');expect(screen.getByText(/Nancy cannot include this additional account/)).toBeInTheDocument();expect(api.connect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Connect additional calendar'));await waitFor(()=>expect(navigate).toHaveBeenCalledTimes(1));expect(api.context).not.toHaveBeenCalled();
 });
 it('offers calendar choices without mail folders or writes and sends an empty mail selection',async()=>{
  const api=service();render(<MicrosoftConnection service={api} {...props} calendarOnly/>);
  fireEvent.click(await screen.findByText('Choose calendars'));fireEvent.click(await screen.findByLabelText('Approved appointments'));
  expect(screen.queryByText('Mail folders')).not.toBeInTheDocument();expect(screen.queryByText('Messages received today')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Save additional calendar choices'));await screen.findByText('Additional calendar choices saved.');
  expect(api.select).toHaveBeenCalledWith({expected_revision:1,calendar_ids:['calendar-extra'],mail_folder_ids:[]});
 });
 it('finishes only the secondary callback marker once, while the primary card remains unchanged',async()=>{
  window.history.replaceState(null,'','/?microsoft=calendar-finish');const primary=service(),secondary=service();
  render(<StrictMode><MicrosoftConnection service={primary} {...props}/><MicrosoftConnection service={secondary} {...props} calendarOnly/></StrictMode>);
  await screen.findByText('Additional calendar connected. Choose which calendars to include.');expect(secondary.finish).toHaveBeenCalledTimes(1);expect(primary.finish).not.toHaveBeenCalled();expect(window.location.search).toBe('');
 });
 it('does not consume the primary finish callback',async()=>{
  window.history.replaceState(null,'','/?microsoft=finish');const api=service();render(<MicrosoftConnection service={api} {...props} calendarOnly/>);
  await screen.findByText('Additional approved calendar');expect(api.finish).not.toHaveBeenCalled();expect(window.location.search).toBe('?microsoft=finish');
 });
});
