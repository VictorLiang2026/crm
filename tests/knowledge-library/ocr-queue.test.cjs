'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createKnowledgeLibrary}=require('../../cloudfunctions/assistant/knowledge-library-service');

function rest(rows=[]){return {ok:true,status:200,text:async()=>JSON.stringify(rows)};}

test('long OCR summaries checkpoint one text segment at a time and create one review draft',async()=>{
  const source={id:82,created_by:'fixture-user',storage_key:'pg-private://knowledge-sources/82',
    file_name:'long-scan.pdf',content_type:'application/pdf',original_base64:Buffer.from('%PDF-fixture').toString('base64'),
    domain:'product',title:'Long fixture PDF',published_at:'2026-10-29',extraction_status:'extracting',deleted_at:null,
    updated_at:'2026-10-29T00:00:00.000Z',
    metadata:{categories:['on_sale_product'],ocr_job:{stage:'summarize',next_page:14,page_count:13,
      text:'长文内容。'.repeat(500),attempts:0,lease_until:null,retry_after:null}}};
  let taskNumber=0,itemPayload=null,clock=1;
  const service=createKnowledgeLibrary({env:'crm-test123',key:'server-test-key',client:{callFunction:async()=>({})},
    gatewayFactory:config=>({runAITask:async task=>{
      assert.equal(config.timeoutMs,100000);
      taskNumber++;
      assert.ok(task.context.document.text.length<1800,'summary request stays below the chunk limit plus prompt');
      return {result:{summary:`分段${taskNumber}摘要`,keyPoints:[`知识点${taskNumber}`],
        applicationNotes:[`应用${taskNumber}`],boundaries:[`边界${taskNumber}`]},taskId:100+taskNumber,resultId:200+taskNumber};
    }}),
    fetchImpl:async(url,options={})=>{
      const parsed=new URL(url);
      if(parsed.pathname.endsWith('/rpc/crm_knowledge_content_v1'))return rest({ok:true,job:null});
      if(options.method==='GET')return rest([source]);
      const body=JSON.parse(options.body);
      if(options.method==='POST'&&parsed.pathname.endsWith('/knowledge_items')){
        itemPayload=body[0];return rest([{id:902,updated_at:'2026-10-29T00:01:00.000Z'}]);
      }
      Object.assign(source,body,{updated_at:new Date(Date.UTC(2026,9,29,0,0,clock++)).toISOString()});
      return rest([{id:source.id,updated_at:source.updated_at}]);
    }});
  const options={internalOcrQueue:true};
  const first=await service.run({operation:'processOcrQueue'},'worker',options);
  assert.equal(first.stage,'summarize');assert.equal(first.completedSummaryChunks,1);
  assert.equal(source.metadata.ocr_job.summary_chunk_index,1);assert.equal(taskNumber,1);assert.equal(itemPayload,null);
  const second=await service.run({operation:'processOcrQueue'},'worker',options);
  assert.equal(second.stage,'summarize');assert.equal(second.completedSummaryChunks,2);
  assert.equal(source.metadata.ocr_job.summary_chunk_index,2);assert.equal(taskNumber,2);assert.equal(itemPayload,null);
  const final=await service.run({operation:'processOcrQueue'},'worker',options);
  assert.equal(final.stage,'complete');assert.equal(final.itemId,'902');
  assert.equal(taskNumber,2);assert.equal(source.extraction_status,'draft');assert.equal(source.metadata.ocr_job,undefined);
  assert.equal(itemPayload.verified,false);assert.equal(itemPayload.lifecycle_status,'draft');
  assert.match(itemPayload.metadata.summary,/分段1摘要[\s\S]*分段2摘要/);
  assert.deepEqual(itemPayload.metadata.extraction_task_ids,['101','102']);
  assert.deepEqual(itemPayload.metadata.extraction_result_ids,['201','202']);
});

