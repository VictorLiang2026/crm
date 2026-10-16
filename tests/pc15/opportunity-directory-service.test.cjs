'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {OpportunityWorkflowService}=require('../../cloudfunctions/person_360/opportunity-workflow-service');

const id='11111111-1111-4111-8111-111111111111';

test('directory RPC binds the actor and validates server-side filters and paging',async()=>{
  const calls=[];
  const service=new OpportunityWorkflowService({request:async()=>[],rpc:async(name,args)=>{
    calls.push({name,args});return {rows:[],page:args.p_page,pageSize:args.p_page_size,total:0,hasMore:false};
  }});
  await service.directory({page:3,pageSize:20,kind:'person',status:'terminal',type:'insurance',personId:'71',query:'虚构体验'},'actor-test');
  assert.deepEqual(calls[0],{name:'crm_opportunity_directory_v1',args:{
    p_actor_uid:'actor-test',p_page:3,p_page_size:20,p_kind:'person',p_status:'terminal',
    p_type:'insurance',p_person_id:71,p_query:'虚构体验',
  }});
  for(const input of [
    {page:0},{pageSize:51},{kind:'anything'},{status:'not-a-stage'},{personId:'0'},
    {query:'x'.repeat(121)},{unexpected:true},
  ]) await assert.rejects(service.directory(input,'actor-test'));
  await assert.rejects(service.directory({},''),/Invalid Opportunity directory query/);
  assert.equal(calls.length,1);
});

test('Person-only details are read-only and include Action and Outcome history',async()=>{
  const calls=[];
  const service=new OpportunityWorkflowService({
    async request(table,method,filters){calls.push({table,method,filters});
      if(table==='opportunities')return [{id:9,person_id:71,customer_id:null,status:'成交',opportunity_type:'insurance'}];
      if(table==='persons')return [{id:71,display_name:'【系统测试·勿联系】虚构体验甲'}];
      if(table==='actions')return filters.id?.startsWith('in.')?
        [{id:8,person_id:71,opportunity_id:null,title:'【系统测试·勿联系】关联虚构行动',status:'open'}]:
        [{id:7,person_id:71,opportunity_id:9,title:'【系统测试·勿联系】虚构回访',status:'completed'}];
      if(table==='crm_opportunity_action_links')return [{action_id:8}];
      if(table==='outcomes')return [{id:2,opportunity_id:9,action_id:7,result:'【系统测试·勿联系】虚构结果'}];
      return [];
    },async rpc(){throw new Error('details must remain read-only');},
    disclosure:async()=>({status:'verified',containsTestData:true,recordCount:1,sources:[]}),
  });
  const result=await service.details(9,'actor-test');
  assert.equal(result.opportunity.person.display_name,'【系统测试·勿联系】虚构体验甲');
  assert.equal(result.actions.length,2);
  assert.equal(result.outcomes[0].action_id,7);
  assert.equal(calls.some(call=>call.method!=='GET'),false);
});

test('legacy customer details preserve existing read access without test-record filtering',async()=>{
  const calls=[];
  const service=new OpportunityWorkflowService({
    async request(table,method,filters){calls.push({table,method,filters});
      if(table==='opportunities')return [{id:9,person_id:null,customer_id:88,status:'沟通'}];
      if(table==='customers')return [{Id:88,person_id:71}];
      if(table==='persons')return [{id:71,display_name:'Legacy Person'}];
      if(table==='actions')return [{id:12,person_id:71,opportunity_id:9,title:'Legacy Action',status:'open'}];
      if(table==='outcomes')return [{id:14,opportunity_id:9,result:'Legacy Outcome'}];
      if(table==='crm_test_batches')return [{batch_key:'crm_test_pc15'}];
      if(table==='crm_test_records')return [];
      return [];
    },async rpc(){throw new Error('unexpected RPC');},
  });
  const result=await service.details(9,'actor-test');
  assert.equal(result.opportunity.person.display_name,'Legacy Person');
  assert.equal(result.actions[0].id,12);
  assert.equal(result.outcomes[0].id,14);
  assert.equal(calls.some(call=>call.table==='crm_test_batches'||call.table==='crm_test_records'),false);
  assert.equal(calls.some(call=>call.method!=='GET'),false);
});

test('directory migration has paired rollback and protects the old funnel/view contract',()=>{
  const fs=require('node:fs');const path=require('node:path');
  const base=path.join(__dirname,'../../cloudbase/migrations/20261016123000_opportunity_directory');
  const sql=fs.readFileSync(base+'.sql','utf8');
  const rollback=fs.readFileSync(base+'.rollback.sql','utf8');
  for(const fragment of ['public.crm_opportunity_directory_v1','public.opportunities','public.persons',
    'public.customers','LIMIT p_page_size+1',
    'countsByStatus','TO service_role'])assert.ok(sql.includes(fragment),fragment);
  assert.doesNotMatch(sql,/DROP\s+VIEW|ALTER\s+TABLE|UPDATE\s+public\.opportunities|DELETE\s+FROM/i);
  assert.match(rollback,/DROP FUNCTION public\.crm_opportunity_directory_v1/);
  const replacement=fs.readFileSync(path.join(__dirname,'../../cloudbase/migrations/20261016130000_opportunity_directory_read_scope.sql'),'utf8');
  const replacementRollback=fs.readFileSync(path.join(__dirname,'../../cloudbase/migrations/20261016130000_opportunity_directory_read_scope.rollback.sql'),'utf8');
  assert.doesNotMatch(replacement,/crm_test_batches|crm_test_records/);
  assert.match(replacementRollback,/crm_test_batches/);
  assert.match(replacement,/NOTIFY pgrst, 'reload schema'/);
});
