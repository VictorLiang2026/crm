// Education review through the authenticated Assistant; business writes require server preview and confirmation.
import {h} from './dom.js';
import {t} from './i18n.js';
import {pageHead,card} from './ui.js';

export async function renderEducationBackfill(ctx) {
  let batchId=null,offset=0,busy=false,createPayload=null;
  const selected=new Map(),undoSelected=new Set();
  const root=ctx.main,notice=h('p',{'aria-live':'polite'}),workspace=h('div',{}),review=h('div',{});
  const errors={EDUCATION_NOT_ENABLED:'edu_not_enabled',EDUCATION_SOURCE_CHANGED:'edu_stale',
    EDUCATION_EVIDENCE_STALE:'edu_stale',EDUCATION_PREVIEW_STALE:'edu_stale',EDUCATION_PREVIEW_EXPIRED:'edu_stale',
    EDUCATION_PLAN_REQUIRED:'edu_stale',EDUCATION_SCHOOL_MAJOR_CONFLICT:'edu_pair_conflict',
    EDUCATION_UNDO_CONFLICT:'edu_undo_conflict',EDUCATION_EMPTY_PATCH:'edu_empty_patch',
    EDUCATION_CONFIRMATION_REQUIRED:'edu_confirm_required'};
  function clear(){selected.clear();undoSelected.clear();review.replaceChildren();}
  async function call(operation,data={}){
    const res=await ctx.callFn('assistant',{action:'educationBackfill',operation,data});
    if(!res?.ok)throw Error(res?.error?.code||'EDUCATION_REQUEST_FAILED');return res;
  }
  async function run(fn){
    if(busy)return;busy=true;root.querySelectorAll('button,select,input').forEach(n=>{n.dataset.eduDisabled=n.disabled?'1':'0';n.disabled=true;});
    try{notice.textContent='';notice.removeAttribute('title');await fn();}
    catch(e){notice.textContent=t(errors[e.message]||'edu_uncertain');notice.title=String(e.message).slice(0,120);}
    finally{busy=false;root.querySelectorAll('[data-edu-disabled]').forEach(n=>{n.disabled=n.dataset.eduDisabled==='1';delete n.dataset.eduDisabled;});}
  }
  const button=(key,fn)=>h('button',{type:'button',class:'btn btn-soft',onclick:()=>run(fn)},t(key));
  const scope=h('select',{class:'sheet-input','aria-label':t('edu_batch')},[
    h('option',{value:'pilot'},t('edu_pilot')),h('option',{value:'all'},t('edu_all'))]);
  const budget=h('input',{class:'sheet-input',type:'number',min:1,max:5000,value:200,'aria-label':t('edu_budget')});
  const picker=h('select',{class:'sheet-input','aria-label':t('edu_batch'),onchange:()=>{
    if(busy)return;batchId=picker.value||null;offset=0;run(refresh);
  }});
  async function batches(){
    const res=await call('batches');
    picker.replaceChildren(...res.batches.map(b=>h('option',{value:b.id},
      `${new Date(b.created_at).toLocaleString()} · ${t('edu_status_'+b.status)}`)));
    batchId=batchId||res.batches[0]?.id||null;picker.value=batchId||'';
  }
  async function refresh(){
    clear();if(!batchId){workspace.replaceChildren(h('p',{},t('edu_no_rows')));return;}
    const res=await call('status',{batchId,offset}),b=res.batch;
    const nodes=[h('p',{},`${t('edu_status_'+b.status)} · ${b.calls_used}/${b.max_calls}`),
      h('p',{class:'row-sub'},Object.entries(res.counts).map(([s,n])=>`${t('edu_status_'+s)} ${n} `))];
    for(const item of res.items){
      const body=[h('a',{href:`#/person/${item.person_id}`},item.display_name||String(item.person_id)),
        h('p',{class:'row-sub'},t('edu_status_'+item.status))];
      if(item.error_code)body.push(h('p',{class:'foot-note',title:item.error_code},
        t(item.error_code==='EDUCATION_SOURCE_TOO_LARGE'?'edu_source_large':'edu_scan_failed')));
      if(item.status==='failed')body.push(button('edu_retry',async()=>{await call('retry',{batchId,itemId:item.id});await refresh();}));
      if(['ready','needs_review','failed','no_evidence'].includes(item.status))body.push(button('edu_skip',async()=>{
        await call('skip',{batchId,itemId:item.id});await refresh();
      }));
      if(item.status==='applied'){
        const box=h('input',{type:'checkbox',onchange:()=>{box.checked?undoSelected.add(item.id):undoSelected.delete(item.id);review.replaceChildren();}});
        body.push(h('label',{},[box,t('edu_undo_select')]));
      }
      if(['ready','needs_review'].includes(item.status))for(const [index,c]of(item.result?.candidates||[]).entries()){
        const eligible=c.relationship==='self'&&c.educationType==='graduated'&&!c.ambiguous;
        const choose=h('input',{type:'radio',name:`edu-${item.id}`,disabled:!eligible,'aria-label':t('edu_select')});
        const school=h('input',{type:'checkbox',disabled:!eligible||!c.school,'aria-label':t('edu_use_school')});
        const major=h('input',{type:'checkbox',disabled:!eligible||!c.major,'aria-label':t('edu_use_major')});
        const update=()=>{if(choose.checked){selected.set(item.id,{itemId:item.id,candidateIndex:index,school:school.checked,major:major.checked});review.replaceChildren();}};
        choose.onchange=()=>{school.checked=!!c.school;major.checked=!!c.major;update();};school.onchange=update;major.onchange=update;
        body.push(h('div',{class:'card-body'},[h('label',{},[choose,t('edu_select')]),
          h('p',{},`${t('edu_school')}: ${c.school||t('edu_empty')} · ${t('edu_major')}: ${c.major||t('edu_empty')}`),
          eligible?h('div',{},[h('label',{},[school,t('edu_use_school')]),h('label',{},[major,t('edu_use_major')])]):h('p',{class:'foot-note'},t('edu_ineligible')),
          h('details',{},[h('summary',{},t('edu_evidence')),...(c.evidence||[]).map(e=>h('div',{},[
            h('p',{class:'row-sub'},`public.${e.table} #${e.id} · ${e.field} · ${e.updatedAt||''}`),h('blockquote',{style:'overflow-wrap:anywhere;white-space:pre-wrap'},e.quote)]))])
        ]));
      }
      nodes.push(card({body}));
    }
    if(!res.items.length)nodes.push(h('p',{},t('edu_no_rows')));
    nodes.push(h('div',{class:'head-actions'},[
      offset?button('edu_previous',async()=>{offset=Math.max(0,offset-50);await refresh();}):null,
      res.items.length===50?button('edu_next',async()=>{offset+=50;await refresh();}):null]));
    workspace.replaceChildren(...nodes);
  }
  async function makePlan(kind){
    const rows=kind==='apply'?[...selected.values()].filter(r=>r.school||r.major):[...undoSelected].map(itemId=>({itemId}));
    if(!rows.length){notice.textContent=t('edu_no_selection');return;}
    const currentBatch=batchId,plan=await call('plan',{batchId:currentBatch,kind});
    review.replaceChildren(h('p',{},t('edu_plan_note')),h('p',{},String(rows.length)),button('edu_preview',async()=>{
      const v=await call(kind==='apply'?'preview':'undoPreview',{batchId:currentBatch,planId:plan.planId,rows});
      review.replaceChildren(...v.rows.map(r=>card({title:r.displayName,body:[
        h('p',{},`${t('edu_current')}: ${r.before.graduation_school||t('edu_empty')} / ${r.before.department_or_major||t('edu_empty')}`),
        ...Object.entries(r.patch).map(([key,value])=>h('p',{},`${t(key==='graduation_school'?'edu_school':'edu_major')}: ${value||t('edu_empty')}`))]})),
      h('p',{class:'foot-note'},v.expiresAt),button('edu_confirm',async()=>{
        const confirmation=await call('confirm',{batchId:currentBatch,previewId:v.previewId});
        await call('execute',{batchId:currentBatch,previewId:v.previewId,confirmationToken:confirmation.confirmationToken});
        await refresh();notice.textContent=t('edu_applied');
      }),button('edu_cancel',async()=>clear()));
    }));
  }
  root.replaceChildren(pageHead({title:t('edu_title'),sub:t('edu_intro')}),notice,card({body:[scope,
    h('label',{},[t('edu_budget'),budget]),button('edu_create',async()=>{
      if(!createPayload&&(!Number.isInteger(Number(budget.value))||Number(budget.value)<1||Number(budget.value)>5000)){
        notice.textContent=t('edu_invalid_budget');return;
      }
      if(!createPayload)createPayload={requestKey:crypto.randomUUID(),maxCalls:Number(budget.value),...(scope.value==='pilot'?{sampleSize:50}:{})};
      const created=await call('create',createPayload);createPayload=null;batchId=created.batchId;offset=0;await batches();await refresh();
    }),picker,h('div',{class:'head-actions'},[
      button('edu_refresh',async()=>{await batches();await refresh();}),
      button('edu_pause',async()=>{if(batchId){await call('pause',{batchId});await refresh();}}),
      button('edu_resume',async()=>{if(batchId){await call('resume',{batchId});await refresh();}}),
      button('edu_plan',()=>makePlan('apply')),button('edu_undo_plan',()=>makePlan('undo'))])]}),workspace,review);
  await run(async()=>{await batches();await refresh();});
}