test('OCR worker checkpoints a bounded three-page batch and resumes at the next page',async()=>{
  const source={id:77,created_by:'fixture-user',storage_key:'pg-private://knowledge-sources/77',
    file_name:'scan.pdf',content_type:'application/pdf',original_base64:Buffer.from('%PDF-fixture').toString('base64'),
    domain:'product',title:'Fixture PDF',published_at:'2026-10-29',extraction_status:'extracting',deleted_at:null,
    updated_at:'2026-10-29T00:00:00.000Z',
    metadata:{categories:['on_sale_product'],ocr_job:{stage:'ocr',next_page:1,page_count:null,text:'',attempts:0,lease_until:null,
      retry_after:null,batch_pages:3,batch_successes:0}}};
  const requests=[];let timestamp=1;
  const service=createKnowledgeLibrary({env:'crm-test123',key:'server-test-key',client:{callFunction:async()=>({})},
    fetchImpl:async(url,options={})=>{
      const parsed=new URL(url);requests.push({url:parsed,method:options.method,body:options.body?JSON.parse(options.body):null});
      if(options.method==='GET')return rest([source]);
      Object.assign(source,JSON.parse(options.body),{updated_at:new Date(Date.UTC(2026,9,29,0,0,timestamp++)).toISOString()});
      return rest([{id:source.id,updated_at:source.updated_at}]);
    }});
  const ranges=[];
  const options={internalOcrQueue:true,pdfPageRenderer:async(_bytes,{startPage,maxPages,onBatch})=>{
    ranges.push([startPage,maxPages]);
    const count=Math.min(5,startPage+maxPages-1)-startPage+1;
    await onBatch(Array.from({length:count},(_,i)=>({page:startPage+i,fileName:`${startPage+i}.jpg`,contentType:'image/jpeg',base64:'YQ=='})));
    return {pageCount:5,nextPage:Math.min(5,startPage+maxPages-1)+1};
  },ocrPdfBatch:async images=>{assert.equal(images.length,Math.min(5,ranges.at(-1)[0]+ranges.at(-1)[1]-1)-ranges.at(-1)[0]+1);return 'recognized batch '+ranges.at(-1)[0];}};
  const first=await service.run({operation:'processOcrQueue'},'worker',options);
  assert.equal(first.stage,'ocr');assert.equal(first.completedPages,3);assert.equal(first.totalPages,5);
  assert.equal(source.metadata.ocr_job.next_page,4);assert.match(source.metadata.ocr_job.text,/recognized batch 1/);
  const second=await service.run({operation:'processOcrQueue'},'worker',options);
  assert.equal(second.stage,'summarize');assert.equal(second.completedPages,5);
  assert.deepEqual(ranges,[[1,3],[4,3]]);
  assert.equal(source.metadata.ocr_job.stage,'summarize');
  assert.equal(requests.filter(x=>x.method==='PATCH').length,4);
});

test('OCR worker increases batch size after repeated successful smaller batches',async()=>{
  const source={id:83,created_by:'fixture-user',storage_key:'pg-private://knowledge-sources/83',
    file_name:'scan.pdf',content_type:'application/pdf',original_base64:Buffer.from('%PDF-fixture').toString('base64'),
    domain:'product',title:'Adaptive fixture PDF',published_at:'2026-10-29',extraction_status:'extracting',deleted_at:null,
    updated_at:'2026-10-29T00:00:00.000Z',
    metadata:{categories:['on_sale_product'],ocr_job:{stage:'ocr',next_page:1,page_count:7,text:'',attempts:0,
      lease_until:null,retry_after:null,batch_pages:1,batch_successes:0}}};
  const sizes=[];let timestamp=1;
  const service=createKnowledgeLibrary({env:'crm-test123',key:'server-test-key',client:{callFunction:async()=>({})},
    fetchImpl:async(url,options={})=>{
      if(String(url).includes('/rpc/crm_knowledge_content_v1'))return rest({ok:true,job:null});
      if(options.method==='GET')return rest([source]);
      Object.assign(source,JSON.parse(options.body),{updated_at:new Date(Date.UTC(2026,9,29,0,0,timestamp++)).toISOString()});
      return rest([{id:source.id,updated_at:source.updated_at}]);
    }});
  const options={internalOcrQueue:true,pdfPageRenderer:async(_bytes,{startPage,maxPages,onBatch})=>{
    sizes.push(maxPages);await onBatch(Array.from({length:maxPages},(_,i)=>({page:startPage+i,fileName:`${startPage+i}.jpg`,contentType:'image/jpeg',base64:'YQ=='})));
    return {pageCount:7,nextPage:Math.min(7,startPage+maxPages-1)+1};
  },ocrPdfBatch:async()=> 'recognized batch'};
  for(let i=0;i<4;i++)await service.run({operation:'processOcrQueue'},'worker',options);
  assert.deepEqual(sizes,[1,1,1,2]);
  assert.equal(source.metadata.ocr_job.batch_pages,2);
  assert.equal(source.metadata.ocr_job.next_page,6);
});

