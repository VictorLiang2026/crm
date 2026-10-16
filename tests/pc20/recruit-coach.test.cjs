'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {coachOutput,generate,decide,history}=require('../../cloudfunctions/assistant/recruit-coach-service');

const context={
  candidate:{data:{stage:'新增人才',motivation:'想了解职业方向'},source:{schema:'public',table:'recruit_candidates',id:'17'}},
  recruit_followups:[{data:{followup_date:'2026-10-15',interaction_summary:'已约定下次沟通'},source:{schema:'public',table:'recruit_followups',id:'31'}}],
  sourceRefs:[{schema:'public',table:'recruit_candidates',id:'17'},{schema:'public',table:'recruit_followups',id:'31'}],
};
function rawResult(){
  const keys=['industry_resources','learning_ability','resilience','communication','entrepreneurial_motivation','cultural_fit'];
  return {assessment:'Review with the candidate.',dimensions:keys.map((key,index)=>({key,
    score:index<4?70+index:null,rationale:'Supported by the cited record.',
    evidenceRefs:index===5?['public.persons#999']:['public.recruit_candidates#17']})),
    contactSuggestion:{assumptionReasons:['The candidate asked to learn more.'],clarifyingQuestions:['What information would help?'],
      prohibitedPhrasing:['Do not promise income.'],nextStep:'Ask which topic they want to explore.'},
    uncertainty:'Two dimensions lack evidence.',confidence:'medium'};
}

test('six legacy dimensions retain weights and unsupported claims are removed',()=>{
  const result=coachOutput(rawResult(),context);
  assert.deepEqual(result.dimensions.map(x=>x.weight),[25,15,20,15,15,10]);
  assert.deepEqual(result.dimensions.slice(0,4).map(x=>x.score),[70,71,72,73]);
  assert.equal(result.dimensions[4].score,null);
  assert.equal(result.dimensions[5].score,null);
  assert.equal(result.totalScore,71);
  assert.equal(result.confidence,'low');
  assert.equal(result.uncertaintyCode,'pc20_uncertain');
  assert.deepEqual(result.sourceRefs,['public.recruit_candidates#17']);
  assert.equal(result.evidenceSources.length,1);
});

test('generation sends only candidate-scoped allowlisted context through the Gateway',async()=>{
  let request;
  const gateway={runAITask:async value=>{request=value;return{taskId:3,resultId:4,result:rawResult()};}};
  const result=await generate({personId:'8',candidateId:'17',language:'en'},
    {gateway,contextLoader:async(action,personId,candidateId)=>{
      assert.equal(action,'getRecruitCoachContext');assert.equal(personId,'8');assert.equal(candidateId,'17');return context;
    }});
  assert.equal(request.taskType,'recruit_coach');
  assert.equal(request.subjectType,'candidate');
  assert.equal(request.subjectId,'17');
  assert.equal(request.input.language,'en');
  assert.deepEqual(Object.keys(request.context).sort(),['candidate','guidance','recruit_followups']);
  assert.equal(result.execution.businessDataWritten,false);
  assert.equal(result.result.totalScore,71);
});

test('human decisions are bound to the selected candidate and result task',async()=>{
  const calls=[];
  const request=async(table,method,filters,body)=>{
    calls.push({table,method,filters,body});
    if(table==='ai_results'&&method==='GET')return[{id:4,task_id:3,result_json:rawResult()}];
    if(table==='ai_tasks')return[{id:3,task_type:'recruit_coach',skill_name:'recruit_coach',subject_type:'candidate',subject_id:'17'}];
    if(table==='ai_results'&&method==='PATCH')return[{id:4}];
    return[];
  };
  const options={request,contextLoader:async()=>context};
  const result=await decide({personId:'8',candidateId:'17',resultId:'4',decision:'modified',
    contactSuggestion:{assumptionReasons:['Original assumption'],clarifyingQuestions:['Original question'],
      prohibitedPhrasing:['Original restriction'],nextStep:'Human edited next step'}},options);
  assert.equal(result.decision,'modified');
  assert.equal(calls.at(-1).body.user_selected,true);
  assert.equal(calls.at(-1).body.user_edited,true);
  assert.equal(calls.at(-1).body.final_result_json.contactSuggestion.nextStep,'Human edited next step');
  calls.length=0;
  await assert.rejects(decide({personId:'8',candidateId:'18',resultId:'4',decision:'accepted'},options));
  assert.equal(calls.some(call=>call.method==='PATCH'),false);
});

test('history returns versioned history for only the bound candidate',async()=>{
  const result=await history({personId:'8',candidateId:'17'},{contextLoader:async()=>context,
    request:async(table)=>table==='ai_tasks'?[{id:3,created_at:'2026-10-16T00:00:00Z'}]:
      [{id:4,task_id:3,result_json:rawResult(),feedback:'PC20:accepted',created_at:'2026-10-16T00:01:00Z'}]});
  assert.equal(result.history.length,1);
  assert.equal(result.history[0].decision,'accepted');
  assert.equal(result.history[0].result.dimensions.length,6);
  assert.equal(result.execution.businessDataWritten,false);
});
