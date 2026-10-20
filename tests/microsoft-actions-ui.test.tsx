// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {MicrosoftActions} from '../src/client/MicrosoftActions';
import type {MicrosoftActionReview,MicrosoftActionReceipt} from '../src/shared/microsoft-contracts';
const id='12345678-1234-4234-8234-123456789abc';
function fixture(){
 const review:MicrosoftActionReview={action_id:id,action:{kind:'send_mail',to:['test@example.invalid'],subject:'Synthetic',body:'Exact body'},review_token:'0'.repeat(64),expires_at:'2026-10-19T16:15:00Z',time_zone:'America/Toronto',account:'sender@example.invalid',calendar_name:null};
 const receipt:MicrosoftActionReceipt={action_id:id,kind:'send_mail',state:'accepted',updated_at:'2026-10-19T16:00:00Z',message:'Microsoft accepted the request. Its final result is not yet verified.'};
 const service={actions:vi.fn(async()=>[] as MicrosoftActionReceipt[]),prepare:vi.fn(async()=>review),confirm:vi.fn(async()=>receipt),receipt:vi.fn(async()=>receipt),review:vi.fn(async()=>review)};
 return {service,review,receipt};
}
const props={localDate:'2026-10-19',timeZone:'America/Toronto'};
afterEach(cleanup);
describe('Outlook action screen review and recovery',()=>{
 it('shows sender, every recipient, subject and full body before an explicit send',async()=>{
  const {service}=fixture();render(<MicrosoftActions service={service} {...props}/>);
  fireEvent.change(screen.getByLabelText('To'),{target:{value:'test@example.invalid'}});fireEvent.change(screen.getByLabelText('Subject'),{target:{value:'Synthetic'}});fireEvent.change(screen.getByLabelText('Message'),{target:{value:'Exact body'}});
  fireEvent.click(screen.getByText('Review email'));await screen.findByText('From: sender@example.invalid');expect(screen.getByText('Exact body')).toBeInTheDocument();expect(service.confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Send this email'));await waitFor(()=>expect(service.confirm).toHaveBeenCalledWith({action_id:id,review_token:'0'.repeat(64)}));expect(await screen.findAllByText(/not yet verified/)).not.toHaveLength(0);
 });
 it('converts the entered event in the participant zone and reviews all invitation details',async()=>{
  const {service,review}=fixture();service.prepare.mockResolvedValue({...review,calendar_name:'Calendar',action:{kind:'create_event',subject:'Synthetic event',start:'2026-10-19T22:00:00Z',end:'2026-10-19T22:15:00Z',attendees:['test@example.invalid']}});
  render(<MicrosoftActions service={service} {...props}/>);fireEvent.change(screen.getByLabelText('Action'),{target:{value:'create_event'}});fireEvent.change(screen.getByLabelText('Invite'),{target:{value:'test@example.invalid'}});fireEvent.change(screen.getByLabelText('Event title'),{target:{value:'Synthetic event'}});
  fireEvent.click(screen.getByText('Review invitation'));await screen.findByText('Calendar: Calendar');
  expect(service.prepare).toHaveBeenCalledWith(expect.objectContaining({action:{kind:'create_event',subject:'Synthetic event',start:'2026-10-19T18:00:00-04:00',end:'2026-10-19T18:15:00-04:00',attendees:['test@example.invalid']}}));expect(service.confirm).not.toHaveBeenCalled();
 });
 it('does not repeat a send when its response is lost, and restores a checkable server receipt',async()=>{
  const {service,review,receipt}=fixture();service.actions.mockResolvedValue([{...receipt,state:'prepared'}]);service.confirm.mockRejectedValue(new Error('lost response'));
  render(<MicrosoftActions service={service} {...props}/>);fireEvent.click(await screen.findByText('Review prepared details'));await screen.findByText('Exact body');service.actions.mockResolvedValue([{...receipt,state:'unknown'}]);fireEvent.click(screen.getByText('Send this email'));
  await screen.findByText(/result is unconfirmed/);expect(service.confirm).toHaveBeenCalledTimes(1);expect(service.prepare).not.toHaveBeenCalled();expect(screen.queryByText('Send this email')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Check result'));await waitFor(()=>expect(service.receipt).toHaveBeenCalledWith(review.action_id));expect(service.confirm).toHaveBeenCalledTimes(1);
 });
 it('drops a late review after the component is unmounted for a scope change',async()=>{
  const {service,receipt,review}=fixture();service.actions.mockResolvedValue([{...receipt,state:'prepared'}]);let resolve!:(value:MicrosoftActionReview)=>void;service.review.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  const view=render(<MicrosoftActions service={service} {...props}/>);fireEvent.click(await screen.findByText('Review prepared details'));view.unmount();resolve(review);await Promise.resolve();expect(service.confirm).not.toHaveBeenCalled();
 });
});
