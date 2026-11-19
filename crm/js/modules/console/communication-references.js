import {wordImport} from './manual-docx-import.js';
import {h} from './dom.js';
import {t} from './i18n.js';
import {data} from './data.js';
import {referenceOptimization} from './reference-optimization.js';
const text=key=>t('kr_'+key);
const call=(ctx,operation,payload={})=>data.knowledgeLibrary(ctx,'referenceMaintenance',{referenceOperation:operation,data:payload});
const button=(label,action,primary=false)=>h('button',{type:'button',class:'btn '+(primary?'btn-primary':'btn-ghost'),onclick:async e=>{
 const node=e.currentTarget;node.disabled=true;try{await action();}finally{node.disabled=false;}}},text(label));
function dialog(title){
 const panel=h('section',{class:'kr-dialog',role:'dialog','aria-modal':'true','aria-label':title,tabindex:'-1'});
 const overlay=h('div',{class:'kr-overlay'},panel),previous=document.activeElement;
 const close=()=>{overlay.remove();previous?.focus();};
 panel.append(h('header',{},[h('h2',{},title),button('close',close)]));
 overlay.addEventListener('keydown',e=>{if(e.key==='Escape')close();if(e.key==='Tab'){
  const nodes=[...panel.querySelectorAll('button,input,textarea,select,a[href]')].filter(x=>!x.disabled),first=nodes[0],last=nodes.at(-1);
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
 document.body.append(overlay);panel.focus();return {panel,close};
}
const field=(label,control)=>h('label',{class:'kr-field'},[h('span',{},text(label)),control]);
export async function openKnowledgeHistory(ctx,row,onChange){
 const {panel,close}=dialog(text('history')),status=h('p',{role:'status'});panel.append(status);
 try{
  const r=await call(ctx,'history',{table:row.table,id:row.id});
  if(!r.rows.length)status.textContent=text('history_empty');
  for(const v of r.rows){const s=v.snapshot;
   panel.append(h('details',{},[h('summary',{},`${v.created_at} · ${v.actor_uid||''}`),
    h('pre',{},s.content||s.response_logic||''),button('restore',async()=>{
     if(!window.confirm(text('restore_confirm')))return;
     try{await call(ctx,'restore',{table:row.table,id:row.id,historyId:v.id,expectedUpdatedAt:row.updated_at});await onChange();close();}
     catch(_){status.textContent=text('save_failed');}
    })]));}
 }catch(_){status.textContent=text('load_failed');}
}
export async function toggleKnowledgeEnabled(ctx,row,onChange){
 await call(ctx,'toggle',{table:row.table,id:row.id,enabled:row.metadata?.enabled===false,expectedUpdatedAt:row.updated_at});
 await onChange();
}
function edit(ctx,row,onChange){
 const {panel,close}=dialog(text(row?'edit':'new')),status=h('p',{role:'status'});
 const title=h('input',{required:true,maxlength:160,value:row?.scenario||''});
 const kind=h('select',{},['wording','objection'].map(v=>h('option',{value:v,selected:row?.metadata?.kind===v},text(v))));
 const keywords=h('input',{value:(row?.metadata?.keywords||[]).join('、')});
 const content=h('textarea',{required:true,rows:12,maxlength:4000},row?.response_logic||'');
 const form=h('form',{onsubmit:async e=>{
  e.preventDefault();const submit=form.querySelector('[type=submit]');submit.disabled=true;
  try{await call(ctx,'saveReference',{table:'playbooks',...(row?{id:row.id,expectedUpdatedAt:row.updated_at}:{}),
   title:title.value,kind:kind.value,keywords:keywords.value.split(/[、,，\n]/).map(v=>v.trim()).filter(Boolean),content:content.value});
   await onChange();close();}catch(_){status.textContent=text('save_failed');submit.disabled=false;}
 }},[field('title',title),field('kind',kind),field('keywords',keywords),field('content',content),
  h('p',{},text('content_hint')),status,h('button',{type:'submit',class:'btn btn-primary'},text('save'))]);panel.append(form);
}
async function importManuals(ctx,onChange){
 const {panel}=dialog(text('import'));
 const status=h('p',{role:'status'}),results=h('div',{});
 const word=wordImport(ctx,results,status,onChange);
 const picker=h('input',{type:'file',accept:'.docx,.json,application/json,application/vnd.openxmlformats-officedocument.wordprocessingml.document',onchange:async()=>{
  word.reset();
  const file=picker.files[0];if(!file)return;
  picker.disabled=true;
  try{
   if(/\.docx$/i.test(file.name)){await word.upload(file);return;}
   if(file.size>512*1024)throw new Error();
   const entries=JSON.parse(await file.text());
   const preview=await call(ctx,'importPreview',{entries});
   results.append(h('p',{},text('import_hint').replace('{count}',String(preview.count))));
   for(const row of entries)results.append(h('details',{},[h('summary',{},row.entryKey+' · '+row.title),h('p',{},row.origin),h('pre',{},row.content)]));
   const confirm=button('import_confirm',async()=>{
    picker.disabled=true;status.textContent=text('working');
    try{
     const result=await call(ctx,'importConfirm',{entries,previewToken:preview.previewToken});
     confirm.remove();status.textContent=text('import_result').replace('{added}',String(result.added)).replace('{skipped}',String(result.skipped));
     await onChange();
    }catch(_){status.textContent=text('import_failed');}finally{picker.disabled=false;}
   },true);
   results.append(confirm);
  }catch(_){status.textContent=text('file_invalid');}finally{picker.disabled=false;}
 }});
 panel.append(field('private_file',picker),word.recent,status,results);
}
export function renderCommunicationReferences(ctx){
 let rows=[],query='',kind='',enabled='enabled',page=1;
 const root=ctx.main,list=h('div',{class:'kg-table-wrap'}),status=h('p',{role:'status'});
 const load=async()=>{try{const [r]=await Promise.all([call(ctx,'list'),optimization.load()]);rows=r.rows;draw();}catch(_){status.textContent=text('load_failed');}};
 const optimization=referenceOptimization(ctx,{dialog,onChange:load,status,onRowChange:updated=>{
  const at=rows.findIndex(row=>String(row.id)===String(updated.id));if(at>=0)rows[at]=updated;
  const current=list.querySelector(`[data-reference-id="${updated.id}"]`);if(current)current.replaceWith(makeRow(updated));
 },legacyHistory:row=>openKnowledgeHistory(ctx,{...row,table:'playbooks'},load)});
 const makeRow=row=>h('tr',{'data-reference-id':row.id},[
  h('td',{class:'kr-number'},[optimization.select(row),h('span',{},String(row.id))]),
  h('td',{class:'kr-info-cell'},[buttonTitle(row),h('div',{class:'kr-reference-meta'},[
   h('span',{class:'kr-kind'},text(row.metadata?.kind||'wording')),
   h('span',{class:'kr-keywords',title:(row.metadata?.keywords||[]).join('、')},(row.metadata?.keywords||[]).join('、'))])]),
  h('td',{class:'kr-state-cell'},[h('span',{class:'kr-enabled-state'},text(row.metadata?.enabled===false?'disabled':'enabled')),optimization.cell(row)]),
  h('td',{class:'kr-version-cell','data-label':t('ro_selector_heading')},optimization.versionCell(row)),
  h('td',{class:'kr-actions-cell'},h('div',{class:'kr-row-actions'},[button('edit',()=>edit(ctx,row,load)),button(row.metadata?.enabled===false?'enable':'disable',async()=>{
   try{await toggleKnowledgeEnabled(ctx,{...row,table:'playbooks'},load);}catch(_){status.textContent=text('save_failed');}}),
   h('button',{type:'button',class:'btn btn-ghost',onclick:()=>optimization.versions(row).catch(()=>{status.textContent=text('load_failed');})},t('ro_versions'))]))]);
 const draw=()=>{
  const q=query.trim().toLowerCase(),filtered=rows.filter(r=>(!kind||r.metadata?.kind===kind)&&
   (enabled==='all'||(enabled==='enabled')===(r.metadata?.enabled!==false))&&
   (!q||`${r.scenario} ${r.response_logic} ${(r.metadata?.keywords||[]).join(' ')}`.toLowerCase().includes(q)));
  const pages=Math.max(1,Math.ceil(filtered.length/20));page=Math.min(page,pages);
  list.replaceChildren(h('table',{class:'kg-table kr-table'},[
   h('thead',{},h('tr',{},['number','reference_info','state_optimization','version','actions'].map(v=>h('th',{},v==='version'?t('ro_selector_heading'):text(v))))),
   h('tbody',{},filtered.slice((page-1)*20,page*20).map(makeRow)),
  ]),h('div',{class:'kg-pager'},[button('previous',()=>{page=Math.max(1,page-1);draw();}),
   h('span',{},`${page} / ${pages} · ${filtered.length}`),button('next',()=>{page=Math.min(pages,page+1);draw();})]));
 };
 const buttonTitle=row=>h('button',{type:'button',class:'kr-reference-title',title:row.scenario,onclick:()=>{
  const {panel}=dialog(row.scenario);panel.append(h('pre',{},row.response_logic),h('p',{},row.metadata?.origin||''));}},row.scenario);
 const search=h('input',{'aria-label':text('search'),placeholder:text('search')});
 root.replaceChildren(h('section',{class:'card kr-page'},[
  h('h1',{},text('heading')),h('p',{},text('scope')),
  h('div',{class:'kr-primary-tools'},[
   h('a',{class:'btn btn-ghost',href:'#/knowledge-library'},text('back')),
   button('new',()=>edit(ctx,null,load)),button('import',()=>importManuals(ctx,load)),
  ]),h('div',{class:'kg-list-tools'},[
   h('form',{class:'kr-search',onsubmit:e=>{e.preventDefault();query=search.value;page=1;draw();}},[search,h('button',{type:'submit',class:'btn btn-ghost',title:text('search')},text('search_action'))]),
   h('select',{'aria-label':text('kind'),onchange:e=>{kind=e.target.value;page=1;draw();}},['','wording','objection'].map(v=>h('option',{value:v},text(v||'all')))),
   h('select',{'aria-label':text('state'),onchange:e=>{enabled=e.target.value;page=1;draw();}},['enabled','disabled','all'].map(v=>h('option',{value:v},text(v)))),
  ]),optimization.tools,status,list]));load();
}
export function communicationDraftControl(ctx,row){
 if(!['ready','manual'].includes(row.system?.status))return null;
 const focus=h('input',{'aria-label':text('focus'),placeholder:text('focus'),maxlength:1000}),output=h('div',{'aria-live':'polite'});
 return h('details',{class:'kr-wording'},[h('summary',{},text('polish')),h('p',{},text('draft_scope')),focus,
  button('generate',async()=>{
   output.replaceChildren(h('p',{},text('working')));
   try{const r=await data.knowledgeLibrary(ctx,'communicationDraft',{data:{adviceId:row.id,focus:focus.value}});
    output.replaceChildren(h('p',{},r.status==='no_match'?text('no_match'):text('review_draft')),
     ...(r.message?[h('pre',{},r.message),...r.references.map(ref=>h('details',{},[h('summary',{},ref.title+' v'+ref.version),h('pre',{},ref.content)]))]:[]));
   }catch(_){output.replaceChildren(h('p',{},text('generate_failed')));}
  }),output]);
}
