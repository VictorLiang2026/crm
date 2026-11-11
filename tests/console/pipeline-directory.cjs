// Run using an isolated PGlite installation: node pipeline-directory.cjs <absolute module path>.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {PGlite} = require(process.argv[2]);
const base = path.resolve(__dirname,'../../cloudbase/migrations/20261111090000_pipeline_directory');
const commands = path.resolve(__dirname,'../../cloudbase/migrations/20261111085000_pipeline_decisions');
const read = file => fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
(async()=>{
  const db=new PGlite();
  try {
    await db.exec(`CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE persons(id bigint PRIMARY KEY,display_name text,deleted_at date,updated_at timestamptz);
      CREATE TABLE customers("Id" bigint,person_id bigint,deleted_at date);
      CREATE TABLE opportunities(id bigint PRIMARY KEY,person_id bigint,customer_id bigint,opportunity_type text,status text,next_action text,
        next_action_date date,updated_at timestamptz,deleted_at date,discovered_at date,last_progress text,ai_summary text,referred_name text,referred_relation text,created_at timestamptz);
      CREATE TABLE recruit_candidates(id bigint PRIMARY KEY,person_id bigint,customer_id bigint,stage text,next_action text,next_action_date date,updated_at timestamptz,deleted_at date);
      CREATE TABLE outcomes(opportunity_id bigint,outcome_type text,result text,occurred_at timestamptz);
      CREATE TABLE crm_test_records(record_table text,record_id text,batch_key text);
      CREATE TABLE crm_test_batches(created_by_uid text,batch_key text);
      CREATE TABLE actions(id bigint,person_id bigint,opportunity_id bigint,title text,status text,due_at timestamptz);
      CREATE TABLE crm_opportunity_action_links(opportunity_id bigint,action_id bigint,person_id bigint);
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
      GRANT UPDATE ON persons,opportunities,recruit_candidates TO service_role;
      GRANT INSERT ON outcomes TO service_role;
      INSERT INTO persons VALUES (1,'Demo',null),(2,'Removed',current_date);
      INSERT INTO opportunities(id,person_id,opportunity_type,status,next_action_date) VALUES
        (10,1,'insurance','发现',current_date+5),(20,1,'转介绍','已介绍',null),(30,1,'insurance','成交',current_date-1);
      INSERT INTO recruit_candidates(id,person_id,stage,next_action_date) VALUES(10,1,'互动暖客',current_date-1),(20,2,'新增人才',current_date);
      INSERT INTO actions VALUES(1,1,null,'Confirmed action','open',now()-interval '1 day');
      INSERT INTO crm_opportunity_action_links VALUES(10,1,1);`);
    const undo=read(base+'.rollback.sql');
    await db.exec(undo.slice(undo.indexOf('CREATE OR REPLACE FUNCTION'),undo.lastIndexOf('COMMIT;')));
    const query=async(kind,status=null,page=1,size=20)=>{
      await db.exec('SET ROLE service_role');
      try {return (await db.query("SELECT public.crm_opportunity_directory_v1('fixture',$1,$2,$3,$4,null,null,null) AS v",[page,size,kind,status])).rows[0].v;}
      finally {await db.exec('RESET ROLE');}
    };
    const previous=await query('all');
    await db.exec(read(commands+'.sql'));
    await db.exec(read(base+'.sql'));
    await db.exec(undo);
    await db.exec(read(commands+'.rollback.sql'));
    assert.deepEqual(await query('all'),previous);
    await db.exec(read(commands+'.sql'));
    await db.exec(read(base+'.sql'));
    assert.deepEqual(await query('all'),previous);
    assert.equal((await query('protection','需求线索')).total,1);
    assert.equal((await query('protection','terminal')).total,1);
    assert.equal((await query('records')).total,4);
    const due=(await query('due')).rows;
    assert.deepEqual(due.map(r=>r.entity).sort(),['candidate','opportunity']);
    assert.equal(due.find(r=>r.entity==='opportunity').next_action,'Confirmed action');
    assert.equal((await query('recruitment','review')).rows[0].raw_stage,'互动暖客');
    assert.equal((await query('records','review')).rows.filter(r=>r.record_type==='转介绍')[0].track,'review');
    const pages=[];
    for(let p=1;p<=2;p++) pages.push(...(await query('records',null,p,2)).rows);
    assert.equal(new Set(pages.map(r=>r.entity+':'+r.id)).size,4);
    await db.exec('UPDATE recruit_candidates SET deleted_at=current_date WHERE id=10');
    assert.equal((await query('recruitment')).total,0);
    await db.exec('UPDATE recruit_candidates SET deleted_at=null WHERE id=10');
    assert.equal((await query('recruitment')).total,1);
    const cmd=async(op,input,actor='actor')=>{
      await db.exec('SET ROLE service_role');
      try{return (await db.query('SELECT public.crm_pipeline_stage_v1($1,$2,$3) AS v',[actor,op,JSON.stringify(input)])).rows[0].v;}
      finally{await db.exec('RESET ROLE');}
    };
    const target={personId:1,recordId:10,track:'recruitment'};
    const draft=(stage,reason='')=>({...target,stage,reason,source:'referral',requestId:require('node:crypto').randomUUID()});
    for(const [track,stages] of [
      ['protection',['需求线索','需求已核实','保障分析','方案沟通','等待决定','已成交','暂缓','未达成']],
      ['recruitment',['关系建立','兴趣了解','双向评估','职业沟通','决策跟进','已加入','继续培养','暂不推进']]
    ]) for(const stage of stages) {
      assert.equal((await cmd('preview',{...draft(stage,'fixture'),track})).preview.stage,stage);
    }
    const expired=await cmd('preview',draft('关系建立'));
    await db.query("UPDATE crm_pipeline_decisions SET expires_at=now()-interval '1 day' WHERE id=$1",[expired.previewId]);
    await assert.rejects(cmd('confirm',{previewId:expired.previewId}),/expired/);
    await db.exec("INSERT INTO crm_test_batches VALUES('test-actor','fixture-batch')");
    await assert.rejects(cmd('preview',draft('兴趣了解'),'test-actor'),/tracked target/);
    const input=draft('职业沟通');
    const preview=await cmd('preview',input);
    assert.equal((await cmd('preview',input)).previewId,preview.previewId);
    await assert.rejects(cmd('preview',{...input,stage:'决策跟进'}),/Request ID reused/);
    assert.equal((await cmd('state',target)).stage,'互动暖客');
    const stale=await cmd('preview',draft('双向评估'));
    await assert.rejects(cmd('confirm',{previewId:preview.previewId},'other'));
    await assert.rejects(cmd('preview',draft('已加入')));
    await assert.rejects(cmd('preview',draft('已成交','test')));
    await cmd('confirm',{previewId:preview.previewId});
    assert.equal((await cmd('confirm',{previewId:preview.previewId})).replayed,true);
    await assert.rejects(cmd('confirm',{previewId:stale.previewId}),/changed/);
    assert.equal((await cmd('state',target)).stage,'职业沟通');
    assert.equal((await query('recruitment','职业沟通')).rows[0].declared_source,'referral');
    const closed=await cmd('preview',draft('继续培养','稍后跟进'));
    await cmd('confirm',{previewId:closed.previewId});
    assert.equal((await query('due')).rows.filter(r=>r.track==='recruitment').length,0);
    assert.equal((await db.query('select stage from recruit_candidates where id=10')).rows[0].stage,'互动暖客');
    const sale=await cmd('preview',{...draft('已成交','确认结果'),track:'protection'});
    await cmd('confirm',{previewId:sale.previewId});
    await cmd('confirm',{previewId:sale.previewId});
    assert.equal((await db.query('select count(*)::int as n from outcomes')).rows[0].n,1);
    assert.equal((await query('protection','已成交')).total,2);
    assert.equal((await query('due')).total,0);
    await assert.rejects(cmd('preview',{...draft('关系建立'),personId:2}));
    const removed=await cmd('preview',draft('关系建立'));
    await db.exec('UPDATE recruit_candidates SET deleted_at=current_date WHERE id=10');
    await assert.rejects(cmd('confirm',{previewId:removed.previewId}));
    await db.exec('UPDATE recruit_candidates SET deleted_at=null WHERE id=10');
    assert.equal((await cmd('state',target)).stage,'继续培养');
    await db.exec(undo);
    assert.equal((await query('all')).total,previous.total);
    await assert.rejects(query('due'),/Invalid Opportunity directory query/);
    await assert.rejects(db.exec(read(commands+'.rollback.sql')),/Confirmed pipeline history/);
    await db.exec('ROLLBACK');
    console.log('PASS pipeline directory, prior contract, rollback, explicit action links, due dates, paging, archive and restore');
  } finally {await db.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
