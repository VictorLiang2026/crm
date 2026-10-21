'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {draft,commandOf,runOpportunityCommand}=require('../../cloudfunctions/assistant/opportunity-command-service');
const {validateProposal,interpretOpportunityCommand,listOpportunityTargets}=require('../../cloudfunctions/assistant/opportunity-command-intent-service');
const {createOpportunityCommandData}=require('../../cloudfunctions/assistant/opportunity-command-data');

const actor='fictional-actor';
const goodProposal={status:'supported',operation:'edit',interpretation:'Update the next step.',
  personMention:'Fictional Lin',opportunityMention:'insurance plan',changes:{nextAction:'Review marked fictional data',
    type:null,progress:null,nextActionDate:null,status:null}};

test('PC27 proposal permits only bounded operations and change fields',()=>{
  assert.equal(validateProposal(goodProposal).changes.nextAction,'Review marked fictional data');
  assert.equal(validateProposal({...goodProposal,operation:'close',changes:{type:null,progress:null,nextAction:null,
    nextActionDate:null,status:'关闭'}}).operation,'close');
  for(const value of [
    {...goodProposal,sql:'select * from public.opportunities'},
    {...goodProposal,changes:{...goodProposal.changes,personId:7}},
    {...goodProposal,operation:'stage',changes:{type:null,progress:null,nextAction:null,nextActionDate:null,status:'成交'}},
    {...goodProposal,operation:'close',changes:{type:'insurance',progress:null,nextAction:null,nextActionDate:null,status:'关闭'}},
    {...goodProposal,changes:{...goodProposal.changes,nextActionDate:'next Friday'}},
  ])assert.throws(()=>validateProposal(value));
  assert.throws(()=>draft('edit',{status:'成交'}));
  assert.throws(()=>draft('stage',{status:'成交'}));
  assert.throws(()=>draft('close',{status:'关闭',result:'   '}));
  assert.throws(()=>commandOf({resource:'opportunities',operation:'close',personId:'7',opportunityId:'8',
    changes:{status:'关闭',result:'x',actionId:'9'}}));
  assert.deepEqual(draft('edit',{nextActionDate:null}),{nextActionDate:null});
});

test('interpreter resolves candidates only after a supported model proposal',async()=>{
  const calls=[];
  const result=await interpretOpportunityCommand({query:'Update fictional opportunity',language:'en'}, {
    app:{},database:{auditRdb:{},resolveName:async mention=>{calls.push(mention);return {candidates:[
      {id:'71',displayName:'【系统测试·勿联系】虚构人物甲'}]};}},
    gateway:{runAITask:async input=>{assert.equal(input.taskType,'assistant_opportunity_update_v1');
      return {taskId:1,resultId:2,result:goodProposal};}},
  });
  assert.equal(result.ok,true);
  assert.equal(result.status,'needs_person_selection');assert.deepEqual(calls,['Fictional Lin']);
  assert.equal(result.execution.businessDataWritten,false);
});

test('model null placeholders are omitted from the executable patch',()=>{
  const proposal=validateProposal({status:'supported',operation:'edit',interpretation:'Update next step',
    personMention:'Fictional Person',opportunityMention:'renewal',changes:{type:null,progress:null,
      nextAction:'Call Friday',nextActionDate:null,status:null}});
  assert.deepEqual(proposal.changes,{nextAction:'Call Friday'});
});

test('target selection re-resolves Person and returns only verified opportunities',async()=>{
  let listArgs;
  const result=await listOpportunityTargets({personMention:'Fictional Lin',selectedPersonId:'71'},actor,{
    resolveName:async()=>({candidates:[{id:'71',displayName:'【系统测试·勿联系】虚构人物甲'}]}),
    listActive:async(...args)=>{listArgs=args;return {rows:[{id:91,person_id:71,customer_id:null,
      opportunity_type:'insurance',status:'发现',last_progress:'【系统测试·勿联系】虚构过程',
      next_action:'【系统测试·勿联系】核对',next_action_date:null}],hasMore:false};},
    disclose:async()=>({status:'verified',containsTestData:true,recordCount:2,sources:[]}),
  });
  assert.deepEqual(listArgs,['71',actor]);assert.equal(result.opportunities[0].id,91);
  assert.equal(result.testData.status,'verified');
  await assert.rejects(listOpportunityTargets({personMention:'Fictional Lin',selectedPersonId:'72'},actor,{
    resolveName:async()=>({candidates:[{id:'71',displayName:'Fictional'}]}),listActive:async()=>({rows:[]})}));
});

