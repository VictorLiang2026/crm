// Person-scoped AI suggestions. Formal Opportunity creation needs a server preview and a human click.
const LABELS={insurance:'保险',recruit:'增员',referral:'转介绍',activity:'活动',
  speaker:'嘉宾',partnership:'合作',service:'服务',relationship:'关系'};
const make=(tag,cls,value)=>{const e=document.createElement(tag);if(cls)e.className=cls;
  if(value!=null)e.textContent=String(value);return e;};
function button(label,fn,cls='') {const b=make('button',`btn ${cls}`,label);b.type='button';
  b.addEventListener('click',fn);return b;}

export function renderOpportunityCandidates({root,personId,callFn,onCreated}) {
  const section=make('section','card person360-card opportunity-candidates');
  section.append(make('h3','', '机会候选 · 待人工审核'));
  section.append(make('p','person360-muted',
    'AI 仅根据可核对的资料提出候选。缺少资料不代表客户有需求；正式机会须预览并由你确认。'));
  const notice=make('p','person360-muted');
  const list=make('div','opportunity-candidate-list');
  const detail=make('div','opportunity-candidate-detail');
  section.append(button('分析并生成候选',async()=>{
    notice.textContent='正在核对资料并分析…';
    try {
      const result=await call('generate',{personId});
      notice.textContent=result.status==='draft' ? '已生成待审核候选；不会自动写入正式机会。' :
        (result.notice||'证据不足，未创建候选。');
      await refresh();
    } catch(error) {notice.textContent=`分析失败：${error.message}`;}
  },'btn-primary'),notice,list,detail);
  root.append(section);
  let evidence=new Map();
  async function call(operation,fields={}) {
    const result=await callFn('assistant',{action:'opportunityCandidate',operation,...fields});
    if (!result || result.ok!==true) throw new Error(result?.error?.code || result?.error || '请求失败');
    return result;
  }
  async function refresh() {
    const [items,context]=await Promise.all([
      call('list',{personId}),call('context',{personId}),
    ]);
    evidence=new Map((context.evidence||[]).map(item=>[item.ref,item]));
    list.replaceChildren();detail.replaceChildren();
    if (!items.rows.length) list.append(make('p','person360-muted','暂无机会候选。'));
    for (const row of items.rows) {
      const card=make('div','opportunity-candidate-row');
      const draft=row.draft||{};
      card.append(make('strong','',`${LABELS[draft.opportunity_type]||draft.opportunity_type||'机会'} · ${
        {draft:'待审核',previewed:'已预览',confirmed:'已确认',created:'已创建',rejected:'已拒绝'}[row.status]||row.status}`),
      make('p','',draft.reason||''),make('p','person360-muted',`下一步：${draft.next_action||''}`));
      if (row.status==='created') {
        card.append(make('p','person360-muted',`已创建正式机会 #${row.opportunity_id}。`));
      } else if (['draft','previewed'].includes(row.status)) {
        card.append(button('审核',()=>openReview(row)));
      }
      list.append(card);
    }
  }
  function openReview(row) {
    detail.replaceChildren();
    const form=make('form','person360-opportunity-form');
    form.append(make('h4','',`审核候选 #${row.id}`));
    const type=make('select');
    for(const [value,label] of Object.entries(LABELS)) {
      const option=make('option','',label);option.value=value;type.append(option);
    }
    type.value=row.draft.opportunity_type;
    const reason=make('textarea');reason.maxLength=1000;reason.value=row.draft.reason||'';
    const next=make('textarea');next.maxLength=500;next.value=row.draft.next_action||'';
    for(const [label,input] of [['机会类型',type],['判断依据（请核实）',reason],['建议下一步',next]]) {
      const field=make('label','person360-opportunity-field');
      field.append(make('span','',label),input);form.append(field);
    }
    const refs=make('div','opportunity-candidate-evidence');
    refs.append(make('strong','', '资料来源'));
    for(const ref of row.evidence||[]) {
      const item=evidence.get(ref);
      refs.append(make('p','person360-muted',item ?
        `${ref} · ${item.text}（${item.certainty}）` : `${ref} · 当前资料已变化，需重新分析`));
    }
    const message=make('p','person360-error');
    const actions=make('div','person360-row');
    const save=make('button','btn','保存修改');save.type='submit';
    actions.append(save,button('预览正式创建',async()=>{
      message.textContent='';
      try {
        if (type.value!==row.draft.opportunity_type || reason.value.trim()!==row.draft.reason ||
            next.value.trim()!==row.draft.next_action) {
          message.textContent='请先保存修改，再重新预览。';return;
        }
        const preview=await call('preview',{candidateId:row.id});
        const box=make('div','opportunity-candidate-preview');
        box.append(make('h4','', '正式创建预览'),
          make('p','',`对象：${preview.preview.person.displayName}`),
          make('p','',`机会：${LABELS[preview.preview.after.opportunity_type]}`),
          make('p','',`判断依据：${preview.preview.after.reason}`),
          make('p','',`下一步：${preview.preview.after.next_action}`),
          make('p','person360-muted',`来源 ${row.evidence.join('、')} · 有效至 ${new Date(preview.expiresAt).toLocaleString()}`));
        box.append(button('确认并创建正式机会',async()=>{
          if (!window.confirm('已核实资料与预览内容，确认创建这条正式 Opportunity？')) return;
          try {
            await call('confirm',{candidateId:row.id,previewHash:preview.previewHash});
            const outcome=await call('execute',{candidateId:row.id});
            message.textContent=outcome.status==='created'?'正式机会已创建。':'操作未完成';
            await refresh();
            if(outcome.status==='created'&&typeof onCreated==='function')onCreated();
          } catch(error) {message.textContent=`创建失败：${error.message}。请重新打开候选核对状态。`;}
        },'btn-primary'));
        detail.querySelector('.opportunity-candidate-preview')?.remove();
        detail.append(box);
      } catch(error) {message.textContent=`预览失败：${error.message}`;}
    },'btn-primary'),button('拒绝候选',async()=>{
      if (!window.confirm('确认拒绝该机会候选？不会修改正式机会。')) return;
      try {await call('reject',{candidateId:row.id});await refresh();}
      catch(error){message.textContent=`拒绝失败：${error.message}`;}
    }));
    form.append(refs,actions,message);
    form.addEventListener('submit',async event=>{
      event.preventDefault();message.textContent='';
      try {await call('edit',{candidateId:row.id,draft:{opportunity_type:type.value,
        reason:reason.value.trim(),next_action:next.value.trim()}});await refresh();}
      catch(error){message.textContent=`保存失败：${error.message}`;}
    });
    detail.append(form);
  }
  void refresh().catch(error=>{notice.textContent=`候选加载失败：${error.message}`;});
  return section;
}
