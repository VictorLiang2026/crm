'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createKnowledgeOcr}=require('../../cloudfunctions/ai_parse/knowledge-ocr-service');

const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/qFsAAAAASUVORK5CYII=';
const row={file_name:'source.png',content_type:'image/png',original_base64:PNG};

test('existing ai_parse OCR route reads a staged source with its capability and uses its configured vision model',async()=>{
  let rpcCall=null,generation=null;
  const service=createKnowledgeOcr({rdb:{rpc:async(name,args)=>{rpcCall={name,args};return {data:[row],error:null};}},
    assertOk:result=>{if(result.error)throw result.error;return result;},visionModel:'configured-vision-model',
    generateText:async(messages,options)=>{generation={messages,options};return {text:'标题\n图片中的文字'};}});
  const result=await service.run({action:'ocr_knowledge_source',sourceId:'17',uploadId:'01234567-89ab-4cde-8fab-0123456789ab'});
  assert.deepEqual(rpcCall,{name:'crm_knowledge_ocr_input_v1',args:{p_source_id:17,p_upload_id:'01234567-89ab-4cde-8fab-0123456789ab'}});
  assert.equal(result.ocrText,'标题\n图片中的文字');
  assert.equal(generation.options.model,'configured-vision-model');
  assert.match(generation.messages[0].content[0].image_url.url,/^data:image\/png;base64,/);
  assert.match(generation.messages[0].content[1].text,/逐字识别/);
});

test('invalid source capabilities are rejected before database or model access',async()=>{
  let reads=0,calls=0;
  const service=createKnowledgeOcr({rdb:{rpc:async()=>{reads++;return {data:[],error:null};}},
    assertOk:r=>r,visionModel:'configured-vision-model',generateText:async()=>{calls++;return {text:'ignored'};}});
  await assert.rejects(service.run({sourceId:'17',uploadId:'wrong'}),error=>error.code==='INVALID_SOURCE');
  assert.equal(reads,0);assert.equal(calls,0);
});

test('legacy direct image OCR accepts only validated supported image data',async()=>{
  let calls=0;
  const service=createKnowledgeOcr({rdb:{rpc:async()=>({data:[],error:null})},assertOk:r=>r,
    visionModel:'configured-vision-model',generateText:async()=>{calls++;return {text:'OCR text'};}});
  assert.deepEqual(await service.run({fileName:'legacy.png',contentType:'image/png',base64:PNG}),{ocrText:'OCR text'});
  await assert.rejects(service.run({fileName:'legacy.png',contentType:'image/png',base64:'AA=='}),error=>error.code==='INVALID_IMAGE');
  assert.equal(calls,1);
});

test('OCR removes only the model answer wrapper while preserving recognized text',async()=>{
  const service=createKnowledgeOcr({rdb:{rpc:async()=>({data:[],error:null})},assertOk:r=>r,
    visionModel:'configured-vision-model',generateText:async()=>({text:'<answer>\nOCR SYNTHETIC 123\n</answer>'})});
  assert.deepEqual(await service.run({fileName:'synthetic.png',contentType:'image/png',base64:PNG}),
    {ocrText:'OCR SYNTHETIC 123'});
});

test('migration exposes only an upload-token-gated image read to the function anon role',()=>{
  const file=path.join(__dirname,'../../cloudbase/migrations/20261027181000_knowledge_ocr_input.sql');
  const sql=fs.readFileSync(file,'utf8');
  assert.match(sql,/public\.knowledge_sources/);
  assert.match(sql,/SECURITY DEFINER\s+SET search_path = pg_catalog/i);
  assert.match(sql,/metadata->'upload'->>'upload_id' = p_upload_id::text/);
  assert.match(sql,/s\.extraction_status = 'extracting'/);
  assert.match(sql,/s\.content_type IN \('image\/png','image\/jpeg','image\/webp'\)/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.crm_knowledge_ocr_input_v1\(bigint,uuid\)\s+FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.crm_knowledge_ocr_input_v1\(bigint,uuid\) TO anon/);
});
