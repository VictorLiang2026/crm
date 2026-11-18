// Education review through the authenticated Assistant; business writes require server preview and confirmation.
import {h} from './dom.js';
import {t} from './i18n.js';
import {pageHead,card} from './ui.js';

export async function renderEducationBackfill(ctx) {
  let batchId=null,offset=0,busy=false,createPayload=null,peopleOffset=0,peopleRows=[];
  const selected=new Map(),undoSelected=new Set(),selectedPeople=new Set(),knownItems=new Map();
  const root=ctx.main,notice=h('p',{'aria-live':'polite'}),workspace=h('div',{}),review=h('div',{});
  const errors={EDUCATION_NOT_ENABLED:'edu_not_enabled',EDUCATION_SOURCE_CHANGED:'edu_stale',
    EDUCATION_EVIDENCE_STALE:'edu_stale',EDUCATION_PREVIEW_STALE:'edu_stale',EDUCATION_PREVIEW_EXPIRED:'edu_stale',
    EDUCATION_PLAN_REQUIRED:'edu_stale',EDUCATION_SCHOOL_MAJOR_CONFLICT:'edu_pair_conflict',
    EDUCATION_UNDO_CONFLICT:'edu_undo_conflict',EDUCATION_EMPTY_PATCH:'edu_empty_patch',
    EDUCATION_CONFIRMATION_REQUIRED:'edu_confirm_required'};
  function clear(){selected.clear();undoSelected.clear();knownItems.clear();review.replaceChildren();}
  async function call(operation,data={}){
    const res=await ctx.callFn('assistant',{action:'educationBackfill',operation,data});
    if(!res?.ok)throw Error(res?.error?.code||'EDUCATION_REQUEST_FAILED');return res;
  }
  async function run(fn){
    if(busy)return;busy=true;root.querySelectorAll('button,select,input,textarea').forEach(n=>{n.dataset.eduDisabled=n.disabled?'1':'0';n.disabled=true;});
    try{notice.textContent='';notice.removeAttribute('title');await fn();}
    catch(e){notice.textContent=t(errors[e.message]||'edu_uncertain');notice.title=String(e.message).slice(0,120);}
    finally{busy=false;root.querySelectorAll('[data-edu-disabled]').forEach(n=>{n.disabled=n.dataset.eduDisabled==='1';delete n.dataset.eduDisabled;});}
  }
  const button=(key,fn,extra={})=>h('button',{type:'button',class:'btn btn-soft',...extra,onclick:()=>run(fn)},t(key));
  const scope=h('select',{class:'sheet-input','aria-label':t('edu_cohort_mode'),onchange:()=>{
    if(scope.value==='search'&&!peopleRows.length)run(()=>searchPeople(0));
  }},[
    h('option',{value:'recent_created'},t('edu_cohort_recent')),
    h('option',{value:'recent_updated'},t('edu_cohort_recent_updated')),
    h('option',{value:'search'},t('edu_cohort_search')),h('option',{value:'all'},t('edu_cohort_all'))]);
  const sampleSize=h('input',{class:'sheet-input',type:'number',min:1,max:1500,value:50,'aria-label':t('edu_sample_size')});
  const sampleLabel=h('span',{},t('edu_sample_size')),sampleField=h('label',{},[sampleLabel,sampleSize]);
  const budget=h('input',{class:'sheet-input',type:'number',min:1,max:5000,value:200,'aria-label':t('edu_budget')});
  const query=h('input',{class:'sheet-input',type:'search',maxlength:100,placeholder:t('edu_search_placeholder'),'aria-label':t('edu_search_placeholder')});
  const peopleList=h('div',{class:'edu-people-list'}),peopleSummary=h('p',{class:'row-sub'});
  const peoplePanel=h('div',{class:'edu-people-panel',hidden:true},[
    h('div',{class:'edu-search-row'},[query,button('edu_search',async()=>searchPeople(0))]),peopleSummary,peopleList]);
  const picker=h('select',{class:'sheet-input','aria-label':t('edu_batch'),onchange:()=>{
    if(busy)return;batchId=picker.value||null;offset=0;clear();run(refresh);
  }});
  async function batches(){
    const res=await call('batches');
    picker.replaceChildren(...res.batches.map(b=>h('option',{value:b.id},
      `${new Date(b.created_at).toLocaleString()} · ${t('edu_status_'+b.status)}`)));
    batchId=batchId||res.batches[0]?.id||null;picker.value=batchId||'';
  }
  function renderPeople(){
    const rows=peopleRows.map(person=>{
      const id=String(person.person_id),box=h('input',{type:'checkbox',checked:selectedPeople.has(id),onchange:()=>{
        if(box.checked&&!selectedPeople.has(id)&&selectedPeople.size>=1500){box.checked=false;notice.textContent=t('edu_selection_limit');return;}
        box.checked?selectedPeople.add(id):selectedPeople.delete(id);peopleSummary.textContent=t('edu_selected_count').replace('{count}',String(selectedPeople.size));
      }});
      return h('label',{class:'edu-person-option'},[box,h('span',{},[
        h('b',{},`${person.display_name||t('edu_unknown_person')} · #${id}`),
        h('small',{},`${t('edu_created_at')}: ${person.created_at?new Date(person.created_at).toLocaleDateString():t('edu_empty')}`),
        h('small',{},`${t('edu_school')}: ${person.graduation_school||t('edu_empty')} · ${t('edu_major')}: ${person.department_or_major||t('edu_empty')}`)
      ])]);
    });
    if(!rows.length)peopleList.replaceChildren(h('p',{class:'foot-note'},t('edu_search_empty')));
    else peopleList.replaceChildren(...rows);
    const pager=h('div',{class:'head-actions'},[
      peopleOffset?button('edu_search_previous',async()=>searchPeople(Math.max(0,peopleOffset-50))):null,
      peopleRows.length===50?button('edu_search_next',async()=>searchPeople(peopleOffset+50)):null]);
    peopleList.appendChild(pager);peopleSummary.textContent=t('edu_selected_count').replace('{count}',String(selectedPeople.size));
  }
  async function searchPeople(nextOffset){
    peopleOffset=nextOffset;const res=await call('people',{query:query.value.trim(),offset:peopleOffset});peopleRows=res.people||[];renderPeople();
  }
  const hasValue=value=>typeof value==='string'&&value.trim()!=='';
  const schoolAliases=new Map([['北大','北京大学'],['清华','清华大学'],['复旦','复旦大学'],['上交','上海交通大学'],['上海交大','上海交通大学'],['西安交大','西安交通大学'],['浙大','浙江大学'],['中科大','中国科学技术大学']]);
  const norm=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ');
  const same=(a,b,field)=>{
    if(!hasValue(a)||!hasValue(b))return false;
    const left=norm(a),right=norm(b);
    return (field==='school'?(schoolAliases.get(left)||left):left)===(field==='school'?(schoolAliases.get(right)||right):right);
  };
  function nameWarning(field,value){
    if(!hasValue(value))return false;
    const v=value.trim();
    if(v.length<2||v.length>64||/[\r\n。！？!?；;]/.test(v))return true;
    if(field==='school')return !/(大学|学院|学校|学堂|研究院|University|College|Institute|School)/i.test(v);
    return !/(学|管理|工程|科学|教育|医学|文学|法学|经济|艺术|语言|设计|传媒|会计|金融|技术|哲学|历史|数学|物理|化学|生物|护理|建筑|Agriculture|Engineering|Science|Business|Education|Medicine|Arts|Law|History|Mathematics|Physics)/i.test(v);
  }
  function initialDecision(item,candidate,index){
    const fields={};
    for(const [key,value,old] of [['school',candidate.school,item.graduation_school],['major',candidate.major,item.department_or_major]]){
      fields[`${key}Action`]=hasValue(value)&&!same(value,old,key)?(hasValue(old)?'keep':'candidate'):'keep';
      fields[`${key}Value`]=hasValue(old)?old:'';
    }
    return {itemId:item.id,candidateIndex:index,...fields};
  }
  function activeState(item,candidate,index){
    let state=selected.get(item.id);
    if(state&&state.candidateIndex===index)return state;
    state=initialDecision(item,candidate,index);selected.set(item.id,state);return state;
  }
  function fieldControl(item,candidate,state,key,label,candidateValue,oldValue,eligible){
    const actionKey=`${key}Action`,valueKey=`${key}Value`,equal=same(candidateValue,oldValue,key),changed=hasValue(oldValue)&&hasValue(candidateValue)&&!equal;
    const warning=nameWarning(key,candidateValue);
    const action=state?.[actionKey]||'keep';
    const options=[h('option',{value:'keep',selected:action==='keep'},t(equal?'edu_unchanged':'edu_keep'))];
    if(hasValue(candidateValue)&&!equal)options.push(h('option',{value:'candidate',selected:action==='candidate'},t('edu_use_candidate')));
    options.push(h('option',{value:'manual',selected:action==='manual'},t('edu_manual_edit')));
    const select=h('select',{class:'sheet-input','aria-label':`${label} · ${t('edu_field_action')}`,disabled:!eligible,
      onchange:()=>{state[actionKey]=select.value;if(select.value==='manual'&&!hasValue(state[valueKey]))state[valueKey]=oldValue||'';renderItems();}},options);
    const manual=action==='manual'?h('input',{class:'sheet-input edu-manual-value',type:'text',maxlength:160,value:state[valueKey]||'',
      'aria-label':`${label} · ${t('edu_manual_edit')}`,disabled:!eligible,oninput:()=>{state[valueKey]=manual.value;review.replaceChildren();}}):null;
    return h('div',{class:'edu-field'},[
      h('b',{},label),h('p',{class:'edu-current'},[h('span',{},`${t('edu_current_value')}: `),h('strong',{class:changed?'edu-value-changed':'edu-value-normal'},oldValue||t('edu_empty'))]),
      h('p',{class:'edu-candidate'},[h('span',{},`${t('edu_candidate_value')}: `),h('strong',{class:equal?'edu-value-equal':changed?'edu-value-changed':'edu-value-normal'},candidateValue||t('edu_no_candidate')),
        equal?h('small',{class:'edu-match-tag'},t('edu_unchanged')):null]),
      warning?h('p',{class:'edu-warning',role:'status'},t(key==='school'?'edu_school_name_warning':'edu_major_name_warning')):null,
      select,manual]);
  }
  let lastStatus=null;
  function renderItems(){
    if(!lastStatus)return;
    const {items,counts,batch}=lastStatus;
    for(const item of items)knownItems.set(item.id,item);
    const nodes=[h('p',{},`${t('edu_status_'+batch.status)} · ${t('edu_attempt_progress')}: ${batch.calls_used}/${batch.max_calls}`),
      h('p',{class:'row-sub'},Object.entries(counts).map(([s,n])=>`${t('edu_status_'+s)} ${n} `))];
    for(const item of items){
      const body=[h('a',{href:`#/person/${item.person_id}`},item.display_name||String(item.person_id)),
        h('p',{class:'row-sub'},`${t('edu_status_'+item.status)} · ${t('edu_created_at')}: ${item.created_at?new Date(item.created_at).toLocaleDateString():t('edu_empty')}`),
        h('p',{class:'edu-existing-values'},`${t('edu_current_value')} · ${t('edu_school')}: ${item.graduation_school||t('edu_empty')} · ${t('edu_major')}: ${item.department_or_major||t('edu_empty')}`)];
      if(item.error_code)body.push(h('p',{class:'foot-note',title:item.error_code},
        t(item.error_code==='EDUCATION_SOURCE_TOO_LARGE'?'edu_source_large':'edu_scan_failed')));
      if(item.status==='failed')body.push(button('edu_retry',async()=>{await call('retry',{batchId,itemId:item.id});await refresh();}));
      if(['ready','needs_review','failed','no_evidence'].includes(item.status))body.push(button('edu_skip',async()=>{
        await call('skip',{batchId,itemId:item.id});await refresh();
      }));
      if(item.status==='applied'){
        const box=h('input',{type:'checkbox',checked:undoSelected.has(item.id),onchange:()=>{box.checked?undoSelected.add(item.id):undoSelected.delete(item.id);renderItems();}});
        body.push(h('label',{class:'edu-undo-option'},[box,t('edu_undo_select')]));
      }
      const candidates=item.result?.candidates||[];
      if(['ready','needs_review'].includes(item.status))for(const [index,c]of candidates.entries()){
        const eligible=(hasValue(c.school)||hasValue(c.major))&&Array.isArray(c.evidence)&&c.evidence.length>0;
        const needsAttributionReview=c.relationship!=='self'||c.ambiguous!==false;
        const auto=candidates.length===1&&eligible&&!needsAttributionReview;
        const state=auto?activeState(item,c,index):selected.get(item.id);
        const checked=state?.candidateIndex===index;
        const choose=h('input',{type:'radio',name:`edu-${item.id}`,checked,disabled:!eligible,'aria-label':t('edu_select'),onchange:()=>{
          if(choose.checked){const next=initialDecision(item,c,index);selected.set(item.id,next);review.replaceChildren();renderItems();}
        }});
        body.push(card({title:`${t('edu_episode')} ${index+1}`,body:[
          h('label',{class:'edu-episode-choice'},[choose,t('edu_select')]),
          !eligible?h('p',{class:'edu-blocked',role:'status'},t('edu_ineligible')):null,
          eligible&&needsAttributionReview?h('p',{class:'edu-warning',role:'status'},t('edu_attribution_review')):null,
          h('div',{class:'edu-field-grid'},[
            fieldControl(item,c,checked?state:null,'school',t('edu_school'),c.school,item.graduation_school,checked&&eligible),
            fieldControl(item,c,checked?state:null,'major',t('edu_major'),c.major,item.department_or_major,checked&&eligible)
          ]),
          h('details',{},[h('summary',{},t('edu_evidence')),...(c.evidence||[]).map(e=>h('div',{},[
            h('p',{class:'row-sub'},`public.${e.table} #${e.id} · ${e.field} · ${e.updatedAt||''}`),h('blockquote',{style:'overflow-wrap:anywhere;white-space:pre-wrap'},e.quote)]))])
        ]}));
      }
      nodes.push(card({body}));
    }
    if(!items.length)nodes.push(h('p',{},t('edu_no_rows')));
    const footer=[offset?button('edu_previous',async()=>{offset=Math.max(0,offset-50);await refresh();}):null,
      items.length===50?button('edu_next',async()=>{offset+=50;await refresh();}):null];
    if([...selected.values()].some(row=>row.schoolAction!=='keep'||row.majorAction!=='keep'))footer.push(button('edu_plan',()=>makePlan('apply')));
    if(undoSelected.size)footer.push(button('edu_undo_plan',()=>makePlan('undo')));
    nodes.push(h('div',{class:'head-actions'},footer));workspace.replaceChildren(...nodes);
  }
  async function refresh(){
    review.replaceChildren();if(!batchId){workspace.replaceChildren(h('p',{},t('edu_no_rows')));return;}
    lastStatus=await call('status',{batchId,offset});for(const item of lastStatus.items||[])knownItems.set(item.id,item);renderItems();
  }
  function previewRow(r){
    const entries=[['graduation_school','edu_school'],['department_or_major','edu_major']].filter(([key])=>Object.hasOwn(r.patch||{},key));
    return card({title:r.displayName,body:[
      ...entries.map(([key,label])=>h('p',{class:'edu-preview-field'},`${t(label)}: ${r.before[key]||t('edu_empty')} → ${r.patch[key]||t('edu_empty')}${r.fieldActions?.[key==='graduation_school'?'school':'major']==='manual'?` · ${t('edu_manual_edit')}`:''}`)),
      h('p',{class:'row-sub'},`${t('edu_evidence')}: ${(r.candidate?.evidence||[]).map(e=>e.quote).join('；')}`)
    ]});
  }
  async function showPreview(currentBatch,kind,rows){
    const plan=await call('plan',{batchId:currentBatch,kind});
    const v=await call(kind==='apply'?'preview':'undoPreview',{batchId:currentBatch,planId:plan.planId,rows});
    review.replaceChildren(h('h3',{},t(kind==='apply'?'edu_preview_title':'edu_undo_preview_title')),
      h('p',{class:'edu-warning'},t('edu_plan_note')),...v.rows.map(previewRow),h('p',{class:'foot-note'},`${t('edu_expires')}: ${v.expiresAt}`),
      button('edu_confirm',async()=>{
        const confirmation=await call('confirm',{batchId:currentBatch,previewId:v.previewId});
        await call('execute',{batchId:currentBatch,previewId:v.previewId,confirmationToken:confirmation.confirmationToken});
        selected.clear();undoSelected.clear();await refresh();notice.textContent=t(kind==='apply'?'edu_applied':'edu_undone');
      }),button('edu_cancel',()=>review.replaceChildren()));
    review.scrollIntoView({block:'start',behavior:'smooth'});
  }
  async function makePlan(kind){
    const currentBatch=batchId;
    if(kind==='undo'){
      const rows=[...undoSelected].map(itemId=>({itemId}));if(!rows.length){notice.textContent=t('edu_no_selection');return;}
      await showPreview(currentBatch,kind,rows);return;
    }
    const rows=[...selected.values()].map(state=>{
      const item=knownItems.get(state.itemId);if(!item)return null;
      let schoolAction=state.schoolAction,majorAction=state.majorAction;
      if(schoolAction==='candidate'&&same(item.graduation_school,item.result?.candidates?.[state.candidateIndex]?.school,'school'))schoolAction='keep';
      if(majorAction==='candidate'&&same(item.department_or_major,item.result?.candidates?.[state.candidateIndex]?.major,'major'))majorAction='keep';
      if(schoolAction==='manual'&&same(item.graduation_school,state.schoolValue,'school'))schoolAction='keep';
      if(majorAction==='manual'&&same(item.department_or_major,state.majorValue,'major'))majorAction='keep';
      if(schoolAction==='keep'&&majorAction==='keep')return null;
      return {itemId:state.itemId,candidateIndex:state.candidateIndex,schoolAction,majorAction,
        ...(schoolAction==='manual'?{schoolValue:state.schoolValue.trim()}:{}),...(majorAction==='manual'?{majorValue:state.majorValue.trim()}:{})};
    }).filter(Boolean);
    if(!rows.length){notice.textContent=t('edu_no_selection');return;}
    await showPreview(currentBatch,kind,rows);
  }
  const create=button('edu_create',async()=>{
    if(!createPayload){
      if(!Number.isInteger(Number(budget.value))||Number(budget.value)<1||Number(budget.value)>5000){notice.textContent=t('edu_invalid_budget');return;}
      const mode=scope.value,request={requestKey:crypto.randomUUID(),maxCalls:Number(budget.value)};
      if(mode==='recent_created'||mode==='recent_updated'){
        if(!Number.isInteger(Number(sampleSize.value))||Number(sampleSize.value)<1||Number(sampleSize.value)>1500){notice.textContent=t('edu_invalid_sample_size');return;}
        request.sampleSize=Number(sampleSize.value);request.selectionMode=mode;
      }else if(mode==='search'){
        if(!selectedPeople.size){notice.textContent=t('edu_no_people_selected');return;}
        request.personIds=[...selectedPeople];request.selectionMode='selected';
      }else request.selectionMode='all';
      createPayload=request;
    }
    const created=await call('create',createPayload);createPayload=null;batchId=created.batchId;offset=0;clear();
    await batches();await refresh();notice.textContent=t('edu_batch_created');
  });
  function updateCohortMode(){
    const recent=['recent_created','recent_updated'].includes(scope.value);
    sampleField.hidden=!recent;sampleSize.hidden=false;
    sampleLabel.textContent=t(scope.value==='recent_updated'?'edu_sample_size_updated':'edu_sample_size');
    sampleSize.setAttribute('aria-label',sampleLabel.textContent);
    peoplePanel.hidden=scope.value!=='search';
  }
  scope.onchange=()=>{updateCohortMode();if(scope.value==='search'&&!peopleRows.length)run(()=>searchPeople(0));};
  const createPanel=card({body:[scope,sampleField,h('label',{},[t('edu_budget'),budget]),peoplePanel,create]});
  root.replaceChildren(pageHead({title:t('edu_title'),sub:t('edu_intro')}),notice,createPanel,
    card({body:[picker,h('div',{class:'head-actions'},[
      button('edu_refresh',async()=>{await batches();await refresh();}),
      button('edu_pause',async()=>{if(batchId){await call('pause',{batchId});await refresh();}}),
      button('edu_resume',async()=>{if(batchId){await call('resume',{batchId});await refresh();}})
    ])]}),workspace,review);
  updateCohortMode();await run(async()=>{await batches();await refresh();});
}
