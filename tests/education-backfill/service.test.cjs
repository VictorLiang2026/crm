'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createEducationBackfill,validateRequest,splitContext,verifyCandidates,mergeCandidates,
  MAX_SOURCE_CHARS,isEducationTimer}=require('../../cloudfunctions/assistant/education-backfill-service');
const batch='00000000-0000-4000-8000-000000000001';
const itemId='00000000-0000-4000-8000-000000000002';
const lease='00000000-0000-4000-8000-000000000003';
const source={schema:'public',table:'persons',id:'7',field:'notes',text:'本人毕业于北大，经济学专业。儿子在复旦就读。'};
const context={person:{id:'7',display_name:'Sample'},sources:[source]};
const raw=()=>({school:'北大',major:'经济学',relationship:'self',educationType:'graduated',stage:null,ambiguous:false,reason:null,
  evidence:[{table:'persons',id:'7',field:'notes',quote:'本人毕业于北大，经济学专业。',supports:'both'}]});

test('reject anonymous, worker operations, forged actor, results and confirmation booleans',async()=>{
  const calls=[];const service=createEducationBackfill({rpc:async(...a)=>{calls.push(a);return{};}});
  await assert.rejects(service.handle({action:'educationBackfill',operation:'batches'}, {uid:'x',isAnonymous:true}),/ACCESS_DENIED/);
  for(const operation of ['claim','finish','queue']) assert.throws(()=>validateRequest({action:'educationBackfill',operation,data:{batchId:batch}}),/INVALID_INPUT/);
  for(const extra of [{actorUid:'other'},{confirmed:true},{rows:[]},{result:{school:'fake'}}]) {
    assert.throws(()=>validateRequest({action:'educationBackfill',operation:'execute',data:{batchId:batch,previewId:itemId,confirmationToken:lease,...extra}}),/INVALID_INPUT/);
  }
  assert.equal(calls.length,0);
});
test('validate distinct selections and mandatory server plan',()=>{
  assert.throws(()=>validateRequest({action:'educationBackfill',operation:'preview',data:{batchId:batch,rows:[{itemId,candidateIndex:0,school:true,major:false}]}}),/INVALID_INPUT/);
  assert.throws(()=>validateRequest({action:'educationBackfill',operation:'preview',data:{batchId:batch,planId:lease,rows:
    [0,1].map(candidateIndex=>({itemId,candidateIndex,school:true,major:false}))}}),/INVALID_INPUT/);
  assert.throws(()=>validateRequest({action:'educationBackfill',operation:'create',data:{requestKey:lease,maxCalls:20,personIds:['7','7']}}),/INVALID_INPUT/);
});
test('all history is chunked, overlapping boundaries are kept, duplicates do not consume calls',()=>{
  const text='x'.repeat(7990)+'毕业于北京大学经济系'+'z'.repeat(9000);
  const chunks=splitContext({...context,sources:[{...source,text},{...source,id:'8',text}]});
  assert.equal(chunks.length,3);
  assert.ok(chunks.some(c=>c.some(s=>s.text.includes('毕业于北京大学经济系'))));
  assert.equal(chunks.at(-1)[0].text.endsWith('z'.repeat(100)),true);
  assert.throws(()=>splitContext({...context,sources:[{...source,text:'x'.repeat(MAX_SOURCE_CHARS+1)}]}),/SOURCE_TOO_LARGE/);
});
test('school aliases normalize only after verbatim, field-level evidence verification',()=>{
  assert.equal(verifyCandidates({candidates:[raw()]},[source])[0].school,'北京大学');
  for(const candidate of [{...raw(),major:'计算机'},{...raw(),school:'清华大学'},
    {...raw(),evidence:[{...raw().evidence[0],id:'8'}]},
    {...raw(),evidence:[{...raw().evidence[0],quote:'不存在的原文'}]}]) {
    assert.throws(()=>verifyCandidates({candidates:[candidate]},[source]),/EVIDENCE|UNSUPPORTED_FIELD/);
  }
});
test('other people, alumni, studying, ambiguity and multiple episodes require review',()=>{
  for(const change of [{relationship:'other'},{relationship:'unclear'},{educationType:'alumni'},
    {educationType:'studying'},{educationType:'training'},{ambiguous:true}]) {
    assert.equal(mergeCandidates([{...raw(),...change}]).needsReview,true);
  }
  const result=mergeCandidates([raw(),{...raw(),school:'复旦大学',major:'金融'}]);
  assert.equal(result.candidates.length,2);assert.equal(result.needsReview,true);
  assert.equal(mergeCandidates([raw(),raw()]).candidates.length,1);
});
test('worker fixed identity, no business write, task provenance and cursor persist',async()=>{
  const calls=[];
  const rpc=async(actor,op,data)=>{
    calls.push({actor,op,data});
    if(op==='claim')return {item:{id:itemId,person_id:'7',lease_token:lease,chunk_cursor:0,partial_result:[],source_hash:'h'},context};
    return{saved:true};
  };
  const service=createEducationBackfill({rpc,gatewayFactory:actor=>({runAITask:async req=>{
    assert.equal(actor,'owner');assert.equal(req.subjectId,'7');
    assert.equal(req.contextSnapshot._context.sourceHash,'h');
    return{result:{candidates:[raw()]},taskId:'1',resultId:'2'};
  }})});
  await service.workOne('owner',batch);
  assert.deepEqual(calls.map(c=>c.op),['claim','finish']);
  assert.equal(calls[1].data.complete,true);
  assert.equal(calls[1].data.result.candidates[0].school,'北京大学');
  assert.equal(calls[1].data.result.candidates[0].taskRefs[0].taskId,'1');
});
test('empty sources never call AI; malformed evidence marks failed without business mutation',async()=>{
  for(const empty of [true,false]){
    const calls=[];let aiCalls=0;
    const service=createEducationBackfill({rpc:async(actor,op,data)=>{
      calls.push({op,data});return op==='claim'?{item:{id:itemId,person_id:'7',lease_token:lease,chunk_cursor:0,partial_result:[]},
        context:empty?{...context,sources:[]}:context}:{saved:true};
    },gatewayFactory:()=>({runAITask:async()=>{aiCalls++;return{result:{candidates:[{...raw(),major:'编造专业'}]}};}})});
    await service.workOne('owner',batch);
    assert.equal(aiCalls,empty?0:1);
    if(empty)assert.equal(calls[1].data.result.candidates.length,0);
    else assert.equal(calls[1].data.errorCode,'EDUCATION_UNSUPPORTED_FIELD');
  }
});
test('uncertain persistence never repeats a model call or claims success',async()=>{
  let aiCalls=0,finishes=0;
  const service=createEducationBackfill({rpc:async(actor,op)=>{
    if(op==='finish'){finishes++;throw Error('network');}
    return {item:{id:itemId,person_id:'7',lease_token:lease,chunk_cursor:0,partial_result:[]},context};
  },gatewayFactory:()=>({runAITask:async()=>{aiCalls++;return {result:{candidates:[raw()]},taskId:'1',resultId:'2'};}})});
  await assert.rejects(service.workOne('owner',batch),/network/);
  assert.equal(aiCalls,1);assert.equal(finishes,1);
});

