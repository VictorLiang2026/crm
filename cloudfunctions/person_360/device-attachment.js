'use strict';
const {Readable}=require('node:stream');
const PART=393216, MAX=100000000;
const reject=(code='INVALID_ATTACHMENT')=>{throw Object.assign(Error(code),{code});};
const types=new Set(['image/png','image/jpeg','image/webp','image/gif','application/pdf']);
function valid(bucket,path){
 if(!['recruit','knowledge'].includes(bucket)||typeof path!=='string'||path.length>700||/[\\\u0000-\u001f]/.test(path)||path.split('/').some(p=>!p||p==='.'||p==='..'))reject();
}
function makeHandler({query,stage,object}){
 return async function handle(e,s){
 if(s?.origin!=='browser'||!s.fingerprint)reject('DEVICE_ACCESS_DENIED');
 const call=(op,p)=>stage(op,s,p);
 async function check(bucket,path,op,size){
  valid(bucket,path);
  if(bucket==='knowledge'){
   if(op!=='upload'||path.split('/').length!==3||path.split('/')[0]!==s.actor)reject();
   const [row]=await query('knowledge_sources',{select:'id,file_size_bytes,content_type,metadata',created_by:'eq.'+s.actor,storage_key:'eq.'+path,deleted_at:'is.null',limit:1});
   if(!row||Number(row.file_size_bytes)!==size||row.metadata?.upload?.phase!=='receiving'||row.metadata.upload.upload_id!==path.split('/')[1])reject();
   return row.content_type;
  }else{
   const m=/^candidate_([1-9]\d*)\/(radar|winner_report)_[0-9]+\.[a-z0-9]{1,16}$/i.exec(path);if(!m)reject();
   const [row]=await query('recruit_candidates',{select:'id,radar_image_file_id,winner_report_file_id',id:'eq.'+m[1],deleted_at:'is.null',limit:1});
   const linked=row?.[m[2]==='radar'?'radar_image_file_id':'winner_report_file_id']===path;
   if(!row||(op==='download'?!linked:linked))reject();
  }
 }
 if(e.op==='begin'){
  const {bucket,path,bytes}=e;if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>MAX)reject();
  const sourceType=await check(bucket,path,'upload',bytes);
  const type=sourceType || (types.has(e.type)?e.type:'application/octet-stream');
  return call('begin',{bucket,path,type,bytes});
 }
 if(e.op==='part'){if(typeof e.part!=='string'||e.part.length>PART*4/3||!/^[A-Za-z0-9+/]+={0,2}$/.test(e.part))reject();await call('put',{id:e.id,i:e.i,part:e.part});return {ok:true};}
 if(e.op==='abort'){await call('drop',{id:e.id});return {ok:true};}
 if(e.op==='finish'){
  const u=await call('finish',{id:e.id});await check(u.bucket,u.path,'upload',u.bytes);
  const stream=Readable.from((async function*(){for(let i=0;i<Math.ceil(u.bytes/PART);i++){
   const r=await call('read',{id:e.id,i});yield Buffer.from(r.part,'base64');
  }})());
  const r=await object(u.bucket,u.path,{method:'POST',duplex:'half',headers:{'content-type':u.type,'content-length':String(u.bytes),'x-upsert':'false'},body:stream});
  if(!r.ok)reject('STORAGE_FAILED');await r.body?.cancel();await call('drop',{id:e.id});return {path:u.path};
 }
 if(e.op==='remove'){
  await check(e.bucket,e.path,'remove');const r=await object(e.bucket,e.path,{method:'DELETE'});if(!r.ok&&r.status!==404)reject('STORAGE_FAILED');await r.body?.cancel();return {ok:true};
 }
 if(e.op==='download'){
  const start=e.offset;if(!Number.isSafeInteger(start)||start<0||start>=MAX||start%PART!==0)reject();
  await check(e.bucket,e.path,'download');
  const r=await object(e.bucket,e.path,{headers:{Range:'bytes='+start+'-'+(start+PART-1)}});
  const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(r.headers.get('content-range')||'');
  let total=NaN;if(r.status===206&&range&&Number(range[1])===start&&Number(range[2])===Math.min(start+PART-1,Number(range[3])-1))total=Number(range[3]);
  else if(r.status===200&&start===0&&r.headers.has('content-length')&&Number(r.headers.get('content-length'))<=PART)total=Number(r.headers.get('content-length'));
  if(!Number.isSafeInteger(total)||total<=start||total>MAX){await r.body?.cancel();reject('STORAGE_RANGE_UNAVAILABLE');}
  const expected=Math.min(PART,total-start),chunks=[];let n=0;
  for await(const c of r.body){n+=c.length;if(n>expected)reject('STORAGE_FAILED');chunks.push(c);}
  if(n!==expected)reject('STORAGE_FAILED');
  const t=r.headers.get('content-type');return {total,type:types.has(t)?t:'application/octet-stream',part:Buffer.concat(chunks).toString('base64')};
 }
 reject();
 };
}
const rest=async(target,options)=>{const env=process.env.TCB_ENV,key=process.env.CRM_PERSON360_DB_API_KEY;if(!/^crm-[a-z0-9]+$/.test(env)||!key)reject('STORAGE_FAILED');
 return fetch('https://'+env+'.api.tcloudbasegateway.com/v1/'+target,{...options,redirect:'error',signal:AbortSignal.timeout(110000),headers:{...options.headers,Authorization:'Bearer '+key}});};
const json=async r=>{if(!r.ok)reject('STORAGE_FAILED');return r.json();};
const handle=makeHandler({
 query:(table,filters)=>rest('rdb/rest/'+table+'?'+new URLSearchParams(filters),{headers:{'Accept-Profile':'public'}}).then(json),
 stage:(p_op,s,p)=>rest('rdb/rest/rpc/crm_device_file_stage_v1',{method:'POST',headers:{'content-type':'application/json','Content-Profile':'public'},body:JSON.stringify({p_op,p_actor:s.actor,p_fp:s.fingerprint,p})}).then(json),
 object:(bucket,path,options)=>rest('storages/object/'+bucket+'/'+path.split('/').map(encodeURIComponent).join('/'),options)
});
module.exports={handle,makeHandler,PART};
