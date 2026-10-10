'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {getCustomerProfile} = require('../../cloudfunctions/person_360/customer-profile-service');
function fixture({linked=true, missing=false, summary={status:'verified',containsTestData:false}, marked=false}={}) {
  const calls=[];
  const customer={Id:81,person_id:71,customer_name:marked?'【系统测试·勿联系】虚构甲':'虚构夹具甲',occupation:'虚构新职业',phone:''};
  const request=async(table,method,filters)=>{
    calls.push({table,method,filters});
    if(table==='persons')return [{id:71,display_name:marked?'【系统测试·勿联系】虚构甲':'虚构旧名',phone:'虚构旧联系方式',occupation:'旧职业'}];
    if(table==='customers')return (missing||!linked)?[]:[{...customer}];
    if(table==='person_roles')return [{id:1,role:'customer',origin:'manual'}];
    throw Error('Unexpected table');
  };
  return {calls,customer,load:()=>getCustomerProfile(71,{request,disclose:async()=>summary})};
}
test('linked fields read Person master and keep customer-only business fields',async()=>{
 const f=fixture();const first=await f.load();assert.equal(first.fields.occupation,'旧职业');assert.equal(first.fields.phone,'虚构旧联系方式');
 f.customer.occupation='【系统测试·勿联系】虚构更新职业';assert.equal((await f.load()).fields.occupation,'旧职业');
 assert.ok(f.calls.every(c=>c.method==='GET'));assert.ok(f.calls.filter(c=>c.table==='customers').every(c=>c.filters.person_id==='eq.71'&&c.filters.deleted_at==='is.null'));
});
test('absent customer row exposes Person-master fields without customer business fields',async()=>{
 const r=await fixture({missing:true}).load();assert.equal(r.status,'person_only');assert.equal(r.customerId,null);
 assert.equal(r.fields.occupation,'旧职业');assert.equal(r.fields.customer_stage,undefined);assert.equal(r.fields.mbti,undefined);
});
test('person without customer row stays read-only without customer creation',async()=>{
 const f=fixture({linked:false});const r=await f.load();assert.equal(r.status,'person_only');assert.equal(r.customerId,null);
 assert.equal(r.fields.occupation,'旧职业');assert.ok(f.calls.every(c=>c.method==='GET'));
});
test('test registry, visible marker and unavailable provenance all disable contact',async()=>{
 for(const options of [{marked:true},{summary:{status:'verified',containsTestData:true}},{summary:{status:'unverified',containsTestData:null}}])assert.equal((await fixture(options).load()).contactAllowed,false);
});
test('invalid identity and absent person reject without writes',async()=>{
 const request=async()=>{throw Error('Should not query');};
 await assert.rejects(getCustomerProfile('71,72',{request}),/Invalid/);
 await assert.rejects(getCustomerProfile(71,{request:async()=>[]}),/Person not found/);
});
test('role evidence and Person source remain explicit, no role mutation',async()=>{
 const r=await fixture().load();assert.equal(r.roles[0].origin,'manual');assert.equal(r.source,'public.persons');assert.equal(r.personId,'71');
});
