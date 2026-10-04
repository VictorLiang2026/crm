'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkItemService } = require('../../cloudfunctions/person_360/work-item-service');

const key = 'cfdfd9ed-173c-45e0-9f1a-0cefd46da9fe';
const previewId = 'a4825230-1d16-408f-9823-c49e99152d79';
const marked = '【系统测试·勿联系】虚构体验甲';
const summary = {status:'verified',containsTestData:true,recordCount:2,sources:[
  {batchKey:'crm_test_main_v1',table:'actions',count:1},
  {batchKey:'crm_test_main_v1',table:'commitments',count:1},
]};
function fixture() {
  const calls=[];
  const request=async (table,method,filters) => {
    calls.push({table,method,filters});
    assert.equal(method,'GET');
    if (table==='persons') return [{id:783,display_name:marked,deleted_at:null}];
    if (filters.status==='in.(completed,cancelled)') return [];
    if (table==='actions') return [{id:7,person_id:783,title:`${marked}整理反馈`,
      status:'open',source:'ai_quick_capture_v2',due_at:null,updated_at:'2026-10-04T06:00:00Z'}];
    if (table==='commitments') return [{id:1,person_id:783,content:`${marked}核对材料`,
      status:'open',source:'ai_quick_capture_v2',due_at:null,updated_at:'2026-10-04T06:00:00Z'}];
    throw Error('Unexpected table');
  };
  const rpc=async (name,body) => {
    calls.push({name,body});
    return name==='crm_work_item_preview_v1' ? {previewId,status:'preview'} :
      {kind:'action',itemId:7,replayed:false};
  };
  return {service:new WorkItemService({request,rpc,disclosure:async()=>summary}),calls};
}

test('manual Action and Commitment are read from one canonical Person with source disclosure',async()=>{
  const f=fixture();
  const person=await f.service.listForPerson(783);
  const today=await f.service.listForToday();
  assert.deepEqual(person.rows.map(row=>`${row.kind}:${row.id}`),['action:7','commitment:1']);
  assert.deepEqual(today.rows.map(row=>`${row.kind}:${row.id}`),['action:7','commitment:1']);
  assert.equal(today.rows[0].person_name,marked);
  assert.equal(today.testData.containsTestData,true);
  assert.ok(f.calls.some(call=>call.table==='actions' &&
    call.filters.status==='in.(open,in_progress)' &&
    call.filters.order==='due_at.asc.nullslast,id.desc'));
  assert.ok(f.calls.every(call=>!call.table || call.method==='GET'));
});

test('preview binds actor, Person, kind and exact draft; no business write precedes execute',async()=>{
  const f=fixture();
  const response=await f.service.preview({idempotencyKey:key,kind:'action',operation:'edit',
    personId:783,itemId:7,draft:{title:`${marked}整理反馈`,description:'',
      dueAt:'2026-10-05T10:00:00+08:00',priority:'high'}},'prtest-uid');
  assert.equal(response.previewId,previewId);
  const call=f.calls.find(row=>row.name==='crm_work_item_preview_v1');
  assert.equal(call.body.p_actor_uid,'prtest-uid');
  assert.equal(call.body.p_item_id,7);
  assert.equal(call.body.p_payload.dueAt,'2026-10-05T02:00:00.000Z');
  assert.equal(f.calls.some(row=>row.name==='crm_work_item_execute_v1'),false);
});

test('transition and forged references are rejected before RPC; execute requires a receipt',async()=>{
  const f=fixture();
  await assert.rejects(f.service.preview({idempotencyKey:key,kind:'action',operation:'complete',
    personId:783,itemId:7,draft:{title:'forged'}},'prtest-uid'),/transition/);
  await assert.rejects(f.service.preview({idempotencyKey:key,kind:'commitment',operation:'create',
    personId:0,draft:{content:marked,commitmentType:'MUTUAL'}},'prtest-uid'),/ID/);
  await assert.rejects(f.service.execute('7','prtest-uid'),/execution/);
  assert.equal(f.calls.length,0);
  await f.service.execute(previewId,'prtest-uid');
  assert.deepEqual(f.calls[0],{name:'crm_work_item_execute_v1',
    body:{p_actor_uid:'prtest-uid',p_preview_id:previewId}});
});

test('Today retains an older overdue Action when recent closed history exceeds the window',async()=>{
  const seen=[];
  const old={id:88,person_id:783,title:`${marked}逾期行动`,status:'open',
    due_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T00:00:00Z'};
  const recent=Array.from({length:10},(_,index)=>({id:100+index,person_id:783,
    title:`${marked}已完成${index}`,status:'completed',
    updated_at:'2026-10-04T06:00:00Z'}));
  const service=new WorkItemService({request:async(table,method,filters)=>{
    seen.push({table,filters});
    if(table==='persons') return [{id:783,display_name:marked,deleted_at:null}];
    if(table==='commitments') return [];
    return filters.status==='in.(open,in_progress)' ? [old] : recent;
  },rpc:async()=>{throw Error('No write expected')},disclosure:async()=>summary});
  const today=await service.listForToday();
  assert.ok(today.rows.some(row=>row.kind==='action'&&row.id===88&&row.status==='open'));
  assert.equal(today.hasMore,true);
  assert.ok(seen.some(call=>call.table==='actions'&&
    call.filters.order==='due_at.asc.nullslast,id.desc'&&call.filters.limit===50));
});
