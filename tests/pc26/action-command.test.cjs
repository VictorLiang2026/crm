'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMain}=require('../../cloudfunctions/assistant');
const {runActionCommand,draftOf}=require('../../cloudfunctions/assistant/action-command-service');
const {createActionCommandData}=require('../../cloudfunctions/assistant/action-command-data');
const {interpretActionCommand,listActionTargets,validateProposal}=require('../../cloudfunctions/assistant/action-command-intent-service');

const changes={title:'Call after review',description:null,due_at:'2026-10-23T17:00:00+08:00',priority:null};
const supported={status:'supported',operation:'update',interpretation:'Update one action',personMention:'Alex Chen',
  actionMention:'the policy review follow-up',changes:{action_type:null,...changes}};

test('AI contract accepts only bounded update/close fields and never identifiers',()=>{
  assert.deepEqual(validateProposal(supported).changes,supported.changes);
  assert.throws(()=>validateProposal({...supported,actionId:7}),{code:'INVALID_RESULT'});
  assert.throws(()=>validateProposal({...supported,personMention:'123'}),{code:'INVALID_RESULT'});
  assert.throws(()=>validateProposal({...supported,changes:{...supported.changes,status:'completed'}}),{code:'INVALID_RESULT'});
  assert.throws(()=>validateProposal({...supported,changes:{...supported.changes,due_at:'next Friday'}}),{code:'INVALID_RESULT'});
  assert.throws(()=>validateProposal({...supported,operation:'close'}),{code:'INVALID_RESULT'});
  assert.throws(()=>draftOf({operation:'update',resource:'actions',personId:7,targetActionId:8,
    changes:{...changes,confirmed:true}}),{code:'INVALID_COMMAND'});
  assert.throws(()=>draftOf({operation:'close',resource:'actions',personId:7,targetActionId:8,
    changes:{status:'completed'}}),{code:'INVALID_COMMAND'});
});

test('parse asks for clarification or refuses unsupported requests without reading CRM rows',async()=>{
  let reads=0;
  const database={auditRdb:{},resolveName:async()=>{reads++;return {candidates:[]};}};
  const gateway={runAITask:async()=>({taskId:1,resultId:2,result:{...supported,status:'needs_clarification',personMention:null}})};
  const unclear=await interpretActionCommand({query:'change something',language:'en'},{app:{},database,gateway});
  assert.equal(unclear.status,'needs_clarification');assert.equal(unclear.execution.businessDataRead,false);
  gateway.runAITask=async()=>({taskId:1,resultId:2,result:{status:'unsupported',operation:'unsupported',
    interpretation:'Only update or complete is supported.',personMention:null,actionMention:null,
    changes:{action_type:null,title:null,description:null,due_at:null,priority:null}}});
  const unsupported=await interpretActionCommand({query:'delete an action',language:'en'},{app:{},database,gateway});
  assert.equal(unsupported.status,'unsupported');assert.equal(reads,0);
});

test('parse resolves Person phrases but never auto-selects a same-name candidate or reads Actions',async()=>{
  let listCalls=0;
  const database={auditRdb:{},resolveName:async()=>({candidates:[
    {id:7,displayName:'Alex Chen (North)'},{id:9,displayName:'Alex Chen (South)'}],hasMore:false})};
  const gateway={runAITask:async()=>({taskId:11,resultId:12,result:supported})};
  const result=await interpretActionCommand({query:'Update Alex Chen follow-up title',language:'en'},
    {app:{},database,gateway,listOpenActions:async()=>{listCalls++;return {rows:[]};}});
  assert.equal(result.status,'needs_person_selection');assert.equal(result.candidates.length,2);
  assert.equal(result.proposal.operation,'update');assert.equal(result.execution.businessDataWritten,false);
  assert.equal(listCalls,0);
});

