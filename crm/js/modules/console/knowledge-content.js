import { h } from './dom.js';
import { t } from './i18n.js';
import { data } from './data.js';
import { openSheet } from './write.js';
const tr=key=>t(`kc_${key}`);
const codeOf=error=>String(error?.message||'').match(/CONTENT_[A-Z_]+/)?.[0];
export async function openKnowledgeContent(ctx,row,onSaved=()=>{}) {
  const body=h('div',{class:'kc-panel'}),sheet=openSheet({title:tr('title'),sub:tr('intro'),body});
  (document.getElementById('sheet-root')||document.body).appendChild(sheet.overlay);
  let record,history=[],job=null,busy=false;
  const call=(op,value)=>data.knowledgeLibrary(ctx,'content',{contentOperation:op,data:value});
  const identity=()=>({table:row.table,id:row.id,expectedUpdatedAt:record.updatedAt});
  const errorBox=h('p',{class:'sheet-err',role:'alert'});
  const errorText=error=>{const code=codeOf(error);const key=`kc_${code}`;const value=t(key);return code&&value!==key?value:tr('failed');};
  const act=async fn=>{if(busy)return;busy=true;errorBox.textContent='';body.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{await fn();}catch(error){errorBox.textContent=errorText(error);}finally{busy=false;body.querySelectorAll('button').forEach(b=>b.disabled=false);}};
  const button=(label,fn,cls='btn btn-ghost')=>h('button',{type:'button',class:cls,onclick:()=>act(fn)},tr(label));
  const pairView=(name,pair)=>h('section',{class:'kc-pair-preview'},[
    h('b',{},tr(name)),h('details',{open:true},[h('summary',{},tr('text')),h('pre',{},pair?.text||tr('empty'))]),
    h('details',{open:true},[h('summary',{},tr('summary')),h('pre',{},pair?.summary||tr('empty'))]),
  ]);
  const showPreview=preview=>{
    const panel=h('section',{class:'kc-preview'},[
      h('h3',{},tr('preview')),h('p',{},tr('preview_note')),
      h('div',{class:'kc-compare'},[
        h('div',{},[h('h4',{},tr('before')),pairView('original',preview.before.original),pairView('gpt',preview.before.gpt)]),
        h('div',{},[h('h4',{},tr('after')),pairView('original',preview.after.original),pairView('gpt',preview.after.gpt)]),
      ]),
      h('p',{},`${tr('selected')}: ${tr(preview.after.selected)}${preview.after.paused?` · ${tr('paused')}`:''}`),
      h('div',{class:'kg-form-actions'},[
        button('confirm',async()=>{await call('apply',{commandId:preview.commandId});await load();await onSaved();ctx.toast(tr('saved'),'ok');},'btn btn-primary'),
        button('cancel',async()=>draw()),
      ]),
    ]);
    body.replaceChildren(panel,errorBox);
  };
  const preview=async input=>showPreview(await call('preview',{...identity(),...input}));
  const load=async()=>{const result=await call('get',{table:row.table,id:row.id});record=result.record;history=result.history||[];job=result.job||job;draw();};
  const drawJob=()=>{
    const node=h('section',{class:'kc-job'});
    if(!job)return node;
    node.append(h('p',{},`${tr('generation')}: ${tr(job.status||'queued')}`));
    if(job.progress?.totalPages)node.append(h('p',{},`${Math.max(0,job.progress.nextPage-1)} / ${job.progress.totalPages}`));
    if(job.errorCode)node.append(h('p',{},`${tr('failed')}: ${job.errorCode}`));
    node.append(button('refresh',async()=>{job=await call('command',{commandId:job.commandId});draw();}));
    if(job.status==='failed'||job.status==='done')node.append(button('retry',async()=>{job=await call('retry',{commandId:job.commandId});draw();}));
    if(job.status==='done'&&job.progress?.previewId)node.append(button('candidate',async()=>{
      const candidate=await call('command',{commandId:job.progress.previewId});
      if(candidate.before.updatedAt!==record.updatedAt)throw new Error('CONTENT_STALE');
      draw({original:candidate.after.original});
    }));
    return node;
  };
  const draw=(candidate={})=>{
    const pairEditors=['original','gpt'].map(target=>{
      const pair=candidate[target]||record[target];
      const txt=h('textarea',{rows:7,maxlength:'120000','aria-label':`${tr(target)} ${tr('text')}`},pair.text||'');
      const summary=h('textarea',{rows:4,maxlength:'12000','aria-label':`${tr(target)} ${tr('summary')}`},pair.summary||'');
      const reviewed=h('input',{type:'checkbox'});
      const panel=h('section',{class:'kc-editor','data-content-target':target},[
        h('h3',{},tr(target)),target==='gpt'?h('p',{},tr('gpt_note')):null,
        candidate[target]?h('p',{class:'kc-candidate-note'},tr('candidate_note')):null,
        h('label',{},[tr('text'),txt]),h('label',{},[tr('summary'),summary]),
        h('label',{class:'kc-review'},[reviewed,tr('reviewed')]),
        h('div',{class:'kg-form-actions'},[
          button('save_preview',async()=>preview({action:'edit',target,patch:{text:txt.value,summary:summary.value},reviewed:reviewed.checked}),'btn btn-primary'),
          button('clear_text',async()=>preview({action:'edit',target,patch:{text:null},reviewed:false})),
          button('clear_summary',async()=>preview({action:'edit',target,patch:{summary:null},reviewed:false})),
          button('clear_pair',async()=>preview({action:'edit',target,patch:{text:null,summary:null},reviewed:false})),
          button('select',async()=>preview({action:'select',selected:target})),
        ]),
      ]);
      if(target==='original')panel.append(h('div',{class:'kg-form-actions'},['text','summary','both'].map(part=>button(`regenerate_${part}`,async()=>{
        if(!window.confirm(tr('regenerate_confirm')))return;
        job=await call('regenerate',{...identity(),part});draw();
      }))));
      return panel;
    });
    body.replaceChildren(h('p',{},`${record.title||''} · ${tr('selected')}: ${tr(record.selected)} · v${record.version}`),
      record.paused?h('p',{class:'kc-candidate-note'},tr('paused')):h('span'),
      ...pairEditors,drawJob(),
      h('details',{},[h('summary',{},tr('history')),h('p',{},tr('history_note')),
        ...history.map(item=>h('div',{class:'kg-form-actions'},[
          h('span',{},String(item.applied_at||'').replace('T',' ').slice(0,19)),
          button('restore',async()=>preview({action:'restore',historyId:item.id})),
        ]))]),errorBox);
  };
  try{await load();}catch(error){body.replaceChildren(errorBox);errorBox.textContent=errorText(error);}
  return sheet;
}
