import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** These values must come from the authenticated care scope, never an OAuth query. */
export interface MicrosoftCredentialContext {
  connectionId: string;
  actorId: string;
  participantId: string;
  tenantId: string;
  objectId: string;
}

const prefix = 'ms1.';
const maxBytes = 128 * 1024;

function aad(context: MicrosoftCredentialContext): Buffer {
  const fields = [context.connectionId, context.actorId, context.participantId, context.tenantId, context.objectId];
  if (fields.some(value => typeof value !== 'string' || !value || value.length > 256))
    throw new Error('Invalid Microsoft credential binding.');
  return Buffer.from(JSON.stringify(['companion-microsoft-credential', 1, ...fields]));
}

function validateKey(key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.byteLength !== 32)
    throw new Error('Microsoft credential encryption requires an explicit 32-byte key.');
}

/** Ciphertext can be persisted transactionally with its connection in the care DB. */
export function sealMicrosoftSecret(value: string, key: Uint8Array, context: MicrosoftCredentialContext): string {
  validateKey(key);
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > maxBytes)
    throw new Error('Invalid Microsoft credential payload.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(context));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return prefix + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

export function openMicrosoftSecret(value: string, key: Uint8Array, context: MicrosoftCredentialContext): string {
  validateKey(key);
  const binding = aad(context);
  try {
    if (typeof value !== 'string' || !value.startsWith(prefix) || value.length > (maxBytes + 28) * 4 / 3 + 8)
      throw new Error();
    const encoded = value.slice(prefix.length);
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error();
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.length <= 28 || bytes.length > maxBytes + 28 || bytes.toString('base64url') !== encoded)
      throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAAD(binding);
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    // Never attach cryptographic causes, ciphertext or account values to routine logs.
    throw new Error('Microsoft credential could not be opened for this connection.');
  }
}
