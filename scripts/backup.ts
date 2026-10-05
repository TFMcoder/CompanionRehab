import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import pg from 'pg';
import { loadEnvironment } from '../src/server/config.js';
import { databaseIdentity, exportSnapshot, encryptSnapshot, decryptSnapshot, restoreSnapshot, type BackupSchema } from '../src/server/backup.js';
loadEnvironment();
const [operation, name] = process.argv.slice(2);
if (!['export', 'restore'].includes(operation) || !name) throw new Error('Usage: npm run backup -- export|restore .local/backups/name.nancy');
const base = resolve('.local/backups'), target = resolve(name);
if (!target.startsWith(base + '\\') && !target.startsWith(base + '/')) throw new Error('Backup files must stay inside .local/backups (gitignored).');
const key = Buffer.from(process.env.BACKUP_KEY || '', 'base64');
if (key.length !== 32) throw new Error('Set a private, separate 32-byte BACKUP_KEY before backup or restore.');
const url = operation === 'export' ? process.env.BACKUP_DATABASE_URL : process.env.RESTORE_DATABASE_URL;
if (!url) throw new Error('The separate administrative database URL is missing.');
const schemaValue = process.env.BACKUP_SCHEMA || 'private';
if (!['private', 'companion_local'].includes(schemaValue)) throw new Error('BACKUP_SCHEMA must be private or companion_local.');
const schema = schemaValue as BackupSchema;
if (operation === 'restore' && process.env.RESTORE_TARGET !== 'isolated-disposable') throw new Error('Set RESTORE_TARGET=isolated-disposable only after identifying an isolated empty target.');
const remote = !['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname);
const client = new pg.Client({ connectionString: url, ...(remote ? { ssl: { rejectUnauthorized: true } } : {}), connectionTimeoutMillis: 12000, query_timeout: 30000 });
try {
  await client.connect();
  if (operation === 'export') {
    const snapshot = await exportSnapshot(client, databaseIdentity(url), schema);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, encryptSnapshot(snapshot, key), { flag: 'wx', mode: 0o600 });
    console.log(schema === 'companion_local'
      ? 'Encrypted local-care backup written. It includes account email and salted password hashes, excludes live sessions and provider secrets; protect and store the encryption key separately.'
      : 'Encrypted care-record backup written. Auth accounts, provider settings and secrets are separate recovery requirements.');
  } else {
    const snapshot = decryptSnapshot(await readFile(target), key);
    if ((snapshot.schema || 'private') !== schema) throw new Error('The selected backup schema does not match BACKUP_SCHEMA.');
    await restoreSnapshot(client, snapshot, databaseIdentity(url));
    console.log('Care records restored into the empty isolated target. Verify readback and Auth identity mapping before use.');
  }
} catch {
  // Driver diagnostics can contain connection strings or row values. Keep them out of public logs.
  console.error('Backup/restore failed. Check private configuration, schema revision, certificate trust and that the restore target is empty and isolated. No partial restore was committed.');
  process.exitCode = 1;
} finally { await client.end(); }
