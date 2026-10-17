'use strict';
// Independent CloudBase CLI processes exercise the existing fictional candidate.
// The holder rolls back, the contender times out, and the final replay is read only.
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
function firstRow(data){const row=data.Rows?.[0];return typeof row==='string'?JSON.parse(row):row;}
async function main(){
  const candidate=await run("SELECT c.id,c.opportunity_id,c.reviewed_by_uid,c.status FROM public.opportunity_candidates c JOIN public.crm_test_records r ON r.record_table='persons' AND r.record_id=c.person_id::text WHERE r.batch_key='crm_test_main_v1' AND c.id=3 AND c.person_id=783 AND c.status='created' AND c.opportunity_id=10");
  const original=firstRow(candidate);
  if(!original||!original[2])throw Error('Registered fictional candidate unavailable');
  const holder=run(fs.readFileSync(path.join(__dirname,'opportunity-concurrency-holder.sql'),'utf8'));
  const held=holder.then(value=>({ok:true,value}),error=>({ok:false,error}));
  let observed=false;
  try{
    for(let attempt=0;attempt<3&&!observed;attempt++){
      const peek=await run("SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND objsubid=1 AND classid::bigint=((pg_catalog.hashtextextended('crm.pc32b:opportunity_candidate:3',0)>>32)&4294967295) AND objid::bigint=(pg_catalog.hashtextextended('crm.pc32b:opportunity_candidate:3',0)&4294967295)) AS held");
      const row=firstRow(peek);
      observed=row?.[0]===true||row?.[0]==='true';
    }
    if(!observed)throw Error('No overlapping candidate lock observed');
    const contender=await run(fs.readFileSync(path.join(__dirname,'opportunity-concurrency-contender.sql'),'utf8'));
    const holding=await held;if(!holding.ok)throw holding.error;
    const retry=await run("SELECT public.opportunity_candidate_v1('execute',reviewed_by_uid,id) AS result FROM public.opportunity_candidates WHERE id=3 AND person_id=783 AND status='created' AND opportunity_id=10");
    const row=firstRow(retry);
    const result=typeof row?.[0]==='string'?JSON.parse(row[0]):row?.[0];
    if(result?.replayed!==true||String(result?.opportunityId)!=='10'||result?.businessDataWritten!==false)
      throw Error('Final replay did not return original Opportunity');
    const report={environment:env,observedAt:new Date().toISOString(),observedOverlappingLock:true,
      lockTimeoutRejectedWithoutWrite:true,retryReturnedOriginalId:true,existingFictionalCandidateId:3,
      originalOpportunityId:10,holderExecutionMs:holding.value.ExecutionTimeMs,
      contenderExecutionMs:contender.ExecutionTimeMs,retryExecutionMs:retry.ExecutionTimeMs,
      persistentBusinessWrites:false};
    fs.writeFileSync(path.join(root,'tests/security/.results/pc32-b-concurrency.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  }finally{await held;}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
