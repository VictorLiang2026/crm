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
const commandId='ce61aceb-b79b-4798-a9aa-440bde1de6ee';
const actor='2102162853214060545';
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
  const baselineSql=`SELECT (SELECT count(*) FROM public.outcomes WHERE activity_id=11) AS outcomes,
    (SELECT count(*) FROM public.crm_activity_review_commands WHERE activity_id=11) AS commands,
    (SELECT result_json->>'outcomeId' FROM public.crm_activity_review_commands
      WHERE id='${commandId}'::uuid AND actor_uid='${actor}' AND executed_at IS NOT NULL) AS outcome_id`;
  const original=row(await run(baselineSql));
  if(!original||Number(original[0])!==1||Number(original[1])!==1||Number(original[2])!==2)
    throw Error('Registered fictional activity fixture changed');
  const holder=run(fs.readFileSync(path.join(__dirname,'activity-review-concurrency-holder.sql'),'utf8'));
  const held=holder.then(value=>({ok:true,value}),error=>({ok:false,error}));
  try{
    let observed=false;
    for(let attempt=0;attempt<3&&!observed;attempt++){
      const marker='crm.pc32:activity-review:'+commandId;
      const peek=await run(`SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND objsubid=1 AND classid::bigint=((pg_catalog.hashtextextended('${marker}',0)>>32)&4294967295) AND objid::bigint=(pg_catalog.hashtextextended('${marker}',0)&4294967295)) AS held`);
      const found=row(peek);
      observed=found?.[0]===true||found?.[0]==='true';
    }
    if(!observed)throw Error('No overlapping activity command lock observed');
    const contender=await run(fs.readFileSync(path.join(__dirname,'activity-review-concurrency-contender.sql'),'utf8'));
    const holding=await held;if(!holding.ok)throw holding.error;
    const retry=row(await run(`SELECT public.crm_activity_review_execute_v1('${actor}','${commandId}'::uuid) AS result`));
    const result=typeof retry?.[0]==='string'?JSON.parse(retry[0]):retry?.[0];
    if(result?.replayed!==true||result?.businessDataWritten!==false||Number(result?.outcomeId)!==2)
      throw Error('Activity retry did not return original Outcome safely');
    const after=row(await run(baselineSql));
    if(JSON.stringify(after)!==JSON.stringify(original))throw Error('Activity concurrency test changed fixture');
    const report={environment:env,observedAt:new Date().toISOString(),observedOverlappingLock:true,
      lockTimeoutRejectedWithoutWrite:true,existingCommandReplayReturnedOriginalOutcome:true,
      existingFictionalActivityId:11,existingOutcomeId:2,
      holderExecutionMs:holding.value.ExecutionTimeMs,contenderExecutionMs:contender.ExecutionTimeMs,
      persistentBusinessWrites:false};
    fs.writeFileSync(path.join(root,'tests/security/.results/pc32-activity-review-concurrency.json'),
      JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  }finally{await held;}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
