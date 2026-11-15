'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const assistant=require('../../cloudfunctions/assistant');
const dispatcher=require('../../cloudfunctions/assistant/education-backfill-dispatch');
const {createEducationBackfill}=require('../../cloudfunctions/assistant/education-backfill-service');

test('Assistant authenticates before the new action and defaults to disabled without querying data',async()=>{
  const saved=process.env.EDUCATION_BACKFILL_ENABLED;
  try{
    delete process.env.EDUCATION_BACKFILL_ENABLED;
    const event={action:'educationBackfill',operation:'batches',data:{}};
    assert.equal((await assistant.createMain(()=>({uid:'real',isAnonymous:false}))(event)).error.code,'EDUCATION_NOT_ENABLED');
    process.env.EDUCATION_BACKFILL_ENABLED='true';
    for(const identity of [{uid:'x',isAnonymous:true},{uid:''},null]){
      assert.equal((await assistant.createMain(()=>identity)(event)).error.code,'UNAUTHORIZED');
    }
  }finally{if(saved===undefined)delete process.env.EDUCATION_BACKFILL_ENABLED;else process.env.EDUCATION_BACKFILL_ENABLED=saved;}
});

test('Assistant dispatches only declared education fields under the server-authenticated actor',async()=>{
  const saved=process.env.EDUCATION_BACKFILL_ENABLED,original=dispatcher.dispatchEducationBackfill;
  const calls=[];
  try{
    process.env.EDUCATION_BACKFILL_ENABLED='true';
    dispatcher.dispatchEducationBackfill=(event,identity)=>original(event,identity,()=>createEducationBackfill({
      rpc:async(actor,op,data)=>{calls.push({actor,op,data});return{batches:[]};},
    }));
    const main=assistant.createMain(()=>({uid:'verified-actor',isAnonymous:false}));
    assert.equal((await main({action:'educationBackfill',operation:'batches',data:{}})).ok,true);
    assert.equal(calls[0].actor,'verified-actor');
    const forged=await main({action:'educationBackfill',operation:'batches',data:{actorUid:'forged'}});
    assert.equal(forged.error.code,'EDUCATION_INVALID_INPUT');assert.equal(calls.length,1);
    const worker=await main({action:'educationBackfill',operation:'claim',data:{}});
    assert.equal(worker.error.code,'EDUCATION_INVALID_INPUT');assert.equal(calls.length,1);
  }finally{
    dispatcher.dispatchEducationBackfill=original;
    if(saved===undefined)delete process.env.EDUCATION_BACKFILL_ENABLED;else process.env.EDUCATION_BACKFILL_ENABLED=saved;
  }
});

test('dedicated timer entrance requires its enabled flag and secret, preserving the shared device runtime',async()=>{
  const saved=process.env.EDUCATION_BACKFILL_ENABLED,savedSecret=process.env.EDUCATION_BACKFILL_TRIGGER_SECRET;
  const original=dispatcher.dispatchEducationTimer;let calls=0;
  try{
    process.env.EDUCATION_BACKFILL_ENABLED='true';process.env.EDUCATION_BACKFILL_TRIGGER_SECRET='x'.repeat(48);
    dispatcher.dispatchEducationTimer=async()=>{calls++;return{handled:true,processed:1};};
    const result=await assistant.main({Type:'Timer',TriggerName:'educationBackfillWorker',Message:'x'.repeat(48)});
    assert.equal(result.handled,true);assert.equal(calls,1);
    assert.deepEqual(await original({Type:'Timer',TriggerName:'knowledgeOcrWorker',Message:'x'.repeat(48)},'x'.repeat(48)),{handled:false});
    assert.deepEqual(await original({Type:'Timer',TriggerName:'educationBackfillWorker',Message:'z'.repeat(48)},'x'.repeat(48)),{handled:false});
  }finally{
    dispatcher.dispatchEducationTimer=original;
    if(saved===undefined)delete process.env.EDUCATION_BACKFILL_ENABLED;else process.env.EDUCATION_BACKFILL_ENABLED=saved;
    if(savedSecret===undefined)delete process.env.EDUCATION_BACKFILL_TRIGGER_SECRET;else process.env.EDUCATION_BACKFILL_TRIGGER_SECRET=savedSecret;
  }
});

test('route and More link point to the module, and every new literal translation has Chinese and English',async()=>{
  const root=path.resolve(__dirname,'../..');
  const router=fs.readFileSync(path.join(root,'crm/js/modules/console/router.js'),'utf8');
  const more=fs.readFileSync(path.join(root,'crm/js/modules/console/pages/misc.js'),'utf8');
  const source=fs.readFileSync(path.join(root,'crm/js/modules/console/education-backfill.js'),'utf8');
  assert.match(router,/\['#\/people-education', renderEducationBackfill\]/);
  assert.match(more,/key: 'edu_title', descKey: 'edu_intro', hash: '#\/people-education'/);
  const saved=global.document;
  global.document={querySelectorAll:()=>[]};
  try{
    const i18n=await import(pathToFileURL(path.join(root,'crm/js/modules/console/i18n.js')).href);
    const keys=[...new Set([...source.matchAll(/['"](edu_[a-z_]+)['"]/g)].map(m=>m[1]).filter(k=>k!=='edu_status_'))];
    for(const lang of ['zh-CN','en']){
      i18n.setLang(lang);
      for(const key of keys)assert.notEqual(i18n.t(key),key,`${lang} missing ${key}`);
    }
  }finally{if(saved===undefined)delete global.document;else global.document=saved;}
});
