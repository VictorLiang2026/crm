'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {LegacyOpportunityService,normalize}=require('../../cloudfunctions/person_360/legacy-opportunity-service');
const KEY='00000000-0000-4000-8000-000000000010';
const edit={idempotencyKey:KEY,operation:'edit',personId:12,customerId:71,opportunityId:9,
 draft:{type:'养老规划',status:'沟通',progress:' update ',nextAction:' meet ',nextActionDate:'2026-11-01',
   discoveredAt:null,referredName:'',referredRelation:''}};
test('legacy adapter validates exact business fields and real calendar dates',()=>{
 const d=normalize(edit);assert.equal(d.opportunityId,'9');assert.equal(d.draft.progress,'update');assert.equal(d.draft.type,'养老规划');
 for(const patch of [{confirmed:true},{actorUid:'spoof'},{operation:'create'},{customerId:null},{personId:0},
  {draft:{...edit.draft,person_id:13}},{draft:{...edit.draft,status:'成交'}},
  {draft:{...edit.draft,nextActionDate:'2026-02-30'}},{draft:{...edit.draft,discoveredAt:'2026-2-1'}},
  {draft:{...edit.draft,progress:'x'.repeat(4001)}}])assert.throws(()=>normalize({...edit,...patch}),/Invalid/);
});
test('close requires a result and optional scoped action; stage cannot silently close',()=>{
 const close={...edit,operation:'close',draft:{status:'关闭',result:'reason',actionId:17}};
 assert.deepEqual(normalize(close).draft,{status:'关闭',result:'reason',actionId:'17'});
 assert.throws(()=>normalize({...close,draft:{...close.draft,result:' '}}),/Invalid/);
 assert.throws(()=>normalize({...edit,operation:'stage',draft:{status:'关闭'}}),/Invalid/);
 assert.deepEqual(normalize({...edit,operation:'stage',draft:{status:'已介绍'}}).draft,{status:'已介绍'});
});
test('preview and execute use dedicated actor-bound RPC and never the Person-only executor',async()=>{
 const calls=[];const service=new LegacyOpportunityService({rpc:async(name,body)=>{calls.push({name,body});return {ok:true};}});
 await service.preview(edit,'server-actor');await service.execute(KEY,'server-actor');
 assert.ok(calls.every(x=>x.name==='crm_legacy_opportunity_v1'&&x.body.p_actor_uid==='server-actor'));
 assert.deepEqual(calls[1].body.p_data,{previewId:KEY});
 assert.throws(()=>service.preview(edit,''),/UNAUTHORIZED/);
 assert.throws(()=>service.execute('not-a-receipt','server-actor'),/Invalid/);
});
