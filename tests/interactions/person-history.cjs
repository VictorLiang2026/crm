'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {customerHistory}=require('../../cloudfunctions/_shared/person-history');
test('legacy AI history includes manual conversations and retains sales extension/source once',async()=>{
 let called;
 const app={callFunction:async args=>{called=args;return {result:{rows:[
  {id:7,source_type:'manual',source_id:null,summary:'General',raw_note:'Original',interaction_at:'2026-10-30T00:00:00Z'},
  {id:8,source_type:'followups',source_id:9,summary:'Sale',raw_note:'Details',interaction_at:null},
 ]}};}};
 const filters=[];
 const q={select(){return this;},eq(...args){filters.push(args);return this;},is(){return this;},in(...args){filters.push(args);return Promise.resolve({data:[{Id:9,next_followup_goal:'Review'}]});}};
 const r=await customerHistory(app,{from:table=>{assert.equal(table,'followups');return q;}},{Id:11,person_id:1},5);
 assert.equal(called.name,'person_360');assert.equal(called.data.personId,'1');assert.equal(called.data.limit,5);
 assert.equal(r.data.length,2);assert.equal(r.data[0].source,'public.interactions#7');
 assert.equal(r.data[1].source,'public.followups#9');assert.equal(r.data[1].next_followup_goal,'Review');
 assert.equal(r.data[1].followup_date,null);assert.deepEqual(filters,[['customer_id',11],['Id',[9]]]);
 await assert.rejects(customerHistory({callFunction:async()=>({result:{error:'UNAUTHORIZED'}})},null,{person_id:1}),/unavailable/);
 await assert.rejects(customerHistory(app,null,{}),/linked Person/);
});
test('every deployed shared history copy matches',()=>{
 const root=path.resolve(__dirname,'../../cloudfunctions');
 for(const file of ['interaction-service.js','legacy-interaction-adapter.js'])for(const directory of ['assistant','person_360'])assert.deepEqual(fs.readFileSync(path.join(root,'_shared',file)),fs.readFileSync(path.join(root,directory,file)));
 for(const directory of ['ai_recommend','ai_referral','ai_followup'])assert.deepEqual(fs.readFileSync(path.join(root,'_shared/person-history.js')),fs.readFileSync(path.join(root,directory,'person-history.js')));
 assert.deepEqual(fs.readFileSync(path.join(root,'_shared/context-engine.js')),fs.readFileSync(path.join(root,'ai_activity/context-engine.js')));
});
