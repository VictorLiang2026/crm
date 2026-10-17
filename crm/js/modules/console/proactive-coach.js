import { h } from './dom.js';
import { ic } from './icons.js';
import { data } from './data.js';
import { t } from './i18n.js';
import { bdg, card, emptyNote, avatar } from './ui.js';
import { openSheet } from './write.js';

function dateLabel(value) {
  const date=new Date(value||'');
  if (!Number.isFinite(date.getTime())) return t('pc30_unknown_time');
  return new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric'}).format(date);
}

function reason(candidate) {
  const values=candidate.data||{};
  const messages={
    commitment_due:t('pc30_commitment_reason'),
    relationship_decay:t('pc30_relationship_decay_reason'),
    relationship_changed:t('pc30_relationship_changed_reason'),
    activity_followup:t('pc30_activity_reason'),
    recruit_stagnation:t('pc30_recruit_reason'),
  };
  const text=messages[candidate.type]||'';
  const args={due:dateLabel(values.dueAt),elapsed:String(values.elapsed_days??'—'),cadence:String(values.cadence_days??'—'),
    days:String(values.idleDays??'—'),activity:String(values.activityName||candidate.title||''),
    activityDate:dateLabel(values.activityDate),updated:dateLabel(values.updatedAt),stage:String(values.stage||'—')};
  return text.replace(/\{([A-Za-z]+)\}/g,(_,key)=>args[key]??'');
}

function sourceTag(candidate) {
  const label={
    commitment_due:t('pc30_commitment'),relationship_decay:t('pc30_relationship_decay'),
    relationship_changed:t('pc30_relationship_changed'),activity_followup:t('pc30_activity_followup'),
    recruit_stagnation:t('pc30_recruit_stagnation'),
  };
  return label[candidate.type]||t('pc30_candidate');
}

function resultObject(value) { return Array.isArray(value)?value[0]||{}:value||{}; }

function localizedDraft(candidate) {
  const source=candidate.actionDraft||{};
  if (typeof source.title==='string') return {title:source.title,description:source.description||'',
    priority:source.priority,dueAt:source.dueAt};
  const values=source.templateArgs||{};
  const fill=key=>t(key).replace(/\{([A-Za-z]+)\}/g,(_,name)=>String(values[name]??'—'));
  return {title:fill(source.titleKey),description:fill(source.descriptionKey),
    priority:source.priority,dueAt:source.dueAt};
}

function openCandidateAction(ctx,candidate,onDone) {
  const draft=localizedDraft(candidate);
  const body=h('div',{},[
    h('p',{class:'sheet-note'},t('pc30_preview_intro')),
    h('div',{class:'preview-block'},[
      h('div',{class:'kv-line'},[h('span',{class:'kv-k'},t('person')),h('span',{class:'kv-v'},`${candidate.personName} · #${candidate.personId}`)]),
      h('div',{class:'kv-line'},[h('span',{class:'kv-k'},t('pc30_source')),h('span',{class:'kv-v'},candidate.source)]),
      h('div',{class:'sheet-preview-label'},t('pc30_action_after')),
      h('div',{class:'kv-line'},[h('span',{class:'kv-k'},t('field_title')),h('span',{class:'kv-v'},draft.title)]),
      h('div',{class:'kv-line'},[h('span',{class:'kv-k'},t('field_description')),h('span',{class:'kv-v'},draft.description)]),
      h('div',{class:'kv-line'},[h('span',{class:'kv-k'},t('field_due')),h('span',{class:'kv-v'},dateLabel(draft.dueAt))]),
      h('div',{class:'sheet-note'},t('pc30_action_human_note')),
    ]),
    h('div',{class:'sheet-actions'},[
      h('button',{class:'btn btn-ghost',type:'button',onclick:()=>sheet.overlay.remove()},t('cancel')),
      h('button',{class:'btn btn-primary',type:'button',onclick:event=>preview(event.currentTarget)},t('pc30_get_preview')),
    ]),
  ]);
  const sheet=openSheet({title:t('pc30_action_preview_title'),sub:t('work_version_binding'),body});
  document.body.appendChild(sheet.overlay);

  async function preview(button) {
    button.disabled=true;
    try {
      const value=await data.previewWorkItem(ctx,{idempotencyKey:candidate.candidateKey,kind:'action',operation:'create',
        personId:String(candidate.personId),itemId:null,draft});
      const result=resultObject(value),pv=result.preview||{};
      sheet.swap(h('div',{},[
        h('p',{class:'sheet-note'},t('pc30_preview_verified')),
        h('div',{class:'preview-block'},[
          h('div',{class:'kv-line'},[h('span',{class:'kv-k'},t('person')),h('span',{class:'kv-v'},`${pv.personName||candidate.personName} · #${pv.personId||candidate.personId}`)]),
          h('div',{class:'kv-line'},[h('span',{class:'kv-k'},t('pc30_source')),h('span',{class:'kv-v'},candidate.source)]),
          h('div',{class:'sheet-preview-label'},t('pc30_action_after')),
          h('div',{class:'kv-line'},[h('span',{class:'kv-k'},t('field_title')),h('span',{class:'kv-v'},pv.after?.title||draft.title)]),
          h('div',{class:'kv-line'},[h('span',{class:'kv-k'},t('field_description')),h('span',{class:'kv-v'},pv.after?.description||draft.description)]),
          h('div',{class:'kv-line'},[h('span',{class:'kv-k'},t('field_due')),h('span',{class:'kv-v'},dateLabel(pv.after?.dueAt||draft.dueAt))]),
          result.expiresAt?h('div',{class:'sheet-note'},`${t('preview_valid_until')} ${dateLabel(result.expiresAt)}`):null,
          h('div',{class:'sheet-note'},t('pc30_action_human_note')),
        ]),
        h('div',{class:'sheet-actions'},[
          h('button',{class:'btn btn-ghost',type:'button',onclick:()=>sheet.swap(body)},t('cancel')),
          h('button',{class:'btn btn-primary',type:'button',onclick:event=>execute(event.currentTarget,result.previewId)},t('pc30_confirm_action')),
        ]),
      ]));
    } catch(error) { button.disabled=false; sheet.showErr(error.message||t('pc30_preview_failed')); }
  }

  async function execute(button,previewId) {
    button.disabled=true;
    try {
      const saved=resultObject(await data.executeWorkItem(ctx,previewId));
      const actionId=saved.itemId||saved.item?.id;
      if (!actionId) throw new Error(t('pc30_action_saved_unverified'));
      await data.decideProactiveCoachCandidate(ctx,{candidateKey:candidate.candidateKey,personId:String(candidate.personId),
        sourceType:candidate.sourceType,sourceId:String(candidate.sourceId),decision:'action_created',actionId:String(actionId)});
      sheet.overlay.remove();
      ctx.toast(t(saved.replayed?'work_item_replayed':'work_item_saved'),'ok');
      onDone?.();
    } catch(error) { button.disabled=false; sheet.showErr(error.message||t('pc30_action_failed')); }
  }
}

