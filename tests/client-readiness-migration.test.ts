import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const sql = (name:string) => readFile(new URL(`../db/${name}`, import.meta.url),'utf8');

describe('client readiness migration', () => {
  it('backfills existing factual provenance and can be applied again', async () => {
    const db = new PGlite();
    try {
      await db.exec(await sql('002_local_care.sql'));
      await db.exec(await sql('003_activity_ledger.sql'));
      const participant = crypto.randomUUID(), actor = crypto.randomUUID();
      const activity = crypto.randomUUID(), command = crypto.randomUUID();
      await db.query(`insert into companion_local.accounts(id,email,password_salt,password_hash)
        values($1,'migration@example.invalid','\\x00','\\x00')`,[actor]);
      await db.query(`insert into companion_local.participant_profiles(id,display_name,time_zone)
        values($1,'Synthetic migration','America/Toronto')`,[participant]);
      await db.query(`insert into companion_local.append_only_mutations(participant_id,command_id,command,result,event_type,actor_id)
        values($1,$2,'{}','{}','ActivityReported',$3)`,[participant,command,actor]);
      await db.query(`insert into companion_local.activity_records(id,participant_id,local_date,kind,title,unplanned,status,occurred_at,revision,last_action,recorded_at,updated_at)
        values($1,$2,'2026-10-05','task','Synthetic prior fact',true,'completed','2026-10-05T13:00:00Z',1,'reported','2026-10-05T13:10:00Z','2026-10-05T13:10:00Z')`,[activity,participant]);
      await db.query(`insert into companion_local.domain_events(participant_id,actor_id,command_id,event_type,local_date,data)
        values($1,$2,$3,'ActivityReported','2026-10-05',$4)`,[participant,actor,command,JSON.stringify({activity_id:activity,after:{revision:1}})]);
      const migration=await sql('004_client_readiness.sql');
      await db.exec(migration);
      await db.exec(migration);
      expect((await db.query('select last_actor_id,last_command_id from companion_local.activity_records where id=$1',[activity])).rows[0])
        .toEqual({last_actor_id:actor,last_command_id:command});
      expect((await db.query<{count:number}>("select count(*)::integer as count from companion_local.actuation_intents")).rows[0].count).toBe(0);
    } finally { await db.close(); }
  });

  it('restores actions made before a grant was revoked but rejects new actions afterward', async () => {
    const db = new PGlite();
    try {
      for (const name of ['002_local_care.sql','003_activity_ledger.sql','004_client_readiness.sql']) await db.exec(await sql(name));
      const participant=crypto.randomUUID(), actor=crypto.randomUUID(), task=crypto.randomUUID();
      const event=crypto.randomUUID(), target=crypto.randomUUID();
      await db.query(`insert into companion_local.accounts(id,email,password_salt,password_hash,created_at)
        values($1,'historical@example.invalid','\\x00','\\x00',now()-interval '10 days')`,[actor]);
      await db.query(`insert into companion_local.participant_profiles(id,display_name,time_zone)
        values($1,'Synthetic historical','America/Toronto')`,[participant]);
      await db.query(`insert into companion_local.role_grants(participant_id,actor_id,role,granted_at,revoked_at)
        values($1,$2,'client',now()-interval '9 days',now()-interval '1 day')`,[participant,actor]);
      await db.query(`insert into companion_local.task_definitions(id,participant_id,title,setup_revision)
        values($1,$2,'Synthetic historical task',1)`,[task,participant]);
      await db.query(`insert into companion_local.domain_events(id,participant_id,actor_id,event_type,data,created_at)
        values($1,$2,$3,'ActivityReported','{}',now()-interval '3 days')`,[event,participant,actor]);
      await db.query(`insert into companion_local.actuation_targets(id,participant_id,system,provider,destination_ref,created_by,created_at)
        values($1,$2,'calendar','future-provider','historical-target',$3,now()-interval '2 days')`,[target,participant,actor]);
      await db.query(`insert into companion_local.external_resource_links(participant_id,target_id,local_kind,local_id,remote_id,linked_by,linked_at)
        values($1,$2,'task_definition',$3,'historical-remote',$4,now()-interval '2 days')`,[participant,target,task,actor]);
      await db.query(`insert into companion_local.actuation_intents(participant_id,event_id,target_id,operation,request,requested_by,created_at)
        values($1,$2,$3,'notify','{}',$4,now()-interval '2 days')`,[participant,event,target,actor]);
      expect((await db.query<{count:number}>(`select count(*)::integer as count from companion_local.actuation_intents`)).rows[0].count).toBe(1);
      await expect(db.query(`insert into companion_local.actuation_targets(participant_id,system,provider,destination_ref,created_by)
        values($1,'email','future-provider','new-target',$2)`,[participant,actor])).rejects.toBeTruthy();
      await expect(db.query(`insert into companion_local.external_resource_links(participant_id,target_id,local_kind,local_id,remote_id,linked_by)
        values($1,$2,'task_definition',$3,'new-remote',$4)`,[participant,target,task,actor])).rejects.toBeTruthy();
      await expect(db.query(`insert into companion_local.actuation_intents(participant_id,event_id,target_id,operation,request,requested_by)
        values($1,$2,$3,'update','{}',$4)`,[participant,event,target,actor])).rejects.toBeTruthy();
      const disabledActor=crypto.randomUUID();
      await db.query(`insert into companion_local.accounts(id,email,password_salt,password_hash,created_at,disabled_at)
        values($1,'disabled@example.invalid','\\x00','\\x00',now()-interval '10 days',now()-interval '1 day')`,[disabledActor]);
      await db.query(`insert into companion_local.role_grants(participant_id,actor_id,role,granted_at)
        values($1,$2,'client',now()-interval '9 days')`,[participant,disabledActor]);
      await db.query(`insert into companion_local.actuation_targets(participant_id,system,provider,destination_ref,created_by,created_at)
        values($1,'calendar','future-provider','before-account-disable',$2,now()-interval '2 days')`,[participant,disabledActor]);
      await expect(db.query(`insert into companion_local.actuation_targets(participant_id,system,provider,destination_ref,created_by)
        values($1,'email','future-provider','after-account-disable',$2)`,[participant,disabledActor])).rejects.toBeTruthy();
    } finally { await db.close(); }
  });
});