test('target list re-resolves the selected Person and returns bounded, disclosed open Actions',async()=>{
  const refs=[];let listCalls=0;
  const result=await listActionTargets({personMention:'Alex Chen (North)',selectedPersonId:'7'}, {
    searchData:{},commandData:{},
    resolveName:async(name)=>{assert.equal(name,'Alex Chen (North)');return {candidates:[{id:7,displayName:'Alex Chen (North)'}]};},
    listOpenActions:async(id)=>{listCalls++;assert.equal(id,'7');return {rows:[{id:41,person_id:7,title:'Review renewal',status:'open'}],hasMore:false};},
    disclose:async(rows)=>{refs.push(...rows);return {status:'verified',containsTestData:false,recordCount:0,sources:[]};},
  });
  assert.equal(result.status,'targets_available');assert.equal(result.actions[0].id,41);
  assert.equal(result.execution.businessDataWritten,false);assert.equal(listCalls,1);
  assert.deepEqual(refs,[{table:'persons',id:'7'},{table:'actions',id:'41'}]);
  await assert.rejects(listActionTargets({personMention:'Alex Chen',selectedPersonId:'8'}, {
    searchData:{},commandData:{},
    resolveName:async()=>({candidates:[{id:7,displayName:'Alex Chen'}]}),
    listOpenActions:async()=>{throw new Error('must not read');},
  }),{code:'INVALID_INPUT'});
  await assert.rejects(listActionTargets({personMention:'Alex Chen',selectedPersonId:'7'}, {
    searchData:{},commandData:{},resolveName:async()=>({candidates:[{id:7,displayName:'Alex Chen'}],hasMore:true}),
    listOpenActions:async()=>{throw new Error('must not read incomplete identity candidates');},
  }),{code:'INVALID_INPUT'});
});

test('plan payload is bound to the exact selected Person and Action; server rejects unlisted fields',async()=>{
  const calls=[];
  const data={run:async(...args)=>{calls.push(args);return {ok:true,status:'planned',commandId:'cmd'};}};
  const result=await runActionCommand({action:'command',stage:'plan',command:{operation:'update',resource:'actions',
    personId:7,targetActionId:41,changes:{title:'Review renewal'}}},'actor-1',{data});
  assert.equal(calls[0][1],'actor-1');assert.equal(calls[0][2].personId,7);
  assert.equal(calls[0][2].operation,'update');assert.equal(calls[0][2].targetActionId,41);
  assert.deepEqual(calls[0][2].draft,{title:'Review renewal'});
  assert.equal(result.execution.businessDataWritten,false);assert.equal(result.execution.businessDataRead,true);
  await assert.rejects(runActionCommand({action:'command',stage:'plan',command:{operation:'update',resource:'actions',
    personId:7,targetActionId:41,changes:{status:'completed'}}},'actor-1',{data}),{code:'INVALID_COMMAND'});
  const close=await runActionCommand({action:'command',stage:'plan',command:{operation:'close',resource:'actions',
    personId:7,targetActionId:41,changes:{}}},'actor-1',{data});
  assert.equal(close.status,'planned');assert.deepEqual(calls[1][2].draft,{});
});

test('adapter sends operation in the public RPC and limits target reads to the selected Person',async()=>{
  const requests=[];
  const data=createActionCommandData({env:'crm-d1gkae8ddc930d151',key:'fixture-only',fetchImpl:async(url,options)=>{
    requests.push({url:String(url),options});
    if(String(url).includes('/rpc/'))return {ok:true,json:async()=>({ok:true,status:'planned'})};
    return {ok:true,json:async()=>[{id:41,person_id:7,title:'Review renewal',status:'open'}]};
  }});
  await data.run('plan','actor-1',{personId:7,operation:'close',targetActionId:41,draft:{}});
  assert.deepEqual(JSON.parse(requests[0].options.body).p_draft,
    {operation:'close',targetActionId:41,changes:{}});
  const list=await data.listOpenActions(7);
  assert.equal(list.rows.length,1);assert.equal(list.hasMore,false);
  const url=new URL(requests[1].url);
  assert.equal(url.searchParams.get('person_id'),'eq.7');
  assert.equal(url.searchParams.get('status'),'in.(open,in_progress)');
  await assert.rejects(data.listOpenActions(0),/Invalid Person reference/);
});

test('assistant requires real login for parse, target lookup and all command stages',async()=>{
  let calls=0;
  const main=createMain(()=>({uid:'x',isAnonymous:true}),undefined,undefined,undefined,undefined,
    async()=>{calls++;return {ok:true};},async()=>{calls++;return {ok:true};});
  for(const event of [
    {action:'actionCommandInterpret',query:'update Alex action'},
    {action:'actionCommandTargets',personMention:'Alex',selectedPersonId:'7'},
    {action:'command',stage:'plan',command:{operation:'close',resource:'actions',personId:7,targetActionId:41,changes:{}}},
  ]) assert.equal((await main(event)).error.code,'UNAUTHORIZED');
  assert.equal(calls,0);
});