test('timer rejects forged/wrong triggers, and queue delegates one bounded step under stored owner',async()=>{
  const secret='s'.repeat(48),event={Type:'Timer',TriggerName:'educationBackfillWorker',Message:secret};
  assert.equal(isEducationTimer(event,secret),true);
  assert.equal(isEducationTimer({...event,Message:'x'.repeat(48)},secret),false);
  assert.equal(isEducationTimer({...event,Type:'User'},secret),false);
  assert.equal(isEducationTimer(event,'short'),false);
  const calls=[];
  const service=createEducationBackfill({rpc:async(actor,op,data)=>{
    calls.push({actor,op,data});return op==='queue'?{jobs:[{actor_uid:'owner',id:batch}]}:{idle:true};
  }});
  await service.workQueue();
  assert.deepEqual(calls.map(c=>[c.actor,c.op]),[['education-worker','queue'],['owner','claim']]);
});

test('multiple source chunks persist a cursor and avoid declaring a partial scan complete',async()=>{
  const calls=[];const big={...source,text:'a'.repeat(16000)};
  const service=createEducationBackfill({rpc:async(actor,op,data)=>{
    calls.push({op,data});return op==='claim'?{item:{id:itemId,person_id:'7',lease_token:lease,chunk_cursor:0,partial_result:[]},
      context:{...context,sources:[big]}}:{saved:true};
  },gatewayFactory:()=>({runAITask:async()=>({result:{candidates:[]},taskId:'1',resultId:'2'})})});
  await service.workOne('owner',batch);
  assert.equal(calls[1].data.complete,false);assert.equal(calls[1].data.result,null);
  assert.equal(calls[1].data.totalChunks,3);assert.equal(calls[1].data.cursor,0);
});
