import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type NutritionDocumentId = 'CR_NUTRITION_EVIDENCE_V1' | 'CR_NUTRITION_MEALS_V1';
export type MealCategory = 'breakfast' | 'lunch' | 'snack' | 'dinner';

export interface NutritionSourceRef {
  documentId: NutritionDocumentId;
  schemaVersion: string;
  contentVersion: string;
  updated: string;
  status: string;
  scope: string;
  clinicalReviewStatus: string | null;
  path: string;
  sha256: string;
  upstreamSha256: string | null;
}

export interface NutritionAuthorityContext {
  text: string;
  sources: NutritionSourceRef[];
}

export interface ClaimIndexEntry {
  id: string;
  title: string;
  sourceIds: string[];
  sourceStatuses: string[];
}

export interface NutritionClaim extends ClaimIndexEntry {
  evidenceFinding: string;
  allowedInterpretation: string;
  limitation: string;
}

export interface RecipeSummary {
  id: string;
  title: string;
  category: MealCategory;
  yieldServings: number;
  activeMinutes: number;
  totalMinutes: number;
  allergens: string[];
  carbSources: string[];
  status: string;
  sourceDocumentId: NutritionDocumentId;
}

export interface NutritionRecipe extends RecipeSummary {
  recipeVersion: string;
  recipeYaml: string;
}

export interface NutritionReferenceResult<T> {
  items: T[];
  sources: NutritionSourceRef[];
  limitations: string[];
  truncated: boolean;
  characterCount: number;
}

export interface NutritionReference {
  authorityContext(): NutritionAuthorityContext;
  claimIndex(): NutritionReferenceResult<ClaimIndexEntry>;
  getClaims(ids: string[]): NutritionReferenceResult<NutritionClaim>;
  listRecipes(options?: { category?: MealCategory; limit?: number }): NutritionReferenceResult<RecipeSummary>;
  getRecipes(ids: string[]): NutritionReferenceResult<NutritionRecipe>;
}

export class NutritionReferenceError extends Error {
  constructor(public readonly code: 'invalid_reference_request' | 'unknown_reference' | 'invalid_reference_source', message: string) {
    super(message);
    this.name = 'NutritionReferenceError';
  }
}

interface ParsedDocument {
  source: NutritionSourceRef;
  metadata: Record<string, string>;
  body: string;
}

interface SourceStatus {
  id: string;
  status: string;
}

const DEFAULT_DOCS_DIR = fileURLToPath(new URL('../../docs/nutrition', import.meta.url));
const DEFAULT_MAX_RESULT_CHARS = 10_000;
const MAX_ITEMS_PER_DETAIL_CALL = 2;
const AUTHORITY_MAX_CHARS = 2_000;

const evidenceLimitations = [
  'Evidence-informed reference only; it is not clinical authorization or an approved participant protocol.',
  'Keep each claim with its allowed interpretation, boundary, source IDs and source-status limitations.',
  'Current human-approved instructions, verified safety constraints and participant preferences take precedence.',
];

const recipeLimitations = [
  'Recipe records are reference templates, not approved meals or proof of nutritional adequacy.',
  'Confirm the participant, protocol, allergies/cross-contact, texture needs, preferences, support, portions and medication timing before personalized use.',
  'A planned meal is not a consumed meal, and a grocery proposal is not an order.',
];

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function parseFrontMatter(raw: string, referencePath: string): ParsedDocument {
  const normalized = raw.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(normalized);
  if (!match) throw new NutritionReferenceError('invalid_reference_source', `Nutrition source has no valid front matter: ${referencePath}`);
  const metadata: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const field = /^([a-z0-9_]+):\s*(.*)$/.exec(line);
    if (!field) continue;
    metadata[field[1]] = field[2].trim().replace(/^"|"$/g, '');
  }
  const documentId = metadata.document_id as NutritionDocumentId;
  if (!['CR_NUTRITION_EVIDENCE_V1', 'CR_NUTRITION_MEALS_V1'].includes(documentId)) {
    throw new NutritionReferenceError('invalid_reference_source', `Unknown nutrition document ID in ${referencePath}`);
  }
  for (const key of ['schema_version', 'updated', 'status', 'scope']) {
    if (!metadata[key]) throw new NutritionReferenceError('invalid_reference_source', `Nutrition source ${documentId} is missing ${key}`);
  }
  return {
    metadata,
    body: match[2],
    source: {
      documentId,
      schemaVersion: metadata.schema_version,
      contentVersion: metadata.recipe_version ?? metadata.schema_version,
      updated: metadata.updated,
      status: metadata.status,
      scope: metadata.scope,
      clinicalReviewStatus: metadata.clinical_review_status ?? null,
      path: referencePath,
      sha256: sha256(raw),
      upstreamSha256: metadata.source_guide_sha256 ?? null,
    },
  };
}

