import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { localCareMigrations } from './local-migrations.js';
export const backupTables = ['participant_profiles', 'role_grants', 'task_definitions', 'meal_options', 'daily_checkins', 'day_plan_proposals', 'accepted_day_plan_versions', 'command_receipts', 'domain_events'] as const;
// Restore in dependency order. Request decisions must follow task/plan records;
// help follows requests, and administrator flags follow both requests and help.
// Microsoft OAuth attempts and connections are deliberately excluded with live sessions:
// restoration must start disconnected, without resurrecting provider consent or credentials.
export const localBackupTables = ['accounts', 'participant_profiles', 'role_grants', 'task_definitions', 'meal_options', 'daily_checkins', 'day_plan_proposals', 'accepted_day_plan_versions', 'command_receipts', 'domain_events', 'appointments', 'append_only_mutations', 'activity_records', 'actuation_targets', 'external_resource_links', 'actuation_intents', 'runtime_events',
  'request_access', 'request_day_capacity', 'request_constraints', 'task_requests', 'request_help', 'request_flags', 'request_receipts',
  'pantry_items', 'meal_proposals', 'meal_option_details', 'grocery_items', 'grocery_shares', 'meal_grocery_receipts',
  'carryover_decisions', 'routine_choices', 'prompt_preferences', 'prompt_jobs', 'prompt_delivery_events', 'prompt_scheduler_cursor',
  'program_access', 'program_definitions', 'program_versions', 'program_runs', 'program_step_results', 'program_receipts',
  'support_shares', 'support_notification_preferences', 'support_notifications', 'support_notification_scanned', 'support_notification_scan_cursor',
  'progress_rule_sets', 'progress_access', 'progress_clinical_configs', 'progress_snapshots', 'progress_awards', 'progress_receipts', 'progress_exports',
  'operations_access', 'operations_issue_reviews', 'pending_activity_commands', 'client_preferences', 'pending_preference_commands', 'daily_preparations', 'significant_handoffs', 'pending_handoff_commands', 'task_focus_sessions'] as const;
