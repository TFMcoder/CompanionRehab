import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { bootstrapLocalUser, LocalCare } from '../src/server/local-care.js';
import { ProgramService } from '../src/server/programs.js';
import { MealGroceryService } from '../src/server/meal-grocery.js';
import type { ProgramDraft } from '../src/shared/program-contracts.js';
import { pglitePool } from './helpers/pglite-pool.js';

const clock=()=>new Date('2026-10-13T14:00:00Z');
const key=()=>randomUUID();
const confirmed={confirmed:true as const};
const routine:ProgramDraft={title:'Synthetic morning sequence',kind:'routine',protected_start:'09:00',protected_end:'10:30',rest_minutes:0,
  steps:[{id:'prepare',title:'Prepare',instruction:'Use the approved synthetic preparation step.',optional:false,depends_on:[],estimated_minutes:5},
    {id:'rest',title:'Rest',instruction:'Use the approved synthetic rest step.',optional:true,depends_on:['prepare'],estimated_minutes:5}]};
const rehab:ProgramDraft={title:'Synthetic approved rehab',kind:'rehab',protected_start:null,protected_end:null,rest_minutes:0,
  steps:[{id:'exercise',title:'Exercise',instruction:'Synthetic protocol owner instruction only.',optional:false,depends_on:[],estimated_minutes:5},
    {id:'review',title:'Review',instruction:'Synthetic protocol owner review instruction.',optional:false,depends_on:['exercise'],estimated_minutes:5}]};