async function saveDecision(ctx,candidate,decision,onDone,button,snoozeDays) {
  button.disabled=true;
  try {
    await data.decideProactiveCoachCandidate(ctx,{candidateKey:candidate.candidateKey,personId:String(candidate.personId),
      sourceType:candidate.sourceType,sourceId:String(candidate.sourceId),decision,
      ...(decision==='deferred'?{snoozeDays}: {})});
    ctx.toast(t(decision==='deferred'?'pc30_deferred':'pc30_rejected'),'ok');
    onDone?.();
  } catch(error) { button.disabled=false; ctx.toast(error.message||t('pc30_decision_failed'),'error'); }
}

export async function renderProactiveCoach(ctx,{onDone}={}) {
  const result=await data.proactiveCoachCandidates(ctx);
  const candidates=Array.isArray(result.candidates)?result.candidates:[];
  const body=candidates.length?candidates.map(candidate=>h('div',{class:'list-row'},[
    avatar(candidate.personName,true),
    h('div',{style:'flex:1;min-width:0'},[
      h('div',{class:'row-title'},`${candidate.personName} · ${sourceTag(candidate)}`),
      h('div',{class:'row-sub'},reason(candidate)),
      h('div',{class:'row-sub'},`${t('pc30_evidence_window')} ${dateLabel(candidate.windowStart)} – ${dateLabel(candidate.windowEnd)} · ${t('pc30_confidence')} ${Math.round((candidate.confidence||0)*100)}%`),
      h('a',{class:'src-tag',href:candidate.target,title:candidate.source},candidate.source),
      candidate.previouslyDeferred?h('div',{class:'row-sub'},t('pc30_deferred_once')):null,
      candidate.testData?.containsTestData===true?h('div',{class:'row-sub',style:'color:var(--gold)'},t('pc30_test_data')):null,
      candidate.testData?.status!=='verified'?h('div',{class:'row-sub',style:'color:var(--red)'},t('pc30_test_data_unverified')):null,
    ]),
    bdg(t('pc30_review_candidate'),'gold'),
    h('div',{class:'row-actions'},[
      h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:event=>saveDecision(ctx,candidate,'deferred',onDone,event.currentTarget,7)},t('pc30_defer')),
      h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:event=>{
        if(window.confirm(t('pc30_confirm_reject'))) saveDecision(ctx,candidate,'rejected',onDone,event.currentTarget);
      }},t('pc30_reject')),
      h('button',{class:'btn btn-primary btn-sm',type:'button',disabled:!candidate.canCreateAction,
        title:!candidate.canCreateAction?t('pc30_action_disabled_test_data'):'',
        onclick:()=>openCandidateAction(ctx,candidate,onDone)},[ic('check'),t('pc30_create_action')]),
    ]),
  ])): [emptyNote(t('pc30_empty'),t('pc30_empty_note'))];
  return card({title:t('pc30_title'),icon:'sparkle',tag:bdg(t('pc30_deterministic'),'gray'),body,
    foot:[h('span',{class:'foot-note'},result.hasMore?t('pc30_limited_more'):t('pc30_footer')),
      result.disclosure?.containsTestData===true?h('span',{class:'foot-note',style:'color:var(--gold)'},t('pc30_test_data')):null]});
}
