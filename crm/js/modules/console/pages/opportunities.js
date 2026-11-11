// Person 机会目录：保留候选审核和预览写入，补足检视、筛选、历史与分页。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import {
  openCandidate, openOpportunityAdvance, openOpportunityCreate,
  openOpportunityEdit, openSheet,
} from '../write.js';
import { wpTag, pageHead, card, emptyNote, loadInto, bdg, fmtDate, textOf } from '../ui.js';
import { t, tFull, translateEnum } from '../i18n.js';
import { openLegacyOpportunity, legacyOpportunityTypeLabel } from '../legacy-opportunity.js';
import { openLegacyOpportunityMaintenance } from '../legacy-opportunity-maintenance.js';
import { openRecruitCandidateCreate } from '../recruit-write.js';
import { FLOW_STAGES, openPipelineStage, protectionTypes, stageLabel } from '../pipeline-stage.js';
import { opportunityReports } from '../policy-service.js';
import { actionContextPanel } from '../action-center.js';

const PAGE_SIZE = 20;
const FILTER_TYPES = [
  'insurance','recruit','activity','speaker','partnership','service','relationship',
  '医疗保障','重疾保障','养老规划','教育规划','财富规划','家庭保障',
];
const statusLabel = (value) => translateEnum('opportunity_stage', value) || value || '';
const typeLabel = (value) => legacyOpportunityTypeLabel(value) || value || t('opp_default_title');

function describeDraft(d) {
  if (!d) return t('candidate_preview');
  if (typeof d === 'string') return d.slice(0, 140);
  const title = d.opportunity_type || d.title || d.type || '';
  const progress = d.last_progress || d.reason || d.summary || '';
  return [title, progress].filter(Boolean).join(' · ').slice(0, 140) || t('candidate_preview');
}

function statusTone(status) {
  if (status === '成交') return 'jade';
  if (status === '关闭') return 'gray';
  return 'gold';
}

function selectControl(options, value, label) {
  return h('label', { class: 'opp-filter' }, [
    h('span', {}, label),
    h('select', { class: 'opp-filter-select', value }, options.map(([option, text]) =>
      h('option', { value: option }, text))),
  ]);
}

export function openIdentityExceptions(ctx,onDone) {
  const body=h('div',{class:'opp-detail-body'});
  const sheet=openSheet({title:t('opp_identity_title'),sub:t('opp_identity_note'),body});
  let page=1;
  function load(){
    loadInto(body,async()=>{
      const result=await data.legacyOpportunityIdentityExceptions(ctx,page);
      const rows=result.rows||[];
      return h('div',{},[
        h('p',{class:'sheet-note'},`${t('opp_total_count')} ${result.total||0} · ${t('opp_page')} ${page}`),
        ...rows.map(row=>h('div',{class:'opp-history-row'},[
          h('b',{},`${t('legacy_opp_record')} #${row.opportunityId} · ${t('opp_maintenance_customer')} #${row.customerId}`),
          h('p',{},t(`opp_identity_${row.reason}`)),
          h('p',{},`${t('opp_identity_customer_person')}: ${row.customerPersonName||t('label_none')} #${row.customerPersonId||'—'}`),
          h('p',{},`${t('opp_identity_opportunity_person')}: ${row.opportunityPersonName||t('label_none')} #${row.opportunityPersonId||'—'}`),
          row.customerPersonId?h('a',{href:`#/person/${row.customerPersonId}`,onclick:()=>sheet.overlay.remove()},t('opp_open_person')):null,
          h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:()=>{
            sheet.overlay.remove();openOpportunityDetails(ctx,{id:row.opportunityId,customer_id:row.customerId},onDone);
          }},t('opp_details')),
        ])),
        !rows.length?emptyNote(t('opp_identity_empty'),t('opp_identity_empty_note')):null,
        h('div',{class:'opp-pagination'},[
          h('button',{class:'btn btn-ghost btn-sm',type:'button',disabled:page<=1,onclick:()=>{page--;load();}},t('btn_prev')),
          h('button',{class:'btn btn-ghost btn-sm',type:'button',disabled:page*20>=Number(result.total||0),onclick:()=>{page++;load();}},t('btn_next')),
        ]),
      ]);
    });
  }
  document.body.appendChild(sheet.overlay);load();
}

