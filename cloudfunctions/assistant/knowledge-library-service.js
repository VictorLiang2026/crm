/** Single-operator knowledge ingestion and dual follow-up advice. */
'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { inflateRawSync } = require('node:zlib');
const { createAIGateway } = require('./ai-gateway');
const { createSearchData } = require('./search-data');
const { CONTENT_COLUMNS, projectContent, managementRow, contentVersions } = require('./knowledge-content');
const { createKnowledgeContentService } = require('./knowledge-content-service');
const { MAX_BYTES: MAX_PDF_TEXT_BYTES, MAX_PAGES: MAX_PDF_PAGES, MAX_TEXT_CHARS } = require('./knowledge-pdf-limits');

const MAX_FILE_BYTES = 100_000_000;
const LEGACY_MAX_FILE_BYTES = 6 * 1024 * 1024;
const KNOWLEDGE_BUCKET = 'knowledge';
const UPLOAD_CHUNK_BYTES = 768 * 1024;
const CATEGORIES = Object.freeze(['on_sale_product','existing_service','recruitment_policy','industry_development',
  'marketing_activity','legal_tax','health_wealth_sharing','top_performer_sharing','customer_case','recruitment_case',
  'conversation_strategy','objection_handling','company_information','other']);
const CATEGORY_DOMAIN = Object.freeze({on_sale_product:'product',existing_service:'service',recruitment_policy:'recruitment',
  industry_development:'industry',marketing_activity:'campaign',legal_tax:'legal_tax',health_wealth_sharing:'health_wealth_seminar',
  top_performer_sharing:'top_performer_sharing',customer_case:'case',recruitment_case:'case',
  conversation_strategy:'playbook',objection_handling:'playbook',company_information:'company',other:'other'});
const LEGACY_CATEGORY = Object.freeze({product:'on_sale_product',service:'existing_service',recruitment:'recruitment_policy',
  industry:'industry_development',campaign:'marketing_activity',health_wealth_seminar:'health_wealth_sharing',
  top_performer_sharing:'top_performer_sharing',legal_tax:'legal_tax',case:'customer_case',playbook:'conversation_strategy',
  company:'company_information'});
const REST_TABLES = new Set(['knowledge_sources','knowledge_items','playbooks','knowledge_content_commands',
  'person_followup_advice','persons','ai_tasks','ai_results']);
const FOLLOWUP_ADVICE_COLUMNS = 'id,person_id,client_request_id,title,system_status,system_strategy,system_product_advice,'+
  'system_strategy_sources,system_product_sources,system_version,system_task_id,gpt_strategy,gpt_product_advice,'+
  'gpt_strategy_sources,gpt_product_sources,gpt_based_on_system_version,gpt_kept_for_system_version,gpt_status,'+
  'gpt_preview_id,gpt_preview_payload,gpt_preview_actor,gpt_preview_expires_at,created_by,updated_by,created_at,updated_at,deleted_at';
const EXTENSIONS = Object.freeze({
  '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
});