test('transient OCR timeouts retain the page cursor and back off before retrying',async()=>{
  const source={id:79,created_by:'fixture-user',storage_key:'pg-private://knowledge-sources/79',
    file_name:'scan.pdf',content_type:'application/pdf',original_base64:Buffer.from('%PDF-fixture').toString('base64'),
    domain:'product',title:'Fixture PDF',published_at:'2026-10-29',extraction_status:'extracting',deleted_at:null,
    updated_at:'2026-10-29T00:00:00.000Z',
    metadata:{categories:['on_sale_product'],ocr_job:{stage:'ocr',next_page:4,page_count:13,
      text:'recognized pages 1–3',attempts:4,lease_until:null,retry_after:null}}};
  let patches=0;
  const service=createKnowledgeLibrary({env:'crm-test123',key:'server-test-key',client:{callFunction:async()=>({})},
    fetchImpl:async(url,options={})=>{
      if(String(url).includes('/rpc/crm_knowledge_content_v1'))return {ok:true,status:200,text:async()=>JSON.stringify({ok:true,job:null})};
      if(options.method==='GET')return rest([source]);
      patches++;Object.assign(source,JSON.parse(options.body),{updated_at:'2026-10-29T00:00:01.000Z'});
      return rest([{id:source.id,updated_at:source.updated_at}]);
    }});
  const result=await service.run({operation:'processOcrQueue'},'worker',{
    internalOcrQueue:true,
    pdfPageRenderer:async(_bytes,{startPage,maxPages,onBatch})=>{
      assert.equal(maxPages,3);await onBatch([{page:startPage,fileName:'page.jpg',contentType:'image/jpeg',base64:'YQ=='}]);
      return {pageCount:13,nextPage:startPage+1};
    },
    ocrPdfBatch:async()=>{const error=new Error('timeout fixture');error.code='FUNCTIONS_TIME_LIMIT_EXCEEDED';throw error;},
  });
  assert.equal(result.retrying,true);assert.equal(result.errorCode,'FUNCTIONS_TIME_LIMIT_EXCEEDED');
  assert.ok(Date.parse(result.retryAfter)>Date.now());
  assert.equal(source.extraction_status,'extracting');
  assert.equal(source.metadata.ocr_job.attempts,5);
  assert.equal(source.metadata.ocr_job.next_page,4);
  assert.equal(source.metadata.ocr_job.batch_pages,2);
  assert.equal(source.metadata.ocr_job.text,'recognized pages 1–3');
  assert.equal(source.metadata.ocr_job.last_error,'FUNCTIONS_TIME_LIMIT_EXCEEDED');
  const later=await service.run({operation:'processOcrQueue'},'worker',{internalOcrQueue:true});
  assert.deepEqual(later,{ok:true,processed:false});
  assert.equal(patches,2);
});

