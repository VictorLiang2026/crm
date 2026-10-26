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

const PAGE_SIZE = 20;
const FILTER_TYPES = [
  'insurance','recruit','referral','activity','speaker','partnership','service','relationship',
  '医疗保障','重疾保障','养老规划','教育规划','财富规划','家庭保障','转介绍',
];
const ACTIVE_STAGES = ['发现','沟通','方案','潜在线索','已介绍','已联系','已建立关系'];
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

export function openIdentityExceptions(ctx) {
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
          row.customerPersonId?h('a',{href:`#/person/${row.customerPersonId}`},t('opp_open_person')):null,
          h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:()=>{
            sheet.overlay.remove();openOpportunityDetails(ctx,{id:row.opportunityId,customer_id:row.customerId},load);
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

function openOpportunityDetails(ctx, row, onDone) {
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
    const core = h('div', { class: 'opp-detail-core' }, [
      h('div', { class: 'opp-detail-status' }, [bdg(statusLabel(opportunity.status), statusTone(opportunity.status)),
        h('span', { class: 'opp-source-kind' }, personOnly ? t('opp_source_person') : t('opp_source_customer'))]),
      person ? h('a', { class: 'opp-person-link', href: `#/person/${person.id}` }, `${person.display_name} · ${t('opp_open_person')}`) : null,
      h('dl', { class: 'opp-detail-facts' }, [
        h('dt', {}, t('opp_detail_progress')), h('dd', {}, opportunity.last_progress || t('empty_no_info')),
        h('dt', {}, t('opp_detail_next_action')), h('dd', {}, opportunity.next_action || t('empty_no_info')),
        h('dt', {}, t('opp_detail_next_date')), h('dd', {}, opportunity.next_action_date ? fmtDate(opportunity.next_action_date) : t('no_date')),
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
        openOpportunityEdit(ctx, { opportunity, personName: person?.display_name, onDone });
      } }, [ic('edit'), t('opp_edit_title')]) : null,
      personOnly && !['成交','关闭'].includes(opportunity.status) ? h('button', {
        class: 'btn btn-primary', type: 'button', onclick: () => {
          sheet.overlay.remove();
          openOpportunityAdvance(ctx, { opportunity, personName: person?.display_name, onDone });
        },
      }, [ic('check'), t('opp_btn_advance_close')]) : null,
      !personOnly && legacyCustomerHref && person && !['成交','关闭'].includes(opportunity.status)
        ? h('button', { class:'btn btn-ghost legacy-opp-edit', type:'button', onclick:()=>{
          sheet.overlay.remove();openLegacyOpportunity(ctx,{opportunity,person,actions:linkedActions,mode:'edit',onDone});
        } }, [ic('edit'),t('opp_edit_title')]) : null,
      !personOnly && legacyCustomerHref && person && !['成交','关闭'].includes(opportunity.status)
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
        h('summary', {style:'min-height:44px;cursor:pointer'}, t('l08_opportunity_maintenance')),
        h('p', { class:'foot-note' }, t(person ? 'l08_opportunity_maintenance_note' : 'l08_opportunity_unlinked_note')),
        h('a', { class:'btn btn-ghost', href:legacyCustomerHref, onclick:()=>sheet.overlay.remove() },
          [ic('users'),t('l08_open_original_maintenance')]),
      ]) : null,
    ]);
    body.replaceChildren(core, actionSection, outcomeSection, controls);
  }).catch((error) => {
    body.replaceChildren(h('div', { class: 'sheet-err' }, `${t('opp_detail_failed')}: ${error.message || t('try_later')}`));
  });
}

function opportunityRow(ctx, row, onDone) {
  const name = row.person?.display_name || t('opp_no_link_person');
  const personOnly = row.customer_id == null && row.person_id != null;
  return h('article', { class: 'opp-directory-row' }, [
    h('button', { class: 'opp-row-main', type: 'button', onclick: () => openOpportunityDetails(ctx, row, onDone) }, [
      h('span', { class: 'opp-row-title' }, [h('b', {}, typeLabel(row.opportunity_type)), bdg(statusLabel(row.status), statusTone(row.status))]),
      h('span', { class: 'opp-row-person' }, name),
      h('span', { class: 'opp-row-note' }, row.next_action || row.last_progress || t('opp_no_next_action')),
    ]),
    h('div', { class: 'opp-row-meta' }, [
      h('span', {}, personOnly ? t('opp_source_person') : t('opp_source_customer')),
      row.next_action_date ? h('span', {}, `${t('opp_detail_next_date')}: ${fmtDate(row.next_action_date)}`) : null,
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openOpportunityDetails(ctx, row, onDone) }, t('opp_details')),
    ]),
  ]);
}

