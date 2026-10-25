'use strict';
const {createHash}=require('node:crypto');
const {FileImportService,validateContent}=require('./file-import-service');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS=new Set(['phone','gender','birthday','occupation','education','marital_status','hobbies','source','notes']);
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
function uuid(x){if(typeof x!=='string'||!UUID.test(x))throw Error('Invalid person file ID');return x;}
function id(x){const s=String(x);if(!/^[1-9]\d*$/.test(s)||!Number.isSafeInteger(Number(s)))throw Error('Invalid Person ID');return s;}
class PersonFileService extends FileImportService {
 constructor(options){super(options);this.previewIdentity=options.previewIdentity;this.request=options.request;}
 call(actor,operation,data){
  if(typeof actor!=='string'||!actor.trim()||actor.length>128)throw Error('UNAUTHORIZED');
  return this.rpc('crm_person_file_v1',{p_actor_uid:actor,p_operation:operation,p_data:data});
 }
 save(data,actor){
  if(!object(data)||Object.keys(data).some(k=>!['fileName','contentType','base64','idempotencyKey'].includes(k)))throw Error('Invalid person file payload');
  validateContent(data);
  const payload={fileName:data.fileName.trim(),contentType:data.contentType,base64:data.base64};
  return this.call(actor,'save',{...payload,idempotencyKey:uuid(data.idempotencyKey),
   payloadHash:createHash('sha256').update(JSON.stringify(payload)).digest('hex')});
 }
 list(personId,pageValue,actor){
  const page=Number(pageValue??1);
  if(!Number.isInteger(page)||page<1||page>10000)throw Error('Invalid person file page');
  return this.call(actor,'list',{page,...(personId==null?{}:{personId:id(personId)})});
 }
 async get(jobId,actor,{history=false}={}){
  const result=await this.call(actor,'get',{jobId:uuid(jobId)});
  if(!history)return result;
  const commands=await this.request('crm_person_file_commands','GET',{
   select:'id,operation,status,preview,result,executed_at',actor_uid:`eq.${actor}`,job_id:`eq.${jobId}`,
   status:'in.(executed,undone)',order:'executed_at.desc,id.desc',limit:50,
  });
  return {...result,commands};
 }
 async preview(data,actor){
  if(!object(data)||Object.keys(data).some(k=>!['jobId','idempotencyKey','displayName','personId','fields'].includes(k))||
     typeof data.displayName!=='string'||!data.displayName.trim()||data.displayName.trim().length>160||
     !object(data.fields)||Object.entries(data.fields).some(([k,v])=>!FIELDS.has(k)||typeof v!=='string'||!v.trim()||v.length>8000))
   throw Error('Invalid person file preview');
  const jobId=uuid(data.jobId),key=uuid(data.idempotencyKey);
  // Identity preview is never created for a missing, foreign or already applied original.
  const current=await this.get(jobId,actor);
  if(current.job?.status!=='draft'||current.job.person_id!=null||current.job.apply_command_id!=null)throw Error('Invalid person file draft state');
  const identity=await this.previewIdentity({kind:'person',idempotencyKey:key,displayName:data.displayName.trim(),
    ...(data.personId==null?{}:{personId:id(data.personId)})},actor);
  const fields=Object.fromEntries(Object.entries(data.fields).map(([k,v])=>[k,v.trim()]));
  return this.call(actor,'preview',{jobId,idempotencyKey:key,identityPreviewId:uuid(identity.previewId),fields});
 }
 undo(data,actor){
  if(!object(data)||Object.keys(data).some(k=>!['jobId','commandId','idempotencyKey'].includes(k)))throw Error('Invalid person file undo');
  return this.call(actor,'undo_preview',{jobId:uuid(data.jobId),commandId:uuid(data.commandId),idempotencyKey:uuid(data.idempotencyKey)});
 }
 execute(previewId,actor){return this.call(actor,'execute',{previewId:uuid(previewId)});}
}
module.exports={PersonFileService};

