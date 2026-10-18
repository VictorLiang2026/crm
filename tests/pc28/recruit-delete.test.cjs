'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createMain}=require('../../cloudfunctions/assistant');
const {explicitSingleCandidate,validateProposal,interpretRecruitDelete,listRecruitDeleteTargets}=
  require('../../cloudfunctions/assistant/recruit-delete-intent-service');
const {commandOf,runRecruitDeleteCommand}=require('../../cloudfunctions/assistant/recruit-delete-command-service');
const {createRecruitDeleteCommandData}=require('../../cloudfunctions/assistant/recruit-delete-command-data');
const key='11111111-1111-4111-8111-111111111111';
const actor='fixture-actor';
const proposal={status:'supported',operation:'delete',interpretation:'Delete one candidate',
  personMention:'Fictional Lin',candidateMention:'the recruit candidate'};

test('only an explicit single recruit-candidate delete reaches the model',async()=>{
  const intentSource=fs.readFileSync(path.resolve(__dirname,'../../cloudfunctions/assistant/recruit-delete-intent-service.js'),'utf8');
  assert.match(intentSource,/timeoutMs:60000,maxAttempts:1/);
  for(const query of ['删除人物','delete all candidates','永久删除候选人','删除客户候选人',
    'delete the opportunity','drop database','删除 Action','删除所有增员候选人'])
    assert.equal(explicitSingleCandidate(query),false,query);
  assert.equal(explicitSingleCandidate('删除增员候选人 Fictional Lin'),true);
  assert.equal(explicitSingleCandidate('删除虚构人物乙的增员候选人'),true);
  assert.equal(explicitSingleCandidate('删除人物和候选人'),false);
  let calls=0;
  const denied=await interpretRecruitDelete({query:'删除人物 Fictional Lin'},
    {gateway:{runAITask:async()=>{calls++;}}});
  assert.equal(denied.status,'unsupported');assert.equal(calls,0);
});

test('model proposal cannot select IDs or an unsupported resource',async()=>{
  assert.equal(validateProposal(proposal).personMention,'Fictional Lin');
  assert.equal(validateProposal({...proposal,interpretation:'x'.repeat(358)}).interpretation.length,358);
  assert.throws(()=>validateProposal({...proposal,interpretation:'x'.repeat(601)}),{code:'INVALID_RESULT'});
  const intentSource=fs.readFileSync(path.resolve(__dirname,'../../cloudfunctions/assistant/recruit-delete-intent-service.js'),'utf8');
  assert.match(intentSource,/server checks Person-only eligibility/);
  assert.match(intentSource,/Person 360 is literal name text/);
  const registry=require('../../cloudfunctions/assistant/skill-registry').defaultRegistry;
  assert.equal(registry.get('assistant_recruit_delete_v1').version,'1.0.1');
  assert.equal(registry.validateOutput('assistant_recruit_delete_v1',
    {...proposal,interpretation:'x'.repeat(358)}),true);
  for(const bad of [{...proposal,candidateId:20},{...proposal,personMention:'#786'},
    {...proposal,operation:'remove'},{...proposal,candidateMention:'123'}])
    assert.throws(()=>validateProposal(bad),{code:'INVALID_RESULT'});
  const resolved=await interpretRecruitDelete({query:'Delete recruit candidate Fictional Lin',language:'en'},
    {app:{},database:{auditRdb:{},resolveName:async()=>({candidates:[
      {id:786,displayName:'【系统测试·勿联系】虚构人物'}]})},
      gateway:{runAITask:async({taskType})=>{assert.equal(taskType,'assistant_recruit_delete_v1');
        return {taskId:1,resultId:2,result:proposal};}}});
  assert.equal(resolved.status,'needs_person_selection');
  assert.equal(resolved.execution.businessDataWritten,false);
});

