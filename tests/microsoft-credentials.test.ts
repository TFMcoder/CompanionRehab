import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openMicrosoftSecret, sealMicrosoftSecret, type MicrosoftCredentialContext } from '../src/server/microsoft/credential-storage.js';

const context: MicrosoftCredentialContext = { connectionId: 'connection-1', actorId: 'actor-1', participantId: 'participant-1', tenantId: 'tenant-1', objectId: 'account-1' };

describe('Microsoft credential storage', () => {
  it('encrypts server-only credentials with fresh nonces and an explicit key', () => {
    const key = randomBytes(32), secret = JSON.stringify({ refreshToken: 'synthetic-refresh', accessToken: 'synthetic-access' });
    const first = sealMicrosoftSecret(secret, key, context), second = sealMicrosoftSecret(secret, key, context);
    expect(first).not.toBe(second);
    expect(first).not.toContain('synthetic');
    expect(openMicrosoftSecret(first, key, context)).toBe(secret);
    expect(openMicrosoftSecret(second, key, context)).toBe(secret);
  });

  it.each(['connectionId', 'actorId', 'participantId', 'tenantId', 'objectId'] as const)
  ('rejects transplanting ciphertext to another %s', field => {
    const key = randomBytes(32), encrypted = sealMicrosoftSecret('synthetic-token', key, context);
    expect(() => openMicrosoftSecret(encrypted, key, { ...context, [field]: 'different' })).toThrow('could not be opened for this connection');
  });

  it('rejects a changed IV, authentication tag, ciphertext and key', () => {
    const key = randomBytes(32), encrypted = sealMicrosoftSecret('synthetic-token', key, context);
    for (const position of [0, 12, 28]) {
      const bytes = Buffer.from(encrypted.slice(4), 'base64url');
      bytes[position] ^= 1;
      expect(() => openMicrosoftSecret(`ms1.${bytes.toString('base64url')}`, key, context)).toThrow('could not be opened');
    }
    expect(() => openMicrosoftSecret(encrypted, randomBytes(32), context)).toThrow('could not be opened');
  });

  it('fails closed on unversioned, truncated, oversized and noncanonical envelopes', () => {
    const key = randomBytes(32), encrypted = sealMicrosoftSecret('synthetic-token', key, context);
    for (const value of ['plaintext', 'ms2.invalid', 'ms1.a', encrypted + '=', encrypted.slice(0, -3), `ms1.${'a'.repeat(200_000)}`])
      expect(() => openMicrosoftSecret(value, key, context)).toThrow('could not be opened');
  });

  it('requires a valid binding and exact encryption key; does not silently generate one', () => {
    expect(() => sealMicrosoftSecret('token', randomBytes(16), context)).toThrow('explicit 32-byte key');
    expect(() => sealMicrosoftSecret('token', randomBytes(32), { ...context, actorId: '' })).toThrow('Invalid Microsoft credential binding');
    expect(() => sealMicrosoftSecret('', randomBytes(32), context)).toThrow('Invalid Microsoft credential payload');
    expect(() => sealMicrosoftSecret('a'.repeat(128 * 1024 + 1), randomBytes(32), context)).toThrow('Invalid Microsoft credential payload');
  });
});
