import { describe,it,expect } from 'vitest';
import { foodCheckSource,suppressMealPrompt } from '../src/server/food-prompts.js';
const fact=(occurred_at:string,intake_kind='unknown')=>({id:'synthetic',revision:1,occurred_at,intake_kind});
describe('food prompt source facts',()=>{
 it('uses the local preferred day window while leaving intake and wakefulness unknown',()=>{
  expect(foodCheckSource(new Date('2026-10-14T09:59Z'),'America/Toronto',[])).toBeNull();
  const source=foodCheckSource(new Date('2026-10-14T16:00Z'),'America/Toronto',[])!;
  expect(source.due.toISOString()).toBe('2026-10-14T16:00:00.000Z');expect(source.text).toContain('Have you eaten');expect(source.text).not.toMatch(/fasting|awake|not eaten|six hours/i);
 });
 it('uses actual occurrence instead of report arrival, and a snack resets the uncertainty interval',()=>{
  const old=fact('2026-10-14T10:30Z','full_meal'),snack={...fact('2026-10-14T14:00Z','snack'),id:'snack'};
  const source=foodCheckSource(new Date('2026-10-14T20:00Z'),'America/Toronto',[old,snack])!;
  expect(source.due.toISOString()).toBe('2026-10-14T20:00:00.000Z');expect(source.version).toContain('snack:1');
 });
 it('does not compress a late breakfast into lunch and preserves unknown portions/kinds',()=>{
  const now=new Date('2026-10-14T15:00Z');expect(suppressMealPrompt(now,[fact('2026-10-14T14:30Z','full_meal')])).toBe(true);
  expect(suppressMealPrompt(now,[fact('2026-10-14T14:30Z')])).toBe(true);expect(suppressMealPrompt(now,[fact('2026-10-14T14:30Z','snack')])).toBe(false);
  expect(suppressMealPrompt(now,[fact('2026-10-14T14:00Z','full_meal')])).toBe(false);
 });
 it('uses UTC elapsed time at a DST boundary and resets only the local-day proxy',()=>{
  const source=foodCheckSource(new Date('2026-11-01T17:00Z'),'America/Toronto',[fact('2026-11-01T05:30Z')])!;
  expect(source.due.toISOString()).toBe('2026-11-01T17:00:00.000Z');
  expect(foodCheckSource(new Date('2026-10-15T04:05Z'),'America/Toronto',[fact('2026-10-15T03:50Z')])).toBeNull();
 });
});
