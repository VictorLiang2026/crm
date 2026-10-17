'use strict';
// PC32: two independent service_role SQL processes contend on the same
// fictional feedback/Outcome idempotency key; all first writes roll back.
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const cliRoot=path.join(process.env.APPDATA,'npm/node_modules/@cloudbase/cli');
const manifest=JSON.parse(fs.readFileSync(path.join(cliRoot,'package.json'),'utf8'));
const cli=path.resolve(cliRoot,typeof manifest.bin==='string'?manifest.bin:manifest.bin.tcb);
if(!cli.startsWith(path.resolve(cliRoot)+path.sep))throw Error('Unexpected CLI entry');
const env='crm-d1gkae8ddc930d151';
const actor='[CRM_TEST_ONLY] PC32 feedback actor';
function run(sql){
  if(/\bpr\.|\bpr_[a-z]/i.test(sql))throw Error('Outside public CRM scope');
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[cli,'db','execute','-e',env,'--role','service_role','--sql',sql,'--json'],
      {cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>200000)child.kill();});
    child.stderr.resume();
    const timer=setTimeout(()=>child.kill(),45000);
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{
      clearTimeout(timer);
      if(code!==0)return reject(Error('Independent SQL process failed (exit '+code+')'));
      try{const result=JSON.parse(output.slice(output.indexOf('{')));if(!result.data)throw Error('No SQL result');resolve(result.data);}
      catch{reject(Error('Invalid independent SQL response'));}
    });
  });
}
function row(data){const item=data.Rows?.[0];return typeof item==='string'?JSON.parse(item):item;}
const cases=[
  {name:'feedback',key:'00000000-0000-4000-8000-000000032905',
    table:'public.ai_result_feedback_events',column:'id',
    call:key=>`public.crm_ai_experience_decide_v1('${actor}','${key}'::uuid,7,'accepted',NULL,NULL)`},
  {name:'outcome',key:'00000000-0000-4000-8000-000000032906',
    table:'public.outcomes',column:'idempotency_key',
    call:key=>`public.crm_ai_experience_outcome_v1('${actor}','${key}'::uuid,'activity',11,7,
      '【系统测试·勿联系】PC32 虚构并发实际结果','2026-10-05T10:00:00+08'::timestamptz,
      '【系统测试·勿联系】已登记虚构活动证据')`},
];
async function wave(spec){
  const marker='crm.pc32:first-write:'+spec.name+':'+spec.key;
  const countSql=`SELECT count(*) FROM ${spec.table} WHERE ${spec.column}='${spec.key}'::uuid`;
  if(Number(row(await run(countSql))?.[0])!==0)throw Error(spec.name+' key occupied');
  const call=spec.call(spec.key);
  const holderSql=`DO $test$ DECLARE v_result jsonb; BEGIN
    BEGIN
      v_result:=${call};
      IF v_result->>'replayed'<>'false' THEN RAISE EXCEPTION 'First request did not write'; END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('${marker}',0));
      PERFORM pg_catalog.pg_sleep(12);
      RAISE EXCEPTION 'PC32 fictional first-write rollback' USING ERRCODE='P32F0';
    EXCEPTION WHEN SQLSTATE 'P32F0' THEN NULL;
    END;
  END $test$;`;
  const contenderSql=`DO $test$ DECLARE v_blocked boolean:=false; BEGIN
    PERFORM pg_catalog.set_config('lock_timeout','500ms',true);
    BEGIN PERFORM ${call};
    EXCEPTION WHEN SQLSTATE '55P03' THEN v_blocked:=true; END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Same-key ${spec.name} contender did not wait'; END IF;
  END $test$;`;
  const holder=run(holderSql);
  const held=holder.then(value=>({ok:true,value}),error=>({ok:false,error}));
  try{
    let observed=false;
    for(let attempt=0;attempt<3&&!observed;attempt++){
      const peek=await run(`SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND objsubid=1 AND classid::bigint=((pg_catalog.hashtextextended('${marker}',0)>>32)&4294967295) AND objid::bigint=(pg_catalog.hashtextextended('${marker}',0)&4294967295)) AS held`);
      const found=row(peek);
      observed=found?.[0]===true||found?.[0]==='true';
    }
    if(!observed)throw Error(spec.name+' first-write lock was not observed');
    const contender=await run(contenderSql);
    const holding=await held;if(!holding.ok)throw holding.error;
    if(Number(row(await run(countSql))?.[0])!==0)throw Error(spec.name+' holder left a row');
    const retrySql=`DO $test$ DECLARE v_result jsonb; BEGIN
      BEGIN
        v_result:=${call};
        IF v_result->>'replayed'<>'false' OR
          (SELECT count(*) FROM ${spec.table} WHERE ${spec.column}='${spec.key}'::uuid)<>1
        THEN RAISE EXCEPTION 'Retry did not create exactly once'; END IF;
        RAISE EXCEPTION 'PC32 fictional retry rollback' USING ERRCODE='P32F0';
      EXCEPTION WHEN SQLSTATE 'P32F0' THEN NULL; END;
      IF EXISTS(SELECT 1 FROM ${spec.table} WHERE ${spec.column}='${spec.key}'::uuid)
      THEN RAISE EXCEPTION 'Retry left a row'; END IF;
    END $test$;`;
    const retry=await run(retrySql);
    if(Number(row(await run(countSql))?.[0])!==0)throw Error(spec.name+' retry left a row');
    return {observedOverlappingFirstWrite:true,lockTimeoutRejectedWithoutWrite:true,
      retryCreatedExactlyOnceThenRolledBack:true,holderExecutionMs:holding.value.ExecutionTimeMs,
      contenderExecutionMs:contender.ExecutionTimeMs,retryExecutionMs:retry.ExecutionTimeMs};
  }finally{await held;}
}
async function main(){
  const fixture=row(await run("SELECT EXISTS(SELECT 1 FROM public.crm_test_records WHERE batch_key='crm_test_main_v1' AND record_table='ai_results' AND record_id='7') AND EXISTS(SELECT 1 FROM public.crm_test_records WHERE batch_key='crm_test_main_v1' AND record_table='activities' AND record_id='11') AND EXISTS(SELECT 1 FROM public.activities WHERE id=11 AND status='reviewed' AND deleted_at IS NULL) AS valid"));
  if(fixture?.[0]!==true&&fixture?.[0]!=='true')throw Error('Registered fictional AI/Activity sources unavailable');
  const feedback=await wave(cases[0]);
  const outcome=await wave(cases[1]);
  const report={environment:env,observedAt:new Date().toISOString(),feedback,outcome,
    registeredFictionalAiResultId:7,registeredFictionalActivityId:11,persistentBusinessWrites:false};
  fs.writeFileSync(path.join(root,'tests/security/.results/pc32-feedback-first-write-concurrency.json'),
    JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
