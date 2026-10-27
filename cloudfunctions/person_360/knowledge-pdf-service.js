'use strict';
const { extractPdfText }=require('./pdf-text');

async function extract(event,readSource,downloadSource) {
  const limitBytes=event?.sourceId!=null?6*1024*1024:3*1024*1024;
  let value=event?.base64;
  if(event?.sourceId!=null){
    const sourceId=String(event.sourceId);
    if(!/^[1-9][0-9]*$/.test(sourceId)||typeof readSource!=='function')throw new Error('INVALID_CONTENT');
    const source=await readSource(sourceId);
    if(!source||source.extraction_status!=='extracting'||source.deleted_at||source.content_type!=='application/pdf'||
      typeof source.file_name!=='string'||!source.file_name.toLowerCase().endsWith('.pdf'))throw new Error('INVALID_CONTENT');
    if(source.storage_key){
      if(Number(source.file_size_bytes)>limitBytes||typeof downloadSource!=='function')throw new Error('PDF_LIMIT');
      const bytes=await downloadSource(source.storage_key);
      if(!Buffer.isBuffer(bytes)||bytes.length>limitBytes)throw new Error('PDF_LIMIT');
      value=bytes.toString('base64');
    }else value=source.original_base64;
  }
  if(typeof value!=='string'||!value||value.length>Math.ceil(limitBytes/3)*4||value.length%4!==0||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw new Error('INVALID_CONTENT');
  const bytes=Buffer.from(value,'base64');
  if(!bytes.length||bytes.length>limitBytes||bytes.toString('base64')!==value||!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))
    throw new Error('INVALID_CONTENT');
  return {text:await extractPdfText(bytes)};
}
module.exports={extract};