test('transient summary failures use the recoverable backoff queue and preserve OCR text',async()=>{
  const source={id:80,created_by:'fixture-user',storage_key:'pg-private://knowledge-sources/80',
    file_name:'scan.pdf',content_type:'application/pdf',original_base64:Buffer.from('%PDF-fixture').toString('base64'),
    domain:'product',title:'Fixture PDF',published_at:'2026-10-29',extraction_status:'extracting',deleted_at:null,
    updated_at:'2026-10-29T00:00:00.000Z',
    metadata:{categories:['on_sale_product'],ocr_job:{stage:'summarize',next_page:6,page_count:5,
      text:'complete OCR text',attempts:5,lease_until:null,retry_after:null}}};
  let patches=0;
  const service=createKnowledgeLibrary({env:'crm-test123',key:'server-test-key',client:{callFunction:async()=>({})},
    gatewayFactory:()=>({runAITask:async()=>{const error=new Error('temporary gateway retry');error.code='AI_RETRY_LATER';throw error;}}),
    fetchImpl:async(url,options={})=>{
      if(String(url).includes('/rpc/crm_knowledge_content_v1'))return {ok:true,status:200,text:async()=>JSON.stringify({ok:true,job:null})};
      if(options.method==='GET')return rest([source]);
      patches++;Object.assign(source,JSON.parse(options.body),{updated_at:'2026-10-29T00:00:01.000Z'});
      return rest([{id:source.id,updated_at:source.updated_at}]);
    }});
  const result=await service.run({operation:'processOcrQueue'},'worker',{internalOcrQueue:true});
  assert.equal(result.retrying,true);assert.equal(result.errorCode,'AI_RETRY_LATER');
  assert.ok(Date.parse(result.retryAfter)>Date.now());
  assert.equal(source.extraction_status,'extracting');
  assert.equal(source.metadata.ocr_job.attempts,6);
  assert.equal(source.metadata.ocr_job.next_page,6);
  assert.equal(source.metadata.ocr_job.text,'complete OCR text');
  assert.equal(source.metadata.ocr_job.stage,'summarize');
  const later=await service.run({operation:'processOcrQueue'},'worker',{internalOcrQueue:true});
  assert.deepEqual(later,{ok:true,processed:false});
  assert.equal(patches,2);
});

test('transient AI failures stop after the bounded retry limit without discarding OCR text',async()=>{
  const source={id:81,created_by:'fixture-user',storage_key:'pg-private://knowledge-sources/81',
    file_name:'scan.pdf',content_type:'application/pdf',original_base64:Buffer.from('%PDF-fixture').toString('base64'),
    domain:'product',title:'Fixture PDF',published_at:'2026-10-29',extraction_status:'extracting',deleted_at:null,
    updated_at:'2026-10-29T00:00:00.000Z',
    metadata:{categories:['on_sale_product'],ocr_job:{stage:'summarize',next_page:6,page_count:5,
      text:'complete OCR text',attempts:9,lease_until:null,retry_after:null}}};
  const service=createKnowledgeLibrary({env:'crm-test123',key:'server-test-key',client:{callFunction:async()=>({})},
    gatewayFactory:()=>({runAITask:async()=>{const error=new Error('temporary gateway retry');error.code='AI_RETRY_LATER';throw error;}}),
    fetchImpl:async(url,options={})=>{
      if(String(url).includes('/rpc/crm_knowledge_content_v1'))return {ok:true,status:200,text:async()=>JSON.stringify({ok:true,job:null})};
      if(options.method==='GET')return rest([source]);
      Object.assign(source,JSON.parse(options.body),{updated_at:'2026-10-29T00:00:01.000Z'});
      return rest([{id:source.id,updated_at:source.updated_at}]);
    }});
  const result=await service.run({operation:'processOcrQueue'},'worker',{internalOcrQueue:true});
  assert.equal(result.retrying,false);assert.equal(result.errorCode,'AI_RETRY_LATER');
  assert.equal(source.extraction_status,'failed');
  assert.equal(source.metadata.ocr_job.attempts,10);
  assert.equal(source.metadata.ocr_job.retry_after,null);
  assert.equal(source.metadata.ocr_job.text,'complete OCR text');
});

test('public knowledge operation cannot claim the internal queue',async()=>{
  const service=createKnowledgeLibrary({env:'crm-test123',key:'server-test-key',client:{callFunction:async()=>({})}});
  await assert.rejects(service.run({operation:'processOcrQueue'},'fixture-user'),error=>error.code==='PERMISSION_DENIED');
});


test('knowledge source cannot be deleted while extraction is active',async()=>{
  const source={id:78,updated_at:'2026-10-29T00:00:00.000Z',deleted_at:null,extraction_status:'extracting'};
  let writes=0;
  const service=createKnowledgeLibrary({env:'crm-test123',key:'server-test-key',client:{callFunction:async()=>({})},
    fetchImpl:async(_url,options={})=>{
      if(options.method==='GET')return rest([source]);writes++;return rest([]);
    }});
  await assert.rejects(service.run({operation:'delete',data:{table:'knowledge_sources',id:'78',
    expectedUpdatedAt:source.updated_at}},'fixture-user'),error=>error.code==='SOURCE_IN_USE');
  assert.equal(writes,0);
});

