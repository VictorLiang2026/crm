'use strict';
const { isDeepStrictEqual } = require('node:util');
const { MAX_PAGES } = require('./knowledge-pdf-limits');
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const OPS = new Set(['get','save','regenerate']);

function createKnowledgeContentService({ rpc, request, sourceBytes, extractText, extractPdfText, generateSummary, callFunction, renderPdfPages }) {
  async function invoke(operation,actor,data) {
    if(typeof actor!=='string'||!actor.trim())fail('UNAUTHORIZED');
    const result=await rpc('crm_knowledge_content_v1',{p_operation:operation,p_actor_uid:actor,p_data:data});
    if(result?.error||!result?.data?.ok)fail(result?.data?.code||'PERSISTENCE_ERROR');
    return result.data;
  }

  async function run(operation,actor,data) {
    if(!data||typeof data!=='object'||Array.isArray(data))fail('INVALID_INPUT');
    if(operation==='save'&&Object.hasOwn(data,'sourceValidated'))fail('INVALID_INPUT');
    if(operation==='queueGpt'){
      if(!['knowledge_items','playbooks'].includes(data.table)||!/^[1-9][0-9]*$/.test(String(data.id))||
          typeof data.expectedUpdatedAt!=='string'||!Number.isFinite(Date.parse(data.expectedUpdatedAt)))fail('INVALID_INPUT');
      const current=await invoke('get',actor,{table:data.table,id:String(data.id)}),record=current.record;
      if(!record||record.updatedAt!==data.expectedUpdatedAt)fail('CONTENT_STALE');
      if(typeof record.gpt?.summary==='string'&&record.gpt.summary.trim())return {ok:true,skipped:true,reason:'GPT_SUMMARY_EXISTS',status:'existing'};
      const sourceText=record.original?.text;
      if(typeof sourceText!=='string'||!sourceText.trim())fail('CONTENT_ORIGINAL_REQUIRED');
      const generated=await generateSummary({domain:'other',title:record.title||'Knowledge',content:sourceText},actor);
      const latest=await invoke('get',actor,{table:data.table,id:String(data.id)});
      if(latest.record?.updatedAt!==data.expectedUpdatedAt)fail('CONTENT_STALE');
      if(typeof latest.record?.gpt?.summary==='string'&&latest.record.gpt.summary.trim())
        return {ok:true,skipped:true,reason:'GPT_SUMMARY_EXISTS',status:'existing'};
      const saved=await invoke('save',actor,{table:data.table,id:String(data.id),expectedUpdatedAt:data.expectedUpdatedAt,
        expectedVersion:record.version,expectedSourceFingerprint:record.sourceFingerprint,
        target:'gpt',patch:{summary:generated.summary}});
      return {ok:true,status:'saved',recordId:String(data.id),updatedAt:saved.record?.updatedAt||null,
        taskId:generated.taskId,resultId:generated.resultId};
    }
    if(operation==='get'){
      const result=await invoke('get',actor,data);
      return {ok:true,record:result.record};
    }
    if(!OPS.has(operation))fail('INVALID_INPUT');
    return invoke(operation,actor,data);
  }

  async function worker() {
    const {job}=await invoke('claim','knowledge-content-worker',{});
    if(!job)return {ok:true,processed:false};
    const actor=job.actor_uid,payload={...job.payload};
    const saveProgress=(status,errorCode)=>invoke('progress',actor,{commandId:job.id,leaseToken:job.lease_token,status,payload,errorCode});
    try{
      const {record}=await invoke('get',actor,{table:job.record_table,id:job.record_id});
      if(!isDeepStrictEqual(record,job.before_state))fail('CONTENT_STALE');
      if(payload.stage==='extract'){
        if(payload.target==='gpt'&&String(record.source?.id||'')!==String(payload.sourceId||''))fail('SOURCE_UNAVAILABLE');
        const source=(await request('knowledge_sources','GET',{select:'*',id:`eq.${record.source?.id}`,deleted_at:'is.null',limit:1}))[0];
        if(!source||['invalidated','superseded'].includes(source.lifecycle_status))fail('SOURCE_UNAVAILABLE');
        const bytes=await sourceBytes(source,actor);
        if(payload.pdfOcr){
          const images=[];
          const rendered=await renderPdfPages(bytes,{startPage:payload.nextPage,maxPages:3,timeoutMs:75000,onBatch:async batch=>images.push(...batch)});
          if(!rendered.pageCount||rendered.pageCount>MAX_PAGES)fail('PDF_PAGE_LIMIT');
          if(rendered.nextPage<=payload.nextPage)fail('PDF_EXTRACTION_FAILED');
          const response=await callFunction({name:'ai_parse',data:{action:'ocr_knowledge_source',images}});
          if(!response?.result?.ocrText||response.result.error)fail('OCR_FAILED');
          payload.text=[payload.text,response.result.ocrText].filter(Boolean).join('\n\n');
          if(payload.text.length>100000)fail('CONTENT_TOO_LONG');
          payload.nextPage=rendered.nextPage;payload.totalPages=rendered.pageCount;
          if(rendered.nextPage<=rendered.pageCount){await saveProgress('queued');return {ok:true,processed:true};}
        }else{
          try{payload.text=source.content_type==='application/pdf'?await extractPdfText(bytes):
            await extractText(source.file_name,source.content_type,bytes,{app:{callFunction},
              ...(source.metadata?.upload?.upload_id?{sourceId:source.id,uploadId:source.metadata.upload.upload_id}:{})});}
          catch(error){if(error.code!=='PDF_NO_TEXT')throw error;payload.pdfOcr=true;await saveProgress('queued');return {ok:true,processed:true};}
        }
        if(typeof payload.text!=='string'||!payload.text.trim())fail('OCR_FAILED');
        if(payload.text.length>100000)fail('CONTENT_TOO_LONG');
        payload.stage=payload.part==='text'?'save':'summary';
        await saveProgress('queued');return {ok:true,processed:true};
      }
      if(payload.stage==='summary'){
        const result=await generateSummary({domain:'other',title:record.title||'Knowledge',content:payload.text},actor);
        payload.summary=result.summary;payload.aiTaskId=result.taskId;payload.aiResultId=result.resultId;payload.stage='save';
        await saveProgress('queued');return {ok:true,processed:true};
      }
      const patch={};
      if(payload.part!=='summary')patch.text=payload.text;
      if(payload.part!=='text')patch.summary=payload.summary;
      await invoke('save',actor,{table:job.record_table,id:String(job.record_id),expectedUpdatedAt:job.expected_updated_at,
        expectedVersion:record.version,expectedSourceFingerprint:record.sourceFingerprint,
        ...(payload.target==='original'&&payload.part!=='summary'?{sourceValidated:true}:{}),
        target:payload.target==='gpt'?'gpt':'original',patch});
      payload.saved=true;delete payload.previewId;delete payload.pendingCommandId;delete payload.pendingStatus;
      await saveProgress('done');
      return {ok:true,processed:true};
    }catch(error){
      await saveProgress('failed',/^[A-Z][A-Z0-9_]{1,79}$/.test(error?.code||'')?error.code:'CONTENT_GENERATION_FAILED');
      return {ok:false,processed:true,errorCode:error?.code||'CONTENT_GENERATION_FAILED'};
    }
  }
  return {run,worker};
}

module.exports={createKnowledgeContentService};