function section(body: string, heading: string, nextHeadingLevel = 2) {
  const headingStart = body.indexOf(heading);
  if (headingStart < 0) return '';
  const contentStart = body.indexOf('\n', headingStart + heading.length);
  if (contentStart < 0) return '';
  const remaining = body.slice(contentStart + 1);
  const next = new RegExp(`^${'#'.repeat(nextHeadingLevel)}\\s`, 'm').exec(remaining);
  return (next ? remaining.slice(0, next.index) : remaining).trim();
}

function tableRows(markdown: string) {
  return markdown.split('\n')
    .filter(line => /^\|.+\|\s*$/.test(line) && !/^\|\s*[-:]+/.test(line))
    .map(line => line.slice(1, line.lastIndexOf('|')).split('|').map(cell => cell.trim()))
    .filter((_, index) => index > 0);
}

function bracketList(value: string) {
  const match = /^\[([^\]]*)\]$/.exec(value.trim());
  if (!match || !match[1].trim()) return [];
  return match[1].split(',').map(item => item.trim());
}

function scalar(yaml: string, key: string) {
  const match = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(yaml);
  return match?.[1]?.trim();
}

function normalizeIds(ids: string[], prefix: 'C' | 'recipe') {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_ITEMS_PER_DETAIL_CALL) {
    throw new NutritionReferenceError('invalid_reference_request', `Request one or two ${prefix === 'C' ? 'claim' : 'recipe'} IDs.`);
  }
  const normalized = ids.map(id => String(id).trim().toUpperCase());
  if (new Set(normalized).size !== normalized.length) throw new NutritionReferenceError('invalid_reference_request', 'Duplicate reference IDs are not allowed.');
  return normalized;
}

function result<T>(items: T[], sources: NutritionSourceRef[], limitations: string[], maxChars: number, requestedCount = items.length): NutritionReferenceResult<T> {
  const kept: T[] = [];
  for (const item of items) {
    const candidate = JSON.stringify({ items: [...kept, item], sources, limitations, truncated: [...kept, item].length < requestedCount, characterCount: maxChars });
    if (candidate.length > maxChars) break;
    kept.push(item);
  }
  const value: NutritionReferenceResult<T> = { items: kept, sources, limitations, truncated: kept.length < requestedCount, characterCount: 0 };
  for (let attempt = 0; attempt < 3; attempt++) value.characterCount = JSON.stringify(value).length;
  while (value.characterCount > maxChars && value.items.length) {
    value.items.pop();
    value.truncated = true;
    for (let attempt = 0; attempt < 3; attempt++) value.characterCount = JSON.stringify(value).length;
  }
  if (value.characterCount > maxChars) throw new NutritionReferenceError('invalid_reference_request', 'The result bound is too small to retain required provenance and limitations.');
  return value;
}

