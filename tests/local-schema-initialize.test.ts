import{describe,it,expect}from'vitest';
import{PGlite}from'@electric-sql/pglite';
import{assertEmptyInitializationTarget,initializeEmptyLocalSchema}from'../src/server/local-schema-initialize.js';

describe('historical schema initialization guard',()=>{
 it('initializes only a fresh target and refuses replay before the first SQL write',async()=>{
  const db=new PGlite();try{
   await initializeEmptyLocalSchema(db,'create table public.preserved(id integer primary key);');
   await db.query('insert into public.preserved values(7)');
   await expect(initializeEmptyLocalSchema(db,'delete from public.preserved')).rejects.toThrow('already contains application objects');
   expect((await db.query('select id from public.preserved')).rows).toEqual([{id:7}]);
  }finally{await db.close();}
 });
 it('refuses existing empty tables and views as well as populated care data',async()=>{
  const db=new PGlite();try{
   await db.exec('create schema companion_local;create table companion_local.empty_table(id integer);');
   await expect(assertEmptyInitializationTarget(db)).rejects.toThrow('guarded additive');
   await db.exec('drop table companion_local.empty_table;create view companion_local.saved_view as select 1 id;');
   await expect(assertEmptyInitializationTarget(db)).rejects.toThrow('guarded additive');
  }finally{await db.close();}
 });
 it('does not mistake a custom schema beginning with pg for a system schema',async()=>{
  const db=new PGlite();try{
   await db.exec('create schema pgcare;create table pgcare.saved(id integer);');
   await expect(assertEmptyInitializationTarget(db)).rejects.toThrow('already contains application objects');
  }finally{await db.close();}
 });
});
