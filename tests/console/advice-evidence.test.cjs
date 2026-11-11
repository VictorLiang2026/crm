'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {readScenarioKnowledge,knowledgeSnapshot}=require('../../cloudfunctions/assistant/scenario-knowledge');
const {history,decide}=require('../../cloudfunctions/assistant/recruit-coach-service');
test('scenario eligibility follows reviewed selected content, source validity, category and test provenance',async()=>{
  const item={id:1,verified:true,lifecycle_status:'verified',source:'Example',content:'Approved reference',metadata:{categories:['recruitment_case']}};
  const rows=[item,{...item,id:2,verified:false},{...item,id:3,source_id:17},{...item,id:4,metadata:{categories:['marketing_activity']}},
    {...item,id:5,selected_content_source:'gpt',gpt_summary:'unreviewed'},{...item,id:6,source_id:18},{...item,id:7}];
  const options={env:'crm-fixture',key:'fixture',today:'2026-11-11',
    fetchImpl:async url=>({ok:true,json:async()=>url.pathname.endsWith('knowledge_sources')?
      [{id:17,lifecycle_status:'verified',valid_to:'2026-11-10'},{id:18,lifecycle_status:'verified',valid_from:'2026-11-12'}]:rows}),
    check:async refs=>({status:'verified',containsTestData:refs.some(r=>r.id==='7')})};
  const recruit=await readScenarioKnowledge('recruitment',options);
  assert.deepEqual(recruit.map(r=>r.id),['1']);assert.equal(recruit[0].checkedOn,options.today);
  assert.deepEqual((await readScenarioKnowledge('activity',options)).map(r=>r.id),['4']);
  assert.deepEqual(await knowledgeSnapshot('activity',{...options,check:async()=>({status:'unverified'})}),{status:'unavailable',sources:[]});
  for(const f of ['scenario-knowledge.js','knowledge-content.js']) {
    const source=folder=>fs.readFileSync(path.resolve(__dirname,'../../cloudfunctions',folder,f),'utf8').replace(/\r/g,'');
    assert.equal(source('assistant'),source('ai_activity'));
  }
});
test('recruitment history never refreshes facts from today and rejects conflicting second decisions',async()=>{
  const candidate={source:{schema:'public',table:'recruit_candidates',id:'17'},data:{stage:'Earlier'},updatedAt:'2026-11-01'};
  const raw={dimensions:[{key:'entrepreneurial_motivation',score:75,evidenceRefs:['public.recruit_candidates#17']}],contactSuggestion:{}};
  const current={...candidate,data:{stage:'Today'}};
  const options={contextLoader:async()=>({candidate:current,sourceRefs:[current.source],recruit_followups:[]}),
    request:async table=>table==='ai_tasks'?[{id:5,task_type:'recruit_coach',skill_name:'recruit_coach',subject_type:'candidate',subject_id:'17',context_snapshot:{candidate,recruit_followups:[]}}]:
      table==='outcomes'?[{id:90,ai_result_id:6,result:'Observed',occurred_at:'2026-11-03'},{id:91,ai_result_id:30,result:'Other advice'}]:
      [{id:6,task_id:5,result_json:raw,feedback:'PC20:accepted'}]};
  const item=(await history({personId:'3',candidateId:'17'},options)).history[0];
  assert.deepEqual(item.outcomes.map(o=>o.result),['Observed']);
  assert.match(JSON.stringify(item.result.evidenceSources),/Earlier/);assert.doesNotMatch(JSON.stringify(item),/Today/);
  await assert.rejects(decide({personId:3,candidateId:17,resultId:6,decision:'rejected'},options),e=>e.code==='STALE');
});

test('GPT confirm rejects a changed or withdrawn cited document between preview and commit',async()=>{
  const {createKnowledgeLibrary}=require('../../cloudfunctions/assistant/knowledge-library-service');
  const id='6f680048-693c-4b2e-bfa4-03e417a146b5';
  for(const mode of ['changed','withdrawn','current']){
    let committed=false;
    const digest=require('node:crypto').createHash('sha256').update(JSON.stringify(['Original',''])).digest('hex');
    const ref={id:'5',sourceId:null,versionNo:1,contentVersion:0,contentSource:'original',contentDigest:digest};
    const advice={id:8,person_id:7,system_version:1,system_status:'ready',gpt_preview_expires_at:new Date(Date.now()+60000).toISOString(),
      gpt_preview_payload:{systemVersion:1,strategy:'Follow up',product:'Check',strategySources:[],productSources:[ref]}};
    const rows=mode==='withdrawn'?[]:[{id:5,verified:true,lifecycle_status:'verified',content:mode==='changed'?'Changed':'Original',metadata:{domain:'product'}}];
    const service=createKnowledgeLibrary({env:'crm-fixture',key:'fixture',testDataReader:async()=>({status:'verified',containsTestData:false}),
      client:{callFunction(){}},fetchImpl:async(url,options)=>{
        if(options.method==='PATCH')committed=true;
        const result=url.pathname.endsWith('/knowledge_items')?rows:[advice];
        return {ok:true,text:async()=>JSON.stringify(result)};
      }});
    const req=service.confirmGptImport({adviceId:8,personId:7,systemVersion:1,confirmed:true,previewId:id},'operator');
    if(mode==='current')await req;else await assert.rejects(req,e=>e.code==='STALE');
    assert.equal(committed,mode==='current');
  }
});
