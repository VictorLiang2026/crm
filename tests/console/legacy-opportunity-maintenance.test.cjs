const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {LegacyOpportunityMaintenanceService,normalizeMaintenance}=
  require('../../cloudfunctions/person_360/legacy-opportunity-service');

test('terminal correction rejects active status and unsafe fields',()=>{
  const base={idempotencyKey:randomUUID(),operation:'terminal_edit',customerId:'12',opportunityId:'34',
    draft:{type:'医疗保障',status:'成交',progress:'修订',nextAction:'联系',nextActionDate:null,
      discoveredAt:null,referredName:'',referredRelation:''}};
  assert.equal(normalizeMaintenance(base).draft.status,'成交');
  assert.throws(()=>normalizeMaintenance({...base,draft:{...base.draft,status:'发现'}}),/terminal correction/);
  assert.throws(()=>normalizeMaintenance({...base,draft:{...base.draft,customerId:'99'}}),/fields/);
});
test('remove accepts only exact empty draft and safe original identifiers',()=>{
  const base={idempotencyKey:randomUUID(),operation:'remove',customerId:'12',opportunityId:'34',draft:{}};
  assert.deepEqual(normalizeMaintenance(base).draft,{});
  assert.throws(()=>normalizeMaintenance({...base,draft:{reason:'x'}}),/fields/);
  assert.throws(()=>normalizeMaintenance({...base,opportunityId:'34 OR 1=1'}),/identity/);
});
test('service sends preview and execute through the scoped RPC',async()=>{
  const calls=[];
  const service=new LegacyOpportunityMaintenanceService({rpc:async(name,args)=>{calls.push({name,args});return {ok:true};}});
  const request={idempotencyKey:randomUUID(),operation:'remove',customerId:'12',opportunityId:'34',draft:{}};
  await service.preview(request,'actor-1');await service.execute(randomUUID(),'actor-1');
  assert.deepEqual(calls.map(x=>x.name),['crm_legacy_opportunity_maintenance_v1','crm_legacy_opportunity_maintenance_v1']);
  assert.deepEqual(calls.map(x=>x.args.p_phase),['preview','execute']);
  assert.throws(()=>service.execute(randomUUID(),''),/UNAUTHORIZED/);
});
test('identity exception list stays read-only and paginated',async()=>{
  const calls=[];
  const service=new LegacyOpportunityMaintenanceService({rpc:async(name,args)=>{
    calls.push({name,args});return {rows:[],total:0};}});
  assert.deepEqual(await service.listExceptions(2,'actor-1'),{rows:[],total:0});
  assert.deepEqual(calls,[{name:'crm_legacy_opportunity_identity_exceptions_v1',args:{
    p_actor_uid:'actor-1',p_page:2,p_page_size:20}}]);
  assert.throws(()=>service.listExceptions(1001,'actor-1'),/Invalid identity exception/);
});
