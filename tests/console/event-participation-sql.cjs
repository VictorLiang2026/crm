'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {PGlite} = require(process.argv[2]);
const sql = suffix => fs.readFileSync(path.join(__dirname,'../../cloudbase/migrations/20261111134000_event_participation'+suffix+'.sql'),'utf8');
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.activities(id integer PRIMARY KEY, name text,activity_date date,deleted_at timestamptz);
      CREATE TABLE public.persons(id bigint PRIMARY KEY,deleted_at timestamptz);
      CREATE TABLE public.activity_participants(id bigint PRIMARY KEY,activity_id integer,canonical_person_id bigint,
        status text,updated_at timestamptz,deleted_at timestamptz,participant_role text);
      CREATE TABLE public.v_next_context_action(kind text,target_id bigint,person_id bigint,id bigint,title text,status text);
      CREATE TABLE public.crm_test_batches(batch_key text,created_by_uid text);
      CREATE TABLE public.crm_test_records(batch_key text,record_table text,record_id text);
      GRANT SELECT,UPDATE ON ALL TABLES IN SCHEMA public TO service_role;
      INSERT INTO persons VALUES (1,null),(2,null);
      INSERT INTO activities VALUES (9,'Workshop','2026-11-10',null),(10,'Meeting','2026-11-11',null);
      INSERT INTO activity_participants VALUES (21,9,1,'invited',null,null,'speaker'),(22,10,1,'attended',null,null,'attendee'),
        (23,9,null,'attended',null,null,'attendee'),(24,9,2,'absent',null,null,'attendee');
      INSERT INTO v_next_context_action VALUES ('activity',9,1,91,'Call','open');`);
    await db.exec(sql(''));
    await db.exec(sql('.rollback'));
    await db.exec(sql(''));
    const call = async(op,input,uid='tester') => {
      await db.exec('SET ROLE service_role');
      try { return (await db.query('SELECT public.crm_event_participation_v1($1,$2,$3) AS v',[uid,op,input])).rows[0].v; }
      finally { await db.exec('RESET ROLE'); }
    };
    const history = () => call('person',{personId:1});
    const responses = async () => (await call('responses',{activityId:9})).responses;
    const start = await history();
    assert.equal(start.total,2); assert.equal(start.attended,1);
    assert.deepEqual(start.rows.map(e=>e.activity_id),[10,9]);
    assert.equal(start.rows[1].action_id,91); assert.equal(start.rows[1].participant_role,'speaker');
    assert.deepEqual(await responses(),{});
    const save = {activityId:9,participantId:21,version:null,updatedAt:null,expectedStatus:'invited',response:'registered',status:'invited'};
    await call('save',save);
    assert.equal((await history()).rows[1].response,'registered'); assert.equal((await history()).attended,1);
    await assert.rejects(call('save',save),/changed/);
    const version = (await responses())[21].version;
    const stamp = (await db.query("SELECT updated_at::text AS value FROM activity_participants WHERE id=21")).rows[0].value;
    const cancel = {...save,response:'cancelled',version,updatedAt:stamp};
    await db.exec("INSERT INTO crm_test_batches VALUES ('test','limited')");
    await assert.rejects(call('save',cancel,'limited'),/tracked/);
    await assert.rejects(call('save',{...cancel,activityId:10}));
    await call('save',cancel);
    assert.equal((await history()).rows[1].response,'cancelled'); assert.equal((await history()).attended,1);
    assert.equal((await call('person',{personId:2})).rows[0].response,'unrecorded');
    await db.exec('UPDATE activity_participants SET deleted_at=now() WHERE id=21');
    assert.deepEqual(await responses(),{}); assert.equal((await history()).total,1);
    await db.exec('UPDATE activity_participants SET deleted_at=null WHERE id=21');
    assert.equal((await responses())[21].response,'cancelled');
    await db.exec('UPDATE activities SET deleted_at=now() WHERE id=9');
    assert.equal((await history()).total,1);
    await db.exec('UPDATE activities SET deleted_at=null WHERE id=9');
    await db.exec("UPDATE persons SET deleted_at=now() WHERE id=1"); await assert.rejects(history(),/unavailable/);
    await db.exec("UPDATE persons SET deleted_at=null WHERE id=1");
    await db.exec("INSERT INTO activities SELECT i,'Extra',date '2026-11-01',null FROM generate_series(100,121) i; INSERT INTO activity_participants SELECT i,i,1,'invited',null,null,'attendee' FROM generate_series(100,121) i");
    const page1=await history(),page2=await call('person',{personId:1,page:2});
    assert.equal(page1.total,24);assert.equal(page1.hasMore,true);assert.equal(page2.hasMore,false);
    assert.equal(new Set([...page1.rows,...page2.rows].map(r=>r.activity_id)).size,24);
    await assert.rejects(db.exec(sql('.rollback')),/recovery plan/);await db.exec('ROLLBACK');
    console.log('PASS participation migration, rollback guard, multi-role, actual attendance, signup/cancel, scope, stale changes, soft delete/restore, pagination.');
  } finally {await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