describe('approved programs and factual runs',()=>{
  let db:PGlite,pool:Pool,service:ProgramService,care:LocalCare;
  let client:any,clinician:any,family:any,administrator:any;
  let ownerId:string,clinicianId:string,familyId:string,administratorId:string;
  beforeAll(async()=>{
    db=new PGlite();pool=pglitePool(db) as unknown as Pool;
    for(const file of ['002_local_care.sql','003_activity_ledger.sql','004_client_readiness.sql','005_runtime_observability.sql','006_family_task_requests.sql','007_meals_groceries.sql','009_programs.sql'])
      await db.exec(await readFile(new URL(`../db/${file}`,import.meta.url),'utf8'));
    const owner=await bootstrapLocalUser(pool,{email:'program-client@example.invalid',password:'synthetic-program-password',role:'client',display_name:'Synthetic client',time_zone:'America/Toronto'});
    ownerId=owner.participant_id;
    const clinicianUser=await bootstrapLocalUser(pool,{email:'program-clinician@example.invalid',password:'synthetic-program-password',role:'clinician',participant_id:ownerId});
    const familyUser=await bootstrapLocalUser(pool,{email:'program-family@example.invalid',password:'synthetic-program-password',role:'family_friend',participant_id:ownerId});
    const adminUser=await bootstrapLocalUser(pool,{email:'program-admin@example.invalid',password:'synthetic-program-password',role:'administrator',participant_id:ownerId});
    clinicianId=clinicianUser.user_id;familyId=familyUser.user_id;administratorId=adminUser.user_id;
    care=new LocalCare({pool,clock});service=new ProgramService(pool,{clock});
    client=await care.login('program-client@example.invalid','synthetic-program-password');
    clinician=await care.login('program-clinician@example.invalid','synthetic-program-password');
    family=await care.login('program-family@example.invalid','synthetic-program-password');
    administrator=await care.login('program-admin@example.invalid','synthetic-program-password');
  });
  afterAll(async()=>{await db?.close();});

  it('reserves program receipt keys across care and meal workflows',async()=>{
    const idempotency_key=key();await service.command(client,{type:'create_program',idempotency_key,draft:routine,...confirmed});
    await expect(care.command(client,{type:'start_or_resume_checkin',idempotency_key,local_date:'2026-10-13',expected_revision:0,payload:{}})).rejects.toMatchObject({status:409});
    const meals=new MealGroceryService(pool,{clock});
    await expect(meals.command(client,{type:'add_grocery',idempotency_key,item:{name:'Synthetic item',amount:null,unit:null},proposal_id:null,expected_proposal_revision:null})).rejects.toMatchObject({status:409});
    expect((await pool.query('select count(*)::int as count from companion_local.append_only_mutations where command_id=$1',[idempotency_key])).rows[0].count).toBe(1);
  });

  it('requires explicit approval, retains exact receipt, and resumes the next eligible step after pause/restart',async()=>{
    const create={type:'create_program' as const,idempotency_key:key(),draft:routine,...confirmed};
    const drafted=await service.command(client,create);
    expect((await service.command(client,create)).replayed).toBe(true);
    await expect(service.command(client,{...create,draft:{...routine,title:'Changed'}})).rejects.toMatchObject({status:409});
    await expect(service.command(client,{type:'start_program',idempotency_key:key(),version_id:drafted.version_id!,local_date:'2026-10-13',acknowledged_conflicts:[],...confirmed})).rejects.toMatchObject({status:409});
    const approved=await service.command(client,{type:'approve_program',idempotency_key:key(),version_id:drafted.version_id!,approval_ref:'synthetic owner approval',...confirmed});
    expect(approved.version_id).toBe(drafted.version_id);
    const started=await service.command(client,{type:'start_program',idempotency_key:key(),version_id:drafted.version_id!,local_date:'2026-10-13',acknowledged_conflicts:[],...confirmed});
    expect(started.run_id).toBeTruthy();
    const view=await service.workspace(client);
    expect(view.runs[0]).toMatchObject({version_id:drafted.version_id,current_step:{id:'prepare'},status:'active'});
    await expect(service.command(client,{type:'report_program_step',idempotency_key:key(),run_id:started.run_id!,expected_revision:1,step_id:'rest',outcome:'completed',reason:'',difficulty:'',assistance:'',notes:'',acknowledged_conflicts:[],...confirmed})).rejects.toMatchObject({status:409});
    await service.command(client,{type:'pause_program',idempotency_key:key(),run_id:started.run_id!,expected_revision:1,reason:'Synthetic rest interruption',...confirmed});
    const restarted=new ProgramService(pool,{clock});
    expect((await restarted.workspace(client)).runs[0]).toMatchObject({status:'paused',current_step:{id:'prepare'}});
    await restarted.command(client,{type:'resume_program',idempotency_key:key(),run_id:started.run_id!,expected_revision:2,acknowledged_conflicts:[],...confirmed});
    await restarted.command(client,{type:'report_program_step',idempotency_key:key(),run_id:started.run_id!,expected_revision:3,step_id:'prepare',outcome:'completed',reason:'',difficulty:'',assistance:'',notes:'',acknowledged_conflicts:[],...confirmed});
    const skipped=await restarted.command(client,{type:'report_program_step',idempotency_key:key(),run_id:started.run_id!,expected_revision:4,step_id:'rest',outcome:'skipped',reason:'Synthetic skip choice',difficulty:'',assistance:'',notes:'',acknowledged_conflicts:[],...confirmed});
    expect((await restarted.workspace(client)).runs[0]).toMatchObject({status:'completed',results:[{step_id:'prepare',outcome:'completed'},{step_id:'rest',outcome:'skipped'}]});
    expect((await pool.query('select count(*)::int n from companion_local.activity_records where participant_id=$1',[ownerId])).rows[0].n).toBe(0);
    expect((await pool.query("select data->>'reason' reason from companion_local.domain_events where participant_id=$1 and event_type='ProgramStepSkipped'",[ownerId])).rows[0].reason).toBe('Synthetic skip choice');
    expect((await restarted.receipt(client,skipped.command_id))?.run_id).toBe(started.run_id);
  });

  it('keeps an approved version title unchanged while a renamed revision awaits approval',async()=>{
    const original={...routine,title:'Synthetic original version title'};
    const first=await service.command(client,{type:'create_program',idempotency_key:key(),draft:original,...confirmed});
    await service.command(client,{type:'approve_program',idempotency_key:key(),version_id:first.version_id!,approval_ref:'Synthetic approval',...confirmed});
    const second=await service.command(client,{type:'revise_program',idempotency_key:key(),definition_id:first.definition_id!,
      expected_version:1,draft:{...original,title:'Synthetic pending revision title'},...confirmed});
    const versions=(await service.workspace(client)).versions.filter(v=>v.definition_id===first.definition_id);
    expect(versions.find(v=>v.id===first.version_id)).toMatchObject({title:original.title,approved:true,current:true});
    expect(versions.find(v=>v.id===second.version_id)).toMatchObject({title:'Synthetic pending revision title',approved:false,current:false});
  });

  it('requires review of appointment conflicts and blocks a superseded run without swapping instructions',async()=>{
    const drafted=await service.command(client,{type:'create_program',idempotency_key:key(),draft:{...routine,title:'Synthetic conflict routine'},...confirmed});
    await service.command(client,{type:'approve_program',idempotency_key:key(),version_id:drafted.version_id!,approval_ref:'synthetic routine approval',...confirmed});
    const appointmentId=randomUUID();
    await pool.query(`insert into companion_local.appointments(id,participant_id,title,starts_at,created_by)
      values($1,$2,$3,$4,$5)`,[appointmentId,ownerId,'Synthetic appointment','2026-10-13T14:15:00Z',client.user_id]);
    const view=await service.workspace(client);
    expect(view.conflicts_by_version[drafted.version_id!]).toMatchObject([{id:appointmentId}]);
    const start={type:'start_program' as const,idempotency_key:key(),version_id:drafted.version_id!,local_date:'2026-10-13',acknowledged_conflicts:[],...confirmed};
    await expect(service.command(client,start)).rejects.toMatchObject({code:'schedule_review'});
    const running=await service.command(client,{...start,acknowledged_conflicts:[appointmentId]});
    const revised=await service.command(client,{type:'revise_program',idempotency_key:key(),definition_id:drafted.definition_id!,expected_version:1,draft:{...routine,title:'Synthetic changed routine'},...confirmed});
    await service.command(client,{type:'approve_program',idempotency_key:key(),version_id:revised.version_id!,approval_ref:'synthetic revised approval',...confirmed});
    const old=(await service.workspace(client)).runs.find(item=>item.id===running.run_id)!;
    expect(old).toMatchObject({version_id:drafted.version_id,obsolete:true,current_step:{id:'prepare'}});
    await expect(service.command(client,{type:'report_program_step',idempotency_key:key(),run_id:running.run_id!,expected_revision:1,step_id:'prepare',outcome:'completed',reason:'',difficulty:'',assistance:'',notes:'',acknowledged_conflicts:[appointmentId],...confirmed})).rejects.toMatchObject({code:'obsolete_version'});
    await service.command(client,{type:'end_program',idempotency_key:key(),run_id:running.run_id!,expected_revision:1,reason:'Review revised instructions',...confirmed});
  });

  it('keeps each version and pinned run title immutable while a renamed draft awaits approval',async()=>{
    const oldTitle='Synthetic pinned title',newTitle='Synthetic proposed new title';
    const original=await service.command(client,{type:'create_program',idempotency_key:key(),draft:{...routine,title:oldTitle,protected_start:null,protected_end:null},...confirmed});
    await service.command(client,{type:'approve_program',idempotency_key:key(),version_id:original.version_id!,approval_ref:'synthetic title approval',...confirmed});
    const running=await service.command(client,{type:'start_program',idempotency_key:key(),version_id:original.version_id!,local_date:'2026-10-13',acknowledged_conflicts:[],...confirmed});
    const revised=await service.command(client,{type:'revise_program',idempotency_key:key(),definition_id:original.definition_id!,expected_version:1,
      draft:{...routine,title:newTitle,protected_start:null,protected_end:null},...confirmed});
    const before=await service.workspace(client);
    expect(before.versions.find(v=>v.id===original.version_id)?.title).toBe(oldTitle);
    expect(before.versions.find(v=>v.id===revised.version_id)?.title).toBe(newTitle);
    expect(before.runs.find(r=>r.id===running.run_id)?.title).toBe(oldTitle);
    expect((await pool.query('select title from companion_local.program_definitions where id=$1',[original.definition_id])).rows[0].title).toBe(oldTitle);
    await expect(pool.query('update companion_local.program_versions set title=$2 where id=$1',[original.version_id,newTitle])).rejects.toThrow();
    await service.command(client,{type:'approve_program',idempotency_key:key(),version_id:revised.version_id!,approval_ref:'synthetic renamed approval',...confirmed});
    const after=await service.workspace(client);
    expect(after.versions.find(v=>v.id===original.version_id)?.title).toBe(oldTitle);
    expect(after.versions.find(v=>v.id===revised.version_id)?.title).toBe(newTitle);
    expect(after.runs.find(r=>r.id===running.run_id)).toMatchObject({title:oldTitle,version_id:original.version_id,obsolete:true});
    expect((await pool.query('select title from companion_local.program_definitions where id=$1',[original.definition_id])).rows[0].title).toBe(newTitle);
  });

  it('enforces a recorded rest interval before the next step',async()=>{
    const draft={...routine,title:'Synthetic rest interval',protected_start:null,protected_end:null,rest_minutes:15};
    const created=await service.command(client,{type:'create_program',idempotency_key:key(),draft,...confirmed});
    await service.command(client,{type:'approve_program',idempotency_key:key(),version_id:created.version_id!,approval_ref:'synthetic rest approval',...confirmed});
    const running=await service.command(client,{type:'start_program',idempotency_key:key(),version_id:created.version_id!,local_date:'2026-10-13',acknowledged_conflicts:[],...confirmed});
    await service.command(client,{type:'report_program_step',idempotency_key:key(),run_id:running.run_id!,expected_revision:1,step_id:'prepare',outcome:'completed',reason:'',difficulty:'',assistance:'',notes:'',acknowledged_conflicts:[],...confirmed});
    expect((await service.workspace(client)).runs.find(item=>item.id===running.run_id)).toMatchObject({current_step:null,blocked_reason:expect.stringContaining('Rest until')});
    await expect(service.command(client,{type:'report_program_step',idempotency_key:key(),run_id:running.run_id!,expected_revision:2,step_id:'rest',outcome:'completed',reason:'',difficulty:'',assistance:'',notes:'',acknowledged_conflicts:[],...confirmed})).rejects.toMatchObject({status:409});
  });

  it('restricts rehab drafting, approval, notes, and client controlled grants',async()=>{
    await expect(service.command(family,{type:'create_program',idempotency_key:key(),draft:rehab,...confirmed})).rejects.toMatchObject({status:403});
    await service.command(client,{type:'set_program_access',idempotency_key:key(),actor_id:clinicianId,role:'clinician',expected_revision:0,
      capabilities:['edit_rehab','approve_rehab','read_rehab'],...confirmed});
    const drafted=await service.command(clinician,{type:'create_program',idempotency_key:key(),draft:rehab,...confirmed});
    await expect(service.command(client,{type:'approve_program',idempotency_key:key(),version_id:drafted.version_id!,approval_ref:'synthetic protocol reference',...confirmed})).rejects.toMatchObject({status:403});
    await service.command(clinician,{type:'approve_program',idempotency_key:key(),version_id:drafted.version_id!,approval_ref:'synthetic protocol owner reference',...confirmed});
    const started=await service.command(client,{type:'start_program',idempotency_key:key(),version_id:drafted.version_id!,local_date:'2026-10-13',acknowledged_conflicts:[],...confirmed});
    const report=await service.command(client,{type:'report_program_step',idempotency_key:key(),run_id:started.run_id!,expected_revision:1,step_id:'exercise',outcome:'completed',reason:'',difficulty:'Synthetic difficulty',assistance:'Synthetic help',notes:'Synthetic private note',acknowledged_conflicts:[],...confirmed});
    const revised=await service.command(clinician,{type:'revise_program',idempotency_key:key(),definition_id:drafted.definition_id!,expected_version:1,
      draft:{...rehab,title:'Synthetic revised rehab'},...confirmed});
    await service.command(clinician,{type:'approve_program',idempotency_key:key(),version_id:revised.version_id!,approval_ref:'synthetic revised protocol approval',...confirmed});
    expect((await service.workspace(client)).runs.find(item=>item.id===started.run_id)).toMatchObject({version_id:drafted.version_id,obsolete:true,current_step:{id:'review'}});
    await expect(service.command(client,{type:'report_program_step',idempotency_key:key(),run_id:started.run_id!,expected_revision:2,step_id:'review',outcome:'completed',reason:'',difficulty:'',assistance:'',notes:'',acknowledged_conflicts:[],...confirmed})).rejects.toMatchObject({code:'obsolete_version'});
    const corrected=await service.command(client,{type:'correct_program_step',idempotency_key:key(),run_id:started.run_id!,step_id:'exercise',expected_revision:1,outcome:'completed',reason:'',difficulty:'Synthetic corrected difficulty',assistance:'Synthetic help',notes:'Synthetic corrected private note',correction_reason:'Synthetic factual correction',...confirmed});
    expect(corrected.revision).toBe(2);
    expect((await service.workspace(client)).runs.find(item=>item.id===started.run_id)?.results[0].notes).toBe('Synthetic corrected private note');
    const familyView=await service.workspace(family);
    expect(JSON.stringify(familyView)).not.toContain('Synthetic private note');
    expect(JSON.stringify(familyView)).not.toContain(rehab.title);
    await expect(service.receipt(family,report.command_id)).resolves.toBeNull();
    await expect(service.command(family,{type:'correct_program_step',idempotency_key:key(),run_id:started.run_id!,step_id:'exercise',expected_revision:2,outcome:'completed',reason:'',difficulty:'',assistance:'',notes:'',correction_reason:'Guess',...confirmed})).rejects.toMatchObject({status:403});
    await service.command(client,{type:'set_program_access',idempotency_key:key(),actor_id:clinicianId,role:'clinician',expected_revision:1,capabilities:[],...confirmed});
    expect(JSON.stringify(await service.workspace(clinician))).not.toContain('Synthetic corrected private note');
  });
});
