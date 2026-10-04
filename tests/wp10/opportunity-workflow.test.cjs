'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {OpportunityWorkflowService,draft}=require('../../cloudfunctions/person_360/opportunity-workflow-service');
const key='9cc7e895-02e1-4664-9424-3e356cd40bc1';
const receipt='a4825230-1d16-408f-9823-c49e99152d79';
function fixture(){
  const calls=[];
  const service=new OpportunityWorkflowService({
    async request(table,method,filters){calls.push({table,method,filters});
      if(table==='opportunities')return [{id:9,person_id:783,customer_id:null,status:'发现'}];
      if(table==='actions')return [{id:7,person_id:783,opportunity_id:9,title:'【系统测试·勿联系】整理反馈'}];
      if(table==='outcomes')return [{id:1,opportunity_id:9,result:'【系统测试·勿联系】虚构结果'}];
      if(table==='persons')return [{id:783,display_name:'【系统测试·勿联系】虚构体验甲'}];
      return [];},
    async rpc(name,args){calls.push({name,args});return name.endsWith('preview_v1')?
      {previewId:receipt,status:'preview'}:{opportunityId:9,operation:'stage',replayed:false};},
    disclosure:async()=>({status:'verified',containsTestData:false,recordCount:0,sources:[]}),
  });return {service,calls};
}
test('preview binds actor, Person and draft; execute takes only receipt',async()=>{
  const {service,calls}=fixture();
  await service.preview({idempotencyKey:key,operation:'stage',personId:783,
    opportunityId:9,draft:{status:'沟通'}},'prtest-uid');
  assert.deepEqual(calls.find(x=>x.name==='crm_opportunity_preview_v1').args,{
    p_actor_uid:'prtest-uid',p_idempotency_key:key,p_operation:'stage',
    p_person_id:783,p_opportunity_id:9,p_payload:{status:'沟通'}});
  assert.equal(calls.some(x=>x.name==='crm_opportunity_execute_v1'),false);
  await service.execute(receipt,'prtest-uid');
  assert.deepEqual(calls.find(x=>x.name==='crm_opportunity_execute_v1').args,
    {p_actor_uid:'prtest-uid',p_preview_id:receipt});
});
test('forged IDs, fields, stage and missing result fail before RPC',async()=>{
  const {service,calls}=fixture();
  for(const value of [
    {operation:'stage',personId:783,opportunityId:0,draft:{status:'沟通'}},
    {operation:'stage',personId:783,opportunityId:9,draft:{status:'伪造'}},
    {operation:'close',personId:783,opportunityId:9,draft:{status:'关闭',result:'',actionId:null}},
    {operation:'edit',personId:783,opportunityId:9,draft:{type:'insurance',progress:'x',nextAction:'y',nextActionDate:null,customer_id:1}},
  ])await assert.rejects(service.preview({idempotencyKey:key,...value},'uid'));
  await assert.rejects(service.execute('forged','uid'));
  assert.equal(calls.length,0);
  assert.deepEqual(draft('close',{status:'成交',result:'虚构结果',actionId:7}),
    {status:'成交',result:'虚构结果',actionId:7});
});
test('linked Action and Outcome read is scoped to Person-only Opportunity',async()=>{
  const {service,calls}=fixture();const value=await service.linked(783,9);
  assert.equal(value.actions[0].opportunity_id,9);
  assert.equal(value.outcomes[0].opportunity_id,9);
  assert.equal(calls.find(x=>x.table==='opportunities').filters.customer_id,'is.null');
  assert.equal(calls.find(x=>x.table==='opportunities').filters.person_id,'eq.783');
  assert.equal(calls.some(x=>x.method!=='GET'),false);
});
test('test account pending candidates and linked records stay within tracked Person',async()=>{
  const calls=[];
  const service=new OpportunityWorkflowService({
    async request(table,method,filters){calls.push({table,method,filters});
      if(table==='crm_test_batches')return [{batch_key:'crm_test_main_v1'}];
      if(table==='crm_test_records')return filters.record_table==='eq.persons'?
        (filters.record_id==='eq.783'?[{record_id:'783'}]:[]):
        [{record_id:'11'}];
      if(table==='opportunity_candidates')return [{id:11,person_id:783,
        draft:{reason:'【系统测试·勿联系】虚构依据'},evidence:['interactions:5']}];
      if(table==='persons')return [{id:783,display_name:'【系统测试·勿联系】虚构体验甲'}];
      return [];
    },async rpc(){throw new Error('read-only fixture');},
    disclosure:async()=>({status:'verified',containsTestData:true,recordCount:1,sources:[]}),
  });
  const pending=await service.listPending('prtest-uid');
  assert.equal(pending.rows[0].id,11);
  assert.equal(calls.find(x=>x.table==='opportunity_candidates').filters.id,'in.(11)');
  await assert.rejects(service.linked(999,9,'prtest-uid'),/tracked fictional Person/);
  assert.equal(calls.some(x=>x.table==='opportunities'),false);
});
test('migration keeps legacy table/view contract and protects atomic Outcome',()=>{
  const base=path.join(__dirname,'../../cloudbase/migrations/20261004180000_opportunity_commands');
  const sql=fs.readFileSync(base+'.sql','utf8');
  const rollback=fs.readFileSync(base+'.rollback.sql','utf8');
  for(const fragment of ['BEGIN;','CREATE TABLE public.crm_opportunity_commands',
    'FORCE ROW LEVEL SECURITY','TO service_role','p_actor_uid','FOR UPDATE',
    'customer_id IS NULL','INSERT INTO public.outcomes','UPDATE public.actions SET opportunity_id',
    "v_cmd.status='executed'",'v_cmd.result||jsonb_build_object',
    'Test account requires tracked fictional Person'])assert.ok(sql.includes(fragment),fragment);
  assert.ok(!sql.includes('ALTER TABLE public.opportunities'));
  assert.ok(!sql.includes('DROP VIEW'));
  assert.ok(rollback.includes("WHERE status='executed'"));
});
