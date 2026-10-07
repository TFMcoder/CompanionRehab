import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createNutritionReferenceCache, loadNutritionReference, NutritionReferenceError } from '../src/server/nutrition-reference.js';

const docsDir = resolve('docs/nutrition');

describe('nutrition reference', () => {
  it('loads the real versioned documents with their exact on-disk hashes', () => {
    const reference = loadNutritionReference({ docsDir });
    const sources = reference.authorityContext().sources;
    expect(sources.map(source => source.documentId)).toEqual(['CR_NUTRITION_EVIDENCE_V1', 'CR_NUTRITION_MEALS_V1']);
    for (const source of sources) {
      expect(source.schemaVersion).toBe('1.0');
      expect(source.updated).toBe('2026-09-28');
      expect(source.sha256).toBe(createHash('sha256').update(readFileSync(resolve(source.path), 'utf8')).digest('hex'));
    }
    expect(sources.find(source => source.documentId === 'CR_NUTRITION_EVIDENCE_V1')).toMatchObject({
      status: 'evidence_informed_reference_not_clinical_authorization',
      clinicalReviewStatus: 'not_clinician_approved',
      upstreamSha256: '02120b901f1be8a539fd12ace416c2418f7d1535d06220e8906680461490bd69',
    });
  });

  it('keeps the compact always-on precedence and all eight repository guardrails', () => {
    const context = loadNutritionReference({ docsDir }).authorityContext().text;
    expect(context.length).toBeLessThanOrEqual(2_000);
    expect(context).toContain('immediate safety needs -> current human-approved clinical instructions');
    expect(context).toContain('participant choice and practical constraints');
    for (let index = 1; index <= 8; index++) expect(context).toContain(`G${String(index).padStart(2, '0')} -`);
    expect(context).toContain('A recipe record is not an approved meal');
    expect(context).toContain('Do not diagnose, change medication, prescribe fasting/supplements');
    expect(context).not.toContain('130-170');
  });

  it('exposes a compact claim index and retains findings, boundaries and source status', () => {
    const reference = loadNutritionReference({ docsDir });
    const index = reference.claimIndex();
    expect(index.items).toHaveLength(14);
    expect(index.items.find(claim => claim.id === 'C05')).toEqual({
      id: 'C05', title: 'Lower carbohydrate', sourceIds: ['R14'], sourceStatuses: ['unresolved'],
    });
    const result = reference.getClaims(['C05', 'C02']);
    expect(result.items.map(claim => claim.id)).toEqual(['C05', 'C02']);
    expect(result.items[0].limitation).toContain('not definitive evidence for long-term keto');
    expect(result.items[0].allowedInterpretation).toContain('one potentially useful strategy');
    expect(result.limitations.join(' ')).toContain('not clinical authorization');
    expect(result.sources[0].documentId).toBe('CR_NUTRITION_EVIDENCE_V1');
  });

  it('retrieves actual recipes as unapproved templates and filters deterministic meal options', () => {
    const reference = loadNutritionReference({ docsDir });
    const breakfasts = reference.listRecipes({ category: 'breakfast', limit: 2 });
    expect(breakfasts.items.map(recipe => recipe.id)).toEqual(['B01', 'B02']);
    expect(breakfasts.items[0]).toMatchObject({
      title: 'Berry-vanilla yogurt crunch', category: 'breakfast', yieldServings: 1,
      status: 'reference_templates_not_approved_patient_protocols',
    });
    const dinner = reference.getRecipes(['D03']);
    expect(dinner.items[0].recipeYaml).toContain('lean_ground_turkey: {qty: 600, unit: g, state: raw}');
    expect(dinner.items[0].recipeYaml).toContain('yield_servings: 4');
    expect(dinner.limitations.join(' ')).toContain('not approved meals');
    expect(dinner.limitations.join(' ')).toContain('planned meal is not a consumed meal');
  });
  it('includes one exact recipe with meal options under the existing provenance and size limits', () => {
    const reference = loadNutritionReference({ docsDir });
    const options = reference.recipeOptions({ category: 'breakfast', limit: 2 });
    expect(options.items.map(item => item.id)).toEqual(['B01', 'B02']);
    expect(options.items[0]).toMatchObject({ id: 'B01', recipeYaml: expect.stringContaining('yield_servings: 1') });
    expect(options.items[1]).not.toHaveProperty('recipeYaml');
    expect(options.sources.map(source => source.sha256)).toHaveLength(2);
    expect(options.limitations.join(' ')).toContain('not approved meals');
    expect(options.characterCount).toBeLessThanOrEqual(10_000);
    expect(options).toMatchObject({ total_matches: 5, offset: 0, has_more: true, next_offset: 2 });
    expect(options.characterCount).toBe(JSON.stringify(options).length);
  });

  it('makes all twenty recipes discoverable through bounded pages without skipping or repeating IDs', () => {
    const reference = loadNutritionReference({ docsDir });
    const found: string[] = [];
    let offset: number | null = 0;
    do {
      const page = reference.recipeOptions({ offset });
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.items.length).toBeLessThanOrEqual(2);
      expect(page.total_matches).toBe(20);
      expect(page.characterCount).toBe(JSON.stringify(page).length);
      expect(page.characterCount).toBeLessThanOrEqual(10_000);
      expect(page.sources).toHaveLength(2);
      found.push(...page.items.map(item => item.id));
      if (page.has_more) expect(page.next_offset).toBe(offset + page.items.length);
      else expect(page.next_offset).toBeNull();
      offset = page.next_offset;
    } while (offset !== null);
    expect(found).toHaveLength(20);
    expect(new Set(found).size).toBe(20);
    expect(found).toContain('D05');
  });

  it('finds later title and ingredient matches and offers new choices after refusal', () => {
    const reference = loadNutritionReference({ docsDir });
    const title = reference.recipeOptions({ category: 'dinner', search: 'lentil mushroom' });
    expect(title.items.map(item => item.id)).toEqual(['D05']);
    expect(title.items[0]).toHaveProperty('recipeYaml');
    expect(title).toMatchObject({ total_matches: 1, has_more: false, next_offset: null });
    expect(reference.recipeOptions({ category: 'dinner', search: 'lean ground turkey' }).items.map(item => item.id)).toEqual(['D03']);
    const alternatives = reference.recipeOptions({ category: 'breakfast', excludeIds: ['B01', 'B02'] });
    expect(alternatives.items.map(item => item.id)).toEqual(['B03', 'B04']);
    expect(alternatives).toMatchObject({ total_matches: 3, next_offset: 2, has_more: true });
    const last = reference.recipeOptions({ category: 'breakfast', excludeIds: ['B01', 'B02'], offset: alternatives.next_offset! });
    expect(last.items.map(item => item.id)).toEqual(['B05']);
    expect(last).toMatchObject({ total_matches: 3, has_more: false, next_offset: null });
    expect(reference.listRecipes({ search: 'nonexistentfixtureingredient' })).toMatchObject({ items: [], total_matches: 0, has_more: false, next_offset: null });
    expect(reference.listRecipes({ offset: 20 })).toMatchObject({ items: [], total_matches: 20, has_more: false, next_offset: null });
  });

  it('advances pages only by the entries that fit the result bound', () => {
    const reference = loadNutritionReference({ docsDir, maxResultChars: 3_000 });
    const first = reference.listRecipes({ limit: 10 });
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.items.length).toBeLessThan(10);
    expect(first.truncated).toBe(true);
    expect(first.next_offset).toBe(first.items.length);
    const next = reference.listRecipes({ limit: 10, offset: first.next_offset! });
    expect(next.items[0].id).not.toBe(first.items[0].id);
    for (const page of [first, next]) {
      expect(page.characterCount).toBe(JSON.stringify(page).length);
      expect(page.characterCount).toBeLessThanOrEqual(3_000);
    }
  });

  it('rejects invalid discovery queries instead of silently returning the first choices', () => {
    const reference = loadNutritionReference({ docsDir });
    for (const query of [
      { offset: -1 }, { offset: 1.5 }, { offset: 10001 }, { search: '  ' }, { search: 'x'.repeat(161) },
      { excludeIds: ['B99'] }, { excludeIds: ['C01'] }, { excludeIds: Array(21).fill('B01') },
    ]) expect(() => reference.recipeOptions(query)).toThrow(NutritionReferenceError);
  });

  it('fails closed for unknown IDs, duplicate IDs and oversized detail requests', () => {
    const reference = loadNutritionReference({ docsDir });
    for (const action of [
      () => reference.getClaims(['C99']),
      () => reference.getRecipes(['B99']),
      () => reference.getClaims(['C01', 'C01']),
      () => reference.getRecipes(['B01', 'B02', 'B03']),
    ]) {
      expect(action).toThrow(NutritionReferenceError);
    }
  });

  it('bounds serialized retrieval while retaining provenance and guardrail limitations', () => {
    const reference = loadNutritionReference({ docsDir, maxResultChars: 2_000 });
    const result = reference.getRecipes(['D03', 'D05']);
    expect(result.characterCount).toBeLessThanOrEqual(2_000);
    expect(result.truncated).toBe(true);
    expect(result.sources.map(source => source.documentId)).toEqual(['CR_NUTRITION_MEALS_V1', 'CR_NUTRITION_EVIDENCE_V1']);
    expect(result.limitations).toHaveLength(3);
    expect(result.limitations.join(' ')).toContain('allergies/cross-contact');
    expect(result.limitations.join(' ')).toContain('grocery proposal is not an order');
  });
  it('reuses the parsed index until a source changes, then serves the updated repository document', () => {
    const temp = mkdtempSync(resolve(tmpdir(), 'nancy-nutrition-'));
    try {
      for (const name of ['research-knowledge-base.md', 'meal-library.md']) copyFileSync(resolve(docsDir, name), resolve(temp, name));
      const current = createNutritionReferenceCache({ docsDir: temp });
      const initial = current();
      expect(current()).toBe(initial);
      const path = resolve(temp, 'meal-library.md');
      writeFileSync(path, readFileSync(path, 'utf8').replace('Berry-vanilla yogurt crunch', 'Berry yogurt crunch'));
      const future = new Date(Date.now() + 5_000);
      utimesSync(path, future, future);
      const changed = current();
      expect(changed).not.toBe(initial);
      expect(changed.getRecipes(['B01']).items[0].title).toBe('Berry yogurt crunch');
      expect(changed.authorityContext().sources[1].sha256).not.toBe(initial.authorityContext().sources[1].sha256);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
});
