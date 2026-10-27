'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'../..');

test('both CloudBase Web app entrypoints allow AI requests to complete before timeout',()=>{
  for(const file of ['admin.html','crm/js/modules/console/app.js']){
    const source=fs.readFileSync(path.join(root,file),'utf8');
    assert.match(source,/cloudbase\.init\(\{\s*env:\s*CONFIG\.envId,\s*timeout:\s*120000\s*\}\)/,file);
  }
});

test('dual recommendation model timeout remains below the Assistant function limit',()=>{
  const service=fs.readFileSync(path.join(root,'cloudfunctions/assistant/knowledge-library-service.js'),'utf8');
  const config=JSON.parse(fs.readFileSync(path.join(root,'cloudbaserc.json'),'utf8'));
  const assistant=config.functions.find(item=>item.name==='assistant');
  assert.match(service,/createAIGateway\(\{app:client,rdb:database\.auditRdb,timeoutMs:80000,maxAttempts:1/);
  assert.ok(assistant && assistant.timeout*1000>80000);
});
