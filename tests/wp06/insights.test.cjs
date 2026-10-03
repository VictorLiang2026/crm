'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {PersonInsightsService}=require('../../cloudfunctions/person_360/person-insights-service');
const mark='【系统测试·勿联系】';
function fixture(){
 const calls=[];
 const data={persons:[{id:71,legacy_customer_id:81}], interactions:[{id:301,person_id:71,source_type:'followups',source_id:1,interaction_type:'followup',interaction_at:'2026-09-30',summary:mark+'物化互动'}],
 followups:Array.from({length:55},(_,i)=>({Id:i+1,followup_date:'2026-09-28',interaction_summary:mark+'跟进 '+(i+1)})),
 recruit_candidates:[],recruit_followups:[],activity_participants:[{id:91,activity_id:21,person_type:'customer',person_id:81,status:'invited',created_at:'2026-09-29'},{id:92,activity_id:21,person_type:'customer',person_id:81,status:'attended',created_at:'2026-09-29'}],
 activity_speakers:[],activities:[{id:21,name:mark+'活动',activity_date:'2026-09-29'}],context_items:[
 {id:101,person_id:71,item_type:'fact',category:'偏好',content:mark+'事实',confirmed:true,created_at:'2026-09-01',last_verified_at:'2026-09-30'},
 {id:102,person_id:71,item_type:'signal',category:'兴趣',content:mark+'信号',confirmed:false,created_at:'2026-09-20'},
 {id:103,person_id:71,item_type:'inference',category:'推断',content:mark+'候选',confirmed:false,created_at:'2026-09-20',valid_to:'2026-09-21'}]};
 async function request(table,method,filters={}){calls.push({table,method,filters});assert.equal(method,'GET');let rows=data[table]||[];
  for(const [key,val] of Object.entries(filters)){
   if(!['id','person_id','customer_id','canonical_person_id','person_type','status','item_type'].includes(key))continue;
   if(String(val).startsWith('eq.'))rows=rows.filter(r=>String(r[key]??(key==='customer_id'?81:''))===val.slice(3));
   if(String(val).startsWith('in.')){const ids=val.slice(4,-1).split(',');rows=rows.filter(r=>ids.includes(String(r[key])));}
  }
  return rows.slice(Number(filters.offset||0),Number(filters.offset||0)+Number(filters.limit||rows.length));
 }
 const disclose=async refs=>({status:'verified',containsTestData:refs.length>1,recordCount:refs.length-1,sources:refs.length>1?[{batchKey:'crm_test_fixture',table:'followups',count:refs.length-1}]:[]});
 return {service:new PersonInsightsService({request,disclose}),calls,data};
}
test('more than 50 followups page without repeated sources; invited is excluded',async()=>{
 const f=fixture(), seen=new Set();let page=1, result;
 do{result=await f.service.timeline(71,{page,pageSize:10});for(const row of result.rows){assert.equal(seen.has(row.source),false);seen.add(row.source);}page++;}while(result.hasMore&&page<10);
 assert.equal(seen.size,56);assert.equal(seen.has('public.activity_participants#91'),false);assert.equal(seen.has('public.activity_participants#92'),true);
 assert.ok(f.calls.some(c=>c.table==='followups'&&c.filters.offset===50));assert.equal(result.testData.containsTestData,true);
});
test('legacy edits and deletes appear on fresh reads without writes',async()=>{
 const f=fixture();assert.ok((await f.service.timeline(71,{page:6})).rows.some(r=>r.source==='public.followups#1'&&r.summary===mark+'跟进 1'));
 f.data.followups[0].interaction_summary=mark+'物化来源更新';
 assert.ok((await f.service.timeline(71,{page:6})).rows.some(r=>r.source==='public.followups#1'&&r.summary.includes('物化来源更新')));
 f.data.followups.splice(0,1);
 assert.equal((await f.service.timeline(71,{page:6})).rows.some(r=>r.source==='public.followups#1'),false);
 f.data.followups[53].interaction_summary=mark+'修改后';
 assert.ok((await f.service.timeline(71)).rows.some(r=>r.summary.includes('修改后')));
 f.data.followups.splice(53,1);assert.equal((await f.service.timeline(71)).rows.some(r=>r.summary.includes('修改后')),false);
 assert.ok(f.calls.every(c=>c.method==='GET'));
});
test('context separates Fact Signal Inference with provenance and confirmation',async()=>{
 const r=await fixture().service.context(71);assert.equal(r.groups.fact[0].confirmed,true);assert.equal(r.groups.fact[0].updatedAt,'2026-09-30');
 assert.equal(r.groups.signal[0].confirmed,false);assert.equal(r.groups.inference[0].source,'public.context_items#103');assert.equal(r.testData.containsTestData,true);
});
test('bad ID and page reject before reading',async()=>{
 const f=fixture();await assert.rejects(f.service.timeline('71,72'),/Invalid/);await assert.rejects(f.service.timeline(71,{page:0}),/Invalid/);
 await assert.rejects(f.service.timeline(71,{pageSize:21}),/Invalid/);assert.equal(f.calls.length,0);
});