export type BackupSchema = 'private' | 'companion_local';
export const ownerAsanaBackupTables=['owner_asana_tasks','owner_asana_receipts'] as const;
interface OwnerAsanaBackup {
  format:1;schema_hash:string;tables:Record<string,Record<string,unknown>[]>;
}
export interface Database {
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
}
export interface Snapshot {
  format: 1 | 2 | 3; schema_hash: string; created_at: string; source_id: string;
  schema?: BackupSchema;
  scope: 'care-records-only' | 'care-and-local-access'; tables: Record<string, Record<string, unknown>[]>;
  /** Explicit owner-only recovery, never provider credentials or OAuth consent. */
  owner_asana?:OwnerAsanaBackup;
}
const tableSets: Record<BackupSchema, readonly string[]> = { private: backupTables, companion_local: localBackupTables };
const addedTables:Record<string,string>={pending_activity_commands:'013_activity_recovery.sql',client_preferences:'015_preferences.sql',pending_preference_commands:'015_preferences.sql',daily_preparations:'016_daily_continuity.sql',significant_handoffs:'016_daily_continuity.sql',pending_handoff_commands:'016_daily_continuity.sql',task_focus_sessions:'017_food_focus.sql'};
const tablesThrough=(schema:BackupSchema,through?:string)=>tableSets[schema].filter(table=>schema!=='companion_local'||!through||!addedTables[table]||addedTables[table]<=through);
export function ownerAsanaSchemaHash(){return createHash('sha256').update(readFileSync(new URL('../../db/owner_asana_test.sql',import.meta.url))).digest('hex');}
export function schemaHash(schema: BackupSchema = 'private', withoutActivityRecovery = false, throughMigration?: string) {
  const hash=createHash('sha256');
  const through=withoutActivityRecovery?'012_operations.sql':throughMigration;
  if(through&&!localCareMigrations.some(file=>file===through))throw new Error('Unknown backup migration revision.');
  const files=schema==='companion_local'?localCareMigrations.filter(file=>!through||file<=through):['001_s01.sql'];
  for(const file of files)hash.update(readFileSync(new URL('../../db/'+file, import.meta.url)));
  return hash.digest('hex');
}
/** Only explicitly supported additive revisions may restore into the current schema. */
function snapshotShape(snapshot:Snapshot) {
  const schema=snapshot.schema||'private';
  if(schema!=='private'&&schema!=='companion_local')throw new Error('Backup schema does not match this revision.');
  const prior=schema==='companion_local'?['012_operations.sql','013_activity_recovery.sql','014_intake_kind.sql','015_preferences.sql','016_daily_continuity.sql','017_food_focus.sql','018_microsoft.sql','019_trusted_device.sql'].find(file=>snapshot.schema_hash===schemaHash(schema,false,file)):undefined;
  if(!prior&&snapshot.schema_hash!==schemaHash(schema))throw new Error('Backup schema does not match this revision.');
  if(snapshot.format===3){
    const owner=snapshot.owner_asana;
    if(schema!=='companion_local'||snapshot.schema_hash!==schemaHash('companion_local')||!owner||owner.format!==1||owner.schema_hash!==ownerAsanaSchemaHash()
      ||!owner.tables||Object.keys(owner.tables).length!==ownerAsanaBackupTables.length||!ownerAsanaBackupTables.every(t=>Array.isArray(owner.tables[t])))
      throw Error('Owner Asana backup extension does not match this revision.');
  }else if(snapshot.owner_asana!==undefined)throw Error('Owner Asana recovery requires an explicit format-3 backup.');
  return {schema,prior,tables:tablesThrough(schema,prior)};
}
export function databaseIdentity(url: string) {
  const parsed = new URL(url);
  return createHash('sha256').update(`${parsed.hostname}:${parsed.port || '5432'}/${parsed.pathname}:${parsed.username}`).digest('hex');
}
/** CLI opt-in cannot silently produce an identity-incomplete owner backup. */
export function validateOwnerAsanaBackupRoute(operation:'export'|'restore',url:string,schema:BackupSchema,ownerAsana:boolean):void{
  const selected=new URL(url),ownerName=selected.pathname==='/nancy_owner_test'||selected.pathname.startsWith('/nancy_owner_restore_');
  if(ownerName&&!ownerAsana)throw Error('Owner import recovery requires --owner-asana; an identity-incomplete backup or restore was refused.');
  if(ownerAsana&&(schema!=='companion_local'||!['localhost','127.0.0.1'].includes(selected.hostname)||selected.port!=='55432'
    ||(operation==='export'?selected.pathname!=='/nancy_owner_test':!/^\/nancy_owner_restore_[a-z0-9_]+$/.test(selected.pathname))))
    throw Error('Owner Asana backup exports only the separate owner test database; restores require a named isolated nancy_owner_restore_* target.');
}
export async function exportSnapshot(db: Database, sourceId: string, schema: BackupSchema = 'private', withoutActivityRecovery = false, throughMigration?: string): Promise<Snapshot> {
  return exportSnapshotWithOwner(db,sourceId,schema,withoutActivityRecovery,throughMigration,false);
}
/** Opt-in extension preserves import identity atomically with care records. */
export async function exportOwnerAsanaSnapshot(db:Database,sourceId:string):Promise<Snapshot>{
  return exportSnapshotWithOwner(db,sourceId,'companion_local',false,undefined,true);
}
async function exportSnapshotWithOwner(db: Database, sourceId: string, schema: BackupSchema, withoutActivityRecovery: boolean, throughMigration:string|undefined,ownerAsana:boolean): Promise<Snapshot> {
  await db.query('begin isolation level repeatable read read only');
  try {
    const tables: Snapshot['tables'] = {};
    for (const table of tablesThrough(schema,withoutActivityRecovery?'012_operations.sql':throughMigration)) {
      tables[table] = (await db.query(`select * from ${schema}.${table}`)).rows.map(row => Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, Buffer.isBuffer(value) || value instanceof Uint8Array
          ? `\\x${Buffer.from(value as Uint8Array).toString('hex')}` : value]),
      ));
    }
    let owner:OwnerAsanaBackup|undefined;
    if(ownerAsana){
      const identity:OwnerAsanaBackup['tables']={};
      for(const table of ownerAsanaBackupTables)identity[table]=(await db.query(`select * from companion_local.${table}`)).rows;
      owner={format:1,schema_hash:ownerAsanaSchemaHash(),tables:identity};
    }
    await db.query('commit');
    const local = schema === 'companion_local';
    return { format: ownerAsana?3:local ? 2 : 1, schema_hash: schemaHash(schema,withoutActivityRecovery,throughMigration), created_at: new Date().toISOString(), source_id: sourceId,
      ...(local ? { schema } : {}), scope: local ? 'care-and-local-access' : 'care-records-only', tables,...(owner?{owner_asana:owner}:{}) };
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
  const {schema,tables}=snapshotShape(snapshot);
  if ((schema === 'private' && (snapshot.format !== 1 || snapshot.scope !== 'care-records-only'))
    || (schema === 'companion_local' && (![2,3].includes(snapshot.format) || snapshot.scope !== 'care-and-local-access'))
    || !snapshot.tables
    || Object.keys(snapshot.tables).length !== tables.length || !tables.every(t => Array.isArray(snapshot.tables[t])))
    throw new Error('Backup schema does not match this revision.');
  return snapshot;
}
export async function restoreSnapshot(db: Database, snapshot: Snapshot, targetId: string): Promise<void> {
  return restoreSnapshotWithOwner(db,snapshot,targetId,false);
}
export async function restoreOwnerAsanaSnapshot(db:Database,snapshot:Snapshot,targetId:string):Promise<void>{
  return restoreSnapshotWithOwner(db,snapshot,targetId,true);
}
async function restoreSnapshotWithOwner(db:Database,snapshot:Snapshot,targetId:string,ownerAsana:boolean):Promise<void>{
  if (snapshot.source_id === targetId) throw new Error('Restore refuses the source database. Use an isolated disposable target.');
  const {schema,tables,prior}=snapshotShape(snapshot);
  if(ownerAsana!==(snapshot.format===3))throw Error('Owner Asana recovery requires its explicit format-3 backup and restore path.');
  const restoreTables=ownerAsana?[...tables,...ownerAsanaBackupTables]:tables;
  const emptyTables=ownerAsana?[...tableSets[schema],...ownerAsanaBackupTables,'owner_asana_connection']:tableSets[schema];
  await db.query('begin isolation level serializable');
  try {
    // Prevent a concurrent writer from turning an empty-target check into a destructive merge.
    for (const table of emptyTables) await db.query(`lock table ${schema}.${table} in access exclusive mode`);
    for (const table of emptyTables) {
      if ((await db.query(`select 1 from ${schema}.${table} limit 1`)).rows.length) throw new Error('Target contains care data; restore refused.');
    }
    for (const table of restoreTables) {
      const columns = (await db.query('select column_name from information_schema.columns where table_schema=$1 and table_name=$2 order by ordinal_position', [schema, table])).rows.map(r => r.column_name as string);
      if (!columns.length || columns.some(c => !/^[a-z_][a-z0-9_]*$/.test(c))) throw new Error('Unexpected target schema.');
      const rows=ownerAsana&&(ownerAsanaBackupTables as readonly string[]).includes(table)?snapshot.owner_asana!.tables[table]:snapshot.tables[table];
      for (const original of rows) {
        let row=prior&&prior<'014_intake_kind.sql'&&table==='activity_records'&&original&&!Object.hasOwn(original,'intake_kind')?{...original,intake_kind:'unknown'}:original;
        if(prior&&prior<'017_food_focus.sql'&&row&&table==='prompt_preferences'&&!Object.hasOwn(row,'food_check_ins'))row={...row,food_check_ins:false};
        if(prior&&prior<'017_food_focus.sql'&&row&&table==='prompt_jobs')row={response_revision:0,response:null,snoozed_until:null,...row};
        if (!row || Object.keys(row).length !== columns.length || !columns.every(c => Object.hasOwn(row, c))) throw new Error('Backup row columns differ from target.');
        // json_populate_record preserves PostgreSQL arrays, jsonb, timestamps and nulls.
        await db.query(`insert into ${schema}.${table} select * from json_populate_record(null::${schema}.${table}, $1::json)`, [JSON.stringify(row)]);
      }
    }
    await db.query('commit');
  } catch (error) { await db.query('rollback'); throw error; }
}
