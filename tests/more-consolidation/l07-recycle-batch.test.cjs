'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {RecycleBatchService,selection}=require('../../cloudfunctions/person_360/recycle-batch-service');
const key='12345678-1234-4234-8234-123456789abc';
test('L07 preview admits only 1..20 distinct typed numeric IDs from one recycle list',()=>{
  assert.equal(selection(Array.from({length:20},(_,i)=>({kind:'customer',id:i+1}))).length,20);
  assert.deepEqual(selection([{kind:'recruit',id:1},{kind:'person_recruit',id:2}]),[{kind:'recruit',id:1},{kind:'person_recruit',id:2}]);
  for(const rows of [[],Array.from({length:21},(_,i)=>({kind:'customer',id:i+1})),
    [{kind:'customer',id:'1'}],[{kind:'customer',id:-1}],[{kind:'customer',id:2147483648}],
    [{kind:'person_recruit',id:NaN}],[{kind:'recruit',id:Number.MAX_SAFE_INTEGER+1}],
    [{kind:'customer',id:1,confirmed:true}],[{kind:'person',id:1}],
    [{kind:'recruit',id:1},{kind:'person_recruit',id:1}],
    [{kind:'customer',id:1},{kind:'recruit',id:2}]]) assert.throws(()=>selection(rows),/Invalid/);
});
test('L07 ignores no authority fields: only trusted actor and server preview IDs reach RPC',async()=>{
  const calls=[];const service=new RecycleBatchService({rpc:async(...args)=>{calls.push(args);return{ok:true};}});
  await service.preview({requestKey:key,items:[{kind:'customer',id:1}]},'trusted-actor');
  await service.receipt('get',key,'trusted-actor');await service.receipt('execute',key,'trusted-actor');
  assert.deepEqual(calls.map(x=>x[1].p_operation),['preview','get','execute']);
  assert.ok(calls.every(x=>x[0]==='crm_recycle_batch_v1'&&x[1].p_actor_uid==='trusted-actor'));
  assert.deepEqual(calls[2][1].p_data,{previewId:key});
  for(const payload of [{actorUid:'forged'}, {confirmed:true}, {plans:[]}, {scope:[]}]) {
    assert.throws(()=>service.preview({requestKey:key,items:[{kind:'customer',id:1}],...payload},'trusted-actor'),/Invalid/);
  }
  for(const actor of [null,'',' ',{},'x'.repeat(129)]) assert.throws(()=>service.receipt('execute',key,actor),/Invalid/);
  for(const op of ['delete','restore','getAll']) assert.throws(()=>service.receipt(op,key,'actor'),/Invalid/);
  for(const id of [null,{},'123',key+'x']) assert.throws(()=>service.receipt('execute',id,'actor'),/Invalid/);
  assert.equal(calls.length,3);
});
test('L07 an RPC failure has no alternate legacy write fallback',async()=>{
  let count=0;const service=new RecycleBatchService({rpc:async()=>{count++;throw Error('Preview expired');}});
  await assert.rejects(service.receipt('execute',key,'actor'),/Preview expired/);assert.equal(count,1);
});
