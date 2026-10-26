/** Single-operator knowledge ingestion and dual follow-up advice. */
'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { inflateRawSync } = require('node:zlib');
const { createAIGateway } = require('./ai-gateway');
const { createSearchData } = require('./search-data');

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_TEXT_CHARS = 100000;
const DOMAIN = new Set(['product','company','service','recruitment','industry','campaign',
  'health_wealth_seminar','top_performer_sharing','legal_tax','case','playbook']);
const REST_TABLES = new Set(['knowledge_sources','knowledge_items','playbooks','ai_tasks','ai_results']);
const EXTENSIONS = Object.freeze({
  '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
});
const ITEM_TYPE = Object.freeze({ product:'product', company:'company', service:'company', recruitment:'company',
  industry:'evidence', campaign:'company', health_wealth_seminar:'evidence', top_performer_sharing:'story',
  legal_tax:'regulation', case:'case', playbook:'evidence' });

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
function extractDocx(bytes) {
  if (!bytes.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04]))) fail('INVALID_CONTENT');
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) fail('INVALID_CONTENT');
  const entries = bytes.readUInt16LE(eocd + 10), directoryOffset = bytes.readUInt32LE(eocd + 16);
  if (entries > 5000 || directoryOffset >= bytes.length) fail('INVALID_CONTENT');
  let cursor = directoryOffset, target = null;
  for (let i = 0; i < entries; i++) {
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) fail('INVALID_CONTENT');
    const method=bytes.readUInt16LE(cursor+10), compressed=bytes.readUInt32LE(cursor+20), uncompressed=bytes.readUInt32LE(cursor+24);
    const nameLength=bytes.readUInt16LE(cursor+28), extraLength=bytes.readUInt16LE(cursor+30), commentLength=bytes.readUInt16LE(cursor+32);
    const localOffset=bytes.readUInt32LE(cursor+42), name=bytes.subarray(cursor+46,cursor+46+nameLength).toString('utf8');
    if (name === 'word/document.xml') target={method,compressed,uncompressed,localOffset};
    cursor += 46 + nameLength + extraLength + commentLength;
    if (cursor > bytes.length) fail('INVALID_CONTENT');
  }
  if (!target || target.uncompressed > 20 * 1024 * 1024 || ![0,8].includes(target.method)) fail('UNSUPPORTED_TYPE');
  const offset=target.localOffset;
  if (bytes.readUInt32LE(offset)!==0x04034b50) fail('INVALID_CONTENT');
  const nameLength=bytes.readUInt16LE(offset+26), extraLength=bytes.readUInt16LE(offset+28);
  const start=offset+30+nameLength+extraLength, end=start+target.compressed;
  if (end>bytes.length) fail('INVALID_CONTENT');
  let xml;
  try { const compressed=bytes.subarray(start,end); xml=target.method===0?compressed:inflateRawSync(compressed,{maxOutputLength:20*1024*1024}); }
  catch (_) { fail('INVALID_CONTENT'); }
  if (xml.length!==target.uncompressed) fail('INVALID_CONTENT');
  const text=decodeXml(xml.toString('utf8').replace(/<w:tab\b[^>]*\/>/g,'\t').replace(/<w:br\b[^>]*\/>/g,'\n')
    .replace(/<\/w:p>/g,'\n').replace(/<[^>]+>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n\s*/g,'\n').trim();
  return boundedText(text);
}
function boundedText(value) {
  const text=String(value||'').replace(/\r/g,'').trim();
  if (!text || text.length>MAX_TEXT_CHARS || text.includes('\0')) fail('UNSUPPORTED_CONTENT');
  return text;
}
async function extractText(fileName, mime, bytes) {
  const lower=fileName.toLowerCase();
  const ext=lower.slice(lower.lastIndexOf('.'));
  if (EXTENSIONS[ext]!==mime) fail('UNSUPPORTED_TYPE');
  if (ext==='.txt') {
    let text; try { text=new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch (_) { fail('INVALID_CONTENT'); }
    return boundedText(text);
  }
  if (ext==='.docx') return extractDocx(bytes);
  if (ext==='.pdf') {
    if (!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))) fail('INVALID_CONTENT');
    const response=await app.callFunction({name:'person_360',data:{action:'extractKnowledgePdfText',base64:bytes.toString('base64')}});
    const result=response?.result;
    if (!result || result.error || typeof result.text!=='string') fail(result?.error || 'PDF_EXTRACTION_FAILED');
    return boundedText(result.text);
  }
  fail('UNSUPPORTED_TYPE');
}
function likelySensitive(text) {
  return /(?<!\d)1[3-9]\d{9}(?!\d)|(?<!\d)\d{17}[\dXx](?!\d)|身份证号|保单号|被保险人|健康告知|诊断结果/.test(text);
}
function metadataForSource(row) {
  return {id:String(row.id),domain:row.domain,title:row.title,publisher:row.publisher||null,
    jurisdiction:row.jurisdiction||null,sourceUri:row.source_uri||null,publishedAt:row.published_at||null,
    validFrom:row.valid_from||null,validTo:row.valid_to||null,reviewAt:row.review_at||null,
    fileName:row.file_name||null,fileSizeBytes:row.file_size_bytes||null,sha256:row.sha256||null,
    extractionStatus:row.extraction_status,lifecycleStatus:row.lifecycle_status,
    versionNo:row.version_no,createdAt:row.created_at,updatedAt:row.updated_at};
}