test('target selection re-resolves exact Person and lists only Person-only candidates',async()=>{
  const out=await listRecruitDeleteTargets({personMention:'Fictional Lin',selectedPersonId:'786'},actor,{
    resolveName:async()=>({candidates:[{id:786,displayName:'【系统测试·勿联系】虚构人物'}]}),
    listActive:async(id,uid)=>{assert.deepEqual([id,uid],['786',actor]);return {rows:[
      {id:20,person_id:786,customer_id:null,stage:'初次面谈',deleted_at:null}],hasMore:false};},
    disclose:async()=>({containsTestData:true})});
  assert.equal(out.candidates[0].id,20);
  await assert.rejects(listRecruitDeleteTargets({personMention:'Fictional Lin',selectedPersonId:'785'},actor,{
    resolveName:async()=>({candidates:[{id:786,displayName:'Fictional'}]}),
    listActive:async()=>{throw Error('not reached');}}),{code:'INVALID_INPUT'});
});

test('Command stages validate exact resource, actor, key and preview token',async()=>{
  const calls=[];const data={run:async(...args)=>{calls.push(args);
    return {ok:true,status:args[0]==='plan'?'planned':args[0]==='preview'?'previewed':
      args[0]==='confirm'?'confirmed':'executed',replayed:false};}};
  const command={resource:'recruit_candidates',operation:'delete',personId:786,candidateId:20,
    personMention:'Fictional Lin',requestText:'Delete recruit candidate Fictional Lin'};
  const deps={data,resolveName:async()=>({candidates:[{id:786}]})};
  for(const event of [
    {action:'recruitDeleteCommand',stage:'plan',idempotencyKey:key,command},
    {action:'recruitDeleteCommand',stage:'preview',commandId:key},
    {action:'recruitDeleteCommand',stage:'confirm',commandId:key,previewHash:'a'.repeat(32)},
    {action:'recruitDeleteCommand',stage:'execute',commandId:key}])
    await runRecruitDeleteCommand(event,actor,deps);
  assert.deepEqual(calls.map(x=>x[0]),['plan','preview','confirm','execute']);
  assert.equal(calls[0][2].personMention,'Fictional Lin');
  for(const bad of [{...command,resource:'persons'},{...command,customerId:9},
    {...command,operation:'purge'},{...command,requestText:'Hello'}])
    await assert.rejects(runRecruitDeleteCommand({action:'recruitDeleteCommand',stage:'plan',
      idempotencyKey:key,command:bad},actor,deps),{code:'INVALID_COMMAND'});
  await assert.rejects(runRecruitDeleteCommand({action:'recruitDeleteCommand',stage:'execute',
    commandId:key,confirmed:true},actor,deps),{code:'INVALID_COMMAND'});
});

test('adapter uses public RPC with server key; test account target scope is restricted',async()=>{
  const seen=[];
  const adapter=createRecruitDeleteCommandData({env:'crm-d1gkae8ddc930d151',key:'fixture-key',
    fetchImpl:async(url,options)=>{seen.push({url:String(url),options});
      return new Response(JSON.stringify({ok:true,status:'planned',commandId:key}),{status:200});}});
  await adapter.run('plan',actor,{personId:786,candidateId:20,requestText:'Delete candidate',
    personMention:'Fictional Lin',idempotencyKey:key});
  assert.match(seen[0].url,/\/rpc\/assistant_recruit_delete_command_v1$/);
  assert.equal(seen[0].options.headers['Content-Profile'],'public');
  assert.equal(JSON.parse(seen[0].options.body).p_person_mention,'Fictional Lin');
  assert.equal(seen[0].options.headers.Authorization,'Bearer fixture-key');
});

test('assistant requires login before PC28 routes and leaves legacy command separate',async()=>{
  let routed=0;
  const args=[async()=>({uid:actor,isAnonymous:false}),undefined,undefined,undefined,
    undefined,undefined,undefined,undefined,undefined,undefined,
    async()=>{routed++;return {ok:true}},async()=>{routed++;return {ok:true}},
    async()=>{routed++;return {ok:true}}];
  const main=createMain(...args);
  assert.equal((await main({action:'recruitDeleteInterpret',query:'Delete candidate'})).ok,true);
  assert.equal((await main({action:'recruitDeleteTargets',personMention:'Fictional',selectedPersonId:'786'})).ok,true);
  assert.equal((await main({action:'recruitDeleteCommand',stage:'execute',commandId:key})).ok,true);
  assert.equal(routed,3);
  const anonymous=createMain(async()=>({uid:actor,isAnonymous:true}),...args.slice(1));
  assert.equal((await anonymous({action:'recruitDeleteCommand',stage:'execute',commandId:key})).error.code,'UNAUTHORIZED');
});

