// Run with an isolated PGlite installation: node directory-participation.cjs <absolute module path>.
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require(process.argv[2]);
const base = path.resolve(__dirname, '../../cloudbase/migrations/20261111030000_directory_participation');
const migration = readFileSync(base + '.sql', 'utf8').replace(/\r\n/g,'\n');
const rollback = readFileSync(base + '.rollback.sql', 'utf8').replace(/\r\n/g,'\n');
const enumBase = path.resolve(__dirname, '../../cloudbase/migrations/20261111074000_directory_priority_enum');
const fix = readFileSync(enumBase + '.sql','utf8').replace(/\r\n/g,'\n');
const undo = readFileSync(enumBase + '.rollback.sql','utf8').replace(/\r\n/g,'\n');

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE service_role;
      CREATE TYPE public."优先级" AS ENUM ('A','B','C','D','E');
      CREATE TABLE persons(id int,display_name text,phone text,occupation text,organization text,updated_at date,
        sales_priority public."优先级",referral_priority public."优先级",deleted_at date,customer_stage text,first_contact_date date);
      CREATE TABLE customers("Id" int,person_id int,created_at timestamptz,deleted_at date);
      CREATE TABLE recruit_candidates(id int,person_id int,customer_id int,stage text,recruitment_priority public."优先级",deleted_at date);
      CREATE TABLE person_roles(person_id int,role text);
      CREATE TABLE followups("Id" int,customer_id int,followup_date date,next_followup_date date,deleted_at date);
      CREATE TABLE recruit_followups(candidate_id int,followup_date date,next_followup_date date,deleted_at date);
      CREATE TABLE activities(id int,name text,activity_date date,deleted_at date);
      CREATE TABLE activity_participants(id int,activity_id int,canonical_person_id int,status text,updated_at date,deleted_at date);
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
      INSERT INTO persons(id,display_name,sales_priority,referral_priority) VALUES(1,'Demo','A','B'),(2,'Demo','C','C'),(3,'Other','B','D'),(4,'Deleted',null,null);
      UPDATE persons SET deleted_at=current_date WHERE id=4;
      INSERT INTO customers("Id",person_id) VALUES(11,1);
      INSERT INTO recruit_candidates(id,person_id,recruitment_priority) VALUES(12,1,'D');
      INSERT INTO person_roles VALUES(1,'customer'),(1,'recruit'),(1,'speaker'),(3,'participant'),(3,'referrer');
      INSERT INTO activities VALUES(10,'First','2026-01-01',null),(11,'Latest','2026-03-01',null),(12,'Deleted','2026-05-01',current_date);
      INSERT INTO activity_participants VALUES(20,10,1,'attended',null,null),(21,11,1,'invited',null,null),
      (22,11,1,'absent','2026-04-01',null),(23,10,2,'invited',null,null),(24,12,3,'attended',null,null),
      (25,11,null,'invited',null,null),(26,11,4,'attended',null,null);`);
    await db.exec(rollback.slice(rollback.indexOf('CREATE OR REPLACE FUNCTION'),rollback.lastIndexOf('COMMIT;')));
    await db.exec(migration);
    await db.exec(fix);
    async function rpc(call,params=[]) {
      await db.exec('SET ROLE service_role');
      try { return (await db.query('SELECT public.'+call+' AS result',params)).rows[0].result; }
      finally {await db.exec('RESET ROLE');}
    }
    const filtered=(roles,page=1,size=50)=>rpc("person_directory_filtered_page_v1($1,$2,'','id','asc',$3,'{}','{}','{}')",[page,size,roles]);
    const all=()=>rpc("person_directory_page_v1(1,50,'','id','asc')");
    const work=()=>rpc('person_customer_worklist_v1($1)',[JSON.stringify({page:1,pageSize:20,keyword:'',sortField:'id',sortDir:'asc',status:'all',customerPriorities:[]})]);
    const rows=(await filtered(['participant'])).rows;
    assert.deepEqual(rows.map(r=>r.id),[1,2]);
    assert.deepEqual([rows[0].activity_count,rows[0].latest_activity_id,rows[0].latest_activity_status],[2,11,'absent']);
    assert.deepEqual([rows[0].sales_priority,rows[0].recruitment_priority,rows[0].referral_priority],['A','D','B']);
    for (const [role, customer, recruit, referral] of [['customer',['A'],[],[]],['recruit',[],['D'],[]]]) {
      const page = await rpc("person_directory_filtered_page_v1(1,50,'','id','asc',$1,$2,$3,$4)",[[role],customer,recruit,referral]);
      assert.deepEqual(page.rows.map(r=>r.id),[1]);
    }
    assert.deepEqual((await filtered(['participant','referrer'])).rows.map(r=>r.id),[1,2,3]);
    assert.deepEqual((await filtered(['participant'],2,1)).rows.map(r=>r.id),[2]);
    assert.equal((await filtered(['participant'],2,1)).total,2);
    assert.deepEqual((await all()).rows.filter(r=>r.roles.includes('participant')).map(r=>r.id),[1,2]);
    assert.equal((await work()).rows[0].activity_count,2);
    await db.exec('UPDATE activities SET deleted_at=current_date WHERE id=11');
    assert.equal((await filtered(['participant'])).rows[0].activity_count,1);
    await db.exec('UPDATE activity_participants SET deleted_at=current_date WHERE id=20');
    assert.deepEqual((await filtered(['participant'])).rows.map(r=>r.id),[2]);
    assert.equal((await work()).rows[0].roles.includes('participant'),false);
    await db.exec('UPDATE activities SET deleted_at=null WHERE id=11');
    assert.equal((await filtered(['participant'])).rows[0].latest_activity_id,11);
    await db.exec(undo);
    await db.exec(rollback);
    assert.deepEqual((await all()).rows.filter(r=>r.roles.includes('participant')).map(r=>r.id),[3]);
    await db.exec(migration);
    await db.exec(fix);
    assert.deepEqual((await filtered(['participant'])).rows.map(r=>r.id),[1,2]);
    console.log('PASS directory RPCs, pagination, identity, combined roles, independent priorities, delete/restore and migration round trip');
  } finally { await db.close(); }
})().catch(e=>{ console.error(e.message);process.exitCode=1; });
