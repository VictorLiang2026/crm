'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {PersonFileService}=require('../../cloudfunctions/person_360/person-file-service');
const job='11111111-1111-4111-8111-111111111111',key='22222222-2222-4222-8222-222222222222',preview='33333333-3333-4333-8333-333333333333';
test('L04b audit history follows original ownership and stays actor/job bounded',async()=>{
 const calls=[],s=new PersonFileService({rpc:async()=>{calls.push('owned');return{job:{id:job}};},request:async(table,method,params)=>{
  calls.push({table,method,params});return[{id:preview,operation:'apply',status:'undone'}];}});
 const receipt=await s.get(job,'actor',{history:true});assert.equal(receipt.commands[0].status,'undone');
 assert.equal(calls[0],'owned');assert.equal(calls[1].params.actor_uid,'eq.actor');assert.equal(calls[1].params.job_id,'eq.'+job);
 assert.equal(calls[1].params.limit,50);assert.doesNotMatch(calls[1].params.select,/actor_uid|payload|identity_preview/);
 const blocked=new PersonFileService({rpc:async()=>{throw Error('foreign');},request:async()=>assert.fail('history leaked')});
 await assert.rejects(blocked.get(job,'actor',{history:true}),/foreign/);
});
test('L04b saves standalone originals without invented identity; validates size, whitelist and stable key',async()=>{
 const calls=[],s=new PersonFileService({rpc:async(n,p)=>{calls.push([n,p]);return{job:{id:job}};}});
 const input={idempotencyKey:key,fileName:' note.txt ',contentType:'text/plain',base64:'dGVzdA=='};
 await s.save(input,'actor');await s.save(input,'actor');assert.deepEqual(calls[0],calls[1]);
 assert.equal(calls[0][0],'crm_person_file_v1');
 const p=calls[0][1].p_data;assert.equal(p.fileName,'note.txt');assert.equal(p.personId,undefined);assert.equal(p.customerId,undefined);
 assert.equal(p.payloadHash,crypto.createHash('sha256').update(JSON.stringify({fileName:'note.txt',contentType:'text/plain',base64:'dGVzdA=='})).digest('hex'));
 assert.throws(()=>s.save({...input,personId:1},'actor'),/Invalid/);
 assert.throws(()=>s.save({...input,base64:'!!!!'},'actor'),/Invalid/);
 assert.throws(()=>s.save(input,''),/UNAUTHORIZED/);
 assert.throws(()=>s.list(null,0,'actor'),/Invalid/);
});
test('L04b source ownership is checked before server identity resolution and exact reviewed fields are bound',async()=>{
 const calls=[],s=new PersonFileService({rpc:async(n,p)=>{calls.push(p);return p.p_operation==='get'?{job:{id:job,status:'draft',person_id:null}}:{previewId:preview};},
  previewIdentity:async(p,actor)=>{calls.push({identity:p,actor});return{previewId:preview};}});
 await s.preview({jobId:job,idempotencyKey:key,displayName:' Fictional ',personId:'12',fields:{phone:' 123 '}},'actor');
 assert.deepEqual(calls.map(x=>x.p_operation||'identity'),['get','identity','preview']);
 assert.deepEqual(calls[1].identity,{kind:'person',idempotencyKey:key,displayName:'Fictional',personId:'12'});
 assert.deepEqual(calls[2].p_data.fields,{phone:'123'});assert.equal(calls[2].p_data.identityPreviewId,preview);
 await assert.rejects(s.preview({jobId:job,idempotencyKey:key,displayName:'Fictional',fields:{customer_stage:'new'}},'actor'),/Invalid/);
 const blocked=new PersonFileService({rpc:async()=>{throw Error('foreign job');},previewIdentity:async()=>{throw Error('must not resolve');}});
 await assert.rejects(blocked.preview({jobId:job,idempotencyKey:key,displayName:'Fictional',fields:{}},'actor'),/foreign job/);
});
test('L04b reuses bounded parsing and persistent failure lease; never applies AI output',async()=>{
 const calls=[],s=new PersonFileService({rpc:async(n,p)=>{calls.push(p);
  if(p.p_operation==='claim')return{leaseToken:key,source:{photo_url:'data:text/plain;base64,dGVzdA==',content_type:'text/plain',file_name:'test.txt'}};
  return{job:{id:job,status:'draft'}};},parse:async input=>{assert.equal(input.action,'parse_import_draft');return{parsed:{customer_name:'Fictional',phone:'123'}};}});
 await s.parseDraft(job,'actor');assert.deepEqual(calls.map(x=>x.p_operation),['claim','complete']);
 assert.deepEqual(calls[1].p_data.fields,{customer_name:'Fictional',phone:'123'});assert.equal(calls[1].p_data.rawText,'test');
 const failure=new PersonFileService({rpc:async(n,p)=>{calls.push(p);return p.p_operation==='claim'?{leaseToken:key,source:{}}:{job:{status:'failed'}};},parse:async()=>assert.fail('invalid source sent to AI')});
 await failure.parseDraft(job,'actor');assert.equal(calls.at(-1).p_data.errorCode,'SOURCE_UNAVAILABLE');
});
test('L04b execute and undo require scoped server IDs, never client confirmed flags',async()=>{
 const calls=[],s=new PersonFileService({rpc:async(n,p)=>{calls.push(p);return{};}});
 await s.execute(preview,'actor');assert.deepEqual(calls[0].p_data,{previewId:preview});
 await s.undo({jobId:job,commandId:preview,idempotencyKey:key},'actor');
 assert.equal(calls[1].p_operation,'undo_preview');
 assert.throws(()=>s.undo({jobId:job,commandId:preview,idempotencyKey:key,confirmed:true},'actor'),/Invalid/);
 assert.throws(()=>s.execute('arbitrary','actor'),/Invalid/);
});

