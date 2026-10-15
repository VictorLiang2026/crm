'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {RelationshipService}=require('../../cloudfunctions/person_360/relationship-service');

test('relationship list includes both directions with counterparty labels',async()=>{
 const service=new RelationshipService({request:async(table,_method,filters)=>{
  if(table==='persons'&&filters.id==='eq.1')return[{id:1}];
  if(table==='relationships')return[
   {id:10,from_person_id:1,to_person_id:2,relationship_type:'friend'},
   {id:11,from_person_id:3,to_person_id:1,relationship_type:'colleague'},
  ];
  if(table==='persons'&&filters.id==='in.(2,3)')return[{id:2,display_name:'A'},{id:3,display_name:'B'}];
  return[];
 },rpc:async()=>{throw new Error('read must not execute RPC');}});
 const result=await service.listForPerson('1');
 assert.deepEqual(result.rows.map(x=>[x.direction,x.other_person_id,x.other_name]),[['outgoing',2,'A'],['incoming',3,'B']]);
});

test('relationship create resolves selected candidate before preview RPC',async()=>{
 const calls=[];
 const service=new RelationshipService({request:async(table,_method,filters)=>{
  if(table==='persons'&&filters.name_key)return[{id:2,name_key:'alex',display_name:'Alex'}];
  if(table==='customers')return[];
  return[];
 },rpc:async(name,args)=>{calls.push({name,args});return{previewId:'0a8e3e68-0e2b-4e56-8c1d-7b4dd7fe5567'};}});
 await assert.rejects(service.preview(1,'create',{idempotencyKey:'0a8e3e68-0e2b-4e56-8c1d-7b4dd7fe5567',
   otherPersonId:'3',otherName:'Alex',direction:'outgoing',relationshipType:'friend'},'actor'),/not in the current identity results/);
 const result=await service.preview(1,'create',{idempotencyKey:'0a8e3e68-0e2b-4e56-8c1d-7b4dd7fe5567',
   otherPersonId:'2',otherName:'Alex',direction:'incoming',relationshipType:'friend',importance:4},'actor');
 assert.equal(result.previewId,'0a8e3e68-0e2b-4e56-8c1d-7b4dd7fe5567');
 assert.equal(calls[0].name,'crm_relationship_preview_v1');
 assert.equal(calls[0].args.p_person_id,1);
 assert.equal(calls[0].args.p_payload.fromPersonId,2);
 assert.equal(calls[0].args.p_payload.toPersonId,1);
 assert.equal(calls[0].args.p_payload.importance,4);
});

test('relationship write preview rejects ambiguous unsupported identity payloads',async()=>{
 const service=new RelationshipService({request:async()=>[],rpc:async()=>{throw new Error('must not call');}});
 await assert.rejects(service.preview(1,'create',{idempotencyKey:'0a8e3e68-0e2b-4e56-8c1d-7b4dd7fe5567',
   otherPersonId:'1',otherName:'Self',direction:'outgoing',relationshipType:'family'},'actor'),/Invalid relationship Person selection/);
 await assert.rejects(service.preview(1,'unlink',{idempotencyKey:'0a8e3e68-0e2b-4e56-8c1d-7b4dd7fe5567',relationshipId:'0'},'actor'),/Invalid Person ID/);
});
