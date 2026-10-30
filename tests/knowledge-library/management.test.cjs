'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createKnowledgeLibrary}=require('../../cloudfunctions/assistant/knowledge-library-service');

function setup({current=null,manualSummary=false}={}){
  const writes=[],gatewayCalls=[],rpcCalls=[];
  const fetchImpl=async(url,options={})=>{
    const table=new URL(url).pathname.split('/').pop();
    const method=options.method||'GET';
    if(method==='GET')return response(current?[current]:[]);
    const body=JSON.parse(options.body);
    writes.push({table,method,body,url:new URL(url)});
    const row=Array.isArray(body)?body[0]:body;
    return response([{...row,id:current?.id||42,updated_at:'2026-10-27T00:00:00Z'}]);
  };
  const gatewayFactory=()=>({runAITask:async input=>{
    gatewayCalls.push(input);
    return {result:{summary:'AI generated summary'},taskId:12,resultId:34};
  }});
  const service=createKnowledgeLibrary({env:'crm-test123',key:'test-key',fetchImpl,
    client:{callFunction:async()=>({result:{}})},gatewayFactory,
    searchDataFactory:()=>({auditRdb:{rpc:async(name,args)=>{rpcCalls.push({name,args});return {data:{ok:true,status:args.p_valid?'verified':'invalidated'}};}}})});
  return {service,writes,gatewayCalls,rpcCalls};
}
function response(value){return {ok:true,text:async()=>JSON.stringify(value)};}
test('managed knowledge keeps metadata edits while refusing legacy content overwrite',async()=>{
  const sig=require('node:crypto').createHash('md5').update('Base text\x1fBase summary').digest('hex');
  const current={id:7,item_type:'evidence',source:'Old title',content:'Base text',metadata:{summary:'Base summary'},verified:true,
    lifecycle_status:'verified',updated_at:'stamp',gpt_original_text:'GPT',gpt_summary:'Summary',selected_content_source:'gpt',
    content_state:{baseSignature:sig,original:{text:'Managed text',summary:'Managed summary',reviewed:true},gpt:{reviewed:true}}};
  const {service,writes,gatewayCalls,rpcCalls}=setup({current});
  const data={id:7,title:'New title',categories:['other'],content:'Managed text',summary:'Managed summary',expectedUpdatedAt:'stamp',confidence:.9};
  await service.run({operation:'save',data},'actor');
  assert.equal(writes[0].body.source,'New title');assert.equal(writes[0].body.content,undefined);
  assert.equal(writes[0].body.metadata.summary,'Base summary');assert.equal(writes[0].body.content_state,undefined);
  assert.equal(gatewayCalls.length,0);assert.equal(rpcCalls.length,0);
  await assert.rejects(()=>service.run({operation:'save',data:{...data,content:'Overwrite'}},'actor'),e=>e.code==='CONTENT_USE_VERSION_EDITOR');
});
const base={domain:'product',title:'Product overview',content:'Product content to summarize',sourceDate:'2026-10-01',confidence:.8};

test('new knowledge uses the AI Gateway summary and stores it separately in metadata',async()=>{
  const {service,writes,gatewayCalls,rpcCalls}=setup();
  const result=await service.run({operation:'save',data:base},'operator-1');
  assert.equal(result.ok,true);assert.equal(result.summaryGenerated,true);
  assert.equal(gatewayCalls.length,1);assert.equal(gatewayCalls[0].skill,'knowledge_extract');
  assert.equal(writes[0].method,'POST');assert.equal(writes[0].body[0].metadata.summary,'AI generated summary');
  assert.equal(writes[0].body[0].metadata.summary_source,'ai');
  assert.equal(writes[0].body[0].lifecycle_status,'draft');
  assert.equal(rpcCalls[0].name,'crm_knowledge_review_v1');
});

test('manual summary is preserved without invoking AI',async()=>{
  const {service,writes,gatewayCalls}=setup();
  const result=await service.run({operation:'save',data:{...base,summary:'Edited by operator'}},'operator-1');
  assert.equal(result.summaryGenerated,false);assert.equal(gatewayCalls.length,0);
  assert.equal(writes[0].body[0].metadata.summary,'Edited by operator');
  assert.equal(writes[0].body[0].metadata.summary_source,'manual');
});

