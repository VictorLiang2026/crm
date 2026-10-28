'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {downloadKnowledgeObject,MAX_KNOWLEDGE_PDF_BYTES}=require('../../cloudfunctions/person_360/knowledge-storage');
const {extract}=require('../../cloudfunctions/person_360/knowledge-pdf-service');
const {extractText}=require('../../cloudfunctions/assistant/knowledge-library-service');

function response(status,bytes=Buffer.from('%PDF-text')){
  return {ok:status>=200&&status<300,status,headers:{get:name=>name==='content-length'?String(bytes.length):null},
    arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
}

test('knowledge PDF download uses the private server endpoint, owner path and server credential',async()=>{
  const bytes=Buffer.alloc(4713581,1);let requested;
  const actual=await downloadKnowledgeObject('operator-1/upload-1/Product brochure.pdf','operator-1',{
    env:'crm-test123',key:'server-only-key',fetchImpl:async(url,options)=>{requested={url,options};return response(200,bytes);}
  });
  assert.equal(actual.length,4713581);
  assert.match(requested.url,/\/v1\/storages\/object\/knowledge\/operator-1\/upload-1\/Product%20brochure\.pdf$/);
  assert.equal(requested.options.headers.Authorization,'Bearer server-only-key');
  assert.equal(requested.options.method,'GET');
  assert.equal(JSON.stringify(requested.options).includes(bytes.toString('base64')),false);
});

test('knowledge PDF download refuses a different owner and unsafe paths before network access',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;return response(200);};
  await assert.rejects(downloadKnowledgeObject('other/upload/file.pdf','operator-1',{
    env:'crm-test123',key:'server-only-key',fetchImpl
  }),error=>error.code==='PDF_SOURCE_UNAVAILABLE');
  await assert.rejects(downloadKnowledgeObject('operator-1/../file.pdf','operator-1',{
    env:'crm-test123',key:'server-only-key',fetchImpl
  }),error=>error.code==='PDF_SOURCE_UNAVAILABLE');
  assert.equal(calls,0);
});

test('knowledge PDF storage failures expose bounded codes without response bodies',async()=>{
  for(const [status,code] of [[404,'PDF_SOURCE_UNAVAILABLE'],[403,'PDF_STORAGE_DENIED'],[500,'PDF_STORAGE_READ_FAILED']]){
    await assert.rejects(downloadKnowledgeObject('operator-1/upload/file.pdf','operator-1',{
      env:'crm-test123',key:'server-only-key',fetchImpl:async()=>response(status,Buffer.from('secret response body'))
    }),error=>error.code===code&&error.message===code);
  }
  await assert.rejects(downloadKnowledgeObject('operator-1/upload/file.pdf','operator-1',{
    env:'crm-test123',key:'server-only-key',fetchImpl:async()=>response(200,Buffer.alloc(MAX_KNOWLEDGE_PDF_BYTES+1))
  }),error=>error.code==='PDF_LIMIT');
});

test('PDF source extraction binds the source to the authenticated owner and downloads it server-side',async()=>{
  const calls=[];const actorUid='operator-1',sourceId='12',pdf=Buffer.from('%PDF-valid');
  const result=await extract({sourceId,actorUid},async(...args)=>{
    calls.push(['read',...args]);return {id:sourceId,created_by:actorUid,extraction_status:'extracting',
      content_type:'application/pdf',file_name:'brochure.pdf',file_size_bytes:pdf.length,
      storage_key:`${actorUid}/upload-1/brochure.pdf`};
  },async(...args)=>{calls.push(['download',...args]);return pdf;},async bytes=>{
    assert.deepEqual(bytes,pdf);return 'PDF text';
  });
  assert.deepEqual(result,{text:'PDF text'});
  assert.deepEqual(calls,[['read',sourceId,actorUid],['download',`${actorUid}/upload-1/brochure.pdf`,actorUid]]);
});

test('PDF source extraction rejects mismatched owner and preserves legacy Base64 source storage',async()=>{
  let downloaded=0;
  await assert.rejects(extract({sourceId:'12',actorUid:'operator-1'},async()=>({id:'12',created_by:'other',
    extraction_status:'extracting',content_type:'application/pdf',file_name:'brochure.pdf'}),async()=>{downloaded++;return Buffer.from('%PDF-');}),
    error=>error.message==='INVALID_CONTENT');
  assert.equal(downloaded,0);

  const bytes=Buffer.from('%PDF-legacy');let extracted=0;
  const result=await extract({sourceId:'13',actorUid:'operator-1'},async()=>({id:'13',created_by:'operator-1',
    extraction_status:'extracting',content_type:'application/pdf',file_name:'legacy.pdf',
    file_size_bytes:bytes.length,storage_key:'pg-private://legacy/source',original_base64:bytes.toString('base64')}),
    async()=>{downloaded++;return Buffer.alloc(0);},async actual=>{extracted++;assert.deepEqual(actual,bytes);return 'legacy text';});
  assert.deepEqual(result,{text:'legacy text'});assert.equal(extracted,1);assert.equal(downloaded,0);
});

test('assistant retry forwards the verified actor to the PDF-only Person 360 call and preserves safe errors',async()=>{
  const pdf=Buffer.from('%PDF-fixture');let sent;
  const text=await extractText('brochure.pdf','application/pdf',pdf,{sourceId:'12',actorUid:'operator-1',
    app:{callFunction:async request=>{sent=request;return {result:{text:'PDF text'}};}}});
  assert.equal(text,'PDF text');
  assert.deepEqual(sent,{name:'person_360',data:{action:'extractKnowledgePdfText',sourceId:'12',actorUid:'operator-1'}});
  await assert.rejects(extractText('brochure.pdf','application/pdf',pdf,{sourceId:'12',actorUid:'operator-1',
    app:{callFunction:async()=>({result:{error:'PDF_STORAGE_DENIED'}})}}),error=>error.code==='PDF_STORAGE_DENIED');
});
