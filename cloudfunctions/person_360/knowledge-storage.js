'use strict';

const MAX_KNOWLEDGE_PDF_BYTES=6*1024*1024;
const STORAGE_ERRORS=new Set(['PDF_SOURCE_UNAVAILABLE','PDF_STORAGE_DENIED','PDF_STORAGE_READ_FAILED','PDF_STORAGE_TIMEOUT','PDF_LIMIT']);

function fail(code){const error=new Error(code);error.code=code;throw error;}

async function downloadKnowledgeObject(storageKey,ownerUid,{env=process.env.TCB_ENV,key=process.env.CRM_PERSON360_DB_API_KEY,
  fetchImpl=fetch,timeoutMs=30000}={}){
  const raw=String(storageKey||''),owner=String(ownerUid||''),parts=raw.split('/');
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(owner)||parts.length<3||parts[0]!==owner||
    parts.some(part=>!part||part==='.'||part==='..'))fail('PDF_SOURCE_UNAVAILABLE');
  if(!/^crm-[a-z0-9]+$/.test(env||'')||typeof key!=='string'||!key)fail('PDF_STORAGE_READ_FAILED');
  const path=parts.map(encodeURIComponent).join('/');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(`https://${env}.api.tcloudbasegateway.com/v1/storages/object/knowledge/${path}`,{
      method:'GET',headers:{Authorization:`Bearer ${key}`},signal:controller.signal});
    if(!response.ok)fail(response.status===404?'PDF_SOURCE_UNAVAILABLE':
      response.status===401||response.status===403?'PDF_STORAGE_DENIED':'PDF_STORAGE_READ_FAILED');
    const declaredSize=Number(response.headers?.get?.('content-length')||0);
    if(declaredSize>MAX_KNOWLEDGE_PDF_BYTES)fail('PDF_LIMIT');
    const bytes=Buffer.from(await response.arrayBuffer());
    if(!bytes.length)fail('PDF_SOURCE_UNAVAILABLE');
    if(bytes.length>MAX_KNOWLEDGE_PDF_BYTES)fail('PDF_LIMIT');
    return bytes;
  }catch(error){
    if(STORAGE_ERRORS.has(error?.code))throw error;
    fail(error?.name==='AbortError'?'PDF_STORAGE_TIMEOUT':'PDF_STORAGE_READ_FAILED');
  }finally{clearTimeout(timer);}
}

module.exports={downloadKnowledgeObject,MAX_KNOWLEDGE_PDF_BYTES};