export function openOpportunityDetails(ctx, row, onDone) {
  const body = h('div', { class: 'opp-detail-body' }, h('p', { class: 'sheet-note' }, t('opp_detail_loading')));
  const personName = row.person?.display_name || t('opp_no_link_person');
  const sheet = openSheet({ title: t('opp_detail_title'), sub: `${typeLabel(row.opportunity_type)} · ${personName}`, body });
  document.body.appendChild(sheet.overlay);
  data.opportunityDetails(ctx, row.id).then((result) => {
    const opportunity = result.opportunity || row;
    const person = opportunity.person || row.person || null;
    const linkedActions = Array.isArray(result.actions) ? result.actions : [];
    const outcomes = Array.isArray(result.outcomes) ? result.outcomes : [];
    const personOnly = opportunity.customer_id == null && opportunity.person_id != null;
    const legacyCustomerId = String(opportunity.customer_id ?? '');
    const legacyCustomerHref = /^[1-9][0-9]*$/.test(legacyCustomerId) && Number.isSafeInteger(Number(legacyCustomerId))
      ? `/crm/admin.html#/customer/${legacyCustomerId}` : null;
    const flowStatus=h('div',{class:'opp-detail-status'});
    if(person && protectionTypes.includes(opportunity.opportunity_type)) {
      loadInto(flowStatus,async()=>{
        const state=await data.pipelineState(ctx,{track:'protection',recordId:opportunity.id,personId:person.id});
        return h('div',{},[bdg(stageLabel('protection',state.stage),'ink'),
          state.confirmedAt ? h('small',{},fmtDate(state.confirmedAt)) : null,
          state.reason ? h('p',{class:'row-sub'},state.reason) : null]);
      });
    } else flowStatus.append(bdg(statusLabel(opportunity.status),statusTone(opportunity.status)));
    const core = h('div', { class: 'opp-detail-core' }, [
      flowStatus,
      person ? h('a', { class: 'opp-person-link', href: `#/person/${person.id}` }, `${person.display_name} · ${t('opp_open_person')}`) : null,
      h('dl', { class: 'opp-detail-facts' }, [
        h('dt', {}, t('opp_detail_progress')), h('dd', {}, opportunity.last_progress || t('empty_no_info')),
        !person ? h('dt', {}, t('opp_detail_next_action')) : null, !person ? h('dd', {}, opportunity.next_action || t('empty_no_info')) : null,
        !person ? h('dt', {}, t('opp_detail_next_date')) : null, !person ? h('dd', {}, opportunity.next_action_date ? fmtDate(opportunity.next_action_date) : t('no_date')) : null,
        h('dt', {}, t('opp_detail_discovered')), h('dd', {}, fmtDate(opportunity.discovered_at || opportunity.created_at)),
        opportunity.referred_name ? h('dt', {}, t('opp_referred_name')) : null,
        opportunity.referred_name ? h('dd', {}, opportunity.referred_name) : null,
        opportunity.referred_relation ? h('dt', {}, t('opp_referred_relation')) : null,
        opportunity.referred_relation ? h('dd', {}, opportunity.referred_relation) : null,
      ]),
      !personOnly ? h('p', { class: 'opp-legacy-note' }, t('opp_customer_legacy_note')) : null,
    ]);
    const actionSection = card({ title: t('opp_actions_title'), icon: 'check',
      body: linkedActions.length ? linkedActions.map((action) => h('div', { class: 'opp-history-row' }, [
        h('div', { class: 'opp-history-main' }, [h('b', {}, action.title || t('opp_action_untitled')),
          h('span', {}, `${translateEnum('work_status', action.status) || action.status || ''}${action.due_at ? ` · ${fmtDate(action.due_at)}` : ''}`)]),
        action.description ? h('p', {}, action.description) : null,
      ])) : [emptyNote(t('opp_actions_empty'), t('opp_actions_empty_note'))],
    });
    const outcomeSection = card({ title: t('opp_outcomes_title'), icon: 'history',
      body: outcomes.length ? outcomes.map((outcome) => h('div', { class: 'opp-history-row' }, [
        h('div', { class: 'opp-history-main' }, [
          h('b', {}, t(outcome.outcome_type === 'opportunity_sale' ? 'opp_outcome_sale' :
            outcome.outcome_type === 'opportunity_closed' ? 'opp_outcome_closed' : 'opp_outcome')),
          h('span', {}, fmtDate(outcome.occurred_at)),
        ]),
        h('p', {}, outcome.result || t('empty_no_info')),
        outcome.action_id ? h('span', { class: 'opp-history-link' }, `${t('opp_linked_action')} #${outcome.action_id}`) : null,
      ])) : [emptyNote(t('opp_outcomes_empty'), t('opp_outcomes_empty_note'))],
    });
    const controls = h('div', { class: 'opp-detail-actions' }, [
      personOnly ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => {
        sheet.overlay.remove();
        openOpportunityEdit(ctx, { opportunity, personName: person?.display_name, protectionOnly:protectionTypes.includes(opportunity.opportunity_type), onDone });
      } }, [ic('edit'), t('opp_edit_title')]) : null,
      person && protectionTypes.includes(opportunity.opportunity_type) ? h('button',{class:'btn btn-primary',type:'button',onclick:()=>{
        sheet.overlay.remove();
        openPipelineStage(ctx,{track:'protection',recordId:opportunity.id,personId:person.id},onDone);
      }},t('pipeline_change')) : null,
      personOnly && !protectionTypes.includes(opportunity.opportunity_type) && !['成交','关闭'].includes(opportunity.status) ? h('button', {
        class: 'btn btn-primary', type: 'button', onclick: () => {
          sheet.overlay.remove();
          openOpportunityAdvance(ctx, { opportunity, personName: person?.display_name, onDone });
        },
      }, [ic('check'), t('opp_btn_advance_close')]) : null,
      !personOnly && legacyCustomerHref && person && !['成交','关闭'].includes(opportunity.status)
        ? h('button', { class:'btn btn-ghost legacy-opp-edit', type:'button', onclick:()=>{
          sheet.overlay.remove();openLegacyOpportunity(ctx,{opportunity,person,actions:linkedActions,mode:'edit',onDone});
        } }, [ic('edit'),t('opp_edit_title')]) : null,
      !personOnly && !protectionTypes.includes(opportunity.opportunity_type) && legacyCustomerHref && person && !['成交','关闭'].includes(opportunity.status)
        ? h('button', { class:'btn btn-primary legacy-opp-advance', type:'button', onclick:()=>{
          sheet.overlay.remove();openLegacyOpportunity(ctx,{opportunity,person,actions:linkedActions,mode:'advance',onDone});
        } }, [ic('check'),t('opp_btn_advance_close')]) : null,
      !personOnly && legacyCustomerHref && ['成交','关闭'].includes(opportunity.status)
        ? h('button', { class:'btn btn-ghost', type:'button', onclick:()=>{
          sheet.overlay.remove();openLegacyOpportunityMaintenance(ctx,{opportunity,mode:'terminal_edit',onDone});
        } }, [ic('edit'),t('opp_maintenance_terminal_edit')]) : null,
      !personOnly && legacyCustomerHref
        ? h('button', { class:'btn btn-ghost', type:'button', onclick:()=>{
          sheet.overlay.remove();openLegacyOpportunityMaintenance(ctx,{opportunity,mode:'remove',onDone});
        } }, [ic('trash'),t('opp_maintenance_remove')]) : null,
      !personOnly && legacyCustomerHref ? h('details', { class: 'opp-maintenance', style:'flex-basis:100%' }, [
        h('summary', {style:'min-height:44px;cursor:pointer'}, t('pipeline_customer_record')),
        !person ? h('p', { class:'foot-note' }, t('opp_identity_title')) : null,
        h('a', { class:'btn btn-ghost', href:legacyCustomerHref, onclick:()=>sheet.overlay.remove() },
          [ic('users'),t('pipeline_customer_record')]),
      ]) : null,
    ]);
    body.replaceChildren(core, person ? actionContextPanel(ctx,{kind:'opportunity',targetId:opportunity.id},onDone,opportunity) : actionSection, outcomeSection, controls);
    if(person && protectionTypes.includes(opportunity.opportunity_type)) body.append(opportunityReports(ctx,opportunity.id));
  }).catch((error) => {
    body.replaceChildren(h('div', { class: 'sheet-err' }, `${t('opp_detail_failed')}: ${error.message || t('try_later')}`));
  });
}