function fail(code, message = code) { const error = new Error(message); error.code = code; throw error; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function positiveId(value) { return /^[1-9][0-9]*$/.test(String(value ?? '')); }
function actorUid(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) fail('UNAUTHORIZED');
  return value.trim();
}
function todayShanghai() {
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
function validDate(value) { return value == null || value === '' ||
  (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value); }
function cleanText(value, max, name, required = false) {
  if (value == null && !required) return null;
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) fail('INVALID_INPUT', `Invalid ${name}`);
  return value.trim() || null;
}
function redactForTask(value,person={}) {
  let text=String(value||'').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email removed]')
    .replace(/\+?\d[\d ()-]{8,}\d/g,match=>match.replace(/\D/g,'').length>=10?'[phone removed]':match);
  for(const candidate of [person.display_name,person.name,person.legal_name]) {
    const name=String(candidate||'').trim();if(name.length>=2)text=text.split(name).join('[name removed]');
  }
  return text;
}
function adviceDto(row,personName=null) {
  return {id:String(row.id),personId:String(row.person_id),personName:personName||null,title:row.title,
    system:{status:row.system_status,strategy:row.system_strategy||'',productAdvice:row.system_product_advice||'',
      strategySources:row.system_strategy_sources||[],productSources:row.system_product_sources||[],
      version:Number(row.system_version||0),taskId:row.system_task_id?String(row.system_task_id):null},
    gpt:{status:row.gpt_status,strategy:row.gpt_strategy||'',productAdvice:row.gpt_product_advice||'',
      strategySources:row.gpt_strategy_sources||[],productSources:row.gpt_product_sources||[],
      basedOnSystemVersion:row.gpt_based_on_system_version==null?null:Number(row.gpt_based_on_system_version),
      keptForSystemVersion:row.gpt_kept_for_system_version==null?null:Number(row.gpt_kept_for_system_version),
      hasPendingPreview:Boolean(row.gpt_preview_id)},
    createdAt:row.created_at,updatedAt:row.updated_at,deletedAt:row.deleted_at||null};
}
function normalizeCategories(value, legacyDomain) {
  const raw=Array.isArray(value)?value:(LEGACY_CATEGORY[legacyDomain]?[LEGACY_CATEGORY[legacyDomain]]:[]);
  const categories=[...new Set(raw)];
  if(!categories.length||categories.length>14||categories.some(item=>!CATEGORIES.includes(item)))fail('INVALID_CATEGORIES');
  return categories;
}
function domainForCategories(categories) {
  const priority=['legal_tax','top_performer_sharing','industry_development','on_sale_product','recruitment_policy',
    'existing_service','marketing_activity','health_wealth_sharing','customer_case','recruitment_case',
    'conversation_strategy','objection_handling','company_information','other'];
  return CATEGORY_DOMAIN[categories.slice().sort((a,b)=>priority.indexOf(a)-priority.indexOf(b))[0]];
}
function categoryDomains(row) {
  const stored=Array.isArray(row?.metadata?.categories)?row.metadata.categories:[];
  const legacy=row?.metadata?.domain||null;
  return new Set([...stored.map(category=>CATEGORY_DOMAIN[category]).filter(Boolean),legacy].filter(Boolean));
}
function itemTypeForCategories(categories,currentType=null) {
  if(currentType)return currentType;
  if(categories.includes('customer_case')||categories.includes('recruitment_case'))return 'case';
  if(categories.includes('top_performer_sharing'))return 'story';
  if(categories.includes('legal_tax'))return 'regulation';
  if(categories.includes('on_sale_product'))return 'product';
  if(categories.includes('company_information'))return 'company';
  return 'evidence';
}
function decodeBase64(value) {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 ||
      value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail('INVALID_FILE');
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > MAX_FILE_BYTES || bytes.toString('base64') !== value) fail('FILE_TOO_LARGE');
  return bytes;
}
function decodeXml(value) {
  return value.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
    .replace(/&apos;/g,"'").replace(/&amp;/g,'&').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));
}
function zipTextEntries(bytes, accepted) {
  if (!bytes.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04]))) fail('INVALID_CONTENT');
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) fail('INVALID_CONTENT');
  const entries = bytes.readUInt16LE(eocd + 10), directoryOffset = bytes.readUInt32LE(eocd + 16);
  if (entries > 5000 || directoryOffset >= bytes.length) fail('INVALID_CONTENT');
  let cursor = directoryOffset; const targets=[];
  for (let i = 0; i < entries; i++) {
    if (cursor < 0 || cursor + 46 > bytes.length) fail('INVALID_CONTENT');
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) fail('INVALID_CONTENT');
    const method=bytes.readUInt16LE(cursor+10), compressed=bytes.readUInt32LE(cursor+20), uncompressed=bytes.readUInt32LE(cursor+24);
    const nameLength=bytes.readUInt16LE(cursor+28), extraLength=bytes.readUInt16LE(cursor+30), commentLength=bytes.readUInt16LE(cursor+32);
    const localOffset=bytes.readUInt32LE(cursor+42), name=bytes.subarray(cursor+46,cursor+46+nameLength).toString('utf8');
    if (accepted(name)) targets.push({name,method,compressed,uncompressed,localOffset});
    cursor += 46 + nameLength + extraLength + commentLength;
    if (cursor > bytes.length) fail('INVALID_CONTENT');
  }
  if(!targets.length)fail('UNSUPPORTED_TYPE');
  return targets.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})).map(target=>{
    if(target.uncompressed>20*1024*1024||![0,8].includes(target.method))fail('UNSUPPORTED_TYPE');
    const offset=target.localOffset;
    if(offset+30>bytes.length||bytes.readUInt32LE(offset)!==0x04034b50)fail('INVALID_CONTENT');
    const nameLength=bytes.readUInt16LE(offset+26),extraLength=bytes.readUInt16LE(offset+28);
    const start=offset+30+nameLength+extraLength,end=start+target.compressed;
    if(end>bytes.length)fail('INVALID_CONTENT');
    try{const compressed=bytes.subarray(start,end);const xml=target.method===0?compressed:inflateRawSync(compressed,{maxOutputLength:20*1024*1024});
      if(xml.length!==target.uncompressed)fail('INVALID_CONTENT');return {name:target.name,xml:xml.toString('utf8')};}
    catch(error){if(error?.code==='INVALID_CONTENT'||error?.code==='UNSUPPORTED_TYPE')throw error;fail('INVALID_CONTENT');}
  });
}
function xmlPlainText(value) {
  return decodeXml(value.replace(/<w:tab\b[^>]*\/>/g,'\t').replace(/<w:br\b[^>]*\/>/g,'\n')
    .replace(/<a:br\b[^>]*\/>/g,'\n').replace(/<\/w:p>/g,'\n').replace(/<\/a:p>/g,'\n')
    .replace(/<[^>]+>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n\s*/g,'\n').trim();
}
function extractDocx(bytes) {
  const entries=zipTextEntries(bytes,name=>name==='word/document.xml');
  return boundedText(xmlPlainText(entries[0].xml));
}
function extractPptx(bytes) {
  const entries=zipTextEntries(bytes,name=>/^ppt\/slides\/slide\d+\.xml$/.test(name));
  return boundedText(entries.map(entry=>xmlPlainText(entry.xml)).filter(Boolean).join('\n\n'));
}
function extractXlsx(bytes) {
  const entries=zipTextEntries(bytes,name=>name==='xl/sharedStrings.xml'||/^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  const sharedEntry=entries.find(entry=>entry.name==='xl/sharedStrings.xml');
  const shared=sharedEntry?[...sharedEntry.xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(([,cell])=>
    [...cell.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(([,text])=>decodeXml(text)).join('')):[];
  const rows=entries.filter(entry=>entry.name.startsWith('xl/worksheets/')).map(entry=>{
    const cells=[...entry.xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map(([,attrs,cell])=>{
      const value=cell.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1]||cell.match(/<t\b[^>]*>([\s\S]*?)<\/t>/)?.[1]||'';
      const decoded=decodeXml(value);const sharedIndex=attrs.match(/\bt="s"/) ? Number(decoded) : -1;
      return sharedIndex>=0?(shared[sharedIndex]||''):decoded;
    }).filter(Boolean);
    return cells.join(' | ');
  }).filter(Boolean);
  return boundedText(rows.join('\n'));
}
function boundedText(value) {
  const text=String(value||'').replace(/\r/g,'').trim();
  if (!text || text.length>MAX_TEXT_CHARS || text.includes('\0')) fail('UNSUPPORTED_CONTENT');
  return text;
}
function boundedPdfText(value) {
  const text=String(value||'').replace(/\r/g,'').trim();
  if (!text || text.length>MAX_TEXT_CHARS || text.includes('\0')) fail('PDF_TEXT_LIMIT');
  return text;
}
function extensionOf(fileName) { const lower=String(fileName||'').toLowerCase(); return lower.slice(lower.lastIndexOf('.')); }
function fileTypeForName(fileName) { return EXTENSIONS[extensionOf(fileName)]||null; }
function validateImageBytes(mime,bytes) {
  const valid=mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
    mime==='image/jpeg'?bytes.length>3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff:
      mime==='image/webp'?bytes.length>12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP':false;
  if(!valid)fail('INVALID_CONTENT');
}
async function extractImageText(fileName,mime,bytes,{app:client,sourceId,uploadId}={}) {
  validateImageBytes(mime,bytes);
  let response;
  const data=sourceId!=null?{action:'ocr_knowledge_source',sourceId:String(sourceId),uploadId:String(uploadId||'')}:
    {action:'ocr_knowledge_source',fileName,contentType:mime,base64:bytes.toString('base64')};
  try{response=await (client||require('./db').app).callFunction({name:'ai_parse',data});}catch(_){fail('OCR_FAILED');}
  const result=response?.result;
  if(!result||result.error||typeof result.ocrText!=='string')fail(result?.error||'OCR_FAILED');
  return boundedText(result.ocrText);
}
async function extractPdfImageText(bytes,{app:client,pdfPageRenderer,ocrPdfBatch}={}){
  const render=pdfPageRenderer||require('./knowledge-pdf-render').renderPdfPages;
  const callOcr=ocrPdfBatch|| (async images=>{
    let response;
    try{response=await (client||require('./db').app).callFunction({name:'ai_parse',data:{action:'ocr_knowledge_source',images}});}
    catch(_){fail('OCR_FAILED');}
    const result=response?.result;
    if(!result||result.error||typeof result.ocrText!=='string')fail(result?.error||'OCR_FAILED');
    return boundedText(result.ocrText);
  });
  const pages=[];
  await render(bytes,{onBatch:async images=>{
    const text=await callOcr(images);
    if(!text.trim())fail('OCR_FAILED');
    pages.push(text);
  }});
  return boundedText(pages.join('\n\n'));
}
async function extractText(fileName, mime, bytes, options={}) {
  const lower=fileName.toLowerCase();
  const ext=lower.slice(lower.lastIndexOf('.'));
  if (EXTENSIONS[ext]!==mime) fail('UNSUPPORTED_TYPE');
  if (['.txt','.md','.csv'].includes(ext)) {
    let text; try { text=new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch (_) { fail('INVALID_CONTENT'); }
    return boundedText(text);
  }
  if (ext==='.docx') return extractDocx(bytes);
  if (ext==='.pptx') return extractPptx(bytes);
  if (ext==='.xlsx') return extractXlsx(bytes);
  if (['.png','.jpg','.jpeg','.webp'].includes(ext)) return extractImageText(fileName,mime,bytes,options);
  if (ext==='.pdf') {
    if (!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))) fail('INVALID_CONTENT');
    if(bytes.length>MAX_PDF_TEXT_BYTES)fail('PDF_LIMIT');
    const extractPdfText=options.pdfTextExtractor||require('./knowledge-pdf-text').extractPdfText;
    try{return boundedText(await extractPdfText(bytes));}
    catch(error){
      if(error?.code!=='PDF_NO_TEXT')throw error;
      return extractPdfImageText(bytes,options);
    }
  }
  fail('UNSUPPORTED_TYPE');
}
function likelySensitive(text) {
  return /(?<!\d)1[3-9]\d{9}(?!\d)|(?<!\d)\d{17}[\dXx](?!\d)|身份证号|保单号|被保险人|健康告知|诊断结果/.test(text);
}
function metadataForSource(row) {
  return {id:String(row.id),domain:row.domain,title:row.title,publisher:row.publisher||null,
    sourceUri:row.source_uri||null,publishedAt:row.published_at||null,
    reviewAt:row.review_at||null,
    fileName:row.file_name||null,fileSizeBytes:row.file_size_bytes||null,sha256:row.sha256||null,
    extractionStatus:row.extraction_status,lifecycleStatus:row.lifecycle_status,lifecycle_status:row.lifecycle_status,
    versionNo:row.version_no,createdAt:row.created_at,updatedAt:row.updated_at,deletedAt:row.deleted_at||null,
    updated_at:row.updated_at,deleted_at:row.deleted_at||null,
    categories:Array.isArray(row.metadata?.categories)?row.metadata.categories:[],
    ocrProgress:row.metadata?.ocr_job?{stage:row.metadata.ocr_job.stage,completedPages:Math.max(0,Number(row.metadata.ocr_job.next_page||1)-1),totalPages:Number(row.metadata.ocr_job.page_count)||null}:null};
}

function createKnowledgeLibrary(options={}) {
  const env=options.env??process.env.TCB_ENV,key=options.key??process.env.CRM_ASSISTANT_DB_API_KEY;
  const fetchImpl=options.fetchImpl||fetch,client=options.client||require('./db').app;
  const gatewayFactory=options.gatewayFactory||createAIGateway;
  const searchDataFactory=options.searchDataFactory||createSearchData;
  const logger=options.logger||console;
  const callFunction=options.callFunction||client.callFunction.bind(client);
  const contentService=createKnowledgeContentService({
    rpc:(name,args)=>searchDataFactory({env,key,fetchImpl}).auditRdb.rpc(name,args),
    request,sourceBytes,extractText,generateSummary,callFunction,
    extractPdfText:bytes=>require('./knowledge-pdf-text').extractPdfText(bytes),
    renderPdfPages:(bytes,opts)=>require('./knowledge-pdf-render').renderPdfPages(bytes,opts),
  });
  if (!/^crm-[a-z0-9]+$/.test(env||'') || typeof key!=='string' || !key) fail('INVALID_CONFIG');
  async function request(table,method='GET',filters={},body,{timeoutMs=12000}={}) {
    if (!REST_TABLES.has(table)) fail('INVALID_INPUT');
    const url=new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/${table}`);
    for (const [name,value] of Object.entries(filters)) url.searchParams.set(name,String(value));
    const headers={Authorization:`Bearer ${key}`,'Accept-Profile':'public','Content-Profile':'public',Accept:'application/json',
      'Content-Type':'application/json',Prefer:'return=representation'};
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      const response=await fetchImpl(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
      if (!response.ok) { const bodyText=await response.text(); let databaseCode=null;
        try {
          const candidate=JSON.parse(bodyText)?.code;
          if(typeof candidate==='string'&&/^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(candidate))databaseCode=candidate;
        } catch (_) {}
        logger.warn('KNOWLEDGE_DATA_REQUEST_FAILED',JSON.stringify({table,method,status:response.status,databaseCode}));
        const error=new Error(`Knowledge data request failed (${response.status})`);
        error.code=response.status===409?'DUPLICATE_SOURCE':response.status===401||response.status===403?'PERMISSION_DENIED':'PERSISTENCE_ERROR';
        if(/23505/.test(bodyText))error.code='DUPLICATE_SOURCE'; throw error; }
      const text=await response.text(); return text?JSON.parse(text):[];
    } finally { clearTimeout(timer); }
  }
  async function storageRequest(objectKey,method='GET') {
    const safeKey=String(objectKey||'').split('/').map(part=>encodeURIComponent(part)).join('/');
    if(!safeKey||objectKey.split('/').some(part=>!part||part==='.'||part==='..'))fail('SOURCE_UNAVAILABLE');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);
    try {
      const response=await fetchImpl(`https://${env}.api.tcloudbasegateway.com/v1/storages/object/${KNOWLEDGE_BUCKET}/${safeKey}`,{
        method,headers:{Authorization:`Bearer ${key}`},signal:controller.signal});
      if(method==='DELETE'&&(response.ok||response.status===404))return true;
      if(!response.ok)fail(response.status===404?'SOURCE_UNAVAILABLE':'STORAGE_FAILED');
      if(method==='HEAD')return {size:Number(response.headers.get('content-length')||0),contentType:response.headers.get('content-type')||null};
      const declaredSize=Number(response.headers.get('content-length')||0);
      if(declaredSize>MAX_FILE_BYTES)fail('FILE_TOO_LARGE');
      const bytes=Buffer.from(await response.arrayBuffer());
      if(!bytes.length||bytes.length>MAX_FILE_BYTES)fail('FILE_TOO_LARGE');
      return bytes;
    } catch(error) {
      if(error?.code)throw error;
      fail('STORAGE_FAILED');
    } finally {clearTimeout(timer);}
  }
  async function sourceBytes(source,ownerUid) {
    if(typeof source?.original_base64==='string'&&source.original_base64)return decodeBase64(source.original_base64);
    const path=String(source?.storage_key||'');
    if(!path||path.startsWith('pg-private://'))fail('SOURCE_UNAVAILABLE');
    const pathOwner=path.split('/')[0];
    if(ownerUid&&pathOwner!==ownerUid)fail('SOURCE_UNAVAILABLE');
    return storageRequest(path,'GET');
  }
  async function sourceRows() {
    const rows=await request('knowledge_sources','GET',{select:'id,domain,title,publisher,source_uri,published_at,review_at,file_name,file_size_bytes,sha256,extraction_status,lifecycle_status,version_no,created_at,updated_at,deleted_at,metadata',deleted_at:'is.null',order:'updated_at.desc,id.desc',limit:200});
    return rows.filter(row=>row.metadata?.upload?.phase!=='receiving');
  }
  async function list(actorValue) {
    const actor=actorUid(actorValue);
    const [sources,items,playbooks,pendingCommands]=await Promise.all([
      sourceRows(),request('knowledge_items','GET',{select:'id,source_id,item_type,source,source_date,valid_from,valid_to,verified,lifecycle_status,version_no,supersedes_id,confidence,content,metadata,updated_at,deleted_at,'+CONTENT_COLUMNS,deleted_at:'is.null',order:'updated_at.desc,id.desc',limit:200}),
      request('playbooks','GET',{select:'id,scenario,objection,possible_underlying_reasons,clarifying_questions,response_logic,evidence_refs,case_refs,story_refs,do_not_say,next_objective,source,confidence,valid_from,valid_to,version_no,supersedes_id,metadata,lifecycle_status,updated_at,deleted_at,'+CONTENT_COLUMNS,deleted_at:'is.null',order:'updated_at.desc,id.desc',limit:100}),
      request('knowledge_content_commands','GET',{select:'record_table,record_id,created_at',actor_uid:`eq.${actor}`,status:'eq.pending_review',limit:300}),
    ]);
    const pendingKeys=new Map(pendingCommands.map(command=>[`${command.record_table}:${command.record_id}`,command.created_at]));
    return {ok:true,sources:sources.map(metadataForSource),
      knowledge:items.map(row=>{
        const source=sources.find(s=>String(s.id)===String(row.source_id));
        return {...managementRow(row,'knowledge_items',source),sourceUpdatedAt:source?.updated_at||null,
          sourceLifecycleStatus:source?.lifecycle_status||null,sourceExtractionStatus:source?.extraction_status||null,
          contentReviewPending:pendingKeys.has(`knowledge_items:${row.id}`),contentReviewPendingAt:pendingKeys.get(`knowledge_items:${row.id}`)||null};
      }),
      playbooks:playbooks.map(row=>({...managementRow(row,'playbooks'),contentReviewPending:pendingKeys.has(`playbooks:${row.id}`),
        contentReviewPendingAt:pendingKeys.get(`playbooks:${row.id}`)||null}))};
  }
  async function trashList() {
    const [sources,items,playbooks]=await Promise.all([
      request('knowledge_sources','GET',{select:'id,domain,title,file_name,updated_at,deleted_at,metadata',deleted_at:'not.is.null',order:'deleted_at.desc,id.desc',limit:200}),
      request('knowledge_items','GET',{select:'id,source_id,item_type,source,metadata,lifecycle_status,updated_at,deleted_at',deleted_at:'not.is.null',order:'deleted_at.desc,id.desc',limit:200}),
      request('playbooks','GET',{select:'id,scenario,objection,metadata,lifecycle_status,updated_at,deleted_at',deleted_at:'not.is.null',order:'deleted_at.desc,id.desc',limit:200}),
    ]);
    return {ok:true,rows:[...items.map(row=>({...row,table:'knowledge_items',title:row.source})),
      ...playbooks.map(row=>({...row,table:'playbooks',title:`${row.scenario}${row.objection?` · ${row.objection}`:''}`})),
      ...sources.map(row=>({...row,table:'knowledge_sources',title:row.title||row.file_name}))]
      .sort((a,b)=>String(b.deleted_at).localeCompare(String(a.deleted_at)))};
  }
  async function verifyItem(id,actor,updatedAt) {
    const database=searchDataFactory({env,key,fetchImpl});
    const result=await database.auditRdb.rpc('crm_knowledge_review_v1',{p_table:'knowledge_items',p_id:Number(id),
      p_action:'verify',p_actor_uid:actor,p_expected_updated_at:updatedAt});
    if(result?.error||!result?.data?.ok)fail(result?.data?.code||'VERIFY_FAILED');
    return result.data;
  }
  async function generateSummary({domain,title,content},actor) {
    const database=searchDataFactory({env,key,fetchImpl});
    const gateway=gatewayFactory({app:client,rdb:database.auditRdb,timeoutMs:60000,maxAttempts:1,
      actorResolver:async()=>({uid:actor,isAnonymous:false})});
    const task=await gateway.runAITask({taskType:'knowledge_summary',skill:'knowledge_extract',capability:'summarization',
      input:{domain,title},context:{document:{title,domain,text:content}},
      contextSnapshot:{document:{title,domain,text:content},_context:{recipe:'knowledge_summary',version:'1.0.0'}}});
    const summary=cleanText(task.result?.summary,1200,'summary',true);
    return {summary,taskId:String(task.taskId),resultId:String(task.resultId)};
  }
  async function saveKnowledge(input,actorValue) {
    const actor=actorUid(actorValue);
    if(!object(input))fail('INVALID_INPUT');
    const categories=normalizeCategories(input.categories,input.domain),domain=domainForCategories(categories);
    const id=input.id==null||input.id===''?null:String(input.id);
    if(id&&!positiveId(id))fail('INVALID_INPUT');
    const title=cleanText(input.title,500,'title',true),
      publishedAt=input.publishedAt||todayShanghai(),sourceUri=cleanText(input.sourceUri,2000,'sourceUri'),
      confidence=input.confidence==null?0.8:Number(input.confidence);
    if(!validDate(publishedAt)||!Number.isFinite(confidence)||confidence<0||confidence>1)fail('INVALID_INPUT');
    if(sourceUri&&!/^https:\/\//i.test(sourceUri))fail('INVALID_INPUT');
    let current=null,currentStatus=null;
    if(id){
      const rows=await request('knowledge_items','GET',{select:'*',id:`eq.${id}`,deleted_at:'is.null',limit:1});
      current=rows[0];if(!current)fail('NOT_FOUND');
      if(!input.expectedUpdatedAt||current.updated_at!==input.expectedUpdatedAt)fail('STALE_SOURCE');
      currentStatus=current.lifecycle_status||(current.verified?'verified':'draft');
      if(!['draft','verified','invalidated'].includes(currentStatus))fail('INVALID_INPUT');
    }
    if(current?.content_state?.original){
      const original=contentVersions(current).original;
      if(String(input.content||'').trim()!==String(original.text||'').trim() ||
        String(input.summary||'').trim()!==String(original.summary||'').trim())fail('CONTENT_USE_VERSION_EDITOR');
      // Keep the old metadata editor usable without rewriting either content pair.
      const rows=await request('knowledge_items','PATCH',{id:`eq.${id}`,updated_at:`eq.${input.expectedUpdatedAt}`,deleted_at:'is.null'},
        {source:title,confidence,metadata:{...current.metadata,domain,categories,published_at:publishedAt,source_uri:sourceUri},
         updated_at:new Date().toISOString(),updated_by:actor});
      if(rows.length!==1)fail('STALE_SOURCE');return {ok:true,row:rows[0],revision:false,summaryGenerated:false};
    }
    const content=cleanText(input.content,8000,'content',true);
    if(categories.includes('top_performer_sharing')&&likelySensitive(content))fail('PERSONAL_DATA_DETECTED');
    const summary=input.summary?cleanText(input.summary,1200,'summary',true):null;
    const generated=summary?null:await generateSummary({domain,title,content},actor);
    const metadata={...(current?.metadata||{}),domain,categories,
      summary:summary||generated.summary,summary_source:summary?'manual':'ai',
      published_at:publishedAt,source_uri:sourceUri,
      jurisdiction:undefined,sharing_authorized:undefined,anonymized:undefined,
      ...(generated?{summary_task_id:generated.taskId,summary_result_id:generated.resultId}:{})};
    const parent=current&&(current.lifecycle_status||(current.verified?'verified':'draft'))==='verified'?current:null;
    const payload={item_type:itemTypeForCategories(categories,current?.item_type),source:title,source_date:null,
      valid_from:null,valid_to:null,verified:false,lifecycle_status:'draft',confidence,content,metadata,
      source_id:current?.source_id||null,supersedes_id:parent?Number(parent.id):(current?.supersedes_id||null),
      version_no:parent?Number(parent.version_no||1)+1:Number(current?.version_no||1),updated_by:actor};
    let rows;
    if(current&&!parent){
      rows=await request('knowledge_items','PATCH',{id:`eq.${id}`,updated_at:`eq.${input.expectedUpdatedAt}`},
        {...payload,created_by:undefined,created_at:undefined});
      if(rows.length!==1)fail('STALE_SOURCE');
    }else{
      rows=await request('knowledge_items','POST',{},[{...payload,created_by:actor}]);
    }
    if(!rows?.[0]?.id)fail('PERSISTENCE_ERROR');
    if(current&&!parent&&currentStatus==='invalidated'&&!generated) {
      const database=searchDataFactory({env,key,fetchImpl});
      const activated=await database.auditRdb.rpc('crm_knowledge_set_valid_v1',{p_table:'knowledge_items',p_id:Number(rows[0].id),
        p_valid:true,p_actor_uid:actor,p_expected_updated_at:rows[0].updated_at});
      if(activated?.error||!activated?.data?.ok)fail(activated?.data?.code||'VERIFY_FAILED');
    } else if(!generated) await verifyItem(rows[0].id,actor,rows[0].updated_at);
    const saved=(await request('knowledge_items','GET',{select:'*',id:`eq.${rows[0].id}`,deleted_at:'is.null',limit:1}))[0]||rows[0];
    return {ok:true,row:saved,summaryGenerated:!!generated,reviewRequired:!!generated,revision:!!parent};
  }
  function fields(input) {
    if (!object(input)) fail('INVALID_INPUT');
    const categories=normalizeCategories(input.categories,input.domain),domain=domainForCategories(categories);
    const title=cleanText(input.title,500,'title',true),publisher=cleanText(input.publisher,500,'publisher'),
      sourceUri=cleanText(input.sourceUri,2000,'sourceUri'),
      fileName=cleanText(input.fileName,255,'fileName',true),contentType=fileTypeForName(fileName);
    if(!contentType)fail('UNSUPPORTED_TYPE');
    if(input.fileSizeBytes!=null&&(!Number.isSafeInteger(Number(input.fileSizeBytes))||Number(input.fileSizeBytes)<1||Number(input.fileSizeBytes)>MAX_FILE_BYTES))fail('FILE_TOO_LARGE');
    for (const key of ['publishedAt','reviewAt']) if (!validDate(input[key])) fail('INVALID_INPUT');
    if (sourceUri && !/^https:\/\//i.test(sourceUri)) fail('INVALID_INPUT');
    const publishedAt=input.publishedAt||todayShanghai();
    return {domain,categories,title,publisher,sourceUri,publishedAt,
      reviewAt:input.reviewAt||null,fileName,contentType};
  }
  async function extractToDraft(source,base64,actor,preparedText=null) {
    const text=preparedText||await extractText(source.file_name,source.content_type,await sourceBytes(source,actor),
      {app:client,sourceId:source.id,uploadId:source.metadata?.upload?.upload_id});
    if(Array.isArray(source.metadata?.categories)&&source.metadata.categories.includes('top_performer_sharing')&&likelySensitive(text)) fail('PERSONAL_DATA_DETECTED');
    const database=searchDataFactory({env,key,fetchImpl});
    const gateway=gatewayFactory({app:client,rdb:database.auditRdb,timeoutMs:60000,maxAttempts:1,
      actorResolver:async()=>({uid:actor,isAnonymous:false})});
    const task=await gateway.runAITask({taskType:'knowledge_source_extract',skill:'knowledge_extract',capability:'summarization',
      input:{domain:source.domain,title:source.title},
      context:{document:{title:source.title,domain:source.domain,categories:source.metadata?.categories||[],
        sourceDate:source.published_at||null,text}},
      contextSnapshot:{document:{title:source.title,domain:source.domain,categories:source.metadata?.categories||[],
        sourceDate:source.published_at||null,text},_context:{recipe:'knowledge_source_extract',version:'1.0.0'}}});
    const out=task.result;
    const content=[out.summary,`知识点：\n${out.keyPoints.map(x=>`• ${x}`).join('\n')}`,
      `营销/服务应用：\n${out.applicationNotes.map(x=>`• ${x}`).join('\n')}`,
      `适用边界：\n${out.boundaries.map(x=>`• ${x}`).join('\n')}`].join('\n\n').slice(0,7900);
    const categories=normalizeCategories(source.metadata?.categories,source.domain);
    const meta={domain:source.domain,categories,review_at:source.review_at,
      source_uri:source.source_uri,published_at:source.published_at,
      summary:out.summary,summary_source:'ai',extraction_task_id:String(task.taskId),
      extraction_result_id:String(task.resultId),source_version:source.version_no};
    const itemRows=await request('knowledge_items','POST',{},[{item_type:itemTypeForCategories(categories),source:source.title,
      source_date:null,valid_from:null,valid_to:null,verified:false,
      confidence:null,content,metadata:meta,lifecycle_status:'draft',created_by:actor,updated_by:actor,
      supersedes_id:null,version_no:source.version_no,source_id:source.id}]);
    if(!Array.isArray(itemRows)||!itemRows[0]?.id) fail('PERSISTENCE_ERROR');
    await request('knowledge_sources','PATCH',{id:`eq.${source.id}`},
      {extraction_status:'draft',extracted_at:new Date().toISOString(),updated_at:new Date().toISOString(),updated_by:actor});
    return {itemId:String(itemRows[0].id),sourceId:String(source.id),draft:true,reviewRequired:true,summary:out.summary,
      keyPoints:out.keyPoints,taskId:String(task.taskId),resultId:String(task.resultId)};
  }
  async function enqueuePdfOcr(source,actor) {
    const prior=source.metadata?.ocr_job||{};
    const job={stage:prior.stage==='summarize'?'summarize':'ocr',next_page:Math.max(1,Number(prior.next_page)||1),
      page_count:Number.isSafeInteger(Number(prior.page_count))?Number(prior.page_count):null,
      text:typeof prior.text==='string'?prior.text:'',attempts:0,lease_until:null,last_error:null};
    const saved=await request('knowledge_sources','PATCH',{select:'id,updated_at',id:'eq.'+source.id,
      updated_at:'eq.'+source.updated_at,created_by:'eq.'+actor,deleted_at:'is.null'},
      {metadata:{...source.metadata,ocr_job:job},extraction_status:'extracting',
       updated_at:new Date().toISOString(),updated_by:actor},{timeoutMs:30000});
    if(saved.length!==1)fail('STALE_SOURCE');
    return {ok:true,queued:true,sourceId:String(source.id),extractionStatus:'extracting'};
  }
  async function pdfTextLayerOrQueue(source,bytes,actor) {
    if(source.content_type!=='application/pdf')return null;
    try{return {text:await require('./knowledge-pdf-text').extractPdfText(bytes)};}
    catch(error){if(error?.code!=='PDF_NO_TEXT')throw error;return enqueuePdfOcr(source,actor);}
  }
  async function processOcrQueue(options={}) {
    const candidates=await request('knowledge_sources','GET',{select:'*',extraction_status:'eq.extracting',
      deleted_at:'is.null',order:'updated_at.asc,id.asc',limit:20});
    const source=candidates.find(row=>row.metadata?.ocr_job&&
      (!row.metadata.ocr_job.lease_until||Date.parse(row.metadata.ocr_job.lease_until)<Date.now()));
    if(!source)return {ok:true,processed:false};
    const actor=actorUid(source.created_by),job={...source.metadata.ocr_job};
    const claimedJob={...job,lease_until:new Date(Date.now()+5*60*1000).toISOString()};
    const claimed=(await request('knowledge_sources','PATCH',{select:'id,updated_at',id:'eq.'+source.id,
      updated_at:'eq.'+source.updated_at,created_by:'eq.'+actor,deleted_at:'is.null'},
      {metadata:{...source.metadata,ocr_job:claimedJob},updated_at:new Date().toISOString(),updated_by:actor},
      {timeoutMs:30000}))[0];
    if(!claimed)return {ok:true,processed:false};
    source.updated_at=claimed.updated_at;source.metadata={...source.metadata,ocr_job:claimedJob};
    try {
      if(job.stage==='summarize') {
        const result=await extractToDraft(source,null,actor,job.text);
        const metadata={...source.metadata};delete metadata.ocr_job;
        await request('knowledge_sources','PATCH',{id:'eq.'+source.id,created_by:'eq.'+actor,deleted_at:'is.null'},
          {metadata,updated_at:new Date().toISOString(),updated_by:actor},{timeoutMs:30000});
        return {ok:true,processed:true,sourceId:String(source.id),stage:'complete',itemId:result.itemId};
      }
      const bytes=await sourceBytes(source,actor),images=[];
      const render=options.pdfPageRenderer||require('./knowledge-pdf-render').renderPdfPages;
      const rendered=await render(bytes,{
        startPage:job.next_page,maxPages:3,timeoutMs:75000,onBatch:async batch=>{images.push(...batch);}
      });
      if(!Number.isSafeInteger(rendered.pageCount)||rendered.pageCount<1||rendered.pageCount>MAX_PDF_PAGES)fail('PDF_PAGE_LIMIT');
      if(job.page_count&&job.page_count!==rendered.pageCount)fail('INVALID_CONTENT');
      const response=options.ocrPdfBatch?{result:{ocrText:await options.ocrPdfBatch(images)}}:
        await callFunction({name:'ai_parse',data:{action:'ocr_knowledge_source',images}});
      const result=response?.result;
      if(!result||result.error||typeof result.ocrText!=='string'||!result.ocrText.trim())fail(result?.error||'OCR_FAILED');
      job.text=boundedPdfText(String(job.text||'')+(job.text?'\n\n':'')+boundedPdfText(result.ocrText));
      job.page_count=rendered.pageCount;job.next_page=rendered.nextPage;
      if(job.next_page>job.page_count)job.stage='summarize';
      Object.assign(job,{lease_until:null,attempts:0,last_error:null});
      const saved=await request('knowledge_sources','PATCH',{select:'id,updated_at',id:'eq.'+source.id,
        created_by:'eq.'+actor,deleted_at:'is.null'},
        {metadata:{...source.metadata,ocr_job:job},updated_at:new Date().toISOString(),updated_by:actor,
         extraction_status:'extracting'},{timeoutMs:30000});
      if(saved.length!==1)fail('STALE_SOURCE');
      return {ok:true,processed:true,sourceId:String(source.id),stage:job.stage,
        completedPages:Math.min(job.page_count,job.next_page-1),totalPages:job.page_count};
    } catch(error) {
      const attempts=Number(job.attempts||0)+1,keep=attempts<5;
      const failedJob={...job,attempts,lease_until:null,last_error:String(error?.code||'OCR_FAILED').slice(0,64)};
      await request('knowledge_sources','PATCH',{id:'eq.'+source.id,created_by:'eq.'+actor,deleted_at:'is.null'},
        {metadata:{...source.metadata,ocr_job:failedJob},extraction_status:keep?'extracting':'failed',
         updated_at:new Date().toISOString(),updated_by:actor},{timeoutMs:30000}).catch(()=>{});
      return {ok:false,processed:true,sourceId:String(source.id),errorCode:error?.code||'OCR_FAILED',retrying:keep};
    }
  }

  async function uploadStart(input,actorValue) {
    const actor=actorUid(actorValue),meta=fields(input),fileSizeBytes=Number(input.fileSizeBytes);
    if(!Number.isSafeInteger(fileSizeBytes)||fileSizeBytes<1||fileSizeBytes>LEGACY_MAX_FILE_BYTES)fail('FILE_TOO_LARGE');
    const uploadId=randomUUID(),placeholderDigest=createHash('sha256').update(`knowledge-upload:${uploadId}`).digest('hex');
    const upload={upload_id:uploadId,phase:'receiving',file_size_bytes:fileSizeBytes,
      chunk_count:Math.ceil(fileSizeBytes/UPLOAD_CHUNK_BYTES),next_chunk:0,chunk_hashes:[]};
    const payload={domain:meta.domain,title:meta.title,publisher:meta.publisher,source_uri:meta.sourceUri,
      published_at:meta.publishedAt,valid_from:null,valid_to:null,review_at:meta.reviewAt,
      storage_key:`pg-private://knowledge-sources/uploads/${uploadId}`,file_name:meta.fileName,
      content_type:meta.contentType,file_size_bytes:fileSizeBytes,sha256:placeholderDigest,
      extraction_status:'queued',lifecycle_status:'draft',version_no:1,created_by:actor,updated_by:actor,
      metadata:{categories:meta.categories,upload},original_base64:''};
    const rows=await request('knowledge_sources','POST',{select:'id,updated_at'},[payload]);
    if(!rows?.[0]?.id)fail('PERSISTENCE_ERROR');
    return {ok:true,sourceId:String(rows[0].id),uploadId,chunkSize:UPLOAD_CHUNK_BYTES,chunkCount:upload.chunk_count};
  }
  async function uploadPrepare(input,actorValue) {
    const actor=actorUid(actorValue),meta=fields(input),fileSizeBytes=Number(input.fileSizeBytes);
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(actor))fail('INVALID_ACTOR');
    if(!Number.isSafeInteger(fileSizeBytes)||fileSizeBytes<1||fileSizeBytes>MAX_FILE_BYTES)fail('FILE_TOO_LARGE');
    const uploadId=randomUUID(),placeholderDigest=createHash('sha256').update(`knowledge-upload:${uploadId}`).digest('hex');
    const fileName=meta.fileName.replace(/[\\/\u0000-\u001f]/g,'_').replace(/^\.+/,'_');
    const storageKey=`${actor}/${uploadId}/${fileName}`;
    const upload={upload_id:uploadId,phase:'receiving',file_size_bytes:fileSizeBytes,storage_bucket:KNOWLEDGE_BUCKET};
    const rows=await request('knowledge_sources','POST',{select:'id,updated_at'},[{
      domain:meta.domain,title:meta.title,publisher:meta.publisher,source_uri:meta.sourceUri,
      published_at:meta.publishedAt,valid_from:null,valid_to:null,review_at:meta.reviewAt,
      storage_key:storageKey,file_name:meta.fileName,content_type:meta.contentType,file_size_bytes:fileSizeBytes,
      sha256:placeholderDigest,extraction_status:'queued',lifecycle_status:'draft',version_no:1,
      created_by:actor,updated_by:actor,metadata:{categories:meta.categories,upload},original_base64:null,
    }]);
    if(!rows?.[0]?.id)fail('PERSISTENCE_ERROR');
    return {ok:true,sourceId:String(rows[0].id),uploadId,storageBucket:KNOWLEDGE_BUCKET,storageKey,contentType:meta.contentType};
  }
  async function uploadChunk(input,actorValue) {
    const actor=actorUid(actorValue),sourceId=String(input?.sourceId||''),uploadId=String(input?.uploadId||''),index=Number(input?.index);
    if(!positiveId(sourceId)||!/^[-0-9a-f]{36}$/i.test(uploadId)||!Number.isSafeInteger(index)||index<0)fail('INVALID_INPUT');
    const bytes=decodeBase64(input.chunkBase64),digest=createHash('sha256').update(bytes).digest('hex');
    const rows=await request('knowledge_sources','GET',{select:'id,created_by,metadata,original_base64,updated_at,deleted_at',id:`eq.${sourceId}`,limit:1});
    const source=rows[0],state=source?.metadata?.upload;
    if(!source||source.deleted_at||source.created_by!==actor||state?.phase!=='receiving'||state.upload_id!==uploadId)fail('SOURCE_UNAVAILABLE');
    const expectedBytes=Math.min(UPLOAD_CHUNK_BYTES,state.file_size_bytes-index*UPLOAD_CHUNK_BYTES);
    if(expectedBytes<1||bytes.length!==expectedBytes||index>=state.chunk_count)fail('INVALID_FILE');
    const next=Number(state.next_chunk||0),hashes=Array.isArray(state.chunk_hashes)?state.chunk_hashes:[];
    if(index<next){if(hashes[index]===digest)return {ok:true,duplicate:true,nextChunk:next};fail('UPLOAD_CHUNK_CONFLICT');}
    if(index!==next)fail('UPLOAD_CHUNK_ORDER');
    if(index<state.chunk_count-1&&bytes.length%3!==0)fail('INVALID_FILE');
    const base64=String(input.chunkBase64),updatedUpload={...state,next_chunk:next+1,chunk_hashes:[...hashes,digest]};
    const updated=await request('knowledge_sources','PATCH',{select:'id,updated_at',id:`eq.${sourceId}`,
      updated_at:`eq.${source.updated_at}`,created_by:`eq.${actor}`,deleted_at:'is.null'},
      {original_base64:String(source.original_base64||'')+base64,metadata:{...source.metadata,upload:updatedUpload},
        updated_at:new Date().toISOString(),updated_by:actor},{timeoutMs:30000});
    if(updated.length!==1)fail('STALE_SOURCE');
    return {ok:true,nextChunk:next+1};
  }
  async function uploadFinalize(input,actorValue) {
    const actor=actorUid(actorValue),sourceId=String(input?.sourceId||''),uploadId=String(input?.uploadId||'');
    if(!positiveId(sourceId)||!/^[-0-9a-f]{36}$/i.test(uploadId))fail('INVALID_INPUT');
    const rows=await request('knowledge_sources','GET',{select:'*',id:`eq.${sourceId}`,created_by:`eq.${actor}`,deleted_at:'is.null',limit:1});
    const source=rows[0],state=source?.metadata?.upload;
    if(!source||state?.upload_id!==uploadId)fail('SOURCE_UNAVAILABLE');
    if(state.phase==='complete')return {ok:true,sourceId,extractionStatus:source.extraction_status};
    if(state.storage_bucket===KNOWLEDGE_BUCKET&&state.phase==='receiving') {
      const bytes=await storageRequest(source.storage_key,'GET');
      if(bytes.length!==Number(state.file_size_bytes)||bytes.length!==Number(source.file_size_bytes))fail('INVALID_FILE');
      const digest=createHash('sha256').update(bytes).digest('hex');
      const existing=await request('knowledge_sources','GET',{select:'id,extraction_status',sha256:`eq.${digest}`,id:`neq.${sourceId}`,limit:1});
      if(existing.length){
        await storageRequest(source.storage_key,'DELETE').catch(()=>{});
        await request('knowledge_sources','DELETE',{id:`eq.${sourceId}`,created_by:`eq.${actor}`,deleted_at:'is.null'});
        return {ok:true,duplicate:true,sourceId:String(existing[0].id),extractionStatus:existing[0].extraction_status};
      }
      const upload={...state,phase:'complete'};
      const prepared={...source,sha256:digest,metadata:{...source.metadata,upload}};
      const marked=await request('knowledge_sources','PATCH',{select:'id,updated_at',id:`eq.${sourceId}`,
        updated_at:`eq.${source.updated_at}`,created_by:`eq.${actor}`},
        {sha256:digest,metadata:prepared.metadata,extraction_status:'extracting',updated_at:new Date().toISOString(),updated_by:actor},
        {timeoutMs:30000});
      if(marked.length!==1)fail('STALE_SOURCE');
      prepared.updated_at=marked[0].updated_at;prepared.extraction_status='extracting';
      try {
        const pdf=await pdfTextLayerOrQueue(prepared,bytes,actor);
        if(pdf?.queued)return pdf;
        const extractedText=pdf?.text||await extractText(source.file_name,source.content_type,bytes,{app:client,sourceId,uploadId,actorUid:actor});
        if((source.metadata?.categories||[]).includes('top_performer_sharing')&&likelySensitive(extractedText))fail('PERSONAL_DATA_DETECTED');
        return {ok:true,...await extractToDraft(prepared,null,actor,extractedText),extractionStatus:'draft'};
      } catch(error) {
        if(error.code==='PERSONAL_DATA_DETECTED') {
          await storageRequest(source.storage_key,'DELETE').catch(()=>{});
          await request('knowledge_sources','DELETE',{id:`eq.${sourceId}`,created_by:`eq.${actor}`,deleted_at:'is.null'}).catch(()=>{});
          return {ok:false,sourceId,extractionStatus:'rejected',errorCode:error.code};
        }
        await request('knowledge_sources','PATCH',{id:`eq.${sourceId}`,created_by:`eq.${actor}`,deleted_at:'is.null'},
          {extraction_status:'failed',updated_at:new Date().toISOString(),updated_by:actor},{timeoutMs:30000}).catch(()=>{});
        return {ok:false,sourceId,extractionStatus:'failed',errorCode:error.code||'EXTRACTION_FAILED'};
      }
    }
    if(state.phase!=='receiving'||Number(state.next_chunk)!==Number(state.chunk_count))fail('UPLOAD_INCOMPLETE');
    const bytes=decodeBase64(source.original_base64);
    if(bytes.length!==Number(state.file_size_bytes)||bytes.length!==Number(source.file_size_bytes))fail('INVALID_FILE');
    const digest=createHash('sha256').update(bytes).digest('hex');
    const existing=await request('knowledge_sources','GET',{select:'id,extraction_status',sha256:`eq.${digest}`,id:`neq.${sourceId}`,limit:1});
    if(existing.length){
      await request('knowledge_sources','DELETE',{id:`eq.${sourceId}`,created_by:`eq.${actor}`,deleted_at:'is.null'});
      return {ok:true,duplicate:true,sourceId:String(existing[0].id),extractionStatus:existing[0].extraction_status};
    }
    const upload={...state,phase:'complete'};
    const prepared={...source,sha256:digest,metadata:{...source.metadata,upload}};
    const marked=await request('knowledge_sources','PATCH',{select:'id,updated_at',id:`eq.${sourceId}`,updated_at:`eq.${source.updated_at}`,created_by:`eq.${actor}`},
      {sha256:digest,metadata:prepared.metadata,extraction_status:'extracting',updated_at:new Date().toISOString(),updated_by:actor},
      {timeoutMs:30000});
    if(marked.length!==1)fail('STALE_SOURCE');
    prepared.updated_at=marked[0].updated_at;
    prepared.extraction_status='extracting';
    try{
      const pdf=await pdfTextLayerOrQueue(prepared,bytes,actor);
      if(pdf?.queued)return pdf;
      const extractedText=pdf?.text||await extractText(source.file_name,source.content_type,bytes,{app:client,sourceId,uploadId:state.upload_id,actorUid:actor});
      if((source.metadata?.categories||[]).includes('top_performer_sharing')&&likelySensitive(extractedText))fail('PERSONAL_DATA_DETECTED');
      const draft=await extractToDraft(prepared,source.original_base64,actor,extractedText);
      return {ok:true,...draft,extractionStatus:'draft'};
    }catch(error){
      if(error.code==='PERSONAL_DATA_DETECTED'){
        await request('knowledge_sources','DELETE',{id:`eq.${sourceId}`,created_by:`eq.${actor}`,deleted_at:'is.null'}).catch(()=>{});
        return {ok:false,sourceId,extractionStatus:'rejected',errorCode:error.code};
      }
      await request('knowledge_sources','PATCH',{id:`eq.${sourceId}`,created_by:`eq.${actor}`,deleted_at:'is.null'},
        {extraction_status:'failed',updated_at:new Date().toISOString(),updated_by:actor},{timeoutMs:30000}).catch(()=>{});
      return {ok:false,sourceId,extractionStatus:'failed',errorCode:error.code||'EXTRACTION_FAILED'};
    }
  }
  async function uploadCancel(input,actorValue) {
    const actor=actorUid(actorValue),sourceId=String(input?.sourceId||''),uploadId=String(input?.uploadId||'');
    if(!positiveId(sourceId)||!/^[-0-9a-f]{36}$/i.test(uploadId))fail('INVALID_INPUT');
    const rows=await request('knowledge_sources','GET',{select:'id,created_by,metadata',id:`eq.${sourceId}`,deleted_at:'is.null',limit:1});
    const source=rows[0];
    if(!source||source.created_by!==actor||source.metadata?.upload?.upload_id!==uploadId||source.metadata?.upload?.phase!=='receiving')return {ok:true};
    const linked=await request('knowledge_items','GET',{select:'id',source_id:`eq.${sourceId}`,limit:1});
    if(linked.length)fail('SOURCE_IN_USE');
    if(source.metadata?.upload?.storage_bucket===KNOWLEDGE_BUCKET&&source.storage_key)
      await storageRequest(source.storage_key,'DELETE').catch(()=>{});
    await request('knowledge_sources','DELETE',{id:`eq.${sourceId}`,created_by:`eq.${actor}`,deleted_at:'is.null'});
    return {ok:true};
  }
  async function upload(input,actorValue) {
    const actor=actorUid(actorValue),bytes=decodeBase64(input?.fileBase64);
    if(bytes.length>3*1024*1024)fail('FILE_TOO_LARGE');
    const meta=fields({...input,fileSizeBytes:bytes.length}),extractedText=await extractText(meta.fileName,meta.contentType,bytes,{app:client});
    if(meta.categories.includes('top_performer_sharing')&&likelySensitive(extractedText))fail('PERSONAL_DATA_DETECTED');
    const digest=createHash('sha256').update(bytes).digest('hex');
    const existing=await request('knowledge_sources','GET',{select:'id,extraction_status',sha256:`eq.${digest}`,limit:1});
    if(existing.length)return {ok:true,duplicate:true,sourceId:String(existing[0].id),extractionStatus:existing[0].extraction_status};
    const id=randomUUID(),sourceKey=`pg-private://knowledge-sources/${id}`;
    const payload={domain:meta.domain,title:meta.title,publisher:meta.publisher,source_uri:meta.sourceUri,
      published_at:meta.publishedAt,valid_from:null,valid_to:null,review_at:meta.reviewAt,
      storage_key:sourceKey,file_name:meta.fileName,content_type:meta.contentType,file_size_bytes:bytes.length,sha256:digest,
      extraction_status:'queued',lifecycle_status:'draft',version_no:1,created_by:actor,updated_by:actor,
      metadata:{categories:meta.categories},original_base64:bytes.toString('base64')};
    const rows=await request('knowledge_sources','POST',{},[payload]);
    if(!Array.isArray(rows)||!rows[0]?.id)fail('PERSISTENCE_ERROR');
    try {
      const draft=await extractToDraft(rows[0],payload.original_base64,actor,extractedText);
      return {ok:true,...draft,extractionStatus:'draft'};
    } catch(error) {
      await request('knowledge_sources','PATCH',{id:`eq.${rows[0].id}`},{extraction_status:'failed',updated_at:new Date().toISOString(),updated_by:actor}).catch(()=>{});
      return {ok:false,sourceId:String(rows[0].id),extractionStatus:'failed',errorCode:error.code||'EXTRACTION_FAILED'};
    }
  }
  async function retryExtraction(sourceIdValue,actorValue) {
    const actor=actorUid(actorValue),sourceId=String(sourceIdValue||'');
    if(!positiveId(sourceId))fail('INVALID_INPUT');
    const rows=await request('knowledge_sources','GET',{select:'id,created_by,storage_key,file_name,content_type,updated_at,domain,title,published_at,metadata',
      id:`eq.${sourceId}`,created_by:`eq.${actor}`,deleted_at:'is.null',limit:1});
    if(!rows.length)fail('SOURCE_UNAVAILABLE');
    const items=await request('knowledge_items','GET',{select:'id',source_id:`eq.${sourceId}`,limit:1});
    if(items.length)fail('DRAFT_ALREADY_EXISTS');
    const source=rows[0],storageKey=String(source.storage_key||'');
    if(!storageKey||storageKey.startsWith('pg-private://')) {
      const legacy=(await request('knowledge_sources','GET',{select:'original_base64',id:`eq.${sourceId}`,
        created_by:`eq.${actor}`,deleted_at:'is.null',limit:1}))[0];
      source.original_base64=legacy?.original_base64||'';
    }
    if(!source.original_base64&&!source.storage_key)fail('SOURCE_UNAVAILABLE');
    const extracting=(await request('knowledge_sources','PATCH',{select:'id,updated_at',id:`eq.${sourceId}`,created_by:`eq.${actor}`,deleted_at:'is.null'},
      {extraction_status:'extracting',updated_at:new Date().toISOString(),updated_by:actor}))[0];
    try {
      source.updated_at=extracting?.updated_at||source.updated_at;
      if(source.metadata?.ocr_job){source.updated_at=extracting?.updated_at||source.updated_at;return enqueuePdfOcr(source,actor);}
      const bytes=await sourceBytes(source,actor),pdf=await pdfTextLayerOrQueue(source,bytes,actor);
      if(pdf?.queued)return pdf;
      const text=pdf?.text||await extractText(source.file_name,source.content_type,bytes,{app:client});
      return {ok:true,...await extractToDraft({...source,extraction_status:'extracting'},source.original_base64,actor,text),extractionStatus:'draft'};}
    catch(error){await request('knowledge_sources','PATCH',{id:`eq.${sourceId}`,created_by:`eq.${actor}`,deleted_at:'is.null'},
      {extraction_status:'failed',updated_at:new Date().toISOString(),updated_by:actor}).catch(()=>{});throw error;}
  }
  async function reviewSource(input,actorValue) {
    const actor=actorUid(actorValue),sourceId=String(input?.sourceId||''),itemId=String(input?.itemId||''),action=input?.decision;
    if(!positiveId(sourceId)||!positiveId(itemId)||!['verify','invalidate'].includes(action))fail('INVALID_INPUT');
    if(action==='verify') {
      const rows=await request('knowledge_sources','GET',{select:'id,domain,source_uri,published_at,metadata,updated_at,extraction_status,lifecycle_status',id:`eq.${sourceId}`,limit:1});
      const source=rows[0]; if(!source||source.extraction_status!=='draft'||source.lifecycle_status!=='draft'||source.updated_at!==input.expectedUpdatedAt)fail('STALE_SOURCE');
    }
    const data=searchDataFactory({env,key,fetchImpl});
    const result=await data.auditRdb.rpc('crm_knowledge_source_review_v1',{p_actor_uid:actor,p_source_id:Number(sourceId),
      p_item_id:Number(itemId),p_action:action,p_expected_updated_at:input.expectedUpdatedAt||null});
    if(result?.error||!result?.data?.ok)fail(result?.data?.code||'REVIEW_FAILED');
    return {ok:true,...result.data};
  }
  async function setValidity(input,actorValue) {
    const actor=actorUid(actorValue),table=input?.table,id=String(input?.id||''),valid=input?.valid===true;
    if(!['knowledge_items','playbooks'].includes(table)||!positiveId(id)||!input?.expectedUpdatedAt)fail('INVALID_INPUT');
    if(table==='knowledge_items'&&valid) {
      const item=(await request('knowledge_items','GET',{select:'source_id',id:`eq.${id}`,deleted_at:'is.null',limit:1}))[0];
      if(item?.source_id) {
        const source=(await request('knowledge_sources','GET',{select:'id,lifecycle_status,extraction_status,updated_at',
          id:`eq.${item.source_id}`,deleted_at:'is.null',limit:1}))[0];
        if(source?.lifecycle_status==='draft'&&source.extraction_status!=='draft') {
          const changed=await request('knowledge_sources','PATCH',{id:`eq.${source.id}`,updated_at:`eq.${source.updated_at}`,
            deleted_at:'is.null'},{extraction_status:'draft',updated_at:new Date().toISOString(),updated_by:actor});
          if(changed.length!==1)fail('STALE_SOURCE');
        }
      }
    }
    const database=searchDataFactory({env,key,fetchImpl});
    const result=await database.auditRdb.rpc('crm_knowledge_set_valid_v1',{p_table:table,p_id:Number(id),p_valid:valid,
      p_actor_uid:actor,p_expected_updated_at:input.expectedUpdatedAt});
    if(result?.error||!result?.data?.ok)fail(result?.data?.code||'STATE_UPDATE_FAILED');
    return {ok:true,...result.data};
  }
  async function softDelete(input,actorValue) {
    const actor=actorUid(actorValue),table=input?.table,id=String(input?.id||'');
    if(!['knowledge_items','playbooks','knowledge_sources'].includes(table)||!positiveId(id)||!input?.expectedUpdatedAt)fail('INVALID_INPUT');
    const columns=table==='knowledge_items'?'id,source_id,updated_at,deleted_at':table==='knowledge_sources'?'id,updated_at,deleted_at,extraction_status':'id,updated_at,deleted_at';
    const current=(await request(table,'GET',{select:columns,id:`eq.${id}`,deleted_at:'is.null',limit:1}))[0];
    if(!current||current.updated_at!==input.expectedUpdatedAt)fail('STALE_SOURCE');
    if(table==='knowledge_sources'&&current.extraction_status==='extracting')fail('SOURCE_IN_USE');
    const now=new Date().toISOString();
    const updated=await request(table,'PATCH',{id:`eq.${id}`,updated_at:`eq.${input.expectedUpdatedAt}`,deleted_at:'is.null'},
      {deleted_at:now,updated_at:now,updated_by:actor});
    if(updated.length!==1)fail('STALE_SOURCE');
    if(table==='knowledge_items'&&current.source_id) {
      const remaining=await request('knowledge_items','GET',{select:'id',source_id:`eq.${current.source_id}`,
        deleted_at:'is.null',limit:1});
      if(!remaining.length)await request('knowledge_sources','PATCH',{id:`eq.${current.source_id}`,deleted_at:'is.null'},
        {deleted_at:now,updated_at:now,updated_by:actor});
    }
    return {ok:true,id,table,deletedAt:now};
  }
  async function restore(input,actorValue) {
    const actor=actorUid(actorValue),table=input?.table,id=String(input?.id||'');
    if(!['knowledge_items','playbooks','knowledge_sources'].includes(table)||!positiveId(id))fail('INVALID_INPUT');
    const columns=table==='knowledge_items'?'id,source_id,updated_at,deleted_at':'id,updated_at,deleted_at';
    const current=(await request(table,'GET',{select:columns,id:`eq.${id}`,deleted_at:'not.is.null',limit:1}))[0];
    if(!current)fail('NOT_FOUND');
    const now=new Date().toISOString();
    const updated=await request(table,'PATCH',{id:`eq.${id}`,deleted_at:'not.is.null',updated_at:`eq.${current.updated_at}`},
      {deleted_at:null,updated_at:now,updated_by:actor});
    if(updated.length!==1)fail('STALE_SOURCE');
    if(table==='knowledge_items'&&current.source_id)await request('knowledge_sources','PATCH',
      {id:`eq.${current.source_id}`,deleted_at:'not.is.null'},{deleted_at:null,updated_at:now,updated_by:actor});
    return {ok:true,id,table};
  }
  async function sourceList() { return {ok:true,sources:(await sourceRows()).map(metadataForSource)}; }

  async function activeItems(domains) {
    const items=await request('knowledge_items','GET',{select:'id,source_id,item_type,source,source_date,verified,lifecycle_status,version_no,content,metadata,deleted_at,valid_from,valid_to,'+CONTENT_COLUMNS,verified:'eq.true',lifecycle_status:'eq.verified',deleted_at:'is.null',order:'updated_at.desc.nullslast,id.desc',limit:300});
    const ids=[...new Set(items.map(row=>row.source_id).filter(positiveId).map(String))];
    const sources=ids.length?await request('knowledge_sources','GET',{select:'id,domain,title,publisher,source_uri,published_at,review_at,lifecycle_status,version_no,sha256,deleted_at,valid_from,valid_to',id:`in.(${ids.join(',')})`,deleted_at:'is.null',limit:300}):[];
    const sourceMap=new Map(sources.map(row=>[String(row.id),row]));
    const today=todayShanghai();
    return items.map(row=>projectContent(row,'knowledge_items',sourceMap.get(String(row.source_id)),today)).filter(Boolean).filter(row=>{
      const categoryDomain=categoryDomains(row);
      if(![...categoryDomain].some(value=>domains.has(value)))return false;
      const source=row.source_id?sourceMap.get(String(row.source_id)):null;
      if(row.source_id&&(!source||source.deleted_at||source.lifecycle_status!=='verified'||source.review_at&&source.review_at<today))return false;
      if(categoryDomain.has('top_performer_sharing')&&likelySensitive(row.content||''))return false;
      return true;
    }).map(row=>({row,source:row.source_id?sourceMap.get(String(row.source_id))||null:null}));
  }
  function tokenize(value) { return [...new Set(String(value||'').toLowerCase().match(/[a-z0-9]{3,}|[\u4e00-\u9fff]{2,}/g)||[])].slice(0,80); }
  function rankEvidence(entries,query,maxCount=8) {
    const tokens=tokenize(query);
    return entries.map(({row,source})=>{
      const hay=`${row.source||''} ${row.content||''} ${row.metadata?.summary||''}`.toLowerCase();
      const score=tokens.reduce((n,token)=>n+(hay.includes(token)?1:0),0);
      return {row,source,score};
    }).sort((a,b)=>b.score-a.score||Number(b.row.id)-Number(a.row.id)).slice(0,maxCount);
  }
  function sourceContext(entries) {
    const refs=[]; const allowed=new Map();
    for(const {row,source} of entries){
      const id=String(row.id);allowed.set(id,{schema:'public',table:'knowledge_items',id,sourceId:row.source_id?String(row.source_id):null,
        title:row.source||source?.title||'Knowledge item',domain:row.metadata?.domain||null,sourceDate:row.source_date||source?.published_at||null,
        categories:Array.isArray(row.metadata?.categories)?row.metadata.categories:[],
        publishedAt:row.metadata?.published_at||source?.published_at||null,versionNo:row.version_no||1,locator:row.metadata?.locator||null});
      Object.assign(allowed.get(id),row.contentReference||{});
      refs.push({...allowed.get(id),excerpt:String(row.content||'').slice(0,2200),summary:row.metadata?.summary||''});
    }
    return {refs,allowed};
  }
  async function runDual(input,actorValue,options={}) {
    const actor=actorUid(actorValue),personId=String(input?.personId||'').trim();
    if(!positiveId(personId))fail('INVALID_INPUT');
    const personResponse=await callFunction({name:'person_360',data:{action:'getMeetingPrepContext',personId}});
    const person=personResponse?.result;if(!person||person.error||!object(person)||!person.person)fail('NOT_FOUND');
    const contextSummary={person:person.person,household:person.household||null,relationship:person.relationship||null,
      recent_interactions:(person.recent_interactions||[]).slice(0,6),facts:(person.facts||[]).slice(0,8),signals:(person.signals||[]).slice(0,8),
      open_opportunities:(person.open_opportunities||[]).slice(0,5),insurance_context:person.insurance_context||null,
      meeting_playbooks:person.relevant_playbook||null};
    let recruitContext=null;
    try {
      const recruitResponse=await callFunction({name:'person_360',data:{action:'listRecruitContext',personId}});
      if(!recruitResponse?.result?.error)recruitContext=(recruitResponse?.result?.rows||[]).slice(0,5);
    } catch (_) { /* A Person without recruit history still receives customer advice. */ }
    const query=`${person.person.display_name||''} ${person.person.occupation||''} ${JSON.stringify(contextSummary)}`;
    const all=await activeItems(new Set(['industry','top_performer_sharing','playbook','case','story','evidence']));
    const library=await activeItems(new Set(['product','company','service','recruitment','campaign','health_wealth_seminar','legal_tax','case','playbook','regulation','evidence','story','other']));
    const a=sourceContext(rankEvidence(all,query,8)),b=sourceContext(rankEvidence(library,query,10));
    const context={customer_snapshot:contextSummary,recruit_context:recruitContext,
      strategy_sources:a.refs,library_sources:b.refs,
      strategy_guidance:'根据客户近期互动、目标与进展推断合适的销售和沟通策略；以行业实践、可信经验、沟通逻辑为主，并将推断明确标为推断。不得把来源市场规则直接当成本地规定。',
      library_guidance:'根据客户近期互动和已知需求，使用知识库中当前有效资料提出更贴近公司的建议。产品、法律和税务事实只能依据匹配且仍在有效期内的来源；法律税务资料需先核实客户适用的司法辖区，不得推定适用地区。',
      guardrails:'不编造客户事实、产品条款、回报、税务法律结论；没有证据就写明无匹配资料并提出待确认问题。绩优个案只作启发，不保证复现结果。'};
    const database=createSearchData({env,key}),gateway=createAIGateway({app:client,rdb:database.auditRdb,timeoutMs:80000,maxAttempts:1,
      actorResolver:async()=>({uid:actor,isAnonymous:false})});
    const task=await gateway.runAITask({taskType:'customer_followup_dual',skill:'dual_followup',capability:'coaching',
      subjectType:'person',subjectId:personId,input:{personId},context,
      contextSnapshot:{...context,_context:{recipe:'dual_followup',version:'1.1.0',source:'assistant.knowledge-library-service'}},
      ...(typeof options.onStarted==='function'?{onStarted:options.onStarted}:{})});
    let candidates=task.result?.candidates;
    let results=[];
    if(task.reused){
      const rows=await request('ai_results','GET',{select:'id,task_id,run_id,result_json,rank,user_selected,user_edited,final_result_json,feedback',task_id:`eq.${task.taskId}`,order:'rank.asc,id.asc',limit:2});
      if(rows.length!==2)fail('AI_AUDIT_UNKNOWN');
      results=rows;
      candidates=rows.map(row=>row.user_selected&&row.final_result_json?row.final_result_json:row.result_json);
    } else {
      results=(task.result?.candidates||[]).map((candidate,index)=>({id:String(task.resultIds?.[index]||''),rank:index+1,
        result_json:candidate,user_selected:false,user_edited:false,final_result_json:null}));
    }
    if(!Array.isArray(candidates)||candidates.length!==2||results.length!==2)fail('INVALID_RESULT');
    const byKind=new Map();
    for(const [index,candidate] of candidates.entries()){
      const kind=candidate.candidateType,allow=kind==='strategy_based'?a.allowed:kind==='library_based'?b.allowed:null;
      if(!allow||byKind.has(kind))fail('INVALID_RESULT');
      const refs=Array.isArray(candidate.sourceRefs)?candidate.sourceRefs.filter(ref=>allow.has(String(typeof ref==='object'?ref.id:ref))).map(ref=>allow.get(String(typeof ref==='object'?ref.id:ref))):[];
      const clean={...candidate,sourceRefs:refs,matchStatus:refs.length?'matched':'no_matching_sources'};
      if(!refs.length){clean.boundaryNotes=[...(clean.boundaryNotes||[]),'当前没有可用的匹配引用；请先核实信息，不要把推断当成公司资料或行业事实。'];}
      byKind.set(kind,{...clean,id:results[index].id||String(task.resultIds?.[index]||''),rank:results[index].rank||index+1,
        userSelected:results[index].user_selected===true,userEdited:results[index].user_edited===true,
        finalResult:results[index].final_result_json||null});
    }
    return {ok:true,personId,taskId:String(task.taskId),runId:String(task.runId),reused:task.reused===true,
      candidates:['strategy_based','library_based'].map(kind=>byKind.get(kind)),
      selectionNotice:'选择仅表示采用此建议作为工作参考，不表示已经联系客户或执行任何业务动作。',
      execution:{modelCalled:!task.reused,businessDataRead:true,businessDataWritten:false}};
  }
  async function followupAdviceContext(personId,focus='') {
    const response=await callFunction({name:'person_360',data:{action:'getMeetingPrepContext',personId}});
    const person=response?.result;
    if(!person||person.error||!object(person)||!person.person)fail('NOT_FOUND');
    const safePerson={occupation:person.person.occupation||null,customer_stage:person.person.customer_stage||null,
      customer_level:person.person.customer_level||null,sales_priority:person.person.sales_priority||null,
      referral_priority:person.person.referral_priority||null,relationship_stage:person.person.relationship_stage||null};
    const interactions=(person.recent_interactions||[]).slice(0,6).map(row=>({
      date:row.date||row.interaction_date||row.created_at||null,
      type:row.type||row.interaction_type||null,
      summary:redactForTask(row.summary||row.followup_notes||row.notes||row.content||'',person.person),
    }));
    const customerSnapshot={person:safePerson,household:person.household||null,relationship:person.relationship||null,
      facts:(person.facts||[]).slice(0,8),signals:(person.signals||[]).slice(0,8),
      open_opportunities:(person.open_opportunities||[]).slice(0,5),insurance_context:person.insurance_context||null,
      relevant_playbook:person.relevant_playbook||null};
    const query=`${safePerson.occupation||''} ${safePerson.customer_stage||''} ${focus} ${JSON.stringify(customerSnapshot)} ${JSON.stringify(interactions)}`;
    const strategyEntries=rankEvidence(await activeItems(new Set(['industry','top_performer_sharing','playbook','case','story','evidence'])),query,8);
    const productEntries=rankEvidence(await activeItems(new Set(['product','company','service','recruitment','campaign',
      'health_wealth_seminar','legal_tax','case','playbook','regulation','evidence','story','other'])),query,10);
    const strategy=sourceContext(strategyEntries),products=sourceContext(productEntries);
    return {customerSnapshot,interactions,strategy,products,context:{customer_snapshot:customerSnapshot,
      recent_interactions:interactions,strategy_sources:strategy.refs,product_sources:products.refs,
      generation_rules:'Generate one CloudBase system recommendation as two separate sections. overallStrategy must apply relevant international sales and relationship practices to the stated facts, cover relationship progress, objective, questions and next step, and must not name or recommend a specific product or service. productServiceAdvice must be grounded only in product_sources and may state that no suitable source was found. Use only exact supplied knowledge item IDs in each section sourceRefs. Do not invent person facts, product terms, returns, guarantees, tax or legal conclusions. Keep the advice actionable, concise and tailored to the stated focus.',
      guardrails:'Industry and strategy sources may support the overall strategy only. Product, company and service claims require current verified product_sources. If there is no valid product source, say that a product/service match could not be verified and list what a person should confirm. Avoid repeating contact details or unnecessarily identifying information.'}};
  }
  function keepAllowedSources(value,allowed) {
    return Array.isArray(value)?[...new Set(value.map(item=>String(typeof item==='object'?item?.id:item)))]
      .filter(id=>allowed.has(id)).map(id=>allowed.get(id)):[];
  }
  async function listFollowupAdvice(personIdValue,actorValue) {
    actorUid(actorValue);const personId=String(personIdValue||'');if(!positiveId(personId))fail('INVALID_INPUT');
    const rows=await request('person_followup_advice','GET',{select:FOLLOWUP_ADVICE_COLUMNS,person_id:`eq.${personId}`,
      deleted_at:'is.null',order:'updated_at.desc.nullslast,id.desc',limit:100});
    return {ok:true,personId,rows:rows.map(row=>adviceDto(row))};
  }
  async function runSystemAdvice(adviceId,personId,focus,options={}) {
    const row=(await request('person_followup_advice','GET',{select:FOLLOWUP_ADVICE_COLUMNS,id:`eq.${adviceId}`,
      person_id:`eq.${personId}`,deleted_at:'is.null',limit:1}))[0];
    if(!row||row.system_status!=='generating')fail('NOT_FOUND');
    try {
      const context=await followupAdviceContext(personId,focus);
      const database=searchDataFactory({env,key,fetchImpl});
      const gateway=gatewayFactory({app:client,rdb:database.auditRdb,timeoutMs:80000,maxAttempts:1,
        actorResolver:async()=>({uid:row.created_by,isAnonymous:false})});
      const task=await gateway.runAITask({taskType:'person_followup_advice',skill:'person_followup_advice',capability:'coaching',
        subjectType:'person',subjectId:personId,input:{personId,title:row.title,focus:focus||''},context:context.context,
        contextSnapshot:{...context.context,_context:{recipe:'person_followup_advice',version:'1.0.0',source:'assistant.knowledge-library-service'}},
        ...(typeof options.onStarted==='function'?{onStarted:async({taskId})=>{
          await request('person_followup_advice','PATCH',{id:`eq.${adviceId}`,person_id:`eq.${personId}`,
            system_status:'eq.generating',deleted_at:'is.null'},
            {system_task_id:String(taskId),updated_at:new Date().toISOString()});
          await options.onStarted({taskId:String(taskId),personId,adviceId});
        }}:{})});
      const result=task.result;
      if(!object(result)||!object(result.overallStrategy)||!object(result.productServiceAdvice))fail('INVALID_RESULT');
      const strategyRefs=keepAllowedSources(result.overallStrategy.sourceRefs,context.strategy.allowed);
      const productRefs=keepAllowedSources(result.productServiceAdvice.sourceRefs,context.products.allowed);
      const strategyText=[result.overallStrategy.summary,
        `Objective: ${result.overallStrategy.objective}`,
        `Next step: ${result.overallStrategy.nextStep}`,
        ...(result.overallStrategy.clarifyingQuestions||[]).map(question=>`Question to confirm: ${question}`)]
        .filter(Boolean).join('\n\n');
      const saved=await request('person_followup_advice','PATCH',{id:`eq.${adviceId}`,person_id:`eq.${personId}`,
        system_status:'eq.generating',deleted_at:'is.null'},
        {title:cleanText(result.title,240,'title',true),system_status:'ready',system_strategy:cleanText(strategyText,4000,'strategy',true),
          system_product_advice:cleanText(result.productServiceAdvice.recommendation,4000,'productAdvice',true),
          system_strategy_sources:strategyRefs,system_product_sources:productRefs,system_version:1,
          system_task_id:String(task.taskId),updated_by:row.created_by,updated_at:new Date().toISOString()});
      if(saved.length!==1)fail('STALE');
      return {ok:true,status:'completed',taskId:String(task.taskId),personId,adviceId,advice:adviceDto(saved[0]),
        execution:{modelCalled:true,businessDataWritten:true}};
    } catch(error) {
      await request('person_followup_advice','PATCH',{id:`eq.${adviceId}`,person_id:`eq.${personId}`,
        system_status:'eq.generating',deleted_at:'is.null'},
        {system_status:'failed',updated_by:row.created_by,updated_at:new Date().toISOString()});
      throw error;
    }
  }
  async function createFollowupAdvice(input,actorValue,options={}) {
    const actor=actorUid(actorValue),personId=String(input?.personId||''),requestId=String(input?.clientRequestId||'');
    const title=cleanText(input?.title,240,'title',true),focus=cleanText(input?.focus,1200,'focus')||'';
    if(!positiveId(personId)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))fail('INVALID_INPUT');
    const existing=(await request('person_followup_advice','GET',{select:FOLLOWUP_ADVICE_COLUMNS,person_id:`eq.${personId}`,
      client_request_id:`eq.${requestId}`,deleted_at:'is.null',limit:1}))[0];
    if(existing) {
      if(existing.title!==title)fail('INVALID_INPUT');
      if(existing.system_status==='generating')return {ok:true,status:'pending',adviceId:String(existing.id),
        taskId:existing.system_task_id?String(existing.system_task_id):undefined,personId};
      if(existing.system_status==='ready')return {ok:true,status:'completed',adviceId:String(existing.id),personId,advice:adviceDto(existing)};
      const reset=await request('person_followup_advice','PATCH',{id:`eq.${existing.id}`,system_status:'eq.failed',deleted_at:'is.null'},
        {system_status:'generating',system_task_id:null,updated_by:actor,updated_at:new Date().toISOString()});
      if(reset.length!==1)fail('STALE');
      return runSystemAdvice(String(existing.id),personId,focus,options);
    }
    let inserted;
    try { inserted=await request('person_followup_advice','POST',{}, {person_id:personId,client_request_id:requestId,title,
      system_status:'generating',system_version:0,gpt_status:'pending',created_by:actor,updated_by:actor}); }
    catch(error) {
      if(error?.code!=='DUPLICATE_SOURCE')throw error;
      const duplicate=(await request('person_followup_advice','GET',{select:FOLLOWUP_ADVICE_COLUMNS,person_id:`eq.${personId}`,
        client_request_id:`eq.${requestId}`,deleted_at:'is.null',limit:1}))[0];
      if(!duplicate)throw error;
      return {ok:true,status:'pending',adviceId:String(duplicate.id),personId};
    }
    const row=inserted[0];if(!row?.id)fail('PERSISTENCE_ERROR');
    return runSystemAdvice(String(row.id),personId,focus,options);
  }
  async function adviceStatus(input,actorValue) {
    actorUid(actorValue);const taskId=String(input?.taskId||''),personId=String(input?.personId||'');
    if(!positiveId(taskId)||!positiveId(personId))fail('INVALID_INPUT');
    const task=(await request('ai_tasks','GET',{select:'id,status,task_type,subject_type,subject_id',id:`eq.${taskId}`,
      task_type:'eq.person_followup_advice',subject_type:'eq.person',subject_id:`eq.${personId}`,limit:1}))[0];
    if(!task)fail('NOT_FOUND');
    const row=(await request('person_followup_advice','GET',{select:FOLLOWUP_ADVICE_COLUMNS,person_id:`eq.${personId}`,
      system_task_id:`eq.${taskId}`,deleted_at:'is.null',limit:1}))[0];
    if(!row)return {ok:true,status:'pending',taskId,personId};
    if(row.system_status==='failed')return {ok:false,status:'failed',taskId,personId,error:{code:'AI_REQUEST_FAILED'}};
    if(row.system_status!=='ready')return {ok:true,status:'pending',taskId,personId};
    return {ok:true,status:'completed',taskId,personId,adviceId:String(row.id),advice:adviceDto(row)};
  }
  async function updateFollowupAdvice(input,actorValue) {
    const actor=actorUid(actorValue),id=String(input?.id||''),personId=String(input?.personId||''),
      expectedVersion=Number(input?.systemVersion),expectedUpdatedAt=String(input?.updatedAt||'');
    if(!positiveId(id)||!positiveId(personId)||!Number.isInteger(expectedVersion)||expectedVersion<1||!expectedUpdatedAt)fail('INVALID_INPUT');
    const current=(await request('person_followup_advice','GET',{select:FOLLOWUP_ADVICE_COLUMNS,id:`eq.${id}`,
      person_id:`eq.${personId}`,deleted_at:'is.null',limit:1}))[0];
    if(!current)fail('NOT_FOUND');if(Number(current.system_version)!==expectedVersion||current.updated_at!==expectedUpdatedAt)fail('STALE');
    const title=cleanText(input.title,240,'title',true),strategy=cleanText(input.systemStrategy,4000,'strategy',true),
      product=cleanText(input.systemProductAdvice,4000,'productAdvice',true);
    const systemChanged=title!==current.title||strategy!==current.system_strategy||product!==current.system_product_advice;
    const nextVersion=Number(current.system_version)+(systemChanged?1:0);
    const body={title,system_strategy:strategy,system_product_advice:product,system_version:nextVersion,
      gpt_kept_for_system_version:systemChanged?null:current.gpt_kept_for_system_version,
      gpt_status:current.gpt_strategy?(systemChanged?'stale':current.gpt_status):'pending',updated_by:actor,
      updated_at:new Date().toISOString()};
    const gptAction=input.gptAction;
    if(gptAction==='delete') {
      Object.assign(body,{gpt_strategy:null,gpt_product_advice:null,gpt_strategy_sources:[],gpt_product_sources:[],
        gpt_based_on_system_version:null,gpt_kept_for_system_version:null,gpt_status:'pending'});
    } else if(gptAction==='edit') {
      body.gpt_strategy=cleanText(input.gptStrategy,4000,'gptStrategy',true);
      body.gpt_product_advice=cleanText(input.gptProductAdvice,4000,'gptProductAdvice',true);
      body.gpt_strategy_sources=current.gpt_strategy_sources;
      body.gpt_product_sources=current.gpt_product_sources;
      body.gpt_based_on_system_version=nextVersion;body.gpt_kept_for_system_version=null;body.gpt_status='manual';
    } else if(gptAction==='keep'&&current.gpt_strategy) {
      body.gpt_kept_for_system_version=nextVersion;body.gpt_status='kept';
    } else if(gptAction!=null&&gptAction!=='keep')fail('INVALID_INPUT');
    const rows=await request('person_followup_advice','PATCH',{id:`eq.${id}`,person_id:`eq.${personId}`,
      system_version:`eq.${expectedVersion}`,updated_at:`eq.${expectedUpdatedAt}`,deleted_at:'is.null',system_status:'eq.ready'},body);
    if(rows.length!==1)fail('STALE');return {ok:true,advice:adviceDto(rows[0]),systemChanged};
  }
  async function deleteFollowupAdvice(input,actorValue) {
    const actor=actorUid(actorValue),id=String(input?.id||''),personId=String(input?.personId||''),updatedAt=String(input?.updatedAt||'');
    if(!positiveId(id)||!positiveId(personId)||!updatedAt)fail('INVALID_INPUT');
    const rows=await request('person_followup_advice','PATCH',{id:`eq.${id}`,person_id:`eq.${personId}`,
      updated_at:`eq.${updatedAt}`,deleted_at:'is.null'},
      {deleted_at:new Date().toISOString(),updated_by:actor,updated_at:new Date().toISOString(),gpt_preview_id:null,
        gpt_preview_payload:null,gpt_preview_actor:null,gpt_preview_expires_at:null});
    if(rows.length!==1)fail('STALE');return {ok:true,id};
  }
  async function gptTaskPackage(input,actorValue) {
    actorUid(actorValue);const limit=Math.max(1,Math.min(10,Number(input?.limit)||10));
    const rows=await request('person_followup_advice','GET',{select:FOLLOWUP_ADVICE_COLUMNS,system_status:'eq.ready',
      deleted_at:'is.null',order:'id.asc',...(positiveId(input?.afterId)?{id:`gt.${input.afterId}`}:{ }),limit:200});
    const queued=rows.filter(row=>!row.gpt_strategy||!row.gpt_product_advice||
      (Number(row.gpt_based_on_system_version)!==Number(row.system_version)&&Number(row.gpt_kept_for_system_version)!==Number(row.system_version)))
      .slice(0,limit+1);
    const hasMore=queued.length>limit;
    const selected=queued.slice(0,limit);
    const result=[];
    for(const row of selected) {
      try {
        const context=await followupAdviceContext(String(row.person_id),row.title);
        const safePerson=context.customerSnapshot.person;
        const safeSnapshot={person:safePerson,
          facts:context.customerSnapshot.facts.map(item=>({content:redactForTask(item.content||item.summary||''),confidence:item.confidence||null,
            created_at:item.created_at||null})),
          signals:context.customerSnapshot.signals.map(item=>({content:redactForTask(item.content||item.summary||''),confidence:item.confidence||null,
            created_at:item.created_at||null})),
          open_opportunities:context.customerSnapshot.open_opportunities.map(item=>({type:item.type||item.opportunity_type||null,
            stage:item.stage||item.status||null,updated_at:item.updated_at||null})),
          insurance_context:context.customerSnapshot.insurance_context?{status:context.customerSnapshot.insurance_context.status||null,
            verified_products:context.customerSnapshot.insurance_context.verified_products||[]}:null};
        const safeSources=refs=>refs.map(ref=>({...ref,title:redactForTask(ref.title),excerpt:redactForTask(ref.excerpt),
          summary:redactForTask(ref.summary)}));
        result.push({adviceId:String(row.id),personId:String(row.person_id),title:redactForTask(row.title),systemVersion:Number(row.system_version),
          currentSystemAdvice:{overallStrategy:redactForTask(row.system_strategy),productServiceAdvice:redactForTask(row.system_product_advice)},
          customerSnapshot:safeSnapshot,recentInteractions:context.interactions,
          strategySources:safeSources(context.strategy.refs),productSources:safeSources(context.products.refs),
          outputContract:{adviceId:'copy exact value',personId:'copy exact value',systemVersion:'copy exact value',
            gptAdvice:{overallStrategy:'string',productServiceAdvice:'string',strategySourceIds:'integer[]',productSourceIds:'integer[]'}}});
      } catch(error) {
        logger.warn('FOLLOWUP_ADVICE_PACKAGE_ITEM_SKIPPED',JSON.stringify({adviceId:String(row.id),code:String(error?.code||'CONTEXT_FAILED')}));
      }
    }
    return {ok:true,packageId:randomUUID(),generatedAt:new Date().toISOString(),count:result.length,rows:result,
      nextAfterId:hasMore?String(selected.at(-1)?.id||''):null,
      instructions:'Produce one result for each package row. Keep adviceId, personId and systemVersion unchanged. gptAdvice.overallStrategy must contain only the relationship and next-step strategy; it must not name products or services. gptAdvice.productServiceAdvice may make product/service claims only when supported by productSources. Use only exact supplied source IDs in strategySourceIds and productSourceIds. If no suitable product source exists, clearly say a match could not be verified and leave productSourceIds empty. Do not invent person facts, product terms, returns, guarantees, legal or tax conclusions. Return only JSON shaped as {"rows":[{"adviceId":"...","personId":"...","systemVersion":1,"gptAdvice":{"overallStrategy":"...","productServiceAdvice":"...","strategySourceIds":[],"productSourceIds":[]}}]}.',
      notice:'The package omits direct contact fields. It is still customer context; review it and use only the approved ChatGPT workspace. CRM validates versions and sources before saving.'};
  }
  async function previewGptImport(input,actorValue) {
    const actor=actorUid(actorValue),items=input?.rows;
    if(!Array.isArray(items)||!items.length||items.length>10)fail('INVALID_INPUT');
    const strategyEntries=await activeItems(new Set(['industry','top_performer_sharing','playbook','case','story','evidence']));
    const productEntries=await activeItems(new Set(['product','company','service','recruitment','campaign',
      'health_wealth_seminar','legal_tax','case','playbook','regulation','evidence','story','other']));
    const strategyMap=sourceContext(strategyEntries).allowed,productMap=sourceContext(productEntries).allowed;
    const previewRows=[];
    for(const item of items) {
      if(!object(item)||!positiveId(item.adviceId)||!positiveId(item.personId)||!Number.isInteger(item.systemVersion)||!object(item.gptAdvice))fail('INVALID_INPUT');
      const row=(await request('person_followup_advice','GET',{select:FOLLOWUP_ADVICE_COLUMNS,id:`eq.${item.adviceId}`,
        person_id:`eq.${item.personId}`,deleted_at:'is.null',system_status:'eq.ready',limit:1}))[0];
      if(!row||Number(row.system_version)!==item.systemVersion) {previewRows.push({adviceId:String(item.adviceId),status:'stale'});continue;}
      const strategy=cleanText(item.gptAdvice.overallStrategy,4000,'overallStrategy',true),
        product=cleanText(item.gptAdvice.productServiceAdvice,4000,'productServiceAdvice',true),
        strategySources=keepAllowedSources(item.gptAdvice.strategySourceIds,strategyMap),
        productSources=keepAllowedSources(item.gptAdvice.productSourceIds,productMap);
      if(!Array.isArray(item.gptAdvice.strategySourceIds)||!Array.isArray(item.gptAdvice.productSourceIds)||
          item.gptAdvice.strategySourceIds.length!==strategySources.length||
          item.gptAdvice.productSourceIds.length!==productSources.length)fail('INVALID_SOURCE');
      const previewId=randomUUID(),payload={strategy,product,strategySources,productSources,systemVersion:item.systemVersion};
      const expiresAt=new Date(Date.now()+30*60*1000).toISOString();
      const saved=await request('person_followup_advice','PATCH',{id:`eq.${item.adviceId}`,system_version:`eq.${item.systemVersion}`,
        deleted_at:'is.null',system_status:'eq.ready'},
        {gpt_preview_id:previewId,gpt_preview_payload:payload,gpt_preview_actor:actor,gpt_preview_expires_at:expiresAt,
          updated_by:actor,updated_at:new Date().toISOString()});
      if(saved.length!==1) {previewRows.push({adviceId:String(item.adviceId),status:'stale'});continue;}
      previewRows.push({adviceId:String(item.adviceId),personId:String(item.personId),title:row.title,systemVersion:item.systemVersion,
        status:'preview',previewId,expiresAt,gptAdvice:{overallStrategy:strategy,productServiceAdvice:product,
          strategySources,productSources}});
    }
    return {ok:true,rows:previewRows};
  }
  async function confirmGptImport(input,actorValue) {
    const actor=actorUid(actorValue),id=String(input?.adviceId||''),personId=String(input?.personId||''),
      previewId=String(input?.previewId||''),version=Number(input?.systemVersion);
    if(input?.confirmed!==true||!positiveId(id)||!positiveId(personId)||!Number.isInteger(version)||
      !/^[0-9a-f-]{36}$/i.test(previewId))fail('INVALID_INPUT');
    const current=(await request('person_followup_advice','GET',{select:FOLLOWUP_ADVICE_COLUMNS,id:`eq.${id}`,
      person_id:`eq.${personId}`,gpt_preview_id:`eq.${previewId}`,gpt_preview_actor:`eq.${actor}`,
      deleted_at:'is.null',limit:1}))[0];
    if(!current||Number(current.system_version)!==version||Date.parse(current.gpt_preview_expires_at||'')<=Date.now())fail('STALE');
    const payload=current.gpt_preview_payload;if(!object(payload)||Number(payload.systemVersion)!==version)fail('STALE');
    const rows=await request('person_followup_advice','PATCH',{id:`eq.${id}`,person_id:`eq.${personId}`,
      system_version:`eq.${version}`,gpt_preview_id:`eq.${previewId}`,gpt_preview_actor:`eq.${actor}`,
      deleted_at:'is.null',system_status:'eq.ready'},
      {gpt_strategy:payload.strategy,gpt_product_advice:payload.product,gpt_strategy_sources:payload.strategySources,
        gpt_product_sources:payload.productSources,gpt_based_on_system_version:version,gpt_kept_for_system_version:null,
        gpt_status:'ready',gpt_preview_id:null,gpt_preview_payload:null,gpt_preview_actor:null,gpt_preview_expires_at:null,
        updated_by:actor,updated_at:new Date().toISOString()});
    if(rows.length!==1)fail('STALE');return {ok:true,advice:adviceDto(rows[0])};
  }
  async function keepGptAdvice(input,actorValue) {
    const actor=actorUid(actorValue),id=String(input?.adviceId||''),personId=String(input?.personId||''),
      version=Number(input?.systemVersion),updatedAt=String(input?.updatedAt||'');
    if(!positiveId(id)||!positiveId(personId)||!Number.isInteger(version)||!updatedAt)fail('INVALID_INPUT');
    const rows=await request('person_followup_advice','PATCH',{id:`eq.${id}`,person_id:`eq.${personId}`,
      system_version:`eq.${version}`,updated_at:`eq.${updatedAt}`,deleted_at:'is.null',gpt_strategy:'not.is.null'},
      {gpt_kept_for_system_version:version,gpt_status:'kept',updated_by:actor,updated_at:new Date().toISOString()});
    if(rows.length!==1)fail('STALE');return {ok:true,advice:adviceDto(rows[0])};
  }
  async function dualStatus(input) {
    const taskId=String(input?.taskId||'').trim(),personId=String(input?.personId||'').trim();
    if(!positiveId(personId))fail('INVALID_INPUT');
    let tasks,startedMs=NaN;
    if(taskId){
      if(!positiveId(taskId))fail('INVALID_INPUT');
      tasks=await request('ai_tasks','GET',{select:'id,task_type,status,subject_type,subject_id,context_snapshot',
        id:`eq.${taskId}`,task_type:'eq.customer_followup_dual',subject_type:'eq.person',subject_id:`eq.${personId}`,limit:1});
    }else{
      const startedAt=String(input?.startedAt||'').trim();startedMs=Date.parse(startedAt);
      if(!startedAt||!Number.isFinite(startedMs))fail('INVALID_INPUT');
      tasks=await request('ai_tasks','GET',{select:'id,task_type,status,subject_type,subject_id,context_snapshot,created_at',
        task_type:'eq.customer_followup_dual',subject_type:'eq.person',subject_id:`eq.${personId}`,
        order:'created_at.desc,id.desc',limit:20});
    }
    const task=taskId?tasks[0]:tasks.find(row=>row.status==='running'||
      (Number.isFinite(startedMs)&&Date.parse(row.created_at)>=startedMs));
    if(!task)return {ok:true,status:'pending',taskId:''};
    const resolvedTaskId=String(task.id);
    if(task.status==='failed')return {ok:false,status:'failed',taskId:resolvedTaskId,error:{code:'AI_REQUEST_FAILED'}};
    if(task.status!=='completed')return {ok:true,status:'pending',taskId:resolvedTaskId};
    const rows=await request('ai_results','GET',{select:'id,task_id,run_id,result_json,rank,user_selected,user_edited,final_result_json',
      task_id:`eq.${resolvedTaskId}`,order:'rank.asc,id.asc',limit:2});
    if(rows.length!==2)fail('AI_AUDIT_UNKNOWN');
    const snapshot=task.context_snapshot||{},byKind=new Map();
    for(const row of rows){
      const value=row.user_selected&&row.final_result_json?row.final_result_json:row.result_json;
      const kind=value?.candidateType,sourceKey=kind==='strategy_based'?'strategy_sources':kind==='library_based'?'library_sources':null;
      if(!sourceKey||byKind.has(kind))fail('INVALID_RESULT');
      const allowed=new Map((Array.isArray(snapshot[sourceKey])?snapshot[sourceKey]:[])
        .filter(ref=>ref&&positiveId(ref.id)).map(ref=>[String(ref.id),ref]));
      const refs=Array.isArray(value.sourceRefs)?value.sourceRefs.map(ref=>String(typeof ref==='object'?ref?.id:ref))
        .filter(id=>allowed.has(id)).map(id=>allowed.get(id)):[];
      const clean={...value,sourceRefs:refs,matchStatus:refs.length?'matched':'no_matching_sources'};
      if(!refs.length)clean.boundaryNotes=[...(Array.isArray(clean.boundaryNotes)?clean.boundaryNotes:[]),
        '当前没有可用的匹配引用；请先核实信息，不要把推断当成公司资料或行业事实。'];
      byKind.set(kind,{...clean,id:String(row.id),rank:row.rank||1,userSelected:row.user_selected===true,
        userEdited:row.user_edited===true,finalResult:row.final_result_json||null});
    }
    if(byKind.size!==2||!byKind.has('strategy_based')||!byKind.has('library_based'))fail('INVALID_RESULT');
    return {ok:true,status:'completed',personId,taskId:resolvedTaskId,runId:String(rows[0].run_id||''),reused:false,
      candidates:['strategy_based','library_based'].map(kind=>byKind.get(kind)),
      selectionNotice:'选择仅表示采用此建议作为工作参考，不表示已经联系客户或执行任何业务动作。',
      execution:{modelCalled:true,businessDataRead:true,businessDataWritten:false}};
  }
  async function selectDual(input,actorValue) {
    const actor=actorUid(actorValue),taskId=String(input?.taskId||''),resultId=String(input?.resultId||'');
    if(!positiveId(taskId)||!positiveId(resultId))fail('INVALID_INPUT');
    const candidates=await request('ai_results','GET',{select:'id,task_id,result_json',id:`eq.${resultId}`,task_id:`eq.${taskId}`,limit:1});
    const finalResult=candidates[0]?.result_json;
    if(!finalResult||!['strategy_based','library_based'].includes(finalResult.candidateType))fail('INVALID_INPUT');
    const database=createSearchData({env,key});
    const result=await database.auditRdb.rpc('crm_ai_select_dual_v1',{p_task_id:Number(taskId),p_result_id:Number(resultId),p_actor_uid:actor,p_final_result:finalResult});
    if(result?.error||!result?.data||typeof result.data!=='object')fail('SELECTION_FAILED');
    return {ok:true,...result.data};
  }
  async function history(personIdValue) {
    const personId=String(personIdValue||'');if(!positiveId(personId))fail('INVALID_INPUT');
    const tasks=await request('ai_tasks','GET',{select:'id,subject_id,status,created_at,context_snapshot',task_type:'eq.customer_followup_dual',
      subject_type:'eq.person',subject_id:`eq.${personId}`,status:'eq.completed',order:'created_at.desc,id.desc',limit:20});
    if(!tasks.length)return {ok:true,rows:[]};
    const ids=tasks.map(row=>String(row.id));
    const results=await request('ai_results','GET',{select:'id,task_id,run_id,result_json,rank,user_selected,user_edited,final_result_json',task_id:`in.(${ids.join(',')})`,order:'rank.asc,id.asc',limit:40});
    const grouped=new Map();for(const row of results){const key=String(row.task_id);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(row);}
    return {ok:true,rows:tasks.map(task=>({taskId:String(task.id),createdAt:task.created_at,market:task.context_snapshot?.market||null,
      candidates:(grouped.get(String(task.id))||[]).map(row=>({id:String(row.id),rank:row.rank,
        candidate:row.user_selected&&row.final_result_json?row.final_result_json:row.result_json,
        userSelected:row.user_selected,userEdited:row.user_edited}))})).filter(row=>row.candidates.length===2)};
  }
  async function run(event,actor,options={}) {
    if(event?.operation==='content')return contentService.run(event.contentOperation,actor,event.data);
    switch(event?.operation){
      case 'list':return list(actor);
      case 'trashList':return trashList();
      case 'save':return saveKnowledge(event.data,actor);
      case 'upload':return upload(event.data,actor);
      case 'uploadStart':return uploadStart(event.data,actor);
      case 'uploadPrepare':return uploadPrepare(event.data,actor);
      case 'uploadChunk':return uploadChunk(event.data,actor);
      case 'uploadFinalize':return uploadFinalize(event.data,actor);
      case 'uploadCancel':return uploadCancel(event.data,actor);
      case 'retry':return retryExtraction(event.sourceId,actor);
      case 'processOcrQueue':{
        if(options.internalOcrQueue!==true)fail('PERMISSION_DENIED');
        const result=await processOcrQueue(options);return result.processed?result:contentService.worker();
      }
      case 'review':return reviewSource(event.data,actor);
      case 'setValidity':return setValidity(event.data,actor);
      case 'delete':return softDelete(event.data,actor);
      case 'restore':return restore(event.data,actor);
      case 'dualGenerate':return runDual(event.data,actor,options);
      case 'dualStatus':return dualStatus(event.data);
      case 'dualSelect':return selectDual(event.data,actor);
      case 'dualHistory':return history(event.personId);
      case 'adviceList':return listFollowupAdvice(event.personId,actor);
      case 'adviceGenerate':return createFollowupAdvice(event.data,actor,options);
      case 'adviceStatus':return adviceStatus(event.data,actor);
      case 'adviceUpdate':return updateFollowupAdvice(event.data,actor);
      case 'adviceDelete':return deleteFollowupAdvice(event.data,actor);
      case 'gptTaskPackage':return gptTaskPackage(event.data,actor);
      case 'gptImportPreview':return previewGptImport(event.data,actor);
      case 'gptImportConfirm':return confirmGptImport(event.data,actor);
      case 'gptKeep':return keepGptAdvice(event.data,actor);
      default:fail('INVALID_OPERATION');
    }
  }
  return {run,upload,uploadStart,uploadPrepare,uploadChunk,uploadFinalize,uploadCancel,extractText,list,runDual,dualStatus,
    selectDual,history,processOcrQueue,listFollowupAdvice,createFollowupAdvice,adviceStatus,updateFollowupAdvice,
    deleteFollowupAdvice,gptTaskPackage,previewGptImport,confirmGptImport,keepGptAdvice};
}

async function handleKnowledgeLibrary(event,actor,options={}) {
  return createKnowledgeLibrary().run(event,actor,options);
}
module.exports={createKnowledgeLibrary,handleKnowledgeLibrary,extractDocx,extractPptx,extractXlsx,extractText,decodeBase64,likelySensitive,MAX_FILE_BYTES,UPLOAD_CHUNK_BYTES};
