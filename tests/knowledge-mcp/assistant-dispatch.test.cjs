'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createMain}=require('../../cloudfunctions/assistant');
const {signAssertion}=require('../../cloudfunctions/assistant/knowledge-mcp-auth');

const secret='test-only-hmac-secret-with-at-least-32-characters';
process.env.CRM_KNOWLEDGE_MCP_HMAC_KEY=secret;

function makeMain(runner){
  return createMain(()=>({uid:'unused',isAnonymous:false}),...Array(13).fill(undefined),runner);
}

async function invoke(input,runner){
  const assertion=signAssertion('crm-test-user',secret,input);
  return makeMain(runner)({action:'knowledgeMcpInternal',assertion,input},{},null);
}

test('knowledge list dispatcher allowlists page fields and ignores MCP transport extras',async()=>{
  let captured;
  const result=await invoke({tool:'knowledge_records_list',sourceOffset:3,limit:40,transportTrace:'ignored'},
    async(event,actor)=>{captured={event,actor};return {ok:true,coverage:{hasMore:{sources:false,knowledge:false,playbooks:false}}};});
  assert.equal(result.ok,true);
  assert.deepEqual(captured,{event:{action:'knowledgeLibrary',operation:'list',data:{sourceOffset:3,limit:40}},actor:'crm-test-user'});
});

test('unsupported MCP operations report shape only without echoing caller values',async()=>{
  const result=await invoke({tool:'unknown_tool',secret:'do-not-return'},async()=>{throw Error('should not run');});
  assert.deepEqual(result.error,{code:'INVALID_INPUT',message:'Unsupported knowledge operation',
    diagnostic:{recognizedTool:false,toolName:'unknown_tool',fieldCount:2}});
  assert.doesNotMatch(JSON.stringify(result),/do-not-return/);
});

test('follow-up task package dispatch keeps the exact Person filter and bounded page',async()=>{
  let captured;
  const result=await invoke({tool:'followup_gpt_task_package',personId:'42',afterId:'80',limit:5},
    async(event,actor)=>{captured={event,actor};return {ok:true,count:0,rows:[]};});
  assert.equal(result.ok,true);
  assert.deepEqual(captured,{event:{action:'knowledgeLibrary',operation:'gptTaskPackage',data:{personId:'42',afterId:'80',limit:5}},actor:'crm-test-user'});
  const extra=await invoke({tool:'followup_gpt_task_package',personId:'42',limit:5,allPeople:true},
    async()=>{throw Error('must reject extra fields');});
  assert.equal(extra.error.code,'INVALID_INPUT');
});

test('follow-up preview dispatch is narrow and confirm flag is server-owned',async()=>{
  const rows=[{adviceId:'81',personId:'42',systemVersion:2,gptAdvice:{title:'标题',overallStrategy:'策略',
    productServiceAdvice:'产品建议',strategySourceIds:[],productSourceIds:[]}}];
  let captured;
  const preview=await invoke({tool:'followup_gpt_import_preview',rows},async(event,actor)=>{
    captured={event,actor};return {ok:true,rows:[{adviceId:'81',personId:'42',status:'preview',previewId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}]};
  });
  assert.equal(preview.ok,true);
  assert.deepEqual(captured.event,{action:'knowledgeLibrary',operation:'gptImportPreview',data:{rows}});
  captured=null;
  const confirmed=await invoke({tool:'followup_gpt_import_confirm',adviceId:'81',personId:'42',systemVersion:2,
    previewId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},async(event,actor)=>{
    captured={event,actor};return {ok:true};
  });
  assert.equal(confirmed.ok,true);
  assert.equal(captured.event.data.confirmed,true);
  assert.equal(captured.actor,'crm-test-user');
  const forged=await invoke({tool:'followup_gpt_import_confirm',adviceId:'81',personId:'42',systemVersion:2,
    previewId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',confirmed:true},async()=>{throw Error('client confirmation flag must not be accepted');});
  assert.equal(forged.error.code,'INVALID_INPUT');
});

test('direct follow-up GPT save dispatch accepts only the exact candidate rows',async()=>{
  const rows=[{adviceId:'81',personId:'42',systemVersion:2,gptAdvice:{title:'GPT 建议',overallStrategy:'关系策略',
    productServiceAdvice:'产品建议',strategySourceIds:[],productSourceIds:[]}}];
  let captured;
  const result=await invoke({tool:'followup_gpt_advice_save',rows},async(event,actor)=>{
    captured={event,actor};return {ok:true,savedCount:1,skippedCount:0,rows:[{adviceId:'81',personId:'42',status:'saved'}]};
  });
  assert.equal(result.ok,true);
  assert.deepEqual(captured,{event:{action:'knowledgeLibrary',operation:'gptAdviceDirectSave',data:{rows}},actor:'crm-test-user'});
  const extra=await invoke({tool:'followup_gpt_advice_save',rows,confirmed:true},async()=>{throw Error('extra field must be rejected');});
  assert.equal(extra.error.code,'INVALID_INPUT');
});
