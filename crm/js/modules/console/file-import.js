import { h } from './dom.js';
import { data } from './data.js';
import { t } from './i18n.js';
import { sectionTitle, fmtDate } from './ui.js';

const TYPES = new Set(['image/jpeg','image/png','image/webp','text/plain','text/csv']);
const MAX_BYTES = 4 * 1024 * 1024;
function base64(file) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('READ_FAILED'));
    reader.onload=()=>{const value=String(reader.result||'');const at=value.indexOf(',');
      if(at<0)reject(new Error('READ_FAILED'));else resolve(value.slice(at+1));};
    reader.readAsDataURL(file);
  });
}
function supported(file) {return TYPES.has(file.content_type||file.type||'application/octet-stream');}
function errorText(code) {
  return t(({UNSUPPORTED_TYPE:'file_import_unsupported',INVALID_CONTENT:'file_import_invalid_content',
    INVALID_RESULT:'file_import_invalid_result',SOURCE_UNAVAILABLE:'file_import_source_missing'})[code]||'file_import_parse_failed');
}

export async function fileImportNode(ctx,personId,customerId,{onReview,onSaved}={}) {
  const root=h('section',{class:'care-materials-section file-import'});
  const input=h('input',{type:'file',multiple:true,'aria-label':t('file_import_choose')});
  const queueHost=h('div',{class:'care-materials-list file-import-queue'});
  const message=h('p',{class:'care-status',role:'status'});
  const history=h('div',{class:'care-materials-list file-import-history'});
  const historyStatus=h('p',{class:'care-status',role:'status'});
  const previous=h('button',{class:'btn btn-ghost btn-sm',type:'button'},t('file_import_previous'));
  const next=h('button',{class:'btn btn-ghost btn-sm',type:'button'},t('file_import_next'));
  const refresh=h('button',{class:'btn btn-ghost btn-sm',type:'button'},t('file_import_refresh'));
  const saveAll=h('button',{class:'btn btn-soft btn-sm',type:'button'},t('file_import_save_all'));
  const parseAll=h('button',{class:'btn btn-primary btn-sm',type:'button'},t('file_import_parse_all'));
  const reviewHost=h('div',{class:'file-import-review'});
  let queue=[],jobs=[],page=1,hasMore=false,busy=false,loading=false,reviewing=false;

  async function review(job,button) {
    if(reviewing)return;reviewing=true;button.disabled=true;
    reviewHost.replaceChildren(h('p',{role:'status'},t('loading')));
    try {await onReview?.(job,reviewHost);}
    catch {reviewHost.replaceChildren(h('p',{role:'alert'},t('file_import_review_failed')));}
    finally {reviewing=false;button.disabled=false;}
  }
  function jobRow(job) {
    const actions=h('div',{class:'care-record-actions'});
    const available=job.sourceAvailable!==false;
    if(job.status==='draft'&&available&&job.draftAvailable!==false&&onReview){
      const button=h('button',{class:'btn btn-soft btn-sm',type:'button'},t('file_import_review'));
      button.addEventListener('click',()=>review(job,button));actions.append(button);
    }else if(job.status!=='draft'&&available&&supported(job)){
      const active=job.status==='parsing'&&Date.parse(job.lease_expires_at)>Date.now();
      const button=h('button',{class:'btn btn-soft btn-sm',type:'button',disabled:busy||active},t('file_import_retry_parse'));
      button.addEventListener('click',async()=>{
        if(busy||loading)return;busy=true;draw();
        try {const result=await data.parseFileDraft(ctx,job.id);if(!result.job)throw Error('Invalid receipt');
          Object.assign(job,result.job);if(job.status==='draft')await onSaved?.();}
        catch {message.textContent=t('file_import_parse_failed');}
        finally {busy=false;draw();await load(page);}
      });actions.append(button);
    }
    return h('article',{class:'care-record','data-import-id':job.id},[
      h('strong',{class:'care-record-title'},job.file_name),
      h('p',{class:'care-record-meta'},`${t('file_import_status_'+job.status)} · ${fmtDate(job.created_at)}`),
      !available||job.status==='draft'&&job.draftAvailable===false?h('p',{},t('file_import_source_missing')):null,
      job.status==='parsing'?h('p',{},t('file_import_wait_note')):null,
      job.error_code?h('p',{role:'status'},errorText(job.error_code)):null,
      !supported(job)?h('p',{},t('file_import_unsupported')):null,actions,
    ]);
  }
  function draw() {
    input.disabled=busy;saveAll.disabled=busy||loading||!queue.length;parseAll.disabled=busy||loading||!queue.length;
    refresh.disabled=loading||busy;previous.disabled=loading||busy||page===1;next.disabled=loading||busy||!hasMore;
    queueHost.replaceChildren(...queue.map(item=>{
      const actions=h('div',{class:'care-record-actions'});
      for(const [parse,key] of [[false,'file_import_save'],[true,'file_import_save_parse']]){
        const button=h('button',{class:'btn btn-ghost btn-sm',type:'button',disabled:busy||loading||parse&&(!supported(item.file)||item.job?.status==='draft')||!parse&&!!item.job},t(key));
        button.addEventListener('click',()=>run([item],parse));actions.append(button);
      }
      if(item.job?.status==='draft'&&onReview){const button=h('button',{class:'btn btn-soft btn-sm',type:'button'},t('file_import_review'));
        button.addEventListener('click',()=>review(item.job,button));actions.append(button);}
      return h('article',{class:'care-record file-import-item'},[
        h('strong',{class:'care-record-title'},item.file.name),
        h('p',{role:'status'},item.error||t('file_import_status_'+item.status)),
        !supported(item.file)?h('p',{},t('file_import_unsupported')):null,actions,
      ]);
    }));
    history.replaceChildren(...jobs.map(jobRow));
  }
  async function load(target) {
    if(loading)return;loading=true;draw();historyStatus.textContent=t('loading');
    try {const result=await data.fileImports(ctx,personId,target);
      if(!Array.isArray(result.rows)||typeof result.hasMore!=='boolean')throw Error('Invalid page');
      jobs=result.rows;page=target;hasMore=result.hasMore;
      historyStatus.textContent=jobs.length?t('file_import_page').replace('{page}',String(page)):t('file_import_no_history');
    }catch {historyStatus.textContent=t('file_import_load_failed');}
    finally {loading=false;draw();}
  }
  async function run(items,parse) {
    if(busy||loading)return;busy=true;message.textContent='';draw();
    try {
      for(const item of items){
        item.error='';
        try {
          if(!item.job){item.status='saving';draw();
            // Keep the same key and original payload when a network response is uncertain.
            item.payload ||= {personId:String(personId),customerId:Number(customerId),idempotencyKey:item.key,
              fileName:item.file.name,contentType:item.file.type||'application/octet-stream',base64:await base64(item.file)};
            const saved=await data.saveFileOriginal(ctx,item.payload);
            if(!saved.job?.id)throw Error('Invalid receipt');item.job=saved.job;item.status=item.job.status;
            await onSaved?.();
          }
          if(parse&&supported(item.file)&&item.job.status!=='draft'){
            item.status='parsing';draw();const result=await data.parseFileDraft(ctx,item.job.id);
            if(!result.job)throw Error('Invalid receipt');item.job=result.job;item.status=item.job.status;
            if(item.job.error_code)item.error=errorText(item.job.error_code);
            if(item.job.status==='draft')await onSaved?.();
          }
        }catch {item.status=item.job?.status||'queued';item.error=t(item.job?'file_import_parse_failed':'file_import_save_failed');}
        draw();
      }
    }finally {busy=false;draw();await load(1);}
  }
  input.addEventListener('change',()=>{
    if(busy)return;
    const files=Array.from(input.files||[]);input.value='';
    if(!files.length)return;
    if(files.length+queue.length>10||files.some(f=>!f.name||f.name.length>255||f.size<1||f.size>MAX_BYTES)){
      message.textContent=t('file_import_invalid_files');return;
    }
    if(!globalThis.crypto?.randomUUID){message.textContent=t('ocr_secure_ids_unavailable');return;}
    queue.push(...files.map(file=>({file,key:crypto.randomUUID(),status:'queued',job:null,error:''})));
    message.textContent='';draw();
  });
  const clear=h('button',{class:'btn btn-ghost btn-sm',type:'button'},t('file_import_clear'));
  clear.addEventListener('click',()=>{if(busy)return;
    if(queue.some(item=>!item.job)&&!window.confirm(t('file_import_clear_pending')))return;
    queue=[];message.textContent='';draw();});
  saveAll.addEventListener('click',()=>run(queue,false));parseAll.addEventListener('click',()=>run(queue,true));
  previous.addEventListener('click',()=>load(page-1));next.addEventListener('click',()=>load(page+1));refresh.addEventListener('click',()=>load(page));
  root.append(sectionTitle(t('file_import_title')),h('p',{class:'sheet-note'},t('file_import_note')),input,
    h('div',{class:'care-record-actions'},[saveAll,parseAll,clear]),message,queueHost,
    h('details',{},[h('summary',{},t('file_import_history')),historyStatus,history,h('div',{class:'care-record-actions'},[previous,next,refresh])]),reviewHost);
  await load(1);return root;
}
