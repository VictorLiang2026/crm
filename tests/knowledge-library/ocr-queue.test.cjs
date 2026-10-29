'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createKnowledgeLibrary}=require('../../cloudfunctions/assistant/knowledge-library-service');

function rest(rows=[]){return {ok:true,status:200,text:async()=>JSON.stringify(rows)};}

test('OCR worker checkpoints one three-page chunk and resumes at the next page',async()=>{
  const source={id:77,created_by:'fixture-user',storage_key:'pg-private://knowledge-sources/77',
    file_name:'scan.pdf',content_type:'application/pdf',original_base64:Buffer.from('%PDF-fixture').toString('base64'),
    domain:'product',title:'Fixture PDF',published_at:'2026-10-29',extraction_status:'extracting',deleted_at:null,
    updated_at:'2026-10-29T00:00:00.000Z',
    metadata:{categories:['on_sale_product'],ocr_job:{stage:'ocr',next_page:1,page_count:null,text:'',attempts:0,lease_until:null}}};
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
    ranges.push([startPage,maxPages]);await onBatch([{page:startPage,fileName:'page.jpg',contentType:'image/jpeg',base64:'YQ=='}]);
    return {pageCount:5,nextPage:Math.min(5,startPage+maxPages-1)+1};
  },ocrPdfBatch:async images=>{assert.equal(images.length,1);return 'recognized page '+ranges.at(-1)[0];}};
  const first=await service.run({operation:'processOcrQueue'},'worker',options);
  assert.equal(first.stage,'ocr');assert.equal(first.completedPages,3);assert.equal(first.totalPages,5);
  assert.equal(source.metadata.ocr_job.next_page,4);assert.match(source.metadata.ocr_job.text,/recognized page 1/);
  const second=await service.run({operation:'processOcrQueue'},'worker',options);
  assert.equal(second.stage,'summarize');assert.equal(second.completedPages,5);
  assert.deepEqual(ranges,[[1,3],[4,3]]);
  assert.equal(source.metadata.ocr_job.stage,'summarize');
  assert.equal(requests.filter(x=>x.method==='PATCH').length,4);
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

