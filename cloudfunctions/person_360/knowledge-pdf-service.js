'use strict';
const { extractPdfText }=require('./pdf-text');

async function extract(event) {
  const value=event?.base64;
  if(typeof value!=='string'||!value||value.length>Math.ceil(3*1024*1024/3)*4||value.length%4!==0||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw new Error('INVALID_CONTENT');
  const bytes=Buffer.from(value,'base64');
  if(!bytes.length||bytes.length>3*1024*1024||bytes.toString('base64')!==value||!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))
    throw new Error('INVALID_CONTENT');
  return {text:await extractPdfText(bytes)};
}
module.exports={extract};
