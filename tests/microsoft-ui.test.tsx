// @vitest-environment jsdom
import {StrictMode} from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {MicrosoftConnection,microsoftDayRange,type MicrosoftClientService} from '../src/client/MicrosoftConnection';
import {ApiError} from '../src/client/api';
import type {MicrosoftStatus,MicrosoftResources,MicrosoftContext} from '../src/shared/microsoft-contracts';

const stamp='2026-10-17T14:00:00Z';
const connected:MicrosoftStatus={available:true,eligible:true,state:'connected',revision:1,selected_calendar_ids:[],selected_mail_folder_ids:[],last_read_at:null,last_error:null,model_disclosure_enabled:false};
const collection=<T,>(items:T[],complete=true)=>({items,complete,fetchedAt:stamp,truncation:complete?null:'pages' as const});
const resources:MicrosoftResources={calendars:collection([{id:'calendar-a',name:'Personal',owner:null,canEdit:true,isDefault:true,changeKey:null,etag:null,fetchedAt:stamp}]),mail_folders:collection([{id:'folder-a',displayName:'Inbox',parentFolderId:null,childFolderCount:0,totalItemCount:null,unreadItemCount:null,fetchedAt:stamp}])};
const empty:MicrosoftContext={source:'microsoft',fetched_at:stamp,calendars:[],mail_folders:[],model_disclosure_enabled:false};
function fixture(status:MicrosoftStatus=connected){
 const service={status:vi.fn(async()=>status),connect:vi.fn(async()=>({authorization_url:'https://login.microsoftonline.com/10000000-0000-4000-8000-000000000001/oauth2/v2.0/authorize?state=test'})),finish:vi.fn(async()=>connected),resources:vi.fn(async()=>resources),select:vi.fn(async input=>({...connected,revision:2,selected_calendar_ids:input.calendar_ids,selected_mail_folder_ids:input.mail_folder_ids})),context:vi.fn(async()=>empty),disconnect:vi.fn(async()=>({...connected,state:'disconnected' as const,revision:3}))} satisfies MicrosoftClientService;
 return service;
}
const props={scopeKey:'one',localDate:'2026-10-17',timeZone:'America/Toronto'};
afterEach(()=>{cleanup();window.history.replaceState(null,'','/');});
describe('initial Outlook connection UI',()=>{
 it('requires selected resources and explicit read instead of fetching mail on mount',async()=>{
  const service=fixture();render(<MicrosoftConnection service={service} {...props}/>);
  await screen.findByText('Connected');expect(service.resources).not.toHaveBeenCalled();expect(service.context).not.toHaveBeenCalled();
  expect(screen.getByText('Show today’s Outlook items')).toBeDisabled();fireEvent.click(screen.getByText('Choose calendars and folders'));
  fireEvent.click(await screen.findByLabelText('Personal'));fireEvent.click(screen.getByLabelText('Inbox'));
  expect(service.select).not.toHaveBeenCalled();fireEvent.click(screen.getByText('Save Outlook choices'));await screen.findByText('Outlook choices saved.');
  expect(service.select).toHaveBeenCalledWith({expected_revision:1,calendar_ids:['calendar-a'],mail_folder_ids:['folder-a']});
  fireEvent.click(screen.getByText('Show today’s Outlook items'));await screen.findByText(/No appointments were returned/);
  expect(service.context).toHaveBeenCalledWith({start:'2026-10-17T00:00:00-04:00',end:'2026-10-18T00:00:00-04:00'});
 });
 it('completes a callback once under React strict effects and removes the URL marker',async()=>{
  window.history.replaceState(null,'','/?microsoft=finish');const service=fixture();
  render(<StrictMode><MicrosoftConnection service={service} {...props}/></StrictMode>);
  await screen.findByText('Outlook connected. Choose what to show.');expect(service.finish).toHaveBeenCalledTimes(1);expect(window.location.search).toBe('');
 });
 it('only navigates to Microsoft authorization, on an explicit connect click',async()=>{
  const service=fixture({...connected,state:'disconnected'}),navigate=vi.fn();render(<MicrosoftConnection service={service} {...props} navigate={navigate}/>);
  fireEvent.click(await screen.findByText('Connect Outlook'));await waitFor(()=>expect(navigate).toHaveBeenCalledTimes(1));
  expect(service.context).not.toHaveBeenCalled();
 });
 it('reports a failed provider callback and removes its marker',async()=>{
  window.history.replaceState(null,'','/?microsoft=failed');const service=fixture({...connected,state:'disconnected'});
  render(<MicrosoftConnection service={service} {...props}/>);
  await screen.findByText('Microsoft sign-in was not completed. You can try again.');expect(window.location.search).toBe('');expect(service.finish).not.toHaveBeenCalled();
 });
 it('recovers connection controls after a failed finish',async()=>{
  window.history.replaceState(null,'','/?microsoft=finish');const service=fixture({...connected,state:'disconnected'});service.finish.mockRejectedValueOnce(new ApiError(400,'microsoft_connection_failed','Microsoft could not connect the approved account.'));
  render(<MicrosoftConnection service={service} {...props}/>);await screen.findByText('Connect Outlook');expect(window.location.search).toBe('');
 });
 it('offers reconnect immediately after provider authorization is lost',async()=>{
  const service=fixture({...connected,selected_calendar_ids:['calendar-a']});render(<MicrosoftConnection service={service} {...props}/>);
  await screen.findByText('Connected');service.status.mockResolvedValue({...connected,state:'reconnect_required'});service.context.mockRejectedValueOnce(new ApiError(403,'microsoft_reconnect_required','Microsoft needs you to reconnect.'));
  fireEvent.click(screen.getByText('Show today’s Outlook items'));await screen.findByText('Connect Outlook');expect(screen.queryByText('Show today’s Outlook items')).not.toBeInTheDocument();
 });
 it('rejects an unexpected authorization destination',async()=>{
  const service=fixture({...connected,state:'disconnected'}),navigate=vi.fn();service.connect.mockResolvedValue({authorization_url:'https://outside.invalid/steal'});
  render(<MicrosoftConnection service={service} {...props} navigate={navigate}/>);fireEvent.click(await screen.findByText('Connect Outlook'));await screen.findByText(/Outlook could not finish/);expect(navigate).not.toHaveBeenCalled();
 });
 it('waits for disconnect confirmation and clears displayed provider items',async()=>{
  const service=fixture({...connected,selected_calendar_ids:['calendar-a']});render(<MicrosoftConnection service={service} {...props}/>);
  fireEvent.click(await screen.findByText('Show today’s Outlook items'));await screen.findByText(/Read from Outlook at/);
  fireEvent.click(screen.getByText('Disconnect Outlook'));expect(service.disconnect).not.toHaveBeenCalled();fireEvent.click(screen.getByText('Confirm disconnect'));
  await screen.findByText('Outlook disconnected from Nancy.');expect(screen.queryByLabelText('Today’s Outlook items')).not.toBeInTheDocument();
 });
 it('discards a delayed old-account response after scope changes',async()=>{
  const service=fixture(),next=fixture({...connected,state:'disconnected'});let resolve!:(value:MicrosoftResources)=>void;
  service.resources.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));const view=render(<MicrosoftConnection service={service} {...props}/>);
  fireEvent.click(await screen.findByText('Choose calendars and folders'));view.rerender(<MicrosoftConnection service={next} {...props} scopeKey="two"/>);
  await screen.findByText('Not connected');resolve(resources);await waitFor(()=>expect(screen.queryByLabelText('Personal')).not.toBeInTheDocument());
 });
 it('shows partial results honestly and removes stale content when a refresh is denied',async()=>{
  const service=fixture({...connected,selected_calendar_ids:['calendar-a']});service.context.mockResolvedValueOnce({...empty,calendars:[{id:'calendar-a',result:collection([],false)}]});
  render(<MicrosoftConnection service={service} {...props}/>);fireEvent.click(await screen.findByText('Show today’s Outlook items'));await screen.findByText(/This is a partial result/);
  service.context.mockRejectedValueOnce(new ApiError(403,'resource_denied','That calendar is no longer shared.'));fireEvent.click(screen.getByText('Show today’s Outlook items'));
  await screen.findByText('That calendar is no longer shared.');expect(screen.queryByLabelText('Today’s Outlook items')).not.toBeInTheDocument();
 });
 it('uses a 25-hour participant-local day at the autumn clock change',()=>{
  const range=microsoftDayRange('2026-11-01','America/Toronto');expect(Date.parse(range.end)-Date.parse(range.start)).toBe(25*3600_000);
 });
});