test('command stages bind actor, exact target, allowed draft and one-shot confirmation',async()=>{
  const calls=[];const data={run:async(...args)=>{calls.push(args);return {ok:true,status:args[0]==='plan'?'planned':
    args[0]==='preview'?'previewed':args[0]==='confirm'?'confirmed':'executed',replayed:false};}};
  const idempotencyKey='11111111-1111-4111-8111-111111111111';
  await runOpportunityCommand({action:'opportunityCommand',stage:'plan',idempotencyKey,
    command:{resource:'opportunities',operation:'edit',personId:'71',opportunityId:'91',
      changes:{nextAction:'【系统测试·勿联系】核对资料'}}},actor,{data});
  await runOpportunityCommand({action:'opportunityCommand',stage:'preview',commandId:idempotencyKey},actor,{data});
  await runOpportunityCommand({action:'opportunityCommand',stage:'confirm',commandId:idempotencyKey,
    previewHash:'0123456789abcdef0123456789abcdef'},actor,{data});
  await runOpportunityCommand({action:'opportunityCommand',stage:'execute',commandId:idempotencyKey},actor,{data});
  assert.deepEqual(calls.map(call=>call[0]),['plan','preview','confirm','execute']);
  assert.equal(calls[0][1],actor);assert.equal(calls[0][2].draft.nextAction,'【系统测试·勿联系】核对资料');
  await assert.rejects(runOpportunityCommand({action:'opportunityCommand',stage:'plan',idempotencyKey,
    command:{resource:'opportunities',operation:'edit',personId:'71',opportunityId:'91',changes:{status:'关闭'}}},actor,{data}));
});

test('database adapter calls only the public Assistant command RPC and validates response',async()=>{
  const seen=[];const data=createOpportunityCommandData({env:'crm-d1gkae8ddc930d151',key:'server-only-test',
    fetchImpl:async(url,options)=>{seen.push({url:String(url),options});return new Response(JSON.stringify({ok:true,status:'planned',commandId:'cmd'}),{status:200});}});
  const result=await data.run('plan',actor,{personId:71,opportunityId:91,operation:'edit',
    idempotencyKey:'11111111-1111-4111-8111-111111111111',draft:{nextAction:'fictional'}});
  assert.equal(result.status,'planned');assert.match(seen[0].url,/\/rpc\/assistant_opportunity_command_v1$/);
  assert.equal(seen[0].options.headers['Content-Profile'],'public');
  assert.equal(seen[0].options.headers.Authorization,'Bearer server-only-test');
  assert.equal(JSON.parse(seen[0].options.body).p_actor_uid,actor);
});

test('migration and rollback keep the PC15 manual flow and expose only service-role command access',()=>{
  const fs=require('node:fs');const base=__dirname+'/../../cloudbase/';
  const sql=fs.readFileSync(base+'migrations/20261017195847_assistant_opportunity_update_close.sql','utf8');
  const sqlFix=fs.readFileSync(base+'migrations/20261017202000_assistant_opportunity_command_jsonb_count_fix.sql','utf8');
  const rollback=fs.readFileSync(base+'rollbacks/20261017195847_assistant_opportunity_update_close.sql','utf8');
  for(const token of ['public.assistant_opportunity_commands','public.assistant_opportunity_command_v1',
    'public.crm_opportunity_preview_v1','public.crm_opportunity_execute_v1','FOR UPDATE',
    'customer_id IS NULL','confirmed_by_uid','expires_at','outcomeCreated'])assert.ok(sql.includes(token),token);
  assert.match(sql,/GRANT EXECUTE[\s\S]*TO service_role/);assert.match(sql,/FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sqlFix,/jsonb_object_length/);assert.match(sqlFix,/CREATE OR REPLACE FUNCTION public\.assistant_opportunity_command_v1/);
  assert.match(sqlFix,/count\(\*\) FROM jsonb_object_keys\(p_draft\)/);
  assert.match(rollback,/IF EXISTS \(SELECT 1 FROM public\.assistant_opportunity_commands\)/);
  assert.doesNotMatch(rollback,/DROP\s+(TABLE|FUNCTION)\s+public\.crm_opportunity_/i);
});
