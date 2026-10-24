// AI 助手页与更多页：WP0 静态内容沿用；WP3 AI 能力（摘要/会前准备/对话策略/复盘候选）已上线。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import { wpTag, pageHead, card, emptyNote, loadInto, sk, bdg, sectionTitle } from '../ui.js';
import { t } from '../i18n.js';
import { openQuickCapture } from '../write.js';

function searchExamples() {
  return [
    t('search_example_1'),
    t('search_example_2'),
    t('search_example_3'),
  ];
}
function searchLabels() {
  return {
    activity_no_followup: t('search_label_activity_no_followup'),
    child_education_no_insurance: t('search_label_child_education_no_insurance'),
    declining_priority: t('search_label_declining_priority'),
  };
}

function searchReasonText(reason, criteria) {
  const key = 'search_v2_condition_' + reason.condition;
  const translated = t(key);
  const label = translated === key ? t('search_v2_evidence') : translated;
  const details = [];
  const months = Number(reason.windowMonths ??
    (reason.condition === 'followupState' ? criteria?.followupMonths : criteria?.[reason.condition]));
  if (['attendanceMonths', 'followupState', 'followupMonths'].includes(reason.condition) &&
      Number.isInteger(months) && months >= 1 && months <= 24) {
    details.push(`${t('search_v2_recent_prefix')}${months}${t('search_v2_months_suffix')}`);
  }
  const references = (reason.records || []).map(ref => `public.${ref.table} #${ref.id}`);
  if (references.length) details.push(references.join(', '));
  if (reason.verifiedAbsence) details.push(t('search_v2_no_recent_followup'));
  return details.length ? `${label}: ${details.join(' · ')}` : label;
}

function evidenceFor(row, template) {
  if (template === 'activity_no_followup') {
    return t('evidence_attendance_prefix') + row.participant_id + t('evidence_activity_prefix') + row.activity_id + ' · ' + (row.activity_date || '');
  }
  if (template === 'child_education_no_insurance') {
    return t('evidence_family_prefix') + row.child_member_id + t('evidence_education_prefix') + 'public.' + row.education_source_table + ' #' + row.education_source_id;
  }
  return t('evidence_priority_prefix') + row.sales_priority + t('evidence_relationship_prefix') + row.relationship_id + t('evidence_trend_prefix') + row.trend;
}

