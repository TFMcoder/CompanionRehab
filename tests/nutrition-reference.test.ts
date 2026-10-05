import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadNutritionReference, NutritionReferenceError } from '../src/server/nutrition-reference.js';

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
});
