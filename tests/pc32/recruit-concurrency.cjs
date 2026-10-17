'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const cliRoot=path.join(process.env.APPDATA,'npm/node_modules/@cloudbase/cli');
const manifest=JSON.parse(fs.readFileSync(path.join(cliRoot,'package.json'),'utf8'));
const cli=path.resolve(cliRoot,typeof manifest.bin==='string'?manifest.bin:manifest.bin.tcb);
if(!cli.startsWith(path.resolve(cliRoot)+path.sep))throw Error('Unexpected CLI entry');
const env='crm-d1gkae8ddc930d151';
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
async function main(){
  const baseline=await run("SELECT c.stage,c.updated_at,(SELECT count(*) FROM public.recruit_milestones m WHERE m.candidate_id=c.id) AS milestones FROM public.recruit_candidates c JOIN public.crm_test_records r ON r.record_table='recruit_candidates' AND r.record_id=c.id::text WHERE r.batch_key='crm_test_main_v1' AND c.id=19 AND c.person_id=784 AND c.deleted_at IS NULL");
  const original=row(baseline);
  if(!original||original[0]!=='新增人才'||Number(original[2])!==1)throw Error('Registered fictional recruit fixture changed');
  const holder=run(fs.readFileSync(path.join(__dirname,'recruit-concurrency-holder.sql'),'utf8'));
  const held=holder.then(value=>({ok:true,value}),error=>({ok:false,error}));
  let observed=false;
  try{
    for(let attempt=0;attempt<3&&!observed;attempt++){
      const peek=await run("SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND objsubid=1 AND classid::bigint=((pg_catalog.hashtextextended('crm.pc32:recruit:19',0)>>32)&4294967295) AND objid::bigint=(pg_catalog.hashtextextended('crm.pc32:recruit:19',0)&4294967295)) AS held");
      const found=row(peek);
      observed=found?.[0]===true||found?.[0]==='true';
    }
    if(!observed)throw Error('No overlapping recruit row lock observed');
    const contender=await run(fs.readFileSync(path.join(__dirname,'recruit-concurrency-contender.sql'),'utf8'));
    const holding=await held;if(!holding.ok)throw holding.error;
    const retry=await run("SELECT public.crm_recruit_candidate_transition_v1('[CRM_TEST_ONLY] PC32 recruit actor',id,person_id,updated_at,stage,'【系统测试·勿联系】同阶段重试','【系统测试·勿联系】测试') AS result FROM public.recruit_candidates WHERE id=19 AND person_id=784 AND stage='新增人才' AND deleted_at IS NULL");
    const rr=row(retry),result=typeof rr?.[0]==='string'?JSON.parse(rr[0]):rr?.[0];
    if(result?.ok!==true||result?.changed!==false)throw Error('Recruit retry changed stage');
    const after=row(await run("SELECT c.stage,c.updated_at,(SELECT count(*) FROM public.recruit_milestones m WHERE m.candidate_id=c.id) AS milestones FROM public.recruit_candidates c WHERE c.id=19 AND c.person_id=784"));
    if(JSON.stringify(after)!==JSON.stringify(original))throw Error('Recruit concurrency test changed fixture');
    const report={environment:env,observedAt:new Date().toISOString(),observedOverlappingLock:true,
      lockTimeoutRejectedWithoutWrite:true,sameStageRetryDidNotWrite:true,existingFictionalCandidateId:19,
      holderExecutionMs:holding.value.ExecutionTimeMs,contenderExecutionMs:contender.ExecutionTimeMs,
      retryExecutionMs:retry.ExecutionTimeMs,persistentBusinessWrites:false};
    fs.writeFileSync(path.join(root,'tests/security/.results/pc32-recruit-concurrency.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  }finally{await held;}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
