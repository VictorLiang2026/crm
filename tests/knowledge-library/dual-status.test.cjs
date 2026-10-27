'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');

const servicePath=path.resolve(__dirname,'../../cloudfunctions/assistant/knowledge-library-service.js');
const serviceModule=new Module(servicePath,module);
serviceModule.filename=servicePath;
serviceModule.paths=Module._nodeModulePaths(path.dirname(servicePath));
const originalRequire=serviceModule.require.bind(serviceModule);
serviceModule.require=(request)=>request==='./db'
  ?{app:{callFunction:async()=>({result:{}})}}
  :originalRequire(request);
serviceModule._compile(fs.readFileSync(servicePath,'utf8'),servicePath);
const {createKnowledgeLibrary}=serviceModule.exports;

test('dual status returns only the requested completed task and its two audited candidates',async()=>{
  const strategyRef={schema:'public',table:'knowledge_items',id:'10',title:'Strategy source',excerpt:'evidence'};
  const libraryRef={schema:'public',table:'knowledge_items',id:'11',title:'Library source',excerpt:'company guidance'};
  const candidate=(candidateType,sourceId)=>({candidateType,summary:`${candidateType} summary`,reasoning:'reason',
    clarifyingQuestions:['Question'],nextAction:'Review',messageDraft:'Message',boundaryNotes:[],sourceRefs:[sourceId]});
  const requests=[];
  const fetchImpl=async(url,options)=>{
    const parsed=new URL(url),table=parsed.pathname.split('/').pop(),filters=Object.fromEntries(parsed.searchParams);requests.push({table,filters,headers:options.headers});
    const rows=table==='ai_tasks'?[{id:'71',task_type:'customer_followup_dual',status:'completed',subject_type:'person',subject_id:'783',
      context_snapshot:{strategy_sources:[strategyRef],library_sources:[libraryRef]}}]:[
      {id:'81',task_id:'71',run_id:'91',rank:1,user_selected:false,user_edited:false,result_json:candidate('strategy_based','10')},
      {id:'82',task_id:'71',run_id:'91',rank:2,user_selected:false,user_edited:false,result_json:candidate('library_based','11')},
    ];
    return {ok:true,text:async()=>JSON.stringify(rows)};
  };
  const service=createKnowledgeLibrary({env:'crm-test123',key:'fictional-key',fetchImpl,callFunction:async()=>({result:{}})});
  const result=await service.dualStatus({taskId:'71',personId:'783'});
  assert.equal(result.status,'completed');
  assert.deepEqual(result.candidates.map(item=>item.candidateType),['strategy_based','library_based']);
  assert.deepEqual(result.candidates.map(item=>item.sourceRefs),[[strategyRef],[libraryRef]]);
  assert.equal(result.candidates[0].id,'81');assert.equal(result.candidates[1].id,'82');
  assert.deepEqual(requests.map(row=>row.table),['ai_tasks','ai_results']);
  assert.equal(requests[0].filters.id,'eq.71');
  assert.equal(requests[0].filters.subject_id,'eq.783');
  assert.equal(requests[0].headers['Accept-Profile'],'public');
});
