const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {PGlite}=require(process.argv[2]);
const migration=name=>fs.readFileSync(path.resolve(__dirname,'../../cloudbase/migrations',name+'.sql'),'utf8').replace(/\r\n/g,'\n');
(async()=>{
  const db=new PGlite();
  const center='20261111100000_action_center', projection='20261111100500_linked_pipeline_dates';
  try {
    await db.exec(`CREATE ROLE service_role;CREATE ROLE anon;CREATE ROLE authenticated;
      CREATE TABLE persons(id bigint PRIMARY KEY,display_name text,deleted_at date,updated_at timestamptz);
      CREATE TABLE customers("Id" bigint PRIMARY KEY,person_id bigint,deleted_at date);
      CREATE TABLE activities(id bigint PRIMARY KEY,name text,deleted_at date,updated_at timestamptz);
      CREATE TABLE opportunities(id bigint PRIMARY KEY,person_id bigint,customer_id bigint,opportunity_type text,status text,updated_at timestamptz,deleted_at date,next_action text,next_action_date date,ai_summary text,last_progress text,discovered_at date,created_at timestamptz,referred_name text,referred_relation text);
      CREATE TABLE recruit_candidates(id bigint PRIMARY KEY,person_id bigint,customer_id bigint,stage text,next_action text,next_action_date date,deleted_at date,updated_at timestamptz);
      CREATE TABLE actions(id bigint PRIMARY KEY,person_id bigint,opportunity_id bigint,activity_id bigint,source text,title text,description text,priority text,status text,updated_at timestamptz,completed_at timestamptz,due_at timestamptz);
      CREATE TABLE crm_opportunity_action_links(opportunity_id bigint,action_id bigint,person_id bigint);
      CREATE TABLE crm_work_item_commands(kind text,item_id bigint,operation text,executed_at timestamptz);
      CREATE TABLE crm_test_batches(batch_key text,created_by_uid text); CREATE TABLE crm_test_records(batch_key text,record_table text,record_id text);
      CREATE TABLE crm_pipeline_decisions(id uuid,person_id bigint,recruit_id bigint,protection_id bigint,stage text,source text,confirmed_at timestamptz,native_after text);
      CREATE VIEW v_recruit_candidates AS SELECT id AS candidate_id,person_id,customer_id,'Demo'::text AS customer_name,''::text AS occupation,
        stage,0 AS potential_score,'A'::text AS recruitment_priority,updated_at,0 AS idle_days,next_action,next_action_date FROM recruit_candidates WHERE deleted_at IS NULL;
      CREATE VIEW v_recruit_candidates_person_only AS SELECT * FROM v_recruit_candidates WHERE customer_id IS NULL;
      GRANT SELECT,UPDATE ON ALL TABLES IN SCHEMA public TO service_role;
      INSERT INTO persons VALUES(1,'One',null,now()),(2,'Two',null,now());
      INSERT INTO activities VALUES(30,'Demo event',null,now());
      INSERT INTO recruit_candidates VALUES(10,1,null,'新增人才','Unlinked plan',current_date-3,null,now());
      INSERT INTO opportunities(id,person_id,opportunity_type,status,next_action_date) VALUES(20,1,'insurance','发现',current_date-1);
      INSERT INTO actions(id,person_id,title,status,updated_at,due_at) VALUES
        (1,1,'Call','open',now(),now()-interval '1 day'),(2,2,'Call','open',now(),(((now() AT TIME ZONE 'Asia/Shanghai')::date + time '12:00') AT TIME ZONE 'Asia/Shanghai')),
        (3,1,'Undated','open',now(),null),(4,1,'Tomorrow','completed',now(),now()+interval '1 day');`);
    const previous=migration(projection+'.rollback');
    await db.exec(previous.slice(previous.indexOf('CREATE OR REPLACE FUNCTION'),previous.lastIndexOf('COMMIT;')));
    async function call(fn,args) {
      await db.exec('SET ROLE service_role');
      try{return (await db.query('SELECT public.'+fn+' AS result',args)).rows[0].result;}
      finally{await db.exec('RESET ROLE');}
    }
    const list=q=>call('crm_action_center_v1($1,$2)',['tester',q]);
    const cmd=(op,data,user='tester')=>call('crm_action_context_v1($1,$2,$3)',[user,op,data]);
    const pipe=()=>call("crm_opportunity_directory_v1('tester',1,20,'records',null,null,null,null)",[]);
    const preview=data=>cmd('preview',{requestId:randomUUID(),...data});
    const confirm=r=>cmd('confirm',{previewId:r.previewId});
    for(let i=0;i<2;i++){
      await db.exec(migration(center));await db.exec(migration(projection));
      if(i===0){await db.exec(migration(projection+'.rollback'));await db.exec(migration(center+'.rollback'));}
    }
    const ids=res=>res.rows.map(x=>Number(x.id));
    assert.deepEqual(ids(await list({view:'overdue'})),[1]);
    assert.deepEqual(ids(await list({view:'completed'})),[4]);
    assert.deepEqual(ids(await list({view:'waiting'})),[]);
    assert.deepEqual(ids(await list({view:'today'})),[2]);
    assert.ok(ids(await list({view:'week'})).includes(2));
    const candidate={kind:'candidate',targetId:10};
    const link={operation:'link',...candidate,actionId:1};
    await assert.rejects(preview({...link,actionId:2}),/mismatch/);
    const a=await preview(link);
    assert.deepEqual(ids(await list({view:'linked',...candidate})),[]);
    await assert.rejects(cmd('confirm',{previewId:a.previewId},'wrong'));
    await confirm(a); assert.equal((await confirm(a)).replayed,true);
    assert.deepEqual(ids(await list({view:'linked',...candidate})),[1]);
    await assert.rejects(preview(link),/already linked/);
    for(const [kind,targetId] of [['opportunity',20],['activity',30]]) await confirm(await preview({operation:'link',kind,targetId,actionId:1}));
    assert.equal((await pipe()).rows.every(r=>Number(r.action_id)===1),true);
    const wait=await preview({operation:'wait',actionId:1,waitingFor:'Client response'});
    const stale=await preview({operation:'wait',actionId:1,waitingFor:'Other'});
    await confirm(wait);assert.deepEqual(ids(await list({view:'waiting'})),[1]);await assert.rejects(confirm(stale),/changed/);
    const expired=await preview({operation:'resume',actionId:1});
    await db.query("UPDATE crm_action_context_commands SET expires_at=now()-interval '1 hour' WHERE id=$1",[expired.previewId]);
    await assert.rejects(confirm(expired),/expired/);
    await confirm(await preview({operation:'resume',actionId:1}));
    assert.equal((await list({view:'waiting'})).total,0);
    await db.exec("UPDATE actions SET status='completed',completed_at=now(),updated_at=now() WHERE id=1");
    assert.deepEqual(ids(await list({view:'overdue'})),[]);
    assert.equal((await pipe()).rows.every(r=>r.next_date===null),true);
    assert.equal((await db.query('SELECT next_action_date FROM v_recruit_action_directory')).rows[0].next_action_date,null);
    assert.ok((await db.query('SELECT next_action_date FROM recruit_candidates')).rows[0].next_action_date);
    await db.exec("UPDATE actions SET status='open',updated_at=now() WHERE id=1");assert.deepEqual(ids(await list({view:'overdue'})),[1]);
    await db.exec('UPDATE recruit_candidates SET deleted_at=current_date WHERE id=10');
    await assert.rejects(list({view:'linked',...candidate}));
    await db.exec('UPDATE recruit_candidates SET deleted_at=null WHERE id=10');assert.deepEqual(ids(await list({view:'linked',...candidate})),[1]);
    await db.exec(migration(projection+'.rollback'));
    await assert.rejects(db.exec(migration(center+'.rollback')),/Confirmed links/);await db.exec('ROLLBACK');
    console.log('PASS center and pipeline SQL, explicit links only, wait/resume, actor, replay, expiration, close/reopen, soft delete and rollback');
  } finally{await db.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
