'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../crm/js/modules/device-access/transport.js'),'utf8')
  .replace("import {createDeviceClient} from './client.js';","const {createDeviceClient}=globalThis.__client;")
  .replace('export async function deviceCall','async function deviceCall')
  .replace('export async function verifyDevice','async function verifyDevice')
  .replace('export function guardResume','function guardResume')+'\nreturn {deviceCall};';

function harness({firstError='DEVICE_ACCESS_DENIED',retryError=null,name='activities',data={action:'get',id:9}}={}){
  let challenges=0,activityCalls=0,redirects=0;
  const sandbox={
    __client:{createDeviceClient:()=>({sign:async()=>({nonce:++challenges})})},
    URL,
    document:{baseURI:'https://example.test/crm/admin.html',body:{hidden:false}},
    location:{replace:()=>{redirects++;}},
  };
  const api=new Function('globalThis','WeakMap','URL','document','location',source);
  const {deviceCall}=api(sandbox,WeakMap,URL,sandbox.document,sandbox.location);
  const app={callFunction:async({name:target,data:payload})=>{
    if(target==='person_360')return {result:{challenge:'fixture'}};
    activityCalls++;
    const error=activityCalls===1?firstError:retryError;
    return {result:error?{error}:{ok:true}};
  }};
  return {run:()=>deviceCall(app,'crm-test',name,data),stats:()=>({challenges,activityCalls,redirects,hidden:sandbox.document.body.hidden})};
}

async function main(){
  {
    const h=harness();
    assert.deepEqual(await h.run(),{result:{ok:true}});
    assert.deepEqual(h.stats(),{challenges:2,activityCalls:2,redirects:0,hidden:false});
  }
  for(const options of [
    {name:'activities',data:{action:'update',id:9}},
    {name:'activity_tasks',data:{action:'get',activity_id:9}},
  ]){
    const h=harness(options);
    await assert.rejects(h.run(),/DEVICE_ACCESS_DENIED/);
    assert.deepEqual(h.stats(),{challenges:1,activityCalls:1,redirects:1,hidden:true});
  }
  {
    const h=harness({retryError:'DEVICE_ACCESS_DENIED'});
    await assert.rejects(h.run(),/DEVICE_ACCESS_DENIED/);
    assert.deepEqual(h.stats(),{challenges:2,activityCalls:2,redirects:1,hidden:true});
  }
  console.log('PASS: activity detail refreshes one rejected device proof; writes, other routes, and persistent denials remain blocked');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
