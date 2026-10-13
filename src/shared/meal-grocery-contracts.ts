import { z } from 'zod';
import { uuid, mealSlots } from './contracts.js';

const label = z.string().trim().min(1).max(160);
const unit = z.string().trim().min(1).max(32).nullable();
const amount = z.number().positive().max(999999).nullable();
export const ingredientSchema = z.object({ name: label, amount, unit }).strict();
export const mealDraftSchema = z.object({
  name: label, slots: z.array(z.enum(mealSlots)).min(1).max(3), portion: z.string().trim().min(1).max(160),
  ingredients: z.array(ingredientSchema).min(1).max(30), preference_notes: z.string().trim().max(500),
  source_refs: z.array(z.string().trim().min(1).max(300)).max(12),
}).strict().refine(v => new Set(v.slots).size === v.slots.length, 'Duplicate meal slot');
export type MealDraft = z.infer<typeof mealDraftSchema>;
export const pantryInputSchema = ingredientSchema;
export type PantryInput = z.infer<typeof pantryInputSchema>;
export const groceryInputSchema = ingredientSchema;
export type GroceryDraft = z.infer<typeof groceryInputSchema>;
const base = z.object({ idempotency_key: uuid }).strict();
export const mealGroceryCommandSchema = z.discriminatedUnion('type', [
  base.extend({ type: z.literal('propose_meal'), draft: mealDraftSchema }).strict(),
  base.extend({ type: z.literal('accept_meal'), proposal_id: uuid, expected_revision: z.number().int().positive() }).strict(),
  base.extend({ type: z.literal('upsert_pantry'), item_id: uuid.nullable(), expected_revision: z.number().int().nonnegative(), item: pantryInputSchema }).strict(),
  base.extend({ type: z.literal('remove_pantry'), item_id: uuid, expected_revision: z.number().int().positive() }).strict(),
  base.extend({ type: z.literal('add_grocery'), item: groceryInputSchema, proposal_id: uuid.nullable(), expected_proposal_revision: z.number().int().positive().nullable() }).strict(),
  base.extend({ type: z.literal('update_grocery'), item_id: uuid, expected_revision: z.number().int().positive(), item: groceryInputSchema }).strict(),
  base.extend({ type: z.literal('mark_grocery_acquired'), item_id: uuid, expected_revision: z.number().int().positive() }).strict(),
  base.extend({ type: z.literal('set_grocery_share'), actor_id: uuid, role: z.enum(['administrator','family_friend']), expected_revision: z.number().int().nonnegative(), can_read: z.boolean(), can_edit: z.boolean() }).strict(),
]);
export type MealGroceryCommand = z.infer<typeof mealGroceryCommandSchema>;
export interface PantryItem extends PantryInput { id: string; revision: number }
export interface ExpandedGroceryItem extends GroceryDraft { id: string; revision: number; acquired_at: string | null; meal_proposal_id: string | null; legacy_quantity: string | null }
export interface MealProposal { id: string; revision: number; draft: MealDraft; accepted_option_id: string | null; created_at: string }
export interface AcceptedMeal { id: string; name: string; slots: Array<typeof mealSlots[number]>; portion: string; ingredients: PantryInput[]; preference_notes: string; source_refs: string[]; proposal_id: string; accepted_at: string }
export interface GroceryShare { actor_id: string; role: 'administrator'|'family_friend'; label: string; can_read: boolean; can_edit: boolean; revision: number }
export interface MealGroceryWorkspace { role: string; can_edit: boolean; profile_revision: number; preferences: string | null; pantry: PantryItem[]; groceries: ExpandedGroceryItem[]; proposals: MealProposal[]; accepted_meals: AcceptedMeal[]; shares: GroceryShare[] }
export interface MealGroceryReceipt { command_id: string; result: Record<string, unknown>; replayed: boolean }
export interface GrocerySuggestion extends GroceryDraft { proposal_id: string; proposal_revision: number; already_in_pantry: boolean; already_on_list: boolean }