function analysisCard(ctx, state, drill) {
  const body = h('div', { class: 'opp-analysis-grid' }, [
    h('section', { class: 'opp-analysis-source' }, [
      h('div', { class: 'opp-analysis-heading' }, [h('b', {}, t('opp_analysis_person_title')), bdg(t('opp_source_person'), 'jade')]),
      h('p', { class: 'opp-analysis-definition' }, t('opp_analysis_person_definition')),
      h('div', { class: 'opp-analysis-statuses', 'data-analysis': 'person' }, t('loading')),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => drill('person',null) }, t('opp_analysis_browse_person')),
    ]),
    h('section', { class: 'opp-analysis-source' }, [
      h('div', { class: 'opp-analysis-heading' }, [h('b', {}, t('opp_analysis_legacy_title')), bdg(t('opp_source_customer'), 'gold')]),
      h('p', { class: 'opp-analysis-definition' }, t('opp_analysis_legacy_definition')),
      h('div', { class: 'opp-analysis-statuses', 'data-analysis': 'legacy' }, t('loading')),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => drill('customer',null) }, t('opp_analysis_browse_legacy')),
    ]),
  ]);
  loadInto(body.querySelector('[data-analysis="person"]'), async () => {
    const result = await data.opportunityDirectory(ctx, { page:1,pageSize:1,kind:'person' });
    const counts = result.countsByStatus || {};
    return h('div', { class: 'opp-analysis-chips' }, Object.entries(counts).map(([status,count]) =>
      h('button', { class:'opp-analysis-chip', type:'button', onclick:() => drill('person',status) },
        [h('span',{},statusLabel(status)), h('b',{},String(count))])));
  });
  loadInto(body.querySelector('[data-analysis="legacy"]'), async () => {
    const result = await data.legacyOpportunityFunnel(ctx);
    const funnel = (result.funnels || []).find((entry) => entry.key === 'opportunity');
    const stages = funnel?.stages || [];
    if (!stages.length) return emptyNote(t('opp_analysis_no_stats'), t('opp_analysis_no_stats_note'));
    return h('div', { class: 'opp-analysis-chips' }, stages.map((stage) =>
      h('button', { class:'opp-analysis-chip', type:'button', onclick:() => drill('customer',stage.stage) },
        [h('span',{},statusLabel(stage.stage)), h('b',{},String(stage.count ?? stage.current_count ?? 0))])));
  });
  return card({ title:t('opp_analysis_title'), icon:'chart', body, cls:'opp-analysis-card' });
}