function searchPanel(ctx) {
  const out = h('div', {});
  let queryInput;
  let selectedPersonId = null;
  let currentPage = 1;
  async function runSearch(page = 1) {
    const q = queryInput.value.trim();
    if (!q) { ctx.toast(t('toast_enter_search')); return; }
    loadInto(out, async () => {
      const res = await data.aiSearchV2(ctx, { query:q, page, ...(selectedPersonId ? {selectedPersonId} : {}) });
      if (!res.ok) throw new Error(res.error?.code || 'SEARCH_FAILED');
      if (res.status === 'unsupported') {
        return h('div', { class: 'muted' }, t('search_v2_unsupported'));
      }
      if (res.status === 'person_not_found') return h('div', {class:'muted'}, t('search_v2_person_missing'));
      if (res.status === 'needs_person_selection') {
        if (!Array.isArray(res.candidates) || !res.candidates.length) throw new Error('INVALID_RESULT');
        const select = h('select', {class:'sheet-input', 'aria-label':t('search_v2_choose_person')}, [
          h('option', {value:''}, t('search_v2_choose_person')),
          ...res.candidates.map(p => h('option', {value:p.id}, [p.displayName, p.organization ? ` · ${p.organization}` : '', p.occupation ? ` · ${p.occupation}` : ''])),
        ]);
        const submit = h('button', {class:'btn btn-soft', type:'button', onclick:() => {
          if (!/^[1-9][0-9]*$/.test(String(select.value))) { ctx.toast(t('search_v2_person_required')); return; }
          selectedPersonId=String(select.value); currentPage=1; runSearch(1);
        }}, t('btn_confirm'));
        return h('div', {}, [h('p', {class:'foot-note'}, t('search_v2_person_required')), select, submit]);
      }
      if (res.status !== 'complete' || !Array.isArray(res.rows)) throw new Error('INVALID_RESULT');
      currentPage = res.page || page;
      const rows = (res.rows || []).filter((r) => /^[1-9][0-9]*$/.test(String(r.person_id)));
      const body = [];
      body.push(h('div', {class:'search-summary'}, [bdg(t('search_v2_interpretation'),'ink'), h('span',{class:'muted'},res.interpretation || '')]));
      if (res.testData?.status === 'unverified') body.push(h('p',{class:'foot-note'},t('search_v2_unverified')));
      else if (res.testData?.containsTestData) body.push(h('p',{class:'foot-note'},t('search_v2_test_data')));
      if (!rows.length) {
        body.push(h('p', { class: 'muted' }, t('search_no_matches')));
      } else {
        body.push(h('div', { class: 'search-results' }, rows.map((r) =>
          h('a', { class: 'list-row data-row', href: `#/person/${r.person_id}` }, [
            h('div', { style: 'flex:1;min-width:0' }, [
              h('div', { class: 'row-title' }, r.display_name || `Person #${r.person_id}`),
              h('div', { class: 'row-sub' }, [
                r.customer_id ? `Person #${r.person_id} · Customer #${r.customer_id}` : `Person #${r.person_id}`,
                ...(r.matchReasons||[])
                  .filter(reason => reason.condition !== 'followupMonths' ||
                    !(r.matchReasons||[]).some(other => other.condition === 'followupState'))
                  .map(reason => h('div', {class:'foot-note'}, searchReasonText(reason, res.criteria))),
              ]),
            ]),
            ic('chevron'),
          ]))));
      }
      body.push(h('div',{class:'search-summary'},[
        h('span',{class:'muted'},`${t('search_v2_page')} ${res.page} · ${res.total} ${t('search_v2_total')}`),
        res.page>1 ? h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:()=>runSearch(res.page-1)},t('search_v2_previous')) : null,
        res.hasMore && res.page<11 ? h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:()=>runSearch(res.page+1)},t('search_v2_next')) : null,
      ].filter(Boolean)));
      if (res.truncated) body.push(h('p',{class:'foot-note'},t('search_v2_limit_reached')));
      body.push(h('p',{class:'foot-note'},t('search_v2_time_note')));
      body.push(h('p', { class: 'foot-note' }, t('search_source_note')));
      return h('div', {}, body);
    }, h('div', { class: 'muted' }, [sk('100%'), h('div', { style: 'height:8px' }), sk('70%')]));
  }
  function doSearch() { selectedPersonId=null; currentPage=1; runSearch(1); }
  queryInput = h('textarea', {
    class: 'sheet-input', rows: '3', maxlength: '1000',
    placeholder: t('search_placeholder'),
  });
  const form = h('form', { class: 'search-form', onsubmit: (e) => { e.preventDefault(); doSearch(); } }, [
    queryInput,
    h('button', { class: 'btn btn-soft', type: 'submit' }, [ic('search'), t('btn_search')]),
  ]);
  const examples = h('div', { class: 'search-examples' }, [
    h('span', { class: 'muted' }, t('search_try')),
    ...searchExamples().map((s) => h('button', {
      class: 'btn btn-ghost btn-sm', type: 'button',
      onclick: () => { queryInput.value = s; queryInput.focus(); },
    }, s)),
  ]);
  return h('div', { class: 'search-panel' }, [form, examples, out]);
}

const INTENT_KEYS = ['search','summarize','prepare','analyze','plan'];
function assistantTaskPanel(ctx) {
  const out = h('div', {});
  const query = h('textarea', {class:'sheet-input',rows:'3',maxlength:'1000',placeholder:t('assistant_task_placeholder')});
  async function run(selectedIntent = null, selectedPersonId = null) {
    if (!query.value.trim()) { ctx.toast(t('toast_enter_search')); return; }
    loadInto(out, async () => renderAssistantTask(ctx, await data.assistantReadTask(ctx, {
      query:query.value.trim(), language:document.documentElement.lang === 'en' ? 'en' : 'zh-CN',
      ...(selectedIntent ? {selectedIntent} : {}), ...(selectedPersonId ? {selectedPersonId} : {}),
    }), run), h('div',{class:'muted'},t('assistant_task_loading')));
  }
  const form = h('form',{class:'search-form',onsubmit:e=>{e.preventDefault();run();}},[
    query,h('button',{class:'btn btn-soft',type:'submit'},[ic('sparkle'),t('assistant_task_run')]),
  ]);
  return h('div',{class:'search-panel'},[h('p',{class:'foot-note'},t('assistant_task_scope')),form,out]);
}