test('PC28 projects only business inputs from runtime envelope and rejects forged control fields',async()=>{
  const seen=[];let dataCalls=0;
  const main=createMain(async()=>({uid:actor,isAnonymous:false}),...Array(9).fill(undefined),
    async event=>{seen.push(event);return {ok:true};},
    async event=>{seen.push(event);return {ok:true};},
    async (event,uid)=>{seen.push(event);return runRecruitDeleteCommand(event,uid,{
      data:{run:async()=>{dataCalls++;return {ok:true,status:'previewed',replayed:false};}}});});
  const context=['runtime-secret-fixture'];
  for(const event of [
    {action:'recruitDeleteInterpret',query:'删除增员候选人 Fictional Lin',language:'zh-CN'},
    {action:'recruitDeleteTargets',personMention:'Fictional Lin',selectedPersonId:'786'},
    {action:'recruitDeleteCommand',stage:'preview',commandId:key}]){
    const result=await main({...event,TCB_CONTEXT_KEYS:context,
      platformMetadata:{token:context[0]},userInfo:{runtime:context[0]}});
    assert.equal(result.ok,true);
    assert.equal(JSON.stringify(result).includes(context[0]),false);
  }
  assert.equal(seen.length,3);
  for(const event of seen){
    assert.equal(Object.hasOwn(event,'TCB_CONTEXT_KEYS'),false);
    assert.equal(Object.hasOwn(event,'platformMetadata'),false);
    assert.equal(Object.hasOwn(event,'userInfo'),false);
  }
  assert.equal((await main({action:'recruitDeleteInterpret',query:'删除候选人',language:'zh-CN',actorUid:'forged',
    TCB_CONTEXT_KEYS:context})).error.code,'INVALID_INPUT');
  assert.equal((await main({action:'recruitDeleteTargets',personMention:'Fictional Lin',selectedPersonId:'786',
    candidateId:20,TCB_CONTEXT_KEYS:context})).error.code,'INVALID_INPUT');
  assert.equal((await main({action:'recruitDeleteCommand',stage:'preview',commandId:key,confirmed:true,
    TCB_CONTEXT_KEYS:context})).error.code,'INVALID_COMMAND');
  assert.equal((await main({action:'recruitDeleteInterpret',query:'删除候选人',language:'zh-CN',
    preview:{personId:786}})).error.code,'INVALID_INPUT');
  assert.equal((await main({action:'recruitDeleteCommand',stage:'preview',commandId:key,
    batchId:'forged'})).error.code,'INVALID_COMMAND');
  assert.equal(seen.length,3);
  assert.equal(dataCalls,1);
});

test('migration binds complete input, 15-minute preview, locks impact and keeps rollback audit',()=>{
  const root=path.resolve(__dirname,'../..');
  const sql=fs.readFileSync(path.join(root,'cloudbase/migrations/20261018181500_assistant_recruit_delete.sql'),'utf8');
  const rollback=fs.readFileSync(path.join(root,'cloudbase/rollbacks/20261018181500_assistant_recruit_delete.sql'),'utf8');
  for(const needle of ['public.assistant_recruit_delete_commands','person_mention',
    'idempotency_key uuid NOT NULL UNIQUE',"interval '15 minutes'",'FOR UPDATE',
    'impact_snapshot','confirmed_by_uid','public.crm_person_only_recruit_delete_v1',
    'public.crm_test_records','v_deleted_count<>cardinality(v_active_ids)'])
    assert.ok(sql.includes(needle),needle);
  assert.match(sql,/FORCE ROW LEVEL SECURITY/);
  assert.match(sql,/GRANT EXECUTE[\s\S]*TO service_role/);
  assert.match(rollback,/executor disabled/);
  assert.doesNotMatch(rollback,/DROP\s+(TABLE|FUNCTION)/i);
  assert.doesNotMatch(sql,/\bpr\./i);
});