export function renderOpportunities(ctx) {
  const state = { page:1,kind:'all',status:'active',type:'',personId:null,personName:'',query:'' };
  const pendingEl = h('div', {});
  const analysisEl = h('div', {});
  const directoryEl = h('div', {});
  const personInput = h('input', { class:'opp-query-input', type:'search', placeholder:t('opp_filter_person_placeholder') });
  const personResults = h('div', { class:'opp-person-results' });
  const textInput = h('input', { class:'opp-query-input', type:'search', placeholder:t('opp_filter_query_placeholder') });
  const kindControl = selectControl([['all',t('opp_filter_all_sources')],['person',t('opp_source_person')],['customer',t('opp_source_customer')]],state.kind,t('opp_filter_source'));
  const typeControl = selectControl([['',t('opp_filter_all_types')],...FILTER_TYPES.map(type=>[type,typeLabel(type)])],state.type,t('opp_filter_type'));
  const statusControl = selectControl([['active',t('opp_filter_active')],['terminal',t('opp_filter_history')],['all',t('opp_filter_all_status')],
    ...['发现','沟通','方案','潜在线索','已介绍','已联系','已建立关系','成交','关闭'].map(status=>[status,statusLabel(status)])],state.status,t('opp_filter_status'));
  function reload() { loadDirectory(); }
  function drill(kind,status) {
    state.kind=kind;state.status=status||'all';state.type='';state.personId=null;state.personName='';state.query='';state.page=1;
    kindControl.querySelector('select').value=kind;typeControl.querySelector('select').value='';
    statusControl.querySelector('select').value=state.status;personInput.value='';textInput.value='';personResults.replaceChildren();
    loadDirectory();
  }
  function loadDirectory() {
    loadInto(directoryEl, async () => {
      const result = await data.opportunityDirectory(ctx, { page:state.page,pageSize:PAGE_SIZE,kind:state.kind,
        status:state.status==='all'?null:state.status,type:state.type||null,personId:state.personId,query:state.query||null });
      const rows = result.rows || [];
      const list = rows.length ? rows.map((row) => opportunityRow(ctx,row,loadDirectory)) :
        [emptyNote(t('opp_empty_directory'),t('opp_empty_directory_note'))];
      const paging = h('div', { class:'opp-pagination' }, [
        h('span',{},`${t('opp_total_count')} ${result.total ?? rows.length} · ${t('opp_page')} ${state.page}`),
        h('div',{},[
          h('button',{class:'btn btn-ghost btn-sm',type:'button',disabled:state.page<=1,onclick:()=>{state.page--;loadDirectory();}},t('btn_prev')),
          h('button',{class:'btn btn-ghost btn-sm',type:'button',disabled:!result.hasMore,onclick:()=>{state.page++;loadDirectory();}},t('btn_next')),
        ]),
      ]);
      return h('div',{class:'opp-directory-list'},[...list,paging]);
    });
  }
  function clearPerson() { state.personId=null;state.personName='';personInput.value='';personResults.replaceChildren();state.page=1;loadDirectory(); }
  async function searchPerson() {
    const query=personInput.value.trim();
    if(!query){personResults.replaceChildren();return;}
    personResults.replaceChildren(h('div',{class:'sheet-note'},t('searching')));
    try{
      const result=await data.searchPeopleForOpportunities(ctx,query);
      const candidates=(result.candidates||[]).slice(0,8);
      personResults.replaceChildren(...(candidates.length?candidates.map((candidate)=>h('button',{
        class:'opp-person-result',type:'button',onclick:()=>{
          state.personId=String(candidate.id);state.personName=candidate.display_name||candidate.displayName||'';
          state.page=1;personResults.replaceChildren(h('span',{class:'opp-person-selected'},`${state.personName} #${candidate.id}`),
            h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:clearPerson},t('opp_filter_clear_person')));loadDirectory();
        },
      },`${candidate.display_name||candidate.displayName||t('unnamed')} · #${candidate.id}`)):
        [h('span',{class:'opp-filter-empty'},t('no_person_found'))]));
    }catch(error){personResults.replaceChildren(h('span',{class:'opp-filter-empty'},error.message||t('try_later')));}
  }
  kindControl.querySelector('select').onchange=(event)=>{state.kind=event.target.value;state.page=1;loadDirectory();};
  typeControl.querySelector('select').onchange=(event)=>{state.type=event.target.value;state.page=1;loadDirectory();};
  statusControl.querySelector('select').onchange=(event)=>{state.status=event.target.value;state.page=1;loadDirectory();};
  const personSearchButton=h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:searchPerson},t('opp_filter_person'));
  const queryButton=h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:()=>{state.query=textInput.value.trim();state.page=1;loadDirectory();}},t('opp_filter_search'));
  textInput.onkeydown=(event)=>{if(event.key==='Enter'){state.query=textInput.value.trim();state.page=1;loadDirectory();}};
  personInput.onkeydown=(event)=>{if(event.key==='Enter')searchPerson();};

  loadInto(pendingEl,async()=>{
    const result=await data.pendingOpportunities(ctx);const rows=result.rows||[];
    return card({title:t('opp_pending_review'),icon:'sparkle',tag:wpTag(t('opp_pending_tag')),
      body:rows.length?rows.slice(0,6).map((row)=>h('div',{class:'list-row'},[
        h('div',{style:'flex:1;min-width:0'},[h('div',{class:'row-title'},row.personName||t('unnamed')),
          h('div',{class:'row-sub'},describeDraft(row.draft))]),
        bdg(row.status==='confirmed'?t('opp_confirmed'):t('opp_pending'),'gold'),
        h('button',{class:'btn btn-soft btn-sm',type:'button',onclick:()=>openCandidate(ctx,{row,onDone:reload})},t('opp_review')),
      ])):[emptyNote(t('opp_empty_pending'),t('opp_empty_pending_note'))],
      foot:[h('span',{class:'foot-note'},t('opp_foot_note'))]});
  });
  loadInto(analysisEl,async()=>analysisCard(ctx,state,drill));

  const filterBar=h('div',{class:'opp-filter-bar'},[
    kindControl,typeControl,statusControl,
    h('div',{class:'opp-person-filter'},[h('span',{},t('opp_filter_person')),personInput,personSearchButton,personResults]),
    h('div',{class:'opp-text-filter'},[textInput,queryButton]),
  ]);
  ctx.main.replaceChildren(
    pageHead({kicker:t('opp_kicker'),title:t('opp_title'),tag:wpTag(t('opp_wp_tag')),sub:t('opp_sub'),
      actions:[h('button',{class:'btn btn-ghost',type:'button',onclick:()=>openOpportunityCreate(ctx,{onDone:reload})},[ic('plus'),t('opp_btn_new')])]}),
    pendingEl,analysisEl,
    h('div',{class:'opp-directory-head'},[
      h('div',{},[h('h2',{},t('opp_directory_title')),h('p',{},t('opp_directory_note'))]),
      h('button',{class:'btn btn-ghost',type:'button',onclick:()=>openIdentityExceptions(ctx)},
        [ic('users'),t('opp_identity_title')]),
      h('button',{class:'btn btn-ghost',type:'button',onclick:()=>{
        state.status=state.status==='terminal'?'active':'terminal';state.page=1;
        statusControl.querySelector('select').value=state.status;loadDirectory();
      }},[ic('history'),state.status==='terminal'?t('opp_btn_open_view'):t('opp_btn_closed_view')]),
    ]),
    filterBar,directoryEl,
  );
  loadDirectory();
}
