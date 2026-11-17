'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {createEducationBackfill}=require('../../cloudfunctions/assistant/education-backfill-service');
const root=path.resolve(__dirname,'../..');
const migration=fs.readFileSync(path.join(root,'cloudbase/migrations/20261116000100_person_education_backfill.sql'),'utf8');
const rollback=fs.readFileSync(path.join(root,'cloudbase/migrations/20261116000100_person_education_backfill.rollback.sql'),'utf8');
const pilotOrderMigration=fs.readFileSync(path.join(root,'cloudbase/migrations/20261117160700_person_education_pilot_order.sql'),'utf8');
const pilotOrderRollback=fs.readFileSync(path.join(root,'cloudbase/migrations/20261117160700_person_education_pilot_order.rollback.sql'),'utf8');
const reviewSelectionMigration=fs.readFileSync(path.join(root,'cloudbase/migrations/20261117231025_person_education_review_selection.sql'),'utf8');
const reviewSelectionRollback=fs.readFileSync(path.join(root,'cloudbase/migrations/20261117231025_person_education_review_selection.rollback.sql'),'utf8');
async function fixture(){
  const db=new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.persons(id bigint PRIMARY KEY,display_name text,graduation_school text,department_or_major text,
      notes text,occupation text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz DEFAULT clock_timestamp(),deleted_at timestamptz);
    CREATE TABLE public.interactions(id bigint PRIMARY KEY,person_id bigint,summary text,raw_note text,updated_at timestamptz,deleted_at timestamptz);
    CREATE TABLE public.customers("Id" bigint PRIMARY KEY,person_id bigint,additional_info text,updated_at timestamptz,deleted_at timestamptz);
    CREATE TABLE public.followups("Id" bigint PRIMARY KEY,customer_id bigint,interaction_summary text,followup_notes text,updated_at timestamptz,deleted_at timestamptz);
    CREATE TABLE public.recruit_candidates(id bigint PRIMARY KEY,person_id bigint,profile jsonb,updated_at timestamptz,deleted_at timestamptz);
    CREATE TABLE public.recruit_followups(id bigint PRIMARY KEY,candidate_id bigint,interaction_summary text,followup_notes text,updated_at timestamptz,deleted_at timestamptz);
    CREATE TABLE public.activity_roster_people(id bigint PRIMARY KEY,person_id bigint,school text,other_info text,updated_at timestamptz);
    INSERT INTO public.persons(id,display_name,notes)VALUES(1,'Sample One','本人毕业于北京大学，经济学专业。'),(2,'Sample Two','朋友在复旦工作。');
    GRANT USAGE ON SCHEMA public TO service_role;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT UPDATE(graduation_school,department_or_major,updated_at) ON public.persons TO service_role;`);
  try { await db.exec(migration);await db.exec(pilotOrderMigration);await db.exec(reviewSelectionMigration); }
  catch(error) { delete error.query; await db.close(); throw error; }
  await db.exec('SET ROLE service_role');
  const rpc=async(op,data={},actor='owner')=>(await db.query('SELECT public.crm_education_backfill_v1($1,$2,$3::jsonb) AS value',[actor,op,JSON.stringify(data)])).rows[0].value;
  const start=async(maxCalls=20,personIds=['1'])=>rpc('create',{requestKey:(await db.query('SELECT gen_random_uuid() AS id')).rows[0].id,maxCalls,personIds});
  const prepare=async(batchId,candidate={})=>{
    const claim=await rpc('claim',{batchId});
    const item=claim.item;
    const result={candidates:[{school:'北京大学',major:'经济学',relationship:'self',educationType:'graduated',ambiguous:false,
      evidence:[{table:'persons',id:'1',field:'notes',quote:'本人毕业于北京大学，经济学专业。',supports:'both'}],...candidate}],needsReview:false};
    await rpc('finish',{batchId,itemId:item.id,leaseToken:item.lease_token,cursor:0,totalChunks:1,partial:result.candidates,complete:true,result});
    return item;
  };
  const preview=async(batchId,item,kind='apply',overrides={})=>{
    const plan=await rpc('plan',{batchId,kind});
    return rpc(kind==='apply'?'preview':'undoPreview',{batchId,planId:plan.planId,
      rows:[kind==='apply'?{itemId:item.id,candidateIndex:0,schoolAction:'candidate',majorAction:'candidate',...overrides}:{itemId:item.id}]});
  };
  const execute=async(batchId,v)=>{
    const confirmation=await rpc('confirm',{batchId,previewId:v.previewId});
    return rpc('execute',{batchId,previewId:v.previewId,confirmationToken:confirmation.confirmationToken});
  };
  return{db,rpc,start,prepare,preview,execute};
}

test('actual SQL: permissions, actor scope, explicit plan/confirm, atomic audit, replay and safe undo',async()=>{
  const f=await fixture();
  try{
    await f.db.exec('SET ROLE anon');
    await assert.rejects(f.rpc('batches'),/permission denied/);
    await assert.rejects(f.db.query('SELECT * FROM public.person_education_items'),/permission denied/);
    await f.db.exec('SET ROLE service_role');
    const {batchId}=await f.start();
    await assert.rejects(f.rpc('status',{batchId},'different-owner'),/EDUCATION_NOT_FOUND/);
    const item=await f.prepare(batchId);
    await assert.rejects(f.rpc('preview',{batchId,rows:[{itemId:item.id,candidateIndex:0,schoolAction:'candidate',majorAction:'candidate'}]}),/EDUCATION_PLAN_REQUIRED/);
    const v=await f.preview(batchId,item);
    await assert.rejects(f.rpc('execute',{batchId,previewId:v.previewId,confirmed:true}),/EDUCATION_CONFIRMATION_REQUIRED/);
    assert.equal((await f.db.query('SELECT graduation_school FROM public.persons WHERE id=1')).rows[0].graduation_school,null);
    const confirm=await f.rpc('confirm',{batchId,previewId:v.previewId});
    await assert.rejects(f.rpc('execute',{batchId,previewId:v.previewId,confirmationToken:'00000000-0000-4000-8000-000000000000'}),/EDUCATION_CONFIRMATION_REQUIRED/);
    const args={batchId,previewId:v.previewId,confirmationToken:confirm.confirmationToken};
    const first=await f.rpc('execute',args);
    assert.deepEqual(await f.rpc('execute',args),first);
    const person=(await f.db.query('SELECT graduation_school,department_or_major FROM public.persons WHERE id=1')).rows[0];
    assert.deepEqual(person,{graduation_school:'北京大学',department_or_major:'经济学'});
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM public.person_education_changes')).rows[0].n,1);
    const undo=await f.preview(batchId,item,'undo');
    await f.execute(batchId,undo);
    assert.equal((await f.db.query('SELECT graduation_school FROM public.persons WHERE id=1')).rows[0].graduation_school,null);
    assert.ok((await f.db.query('SELECT reverted_at FROM public.person_education_changes')).rows[0].reverted_at);
    await f.db.exec('RESET ROLE');
    await assert.rejects(f.db.exec(rollback),/rollback blocked/);
    await f.db.exec('ROLLBACK');
  }finally{await f.db.close();}
});

test('actual SQL: source edits, stale previews, school-major conflict, refusal to overwrite and undo edits',async()=>{
  const f=await fixture();
  try{
    const {batchId}=await f.start();const item=await f.prepare(batchId);
    const v=await f.preview(batchId,item);
    await f.db.exec("RESET ROLE; UPDATE public.persons SET notes='资料已修改' WHERE id=1; SET ROLE service_role;");
    await assert.rejects(f.execute(batchId,v),/EDUCATION_SOURCE_CHANGED/);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM public.person_education_changes')).rows[0].n,0);
    await f.db.exec("RESET ROLE; UPDATE public.persons SET notes='本人毕业于北京大学，经济学专业。',graduation_school='复旦大学',updated_at=clock_timestamp() WHERE id=1; SET ROLE service_role;");
    const second=await f.start();const item2=await f.prepare(second.batchId);
    await assert.rejects(f.preview(second.batchId,item2,'apply',{schoolAction:'keep',majorAction:'candidate'}),/EDUCATION_SCHOOL_MAJOR_CONFLICT/);
    await assert.rejects(f.preview(second.batchId,item2,'apply',{schoolAction:'keep',majorAction:'keep'}),/EDUCATION_EMPTY_PATCH/);
    await f.db.exec("RESET ROLE; UPDATE public.persons SET graduation_school=NULL,updated_at=clock_timestamp() WHERE id=1; SET ROLE service_role;");
    const third=await f.start();const item3=await f.prepare(third.batchId);
    const v3=await f.preview(third.batchId,item3);await f.execute(third.batchId,v3);
    await f.db.exec("RESET ROLE; UPDATE public.persons SET department_or_major='人工改正',updated_at=clock_timestamp() WHERE id=1; SET ROLE service_role;");
    await assert.rejects(f.preview(third.batchId,item3,'undo'),/EDUCATION_UNDO_CONFLICT/);
    assert.equal((await f.db.query('SELECT department_or_major FROM public.persons WHERE id=1')).rows[0].department_or_major,'人工改正');
    await f.db.exec("RESET ROLE; UPDATE public.persons SET graduation_school=NULL,department_or_major='计算机',updated_at=clock_timestamp() WHERE id=1; SET ROLE service_role;");
    const fourth=await f.start();const item4=await f.prepare(fourth.batchId);
    const replacement=await f.preview(fourth.batchId,item4);
    assert.deepEqual(replacement.rows[0].patch,{graduation_school:'北京大学',department_or_major:'经济学'});
  }finally{await f.db.close();}
});

test('actual SQL: foreign/ambiguous candidates are never executable; lease, budget and pause enforced',async()=>{
  const f=await fixture();
  try{
    for(const candidate of [{relationship:'other'},{relationship:'unclear'},{ambiguous:true},{educationType:'training'},
      {evidence:[{table:'persons',id:'2',field:'notes',quote:'北京大学',supports:'both'}]}]){
      const {batchId}=await f.start();const item=await f.prepare(batchId,candidate);
      await assert.rejects(f.preview(batchId,item),/EDUCATION_CANDIDATE_UNVERIFIED|EDUCATION_EVIDENCE_STALE/);
    }
    const {batchId}=await f.start(1);
    await f.rpc('pause',{batchId});assert.equal((await f.rpc('claim',{batchId})).idle,true);
    await f.rpc('resume',{batchId});const claim=await f.rpc('claim',{batchId});assert.ok(claim.item.lease_token);
    await assert.rejects(f.rpc('finish',{batchId,itemId:claim.item.id,leaseToken:'00000000-0000-4000-8000-000000000000',errorCode:'FAIL'}),/EDUCATION_LEASE_STALE/);
    assert.equal((await f.rpc('claim',{batchId})).budgetExhausted,true);
    await f.db.exec("RESET ROLE; UPDATE public.person_education_items SET lease_until=clock_timestamp()-interval '1 second' WHERE status='running'; SET ROLE service_role;");
    const status=await f.rpc('status',{batchId});
    assert.equal(status.items[0].status,'failed');assert.equal(status.items[0].error_code,'EDUCATION_LEASE_EXPIRED');
    assert.equal((await f.db.query('SELECT graduation_school FROM public.persons WHERE id=1')).rows[0].graduation_school,null);
  }finally{await f.db.close();}
});

test('migration rollback succeeds only before any batches exist',async()=>{
  const f=await fixture();
  try{
    await f.db.exec('RESET ROLE');await f.db.exec(rollback);
    assert.equal((await f.db.query("SELECT to_regclass('public.person_education_batches') AS n")).rows[0].n,null);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM public.persons')).rows[0].n,2);
  }finally{await f.db.close();}
});

test('pilot ordering selects newest-created eligible people and rollback restores ID order',async()=>{
  const f=await fixture();
  try{
    await f.db.exec(`RESET ROLE;
      UPDATE public.persons SET created_at=CASE WHEN id=1 THEN '2021-12-31T00:00:00Z'::timestamptz
        ELSE '2026-11-16T00:00:00Z'::timestamptz END;
      INSERT INTO public.persons(id,display_name,notes,created_at)
        VALUES(3,'Sample Three','no education evidence','2026-11-16T00:00:00Z');
      SET ROLE service_role;`);
    await f.db.exec('RESET ROLE');
    await f.db.exec(pilotOrderMigration);
    await f.db.exec('SET ROLE service_role');
    const create=async()=>f.rpc('create',{requestKey:(await f.db.query('SELECT gen_random_uuid() AS id')).rows[0].id,
      maxCalls:20,sampleSize:1});
    const recent=await create();
    const recentStatus=await f.rpc('status',{batchId:recent.batchId});
    assert.deepEqual(recentStatus.items.map(item=>String(item.person_id)),['3']);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM public.person_education_changes')).rows[0].n,0);
    assert.deepEqual((await f.db.query('SELECT graduation_school,department_or_major FROM public.persons ORDER BY id'))
      .rows.map(row=>[row.graduation_school,row.department_or_major]),[[null,null],[null,null],[null,null]]);

    await f.db.exec('RESET ROLE');
    await f.db.exec(reviewSelectionRollback);await f.db.exec(pilotOrderRollback);
    await f.db.exec('SET ROLE service_role');
    const legacy=await create();
    const legacyStatus=await f.rpc('status',{batchId:legacy.batchId});
    assert.deepEqual(legacyStatus.items.map(item=>String(item.person_id)),['1']);
    assert.deepEqual((await f.rpc('status',{batchId:recent.batchId})).items.map(item=>String(item.person_id)),['3']);
  }finally{await f.db.close();}
});

test('server-side people search returns only incomplete active People newest first with literal name search',async()=>{
  const f=await fixture();
  try{
    await f.db.exec(`RESET ROLE;
      UPDATE public.persons SET created_at=CASE WHEN id=1 THEN '2021-12-31T00:00:00Z'::timestamptz
        ELSE '2026-11-16T00:00:00Z'::timestamptz END;
      INSERT INTO public.persons(id,display_name,notes,created_at)
        VALUES(3,'Sample Three','', '2026-11-17T00:00:00Z'),(4,'100% Sample','', '2026-11-15T00:00:00Z');
      UPDATE public.persons SET graduation_school='复旦大学',department_or_major='经济学' WHERE id=2;
      SET ROLE service_role;`);
    const result=await f.rpc('people',{query:'Sample',offset:0});
    assert.deepEqual(result.people.map(p=>p.person_id),['3','4','1']);
    assert.equal(result.people[0].graduation_school,null);
    assert.equal(Date.parse(result.people[0].created_at),Date.parse('2026-11-17T00:00:00Z'));
    assert.deepEqual((await f.rpc('people',{query:'100%',offset:0})).people.map(p=>p.person_id),['4']);
    assert.deepEqual((await f.rpc('people',{query:'2',offset:0})).people,[]);
    await assert.rejects(f.rpc('people',{query:'x'.repeat(101)}),/EDUCATION_INVALID_INPUT/);
    await assert.rejects(f.rpc('people',{offset:-1}),/EDUCATION_INVALID_INPUT/);
    await assert.rejects(f.rpc('people',{query:'Sample'},''),/EDUCATION_ACCESS_DENIED/);
  }finally{await f.db.close();}
});

test('explicit candidate replacement and manual edits are previewed, confirmed, audited, and safely reversible',async()=>{
  const f=await fixture();
  try{
    await f.db.exec("RESET ROLE; UPDATE public.persons SET graduation_school='旧校名',department_or_major=NULL WHERE id=1; SET ROLE service_role;");
    const {batchId}=await f.start();const item=await f.prepare(batchId);
    const v=await f.preview(batchId,item,'apply',{schoolAction:'manual',schoolValue:'人工修订校名',majorAction:'candidate'});
    assert.deepEqual(v.rows[0].patch,{graduation_school:'人工修订校名',department_or_major:'经济学'});
    assert.deepEqual(v.rows[0].fieldActions,{school:'manual',major:'candidate'});
    assert.deepEqual((await f.db.query('SELECT graduation_school,department_or_major FROM public.persons WHERE id=1')).rows[0],
      {graduation_school:'旧校名',department_or_major:null});
    await f.execute(batchId,v);
    assert.deepEqual((await f.db.query('SELECT graduation_school,department_or_major FROM public.persons WHERE id=1')).rows[0],
      {graduation_school:'人工修订校名',department_or_major:'经济学'});
    const change=(await f.db.query('SELECT before_values,after_values FROM public.person_education_changes WHERE item_id=$1',[item.id])).rows[0];
    assert.deepEqual(change.before_values,{graduation_school:'旧校名',department_or_major:null});
    assert.deepEqual(change.after_values,{graduation_school:'人工修订校名',department_or_major:'经济学'});
    await f.execute(batchId,await f.preview(batchId,item,'undo'));
    assert.deepEqual((await f.db.query('SELECT graduation_school,department_or_major FROM public.persons WHERE id=1')).rows[0],
      {graduation_school:'旧校名',department_or_major:null});
  }finally{await f.db.close();}
});

test('review migration rollback removes search and restores fill-empty-only preview rules',async()=>{
  const f=await fixture();
  try{
    await f.db.exec('RESET ROLE');await f.db.exec(reviewSelectionRollback);await f.db.exec('SET ROLE service_role');
    await assert.rejects(f.rpc('people',{query:'Sample'}),/EDUCATION_NOT_FOUND/);
    await f.db.exec("RESET ROLE; UPDATE public.persons SET graduation_school='旧校名' WHERE id=1; SET ROLE service_role;");
    const {batchId}=await f.start();const item=await f.prepare(batchId);
    const plan=await f.rpc('plan',{batchId,kind:'apply'});
    await assert.rejects(f.rpc('preview',{batchId,planId:plan.planId,rows:[{itemId:item.id,candidateIndex:0,school:true,major:true}]}),
      /EDUCATION_SCHOOL_MAJOR_CONFLICT/);
    assert.equal((await f.db.query('SELECT graduation_school,department_or_major FROM public.persons WHERE id=1')).rows[0].department_or_major,null);
  }finally{await f.db.close();}
});

test('old Console checkbox payload stays usable during rollout but cannot overwrite existing fields',async()=>{
  const f=await fixture();
  try{
    const {batchId}=await f.start();const item=await f.prepare(batchId);const plan=await f.rpc('plan',{batchId,kind:'apply'});
    const preview=await f.rpc('preview',{batchId,planId:plan.planId,rows:[{itemId:item.id,candidateIndex:0,school:true,major:true}]});
    assert.deepEqual(preview.rows[0].patch,{graduation_school:'北京大学',department_or_major:'经济学'});
    await f.db.exec("RESET ROLE; UPDATE public.persons SET graduation_school='旧校名' WHERE id=1; SET ROLE service_role;");
    const second=await f.start();const item2=await f.prepare(second.batchId);const plan2=await f.rpc('plan',{batchId:second.batchId,kind:'apply'});
    await assert.rejects(f.rpc('preview',{batchId:second.batchId,planId:plan2.planId,
      rows:[{itemId:item2.id,candidateIndex:0,school:true,major:true}]}),/EDUCATION_SCHOOL_MAJOR_CONFLICT/);
  }finally{await f.db.close();}
});

test('actual SQL: snapshots contain old history and person-only notes; sample count and duplicate create are bounded',async()=>{
  const f=await fixture();
  try{
    await f.db.exec(`RESET ROLE;
      INSERT INTO public.interactions(id,person_id,raw_note,updated_at) VALUES(1,1,'早年毕业资料',clock_timestamp());
      INSERT INTO public.customers("Id",person_id,additional_info,updated_at) VALUES(1,1,'客户附加资料',clock_timestamp());
      INSERT INTO public.followups("Id",customer_id,followup_notes,updated_at) VALUES(1,1,'旧跟进资料',clock_timestamp());
      SET ROLE service_role;`);
    const requestKey=(await f.db.query('SELECT gen_random_uuid() AS id')).rows[0].id;
    const data={requestKey,maxCalls:10,sampleSize:1,personIds:['1']};
    const first=await f.rpc('create',data);
    assert.equal((await f.rpc('create',data)).batchId,first.batchId);
    await assert.rejects(f.rpc('create',{...data,sampleSize:2}),/IDEMPOTENCY_CONFLICT/);
    assert.equal((await f.rpc('status',{batchId:first.batchId})).items.length,1);
    const claim=await f.rpc('claim',{batchId:first.batchId});
    assert.ok(claim.context.sources.some(s=>s.table==='interactions'&&s.text==='早年毕业资料'));
    assert.ok(claim.context.sources.some(s=>s.table==='followups'&&s.text==='旧跟进资料'));
    const all=await f.rpc('create',{requestKey:(await f.db.query('SELECT gen_random_uuid() AS id')).rows[0].id,maxCalls:10});
    assert.equal((await f.rpc('status',{batchId:all.batchId})).items.length,2);
  }finally{await f.db.close();}
});

test('end-to-end: queued extraction to reviewed education update and safe undo uses real SQL throughout',async()=>{
  const f=await fixture();
  try{
    let modelCalls=0;
    const identity={uid:'owner',isAnonymous:false};
    const service=createEducationBackfill({rpc:(actor,op,data)=>f.rpc(op,data,actor),gatewayFactory:()=>({
      runAITask:async request=>{
        modelCalls++;
        assert.equal(request.subjectType,'person');assert.equal(request.subjectId,'1');
        assert.equal(request.context.person.id,'1');
        assert.ok(request.context.sources.some(s=>s.text==='本人毕业于北京大学，经济学专业。'));
        return{taskId:'101',resultId:'201',skillVersion:'1.0.0',result:{candidates:[{
          school:'北京大学',major:'经济学',relationship:'self',educationType:'graduated',stage:null,ambiguous:false,reason:null,
          evidence:[{table:'persons',id:'1',field:'notes',quote:'本人毕业于北京大学，经济学专业。',supports:'both'}],
        }]}};
      },
    })});
    const call=(operation,data)=>service.handle({action:'educationBackfill',operation,data},identity);
    const requestKey=(await f.db.query('SELECT gen_random_uuid() AS id')).rows[0].id;
    const {batchId}=await call('create',{requestKey,maxCalls:5,personIds:['1']});
    await service.workQueue();assert.equal(modelCalls,1);
    const state=await call('status',{batchId});const item=state.items[0];
    assert.equal(item.status,'ready');assert.equal(item.result.candidates[0].taskRefs[0].resultId,'201');
    assert.equal((await f.db.query('SELECT graduation_school FROM public.persons WHERE id=1')).rows[0].graduation_school,null);
    const plan=await call('plan',{batchId,kind:'apply'});
    const preview=await call('preview',{batchId,planId:plan.planId,rows:[{itemId:item.id,candidateIndex:0,schoolAction:'candidate',majorAction:'candidate'}]});
    assert.deepEqual(preview.rows[0].patch,{graduation_school:'北京大学',department_or_major:'经济学'});
    assert.equal((await f.db.query('SELECT graduation_school FROM public.persons WHERE id=1')).rows[0].graduation_school,null);
    const confirmation=await call('confirm',{batchId,previewId:preview.previewId});
    await call('execute',{batchId,previewId:preview.previewId,confirmationToken:confirmation.confirmationToken});
    assert.deepEqual((await f.db.query('SELECT graduation_school,department_or_major FROM public.persons WHERE id=1')).rows[0],
      {graduation_school:'北京大学',department_or_major:'经济学'});
    const undoPlan=await call('plan',{batchId,kind:'undo'});
    assert.equal(undoPlan.operation,'undo_education_update');
    const undoPreview=await call('undoPreview',{batchId,planId:undoPlan.planId,rows:[{itemId:item.id}]});
    const undoConfirm=await call('confirm',{batchId,previewId:undoPreview.previewId});
    await call('execute',{batchId,previewId:undoPreview.previewId,confirmationToken:undoConfirm.confirmationToken});
    assert.deepEqual((await f.db.query('SELECT graduation_school,department_or_major FROM public.persons WHERE id=1')).rows[0],
      {graduation_school:null,department_or_major:null});
    assert.equal((await f.db.query('SELECT notes FROM public.persons WHERE id=1')).rows[0].notes,'本人毕业于北京大学，经济学专业。');
  }finally{await f.db.close();}
});
