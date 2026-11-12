'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../crm/js/modules/device-access/transport.js'),'utf8')
  .replace("import {createDeviceClient} from './client.js';","const {createDeviceClient}=globalThis.__client;")
  .replace('export async function deviceCall','async function deviceCall')
  .replace('export async function verifyDevice','async function verifyDevice')
  .replace('export function isSiteDeviceAuthorized','function isSiteDeviceAuthorized')
  .replace('export function guardResume','function guardResume')+'\nreturn {deviceCall};';

function harness({firstError='DEVICE_ACCESS_DENIED',retryError=null,finalError=null,
  siteAuthorized=false,name='activities',data={action:'get',id:9}}={}){
  let challenges=0,targetCalls=0,siteChecks=0,redirects=0;
  const sandbox={
    __client:{createDeviceClient:()=>({sign:async(name,data)=>({action:data.action,nonce:++challenges})})},
    URL,
    document:{baseURI:'https://example.test/crm/admin.html',body:{hidden:false}},
    location:{replace:()=>{redirects++;}},
  };
  const api=new Function('globalThis','WeakMap','URL','document','location',source);
  const {deviceCall}=api(sandbox,WeakMap,URL,sandbox.document,sandbox.location);
  const app={callFunction:async({name:target,data:payload})=>{
    if(target==='person_360'){
      if(payload.action==='issueBrowserChallenge')return {result:{challenge:'fixture'}};
      if(payload.__deviceRequest?.action==='verifyBrowserDevice'){
        siteChecks++;
        return {result:siteAuthorized?{ok:true}:{ok:false,error:'DEVICE_ACCESS_DENIED'}};
      }
    }
    targetCalls++;
    const error=targetCalls===1?firstError:targetCalls===2?retryError:finalError;
    return {result:error?{error}:{ok:true}};
  }};
  return {run:()=>deviceCall(app,'crm-test',name,data),stats:()=>({challenges,targetCalls,siteChecks,redirects,hidden:sandbox.document.body.hidden})};
}

async function main(){
  {
    const h=harness();
    assert.deepEqual(await h.run(),{result:{ok:true}});
    assert.deepEqual(h.stats(),{challenges:2,targetCalls:2,siteChecks:0,redirects:0,hidden:false});
  }
  for(const options of [
    {name:'activities',data:{action:'update',id:9}},
    {name:'activity_tasks',data:{action:'get',activity_id:9}},
  ]){
    const h=harness(options);
    await assert.rejects(h.run(),/DEVICE_ACCESS_DENIED/);
    assert.deepEqual(h.stats(),{challenges:3,targetCalls:1,siteChecks:2,redirects:1,hidden:true});
  }
  {
    const h=harness({retryError:'DEVICE_ACCESS_DENIED',siteAuthorized:true});
    assert.deepEqual(await h.run(),{result:{ok:true}});
    assert.deepEqual(h.stats(),{challenges:4,targetCalls:3,siteChecks:1,redirects:0,hidden:false});
  }
  {
    const h=harness({retryError:'DEVICE_ACCESS_DENIED',finalError:'DEVICE_ACCESS_DENIED',siteAuthorized:true});
    await assert.rejects(h.run(),/DEVICE_ACCESS_DENIED/);
    assert.deepEqual(h.stats(),{challenges:4,targetCalls:3,siteChecks:1,redirects:0,hidden:false});
  }
  {
    const h=harness({retryError:'DEVICE_ACCESS_DENIED',finalError:'DEVICE_ACCESS_DENIED'});
    await assert.rejects(h.run(),/DEVICE_ACCESS_DENIED/);
    assert.deepEqual(h.stats(),{challenges:4,targetCalls:2,siteChecks:2,redirects:1,hidden:true});
  }
  console.log('PASS: site-level approval is rechecked before setup redirect; only unapproved devices navigate, and activity detail remains read-only on retry');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
