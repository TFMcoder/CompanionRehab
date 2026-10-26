import type {Database} from './backup.js';

/** Historical SQL contains its own transaction boundaries and cannot be replayed.
 * Refuse even empty existing tables: this is initialization, never an upgrade. */
export async function assertEmptyInitializationTarget(db:Database):Promise<void>{
  const result=await db.query(`select exists(
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname !~ '^pg_' and n.nspname<>'information_schema'
      and c.relkind in ('r','p','v','m','f','S')
  ) as initialized`);
  if(result.rows[0]?.initialized!==false)throw Error('Target already contains application objects. Use the guarded additive schema upgrade; historical initialization was refused.');
}

export async function initializeEmptyLocalSchema(db:Database,sql:string):Promise<void>{
  await assertEmptyInitializationTarget(db);
  await db.query(sql);
}
