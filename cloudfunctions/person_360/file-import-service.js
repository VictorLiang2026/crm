'use strict';

const { createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS = new Set(['customer_name','phone','gender','birthday','occupation','education',
  'marital_status','customer_stage','sales_priority','referral_priority','hobbies','source','additional_info']);
const MAX_BYTES = 4 * 1024 * 1024;
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function id(value) {
  const s=String(value??'');
  if(!/^[1-9]\d*$/.test(s)||!Number.isSafeInteger(Number(s)))throw new Error('Invalid file import identity');
  return s;
}
function uuid(value) {
  if(typeof value!=='string'||!UUID.test(value))throw new Error('Invalid file import request ID');
  return value;
}
function original(data) {
  if(!object(data)||Object.keys(data).some(k=>!['personId','customerId','idempotencyKey','fileName','contentType','base64','notes'].includes(k)))
    throw new Error('Invalid file import payload');
  const personId=id(data.personId),customerId=id(data.customerId);
  if(Number(customerId)>2147483647)throw new Error('Invalid file import customer');
  validateContent(data);
  const payload={personId,customerId,fileName:data.fileName.trim(),contentType:data.contentType,
    base64:data.base64,notes:data.notes||''};
  return {...payload,idempotencyKey:uuid(data.idempotencyKey),
    payloadHash:createHash('sha256').update(JSON.stringify(payload)).digest('hex')};
}
function validateContent(data) {
  if(typeof data.fileName!=='string'||!data.fileName.trim()||data.fileName.length>255||/[\x00-\x1f]/.test(data.fileName)||
    typeof data.contentType!=='string'||!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(data.contentType)||data.contentType.length>120||
    typeof data.base64!=='string'||!data.base64||data.base64.length>Math.ceil(MAX_BYTES/3)*4||
    data.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(data.base64)||
    (data.notes!=null&&(typeof data.notes!=='string'||data.notes.length>4000)))throw new Error('Invalid file import content');
  const bytes=Buffer.from(data.base64,'base64');
  if(bytes.length>MAX_BYTES||bytes.toString('base64')!==data.base64)throw new Error('Invalid file import size or encoding');
}
function parseInput(source) {
  const match=/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(source.photo_url||'');
  if(!match||match[1]!==source.content_type)throw new Error('SOURCE_UNAVAILABLE');
  const bytes=Buffer.from(match[2],'base64');
  if(bytes.length>MAX_BYTES)throw new Error('SOURCE_UNAVAILABLE');
  const type=match[1];
  if(type==='application/pdf'){
    if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw new Error('INVALID_CONTENT');
    return require('./pdf-text').extractPdfText(bytes).then(text=>({text}));
  }
  if(['image/jpeg','image/png','image/webp'].includes(type)){
    const valid=type==='image/jpeg'?bytes.subarray(0,3).equals(Buffer.from([255,216,255])):
      type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
      bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
    if(!valid)throw new Error('INVALID_CONTENT');
    return {images:[{base64:match[2],content_type:type,file_name:source.file_name}]};
  }
  if(type==='text/plain'||type==='text/csv'){
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('INVALID_CONTENT');}
    if(!text.trim()||text.includes('\0')||text.length>100000)throw new Error('INVALID_CONTENT');
    return {text};
  }
  throw new Error('UNSUPPORTED_TYPE');
}
function draft(result,input) {
  if(!object(result)||result.error||!object(result.parsed))throw new Error('PARSE_FAILED');
  const fields={};
  for(const [key,value] of Object.entries(result.parsed)){
    if(!FIELDS.has(key)||value==null||value==='')continue;
    if(typeof value!=='string'||value.length>8000)throw new Error('INVALID_RESULT');
    fields[key]=value.trim();
  }
  const rawText=input.text??result.parsed.ocr_text;
  if(typeof rawText!=='string'||!rawText.trim()||rawText.length>100000)throw new Error('INVALID_RESULT');
  return {fields,rawText};
}
class FileImportService {
  constructor({rpc,parse}) {this.rpc=rpc;this.parse=parse;}
  call(actor,operation,data){
    if(typeof actor!=='string'||!actor.trim()||actor.length>128)throw new Error('UNAUTHORIZED');
    return this.rpc('crm_file_import_v1',{p_actor_uid:actor,p_operation:operation,p_data:data});
  }
  save(data,actor){return this.call(actor,'save',original(data));}
  list(personId,pageValue,actor){
    const page=Number(pageValue??1);
    if(!Number.isInteger(page)||page<1||page>10000)throw new Error('Invalid file import page');
    return this.call(actor,'list',{personId:id(personId),page});
  }
  async parseDraft(jobId,actor){
    const claim=await this.call(actor,'claim',{jobId:uuid(jobId)});
    if(!claim.leaseToken)return claim;
    let parsed;
    try{
      const input=await parseInput(claim.source);
      const result=await this.parse({action:'parse_import_draft',...input});
      parsed=draft(result,input);
    }catch(error){
      const code=['SOURCE_UNAVAILABLE','UNSUPPORTED_TYPE','INVALID_CONTENT','INVALID_RESULT',
        'PDF_ENCRYPTED','PDF_NO_TEXT','PDF_LIMIT','PDF_TIMEOUT'].includes(error.message)?error.message:'PARSE_FAILED';
      return this.call(actor,'fail',{jobId,leaseToken:claim.leaseToken,errorCode:code});
    }
    // Never turn an uncertain commit into a failure write: retry reads the committed job.
    return this.call(actor,'complete',{jobId,leaseToken:claim.leaseToken,...parsed});
  }
}
module.exports={FileImportService,original,validateContent,parseInput,draft};
