// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MealGroceries, type MealGroceryClientService } from '../src/client/MealGroceries.js';
import type { MealGroceryCommand, MealGroceryWorkspace } from '../src/shared/meal-grocery-contracts.js';

afterEach(cleanup);
const base:MealGroceryWorkspace={role:'client',can_edit:true,profile_revision:1,preferences:'Likes warm lunches',pantry:[],groceries:[],proposals:[],accepted_meals:[],shares:[]};
function mock(view:MealGroceryWorkspace) {
  const command=vi.fn(async(_input:MealGroceryCommand)=>({command_id:'saved',result:{},replayed:false}));
  const service:MealGroceryClientService={workspace:vi.fn(async()=>view),suggestions:vi.fn(async()=>[]),command,receipt:vi.fn(async()=>null)};
  return {service,command};
}
describe('meal and grocery client view',()=>{
  it('keeps Talk to Nancy available while reviewing an exact meal proposal',async()=>{
    const {service,command}=mock({...base,proposals:[{id:'proposal-1',revision:1,draft:{name:'Soup',slots:['lunch'],portion:'One bowl',ingredients:[{name:'Carrots',amount:2,unit:'each'}],preference_notes:'Warm',source_refs:[]},accepted_option_id:null,created_at:'2026-10-13T14:00:00Z'}]});
    const onTalk=vi.fn();render(<MealGroceries service={service} scopeKey="client-1" mode="meals" onTalk={onTalk} />);
    await screen.findByText('Soup');fireEvent.click(screen.getByText('Talk to Nancy'));expect(onTalk).toHaveBeenCalledOnce();
    expect(screen.queryByText('Grocery list')).toBeNull();
    fireEvent.click(screen.getByText('Accept this meal choice'));
    await waitFor(()=>expect(command).toHaveBeenCalledWith(expect.objectContaining({type:'accept_meal',proposal_id:'proposal-1',expected_revision:1})));
  });
  it('retains the exact uncertain command until a receipt lookup resolves it',async()=>{
    const {service,command}=mock(base);command.mockRejectedValueOnce(new Error('Connection interrupted'));
    const receipt=vi.fn(async()=>({command_id:'saved',result:{},replayed:true}));service.receipt=receipt;
    render(<MealGroceries service={service} scopeKey="client-1" mode="groceries" onTalk={()=>{}} />);
    await screen.findByText('The list is empty.');
    expect(screen.queryByText('Review meal suggestions')).toBeNull();
    fireEvent.change(within(screen.getByText('Add a grocery item').closest('form')!).getByLabelText('Name'),{target:{value:'Rice'}});
    fireEvent.click(screen.getByText('Add to list'));
    await screen.findByText(/The save result is uncertain/);
    const sent=command.mock.calls[0][0];fireEvent.click(screen.getByText('Check saved result'));
    await waitFor(()=>expect(receipt).toHaveBeenCalledWith(sent.idempotency_key));
  });
  it('keeps the main grocery list visible while pantry and sharing stay collapsed',async()=>{
    const {service}=mock({...base,accepted_meals:[{id:'meal-1',proposal_id:'proposal-1',name:'Soup',slots:['lunch'],portion:'One bowl',ingredients:[],preference_notes:'',source_refs:[],accepted_at:'2026-10-13T14:00:00Z'}]});
    render(<MealGroceries service={service} scopeKey="client-1" mode="groceries" onTalk={()=>{}}/>);
    await screen.findByText('The list is empty.');
    expect(screen.getByText('Pantry (0)')).toBeTruthy();
    expect(screen.getByText('Share this list')).toBeTruthy();
    expect(screen.getByText('Add missing meal ingredients')).toBeTruthy();
    expect(screen.queryByText('Accepted meal choices')).toBeNull();
    expect(screen.getByRole('button',{name:'Add to list'})).toBeTruthy();
  });
  it('opens meal creation only when requested',async()=>{
    const {service}=mock(base);
    render(<MealGroceries service={service} scopeKey="client-1" mode="meals" onTalk={()=>{}}/>);
    await screen.findByText('No meal suggestions waiting.');
    expect(screen.getByText('Suggest a new meal').closest('details')?.open).toBe(false);
    fireEvent.click(screen.getByText('Suggest a new meal'));
    expect(screen.getByText('Suggest a new meal').closest('details')?.open).toBe(true);
    expect(screen.getByRole('textbox',{name:'Meal name'})).toBeTruthy();
  });
});
