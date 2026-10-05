import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, chmod, open, unlink } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path';

export interface PlanCredential {
  issuer: 'https://auth.openai.com';
  subject: string;
  email?: string;
  clientId: string;
  idToken: string;
  accessToken: string;
  refreshToken: string;
  scopes: string[];
  expiresAt: number;
}
export interface PlanState {
  hostId: string;
  activeKey?: string;
  accounts: Record<string, PlanCredential>;
}

const aad = Buffer.from('companion-chatgpt-plan-v1');
export const defaultPlanPath = resolve('.local/runtime/chatgpt-plan.enc');
export function accountKey(account: Pick<PlanCredential, 'clientId' | 'subject'>): string {
  return `${account.clientId}:${account.subject}`;
}

export class PlanStore {
  constructor(private readonly path: string, private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('SESSION_KEY must contain 32 bytes.');
    const rel = relative(resolve('.local'), resolve(path));
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new Error('Plan credentials must stay under the ignored .local directory.');
  }
  async load(): Promise<PlanState> {
    try {
      const bytes = Buffer.from(await readFile(this.path, 'utf8'), 'base64url');
      if (bytes.length < 29) throw new Error('Invalid encrypted credential file.');
      const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
      decipher.setAAD(aad);
      decipher.setAuthTag(bytes.subarray(12, 28));
      const data = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')) as PlanState;
      if (!data.hostId?.startsWith('urn:uuid:') || !data.accounts || typeof data.accounts !== 'object') throw new Error('Invalid credential record.');
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { hostId: `urn:uuid:${randomUUID()}`, accounts: {} };
      throw new Error('Could not open the protected ChatGPT connection file. Check SESSION_KEY and file integrity.');
    }
  }
  async save(state: PlanState): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(aad);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
    const contents = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, contents, { mode: 0o600, flag: 'wx' });
    await chmod(temporary, 0o600);
    await rename(temporary, this.path);
  }
  async lock(): Promise<() => Promise<void>> {
    await mkdir(dirname(this.path), { recursive: true });
    const path = `${this.path}.lock`;
    let handle;
    try { handle = await open(path, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('ChatGPT setup is already running, or a previous run left a lock file.');
      throw error;
    }
    await handle.writeFile(String(process.pid));
    return async () => { await handle.close(); await unlink(path); };
  }
}