function createKnowledgeLibrary(options={}) {
  const env=options.env??process.env.TCB_ENV,key=options.key??process.env.CRM_ASSISTANT_DB_API_KEY;
  const fetchImpl=options.fetchImpl||fetch,client=options.client||require('./db').app;
  const gatewayFactory=options.gatewayFactory||createAIGateway;
  const callFunction=options.callFunction||client.callFunction.bind(client);
  if (!/^crm-[a-z0-9]+$/.test(env||'') || typeof key!=='string' || !key) fail('INVALID_CONFIG');
  async function request(table,method='GET',filters={},body) {
    if (!REST_TABLES.has(table)) fail('INVALID_INPUT');
    const url=new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/${table}`);
    for (const [name,value] of Object.entries(filters)) url.searchParams.set(name,String(value));
    const headers={Authorization:`Bearer ${key}`,'Accept-Profile':'public','Content-Profile':'public',Accept:'application/json',
      'Content-Type':'application/json',Prefer:'return=representation'};
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try {
      const response=await fetchImpl(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
      if (!response.ok) { const bodyText=await response.text(); const error=new Error(`Knowledge data request failed (${response.status})`);
        error.code=response.status===409?'DUPLICATE_SOURCE':response.status===401||response.status===403?'PERMISSION_DENIED':'PERSISTENCE_ERROR';
        if(/23505/.test(bodyText))error.code='DUPLICATE_SOURCE'; throw error; }
      const text=await response.text(); return text?JSON.parse(text):[];
    } finally { clearTimeout(timer); }
  }
  async function sourceRows() {
    return request('knowledge_sources','GET',{select:'id,domain,title,publisher,jurisdiction,source_uri,published_at,valid_from,valid_to,review_at,file_name,file_size_bytes,sha256,extraction_status,lifecycle_status,version_no,created_at,updated_at',order:'updated_at.desc,id.desc',limit:200});
  }
  async function list() {
    const [sources,items,playbooks]=await Promise.all([
      sourceRows(),request('knowledge_items','GET',{select:'id,source_id,item_type,source,source_date,valid_from,valid_to,verified,lifecycle_status,version_no,content,metadata,updated_at',order:'updated_at.desc,id.desc',limit:200}),
      request('playbooks','GET',{select:'id,scenario,objection,lifecycle_status,updated_at',order:'updated_at.desc,id.desc',limit:100}),
    ]);
    return {ok:true,sources:sources.map(metadataForSource),knowledge:items,playbooks};
  }
  function fields(input) {
    if (!object(input) || !DOMAIN.has(input.domain)) fail('INVALID_INPUT');
    const title=cleanText(input.title,500,'title',true),publisher=cleanText(input.publisher,500,'publisher'),
      jurisdiction=cleanText(input.jurisdiction,160,'jurisdiction'),sourceUri=cleanText(input.sourceUri,2000,'sourceUri'),
      fileName=cleanText(input.fileName,255,'fileName',true),contentType=cleanText(input.contentType,120,'contentType',true);
    for (const key of ['publishedAt','validFrom','validTo','reviewAt']) if (!validDate(input[key])) fail('INVALID_INPUT');
    if (sourceUri && !/^https:\/\//i.test(sourceUri)) fail('INVALID_INPUT');
    if (input.domain==='top_performer_sharing' && (input.sharingAuthorized!==true || input.anonymized!==true)) fail('SHARING_AUTHORIZATION_REQUIRED');
    if (input.domain==='legal_tax' && (!jurisdiction || !input.publishedAt || !sourceUri)) fail('SOURCE_METADATA_REQUIRED');
    return {domain:input.domain,title,publisher,jurisdiction,sourceUri,publishedAt:input.publishedAt||null,
      validFrom:input.validFrom||null,validTo:input.validTo||null,reviewAt:input.reviewAt||null,fileName,contentType,
      sharingAuthorized:input.sharingAuthorized===true,anonymized:input.anonymized===true};
  }
  async function extractToDraft(source,base64,actor,preparedText=null) {
    const bytes=decodeBase64(base64),text=preparedText||await extractText(source.file_name,source.content_type,bytes);
    if(source.domain==='top_performer_sharing'&&likelySensitive(text)) fail('PERSONAL_DATA_DETECTED');
    const database=createSearchData({env,key});
    const gateway=gatewayFactory({app:client,rdb:database.auditRdb,timeoutMs:60000,maxAttempts:1,
      actorResolver:async()=>({uid:actor,isAnonymous:false})});
    const task=await gateway.runAITask({taskType:'knowledge_source_extract',skill:'knowledge_extract',capability:'summarization',
      input:{domain:source.domain,title:source.title},
      context:{document:{title:source.title,domain:source.domain,jurisdiction:source.jurisdiction||null,
        sourceDate:source.published_at||null,text}},
      contextSnapshot:{document:{title:source.title,domain:source.domain,jurisdiction:source.jurisdiction||null,
        sourceDate:source.published_at||null,text},_context:{recipe:'knowledge_source_extract',version:'1.0.0'}}});
    const out=task.result;
    const content=[out.summary,`知识点：\n${out.keyPoints.map(x=>`• ${x}`).join('\n')}`,
      `营销/服务应用：\n${out.applicationNotes.map(x=>`• ${x}`).join('\n')}`,
      `适用边界：\n${out.boundaries.map(x=>`• ${x}`).join('\n')}`].join('\n\n').slice(0,7900);
    const meta={domain:source.domain,jurisdiction:source.jurisdiction,review_at:source.review_at,
      source_uri:source.source_uri,sharing_authorized:source.domain==='top_performer_sharing'&&source.metadata?.sharing_authorized===true,
      anonymized:source.domain==='top_performer_sharing'&&source.metadata?.anonymized===true,
      extraction_task_id:String(task.taskId),extraction_result_id:String(task.resultId),source_version:source.version_no};
    const itemRows=await request('knowledge_items','POST',{},[{item_type:ITEM_TYPE[source.domain],source:source.title,
      source_date:source.published_at,valid_from:source.valid_from,valid_to:source.valid_to,verified:false,
      confidence:null,content,metadata:meta,lifecycle_status:'draft',created_by:actor,updated_by:actor,
      supersedes_id:null,version_no:source.version_no,source_id:source.id}]);
    if(!Array.isArray(itemRows)||!itemRows[0]?.id) fail('PERSISTENCE_ERROR');
    await request('knowledge_sources','PATCH',{id:`eq.${source.id}`},{extraction_status:'draft',extracted_at:new Date().toISOString(),updated_at:new Date().toISOString(),updated_by:actor});
    return {itemId:String(itemRows[0].id),sourceId:String(source.id),draft:true,summary:out.summary,
      keyPoints:out.keyPoints,taskId:String(task.taskId),resultId:String(task.resultId)};
  }
  async function upload(input,actorValue) {
    const actor=actorUid(actorValue),meta=fields(input),bytes=decodeBase64(input.fileBase64);
    const extractedText=await extractText(meta.fileName,meta.contentType,bytes);
    if(meta.domain==='top_performer_sharing'&&likelySensitive(extractedText))fail('PERSONAL_DATA_DETECTED');
    const digest=createHash('sha256').update(bytes).digest('hex');
    const existing=await request('knowledge_sources','GET',{select:'id,extraction_status',sha256:`eq.${digest}`,limit:1});
    if(existing.length)return {ok:true,duplicate:true,sourceId:String(existing[0].id),extractionStatus:existing[0].extraction_status};
    const id=randomUUID(),sourceKey=`pg-private://knowledge-sources/${id}`;
    const payload={domain:meta.domain,title:meta.title,publisher:meta.publisher,jurisdiction:meta.jurisdiction,source_uri:meta.sourceUri,
      published_at:meta.publishedAt,valid_from:meta.validFrom,valid_to:meta.validTo,review_at:meta.reviewAt,
      storage_key:sourceKey,file_name:meta.fileName,content_type:meta.contentType,file_size_bytes:bytes.length,sha256:digest,
      extraction_status:'queued',lifecycle_status:'draft',version_no:1,created_by:actor,updated_by:actor,
      metadata:{sharing_authorized:meta.sharingAuthorized,anonymized:meta.anonymized},original_base64:bytes.toString('base64')};
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
    const rows=await request('knowledge_sources','GET',{select:'*',id:`eq.${sourceId}`,limit:1});
    if(!rows.length||!rows[0].original_base64)fail('SOURCE_UNAVAILABLE');
    const items=await request('knowledge_items','GET',{select:'id',source_id:`eq.${sourceId}`,limit:1});
    if(items.length)fail('DRAFT_ALREADY_EXISTS');
    const source=rows[0];
    await request('knowledge_sources','PATCH',{id:`eq.${sourceId}`},{extraction_status:'queued',updated_at:new Date().toISOString(),updated_by:actor});
    try { return {ok:true,...await extractToDraft(source,source.original_base64,actor),extractionStatus:'draft'}; }
    catch(error){await request('knowledge_sources','PATCH',{id:`eq.${sourceId}`},{extraction_status:'failed',updated_at:new Date().toISOString(),updated_by:actor}).catch(()=>{});throw error;}
  }
  async function reviewSource(input,actorValue) {
    const actor=actorUid(actorValue),sourceId=String(input?.sourceId||''),itemId=String(input?.itemId||''),action=input?.decision;
    if(!positiveId(sourceId)||!positiveId(itemId)||!['verify','invalidate'].includes(action))fail('INVALID_INPUT');
    if(action==='verify') {
      const rows=await request('knowledge_sources','GET',{select:'id,domain,jurisdiction,source_uri,published_at,metadata,updated_at,extraction_status,lifecycle_status',id:`eq.${sourceId}`,limit:1});
      const source=rows[0]; if(!source||source.extraction_status!=='draft'||source.lifecycle_status!=='draft'||source.updated_at!==input.expectedUpdatedAt)fail('STALE_SOURCE');
      if(['industry','legal_tax'].includes(source.domain)&&(!source.jurisdiction||!source.source_uri||!source.published_at))fail('SOURCE_METADATA_REQUIRED');
      if(source.domain==='top_performer_sharing'&&(source.metadata?.sharing_authorized!==true||source.metadata?.anonymized!==true))fail('SHARING_AUTHORIZATION_REQUIRED');
    }
    const data=createSearchData({env,key});
    const result=await data.auditRdb.rpc('crm_knowledge_source_review_v1',{p_actor_uid:actor,p_source_id:Number(sourceId),
      p_item_id:Number(itemId),p_action:action,p_expected_updated_at:input.expectedUpdatedAt||null});
    if(result?.error||!result?.data?.ok)fail(result?.data?.code||'REVIEW_FAILED');
    return {ok:true,...result.data};
  }
  async function sourceList() { return {ok:true,sources:(await sourceRows()).map(metadataForSource)}; }

  async function activeItems(domains,market) {
    const items=await request('knowledge_items','GET',{select:'id,source_id,item_type,source,source_date,valid_from,valid_to,verified,lifecycle_status,version_no,content,metadata',verified:'eq.true',lifecycle_status:'eq.verified',order:'source_date.desc.nullslast,id.desc',limit:300});
    const ids=[...new Set(items.map(row=>row.source_id).filter(positiveId).map(String))];
    const sources=ids.length?await request('knowledge_sources','GET',{select:'id,domain,title,publisher,jurisdiction,source_uri,published_at,valid_from,valid_to,review_at,lifecycle_status,version_no',id:`in.(${ids.join(',')})`,limit:300}):[];
    const sourceMap=new Map(sources.map(row=>[String(row.id),row]));
    const today=todayShanghai();
    return items.filter(row=>{
      const domain=row.metadata?.domain;if(!domains.has(domain))return false;
      if(row.valid_from&&row.valid_from>today||row.valid_to&&row.valid_to<today)return false;
      const source=row.source_id?sourceMap.get(String(row.source_id)):null;
      if(row.source_id&&(!source||source.lifecycle_status!=='verified'||source.valid_from&&source.valid_from>today||source.valid_to&&source.valid_to<today||source.review_at&&source.review_at<today))return false;
      const jurisdiction=source?.jurisdiction||row.metadata?.jurisdiction||null;
      if(domain==='legal_tax'&&!market)return false;
      if(jurisdiction&&market&&jurisdiction.toLowerCase()!==market.toLowerCase())return false;
      if(jurisdiction&&!market&&['legal_tax','industry'].includes(domain))return false;
      if(domain==='top_performer_sharing'&&(row.metadata?.sharing_authorized!==true||row.metadata?.anonymized!==true))return false;
      return true;
    }).map(row=>({row,source:row.source_id?sourceMap.get(String(row.source_id))||null:null}));
  }
  function tokenize(value) { return [...new Set(String(value||'').toLowerCase().match(/[a-z0-9]{3,}|[\u4e00-\u9fff]{2,}/g)||[])].slice(0,80); }
  function rankEvidence(entries,query,maxCount=8) {
    const tokens=tokenize(query);
    return entries.map(({row,source})=>{
      const hay=`${row.source||''} ${row.content||''} ${JSON.stringify(row.metadata||{})}`.toLowerCase();
      const score=tokens.reduce((n,token)=>n+(hay.includes(token)?1:0),0);
      return {row,source,score};
    }).sort((a,b)=>b.score-a.score||Number(b.row.id)-Number(a.row.id)).slice(0,maxCount);
  }
  function sourceContext(entries) {
    const refs=[]; const allowed=new Map();
    for(const {row,source} of entries){
      const id=String(row.id);allowed.set(id,{schema:'public',table:'knowledge_items',id,sourceId:row.source_id?String(row.source_id):null,
        title:row.source||source?.title||'Knowledge item',domain:row.metadata?.domain||null,sourceDate:row.source_date||source?.published_at||null,
        jurisdiction:source?.jurisdiction||row.metadata?.jurisdiction||null,versionNo:row.version_no||1,locator:row.metadata?.locator||null});
      refs.push({...allowed.get(id),excerpt:String(row.content||'').slice(0,2200)});
    }
    return {refs,allowed};
  }
  async function runDual(input,actorValue) {
    const actor=actorUid(actorValue),personId=String(input?.personId||'').trim(),question=cleanText(input?.question||'',1000,'question'),market=cleanText(input?.market||'',160,'market');
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
    const query=`${question||''} ${person.person.display_name||''} ${person.person.occupation||''} ${JSON.stringify(contextSummary)}`;
    const all=await activeItems(new Set(['industry','top_performer_sharing','playbook','case','story','evidence']),market);
    const library=await activeItems(new Set(['product','company','service','recruitment','campaign','health_wealth_seminar','legal_tax','case','playbook','regulation','evidence','story']),market);
    const a=sourceContext(rankEvidence(all,query,8)),b=sourceContext(rankEvidence(library,query,10));
    const context={customer_snapshot:contextSummary,recruit_context:recruitContext,question:question||'提出下一步跟进建议',market:market||null,
      strategy_sources:a.refs,library_sources:b.refs,
      strategy_guidance:'以行业实践、可信经验、沟通逻辑为主；将推断明确标为推断。不得把来源市场规则直接当成本地规定。',
      library_guidance:'以公司已审核资料为依据。产品、法律和税务事实只能依据匹配且在有效期内的已核验来源。',
      guardrails:'不编造客户事实、产品条款、回报、税务法律结论；没有证据就写明无匹配资料并提出待确认问题。绩优个案只作启发，不保证复现结果。'};
    const database=createSearchData({env,key}),gateway=createAIGateway({app:client,rdb:database.auditRdb,timeoutMs:60000,maxAttempts:1,
      actorResolver:async()=>({uid:actor,isAnonymous:false})});
    const task=await gateway.runAITask({taskType:'customer_followup_dual',skill:'dual_followup',capability:'coaching',
      subjectType:'person',subjectId:personId,input:{personId,question:question||'',market:market||''},context,
      contextSnapshot:{...context,_context:{recipe:'dual_followup',version:'1.0.0',source:'assistant.knowledge-library-service'}}});
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
  async function run(event,actor) {
    switch(event?.operation){
      case 'list':return list();
      case 'upload':return upload(event.data,actor);
      case 'retry':return retryExtraction(event.sourceId,actor);
      case 'review':return reviewSource(event.data,actor);
      case 'dualGenerate':return runDual(event.data,actor);
      case 'dualSelect':return selectDual(event.data,actor);
      case 'dualHistory':return history(event.personId);
      default:fail('INVALID_OPERATION');
    }
  }
  return {run,upload,extractText,list,runDual,selectDual,history};
}

async function handleKnowledgeLibrary(event,actor) { return createKnowledgeLibrary().run(event,actor); }
module.exports={createKnowledgeLibrary,handleKnowledgeLibrary,extractDocx,decodeBase64,likelySensitive,MAX_FILE_BYTES};
