'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');

test('ai_parse unwraps only a verified OCR delegation and rejects invalid ticket responses',async()=>{
 const {unwrap}=require(path.join(root,'cloudfunctions/ai_parse/device-internal-delegation'));
 const payload={action:'ocr_knowledge_source',sourceId:'12',uploadId:'123e4567-e89b-42d3-a456-426614174000'};
 let request;
 const app={callFunction:async value=>{request=value;return {result:{verified:true,actor:'member-1',origin:'worker',payload}};}};
 const result=await unwrap(app,{__crmDelegation:{token:'123e4567-e89b-42d3-a456-426614174000',payload}}, {},'ai_parse');
 assert.equal(request.name,'person_360');
 assert.equal(request.data.action,'consumeInternalDelegation');
 assert.equal(request.data.audience,'ai_parse');
 assert.deepEqual(result.event,payload);
 assert.equal(result.context.__crmInternalDelegation.actor,'member-1');
 await assert.rejects(()=>unwrap(app,{extra:true,__crmDelegation:{token:'123e4567-e89b-42d3-a456-426614174000',payload}}, {},'ai_parse'),/DEVICE_ACCESS_DENIED/);
});

test('today_coach accepts only a verified browser morning review delegation',async()=>{
 const {unwrap}=require(path.join(root,'cloudfunctions/today_coach/device-internal-delegation'));
 const payload={action:'daily_review',view:'morning'};
 const event={__crmDelegation:{token:'123e4567-e89b-42d3-a456-426614174000',payload}};
 const app={callFunction:async()=>({result:{verified:true,actor:'member-1',origin:'browser',payload}})};
 const result=await unwrap(app,event,{},'today_coach');
 assert.deepEqual(result.event,payload);
 assert.deepEqual(result.context.__crmInternalDelegation,{actor:'member-1',origin:'browser',audience:'today_coach'});
 const workerApp={callFunction:async()=>({result:{verified:true,actor:'worker',origin:'worker',payload}})};
 await assert.rejects(()=>unwrap(workerApp,event,{},'today_coach'),/DEVICE_ACCESS_DENIED/);
});
