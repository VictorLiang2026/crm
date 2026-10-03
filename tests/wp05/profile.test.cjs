'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {getCustomerProfile} = require('../../cloudfunctions/person_360/customer-profile-service');
function fixture({linked=true, missing=false, summary={status:'verified',containsTestData:false}, marked=false}={}) {
  const calls=[];
  const customer={Id:81,customer_name:marked?'【系统测试·勿联系】虚构甲':'虚构夹具甲',occupation:'虚构新职业',phone:''};
  const request=async(table,method,filters)=>{
    calls.push({table,method,filters});
    if(table==='persons')return [{id:71,display_name:'虚构旧名',legacy_customer_id:linked?81:null,phone:'虚构旧联系方式',occupation:'旧职业'}];
    if(table==='customers')return missing?[]:[{...customer}];
    if(table==='person_roles')return [{id:1,role:'customer',origin:'manual'}];
    throw Error('Unexpected table');
  };
  return {calls,customer,load:()=>getCustomerProfile(71,{request,disclose:async()=>summary})};
}
test('linked fields always read latest customer; blank contacts never fall back to Person',async()=>{
 const f=fixture();const first=await f.load();assert.equal(first.fields.occupation,'虚构新职业');assert.equal(first.fields.phone,'');
 f.customer.occupation='【系统测试·勿联系】虚构更新职业';assert.equal((await f.load()).fields.occupation,f.customer.occupation);
 assert.ok(f.calls.every(c=>c.method==='GET'));assert.ok(f.calls.filter(c=>c.table==='customers').every(c=>c.filters.Id==='eq.81'&&c.filters.deleted_at==='is.null'));
});
test('deleted/missing linked customer exposes no stale contact or editor target',async()=>{
 const r=await fixture({missing:true}).load();assert.equal(r.status,'customer_unavailable');assert.deepEqual(r.fields,{});assert.equal(r.customerId,null);assert.equal(r.contactAllowed,false);
});
test('unlinked person stays read-only without name lookup or customer creation',async()=>{
 const f=fixture({linked:false});const r=await f.load();assert.equal(r.status,'person_only');assert.equal(r.customerId,null);
 assert.equal(r.fields.occupation,'旧职业');assert.ok(f.calls.every(c=>c.table!=='customers'&&c.method==='GET'));
});
test('test registry, visible marker and unavailable provenance all disable contact',async()=>{
 for(const options of [{marked:true},{summary:{status:'verified',containsTestData:true}},{summary:{status:'unverified',containsTestData:null}}])assert.equal((await fixture(options).load()).contactAllowed,false);
});
test('invalid identity and absent person reject without writes',async()=>{
 const request=async()=>{throw Error('Should not query');};
 await assert.rejects(getCustomerProfile('71,72',{request}),/Invalid/);
 await assert.rejects(getCustomerProfile(71,{request:async()=>[]}),/Person not found/);
});
test('role evidence and source remain explicit, no role mutation',async()=>{
 const r=await fixture().load();assert.equal(r.roles[0].origin,'manual');assert.equal(r.source,'public.customers');assert.equal(r.personId,'71');
});
