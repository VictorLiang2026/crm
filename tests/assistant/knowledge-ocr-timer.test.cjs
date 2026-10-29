'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMain}=require('../../cloudfunctions/assistant');
const {createKnowledgeLibrary}=require('../../cloudfunctions/assistant/knowledge-library-service');

test('OCR timer requires the exact private trigger secret and routes only the internal queue',async()=>{
  const original=process.env.KNOWLEDGE_OCR_TRIGGER_SECRET;
  process.env.KNOWLEDGE_OCR_TRIGGER_SECRET='fixture-only-secret-with-at-least-32-chars';
  let identityCalls=0,queueCalls=0,queueArgs=null;
  const deps=Array(13).fill(undefined);
  deps.push(async(...args)=>{queueCalls++;queueArgs=args;return {ok:true,processed:false};});
  const main=createMain(async()=>{identityCalls++;throw Error('unauthorized fixture');},...deps);
  const valid={Type:'Timer',TriggerName:'knowledgeOcrWorker',Message:process.env.KNOWLEDGE_OCR_TRIGGER_SECRET};
  assert.deepEqual(await main(valid),{ok:true,processed:false});
  assert.equal(identityCalls,0);assert.equal(queueCalls,1);
  assert.equal(queueArgs[0].operation,'processOcrQueue');
  assert.equal(queueArgs[2].internalOcrQueue,true);
  const forged=await main({...valid,Message:'wrong-secret'});
  assert.equal(forged.error.code,'UNAUTHORIZED');
  assert.equal(identityCalls,1);assert.equal(queueCalls,1);
  if(original===undefined)delete process.env.KNOWLEDGE_OCR_TRIGGER_SECRET;
  else process.env.KNOWLEDGE_OCR_TRIGGER_SECRET=original;
});

test('public knowledge operations cannot invoke the internal OCR queue',async()=>{
  const service=createKnowledgeLibrary({env:'crm-test123',key:'server-test-key',client:{callFunction:async()=>({})}});
  await assert.rejects(service.run({operation:'processOcrQueue'},'fictional-user'),error=>error.code==='PERMISSION_DENIED');
});

