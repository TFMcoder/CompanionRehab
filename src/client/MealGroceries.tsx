import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { MealDraft, MealGroceryCommand, MealGroceryReceipt, MealGroceryWorkspace, GrocerySuggestion, GroceryDraft } from '../shared/meal-grocery-contracts';

export interface MealGroceryClientService {
  workspace(): Promise<MealGroceryWorkspace>;
  suggestions(proposalId: string): Promise<GrocerySuggestion[]>;
  command(command: MealGroceryCommand): Promise<MealGroceryReceipt>;
  receipt(key: string): Promise<MealGroceryReceipt|null>;
}
export interface MealGroceriesProps { service: MealGroceryClientService; scopeKey: string; onTalk(): void; onChanged?(): void; refreshVersion?: number; mode?: 'meals'|'groceries'|'both' }
const blankItem = (): GroceryDraft => ({name:'',amount:null,unit:null});
const blankMeal = (): MealDraft => ({name:'',slots:['dinner'],portion:'',ingredients:[blankItem()],preference_notes:'',source_refs:[]});
const messageFor = (error: unknown) => error instanceof Error ? error.message : 'Could not reach the service. Check the saved list before trying again.';
function Quantity({ item, onChange }: {item:GroceryDraft; onChange(value:GroceryDraft):void}) {
  return <><input aria-label="Name" value={item.name} onChange={e=>onChange({...item,name:e.target.value})} placeholder="Item name" required />
    <input aria-label="Amount" type="number" min="0.001" step="any" value={item.amount??''} onChange={e=>onChange({...item,amount:e.target.value?Number(e.target.value):null})} placeholder="Amount" />
    <input aria-label="Unit" value={item.unit??''} onChange={e=>onChange({...item,unit:e.target.value||null})} placeholder="Unit, if known" /></>;
}
export function MealGroceries({service,scopeKey,onTalk,onChanged,refreshVersion=0,mode='both'}:MealGroceriesProps) {
  const [view,setView]=useState<MealGroceryWorkspace|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [issue,setIssue]=useState(''),[notice,setNotice]=useState('');
  const [meal,setMeal]=useState<MealDraft>(blankMeal()),[grocery,setGrocery]=useState<GroceryDraft>(blankItem()),[pantry,setPantry]=useState<GroceryDraft>(blankItem());
  const [editing,setEditing]=useState<{kind:'grocery'|'pantry';id:string;revision:number;item:GroceryDraft}|null>(null);
  const [suggestions,setSuggestions]=useState<GrocerySuggestion[]>([]);
  const [pending,setPending]=useState<MealGroceryCommand|null>(null);
  const epoch=useRef(0);
  async function reload(token=epoch.current) {
    setLoading(true);
    try { const next=await service.workspace(); if(epoch.current===token) {setView(next);setIssue('');} }
    catch(error) {if(epoch.current===token) {setView(null);setIssue(messageFor(error));}}
    finally {if(epoch.current===token)setLoading(false);}
  }
  useEffect(()=>{const token=++epoch.current;setView(null);setSuggestions([]);setPending(null);setEditing(null);void reload(token);return()=>{epoch.current++;};},[service,scopeKey,refreshVersion]);
  async function save(command:MealGroceryCommand,success:string):Promise<boolean> {
    setBusy(true);setIssue('');setNotice('');setPending(command);
    try {await service.command(command);setPending(null);setNotice(success);onChanged?.();await reload();return true;}
    catch(error) {setIssue(messageFor(error)); /* Keep exact command for receipt reconciliation. */return false;}
    finally {setBusy(false);}
  }
  async function checkPending() {
    if(!pending)return;setBusy(true);
    try {const found=await service.receipt(pending.idempotency_key);if(found){setPending(null);setNotice('The change was saved.');onChanged?.();await reload();}
      else {setPending(null);setNotice('No saved change was found. Review the current list before trying again.');await reload();}}
    catch(error){setIssue(messageFor(error));}finally{setBusy(false);}
  }
  function submitItem(event:FormEvent,kind:'grocery'|'pantry') {
    event.preventDefault();const item=kind==='grocery'?grocery:pantry;
    const command:MealGroceryCommand=kind==='grocery'
      ?{type:'add_grocery',idempotency_key:crypto.randomUUID(),item,proposal_id:null,expected_proposal_revision:null}
      :{type:'upsert_pantry',idempotency_key:crypto.randomUUID(),item_id:null,expected_revision:0,item};
    void save(command,kind==='grocery'?'Added to the list.':'Added to the pantry.').then(saved=>{if(saved){if(kind==='grocery')setGrocery(blankItem());else setPantry(blankItem());}});
  }
  function submitMeal(event:FormEvent) {
    event.preventDefault();void save({type:'propose_meal',idempotency_key:crypto.randomUUID(),draft:meal},'Meal suggestion saved for review.').then(saved=>{if(saved)setMeal(blankMeal());});
  }
  function saveEdit(event:FormEvent) {
    event.preventDefault();if(!editing)return;
    const command:MealGroceryCommand=editing.kind==='grocery'
      ?{type:'update_grocery',idempotency_key:crypto.randomUUID(),item_id:editing.id,expected_revision:editing.revision,item:editing.item}
      :{type:'upsert_pantry',idempotency_key:crypto.randomUUID(),item_id:editing.id,expected_revision:editing.revision,item:editing.item};
    void save(command,'Item updated.').then(saved=>{if(saved)setEditing(null);});
  }
  const locked=busy||!!pending;
  const showMeals=mode!=='groceries',showGroceries=mode!=='meals';
  return <section className="meal-groceries workflow-panel" aria-label={mode==='meals'?'Meal choices':mode==='groceries'?'Groceries':'Meals and groceries'}>
    <button type="button" className="primary-button" onClick={onTalk}>Talk to Nancy</button>
    <h2>{mode==='meals'?'Meal choices':mode==='groceries'?'Groceries':'Meals and groceries'}</h2>
    {loading&&<p role="status">Loading current choices…</p>}
    {issue&&<p role="alert">{issue}</p>}{notice&&<p role="status">{notice}</p>}
    {pending&&<p role="status">The save result is uncertain. <button type="button" disabled={busy} onClick={()=>void checkPending()}>Check saved result</button></p>}
    {showMeals&&view?.role==='client'&&<section className="workflow-section"><details className="workflow-details"><summary>Suggest a new meal</summary><p>Review ingredients and portions before accepting. Saving a suggestion does not add it to today’s plan.</p>
      {view.preferences&&<p>Saved preferences: {view.preferences}</p>}
      <form className="workflow-form" onSubmit={submitMeal}><input aria-label="Meal name" required value={meal.name} onChange={e=>setMeal({...meal,name:e.target.value})} placeholder="Meal name" />
        <label>For <select value={meal.slots[0]} onChange={e=>setMeal({...meal,slots:[e.target.value as MealDraft['slots'][number]]})}><option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option></select></label>
        <input aria-label="Portion" required value={meal.portion} onChange={e=>setMeal({...meal,portion:e.target.value})} placeholder="Ordinary portion preference" />
        <label>Ingredients</label>{meal.ingredients.map((item,index)=><div className="workflow-fields" key={index}><Quantity item={item} onChange={value=>setMeal({...meal,ingredients:meal.ingredients.map((old,i)=>i===index?value:old)})} />
          <button type="button" disabled={meal.ingredients.length===1} onClick={()=>setMeal({...meal,ingredients:meal.ingredients.filter((_,i)=>i!==index)})}>Remove ingredient</button></div>)}
        <button type="button" onClick={()=>setMeal({...meal,ingredients:[...meal.ingredients,blankItem()]})}>Add ingredient</button>
        <input aria-label="Preference notes" value={meal.preference_notes} onChange={e=>setMeal({...meal,preference_notes:e.target.value})} placeholder="Preference or change to discuss" />
        <details className="workflow-details"><summary>Recipe or source (optional)</summary><input aria-label="Recipe or source" value={meal.source_refs[0]??''} onChange={e=>setMeal({...meal,source_refs:e.target.value?[e.target.value]:[]})} placeholder="Recipe name or link" /></details>
        <button type="submit" className="primary-button" disabled={locked}>Save suggestion</button></form></details>
      <h3>Review meal suggestions</h3>{view.proposals.filter(p=>!p.accepted_option_id).length===0&&<p>No meal suggestions waiting.</p>}
      {view.proposals.filter(p=>!p.accepted_option_id).map(p=><article className="workflow-card" key={p.id}><h4>{p.draft.name}</h4><p>{p.draft.slots.join(', ')} · {p.draft.portion}</p>
        <p>Ingredients: {p.draft.ingredients.map(i=>`${i.name}${i.amount!==null?` ${i.amount}${i.unit?` ${i.unit}`:''}`:''}`).join(', ')}</p>
        {p.draft.preference_notes&&<p>{p.draft.preference_notes}</p>}{p.draft.source_refs.length>0&&<p>Sources: {p.draft.source_refs.join(', ')}</p>}
        <button type="button" className="primary-button" disabled={locked} onClick={()=>void save({type:'accept_meal',idempotency_key:crypto.randomUUID(),proposal_id:p.id,expected_revision:p.revision},'Meal choice accepted.')}>Accept this meal choice</button></article>)}
      <h3>Accepted meal choices</h3>{view.accepted_meals.length===0&&<p>No accepted meal choices yet.</p>}{view.accepted_meals.map(m=><article className="workflow-card" key={m.id}><h4>{m.name}</h4><p>{m.slots.join(', ')} · {m.portion}</p><p>Ingredients: {m.ingredients.map(i=>i.name).join(', ')}</p>{m.source_refs.length>0&&<p>Recipe or source: {m.source_refs.join(', ')}</p>}</article>)}
    </section>}
    {showGroceries&&view&&<section className="workflow-section"><h3>Grocery list</h3>{view.groceries.length===0&&<p>The list is empty.</p>}{view.groceries.map(i=><div className="workflow-row" key={i.id}><span>{i.name}{i.amount!==null?` · ${i.amount} ${i.unit??''}`:i.legacy_quantity?` · ${i.legacy_quantity}`:''}{i.acquired_at?' · Acquired':''}</span>
        {view.can_edit&&!i.acquired_at&&<div className="workflow-actions"><button type="button" disabled={locked} onClick={()=>setEditing({kind:'grocery',id:i.id,revision:i.revision,item:{name:i.name,amount:i.amount,unit:i.unit}})}>Edit</button><button type="button" disabled={locked} onClick={()=>void save({type:'mark_grocery_acquired',idempotency_key:crypto.randomUUID(),item_id:i.id,expected_revision:i.revision},'Marked acquired.')}>Mark acquired</button></div>}</div>)}
      {view.can_edit&&<form className="workflow-form workflow-card" onSubmit={e=>submitItem(e,'grocery')}><h4>Add a grocery item</h4><div className="workflow-fields"><Quantity item={grocery} onChange={setGrocery} /></div><button type="submit" className="primary-button" disabled={locked}>Add to list</button></form>}
      {editing&&<form className="workflow-form workflow-card" onSubmit={saveEdit}><h4>Edit {editing.kind==='pantry'?'pantry item':'grocery item'}</h4><div className="workflow-fields"><Quantity item={editing.item} onChange={item=>setEditing({...editing,item})} /></div><div className="workflow-actions"><button type="submit" className="primary-button" disabled={locked}>Save change</button><button type="button" onClick={()=>setEditing(null)}>Cancel</button></div></form>}
      <details className="workflow-details"><summary>Pantry ({view.pantry.length})</summary>{view.pantry.length===0&&<p>No pantry items saved.</p>}{view.pantry.map(i=><div className="workflow-row" key={i.id}><span>{i.name}{i.amount!==null?` · ${i.amount} ${i.unit??''}`:''}</span>
       {view.can_edit&&<div className="workflow-actions"><button type="button" disabled={locked} onClick={()=>setEditing({kind:'pantry',id:i.id,revision:i.revision,item:{name:i.name,amount:i.amount,unit:i.unit}})}>Edit</button><button type="button" disabled={locked} onClick={()=>void save({type:'remove_pantry',idempotency_key:crypto.randomUUID(),item_id:i.id,expected_revision:i.revision},'Pantry item removed.')}>Remove</button></div>}</div>)}
       {view.can_edit&&<form className="workflow-form" onSubmit={e=>submitItem(e,'pantry')}><h4>Add to pantry</h4><div className="workflow-fields"><Quantity item={pantry} onChange={setPantry} /></div><button type="submit" className="primary-button" disabled={locked}>Save pantry item</button></form>}</details>
      {view.role==='client'&&view.accepted_meals.length>0&&<details className="workflow-details"><summary>Add missing meal ingredients</summary><p>Check your pantry and list, then add only what you need.</p>{view.accepted_meals.map(m=><div className="workflow-row" key={m.id}><span>{m.name}</span><button type="button" disabled={locked} onClick={async()=>{try{setSuggestions(await service.suggestions(m.proposal_id));setIssue('');}catch(error){setIssue(messageFor(error));}}}>Check ingredients</button></div>)}
       {suggestions.length>0&&<section><h4>Ingredients to review</h4><p>Confirm amounts before adding anything.</p>{suggestions.map((i,index)=><div className="workflow-row" key={`${i.name}-${index}`}><span>{i.name}{i.amount!==null?` · ${i.amount} ${i.unit??''}`:''}{i.already_in_pantry?' · In pantry':i.already_on_list?' · On list':''}</span>{!i.already_in_pantry&&!i.already_on_list&&<button type="button" disabled={locked} onClick={()=>void save({type:'add_grocery',idempotency_key:crypto.randomUUID(),item:{name:i.name,amount:i.amount,unit:i.unit},proposal_id:i.proposal_id,expected_proposal_revision:i.proposal_revision},'Ingredient added to the list.')}>Add to list</button>}</div>)}</section>}</details>}
      {view.role==='client'&&<details className="workflow-details"><summary>Share this list</summary><p>Choose who can see or edit the list.</p>{view.shares.map(sh=><div className="workflow-row" key={`${sh.actor_id}-${sh.role}`}><span>{sh.label} · {sh.role} · {sh.can_edit?'Can edit':sh.can_read?'Can view':'No list access'}</span><div className="workflow-actions">
        <button type="button" disabled={locked} onClick={()=>void save({type:'set_grocery_share',idempotency_key:crypto.randomUUID(),actor_id:sh.actor_id,role:sh.role,expected_revision:sh.revision,can_read:true,can_edit:true},'Sharing updated.')}>Allow editing</button>
        <button type="button" disabled={locked} onClick={()=>void save({type:'set_grocery_share',idempotency_key:crypto.randomUUID(),actor_id:sh.actor_id,role:sh.role,expected_revision:sh.revision,can_read:true,can_edit:false},'Sharing updated.')}>View only</button>
        <button type="button" disabled={locked} onClick={()=>void save({type:'set_grocery_share',idempotency_key:crypto.randomUUID(),actor_id:sh.actor_id,role:sh.role,expected_revision:sh.revision,can_read:false,can_edit:false},'Sharing removed.')}>Remove access</button></div></div>)}</details>}
    </section>}
  </section>;
}