export function loadNutritionReference(options: { docsDir?: string; maxResultChars?: number } = {}): NutritionReference {
  const docsDir = options.docsDir ?? DEFAULT_DOCS_DIR;
  const maxResultChars = options.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
  if (!Number.isInteger(maxResultChars) || maxResultChars < AUTHORITY_MAX_CHARS || maxResultChars > 50_000) {
    throw new NutritionReferenceError('invalid_reference_request', `maxResultChars must be an integer from ${AUTHORITY_MAX_CHARS} to 50000.`);
  }

  const evidencePath = join(docsDir, 'research-knowledge-base.md');
  const mealsPath = join(docsDir, 'meal-library.md');
  const evidence = parseFrontMatter(readFileSync(evidencePath, 'utf8'), 'docs/nutrition/research-knowledge-base.md');
  const meals = parseFrontMatter(readFileSync(mealsPath, 'utf8'), 'docs/nutrition/meal-library.md');

  const ruleSection = section(evidence.body, '## 1. Runtime use and precedence');
  const precedence = /^\*\*Precedence:\*\*\s*(.+)$/m.exec(ruleSection)?.[1]?.trim();
  const rules = tableRows(ruleSection).filter(row => /^G\d{2}\s+-/.test(row[0]));
  if (!precedence || rules.length !== 8) throw new NutritionReferenceError('invalid_reference_source', 'Nutrition authority rules could not be loaded completely.');
  const compactFragments: Record<string, string[]> = {
    G01: ['Propose meals, explain tradeoffs and draft groceries.', 'Do not diagnose, change medication, prescribe fasting/supplements, or modify an approved `MealProtocol`.', 'Authorized application services validate and commit changes.'],
    G02: ['Use only the authorized participant profile.', "Do not inherit another household member's allergies, diagnoses, medication or nutrition goals."],
    G03: ['`null` means unknown, not zero/none.', 'personalized approval and purchasing must wait for the relevant allergy, texture, portion and permission checks.'],
    G04: ['Establish whether the approved goal is maintenance, recovery/adequate intake or intentional weight loss.', 'Do not default to restriction, especially with frailty, poor intake, unintended loss or persistent gastrointestinal symptoms.'],
    G05: ['Offer two practical options; accept refusal without shame.', 'Taste, cooking help, budget and repeatability matter.'],
    G06: ['Attach claim IDs/source IDs to explanations.', 'Never guarantee remission or add HbA1c effects from unrelated trials.'],
    G07: ['Use the exact current package, country, variety, serving and preparation.', 'No automated insulin dosing from estimates.'],
    G08: ['A recipe record is not an approved meal; a planned meal is not a consumed meal; a grocery draft is not a placed order.', 'Preserve version, actor and audit history.'],
  };
  const compactRules = rules.map(([rule, behavior]) => {
    const id = rule.slice(0, 3);
    const fragments = compactFragments[id];
    if (!fragments?.every(fragment => behavior.includes(fragment))) throw new NutritionReferenceError('invalid_reference_source', `Nutrition authority rule ${id} changed; update the bounded context explicitly.`);
    return `${rule}: ${fragments.join(' ')}`;
  });
  const authorityText = [
    `Precedence: ${precedence}`,
    ...compactRules,
    `Source status: ${evidence.source.status}; clinical review: ${evidence.source.clinicalReviewStatus ?? 'not stated'}. Meal library status: ${meals.source.status}.`,
  ].join('\n');
  if (authorityText.length > AUTHORITY_MAX_CHARS) throw new NutritionReferenceError('invalid_reference_source', 'Nutrition authority context exceeds its safety bound.');

  const statuses = new Map<string, SourceStatus>();
  for (const match of evidence.body.matchAll(/^\*\*(R\d{2})\s*\|\s*([^.*]+)\.\*\*/gm)) {
    statuses.set(match[1], { id: match[1], status: match[2].trim() });
  }

  const claims = new Map<string, NutritionClaim>();
  for (const [idAndTitle, finding, allowed, limitation] of tableRows(section(evidence.body, '## 4. Claim registry'))) {
    const parsed = /^(C\d{2})\s+-\s+(.+)$/.exec(idAndTitle);
    if (!parsed) continue;
    const sourceIds = [...new Set(limitation.match(/R\d{2}/g) ?? [])];
    claims.set(parsed[1], {
      id: parsed[1], title: parsed[2], evidenceFinding: finding, allowedInterpretation: allowed, limitation,
      sourceIds, sourceStatuses: sourceIds.map(id => statuses.get(id)?.status ?? 'unknown'),
    });
  }
  if (claims.size !== 14) throw new NutritionReferenceError('invalid_reference_source', 'Nutrition claim registry could not be loaded completely.');

  const recipes = new Map<string, NutritionRecipe>();
  for (const match of meals.body.matchAll(/^###\s+([BLS D]\d{2})\s+-\s+(.+)\n```yaml\n([\s\S]*?)\n```/gm)) {
    const id = match[1].replace(' ', '');
    const yaml = match[3];
    const category = scalar(yaml, 'category') as MealCategory;
    const yieldServings = Number(scalar(yaml, 'yield_servings'));
    const activeMinutes = Number(scalar(yaml, 'active_minutes'));
    const totalMinutes = Number(scalar(yaml, 'total_minutes'));
    if (!['breakfast', 'lunch', 'snack', 'dinner'].includes(category) || ![yieldServings, activeMinutes, totalMinutes].every(Number.isFinite)) {
      throw new NutritionReferenceError('invalid_reference_source', `Recipe ${id} has invalid required metadata.`);
    }
    recipes.set(id, {
      id, title: match[2].trim(), category, yieldServings, activeMinutes, totalMinutes,
      allergens: bracketList(scalar(yaml, 'allergens') ?? ''),
      carbSources: bracketList(scalar(yaml, 'carb_sources') ?? ''),
      status: meals.source.status,
      sourceDocumentId: meals.source.documentId,
      recipeVersion: meals.metadata.recipe_version,
      recipeYaml: yaml,
    });
  }
  if (recipes.size !== Number(meals.metadata.recipe_count)) throw new NutritionReferenceError('invalid_reference_source', 'Meal recipe count does not match source metadata.');

  const evidenceSources = [evidence.source];
  const recipeSources = [meals.source, evidence.source];
  return {
    authorityContext: () => ({ text: authorityText, sources: [evidence.source, meals.source] }),
    claimIndex: () => result([...claims.values()].map(({ id, title, sourceIds, sourceStatuses }) => ({ id, title, sourceIds, sourceStatuses })), evidenceSources, evidenceLimitations, maxResultChars),
    getClaims: (ids) => {
      const normalized = normalizeIds(ids, 'C');
      const unknown = normalized.filter(id => !claims.has(id));
      if (unknown.length) throw new NutritionReferenceError('unknown_reference', `Unknown nutrition claim ID: ${unknown.join(', ')}`);
      return result(normalized.map(id => claims.get(id)!), evidenceSources, evidenceLimitations, maxResultChars, normalized.length);
    },
    listRecipes: (options = {}) => {
      if (options.category && !['breakfast', 'lunch', 'snack', 'dinner'].includes(options.category)) throw new NutritionReferenceError('invalid_reference_request', 'Unknown meal category.');
      const limit = options.limit ?? 5;
      if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new NutritionReferenceError('invalid_reference_request', 'Recipe summary limit must be from 1 to 10.');
      const matching = [...recipes.values()].filter(recipe => !options.category || recipe.category === options.category);
      const selected = matching.slice(0, limit).map(({ recipeVersion: _version, recipeYaml: _yaml, ...summary }) => summary);
      return result(selected, recipeSources, recipeLimitations, maxResultChars, Math.min(limit, matching.length));
    },
    getRecipes: (ids) => {
      const normalized = normalizeIds(ids, 'recipe');
      const unknown = normalized.filter(id => !recipes.has(id));
      if (unknown.length) throw new NutritionReferenceError('unknown_reference', `Unknown nutrition recipe ID: ${unknown.join(', ')}`);
      return result(normalized.map(id => recipes.get(id)!), recipeSources, recipeLimitations, maxResultChars, normalized.length);
    },
  };
}
