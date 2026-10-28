'use strict';
const { extractPdfText }=require('./pdf-text');

async function extract(event,readSource,downloadSource,extractPdfTextImpl=extractPdfText) {
  const limitBytes=event?.sourceId!=null?6*1024*1024:3*1024*1024;
  let value=event?.base64;
  if(event?.sourceId!=null){
    const sourceId=String(event.sourceId);
    const actorUid=String(event?.actorUid||'');
    if(!/^[1-9][0-9]*$/.test(sourceId)||!/^[A-Za-z0-9_-]{1,128}$/.test(actorUid)||typeof readSource!=='function')throw new Error('INVALID_CONTENT');
    let source;
    try{source=await readSource(sourceId,actorUid);}catch{throw new Error('PDF_SOURCE_READ_FAILED');}
    if(!source||source.created_by!==actorUid||source.extraction_status!=='extracting'||source.deleted_at||source.content_type!=='application/pdf'||
      typeof source.file_name!=='string'||!source.file_name.toLowerCase().endsWith('.pdf'))throw new Error('INVALID_CONTENT');
    if(source.storage_key&&!String(source.storage_key).startsWith('pg-private://')){
      if(Number(source.file_size_bytes)>limitBytes||typeof downloadSource!=='function')throw new Error('PDF_LIMIT');
      const bytes=await downloadSource(source.storage_key,actorUid);
      if(!Buffer.isBuffer(bytes)||bytes.length>limitBytes)throw new Error('PDF_LIMIT');
      value=bytes.toString('base64');
    }else value=source.original_base64;
  }
  if(typeof value!=='string'||!value||value.length>Math.ceil(limitBytes/3)*4||value.length%4!==0||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw new Error('INVALID_CONTENT');
  const bytes=Buffer.from(value,'base64');
  if(!bytes.length||bytes.length>limitBytes||bytes.toString('base64')!==value||!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))
    throw new Error('INVALID_CONTENT');
  return {text:await extractPdfTextImpl(bytes)};
}
module.exports={extract};