test('editing verified knowledge creates a linked draft revision and preserves its parent',async()=>{
  const current={id:7,source_id:3,item_type:'product',source:'Old title',content:'Old content',metadata:{domain:'product',summary:'Old summary'},
    lifecycle_status:'verified',verified:true,version_no:2,updated_at:'2026-10-20T00:00:00Z'};
  const {service,writes}=setup({current});
  const result=await service.run({operation:'save',data:{...base,id:'7',expectedUpdatedAt:current.updated_at,summary:'New summary'}},'operator-1');
  assert.equal(result.revision,true);assert.equal(writes[0].method,'POST');
  assert.equal(writes[0].body[0].supersedes_id,7);assert.equal(writes[0].body[0].version_no,3);
  assert.equal(writes[0].body[0].source_id,3);assert.equal(writes[0].body[0].lifecycle_status,'draft');
});

test('editing a draft uses an optimistic timestamp condition',async()=>{
  const current={id:7,item_type:'product',source:'Old title',content:'Old content',metadata:{domain:'product'},
    lifecycle_status:'draft',verified:false,version_no:1,updated_at:'2026-10-20T00:00:00Z'};
  const {service,writes}=setup({current});
  await service.run({operation:'save',data:{...base,id:'7',expectedUpdatedAt:current.updated_at,summary:'Updated'}},'operator-1');
  assert.equal(writes[0].method,'PATCH');
  assert.equal(writes[0].url.searchParams.get('updated_at'),`eq.${current.updated_at}`);
});

test('industry and legal knowledge may omit an external source URL while preserving publication date',async()=>{
  for(const domain of ['industry_development','legal_tax']){
    const {service,writes}=setup();
    const result=await service.run({operation:'save',data:{...base,domain,categories:[domain],publishedAt:'2026-10-01'}},'operator-1');
    assert.equal(result.ok,true,domain);
    assert.ok(writes[0].body[0].source_uri==null,domain);
    assert.equal(writes[0].body[0].metadata.published_at,'2026-10-01',domain);
  }
});

test('publication metadata replaces removed jurisdiction/date fields while privacy scanning remains automatic',async()=>{
  const {service,writes}=setup();
  const result=await service.run({operation:'save',data:{...base,domain:'top_performer_sharing',
    publishedAt:'2026-10-21',jurisdiction:'legacy field ignored',validTo:'2026-10-22'}},'operator-1');
  assert.equal(result.ok,true);
  const payload=writes[0].body[0];
  assert.equal(payload.source_date,null);assert.equal(payload.valid_from,null);assert.equal(payload.valid_to,null);
  assert.equal(payload.metadata.published_at,'2026-10-21');
  assert.equal(Object.hasOwn(payload.metadata,'jurisdiction'),false);
  assert.equal(Object.hasOwn(payload.metadata,'sharing_authorized'),false);
  await assert.rejects(service.run({operation:'save',data:{...base,domain:'top_performer_sharing',
    content:'客户电话 13812345678'}},'operator-1'),error=>error.code==='PERSONAL_DATA_DETECTED');
  assert.equal(writes.length,1);
});

test('superseded history cannot be edited, while invalidated knowledge can be updated and republished',async()=>{
  for(const lifecycle_status of ['superseded']){
    const current={id:8,item_type:'product',source:'Archived note',content:'Old content',metadata:{domain:'product'},
      lifecycle_status,verified:false,version_no:1,updated_at:'2026-10-20T00:00:00Z'};
    const {service,writes}=setup({current});
    await assert.rejects(service.run({operation:'save',data:{...base,id:'8',expectedUpdatedAt:current.updated_at,summary:'Edit'}},'operator-1'),
      error=>error.code==='INVALID_INPUT');
    assert.equal(writes.length,0);
  }
  const current={id:8,item_type:'product',source:'Archived note',content:'Old content',metadata:{domain:'product'},
    lifecycle_status:'invalidated',verified:false,version_no:1,updated_at:'2026-10-20T00:00:00Z'};
  const {service,rpcCalls}=setup({current});
  await service.run({operation:'save',data:{...base,id:'8',expectedUpdatedAt:current.updated_at,summary:'Edit'}},'operator-1');
  assert.equal(rpcCalls[0].name,'crm_knowledge_set_valid_v1');
});

