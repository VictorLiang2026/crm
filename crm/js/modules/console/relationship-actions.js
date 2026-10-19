import { h } from './dom.js';
import { data } from './data.js';
import { t } from './i18n.js';
import { bdg, emptyNote } from './ui.js';

const TYPES=['family','friend','colleague','business','referral','other'];
function nonce(){return window.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`;}
const typeLabel=value=>t(`relationship_type_${value}`);
function field(label,control){return h('div',{class:'sheet-field'},[h('label',{},label),control]);}
function select(options,value){const el=h('select',{class:'sheet-select'});options.forEach(([v,label])=>el.append(h('option',{value:v,selected:String(v)===String(value)},label)));return el;}

function lifecyclePreviewMessage(operation, personId, payload, response){
  const review=response?.preview||{}, before=review.before||{}, after=review.after||{};
  const edgeId=String(before.relationshipId||''), fromId=String(review.fromPersonId||''), toId=String(review.toPersonId||'');
  const unchanged=['fromPersonId','toPersonId','relationshipType','relationshipStage','strength','trustLevel','trend','importance','source','status'];
  const valid=Boolean(response?.previewId&&review.humanConfirmationRequired===true&&
    edgeId===String(payload.relationshipId)&&String(review.personId)===String(personId)&&
    fromId===String(before.fromPersonId)&&toId===String(before.toPersonId)&&
    fromId===String(after.fromPersonId)&&toId===String(after.toPersonId)&&
    (fromId===String(personId)||toId===String(personId))&&
    String(review.fromPersonName||'').trim()&&String(review.toPersonName||'').trim()&&
    ['confirmed','pending'].includes(before.status)&&TYPES.includes(before.relationshipType)&&
    unchanged.every(key=>JSON.stringify(before[key]??null)===JSON.stringify(after[key]??null))&&
    (operation==='unlink' ? before.deletedAt==null&&after.deleted===true :
      before.deletedAt!=null&&after.deleted===false));
  if(!valid)throw new Error(t('relationship_preview_invalid'));
  const state=deleted=>`${t(`relationship_${before.status}`)} · ${t(deleted?'relationship_unlinked':'relationship_active')}`;
  return [
    t('relationship_review_required'),
    `${t(operation==='unlink'?'relationship_unlink':'relationship_restore')} · ${t('relationship_record')} #${edgeId}`,
    `${t('relationship_from_person')}: ${review.fromPersonName} · Person #${fromId}`,
    `${t('relationship_to_person')}: ${review.toPersonName} · Person #${toId}`,
    `${t('relationship_type')}: ${typeLabel(before.relationshipType)}`,
    `${t('relationship_stage')}: ${before.relationshipStage||t('relationship_no_stage')}`,
    `${t('relationship_importance')}: ${before.importance??t('relationship_unrated')}`,
    `${t('relationship_before')}: ${state(before.deletedAt!=null)}`,
    `${t('relationship_after')}: ${state(after.deleted)}`,
    t(operation==='unlink'?'relationship_unlink_scope':'relationship_restore_scope'),
  ].join('\n');
}

