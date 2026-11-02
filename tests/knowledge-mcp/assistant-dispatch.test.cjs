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
