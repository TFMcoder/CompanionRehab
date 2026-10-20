import {describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {localCareMigrations} from '../src/server/local-migrations.js';
import {bootstrapLocalUser} from '../src/server/local-care.js';
import {exportSnapshot,encryptSnapshot,decryptSnapshot,restoreSnapshot} from '../src/server/backup.js';
import {pglitePool} from './helpers/pglite-pool.js';

describe('additive intake schema backup compatibility',()=>{
  it.each(['012_operations.sql','013_activity_recovery.sql','014_intake_kind.sql','015_preferences.sql','016_daily_continuity.sql'])('restores %s without guessing old intake facts or prompt consent',async through=>{
    const source=new PGlite(),target=new PGlite();
    try{
      for(const file of localCareMigrations){
        const sql=await readFile(new URL('../db/'+file,import.meta.url),'utf8');
        if(file<=through)await source.exec(sql);
        await target.exec(sql);
      }
      const actor=await bootstrapLocalUser(pglitePool(source) as any,{email:'legacy-intake@example.invalid',password:'synthetic-legacy-password',role:'client',display_name:'Synthetic legacy client',time_zone:'America/Toronto'});
      const participant=(await source.query<{id:string}>('select id from companion_local.participant_profiles')).rows[0].id;
      await source.query(`insert into companion_local.activity_records(id,participant_id,local_date,kind,title,unplanned,status,occurred_at,notes,revision,last_action,recorded_at,updated_at)
        values($1,$2,'2026-10-05','meal','Synthetic older food',true,'completed','2026-10-05T12:00:00Z','',1,'reported','2026-10-05T13:00:00Z','2026-10-05T13:00:00Z')`,[randomUUID(),participant]);
      await source.query('insert into companion_local.prompt_preferences(participant_id,revision,enabled,consent_actor) values($1,1,true,$2)',[participant,actor.user_id]);
      await source.query(`insert into companion_local.prompt_jobs(id,participant_id,source_key,source_version,preference_revision,due_at,expires_at,message,state)
        values($1,$2,'synthetic','1',1,'2026-10-05T13:00:00Z','2026-10-05T13:10:00Z','Synthetic reminder','delivered')`,[randomUUID(),participant]);
      const snapshot=await exportSnapshot(source,'old-synthetic','companion_local',through==='012_operations.sql',through);
      const key=randomBytes(32),decoded=decryptSnapshot(encryptSnapshot(snapshot,key),key);
      await restoreSnapshot(target,decoded,'new-synthetic');
      const restored=(await target.query<any>('select * from companion_local.activity_records')).rows[0];
      expect(restored).toMatchObject({intake_kind:'unknown',title:'Synthetic older food',revision:1});
      expect(new Date(restored.occurred_at).toISOString()).toBe('2026-10-05T12:00:00.000Z');
      expect(new Date(restored.recorded_at).toISOString()).toBe('2026-10-05T13:00:00.000Z');
      expect((await target.query('select * from companion_local.sessions')).rows).toHaveLength(0);
      expect((await target.query<any>('select * from companion_local.prompt_preferences')).rows[0].food_check_ins).toBe(false);
      expect((await target.query<any>('select * from companion_local.prompt_jobs')).rows[0]).toMatchObject({state:'delivered',response_revision:0,response:null,snoozed_until:null});
    }finally{await source.close();await target.close();}
  });
});