export async function relationshipNode(ctx,personId){
  let includeDeleted=false;
  const root=h('div',{class:'tab-stack'});
  const notice=h('p',{class:'sheet-note'},t('relationship_scope_note'));
  const controls=h('div',{class:'stack-head'});
  const createBtn=h('button',{class:'btn btn-soft btn-sm',type:'button'},t('relationship_add'));
  const trashToggle=h('label',{class:'people-filter-check'},[
    h('input',{type:'checkbox',onchange:()=>{includeDeleted=trashToggle.querySelector('input').checked;void refresh();}}),t('relationship_show_unlinked')]);
  controls.append(createBtn,trashToggle);
  const formHost=h('div',{}),list=h('div',{});
  root.append(notice,controls,formHost,list);

  async function reviewed(operation,payload,summary){
    const preview=await data.previewRelationship(ctx,String(personId),operation,{...payload,idempotencyKey:nonce()});
    const review=preview.preview||{};
    const endpoints=review.fromPersonName&&review.toPersonName?`\n${review.fromPersonName} → ${review.toPersonName}`:'';
    const detail=operation==='unlink'||operation==='restore'
      ? lifecyclePreviewMessage(operation,personId,payload,preview)
      : `${t('relationship_review_required')}\n${summary}${endpoints}\n${t('relationship_before')}: ${JSON.stringify(review.before||{})}\n${t('relationship_after')}: ${JSON.stringify(review.after||{})}`;
    if(!window.confirm(detail))return false;
    await data.executeRelationship(ctx,preview.previewId);
    ctx.onWriteDone?.();
    return true;
  }

  function startCreate(){
    const name=h('input',{class:'sheet-input',type:'text',maxlength:'120',placeholder:t('relationship_person_name')});
    const direction=select([['outgoing',t('relationship_direction_outgoing_option')],['incoming',t('relationship_direction_incoming_option')]],'outgoing');
    const kind=select(TYPES.map(x=>[x,typeLabel(x)]),'friend');
    const stage=h('input',{class:'sheet-input',type:'text',maxlength:'80',placeholder:t('relationship_stage')});
    const strength=h('input',{class:'sheet-input',type:'text',maxlength:'40',placeholder:t('relationship_strength')});
    const importance=select([['',t('relationship_unrated')],...[1,2,3,4,5].map(x=>[x,String(x)])],'');
    const result=h('div',{}),error=h('p',{class:'form-msg error'});
    const resolve=h('button',{class:'btn btn-dark btn-sm',type:'button'},t('relationship_resolve'));
    const cancel=h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:()=>formHost.replaceChildren()},t('btn_cancel'));
    resolve.onclick=async()=>{
      error.textContent='';result.replaceChildren();resolve.disabled=true;
      try{
        const identity=await data.resolveRelationshipName(ctx,name.value);
        if(!identity.candidates?.length){error.textContent=t('relationship_no_match');return;}
        identity.candidates.forEach(candidate=>result.append(h('button',{class:'btn btn-ghost btn-sm',type:'button',style:'margin:4px',
          onclick:async()=>{try{await reviewed('create',{otherPersonId:candidate.id,otherName:candidate.displayName,direction:direction.value,
            relationshipType:kind.value,relationshipStage:stage.value||null,strength:strength.value||null,importance:importance.value?Number(importance.value):null,source:'manual'},candidate.displayName);}catch(e){error.textContent=`${t('relationship_save_failed')}: ${e.message}`;}}},
          `${candidate.displayName} · #${candidate.id}${candidate.customerId?` · ${t('badge_customer_linked')}`:''}`)));
        if(identity.hasMore)error.textContent=t('relationship_candidates_limited');
      }catch(e){error.textContent=`${t('relationship_resolve_failed')}: ${e.message}`;}
      finally{resolve.disabled=false;}
    };
    formHost.replaceChildren(h('div',{class:'card person-relationship-editor'},[
      h('div',{class:'card-body'},[
        h('h3',{},t('relationship_add')),field(t('relationship_person_name'),name),field(t('relationship_direction'),direction),
        field(t('relationship_type'),kind),field(t('relationship_stage'),stage),field(t('relationship_strength'),strength),
        field(t('relationship_importance'),importance),h('div',{class:'sheet-actions'},[resolve,cancel]),error,result,
      ]),
    ]));
  }
  createBtn.onclick=startCreate;

  function renderRow(row){
    const peer=row.other_name||t('relationship_person_unavailable');
    const deleted=Boolean(row.deleted_at);
    const summary=[`${t(`relationship_direction_${row.direction}`)} · ${peer}`,typeLabel(row.relationship_type),
      row.relationship_stage||t('relationship_no_stage'),row.strength||t('relationship_no_strength'),
      row.importance==null?t('relationship_unrated'):`${t('relationship_importance')} ${row.importance}/5`];
    const ops=[];
    if(deleted)ops.push(h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:async()=>{try{await reviewed('restore',{relationshipId:row.id},peer);}catch(e){window.alert(`${t('relationship_save_failed')}: ${e.message}`);}}},t('relationship_restore')));
    else{
      if(row.status!=='confirmed')ops.push(h('button',{class:'btn btn-soft btn-sm',type:'button',onclick:async()=>{try{await reviewed('confirm',{relationshipId:row.id},peer);}catch(e){window.alert(`${t('relationship_save_failed')}: ${e.message}`);}}},t('relationship_confirm')));
      ops.push(h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:()=>edit(row,peer)},t('btn_edit')));
      ops.push(h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:async()=>{try{await reviewed('unlink',{relationshipId:row.id},peer);}catch(e){window.alert(`${t('relationship_save_failed')}: ${e.message}`);}}},t('relationship_unlink')));
    }
    return h('article',{class:'list-row'},[
      h('div',{style:'flex:1;min-width:0'},[
        h('div',{class:'row-title'},summary[0]),h('div',{class:'row-sub'},`${summary[1]} · ${t('relationship_strength')}: ${summary[3]} · ${summary[4]}`),
        h('div',{class:'row-sub'},`${t('relationship_stage')}: ${summary[2]} · ${t('relationship_source')}: ${t(`relationship_source_${row.source}`)||row.source||'—'}`),
        h('div',{class:'row-sub'},`${t('relationship_status')}: ${deleted?t('relationship_unlinked'):row.status==='confirmed'?t('relationship_confirmed'):t('relationship_pending')}${row.confirmed_at?` · ${String(row.confirmed_at).slice(0,10)}`:''}`),
        h('div',{class:'sheet-actions',style:'justify-content:flex-start;margin-top:7px'},ops),
      ]),bdg(deleted?t('relationship_unlinked'):row.status==='confirmed'?t('relationship_confirmed'):t('relationship_pending'),deleted?'gray':row.status==='confirmed'?'jade':'gold'),
    ]);
  }
  function edit(row,peer){
    const kind=select(TYPES.map(x=>[x,typeLabel(x)]),row.relationship_type);
    const stage=h('input',{class:'sheet-input',type:'text',maxlength:'80',value:row.relationship_stage||''});
    const strength=h('input',{class:'sheet-input',type:'text',maxlength:'40',value:row.strength||''});
    const importance=select([['',t('relationship_unrated')],...[1,2,3,4,5].map(x=>[x,String(x)])],row.importance??'');
    const error=h('p',{class:'form-msg error'});
    const save=h('button',{class:'btn btn-primary btn-sm',type:'button'},t('btn_save'));
    save.onclick=async()=>{save.disabled=true;try{await reviewed('update',{relationshipId:row.id,relationshipType:kind.value,relationshipStage:stage.value||null,
      strength:strength.value||null,importance:importance.value?Number(importance.value):null},peer);formHost.replaceChildren();}catch(e){error.textContent=`${t('relationship_save_failed')}: ${e.message}`;}finally{save.disabled=false;}};
    const cancel=h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:()=>formHost.replaceChildren()},t('btn_cancel'));
    formHost.replaceChildren(h('div',{class:'card person-relationship-editor card-body'},[
      h('h3',{},`${t('relationship_edit')} · ${peer}`),field(t('relationship_type'),kind),field(t('relationship_stage'),stage),
      field(t('relationship_strength'),strength),field(t('relationship_importance'),importance),h('div',{class:'sheet-actions'},[save,cancel]),error,
    ]));
  }
  async function refresh(){
    list.replaceChildren(h('p',{class:'muted'},t('loading')));
    try{
      const result=await data.relationships(ctx,String(personId),includeDeleted);
      const rows=result.rows||[];
      list.replaceChildren(...(rows.length?rows.map(renderRow):[emptyNote(t('relationship_empty'),t('relationship_empty_note'))]));
    }catch(error){list.replaceChildren(emptyNote(t('data_load_failed'),error.message||t('try_later')));}
  }
  await refresh();
  return root;
}
