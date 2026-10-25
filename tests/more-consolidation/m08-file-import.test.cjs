'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {FileImportService,original,parseInput,draft}=require('../../cloudfunctions/person_360/file-import-service');
const KEY='00000000-0000-4000-8000-000000000001';
const input={personId:1,customerId:2,idempotencyKey:KEY,fileName:'example.txt',contentType:'text/plain',base64:Buffer.from('姓名：虚构甲').toString('base64')};
test('original validation: canonical encoding, limits, allowlist, stable content identity',()=>{
 const a=original(input),b=original({...input});assert.equal(a.payloadHash,b.payloadHash);
 assert.notEqual(original({...input,notes:'other'}).payloadHash,a.payloadHash);
 for(const patch of [{actorUid:'spoof'},{personId:0},{customerId:2147483648},{base64:'YQ='},{base64:'YR=='},{fileName:'a\n.txt'},
  {contentType:'text/plain;evil'},{base64:Buffer.alloc(4*1024*1024+1).toString('base64')}])assert.throws(()=>original({...input,...patch}),/Invalid/);
 assert.doesNotThrow(()=>original({...input,base64:Buffer.alloc(4*1024*1024).toString('base64')}));
});
test('text/image signatures and invalid PDF rejected; unsupported formats remain originals only',()=>{
 const source={photo_url:'data:text/plain;base64,'+input.base64,content_type:'text/plain'};
 assert.equal(parseInput(source).text,'姓名：虚构甲');
 assert.throws(()=>parseInput({photo_url:'data:application/pdf;base64,YQ==',content_type:'application/pdf'}),/INVALID_CONTENT/);
 assert.throws(()=>parseInput({photo_url:'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,YQ==',content_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),/UNSUPPORTED_TYPE/);
 assert.throws(()=>parseInput({photo_url:'data:image/png;base64,YQ==',content_type:'image/png'}),/INVALID_CONTENT/);
 assert.throws(()=>parseInput({photo_url:'data:text/plain;base64,//8=',content_type:'text/plain'}),/INVALID_CONTENT/);
 assert.deepEqual(draft({parsed:{customer_name:'甲',phone:'123',opportunity:{},facts:['x']}},{text:'source'}),
   {fields:{customer_name:'甲',phone:'123'},rawText:'source'});
 assert.throws(()=>draft({parsed:{phone:123}},{text:'a'}),/INVALID_RESULT/);
 assert.throws(()=>draft({parsed:{}},{}),/INVALID_RESULT/);
});
test('server claim determines source, retries reuse draft, failures retain original, uncertain completion is not overwritten',async()=>{
 const calls=[];let mode='new',parseCount=0;
 const rpc=async(name,p)=>{assert.equal(name,'crm_file_import_v1');assert.equal(p.p_actor_uid,'server-actor');calls.push(p);
   if(p.p_operation==='claim')return mode==='done'?{job:{status:'draft'}}:{leaseToken:KEY,source:{photo_url:'data:text/plain;base64,'+input.base64,content_type:'text/plain'}};
   if(p.p_operation==='complete'&&mode==='uncertain')throw Error('network');
   return {job:{status:p.p_operation==='fail'?'failed':'draft'}};
 };
 const service=new FileImportService({rpc,parse:async data=>{parseCount++;assert.equal(data.action,'parse_import_draft');
   if(mode==='error')throw Error('sensitive upstream error');return {parsed:{customer_name:'甲'}};}});
 await service.parseDraft(KEY,'server-actor');assert.deepEqual(calls.map(x=>x.p_operation),['claim','complete']);
 assert.equal(calls[1].p_data.rawText,'姓名：虚构甲');
 mode='done';await service.parseDraft(KEY,'server-actor');assert.equal(parseCount,1);
 mode='error';await service.parseDraft(KEY,'server-actor');assert.equal(calls.at(-1).p_data.errorCode,'PARSE_FAILED');
 mode='uncertain';await assert.rejects(service.parseDraft(KEY,'server-actor'),/network/);assert.equal(calls.at(-1).p_operation,'complete');
 assert.throws(()=>service.save(input,''),/UNAUTHORIZED/);
 assert.throws(()=>service.list(1,0,'server-actor'),/Invalid/);
});
test('ai_parse new draft timeout preserves legacy and Quick Capture dispatch',async()=>{
 const code=fs.readFileSync('cloudfunctions/ai_parse/index.js','utf8'),calls=[];
 const exports={};const sandbox={exports,process:{env:{AI_MODEL:'configured-text',VISION_MODEL:'configured-vision'}},require:name=>{
   if(name==='./db')return {rdb:{},generateText:async(m,o)=>{calls.push(o);return {text:'{"phone":"123"}'};},extractJson:JSON.parse,assertOk(){}};
   if(name==='./quick-capture-v2')return {quickCaptureV2:async()=>({v2:true})};
   if(name==='./quick-capture-focused')return {quickCaptureFocused:async()=>({focused:true})};
   throw Error(name);
 }};vm.runInNewContext(code,sandbox);
 await exports.main({action:'parse_import_draft',text:'test'});assert.equal(calls.at(-1).timeout,45000);
 await exports.main({text:'test'});assert.equal(calls.at(-1).timeout,120000);
 await exports.main({action:'parse_import_draft',images:[{base64:'abc'}]});assert.equal(calls.at(-1).model,'configured-vision');
 assert.equal((await exports.main({action:'quick_capture',profile:'focused'})).focused,true);
 assert.equal((await exports.main({action:'quick_capture',version:2})).v2,true);
});
