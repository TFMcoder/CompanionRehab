import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { CareAuthority } from './care-access.js';
import { ApiError } from './errors.js';

const sessionSchema = z.object({
  access_token: z.string().min(1), refresh_token: z.string().min(1),
  expires_at: z.number(), user_id: z.string().uuid(), issued_at: z.number(), session_id: z.string().uuid(),
});
export type Session = z.infer<typeof sessionSchema> & { reviewed_authority?: CareAuthority };
/** Request-only server binding; never accepted from or persisted in a browser cookie. */
export function assertReviewedAuthority(session:Session,current:CareAuthority) {
  const expected=session.reviewed_authority;
  if(expected&&(['actor_id','login_session_id','active_role','client_id','grant_revision'] as const).some(key=>expected[key]!==current[key]))
    throw new ApiError(403,'scope_changed','Your account view changed. Review this change again.');
}
export function sealSession(session: Session, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('nancy-session-v1'));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(sessionSchema.parse(session)), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
export function openSession(value: string | undefined, key: Buffer): Session | null {
  if (!value || value.length > 16000) return null;
  try {
    const bytes = Buffer.from(value, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from('nancy-session-v1'));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const result = sessionSchema.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')));
    if (result.issued_at + 7 * 86400 < Date.now() / 1000) return null;
    return result;
  } catch { return null; }
}
