'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {downloadKnowledgeObject,MAX_KNOWLEDGE_PDF_BYTES}=require('../../cloudfunctions/person_360/knowledge-storage');
const {extract}=require('../../cloudfunctions/person_360/knowledge-pdf-service');
const {extractPdfText,MAX_BYTES}=require('../../cloudfunctions/assistant/knowledge-pdf-text');
const {createKnowledgeLibrary,extractText}=require('../../cloudfunctions/assistant/knowledge-library-service');

function response(status,bytes=Buffer.from('%PDF-text')){
  return {ok:status>=200&&status<300,status,headers:{get:name=>name==='content-length'?String(bytes.length):null},
    arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
}
function restResponse(status,body){return {ok:status>=200&&status<300,status,text:async()=>typeof body==='string'?body:JSON.stringify(body)};}

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

function simplePdf(){
  const stream='BT /F1 12 Tf 72 720 Td (Knowledge summary smoke test) Tj ET';
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body='%PDF-1.4\n';const offsets=[0];
  objects.forEach((value,index)=>{offsets.push(Buffer.byteLength(body));body+=`${index+1} 0 obj\n${value}\nendobj\n`;});
  const xrefOffset=Buffer.byteLength(body);body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  body+=offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('');
  body+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body,'ascii');
}

test('bounded local PDF worker extracts a 9.4 MB text PDF under the Node 18 runtime',async()=>{
  const small=simplePdf(),size=9_433_979;
  const bytes=Buffer.concat([small,Buffer.alloc(size-small.length,0x20)]);
  assert.equal(await extractPdfText(bytes),'Knowledge summary smoke test');
},{timeout:30000});

test('PDF text extraction enforces a 16 MiB cap before starting a worker',async()=>{
  const bytes=Buffer.alloc(MAX_BYTES+1);Buffer.from('%PDF-').copy(bytes);
  await assert.rejects(extractPdfText(bytes),error=>error.code==='PDF_LIMIT');
});

test('assistant extracts PDFs locally instead of making an unauthenticated internal function call',async()=>{
  const pdf=Buffer.alloc(9_433_979);Buffer.from('%PDF-').copy(pdf);let sent=0,received;
  const text=await extractText('brochure.pdf','application/pdf',pdf,{app:{callFunction:async()=>{sent++;}},
    pdfTextExtractor:async bytes=>{received=bytes;return 'PDF text';}});
  assert.equal(text,'PDF text');assert.equal(received,pdf);assert.equal(sent,0);
  const tooLarge=Buffer.alloc(MAX_BYTES+1);Buffer.from('%PDF-').copy(tooLarge);
  await assert.rejects(extractText('brochure.pdf','application/pdf',tooLarge,{pdfTextExtractor:async()=> 'should not run'}),
    error=>error.code==='PDF_LIMIT');
});

test('PDF retry reads only a source owned by the authenticated assistant caller',async()=>{
  let requestUrl;
  const service=createKnowledgeLibrary({env:'crm-test123',key:'server-only-key',client:{callFunction:async()=>({})},
    fetchImpl:async url=>{requestUrl=new URL(url);return restResponse(200,[]);}});
  await assert.rejects(service.run({operation:'retry',sourceId:'6'},'operator-1'),error=>error.code==='SOURCE_UNAVAILABLE');
  assert.equal(requestUrl.searchParams.get('created_by'),'eq.operator-1');
});

test('knowledge deletion keeps soft-delete semantics and logs only safe database diagnostics',async()=>{
  const expectedUpdatedAt='2026-10-28T10:00:00.000Z',source={id:6,source_id:null,updated_at:expectedUpdatedAt,deleted_at:null};
  const warnings=[],writes=[];
  const service=createKnowledgeLibrary({env:'crm-test123',key:'server-only-key',client:{callFunction:async()=>({})},
    logger:{warn:(...args)=>warnings.push(args)},fetchImpl:async(_url,options={})=>{
      if(options.method==='GET')return restResponse(200,[source]);
      writes.push({method:options.method,body:JSON.parse(options.body)});
      return restResponse(400,{code:'23514',message:'private title must not be logged'});
    }});
  await assert.rejects(service.run({operation:'delete',data:{table:'knowledge_sources',id:'6',expectedUpdatedAt}},'operator-1'),
    error=>error.code==='PERSISTENCE_ERROR');
  assert.equal(writes.length,1);assert.ok(writes[0].body.deleted_at);assert.equal(writes[0].body.updated_by,'operator-1');
  assert.equal(warnings.length,1);assert.equal(warnings[0][0],'KNOWLEDGE_DATA_REQUEST_FAILED');
  assert.deepEqual(JSON.parse(warnings[0][1]),{table:'knowledge_sources',method:'PATCH',status:400,databaseCode:'23514'});
  assert.equal(JSON.stringify(warnings).includes('private title'),false);
});
