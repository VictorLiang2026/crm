'use strict';

const MAX_BYTES=6*1024*1024;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME_BY_EXT=Object.freeze({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'});

function fail(code){const error=new Error(code);error.code=code;throw error;}
function extension(name){const value=String(name||'').toLowerCase();return value.slice(value.lastIndexOf('.'));}
function imageMime(name){return MIME_BY_EXT[extension(name)]||null;}
function decodeImage(fileName,contentType,base64){
  if(imageMime(fileName)!==contentType||typeof base64!=='string'||base64.length>Math.ceil(MAX_BYTES/3)*4||base64.length%4!==0||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64))fail('INVALID_IMAGE');
  const bytes=Buffer.from(base64,'base64');
  if(!bytes.length||bytes.length>MAX_BYTES||bytes.toString('base64')!==base64)fail('INVALID_IMAGE');
  const valid=contentType==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
    contentType==='image/jpeg'?bytes.length>3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff:
      contentType==='image/webp'?bytes.length>12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP':false;
  if(!valid)fail('INVALID_IMAGE');
  return bytes;
}
function textOf(result){
  const value=result?.text||result?.result||result?.content||(typeof result==='string'?result:'');
  const text=String(value||'').replace(/^\s*<answer>\s*/i,'').replace(/\s*<\/answer>\s*$/i,'').trim();
  if(!text||text.length>100000||text.includes('\0'))fail('OCR_FAILED');
  return text;
}
function createKnowledgeOcr({rdb,generateText,assertOk,visionModel=process.env.VISION_MODEL}={}){
  if(!rdb||typeof generateText!=='function'||typeof assertOk!=='function')throw new Error('Invalid OCR configuration');
  async function imageText(fileName,contentType,base64){
    if(typeof visionModel!=='string'||!visionModel.trim())fail('VISION_MODEL_NOT_CONFIGURED');
    const bytes=decodeImage(fileName,contentType,base64);
    const prompt='请逐字识别图片中可见的文字，按原有顺序和段落输出。保留标题、列表、表格行列关系、日期、金额、数字和标点；无法辨认处标记为[无法辨认]。不要总结、推测或补写图片中没有的内容。';
    const output=await generateText([{role:'user',content:[
      {type:'image_url',image_url:{url:`data:${contentType};base64,${bytes.toString('base64')}`,detail:'high'}},
      {type:'text',text:prompt},
    ]}],{timeout:60000,model:visionModel.trim()});
    return textOf(output);
  }
  async function fromSource(sourceIdValue,uploadIdValue){
    const sourceId=String(sourceIdValue||''),uploadId=String(uploadIdValue||'');
    const numericSourceId=Number(sourceId);
    if(!/^[1-9][0-9]*$/.test(sourceId)||!Number.isSafeInteger(numericSourceId)||!UUID.test(uploadId))fail('INVALID_SOURCE');
    const response=assertOk(await rdb.rpc('crm_knowledge_ocr_input_v1',{
      p_source_id:numericSourceId,p_upload_id:uploadId,
    }));
    const data=response?.data;
    const source=Array.isArray(data)?data[0]:data;
    if(!source?.file_name||!source?.content_type||!source?.original_base64)fail('SOURCE_UNAVAILABLE');
    return {sourceId,ocrText:await imageText(source.file_name,source.content_type,source.original_base64)};
  }
  async function run(event){
    if(event?.sourceId!=null)return fromSource(event.sourceId,event.uploadId);
    const fileName=String(event?.fileName||''),contentType=String(event?.contentType||'');
    return {ocrText:await imageText(fileName,contentType,event?.base64)};
  }
  return {run,imageText,fromSource};
}

module.exports={createKnowledgeOcr,decodeImage,MAX_BYTES};
