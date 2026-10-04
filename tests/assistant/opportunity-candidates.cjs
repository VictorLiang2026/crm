'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createMain}=require('../../cloudfunctions/assistant/index');
const {buildCandidateContext,verifyCandidate}=require('../../cloudfunctions/assistant/opportunity-candidate-context');
const {runOpportunityCandidate}=require('../../cloudfunctions/assistant/opportunity-candidate-service');

function fixture(overrides={}) {
  const rows={persons:[{id:7,display_name:'测试专用人员',updated_at:'2026-10-01T00:00:00Z'}],
    interactions:[],context_items:[],activity_participants:[],activities:[],
    recruit_candidates:[],opportunities:[],followups:[],policy_review_reports:[],
    products:[],ocr_records:[],photos:[],recruit_followups:[],...overrides};
  const calls=[];
  return {calls,async read(table,filters){calls.push({table,filters});return rows[table]||[];},
    async list(){return[];},async get(){return null;},async run(operation,uid,args){
      calls.push({operation,uid,args});return {ok:true,status:operation==='create'?'draft':operation,
        candidateId:12};}};
}

test('only attended activity or insurance record is insufficient; no model or candidate write',async()=>{
  const data=fixture({activity_participants:[{id:3,activity_id:2,status:'attended'}],
    activities:[{id:2,name:'讲座',activity_date:'2026-09-30'}],products:[{id:5}]});
  const context=await buildCandidateContext(data,7);
  assert.equal(context.evidence.some(x=>x.primary),false);
  const result=await runOpportunityCandidate({action:'opportunityCandidate',operation:'generate',personId:7},
    'test-uid',{data,gateway:{runAITask(){throw Error('must not call model');}}});
  assert.equal(result.status,'insufficient_evidence');
  assert.equal(data.calls.some(x=>x.operation),false);
});

test('AI can only cite current Person evidence; it cannot directly write Opportunity',async()=>{
  const data=fixture({interactions:[{id:9,summary:'测试专用：明确表示想了解养老保障',importance:4}]});
  const gateway={async runAITask(input){
    assert.equal(input.skill,'opportunity_candidate');
    assert.equal(input.subjectId,7);
    return {taskId:1,resultId:2,result:{status:'candidate',
      opportunityType:'insurance',reason:'测试专用：养老保障沟通',
      nextAction:'先核实已有保障',confidence:0.75,sourceRefs:['public.interactions#9']}};
  }};
  const result=await runOpportunityCandidate({action:'opportunityCandidate',operation:'generate',personId:7},
    'test-uid',{data,gateway,auditRdb:{},app:{}});
  assert.equal(result.status,'draft');
  assert.deepEqual(data.calls.find(x=>x.operation==='create').args.evidence,['public.interactions#9']);
  assert.equal(data.calls.some(x=>x.operation==='execute'),false);
  assert.equal(verifyCandidate({status:'candidate',opportunityType:'insurance',reason:'x',
    nextAction:'y',sourceRefs:['public.interactions#999']},
  await buildCandidateContext(data,7)).status,'insufficient_evidence');
});

test('test account cannot generate a candidate for an untracked Person',async()=>{
  const data=fixture({crm_test_batches:[{batch_key:'crm_test_main_v1'}],crm_test_records:[]});
  await assert.rejects(()=>runOpportunityCandidate({action:'opportunityCandidate',
    operation:'generate',personId:7},'test-uid',{data,
    gateway:{runAITask(){throw Error('model must not run');}}}),
  error=>error.code==='TEST_PERSON_REQUIRED');
  assert.equal(data.calls.some(x=>x.operation==='create'),false);
});

test('tracked test candidate keeps visible marker and rejects an unmarked edit',async()=>{
  const data=fixture({persons:[{id:7,display_name:'【系统测试·勿联系】虚构人物'}],
    interactions:[{id:9,summary:'【系统测试·勿联系】虚构交流',importance:4}],
    crm_test_batches:[{batch_key:'crm_test_main_v1'}],
    crm_test_records:[{record_id:'7'}]});
  const gateway={async runAITask(){return {taskId:1,resultId:2,result:{status:'candidate',
    opportunityType:'insurance',reason:'虚构沟通依据',nextAction:'核对虚构资料',
    confidence:0.7,sourceRefs:['public.interactions#9']}};}};
  await runOpportunityCandidate({action:'opportunityCandidate',operation:'generate',personId:7},
    'test-uid',{data,gateway,auditRdb:{},app:{}});
  const saved=data.calls.find(x=>x.operation==='create').args.draft;
  assert.match(saved.reason,/【系统测试·勿联系】/);
  assert.match(saved.next_action,/【系统测试·勿联系】/);
  data.get=async()=>({person_id:7});
  await assert.rejects(()=>runOpportunityCandidate({action:'opportunityCandidate',
    operation:'edit',candidateId:12,draft:{opportunity_type:'insurance',
      reason:'去掉标记',next_action:'普通文字'}},'test-uid',{data}),/Invalid candidate/);
});

test('anonymous user and malformed edit/confirm are rejected before DB call',async()=>{
  const anonymous=createMain(()=>({uid:'anon',isAnonymous:true}),undefined,undefined,
    ()=>{throw Error('must not run');});
  assert.equal((await anonymous({action:'opportunityCandidate',operation:'execute',candidateId:12})).error.code,
    'UNAUTHORIZED');
  const data=fixture();
  await assert.rejects(()=>runOpportunityCandidate({action:'opportunityCandidate',
    operation:'edit',candidateId:12,draft:{opportunity_type:'insurance',reason:'',next_action:'x'}},
  'test-uid',{data}),/Invalid candidate/);
  await assert.rejects(()=>runOpportunityCandidate({action:'opportunityCandidate',
    operation:'confirm',candidateId:12,previewHash:'wrong'},'test-uid',{data}),/Invalid candidate/);
  assert.equal(data.calls.some(x=>x.operation),false);
});

test('promotion migration is service-only and binds preview to actor and once-only execution',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../../cloudbase/migrations/20261001090000_opportunity_candidates.sql'),'utf8');
  for(const fragment of ['FORCE ROW LEVEL SECURITY','TO service_role','p_actor_uid',
    "p_operation='confirm'","p_operation='preview'", "p_operation='execute'", 
    "v_candidate.status='created' AND p_operation='execute'",'FOR UPDATE',
    'INSERT INTO public.opportunities','UPDATE public.ai_results']) {
    assert.ok(sql.includes(fragment),fragment);
  }
  assert.ok(!sql.includes('SECURITY DEFINER'));
});
