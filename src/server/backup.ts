import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
export const backupTables = ['participant_profiles', 'role_grants', 'task_definitions', 'meal_options', 'daily_checkins', 'day_plan_proposals', 'accepted_day_plan_versions', 'command_receipts', 'domain_events'] as const;
export interface Database {
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
}
export interface Snapshot {
  format: 1; schema_hash: string; created_at: string; source_id: string;
  scope: 'care-records-only'; tables: Record<string, Record<string, unknown>[]>;
}
export function schemaHash() { return createHash('sha256').update(readFileSync(new URL('../../db/001_s01.sql', import.meta.url))).digest('hex'); }
export function databaseIdentity(url: string) {
  const parsed = new URL(url);
  return createHash('sha256').update(`${parsed.hostname}:${parsed.port || '5432'}/${parsed.pathname}:${parsed.username}`).digest('hex');
}
export async function exportSnapshot(db: Database, sourceId: string): Promise<Snapshot> {
  await db.query('begin isolation level repeatable read read only');
  try {
    const tables: Snapshot['tables'] = {};
    for (const table of backupTables) tables[table] = (await db.query(`select * from private.${table}`)).rows;
    await db.query('commit');
    return { format: 1, schema_hash: schemaHash(), created_at: new Date().toISOString(), source_id: sourceId, scope: 'care-records-only', tables };
  } catch (error) { await db.query('rollback'); throw error; }
}
export function encryptSnapshot(snapshot: Snapshot, key: Buffer): Buffer {
  if (key.length !== 32) throw new Error('BACKUP_KEY must encode 32 bytes.');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const header = Buffer.from('NANCY01'); cipher.setAAD(header);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(snapshot), 'utf8'), cipher.final()]);
  return Buffer.concat([header, iv, cipher.getAuthTag(), ciphertext]);
}
export function decryptSnapshot(bytes: Buffer, key: Buffer): Snapshot {
  if (key.length !== 32 || bytes.length < 36 || bytes.subarray(0, 7).toString() !== 'NANCY01') throw new Error('Invalid backup or key.');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(7, 19));
  decipher.setAAD(bytes.subarray(0, 7)); decipher.setAuthTag(bytes.subarray(19, 35));
  const snapshot = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(35)), decipher.final()]).toString('utf8')) as Snapshot;
  if (snapshot.format !== 1 || snapshot.scope !== 'care-records-only' || snapshot.schema_hash !== schemaHash()
    || !snapshot.tables || Object.keys(snapshot.tables).length !== backupTables.length
    || !backupTables.every(t => Array.isArray(snapshot.tables[t]))) throw new Error('Backup schema does not match this revision.');
  return snapshot;
}
export async function restoreSnapshot(db: Database, snapshot: Snapshot, targetId: string): Promise<void> {
  if (snapshot.source_id === targetId) throw new Error('Restore refuses the source database. Use an isolated disposable target.');
  if (snapshot.schema_hash !== schemaHash()) throw new Error('Migration revision differs.');
  await db.query('begin isolation level serializable');
  try {
    // Prevent a concurrent writer from turning an empty-target check into a destructive merge.
    for (const table of backupTables) await db.query(`lock table private.${table} in access exclusive mode`);
    for (const table of backupTables) {
      if ((await db.query(`select 1 from private.${table} limit 1`)).rows.length) throw new Error('Target contains care data; restore refused.');
    }
    for (const table of backupTables) {
      const columns = (await db.query('select column_name from information_schema.columns where table_schema=$1 and table_name=$2 order by ordinal_position', ['private', table])).rows.map(r => r.column_name as string);
      if (!columns.length || columns.some(c => !/^[a-z_]+$/.test(c))) throw new Error('Unexpected target schema.');
      for (const row of snapshot.tables[table]) {
        if (!row || Object.keys(row).length !== columns.length || !columns.every(c => Object.hasOwn(row, c))) throw new Error('Backup row columns differ from target.');
        // json_populate_record preserves PostgreSQL arrays, jsonb, timestamps and nulls.
        await db.query(`insert into private.${table} select * from json_populate_record(null::private.${table}, $1::json)`, [JSON.stringify(row)]);
      }
    }
    await db.query('commit');
  } catch (error) { await db.query('rollback'); throw error; }
}
