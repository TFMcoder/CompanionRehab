import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

// Persist login revocation across API restarts; no access/refresh tokens are stored here.
export class SessionRevocations {
  private entries = new Map<string, number>();
  constructor(private path?: string) {
    if (path && existsSync(path)) {
      const data = z.array(z.tuple([z.string().uuid(), z.number()])).parse(JSON.parse(readFileSync(path, 'utf8')));
      this.entries = new Map(data.filter(([, expires]) => expires > Date.now()));
    }
  }
  has(id: string) { return (this.entries.get(id) || 0) > Date.now(); }
  revoke(id: string, expires: number) {
    for (const [key, expiration] of this.entries) if (expiration < Date.now()) this.entries.delete(key);
    this.entries.set(id, expires);
    if (this.path) {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path + '.tmp', JSON.stringify([...this.entries]), { mode: 0o600 });
      renameSync(this.path + '.tmp', this.path);
    }
  }
}
