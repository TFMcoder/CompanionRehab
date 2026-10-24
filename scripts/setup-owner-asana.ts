/** Add only the three Asana checkpoint tables to the existing owner practice DB. */
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {ownerTestDirectory,ownerTestSchema} from '../src/server/owner-test-config.js';
if(!process.argv.includes('--apply'))throw Error('Use --apply for the authorized owner test database only.');
const settings=ownerTestSchema.parse(JSON.parse(await readFile(ownerTestDirectory+'/config.json','utf8')));
const pool=new Pool({connectionString:settings.database_url,max:1,connectionTimeoutMillis:5000});
try{const c=await pool.connect();try{await c.query('begin');await c.query("set local lock_timeout='3s'");await c.query("set local statement_timeout='15s'");
 const identity=(await c.query('select current_database() db,current_user role')).rows[0];
 if(identity.db!==settings.database_name||identity.role!==settings.database_role)throw Error('Refuse a non-owner-test database.');
 const before=(await c.query(`select table_name from information_schema.tables where table_schema='companion_local' and table_name like 'owner_asana_%' order by table_name`)).rows.map(r=>r.table_name);
 const expected=['owner_asana_connection','owner_asana_receipts','owner_asana_tasks'];
 if(before.length&&JSON.stringify(before)!==JSON.stringify(expected))throw Error('Partial Asana schema found; inspect before retrying.');
 await c.query(await readFile('db/owner_asana_test.sql','utf8'));
 const columns=(await c.query(`select table_name,column_name,data_type from information_schema.columns where table_schema='companion_local' and table_name like 'owner_asana_%' order by table_name,ordinal_position`)).rows;
 const required={owner_asana_connection:['singleton','binding','credential','updated_at'],owner_asana_receipts:['command_id','payload_hash','actor_id','participant_id','grant_revision','result','created_at'],owner_asana_tasks:['remote_id','binding','version','source','missing','observed_at','local_task_id','imported_version']};
 for(const[table,names]of Object.entries(required))if(JSON.stringify(columns.filter(r=>r.table_name===table).map(r=>r.column_name))!==JSON.stringify(names))throw Error('Asana schema columns differ from the reviewed definition.');
 await c.query('commit');console.log(JSON.stringify({database:'nancy_owner_test',tables:3,already_present:before.length===3,care_rows_written:0}));
 }catch(error){await c.query('rollback');throw error;}finally{c.release();}
}finally{await pool.end();}