test('staged upload accepts a 6 MiB PNG in bounded chunks and hands its source reference to the existing OCR function',async()=>{
  const rows={knowledge_sources:[],knowledge_items:[]};let nextId=1,ocrRequest=null;
  const fetchImpl=async(url,options={})=>{
    const table=new URL(url).pathname.split('/').pop(),method=options.method||'GET',params=new URL(url).searchParams;
    if(method==='GET'){
      let found=[...(rows[table]||[])];
      for(const [key,value] of params){
        if(key==='select'||key==='limit')continue;
        if(value==='is.null')found=found.filter(row=>row[key]==null);
        else if(value.startsWith('eq.'))found=found.filter(row=>String(row[key])===value.slice(3));
        else if(value.startsWith('neq.'))found=found.filter(row=>String(row[key])!==value.slice(4));
      }
      return response(found.slice(0,Number(params.get('limit')||found.length)));
    }
    if(method==='POST'){
      const body=JSON.parse(options.body),created=(Array.isArray(body)?body:[body]).map(row=>({...row,id:nextId++,updated_at:new Date().toISOString()}));
      rows[table].push(...created);return response(created);
    }
    if(method==='PATCH'){
      let found=[...(rows[table]||[])];
      for(const [key,value] of params){
        if(key==='select')continue;
        if(value==='is.null')found=found.filter(row=>row[key]==null);
        else if(value.startsWith('eq.'))found=found.filter(row=>String(row[key])===value.slice(3));
      }
      const patch=JSON.parse(options.body);for(const row of found)Object.assign(row,patch);
      return response(found);
    }
    if(method==='DELETE'){
      const before=rows[table].length;rows[table]=rows[table].filter(row=>String(row.id)!==params.get('id')?.slice(3));
      return response(rows[table].length===before?[]:[{id:params.get('id')?.slice(3)}]);
    }
    throw new Error(`Unexpected method ${method}`);
  };
  const service=createKnowledgeLibrary({env:'crm-test123',key:'test-key',fetchImpl,
    client:{callFunction:async input=>{ocrRequest=input;return {result:{ocrText:'识别到的图片文字。'}};}},
    gatewayFactory:()=>({runAITask:async()=>({result:{summary:'摘要',keyPoints:['知识点'],applicationNotes:['应用'],boundaries:['边界']},taskId:1,resultId:2})}),
    searchDataFactory:()=>({auditRdb:{rpc:async()=>({data:{ok:true}})}})});
  const bytes=Buffer.alloc(6*1024*1024);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  const started=await service.uploadStart({categories:['on_sale_product'],title:'演示图片',fileName:'source.png',fileSizeBytes:bytes.length},'operator-1');
  assert.equal(started.chunkCount,8);
  for(let index=0;index<started.chunkCount;index++){
    const chunk=bytes.subarray(index*768*1024,Math.min(bytes.length,(index+1)*768*1024));
    const result=await service.uploadChunk({sourceId:started.sourceId,uploadId:started.uploadId,index,chunkBase64:chunk.toString('base64')},'operator-1');
    assert.equal(result.ok,true);
  }
  const finished=await service.uploadFinalize({sourceId:started.sourceId,uploadId:started.uploadId},'operator-1');
  assert.equal(finished.ok,true);assert.equal(finished.extractionStatus,'verified');
  assert.equal(ocrRequest.name,'ai_parse');assert.equal(ocrRequest.data.action,'ocr_knowledge_source');
  assert.equal(ocrRequest.data.sourceId,started.sourceId);assert.equal(ocrRequest.data.uploadId,started.uploadId);
  assert.equal(rows.knowledge_sources[0].file_size_bytes,6*1024*1024);
  assert.equal(rows.knowledge_sources[0].extraction_status,'draft');
  assert.equal(rows.knowledge_items[0].metadata.summary,'摘要');
});

