import {h} from './dom.js';
import {data} from './data.js';
import {t} from './i18n.js';
import {pageHead,sectionTitle,fmtDate} from './ui.js';
import {fileImportNode} from './file-import.js';

const FIELDS=[['phone','ocr_field_phone'],['gender','ocr_field_gender'],['birthday','ocr_field_birthday'],
 ['occupation','ocr_field_occupation'],['education','ocr_field_education'],['marital_status','ocr_field_marital'],
 ['hobbies','ocr_field_hobbies'],['source','ocr_field_source'],['notes','l04_person_notes']];
const button=(key,fn)=>h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:fn},t(key));
function key(){if(!globalThis.crypto?.randomUUID)throw Error(t('ocr_secure_ids_unavailable'));return crypto.randomUUID();}
function label(k){return t(FIELDS.find(x=>x[0]===k)?.[1]||'ocr_unknown_field');}
function download(source){
 const match=/^data:[^;,]+;base64,([A-Za-z0-9+/=]+)$/.exec(source?.photo_url||'');
 if(!match)throw Error(t('file_import_source_missing'));
 const raw=atob(match[1]),bytes=Uint8Array.from(raw,x=>x.charCodeAt(0));
 // Never execute uploaded HTML/SVG or navigate to a supplied URL.
 const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
 const a=h('a',{href:url,download:source.file_name||'original'});document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function reviewPersonFile(ctx,job,host,onDone=()=>{}){
 const receipt=await data.personFile(ctx,job.id);
 if(receipt.job?.id!==job.id)throw Error(t('file_import_review_failed'));
 job=receipt.job;
 const error=h('p',{role:'alert',class:'sheet-err l04-file-error'});
 const source=button('l04_download',()=>{try{download(receipt.source);}catch{error.textContent=t('file_import_source_missing');}});
 const raw=h('pre',{style:'white-space:pre-wrap;overflow-wrap:anywhere'},job.raw_text||'');
 const sourceDetails=h('details',{},[h('summary',{},t('l04_source_text')),raw]);
 const history=h('details',{class:'l04-command-history'},[h('summary',{},t('l04_history')),
  ...(receipt.commands||[]).map(command=>h('article',{class:'care-record'},[
   h('strong',{},t(command.operation==='undo'?'l04_history_undo':'l04_history_apply')+' · '+fmtDate(command.executed_at)),
   h('p',{},command.preview?.displayName||''),
   h('p',{},t(command.status==='undone'?'l04_history_reversed':'l04_history_done')),
   ...Object.entries(command.preview?.after||{}).map(([k,v])=>h('p',{},label(k)+': '+
    (command.preview?.before?.[k]??t('label_none'))+' → '+(v??t('label_none')))),
  ]))]);
 let busy=false,preview=null;
 const previewHost=h('div',{class:'l04-preview'});
 const form=h('div',{class:'tab-stack l04-file-form'});
 function showPreview(pv){
  if(!pv?.previewId||!pv.preview)throw Error(t('file_import_review_failed'));
  preview=pv;const p=pv.preview;
  const confirm=button('btn_confirm',async()=>{
   if(busy)return;busy=true;confirm.disabled=true;error.textContent='';
   try{
    const result=await data.executePersonFile(ctx,preview.previewId);
    if(!result.ok||!result.personId)throw Error('Invalid receipt');
    host.replaceChildren(h('p',{role:'status'},t(result.operation==='undo'||result.commandStatus==='undone'?'l04_undone':'l04_applied')),
     h('a',{class:'btn btn-soft',href:'#/person/'+result.personId+'/ocr'},t('l04_open_person')));
    await onDone();ctx.onWriteDone?.();
   }catch{error.textContent=t('l04_execute_failed');}
   finally{busy=false;confirm.disabled=false;}
  });
  const cancel=button('cancel',()=>{if(busy)return;preview=null;previewHost.replaceChildren();form.hidden=false;});
  previewHost.replaceChildren(h('p',{class:'sheet-note'},t('l04_confirm_scope')),
   h('strong',{},p.displayName+(p.personId?' #'+p.personId:' · '+t('btn_new_person'))),
   h('p',{},p.fileName),h('p',{},t(p.operation==='undo'?'l04_undo_note':'l04_apply_note')),
   ...Object.entries(p.after||{}).map(([k,v])=>h('div',{class:'ocr-diff-row'},[
    h('strong',{},label(k)),h('span',{},t('ocr_before')+': '+(p.before?.[k]??t('label_none'))),
    h('span',{},t('ocr_after')+': '+(v??t('label_none')))])),
   h('p',{class:'sheet-note'},t('l04_expires')+' '+fmtDate(pv.expiresAt)),
   h('div',{class:'sheet-actions'},[cancel,confirm]));
  form.hidden=true;
 }
 host.replaceChildren(sectionTitle(job.file_name),source,sourceDetails,history,form,previewHost,error);
 if(job.apply_command_id){
  form.append(h('a',{href:'#/person/'+job.person_id},t('l04_open_person')),
   h('p',{class:'sheet-note'},t('l04_undo_note')),button('l04_preview_undo',async()=>{
    if(busy)return;busy=true;error.textContent='';
    try{showPreview(await data.previewPersonFileUndo(ctx,{jobId:job.id,commandId:job.apply_command_id,idempotencyKey:key()}));}
    catch{error.textContent=t('l04_undo_failed');}finally{busy=false;}
   }));
  return;
 }
 if(job.status!=='draft'){form.append(h('p',{},t('l04_draft_required')));return;}
 const name=h('input',{class:'sheet-input',maxlength:'160','aria-label':t('new_person_name'),value:job.parsed_fields?.customer_name||''});
 const choices=h('div',{class:'act-person-results'});
 const selectedNote=h('p',{class:'sheet-note'},t('act_person_not_selected'));
 const fields=h('div',{class:'ocr-field-list l04-fields'});
 const controls=[];
 for(const [k,labelKey]of FIELDS){
  const value=job.parsed_fields?.[k==='notes'?'additional_info':k];
  if(typeof value!=='string'||!value.trim())continue;
  const check=h('input',{type:'checkbox','data-field':k});
  const input=h('textarea',{class:'sheet-textarea',rows:'2',maxlength:k==='notes'?'8000':'500','aria-label':t(labelKey)});
  input.value=value;
  fields.append(h('label',{class:'ocr-field-row'},[check,h('span',{class:'ocr-field-content'},[h('strong',{},t(labelKey)),input])]));
  controls.push({k,check,input});
 }
 let selected=null,epoch=0;
 const previewButton=button('l04_preview_apply',async()=>{
  if(busy||!selected)return;busy=true;previewButton.disabled=true;error.textContent='';
  try{
   const values=Object.fromEntries(controls.filter(c=>c.check.checked).map(c=>[c.k,c.input.value]));
   showPreview(await data.previewPersonFile(ctx,{jobId:job.id,idempotencyKey:key(),displayName:selected.displayName,
    ...(selected.id==null?{}:{personId:String(selected.id)}),fields:values}));
  }catch{error.textContent=t('l04_preview_failed');}
  finally{busy=false;previewButton.disabled=!selected;}
 });previewButton.disabled=true;
 const resolve=button('btn_check_name',async()=>{
  if(busy)return;busy=true;resolve.disabled=true;selected=null;previewButton.disabled=true;choices.replaceChildren();error.textContent='';
  const generation=++epoch;const query=name.value.trim();
  try{
   const resolution=await data.resolvePersonName(ctx,query);
   if(generation!==epoch||query!==name.value.trim())return;
   const pick=c=>{selected=c;selectedNote.textContent=c.displayName+(c.id?' #'+c.id:' · '+t('btn_new_person'));previewButton.disabled=false;};
   for(const candidate of resolution.candidates||[]){
    choices.append(buttonWithText(candidate.displayName+' · '+(candidate.occupation||t('occupation_empty'))+' · '+(candidate.organization||'')+' #'+candidate.id,()=>pick(candidate)));
   }
   const canCreate=!resolution.hasMore&&!resolution.deletedIdentity&&
    (['available','confirm_new_qualified'].includes(resolution.status)||resolution.canCreateAfterConfirmation===true);
   if(canCreate)choices.append(buttonWithText(t('l04_choose_new')+' '+(resolution.displayName||query),()=>pick({id:null,displayName:resolution.displayName||query})));
   if(resolution.hasMore)choices.append(h('p',{},t('identity_has_more')));
   if(resolution.deletedIdentity)choices.append(h('p',{},t('identity_deleted_note')));
   if(!canCreate)choices.append(h('p',{},t('identity_qualifier_hint')));
  }catch{error.textContent=t('l04_resolve_failed');}
  finally{busy=false;resolve.disabled=false;}
 });
 name.oninput=()=>{epoch++;selected=null;choices.replaceChildren();selectedNote.textContent=t('act_person_not_selected');previewButton.disabled=true;};
 form.append(h('p',{class:'sheet-note'},t('l04_review_note')),h('label',{},[t('new_person_name'),name]),resolve,choices,selectedNote,
  h('p',{class:'sheet-note'},t('l04_fields_note')),fields,previewButton);
}
function buttonWithText(text,fn){return h('button',{class:'btn btn-ghost btn-sm l04-identity-choice',type:'button',onclick:fn},text);}
export async function renderPersonFileImport(ctx){
 ctx.main.replaceChildren(pageHead({title:t('l04_import_title'),sub:t('l04_import_note')}),h('p',{role:'status'},t('loading')));
 try{
  const panel=await fileImportNode(ctx,null,null,{standalone:true,
   onReview:(job,host,refresh)=>reviewPersonFile(ctx,job,host,refresh),
   onOriginal:async(job)=>download((await data.personFile(ctx,job.id)).source)});
  ctx.main.replaceChildren(pageHead({title:t('l04_import_title'),sub:t('l04_import_note')}),
   h('a',{class:'btn btn-soft people-toolbar-link',href:'#/people'},t('people_all_view')),panel);
 }catch{ctx.main.append(h('p',{role:'alert'},t('file_import_load_failed')));}
}
export async function personFileHistory(ctx,personId){
 const root=h('section',{class:'tab-stack l04-person-files'});
 const list=h('div',{class:'care-materials-list'}),review=h('div'),status=h('p',{role:'status'});
 let page=1,hasMore=false,busy=false;
 const previous=button('file_import_previous',()=>load(page-1)),next=button('file_import_next',()=>load(page+1));
 async function load(target){
  if(busy)return;busy=true;previous.disabled=true;next.disabled=true;
  try{
   const result=await data.personFiles(ctx,personId,target);
   if(!Array.isArray(result.rows)||typeof result.hasMore!=='boolean')throw Error('Invalid page');
   page=target;hasMore=result.hasMore;
   list.replaceChildren(...result.rows.map(job=>h('article',{class:'care-record'},[
    h('strong',{},job.file_name),h('p',{},fmtDate(job.created_at)),
    button('l04_view_file',async()=>{try{await reviewPersonFile(ctx,job,review,()=>load(page));}catch{status.textContent=t('file_import_review_failed');}})])));
   status.textContent=result.rows.length?t('file_import_page').replace('{page}',String(page)):t('file_import_no_history');
  }catch{status.textContent=t('file_import_load_failed');}
  finally{busy=false;previous.disabled=page<=1;next.disabled=!hasMore;}
 }
 root.append(sectionTitle(t('l04_person_files')),h('a',{class:'btn btn-soft',href:'#/people/import'},t('l04_import_title')),
  status,list,h('div',{class:'care-record-actions'},[previous,next]),review);
 await load(1);return root;
}

