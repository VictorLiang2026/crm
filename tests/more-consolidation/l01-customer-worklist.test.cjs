'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(name, parent, main) {
  if (name === '@cloudbase/node-sdk') return {init: () => ({auth: () => ({getUserInfo: () => ({uid: ''})})})};
  return originalLoad.call(this, name, parent, main);
};
const {createService} = require('../../cloudfunctions/person_360/index.js');
Module._load = originalLoad;

test('L01 filters and sorts the entire customer dataset in the server RPC before pagination', async () => {
  const calls = [];
  const result = {rows:[{id:31,wb_status:'overdue',roles:['customer','recruit']}],total:31,page:2,totalPages:2};
  const svc = createService({rpc:async(name,args)=>{calls.push({name,args});return result;},request:async()=>{throw Error('unexpected enrichment');}});
  assert.equal(await svc.listPeople({roles:['customer'],customerWorklist:true,includeCustomerStage:true,
    worklistStatus:'overdue',sortField:'wb_status',sortDir:'asc',page:2,pageSize:20,customerPriorities:['A','A']}),result);
  assert.deepEqual(calls,[{name:'person_customer_worklist_v1',args:{p_criteria:{
    page:2,pageSize:20,keyword:'',sortField:'wb_status',sortDir:'asc',status:'overdue',customerPriorities:['A'],
  }}}]);
});
test('L01 rejects unsupported scopes, filters and injection without database calls', async () => {
  let calls=0;
  const svc=createService({rpc:async()=>{calls++;return {};}});
  for(const extra of [{roles:[]},{roles:['customer','recruit']},{worklistStatus:'overdue,all'},
    {sortField:'id;delete'},{customerPriorities:['Z']},{recruitPriorities:['A']},{pageSize:51}]){
    await assert.rejects(svc.listPeople({roles:['customer'],customerWorklist:true,...extra}));
  }
  assert.equal(calls,0);
});
test('L01 keeps old directory requests unchanged and fails closed on unavailable worklist RPC', async () => {
  const calls=[];
  const svc=createService({rpc:async(name,args)=>{calls.push({name,args});if(name==='person_customer_worklist_v1')throw Error('Database request failed (404)');return {rows:[]};}});
  await svc.listPeople({});
  assert.equal(calls[0].name,'person_directory_page_v1');
  await assert.rejects(svc.listPeople({roles:['customer'],customerWorklist:true}),/404/);
  assert.equal(calls.length,2);
  await assert.rejects(svc.listPeople({sortField:'wb_status'}),/Invalid directory sort/);
});