test('staged upload rejects files larger than 6 MiB before creating a source record',async()=>{
  const {service}=setup();
  await assert.rejects(service.uploadStart({categories:['on_sale_product'],title:'Too big',fileName:'source.png',
    fileSizeBytes:6*1024*1024+1},'operator-1'),error=>error.code==='FILE_TOO_LARGE');
});

test('private storage upload accepts an attached industry source without a public URL and extracts it',async()=>{
  const rows={knowledge_sources:[],knowledge_items:[]};let nextId=1,storageUrl=null;
  const bytes=Buffer.from('行业经验资料：客户需求先于产品介绍。','utf8');
  const fetchImpl=async(url,options={})=>{
    const parsed=new URL(url),path=parsed.pathname,table=path.split('/').pop(),method=options.method||'GET',params=parsed.searchParams;
    if(path.includes('/v1/storages/object/knowledge/')){
      storageUrl=path;
      return {ok:true,status:200,headers:{get:name=>name.toLowerCase()==='content-length'?String(bytes.length):'text/markdown'},
        arrayBuffer:async()=>bytes};
    }
    if(method==='GET'){
      let found=[...(rows[table]||[])];
      for(const [key,value] of params){
        if(key==='select'||key==='limit')continue;
        if(value==='is.null')found=found.filter(row=>row[key]==null);
        else if(value.startsWith('eq.'))found=found.filter(row=>String(row[key])===value.slice(3));
        else if(value.startsWith('neq.'))found=found.filter(row=>String(row[key])!==value.slice(4));
      }
      return response(found.slice(0,Number(params.get('limit')||found.length)));
    }
    if(method==='POST'){
      const payload=JSON.parse(options.body),created=(Array.isArray(payload)?payload:[payload]).map(row=>({...row,id:nextId++,updated_at:new Date().toISOString()}));
      rows[table].push(...created);return response(created);
    }
    if(method==='PATCH'){
      const found=(rows[table]||[]).filter(row=>!params.has('id')||String(row.id)===params.get('id').slice(3));
      const payload=JSON.parse(options.body);for(const row of found)Object.assign(row,payload);
      return response(found);
    }
    throw new Error(`Unexpected method ${method}`);
  };
  const service=createKnowledgeLibrary({env:'crm-test123',key:'test-key',fetchImpl,
    client:{callFunction:async()=>({result:{}})},
    gatewayFactory:()=>({runAITask:async()=>({result:{summary:'行业摘要',keyPoints:['先识别需求'],applicationNotes:['先提问再介绍'],boundaries:['不替代法务意见']},taskId:1,resultId:2})}),
    searchDataFactory:()=>({auditRdb:{rpc:async()=>({data:{ok:true}})}})});
  const initialized=await service.uploadPrepare({categories:['industry_development'],title:'行业经验',fileName:'notes.md',
    fileSizeBytes:bytes.length,publishedAt:'2026-10-28'},'operator-1');
  assert.equal(initialized.ok,true);assert.equal(initialized.storageBucket,'knowledge');
  assert.match(initialized.storageKey,/^operator-1\/[0-9a-f-]{36}\/notes\.md$/);
  const source=rows.knowledge_sources[0];assert.equal(source.source_uri,null);assert.equal(source.original_base64,null);
  const finalized=await service.uploadFinalize({sourceId:initialized.sourceId,uploadId:initialized.uploadId},'operator-1');
  assert.equal(finalized.ok,true);assert.equal(finalized.extractionStatus,'verified');
  assert.match(storageUrl,/\/knowledge\/operator-1\//);
  assert.equal(rows.knowledge_items[0].metadata.summary,'行业摘要');
});

test('private storage upload rejects files above the CloudBase PG limit before creating a source row',async()=>{
  const {service,writes}=setup();
  await assert.rejects(service.uploadPrepare({categories:['other'],title:'Too big',fileName:'large.pdf',
    fileSizeBytes:100_000_001},'operator-1'),error=>error.code==='FILE_TOO_LARGE');
  assert.equal(writes.length,0);
});
