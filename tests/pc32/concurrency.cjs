/** Real independent CLI processes; no credential extraction, no persistent fixtures. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname,'../..');
const cliRoot = path.join(process.env.APPDATA,'npm/node_modules/@cloudbase/cli');
const manifest = JSON.parse(fs.readFileSync(path.join(cliRoot,'package.json'),'utf8'));
const cli = path.resolve(cliRoot,typeof manifest.bin==='string'?manifest.bin:manifest.bin.tcb);
if (!cli.startsWith(path.resolve(cliRoot)+path.sep)) throw Error('Unexpected CLI entry');
const environment='crm-d1gkae8ddc930d151';
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
function run(sql) {
  if (/\bpr\.|\bpr_[a-z]/i.test(sql)) throw Error('Outside public CRM scope');
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[cli,'db','execute','-e',environment,'--role','service_role','--sql',sql,'--json'],
      {cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>200000)child.kill();});
    child.stderr.resume();
    const timer=setTimeout(()=>child.kill(),45000);
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{
      clearTimeout(timer);
      if(code!==0)return reject(Error('Independent SQL process failed (exit '+code+')'));
      try {const parsed=JSON.parse(output.slice(output.indexOf('{')));if(!parsed.data)throw Error('No SQL result');resolve(parsed.data);}
      catch {reject(Error('Invalid independent SQL response'));}
    });
  });
}
async function main(){
  const holder=run(read('concurrency-holder.sql'));
  // Keep a handler attached even if observing the lock fails first.
  const heldResult=holder.then(value=>({ok:true,value}),error=>({ok:false,error}));
  let observed=false;
  try {
    for(let attempt=0;attempt<2&&!observed;attempt++){
      const peek=await run("SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND objsubid=1 AND classid::bigint=((pg_catalog.hashtextextended('crm.learning:00000000-0000-4000-8000-000000032099',0)>>32)&4294967295) AND objid::bigint=(pg_catalog.hashtextextended('crm.learning:00000000-0000-4000-8000-000000032099',0)&4294967295)) AS held");
      const row=typeof peek.Rows?.[0]==='string'?JSON.parse(peek.Rows[0]):peek.Rows?.[0];
      observed=row?.[0]===true||row?.[0]==='true';
    }
    if(!observed)throw Error('No overlapping advisory lock observed; not verified');
    const contender=await run(read('concurrency-contender.sql'));
    const holding=await heldResult;if(!holding.ok)throw holding.error;
    // After the competing transaction releases its lock, exercise full create,
    // same-ID replay, changed-request rejection and rollback with this same key.
    const retry=await run(read('learning-transaction.sql').replaceAll('000000032001','000000032099'));
    const report={environment,observedAt:new Date().toISOString(),observedOverlappingLock:true,
      lockTimeoutRejectedWithoutWrite:true,retryAndFullTransactionPassed:true,
      holderExecutionMs:holding.value.ExecutionTimeMs,contenderExecutionMs:contender.ExecutionTimeMs,
      retryExecutionMs:retry.ExecutionTimeMs,persistentBusinessWrites:false};
    fs.writeFileSync(path.join(root,'tests/security/.results/pc32-concurrency.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  }finally{await heldResult;}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
