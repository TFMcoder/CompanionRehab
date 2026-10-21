import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {localCareMigrations} from './local-migrations.js';
import {localBackupTables,type Database} from './backup.js';
import {canonicalJson} from './local-authority.js';

type Milestone={file:string;tables:string[];columns?:string[][];indexes?:string[]};
const milestones:Milestone[]=[
  {file:'013_activity_recovery.sql',tables:['pending_activity_commands']},
  {file:'014_intake_kind.sql',tables:[],columns:[['activity_records','intake_kind']]},
  {file:'015_preferences.sql',tables:['client_preferences','pending_preference_commands']},
  {file:'016_daily_continuity.sql',tables:['daily_preparations','significant_handoffs','pending_handoff_commands']},
  {file:'017_food_focus.sql',tables:['task_focus_sessions'],columns:[['prompt_preferences','food_check_ins'],['prompt_jobs','response_revision'],['prompt_jobs','response'],['prompt_jobs','snoozed_until']]},
  {file:'018_microsoft.sql',tables:['microsoft_connections','microsoft_oauth_pending'],
    columns:[
      ...'id participant_id actor_id grant_fingerprint configuration_fingerprint tenant_id object_id state token_ciphertext selected_calendar_ids selected_mail_folder_ids revision connected_at updated_at last_read_at last_error'.split(' ').map(column=>['microsoft_connections',column]),
      ...'id state_hash browser_hash actor_id participant_id login_session_id grant_fingerprint configuration_fingerprint pending_ciphertext stage created_at expires_at'.split(' ').map(column=>['microsoft_oauth_pending',column]),
    ],indexes:['microsoft_connections_pkey','microsoft_connections_participant_id_actor_id_key','microsoft_oauth_pending_pkey','microsoft_oauth_pending_state_hash_key','microsoft_oauth_pending_login_session_id_key','microsoft_oauth_expiry']},
  {file:'019_trusted_device.sql',tables:[],columns:[['sessions','remember_device']]},
  {file:'020_microsoft_preparation.sql',tables:[],columns:['prepared_context_ciphertext','prepared_at','prepared_revision','preparation_attempt_at'].map(column=>['microsoft_connections',column])},
];
export interface LocalSchemaUpgradePlan {through:string;pending:string[]}
type Check=(name:string,condition:boolean)=>void;
const checked:Check=(name,condition)=>{if(!condition)throw new Error(name);};

/** Inspect only; partial/out-of-order schemas must not be repaired by replaying migrations. */
export async function inspectLocalSchemaUpgrade(db:Database,check:Check=checked):Promise<LocalSchemaUpgradePlan>{
  check('established_schema',!!(await db.query("select to_regclass('companion_local.operations_issue_reviews') as t")).rows[0].t);
  let through='012_operations.sql',missing=false;
  for(const milestone of milestones){
    const presence=await Promise.all([
      ...milestone.tables.map(async table=>!!(await db.query('select to_regclass($1) as t',['companion_local.'+table])).rows[0].t),
      ...(milestone.columns??[]).map(async([table,column])=>(await db.query("select 1 from information_schema.columns where table_schema='companion_local' and table_name=$1 and column_name=$2",[table,column])).rows.length>0),
      ...(milestone.indexes??[]).map(async index=>(await db.query("select 1 from pg_indexes where schemaname='companion_local' and indexname=$1",[index])).rows.length>0),
    ]);
    check('consistent_'+milestone.file,presence.every(Boolean)||presence.every(p=>!p));
    const present=presence.every(Boolean);
    check('ordered_'+milestone.file,!(missing&&present));
    if(present)through=milestone.file;else missing=true;
  }
  const pending=localCareMigrations.filter(file=>file>through);
  check('only_reviewed_additions',pending.every(file=>milestones.some(m=>m.file===file)));
  return {through,pending};
}

export const preservedRowsHash=(rows:Record<string,unknown>[])=>createHash('sha256')
  .update(canonicalJson([...rows].sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b))))).digest('hex');

/** Caller must first save an encrypted backup and prove restoration to a fresh isolated target. */
export async function applyLocalSchemaUpgrade(db:Database,plan:LocalSchemaUpgradePlan,preserveTables:string[],options:{
  check?:Check;readMigration?:(file:string)=>Promise<string>;
}={}):Promise<void>{
  const check=options.check??checked;
  const readMigration=options.readMigration??(file=>readFile(new URL('../../db/'+file,import.meta.url),'utf8'));
  check('known_preservation_tables',preserveTables.length>0&&preserveTables.every(table=>localBackupTables.includes(table as typeof localBackupTables[number])));
  await db.query('begin');
  try{
    await db.query("set local lock_timeout = '10s'");
    // Serialize upgrade runners, then block care writes while comparing the original columns.
    await db.query('lock table companion_local.participant_profiles in share row exclusive mode');
    for(const table of preserveTables)await db.query(`lock table companion_local.${table} in share mode`);
    const current=await inspectLocalSchemaUpgrade(db,check);
    check('reviewed_schema_unchanged',canonicalJson(current)===canonicalJson(plan));
    const before:Record<string,Record<string,unknown>[]>={};
    for(const table of preserveTables)before[table]=(await db.query(`select * from companion_local.${table}`)).rows;
    for(const file of current.pending){
      const sql=(await readMigration(file)).replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'');
      await db.query(sql);
    }
    const afterPlan=await inspectLocalSchemaUpgrade(db,check);
    check('complete_reviewed_schema',afterPlan.pending.length===0);
    for(const [table,rows] of Object.entries(before)){
      const columns=rows.length?Object.keys(rows[0]):[];
      const after=(await db.query(`select * from companion_local.${table}`)).rows;
      check('preserved_'+table,preservedRowsHash(after.map(row=>Object.fromEntries(columns.map(column=>[column,row[column]]))))===preservedRowsHash(rows));
    }
    await db.query('commit');
  }catch(error){await db.query('rollback');throw error;}
}
