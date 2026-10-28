'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === '@cloudbase/node-sdk') return { init: () => ({}) };
  return originalLoad.call(this, request, parent, isMain);
};
const { createService } = require('../../cloudfunctions/person_360/index.js');
Module._load = originalLoad;

test('updatePerson sends all form domains to the single transaction RPC', async () => {
  const calls=[];
  const service=createService({request:async()=>{throw Error('Form save must not issue table writes');},rpc:async(name,args)=>{calls.push({name,args});return{ok:true,updated:true};}});
  const result=await service.updatePerson({personId:'71',expectedUpdatedAt:'2026-10-15T01:00:00Z',
    personFields:{displayName:'示例',phone:'123',salesPriority:'B'},customerId:'81',customerExpectedUpdatedAt:'2026-10-15T01:01:00Z',
    customerFields:{tags:'标签',annual_income:250,profile:{family:'家庭'}},recruitId:'91',recruitExpectedUpdatedAt:'2026-10-15T01:02:00Z',
    recruitFields:{recruitment_priority:'D'}},'test-uid');
  assert.deepEqual(result,{ok:true,updated:true});assert.equal(calls.length,1);assert.equal(calls[0].name,'crm_person_profile_save_v1');
  assert.deepEqual(calls[0].args,{p_actor_uid:'test-uid',p_person_id:71,p_person_expected_updated_at:'2026-10-15T01:00:00Z',
    p_person_fields:{display_name:'示例',phone:'123',sales_priority:'B'},p_customer_id:81,p_customer_expected_updated_at:'2026-10-15T01:01:00Z',
    p_customer_fields:{tags:'标签',annual_income:250,profile:{family:'家庭'}},p_recruit_id:91,p_recruit_expected_updated_at:'2026-10-15T01:02:00Z',p_recruit_fields:{recruitment_priority:'D'}});
});

test('updatePerson rejects invalid values before the transaction call', async () => {
  let calls=0;const service=createService({rpc:async()=>{calls++;}});
  await assert.rejects(service.updatePerson({personId:'71',expectedUpdatedAt:'2026-10-15T01:00:00Z',personFields:{salesPriority:'Z'}},'test-uid'),/Invalid priority/);
  await assert.rejects(service.updatePerson({personId:'71',expectedUpdatedAt:'2026-10-15T01:00:00Z',customerFields:{annual_income:-2}},'test-uid'),/Invalid annual_income/);
  assert.equal(calls,0);
});
