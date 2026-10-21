import {afterEach,describe,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {Client} from 'pg';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {localCareMigrations} from '../src/server/local-migrations.js';
import {inspectLocalSchemaUpgrade,applyLocalSchemaUpgrade,preservedRowsHash} from '../src/server/local-schema-upgrade.js';
import {exportSnapshot,encryptSnapshot,decryptSnapshot,restoreSnapshot,type Database} from '../src/server/backup.js';

const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{while(cleanups.length)await cleanups.pop()!();});
const sql=(file:string)=>readFile(new URL('../db/'+file,import.meta.url),'utf8');
async function fixture(through='017_food_focus.sql'){
  let db:Database;
  const external=process.env.LOCAL_SCHEMA_TEST_ADMIN_URL;
  if(external){
    const adminUrl=new URL(external);
    if(!['127.0.0.1','localhost'].includes(adminUrl.hostname)||adminUrl.port!=='55432'||adminUrl.pathname!=='/postgres'||adminUrl.search||adminUrl.hash)
      throw new Error('Only loopback PostgreSQL admin for newly created disposable schema fixtures is allowed.');
    const name='nancy_schema_test_'+randomUUID().replaceAll('-','');
    const admin=new Client({connectionString:adminUrl.href});await admin.connect();
    let created=false,client:Client|undefined;
    cleanups.push(async()=>{await client?.end();try{if(created)await admin.query('drop database '+name);}finally{await admin.end();}});
    await admin.query('create database '+name);created=true;
    const target=new URL(adminUrl);target.pathname='/'+name;
    client=new Client({connectionString:target.href});await client.connect();db=client;
  }else{
    const pg=new PGlite();cleanups.push(()=>pg.close());
    db={query:async(text,params)=>params?.length?pg.query(text,params):(await pg.exec(text)).at(-1)??{rows:[]}};
  }
  for(const file of localCareMigrations)if(file<=through)await db.query(await sql(file));
  return db;
}
async function seed(db:Database){
  const actor=randomUUID(),participant=randomUUID(),activity=randomUUID();
  await db.query("insert into companion_local.accounts(id,email,password_salt,password_hash) values($1,'schema-test@example.invalid',$2,$3)",[actor,randomBytes(16),randomBytes(32)]);
  await db.query("insert into companion_local.participant_profiles(id,display_name,time_zone) values($1,'Synthetic migration client','America/Toronto')",[participant]);
  await db.query("insert into companion_local.role_grants(participant_id,actor_id,role) values($1,$2,'client')",[participant,actor]);
  await db.query(`insert into companion_local.activity_records(id,participant_id,local_date,kind,title,unplanned,status,occurred_at,notes,revision,last_action,recorded_at,updated_at,intake_kind)
    values($1,$2,'2026-10-17','meal','Synthetic recorded food',true,'completed','2026-10-17T12:00:00Z','',1,'reported','2026-10-17T12:01:00Z','2026-10-17T12:01:00Z','full_meal')`,[activity,participant]);
  return {actor,participant};
}
async function planAndTables(db:Database){
  const plan=await inspectLocalSchemaUpgrade(db);
  const snapshot=await exportSnapshot(db,'synthetic-source','companion_local',false,plan.through);
  return {plan,snapshot,tables:Object.keys(snapshot.tables)};
}