const VIEWS = ['protection', 'recruitment', 'due', 'records'];
function pipelineRow(ctx, row, refresh) {
  const candidate = row.entity === 'candidate';
  const knownStage = row.confirmed_stage || row.mapped_stage;
  const stage = stageLabel(row.track,knownStage || row.raw_stage);
  const open = () => {
    if (candidate) location.hash = '#/person/' + row.person_id + '/recruit';
    else openOpportunityDetails(ctx, {id: row.id, opportunity_type: row.record_type,
      person: {id: row.person_id, display_name: row.person_name}}, refresh);
  };
  return h('article', {class:'opp-directory-row'}, [
    h('button', {class:'opp-row-main',type:'button',onclick:open}, [
      h('span',{class:'opp-row-title'},[h('b',{},row.person_name),bdg(t('pipeline_' + row.track),'ink')]),
      h('span',{class:'opp-row-note'}, [stage, knownStage ? null : bdg(t('pipeline_review'),'gold')]),
      row.declared_source==='referral' || ['referral','转介绍'].includes(row.record_type) ? h('span',{class:'opp-row-note'},t('pipeline_referral_source')) : null,
      row.next_action ? h('span',{class:'opp-row-note'},row.next_action) : null,
    ]),
    h('div',{class:'opp-row-meta'},[
      row.action_id ? h('a',{href:'#/actions/'+row.action_id},t('label_action')+' #'+row.action_id+(row.action_status?' · '+translateEnum('work_status',row.action_status):'')+(row.next_date?' · '+fmtDate(row.next_date):'')) :
        row.next_date ? h('span',{},fmtDate(row.next_date)) : null,
      FLOW_STAGES[row.track] ? h('button',{class:'btn btn-soft btn-sm',type:'button',onclick:()=>openPipelineStage(ctx,{
        track:row.track,recordId:row.id,personId:row.person_id},refresh)},t('pipeline_change')) : null,
      h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:open},t('opp_details')),
    ]),
  ]);
}

