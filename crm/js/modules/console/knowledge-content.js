import { h } from './dom.js';
import { t } from './i18n.js';
import { data } from './data.js';
import { openSheet } from './write.js';

const tr=key=>t(`kc_${key}`);
const codeOf=error=>String(error?.message||'').match(/CONTENT_[A-Z_]+/)?.[0];

export async function openKnowledgeContent(ctx,row,onSaved=()=>{}) {
  const body=h('div',{class:'kc-panel'}),sheet=openSheet({title:tr('title'),sub:tr('intro'),body});
  sheet.overlay.classList.add('kc-sheet-overlay');
  (document.getElementById('sheet-root')||document.body).appendChild(sheet.overlay);
  let record,busy=false;
  const call=(operation,value)=>data.knowledgeLibrary(ctx,'content',{contentOperation:operation,data:value});
  const identity=()=>({table:row.table,id:row.id,expectedUpdatedAt:record.updatedAt,
    expectedVersion:record.version,expectedSourceFingerprint:record.sourceFingerprint});
  const errorBox=h('p',{class:'sheet-err',role:'alert'});
  const errorText=error=>{const code=codeOf(error);const key=`kc_${code}`;const value=t(key);return code&&value!==key?value:tr('failed');};
  const act=async fn=>{
    if(busy)return;
    busy=true;errorBox.textContent='';body.querySelectorAll('button').forEach(button=>button.disabled=true);
    try{await fn();}catch(error){errorBox.textContent=errorText(error);}
    finally{busy=false;body.querySelectorAll('button').forEach(button=>button.disabled=false);}
  };
  const button=(label,fn,cls='btn btn-ghost')=>h('button',{type:'button',class:cls,onclick:()=>act(fn)},tr(label));
  const field=(name,value,rows)=>{
    const input=h('textarea',{rows,maxlength:rows>5?'120000':'12000','aria-label':tr(name)});
    input.value=value||'';
    return input;
  };
  const saved=async result=>{
    record=result.record;
    await onSaved();
    ctx.toast(tr('saved'),'ok');
    draw();
  };
  const save=async(target,patch)=>saved(await call('save',{...identity(),target,patch}));
  const clear=async(target,patch)=>save(target,patch);
  const regenerate=async part=>{
    if(!window.confirm(tr('regenerate_confirm')))return;
    const result=await call('regenerate',{...identity(),part});
    ctx.toast(tr(result.status==='queued'?'generation_started':'saved'),'ok');
  };
  const load=async()=>{const result=await call('get',{table:row.table,id:row.id});record=result.record;draw();};

  const draw=()=>{
    if(!record)return;
    const systemSummary=field('system_summary',record.original?.summary,5);
    const gptSummary=field('gpt_summary',record.gpt?.summary,5);
    const originalText=field('system_original',record.original?.text,10);
    const systemSummaryCard=h('section',{class:'kc-field-card kc-system-summary'},[
      h('div',{class:'kc-field-heading'},[h('h3',{},tr('system_summary')),h('small',{},tr('system_ready_note'))]),
      systemSummary,
      h('div',{class:'kc-card-actions'},[
        button('clear_summary',()=>clear('original',{summary:null})),
        button('regenerate_summary',()=>regenerate('summary')),
      ]),
    ]);
    const gptSummaryCard=h('section',{class:'kc-field-card kc-gpt-summary'},[
      h('div',{class:'kc-field-heading'},[h('h3',{},tr('gpt_summary')),h('small',{},tr('gpt_note'))]),
      gptSummary,
      h('div',{class:'kc-card-actions'},[
        button('clear_summary',()=>clear('gpt',{summary:null})),
        button('save',()=>save('gpt',{summary:gptSummary.value}),'btn btn-primary'),
      ]),
    ]);
    const originalCard=h('section',{class:'kc-field-card kc-original'},[
      h('div',{class:'kc-field-heading'},[h('h3',{},tr('system_original')),h('small',{},tr('original_note'))]),
      originalText,
      h('div',{class:'kc-card-actions'},[
        button('clear_text',()=>clear('original',{text:null})),
        button('clear_pair',()=>clear('original',{text:null,summary:null})),
        button('regenerate_text',()=>regenerate('text')),
        button('save',()=>save('original',{text:originalText.value,summary:systemSummary.value}),'btn btn-primary'),
      ]),
    ]);
    body.replaceChildren(h('div',{class:'kc-edit-grid'},[systemSummaryCard,gptSummaryCard,originalCard]),errorBox);
  };

  try{await load();}catch(error){body.replaceChildren(errorBox);errorBox.textContent=errorText(error);}
  return sheet;
}