function renderAssistantTask(ctx, response, run) {
  if (!response || response.ok !== true) return h('p',{class:'foot-note'},t('assistant_task_error'));
  if (response.status === 'needs_intent_choice') {
    const options = (response.options||[]).filter(v=>INTENT_KEYS.includes(v));
    return h('div',{},[h('p',{class:'foot-note'},t('assistant_task_choose_intent')),
      ...options.map(intent=>h('button',{class:'btn btn-ghost btn-sm',type:'button',onclick:()=>run(intent)},t('assistant_intent_'+intent)))]);
  }
  if (response.status === 'needs_person_name') return h('p',{class:'foot-note'},t('assistant_task_name_needed'));
  if (response.status === 'person_not_found') return h('p',{class:'foot-note'},t('search_v2_person_missing'));
  if (response.status === 'needs_person_selection' || response.result?.status === 'needs_person_selection') {
    const candidates = response.candidates || response.result?.candidates || [];
    if (!candidates.length) return h('p',{class:'foot-note'},t('assistant_task_error'));
    const select = h('select',{class:'sheet-input','aria-label':t('search_v2_choose_person')},[
      h('option',{value:''},t('search_v2_choose_person')),
      ...candidates.map(p=>h('option',{value:p.id},[p.displayName,p.organization?` · ${p.organization}`:'',p.occupation?` · ${p.occupation}`:''])),
    ]);
    return h('div',{},[h('p',{class:'foot-note'},t('assistant_task_person_choice')),select,
      h('button',{class:'btn btn-soft',type:'button',onclick:()=>/^[1-9][0-9]*$/.test(String(select.value))?run(response.plan?.intent||'search',String(select.value)):ctx.toast(t('search_v2_person_required'))},t('btn_confirm'))]);
  }
  if (response.status === 'unsupported') return h('div',{},[
    h('p',{class:'foot-note'},response.plan?.intent==='analyze'?t('assistant_task_analyze_unsupported'):t('assistant_task_unsupported')),
    response.plan?.interpretation?h('p',{class:'muted'},response.plan.interpretation):null,
  ].filter(Boolean));
  if (response.status !== 'complete' || !response.result) return h('p',{class:'foot-note'},t('assistant_task_error'));
  const {intent,result,plan,execution}=response;
  const body=[h('div',{class:'search-summary'},[bdg(t('assistant_task_plan'),'ink'),h('span',{class:'muted'},plan?.interpretation||'')]),
    h('p',{class:'foot-note'},`${t('assistant_task_scope_label')}: ${plan?.dataScope||''} · ${t(execution?.businessDataWritten?'assistant_task_written':'assistant_task_readonly')}`)];
  if(intent==='search') {
    const search=result;
    if(search.status==='unsupported') body.push(h('p',{class:'foot-note'},t('search_v2_unsupported')));
    else {
      if(search.testData?.status==='unverified') body.push(h('p',{class:'foot-note'},t('search_v2_unverified')));
      else if(search.testData?.containsTestData) body.push(h('p',{class:'foot-note'},t('search_v2_test_data')));
      if(!search.rows?.length) body.push(h('p',{class:'muted'},t('search_no_matches')));
      for(const row of (search.rows||[])) body.push(h('a',{class:'list-row data-row',href:`#/person/${row.person_id}`},[
        h('div',{style:'flex:1;min-width:0'},[
          h('div',{class:'row-title'},row.display_name||`Person #${row.person_id}`),
          h('div',{class:'row-sub'},[
            ...(row.matchReasons||[]).flatMap(reason=>[
              h('div',{class:'foot-note'},`${t('search_v2_condition_'+reason.condition)} · ${(reason.records||[]).map(ref=>`public.${ref.table} #${ref.id}`).join(', ')}`),
              ...(reason.verifiedAbsence?[h('div',{class:'foot-note'},t('search_v2_no_recent_followup'))]:[]),
            ]),
          ]),
        ]),ic('chevron'),
      ]));
      body.push(h('p',{class:'foot-note'},`${search.total||0} ${t('search_v2_total')} · ${t('search_v2_time_note')}`));
    }
  } else if(intent==='summarize') {
    body.push(h('a',{class:'list-row data-row',href:`#/person/${result.personId}`},[h('b',{},result.personName||`Person #${result.personId}`),ic('chevron')]));
    body.push(h('p',{class:'brief-guidance'},result.summary||''));
    for(const source of (result.sources||[])) body.push(h('p',{class:'foot-note'},`${source.schema}.${source.table} #${source.id}${source.at?` · ${source.at}`:''}`));
    for(const [key,label] of [['signals','assistant_task_signals'],['gaps','assistant_task_gaps'],['nextActions','assistant_task_next_actions']]) if(result[key]?.length) {
      body.push(h('b',{},t(label)),...result[key].map(v=>h('p',{class:'foot-note'},v)));
    }
  } else if(intent==='prepare') {
    body.push(h('a',{class:'list-row data-row',href:`#/person/${result.personId}`},[h('b',{},`Person #${result.personId}`),ic('chevron')]));
    for(const [key,label] of [['brief30Seconds','assistant_task_brief'],['suggestedObjective','assistant_task_objective'],['openingAngles','assistant_task_openings'],['possibleObjections','assistant_task_objections'],['questionsToConfirm','assistant_task_questions'],['avoid','assistant_task_avoid']]) {
      const value=result[key]; if(Array.isArray(value)&&value.length){body.push(h('b',{},t(label)),...value.map(v=>h('p',{class:'foot-note'},v)));}
      else if(typeof value==='string'&&value){body.push(h('b',{},t(label)),h('p',{class:'foot-note'},value));}
    }
    for(const source of (result.sources||[])) body.push(h('p',{class:'foot-note'},`${source.schema||'public'}.${source.table} #${source.id}${source.at?` · ${source.at}`:''}`));
  } else if(intent==='plan') {
    const sections=result.sections||{}, brief=sections.morningBrief||{};
    if(brief.headline) body.push(h('b',{},brief.headline));
    if(brief.guidance) body.push(h('p',{class:'brief-guidance'},brief.guidance));
    for(const action of (sections.topActions||[])) body.push(h('a',{class:'list-row data-row',href:action.target||'#/today'},[
      h('div',{style:'flex:1;min-width:0'},[h('div',{class:'row-title'},action.title||t('unnamed_action')),
        h('div',{class:'row-sub'},[action.personName?`${action.personName} · `:'',action.whyNow||'',action.source?` · ${action.source}`:''])]),ic('chevron'),
    ]));
    if(result.testData?.status==='unverified') body.push(h('p',{class:'foot-note'},t('search_v2_unverified')));
    else if(result.testData?.containsTestData) body.push(h('p',{class:'foot-note'},t('search_v2_test_data')));
  }
  return h('div',{},body);
}

export function renderAI(ctx) {
  const items = [
    ['sparkle', t('ai_item_nl_command'), t('ai_item_nl_command_desc'), 'WP3', 'hot'],
    ['users', t('ai_item_person_summary'), t('ai_item_person_summary_desc'), 'WP3', ''],
    ['shield', t('ai_item_prep'), t('ai_item_prep_desc'), 'WP3', ''],
    ['target', t('ai_item_opportunity'), t('ai_item_opportunity_desc'), t('ai_status_planning'), ''],
    ['calendar', t('ai_item_review'), t('ai_item_review_desc'), 'WP3', ''],
  ];
  ctx.main.replaceChildren(
    pageHead({
      kicker: t('kicker_ai'), title: t('title_ai'), tag: wpTag(t('wp3_tag')),
      sub: t('sub_ai'),
    }),
    card({
      title:t('assistant_task_title'),icon:'sparkle',tag:wpTag(t('ai_status_live')),
      body:[assistantTaskPanel(ctx)],
    }),
    h('div',{style:'height:16px'}),
    card({
      title: t('ai_search_title'), icon: 'search', tag: wpTag(t('ai_status_live')),
      body: [
        h('p', { class: 'foot-note', style: 'margin:0 0 12px' }, t('ai_search_desc')),
        searchPanel(ctx),
      ],
    }),
    h('div', { style: 'height:16px' }),
    card({
      title:t('ai_experience_title'),icon:'sparkle',tag:wpTag(t('ai_status_live')),
      body:[h('p',{class:'foot-note'},t('ai_experience_hub')),
        h('a',{class:'btn btn-soft',href:'#/ai/experience'},t('ai_experience_title'))],
    }),
    h('div', { style: 'height:16px' }),
    h('div', { class: 'ai-grid' }, items.map(([icon, name, desc, status, hot]) =>
      h('div', { class: 'card ai-card' }, [
        h('div', { class: 'ai-ic' }, ic(icon)),
        h('b', {}, name),
        h('p', {}, desc),
        h('div', { class: 'ai-foot' }, [h('span', { class: 'status-chip ' + (hot || 'plan') }, status)]),
      ]))),
    h('div', { style: 'height:16px' }),
    card({
      body: [h('p', { class: 'foot-note' }, t('ai_safety_note'))],
    }),
  );
}

// More uses explicit route kinds; all legacy URLs remain available.
const LEGACY_ADMIN = '/crm/admin.html';
const LEGACY_ENTRIES = [
  ['gear', 'legacy_account', '#/account', 'm17_reason_account'],
  ['file', 'legacy_test_scenario', '#/test-scenario', 'm17_reason_test'],
  ['users', 'legacy_customers', '#/customers', 'm17_reason_customers'],
  ['chat', 'legacy_followups', '#/more/followups', 'm17_reason_followups'],
  ['target', 'legacy_funnels', '#/funnels', 'm17_reason_funnels'],
  ['sparkle', 'legacy_ai_suggestions', '#/ai-suggestions', 'm17_reason_ai'],
  ['shield', 'legacy_policy_review', '#/more/policy-review', 'm17_reason_insurance'],
  ['grid', 'legacy_products', '#/more/products', 'm17_reason_insurance'],
  ['bell', 'legacy_gifts', '#/more/gifts', 'm17_reason_care'],
  ['search', 'legacy_photos', '#/more/photos', 'm17_reason_photos'],
  ['mic', 'legacy_speakers', '#/speakers', 'm17_reason_resources'],
  ['calendar', 'legacy_topics', '#/topics', 'm17_reason_resources'],
  ['recruit', 'legacy_recruit_goals', '#/recruit/goals', 'm17_reason_goals'],
  ['clock', 'legacy_activity_customer', '#/activity/customer', 'm17_reason_reports'],
  ['target', 'legacy_activity_recruit', '#/activity/recruit', 'm17_reason_reports'],
  ['refresh', 'legacy_customers_trash', '#/customers/trash', 'm17_reason_trash'],
  ['refresh', 'legacy_recruit_trash', '#/recruit/trash', 'm17_reason_trash'],
].map(([icon, key, hash, reasonKey]) => ({ kind: 'legacy', icon, key, hash, reasonKey }));

function moreEntry({ kind, icon, key, hash, descKey, reasonKey }) {
  if (kind !== 'native' && kind !== 'legacy') throw new Error('Invalid More route kind');
  return h('a', { class: 'tile', href: kind === 'legacy' ? LEGACY_ADMIN + hash : hash, 'data-entry-kind': kind }, [
    ic(icon), h('b', {}, t(key)),
    kind === 'legacy' ? bdg(t('status_legacy'), 'ink') : null,
    h('span', { 'data-entry-description': '' }, t(descKey || key + '_desc')),
    reasonKey ? h('span', { class: 'foot-note', 'data-compat-reason': '' }, t(reasonKey)) : null,
  ]);
}

export function renderMore(ctx) {
  const primary = [
    { kind: 'native', icon: 'file', key: 'knowledge_governance', hash: '#/knowledge-governance' },
    { kind: 'native', icon: 'chart', key: 'm16_title', descKey: 'm16_desc', hash: '#/analytics' },
    { kind: 'native', icon: 'gear', key: 'nav_settings', descKey: 'tile_settings_desc', hash: '#/settings' },
    { kind: 'native', icon: 'refresh', key: 'more_recycle_title', descKey: 'trash_hub_note', hash: '#/recycle' },
  ];
  const workspaces = [
    ['home', 'today'], ['users', 'people'], ['target', 'opportunities'],
    ['calendar', 'activities'], ['recruit', 'recruit'], ['sparkle', 'ai'],
  ].map(([icon, name]) => ({ kind: 'native', icon, key: 'nav_' + name, descKey: 'tile_' + name + '_desc', hash: '#/' + name }));
  const shortcuts = h('details', { class: 'more-section more-workspaces', open: window.innerWidth < 768 }, [
    h('summary', { class: 'section-title', style: 'cursor:pointer;display:list-item;list-style-position:inside;min-height:44px;padding:10px 0' }, t('m17_workspaces')),
    h('p', { class: 'foot-note' }, t('m17_workspaces_note')),
    h('div', { class: 'tile-grid' }, [
      ...workspaces.map(moreEntry),
      h('button', { class: 'tile', type: 'button', 'data-more-capture': '', onclick: () => openQuickCapture(ctx) }, [
        ic('mic'), h('b', {}, t('nav_quick_record')), h('span', {}, t('tile_quick_record_desc')),
      ]),
    ]),
  ]);
  const legacy = h('details', { class: 'more-section more-compat' }, [
    h('summary', { class: 'section-title', style: 'cursor:pointer;display:list-item;list-style-position:inside;min-height:44px;padding:10px 0' }, t('more_legacy_title')),
    h('p', { class: 'foot-note' }, t('m17_compat_note')),
    h('div', { class: 'tile-grid' }, LEGACY_ENTRIES.map(moreEntry)),
  ]);
  ctx.main.replaceChildren(
    pageHead({ kicker: t('kicker_more'), title: t('title_more'), sub: t('sub_more') }),
    h('section', { class: 'more-section more-primary' }, [
      sectionTitle(t('m17_tools')),
      h('div', { class: 'tile-grid' }, primary.map(moreEntry)),
    ]),
    shortcuts, legacy,
    h('div', { class: 'more-actions' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => ctx.signOut() }, [ic('logout'), t('setting_signout')])),
  );
}
