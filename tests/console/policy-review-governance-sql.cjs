'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {PGlite}=require(process.argv[2]);
const sql=name=>fs.readFileSync(path.join(__dirname,'../../cloudbase/migrations/'+name+'.sql'),'utf8').replace(/\r/g,'');
(async()=>{
  const db=new PGlite(); const m='20261111181000_policy_review_governance';
  try {
    await db.exec(`CREATE ROLE service_role;CREATE ROLE anon;CREATE ROLE authenticated;
      CREATE TABLE persons(id bigint PRIMARY KEY,display_name text,updated_at timestamptz,sales_priority text,referral_priority text,deleted_at date,customer_stage text,first_contact_date date);
      CREATE TABLE customers("Id" bigint PRIMARY KEY,person_id bigint,created_at timestamptz,deleted_at date);
      CREATE TABLE policy_review_reports(id bigint PRIMARY KEY,customer_id bigint,report_date date,report_type text,summary text,edited_summary text,edited_gaps text,gaps_found text,edited_recommendations text,next_action text,edited_next_action text,input_products_version int,updated_at timestamptz,deleted_at date,delete_batch_id uuid);
      CREATE TABLE products(id bigint PRIMARY KEY,customer_id bigint UNIQUE,version int,deleted_at date);
      CREATE TABLE opportunities(id bigint PRIMARY KEY,person_id bigint,customer_id bigint,opportunity_type text,deleted_at date);
      CREATE TABLE actions(id bigserial PRIMARY KEY,person_id bigint,action_type text,title text,description text,due_at timestamptz,priority text,status text,source text,created_by_uid text,completed_at timestamptz,completed_by_uid text,updated_at timestamptz DEFAULT now());
      CREATE TABLE commitments(id bigint PRIMARY KEY); CREATE TABLE crm_test_batches(batch_key text,created_by_uid text);CREATE TABLE crm_test_records(batch_key text,record_table text,record_id text);
      CREATE TABLE recruit_candidates(id int,person_id int,customer_id int,stage text,recruitment_priority text,deleted_at date);
      CREATE TABLE person_roles(person_id int,role text);CREATE TABLE followups("Id" int,customer_id int,followup_date date,next_followup_date date,deleted_at date);
      CREATE TABLE recruit_followups(candidate_id int,followup_date date,next_followup_date date,deleted_at date);
      CREATE TABLE activities(id int,name text,activity_date date,deleted_at date);
      CREATE TABLE activity_participants(id int,activity_id int,canonical_person_id int,status text,updated_at date,deleted_at date);
      GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO service_role; GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
      INSERT INTO persons(id,display_name,updated_at) VALUES(1,'Test',now()),(2,'Other',now());
      INSERT INTO customers("Id",person_id) VALUES(11,1),(12,2); INSERT INTO person_roles VALUES(1,'customer'),(2,'customer');
      INSERT INTO opportunities VALUES(31,1,null,'insurance',null),(32,2,12,'insurance',null);
      INSERT INTO policy_review_reports(id,customer_id,summary) VALUES(21,11,'original');
    `);
    await db.exec(sql('20261004063000_work_item_commands'));
    const undo=sql(m+'.rollback');await db.exec(undo.slice(undo.indexOf('CREATE OR REPLACE FUNCTION'),undo.indexOf('DROP FUNCTION public.crm_policy_service_v1')));
    for(let i=0;i<2;i++){await db.exec(sql(m));if(!i)await db.exec(undo);}
    async function rpc(fn,args){await db.exec('SET ROLE service_role');try{return (await db.query('SELECT public.'+fn+' AS r',args)).rows[0].r;}finally{await db.exec('RESET ROLE');}}
    const call=(op,d={})=>rpc('crm_policy_service_v1($1,$2,$3)',['tester',op,{customerId:11,...d}]);
    const state=()=>call('state',{reportId:21});
    const decide=async(op,extra={})=>{const s=await state();return call(op,{reportId:21,revision:s.review_revision,basis:s.product_basis,...extra});};
    const list=kind=>rpc('person_customer_worklist_v1($1)',[{page:1,pageSize:1,keyword:'',sortField:'id',sortDir:'asc',status:'all',customerPriorities:[],policyFilter:kind}]);
    assert.equal((await list('verify')).total,1);assert.equal((await list('all')).total,2);assert.equal((await state()).reviewed_at,null);
    await decide('approve');assert.equal((await state()).is_current,false);
    await db.exec("INSERT INTO products VALUES(9007199254740993,11,1,null)");
    await decide('approve');assert.equal((await state()).is_current,true);assert.equal((await list('verify')).total,0);
    await assert.rejects(call('approve',{reportId:21,revision:0,basis:null}),/changed/);
    await decide('link',{opportunityId:31});await decide('link',{opportunityId:31});
    await assert.rejects(decide('link',{opportunityId:32}));
    assert.equal((await call('options',{opportunityId:31})).rows[0].linked,true);
    await decide('deactivate');assert.equal((await call('options',{opportunityId:31})).rows[0].summary,null);
    await decide('activate');assert.equal((await state()).is_current,true);
    await db.exec('UPDATE products SET version=2');assert.equal((await state()).is_current,false);
    assert.equal((await list('verify')).total,1);await decide('approve');
    await db.exec("UPDATE policy_review_reports SET edited_summary='revision'");assert.equal((await state()).reviewed_at,null);
    await decide('approve');await db.exec('UPDATE policy_review_reports SET deleted_at=current_date');await assert.rejects(state());
    await db.exec('UPDATE policy_review_reports SET deleted_at=null');assert.equal((await state()).is_current,true);
    await db.exec('UPDATE customers SET deleted_at=current_date WHERE "Id"=11');await assert.rejects(state());
    await db.exec('UPDATE customers SET deleted_at=null WHERE "Id"=11');assert.equal((await state()).is_current,true);
    const today=(await db.query("SELECT ((now() AT TIME ZONE 'Asia/Shanghai')::date)::text AS day")).rows[0].day;
    for(const kind of ['renewal','review']){
      const a=await call('schedule',{day:today,kind,title:'Test action',requestId:randomUUID()});
      assert.equal((await list(kind)).total,0);const saved=await call('confirmSchedule',{previewId:a.previewId});
      assert.equal((await call('confirmSchedule',{previewId:a.previewId})).replayed,true);assert.equal((await list(kind)).total,1);
      const id=saved.itemId;await db.query("UPDATE actions SET status='completed' WHERE id=$1",[id]);assert.equal((await list(kind)).total,0);
      await db.query("UPDATE actions SET status='open',due_at=((now() AT TIME ZONE 'Asia/Shanghai')::date+31+time '12:00') AT TIME ZONE 'Asia/Shanghai' WHERE id=$1",[id]);assert.equal((await list(kind)).total,0);
      await db.query("UPDATE actions SET due_at=((now() AT TIME ZONE 'Asia/Shanghai')::date+30+time '12:00') AT TIME ZONE 'Asia/Shanghai' WHERE id=$1",[id]);assert.equal((await list(kind)).total,kind==='renewal'?1:0);
      await db.query("UPDATE actions SET due_at=now()-interval '2 days' WHERE id=$1",[id]);assert.equal((await list(kind)).total,1);
    }
    await assert.rejects(db.exec(undo),/Retain recorded/);await db.exec('ROLLBACK');
    console.log('PASS policy lifecycle, person-scoped citations, worklist filters, service actions, restore, stale edits and guarded rollback.');
  }finally{await db.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
