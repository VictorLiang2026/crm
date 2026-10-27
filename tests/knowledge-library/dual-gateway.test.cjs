'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAIGateway } = require('../../cloudfunctions/assistant/ai-gateway');

const strategy = {candidateType:'strategy_based',summary:'Strategy summary',reasoning:'Strategy reasoning',
  clarifyingQuestions:['Ask about timing'],nextAction:'Schedule a review',messageDraft:'Would a review help?',
  boundaryNotes:['General guidance'],sourceRefs:[],matchStatus:'no_matching_sources'};
const library = {...strategy,candidateType:'library_based',summary:'Library summary',reasoning:'Use verified sources'};

test('dual follow-up writes exactly two ranked candidates and preserves strategy/library order', async () => {
  const audit = { tasks:[], runs:[], candidates:null, failedWrites:0 };
  const store = {
    async createTask() { throw new Error('legacy task insert must not be used'); },
    async updateTask() {}, async createRun(row) { audit.runs.push(row); return 34; }, async updateRun() {},
    async createResult() { throw new Error('single-result insert must not be used'); },
    async claimTask(row) { audit.tasks.push(row); return {status:'claimed',taskId:'12'}; },
    async finishAttempt() { audit.failedWrites++; throw new Error('single-result finalizer must not be used'); },
    async finishDualAttempt(row) {
      audit.candidates = row.candidates;
      return {status:'completed',taskId:'12',runId:'34',resultIds:['56','57']};
    },
  };
  const app = { ai:() => ({createModel:() => ({generateText:async () => ({
    text:JSON.stringify({candidates:[library,strategy]}),usage:{input_tokens:10,output_tokens:20},
  })})}) };
  const context = {customer_snapshot:{person:{display_name:'Example'}},recruit_context:null,
    strategy_sources:[],library_sources:[],strategy_guidance:'General practice',library_guidance:'Verified company sources',
    guardrails:'Do not invent.'};
  const gateway = createAIGateway({app,store,timeoutMs:60000,maxAttempts:1,modelResolver:()=> 'configured',
    actorResolver:async()=>({uid:'operator-1',isAnonymous:false})});
  const result = await gateway.runAITask({taskType:'customer_followup_dual',skill:'dual_followup',capability:'coaching',
    subjectType:'person',subjectId:'99',input:{personId:'99'},context,
    contextSnapshot:{...context,_context:{recipe:'dual_followup',version:'1.1.0'}}});
  assert.deepEqual(result.result.candidates.map(row=>row.candidateType),['strategy_based','library_based']);
  assert.deepEqual(result.resultIds,['56','57']);
  assert.deepEqual(audit.candidates.map(row=>row.candidateType),['strategy_based','library_based']);
  assert.equal(audit.failedWrites,0);
  assert.equal(audit.tasks.length,1);
  assert.match(audit.tasks[0].task.context_snapshot._skill.name,/dual_followup/);
});
