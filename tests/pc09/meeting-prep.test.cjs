'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {MeetingPrepContextBuilder}=require('../../cloudfunctions/person_360/meeting-prep-context');

test('meeting preparation reads confirmed live edges only and carries explicit importance',async()=>{
 const seen=[];
 const request=async(table,method,filters={})=>{
  assert.equal(method,'GET'); seen.push({table,filters});
  if(table==='persons'&&filters.id==='eq.1')return[{id:1,display_name:'A'}];
  if(table==='persons'&&filters.id==='in.(2)')return[{id:2,display_name:'B'}];
  if(table==='relationships'&&filters.from_person_id==='eq.1'&&filters.status==='eq.confirmed')return[
   {id:7,to_person_id:2,relationship_type:'friend',strength:'strong',importance:5,status:'confirmed',source:'manual'}];
  if(table==='relationships')return[];
  return[];
 };
 const builder=new MeetingPrepContextBuilder({request,listInteractions:async()=>({rows:[]}),insuranceContext:async()=>({})});
 const result=await builder.build(1);
 assert.deepEqual(result.relationship.map(x=>[x.direction,x.other_name,x.importance]),[['outgoing','B',5]]);
 assert.ok(seen.filter(x=>x.table==='relationships').every(x=>x.filters.status==='eq.confirmed'&&x.filters.deleted_at==='is.null'));
 assert.ok(seen.filter(x=>x.table==='relationships').every(x=>x.filters.select.includes('importance')));
});
