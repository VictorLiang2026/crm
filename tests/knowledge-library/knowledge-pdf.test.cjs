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

function simplePdf(pageCount=1){
  const stream='BT /F1 12 Tf 72 720 Td (Knowledge summary smoke test) Tj ET';
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({length:pageCount},(_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for(let i=0;i<pageCount;i++){
    const pageObject=4+i*2,contentObject=pageObject+1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let body='%PDF-1.4\n';const offsets=[0];
  objects.forEach((value,index)=>{offsets.push(Buffer.byteLength(body));body+=`${index+1} 0 obj\n${value}\nendobj\n`;});
  const xrefOffset=Buffer.byteLength(body);body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  body+=offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('');
  body+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body,'ascii');
}

function scannedPdf(){
  const {createCanvas}=require('../../cloudfunctions/assistant/node_modules/@napi-rs/canvas');
  const canvas=createCanvas(600,800),context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,600,800);
  context.fillStyle='#000';context.font='38px sans-serif';context.fillText('OCR SCAN FIXTURE',45,110);
  const image=canvas.toBuffer('image/jpeg',80),stream='q 612 0 0 792 0 0 cm /Im1 Do Q';
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>`,
    `<< /Type /XObject /Subtype /Image /Width 600 /Height 800 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n${image.toString('binary')}\nendstream`,
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body='%PDF-1.4\n';const offsets=[0];
  objects.forEach((value,index)=>{offsets.push(Buffer.byteLength(body,'binary'));body+=`${index+1} 0 obj\n${value}\nendobj\n`;});
  const xrefOffset=Buffer.byteLength(body,'binary');body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  body+=offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('');
  body+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body,'binary');
}

test('bounded local PDF worker extracts a 30 MB, 40-page text PDF',async()=>{
  const small=simplePdf(40),size=MAX_BYTES;
  const bytes=Buffer.concat([small,Buffer.alloc(size-small.length,0x20)]);
  assert.equal(await extractPdfText(bytes),Array(40).fill('Knowledge summary smoke test').join('\n\n'));
},{timeout:30000});

test('PDF text extraction enforces a 30 MB cap before starting a worker',async()=>{
  const bytes=Buffer.alloc(MAX_BYTES+1);Buffer.from('%PDF-').copy(bytes);
  await assert.rejects(extractPdfText(bytes),error=>error.code==='PDF_LIMIT');
});

test('PDF text extraction rejects the first page above the 40-page cap',async()=>{
  await assert.rejects(extractPdfText(simplePdf(41)),error=>error.code==='PDF_LIMIT');
});

test('scanned PDF pages render to bounded JPEG batches without retaining all pages in memory',async()=>{
  const {renderPdfPages}=require('../../cloudfunctions/assistant/knowledge-pdf-render');let received=0;
  const result=await renderPdfPages(scannedPdf(),{onBatch:async pages=>{
    assert.equal(pages.length,1);const image=Buffer.from(pages[0].base64,'base64');
    assert.deepEqual([...image.subarray(0,3)],[0xff,0xd8,0xff]);assert.ok(image.length<=768*1024);received+=pages.length;
  }});
  assert.deepEqual(result,{pageCount:1});assert.equal(received,1);
},{timeout:20000});

test('scanned PDF retries route rendered pages through the OCR batch contract',async()=>{
  const batches=[];
  const text=await extractText('scan.pdf','application/pdf',scannedPdf(),{ocrPdfBatch:async images=>{
    batches.push(images);return 'OCR SCAN FIXTURE';
  }});
  assert.equal(text,'OCR SCAN FIXTURE');assert.equal(batches.length,1);
  assert.equal(batches[0][0].fileName,'page-1.jpg');assert.equal(batches[0][0].contentType,'image/jpeg');
  assert.ok(Buffer.from(batches[0][0].base64,'base64').length<=768*1024);
},{timeout:20000});

test('knowledge PDF extraction falls back to bounded rendered-page OCR only when no text layer exists',async()=>{
  const batches=[];const bytes=Buffer.from('%PDF-scanned');
  const text=await extractText('scan.pdf','application/pdf',bytes,{
    pdfTextExtractor:async()=>{throw Object.assign(new Error('PDF_NO_TEXT'),{code:'PDF_NO_TEXT'});},
    pdfPageRenderer:async(_bytes,{onBatch})=>{await onBatch([
      {page:1,fileName:'page-1.jpg',contentType:'image/jpeg',base64:'YWJj'}]);return {pageCount:1};},
    ocrPdfBatch:async images=>{batches.push(images);return '第1页：识别出的文字';},
  });
  assert.equal(text,'第1页：识别出的文字');assert.equal(batches.length,1);assert.equal(batches[0].length,1);
});

test('knowledge PDF text layer remains preferred and does not invoke OCR',async()=>{
  let ocrCalls=0;
  const text=await extractText('digital.pdf','application/pdf',Buffer.from('%PDF-digital'),{
    pdfTextExtractor:async()=> '已有文字层',pdfPageRenderer:async()=>{throw Error('should not render');},
    ocrPdfBatch:async()=>{ocrCalls++;return 'unexpected';},
  });
  assert.equal(text,'已有文字层');assert.equal(ocrCalls,0);
});

test('assistant extracts PDFs locally instead of making an unauthenticated internal function call',async()=>{
  const pdf=Buffer.alloc(MAX_BYTES);Buffer.from('%PDF-').copy(pdf);let sent=0,received;
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
  assert.equal(requestUrl.searchParams.get('select'),'id,created_by,storage_key,file_name,content_type,updated_at,domain,title,published_at,metadata');
});

test('PDF retry reads legacy Base64 separately instead of loading the whole source row',async()=>{
  const requests=[],source={id:6,created_by:'operator-1',storage_key:'pg-private://knowledge-sources/6',
    file_name:'legacy.pdf',content_type:'application/pdf',updated_at:'2026-10-28T10:00:00.000Z',domain:'product',
    title:'Legacy PDF',published_at:'2026-10-28',metadata:{categories:['on_sale_product']}};
  const service=createKnowledgeLibrary({env:'crm-test123',key:'server-only-key',client:{callFunction:async()=>({})},
    fetchImpl:async url=>{
      const query=new URL(url);requests.push(query);
      if(query.pathname.endsWith('/knowledge_sources')&&query.searchParams.get('select')==='original_base64')
        return restResponse(200,[{original_base64:Buffer.from('%PDF-legacy').toString('base64')}]);
      if(query.pathname.endsWith('/knowledge_sources'))return restResponse(200,[source]);
      if(query.pathname.endsWith('/knowledge_items'))return restResponse(200,[]);
      return restResponse(200,[]);
    }});
  await assert.rejects(service.run({operation:'retry',sourceId:'6'},'operator-1'),error=>error.code==='INVALID_CONTENT');
  assert.equal(requests[0].searchParams.get('select'),'id,created_by,storage_key,file_name,content_type,updated_at,domain,title,published_at,metadata');
  assert.equal(requests[1].pathname.endsWith('/knowledge_items'),true);
  assert.equal(requests[2].searchParams.get('select'),'original_base64');
  assert.equal(requests[2].searchParams.get('created_by'),'eq.operator-1');
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
  assert.equal(writes.length,1);
  assert.ok(writes[0].body.deleted_at);assert.equal(writes[0].body.updated_by,'operator-1');
  assert.equal(warnings.length,1);assert.equal(warnings[0][0],'KNOWLEDGE_DATA_REQUEST_FAILED');
  assert.deepEqual(JSON.parse(warnings[0][1]),{table:'knowledge_sources',method:'PATCH',status:400,databaseCode:'23514'});
  assert.equal(JSON.stringify(warnings).includes('private title'),false);
});

test('knowledge source deletion selects only columns present on knowledge_sources',async()=>{
  const urls=[],source={id:6,updated_at:'2026-10-28T10:00:00.000Z',deleted_at:null};
  const service=createKnowledgeLibrary({env:'crm-test123',key:'server-only-key',client:{callFunction:async()=>({})},
    fetchImpl:async(url,options={})=>{
      urls.push(new URL(url));
      return options.method==='GET'?restResponse(200,[source]):restResponse(200,[{...source,deleted_at:'2026-10-28T10:01:00.000Z'}]);
    }});
  const result=await service.run({operation:'delete',data:{table:'knowledge_sources',id:'6',expectedUpdatedAt:source.updated_at}},'operator-1');
  assert.equal(result.ok,true);
  assert.equal(urls[0].searchParams.get('select'),'id,updated_at,deleted_at');
  assert.equal(urls[0].searchParams.has('source_id'),false);
});

test('knowledge item deletion retains source linkage and source restore avoids nonexistent linkage',async()=>{
  const updatedAt='2026-10-28T10:00:00.000Z',urls=[],writes=[];let itemReads=0;
  const item={id:9,source_id:12,updated_at:updatedAt,deleted_at:null};
  const service=createKnowledgeLibrary({env:'crm-test123',key:'server-only-key',client:{callFunction:async()=>({})},
    fetchImpl:async(url,options={})=>{
      const parsed=new URL(url);urls.push(parsed);
      if(options.method==='GET')return restResponse(200,parsed.pathname.endsWith('/knowledge_items')?(itemReads++===0?[item]:[]):[
        {id:12,updated_at:'2026-10-28T10:01:00.000Z',deleted_at:'2026-10-28T10:00:00.000Z'}]);
      writes.push({url:parsed,body:JSON.parse(options.body)});
      return restResponse(200,[{...item,deleted_at:'2026-10-28T10:01:00.000Z'}]);
    }});
  const removed=await service.run({operation:'delete',data:{table:'knowledge_items',id:'9',expectedUpdatedAt:updatedAt}},'operator-1');
  assert.equal(removed.ok,true);
  assert.equal(urls[0].searchParams.get('select'),'id,source_id,updated_at,deleted_at');
  assert.equal(writes.some(x=>x.url.pathname.endsWith('/knowledge_sources')),true);

  urls.length=0;
  const restored=await service.run({operation:'restore',data:{table:'knowledge_sources',id:'12'}},'operator-1');
  assert.equal(restored.ok,true);
  assert.equal(urls[0].searchParams.get('select'),'id,updated_at,deleted_at');
  assert.equal(urls[0].searchParams.has('source_id'),false);
});