describe('reviewed additive Microsoft database upgrade',()=>{
  it.each(['018_microsoft.sql','019_trusted_device.sql'])('restores the preceding encrypted care backup from %s into the current schema',async through=>{
    const source=await fixture(through);await seed(source);
    const snapshot=await exportSnapshot(source,'synthetic-prior','companion_local',false,through),key=randomBytes(32);
    const decoded=decryptSnapshot(encryptSnapshot(snapshot,key),key),target=await fixture('020_microsoft_preparation.sql');
    await restoreSnapshot(target,decoded,'isolated-current');
    expect((await target.query('select count(*)::int as count from companion_local.activity_records')).rows[0].count).toBe(1);
    expect((await target.query('select count(*)::int as count from companion_local.sessions')).rows[0].count).toBe(0);
    expect((await target.query('select count(*)::int as count from companion_local.microsoft_connections')).rows[0].count).toBe(0);
    expect((await inspectLocalSchemaUpgrade(target)).pending).toEqual([]);
  });
  it('upgrades 017 through 020, preserves care/access, restores encrypted 017 backup, and repeats without replay',async()=>{
    const db=await fixture();await seed(db);
    const {plan,snapshot,tables}=await planAndTables(db);
    expect(plan).toEqual({through:'017_food_focus.sql',pending:['018_microsoft.sql','019_trusted_device.sql','020_microsoft_preparation.sql']});
    const key=randomBytes(32),decoded=decryptSnapshot(encryptSnapshot(snapshot,key),key);
    const target=await fixture('020_microsoft_preparation.sql');
    await restoreSnapshot(target,decoded,'isolated-target');
    const restored=await exportSnapshot(target,'isolated-target','companion_local');
    for(const table of tables)expect(preservedRowsHash(restored.tables[table])).toBe(preservedRowsHash(snapshot.tables[table]));
    const reads:string[]=[];
    await applyLocalSchemaUpgrade(db,plan,tables,{readMigration:async file=>{reads.push(file);return sql(file);}});
    expect(reads).toEqual(['018_microsoft.sql','019_trusted_device.sql','020_microsoft_preparation.sql']);
    const after=await exportSnapshot(db,'synthetic-source','companion_local');
    expect(after.tables).toEqual(snapshot.tables);
    const repeat=await inspectLocalSchemaUpgrade(db);
    expect(repeat).toEqual({through:'020_microsoft_preparation.sql',pending:[]});
    await applyLocalSchemaUpgrade(db,repeat,tables,{readMigration:async()=>{throw new Error('Must not replay');}});
    expect((await db.query('select count(*)::int as count from companion_local.microsoft_connections')).rows[0].count).toBe(0);
  });
  it('refuses one Microsoft table without treating a partial schema as already applied',async()=>{
    const db=await fixture();
    await db.query((await sql('018_microsoft.sql')).split('create table if not exists companion_local.microsoft_oauth_pending')[0]);
    await expect(inspectLocalSchemaUpgrade(db)).rejects.toThrow('consistent_018_microsoft.sql');
  });
  it('refuses two existing Microsoft tables with a missing column',async()=>{
    const db=await fixture('018_microsoft.sql');
    await db.query('alter table companion_local.microsoft_connections drop column last_error');
    await expect(inspectLocalSchemaUpgrade(db)).rejects.toThrow('consistent_018_microsoft.sql');
  });
  it('refuses a missing uniqueness constraint index',async()=>{
    const db=await fixture('018_microsoft.sql');
    await db.query('alter table companion_local.microsoft_oauth_pending drop constraint microsoft_oauth_pending_state_hash_key');
    await expect(inspectLocalSchemaUpgrade(db)).rejects.toThrow('consistent_018_microsoft.sql');
  });
  it('revalidates the reviewed version under locks before applying',async()=>{
    const db=await fixture();const {plan,tables}=await planAndTables(db);
    await db.query(await sql('018_microsoft.sql'));
    await expect(applyLocalSchemaUpgrade(db,plan,tables)).rejects.toThrow('reviewed_schema_unchanged');
    expect((await inspectLocalSchemaUpgrade(db)).through).toBe('018_microsoft.sql');
  });
  it('rolls back all new schema when the migration fails partway',async()=>{
    const db=await fixture();const {plan,tables}=await planAndTables(db);
    await expect(applyLocalSchemaUpgrade(db,plan,tables,{readMigration:async file=>(await sql(file))+'\nselect nonexistent_migration_function();'})).rejects.toThrow();
    expect(await inspectLocalSchemaUpgrade(db)).toEqual(plan);
    expect((await db.query("select to_regclass('companion_local.microsoft_connections') as t")).rows[0].t).toBeNull();
  });
  it('rolls back both schema and care mutations when preservation fails',async()=>{
    const db=await fixture();await seed(db);const {plan,tables,snapshot}=await planAndTables(db);
    await expect(applyLocalSchemaUpgrade(db,plan,tables,{readMigration:async file=>(await sql(file))+"\nupdate companion_local.participant_profiles set display_name='Changed';"})).rejects.toThrow('preserved_participant_profiles');
    expect(await inspectLocalSchemaUpgrade(db)).toEqual(plan);
    expect((await exportSnapshot(db,'synthetic-source','companion_local',false,plan.through)).tables).toEqual(snapshot.tables);
  });
  it('excludes existing connection ciphertext and selections from restored care backups',async()=>{
    const db=await fixture('018_microsoft.sql');const {actor,participant}=await seed(db);
    await db.query(`insert into companion_local.microsoft_connections(id,participant_id,actor_id,grant_fingerprint,configuration_fingerprint,tenant_id,object_id,state,token_ciphertext,selected_calendar_ids,updated_at)
      values($1,$2,$3,'synthetic-grant','synthetic-config',$4,$5,'connected','synthetic-ciphertext',array['synthetic-calendar'],now())`,[randomUUID(),participant,actor,randomUUID(),randomUUID()]);
    const snapshot=await exportSnapshot(db,'synthetic-source','companion_local');
    expect(JSON.stringify(snapshot)).not.toContain('synthetic-ciphertext');
    expect(snapshot.tables).not.toHaveProperty('microsoft_connections');
    expect(snapshot.tables).not.toHaveProperty('microsoft_oauth_pending');
    const key=randomBytes(32),decoded=decryptSnapshot(encryptSnapshot(snapshot,key),key);
    const target=await fixture('018_microsoft.sql');await restoreSnapshot(target,decoded,'isolated-target');
    expect((await target.query('select count(*)::int as count from companion_local.microsoft_connections')).rows[0].count).toBe(0);
    expect((await target.query('select count(*)::int as count from companion_local.activity_records')).rows[0].count).toBe(1);
  });
});
