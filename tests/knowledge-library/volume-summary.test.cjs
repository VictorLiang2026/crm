'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createKnowledgeLibrary}=require('../../cloudfunctions/assistant/knowledge-library-service');

function fixture({ready=true,summaryReady=true,gptSummary=null,gptVersion=0,missingOriginal=false}={}){
  const document={id:'700',title:'Multi-volume test document',part_count:2,original_ready:ready,
    gpt_summary:gptSummary,gpt_basis:null,gpt_version:gptVersion};
  const sources=[1,2].map(part=>({id:String(part),metadata:{document:{number:'700',part,total:2}}}));
  const items=sources.map((source,index)=>({id:String(51+index),source_id:source.id,
    content:missingOriginal&&index===1?'':`System original volume ${index+1}`,
    metadata:summaryReady?{summary:`System volume summary ${index+1}`}:{},content_state:{},
    supersedes_id:null,lifecycle_status:'verified'}));
  const tables={knowledge_documents:[document],knowledge_sources:sources,knowledge_items:items};
  const overview={id:'700',title:document.title,total:2,originalReady:true,gptVersion,basis:'basis-v1',gpt:null,
    parts:sources.map((source,index)=>({itemId:String(51+index),sourceId:source.id,part:index+1,
      summary:summaryReady?`System volume summary ${index+1}`:''}))};
  const appliedFilters=(row,params)=>[...params.entries()].every(([key,filter])=>{
    if(['select','order','limit','offset'].includes(key))return true;
    const actual=key.startsWith('metadata->document->>')?
      row.metadata?.document?.[key.slice('metadata->document->>'.length)]:row[key];
    if(filter==='is.null')return actual==null;
    if(filter.startsWith('eq.'))return String(actual)===(filter.slice(3));
    if(filter.startsWith('gt.'))return Number(actual)>Number(filter.slice(3));
    if(filter.startsWith('in.('))return filter.slice(4,-1).split(',').includes(String(actual));
    return false;
  });
  const fetchImpl=async(urlValue,options={})=>{
    const url=new URL(urlValue),table=url.pathname.split('/').pop(),rows=tables[table]||[];
    const params=url.searchParams;
    let matched=rows.filter(row=>appliedFilters(row,params));
    if(options.method==='PATCH'){
      const patch=JSON.parse(options.body);
      for(const row of matched)Object.assign(row,patch);
    }
    const offset=Number(params.get('offset')||0),limit=Number(params.get('limit')||matched.length||0);
    matched=matched.slice(offset,offset+limit);
    return new Response(JSON.stringify(matched),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const aiInputs=[],gatewayConfigs=[];
  const service=createKnowledgeLibrary({env:'crm-test',key:'test-key',fetchImpl,
    client:{callFunction:async()=>({result:{}})},
    searchDataFactory:()=>({auditRdb:{rpc:async(name,args)=>{
      assert.equal(name,'crm_knowledge_document_read_v1');assert.equal(args.p_document,700);
      return {data:overview};
    }}}),
    gatewayFactory:config=>{
      gatewayConfigs.push(config);
      return {runAITask:async input=>{
        aiInputs.push(input.context.document.text);
        return {result:{summary:'Verified GPT total summary'},taskId:'task-7',resultId:'result-8'};
      }};
    }});
  return {service,tables,aiInputs,gatewayConfigs,overview};
}

test('multi-volume listing exposes stable document and child IDs with readiness and total-summary coverage',async()=>{
  const f=fixture();
  const result=await f.service.run({operation:'volumeDocumentsList',data:{offset:0,limit:10}},'crm-volume-user');
  assert.equal(result.ok,true);
  assert.deepEqual(result.rows.map(({documentId,partCount,originalReady,systemSummariesReady,volumeKnowledgeItemIds,
    gptTotalSummaryPresent,gptVersion,partStatuses})=>({documentId,partCount,originalReady,systemSummariesReady,volumeKnowledgeItemIds,
    gptTotalSummaryPresent,gptVersion})),[{
    documentId:'700',partCount:2,originalReady:true,systemSummariesReady:true,
    volumeKnowledgeItemIds:['51','52'],gptTotalSummaryPresent:false,gptVersion:0,
  }]);
  assert.deepEqual(result.coverage,{offset:0,limit:10,hasMore:false,nextOffset:1});
  assert.deepEqual(result.volumeSources,[
    {sourceId:'1',documentId:'700',part:1,total:2},{sourceId:'2',documentId:'700',part:2,total:2},
  ]);
  assert.deepEqual(result.volumeSourceCoverage,{offset:0,limit:10,hasMore:false,nextOffset:2});
});

test('GPT total summary uses the complete stored original and saves to the exact document with version guard',async()=>{
  const f=fixture();
  const result=await f.service.run({operation:'volumeDocumentSummaryGenerate',data:{documentId:'700',expectedGptVersion:0}},'crm-volume-user');
  assert.deepEqual(result,{ok:true,status:'saved',documentId:'700',gptVersion:1,taskId:'task-7',resultId:'result-8'});
  assert.deepEqual(f.aiInputs,['System original volume 1\n\nSystem original volume 2']);
  assert.equal(f.tables.knowledge_documents[0].gpt_summary,'Verified GPT total summary');
  assert.equal(f.tables.knowledge_documents[0].gpt_basis,'basis-v1');
  assert.equal(f.tables.knowledge_documents[0].gpt_version,1);
  assert.equal(f.gatewayConfigs[0].timeoutMs,120000);
  const readback=await f.service.run({operation:'volumeDocumentGet',data:{documentId:'700'}},'crm-volume-user');
  assert.equal(readback.document.gptTotalSummaryPresent,true);
  assert.equal(readback.document.gptTotalSummary,'Verified GPT total summary');
  assert.equal(Object.hasOwn(readback.document,'chunks'),false);
});

test('incomplete originals, incomplete volume summaries, existing summaries, and stale versions stop safely',async()=>{
  for(const options of [{ready:false},{missingOriginal:true},{summaryReady:false}]){
    const f=fixture(options);
    await assert.rejects(f.service.run({operation:'volumeDocumentSummaryGenerate',data:{documentId:'700',expectedGptVersion:0}},
      'crm-volume-user'),error=>['DOCUMENT_ORIGINAL_INCOMPLETE','DOCUMENT_VOLUME_SUMMARY_INCOMPLETE'].includes(error.code));
    assert.equal(f.aiInputs.length,0);
  }
  const existing=fixture({gptSummary:'Already saved'});
  const skipped=await existing.service.run({operation:'volumeDocumentSummaryGenerate',data:{documentId:'700',expectedGptVersion:0}},'crm-volume-user');
  assert.equal(skipped.reason,'GPT_TOTAL_SUMMARY_EXISTS');
  assert.equal(existing.aiInputs.length,0);
  const stale=fixture({gptVersion:2});
  await assert.rejects(stale.service.run({operation:'volumeDocumentSummaryGenerate',data:{documentId:'700',expectedGptVersion:1}},
    'crm-volume-user'),{code:'DOCUMENT_STALE'});
  assert.equal(stale.aiInputs.length,0);
});
