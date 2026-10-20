import { z } from 'zod';
import type { LocalFeatures } from './local-features.js';
import type { CareService } from './care-access.js';
import type { Session } from './session.js';
import { prepareLocalAction } from './local-conversation.js';

const newHandoff = z.object({ summary: z.string().trim().min(1).max(300), occurred_at: z.iso.datetime({ offset: true }) }).strict();
const { $schema: _, ...parameters } = z.toJSONSchema(newHandoff);
export const handoffTools = [{ type: 'function', name: 'prepare_significant_handoff', strict: false,
  description: 'Prepare a new explicitly requested significant-event note using its actual occurrence time. Current time and active notes are already supplied; no workflow/schema lookup is needed. No write until the application reviews it and receives confirmation. Use the generic day workflow for correction/resolution.', parameters }];

export function prepareHandoff(features: LocalFeatures, session: Session, raw: unknown, key: string, care?: CareService) {
  const input = newHandoff.parse(raw);
  return prepareLocalAction(features, session, { family: 'day', command: { type: 'record_significant_handoff', ...input } }, true, key, care);
}