export function renderOpportunities(ctx) {
  const state = {kind:'protection',page:1,status:'active',query:'',personId:null};
  const pendingEl = h('div', {});
  const directoryEl = h('div', {});
  const newProtection=h('button',{class:'btn btn-soft',type:'button',
    onclick:()=>openOpportunityCreate(ctx,{onDone:loadDirectory,protectionOnly:true})},t('pipeline_new_protection'));
  const newRecruit=h('button',{class:'btn btn-soft',type:'button',
    onclick:()=>openRecruitCandidateCreate(ctx,{onDone:loadDirectory})},t('pipeline_new_recruit'));
  const tabs = h('div',{class:'toolbar',role:'group','aria-label':t('nav_opportunities')});
  const queryInput = h('input',{class:'opp-query-input',type:'search',placeholder:t('opp_filter_query_placeholder')});
  const personInput = h('input',{class:'opp-query-input',type:'search',placeholder:t('opp_filter_person_placeholder')});
  const personResults = h('div',{class:'opp-person-results'});
  const stages = selectControl([['active',t('opp_filter_active')],['terminal',t('opp_filter_history')],
    ['all',t('opp_filter_all_status')],['review',t('pipeline_review')]],state.status,t('opp_filter_status'));
  const typeControl = selectControl([['',t('opp_filter_all_types')],['source_referral',t('pipeline_referral_source')],
    ...FILTER_TYPES.map(type=>[type,typeLabel(type)])],'',t('pipeline_type_source'));
  let cancel = () => {};
  function loadDirectory() {
    cancel();
    cancel = loadInto(directoryEl,async()=>{
      const res=await data.opportunityDirectory(ctx,{...state,pageSize:PAGE_SIZE,status:state.status==='all'?null:state.status,
        type:typeControl.querySelector('select').value || null,query:state.query || null});
      const rows=res.rows || [];
      return h('div',{class:'opp-directory-list'},[
        ...(rows.length ? rows.map(row=>pipelineRow(ctx,row,loadDirectory)) : [emptyNote(t('opp_empty_directory'),'')]),
        h('div',{class:'opp-pagination'},[
          h('span',{},t('opp_total_count')+' '+res.total+' · '+t('opp_page')+' '+res.page),
          h('div',{},[
            h('button',{type:'button',class:'btn btn-ghost',disabled:res.page<=1,onclick:()=>{state.page--;loadDirectory();}},t('btn_prev')),
            h('button',{type:'button',class:'btn btn-ghost',disabled:!res.hasMore,onclick:()=>{state.page++;loadDirectory();}},t('btn_next')),
          ]),
        ]),
      ]);
    });
  }
  function changeView(kind) {
    state.kind=kind;state.page=1;state.status=kind==='records'?'all':'active';
    newProtection.hidden=kind==='recruitment';newRecruit.hidden=kind==='protection';
    const selector=stages.querySelector('select');
    selector.querySelectorAll('[data-flow-stage]').forEach(option=>option.remove());
    for(const stage of FLOW_STAGES[kind] || Object.values(FLOW_STAGES).flat()) {
      selector.append(h('option',{value:stage,'data-flow-stage':true},t('pipeline_stage_'+stage)));
    }
    selector.value=state.status;stages.hidden=kind==='due';
    typeControl.querySelector('select').value='';
    for(const button of tabs.children) button.setAttribute('aria-pressed',String(button.dataset.view===kind));
    loadDirectory();
  }
  for(const kind of VIEWS) tabs.append(h('button',{type:'button',class:'btn btn-soft','data-view':kind,
    onclick:()=>changeView(kind)},t('pipeline_'+kind)));
  const search=()=>{state.query=queryInput.value.trim();state.page=1;loadDirectory();};
  queryInput.onkeydown=e=>{if(e.key==='Enter')search();};
  stages.querySelector('select').onchange=e=>{state.status=e.target.value;state.page=1;loadDirectory();};
  typeControl.querySelector('select').onchange=()=>{state.page=1;loadDirectory();};
  function clearPerson() { state.personId=null;personInput.value='';personResults.replaceChildren();state.page=1;loadDirectory(); }
  async function searchPerson() {
    const query=personInput.value.trim();
    if(!query){personResults.replaceChildren();return;}
    personResults.replaceChildren(h('div',{class:'sheet-note'},t('searching')));
    try{
      const result=await data.searchPeopleForOpportunities(ctx,query);
      const candidates=(result.candidates||[]).slice(0,8);
      personResults.replaceChildren(...(candidates.length?candidates.map((candidate)=>h('button',{
        class:'opp-person-result',type:'button',onclick:()=>{
          state.personId=String(candidate.id);const personName=candidate.display_name||candidate.displayName||'';
          state.page=1;personResults.replaceChildren(h('span',{class:'opp-person-selected'},`${personName} #${candidate.id}`),
            h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:clearPerson},t('opp_filter_clear_person')));loadDirectory();
        },
      },`${candidate.display_name||candidate.displayName||t('unnamed')} · #${candidate.id}`)):
        [h('span',{class:'opp-filter-empty'},t('no_person_found'))]));
    }catch(error){personResults.replaceChildren(h('span',{class:'opp-filter-empty'},error.message||t('try_later')));}
  }
  personInput.onkeydown=e=>{if(e.key==='Enter')searchPerson();};
  let cancelPending=()=>{};
  function loadPending() {
    cancelPending();
    cancelPending=loadInto(pendingEl,async()=>{
    const result=await data.pendingOpportunities(ctx);const rows=result.rows||[];
    return card({title:t('opp_pending_review'),icon:'sparkle',tag:wpTag(t('opp_pending_tag')),
      body:rows.length?rows.slice(0,6).map((row)=>h('div',{class:'list-row'},[
        h('div',{style:'flex:1;min-width:0'},[h('div',{class:'row-title'},row.personName||t('unnamed')),
          h('div',{class:'row-sub'},describeDraft(row.draft))]),
        bdg(row.status==='confirmed'?t('opp_confirmed'):t('opp_pending'),'gold'),
        h('button',{class:'btn btn-soft btn-sm',type:'button',onclick:()=>openCandidate(ctx,{row,onDone:()=>{loadPending();loadDirectory();}})},t('opp_review')),
      ])):[emptyNote(t('opp_empty_pending'),t('opp_empty_pending_note'))],
      foot:[h('span',{class:'foot-note'},t('opp_foot_note'))]});
    });
  }
  loadPending();
  ctx.main.replaceChildren(
    pageHead({title:t('nav_opportunities'),actions:[newProtection,newRecruit]}),
    tabs,h('div',{class:'opp-filter-bar'},[typeControl,stages,
      h('div',{class:'opp-person-filter'},[personInput,h('button',{type:'button',class:'btn btn-ghost',onclick:searchPerson},t('opp_filter_person')),personResults]),
      h('div',{class:'opp-text-filter'},[queryInput,h('button',{type:'button',class:'btn btn-ghost',onclick:search},t('opp_filter_search'))]),
    ]),directoryEl,pendingEl,h('button',{class:'btn btn-ghost',onclick:()=>openIdentityExceptions(ctx,loadDirectory)},t('opp_identity_title')),
  );
  changeView('protection');
}
