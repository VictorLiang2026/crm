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
                ...(r.matchReasons||[]).map(reason=>h('div',{class:'foot-note'},[
                  t('search_v2_condition_'+reason.condition)+': '+(reason.records||[]).map(ref=>`public.${ref.table} #${ref.id}`).join(', '),
                  (reason.evidence||[]).length ? ' · '+JSON.stringify(reason.evidence) : (reason.verifiedAbsence ? ' · '+t('search_v2_no_recent_followup') : ''),
                ])),
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
      title: t('ai_search_title'), icon: 'search', tag: wpTag(t('ai_status_live')),
      body: [
        h('p', { class: 'foot-note', style: 'margin:0 0 12px' }, t('ai_search_desc')),
        searchPanel(ctx),
      ],
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

// 旧版功能入口：跨页跳转 admin.html 对应路由（console 路由不处理这些 hash）。
// 整合策略：console 原生等价功能上线后，从 LEGACY_ENTRIES 移除对应项。
const LEGACY_ADMIN = '/crm/admin.html';
const LEGACY_ENTRIES = [
  ['gear', 'legacy_account', '#/account'],
  ['file', 'legacy_test_scenario', '#/test-scenario'],
  ['users', 'legacy_customers', '#/customers'],
  ['chat', 'legacy_followups', '#/more/followups'],
  ['target', 'legacy_funnels', '#/funnels'],
  ['sparkle', 'legacy_ai_suggestions', '#/ai-suggestions'],
  ['shield', 'legacy_policy_review', '#/more/policy-review'],
  ['grid', 'legacy_products', '#/more/products'],
  ['bell', 'legacy_gifts', '#/more/gifts'],
  ['search', 'legacy_photos', '#/more/photos'],
  ['mic', 'legacy_speakers', '#/speakers'],
  ['calendar', 'legacy_topics', '#/topics'],
  ['recruit', 'legacy_recruit_goals', '#/recruit/goals'],
  ['clock', 'legacy_activity_customer', '#/activity/customer'],
  ['target', 'legacy_activity_recruit', '#/activity/recruit'],
  ['refresh', 'legacy_customers_trash', '#/customers/trash'],
  ['refresh', 'legacy_recruit_trash', '#/recruit/trash'],
];

const ENTRY_KEYS = Object.fromEntries(LEGACY_ENTRIES.map(entry => [entry[1], entry]));
const LEGACY_BUSINESS_GROUPS = [
  ['legacy_customer_group', ['legacy_customers', 'legacy_followups']],
  ['legacy_activity_group', ['legacy_activity_customer', 'legacy_activity_recruit', 'legacy_speakers', 'legacy_topics']],
  ['legacy_recruit_group', ['legacy_recruit_goals']],
];

function moreEntry(entry, status) {
  const [icon, key, hash] = entry;
  const href = key === 'knowledge_governance' || hash.startsWith('#/people-trash') ? hash : LEGACY_ADMIN + hash;
  return h('a', { class: 'tile', href }, [
    ic(icon), h('b', {}, t(key)), bdg(t(status), status === 'status_live' ? 'jade' : 'ink'),
    h('span', {}, t(key + '_desc')),
  ]);
}

function moreGroup(titleKey, descriptionKey, entries, actions = null) {
  return h('section', { class: 'more-section' }, [
    sectionTitle(t(titleKey)),
    h('p', { class: 'foot-note', style: 'margin:0 0 12px' }, t(descriptionKey)),
    h('div', { class: 'tile-grid' }, entries.map(entry => moreEntry(entry, 'status_legacy'))),
    actions,
  ]);
}

export function renderMore(ctx) {
  const tiles = [
    ['#/today', 'home', t('nav_today'), t('tile_today_desc')],
    ['#/people', 'users', t('nav_people'), t('tile_people_desc')],
    ['#/opportunities', 'target', t('nav_opportunities'), t('tile_opportunities_desc')],
    ['#/activities', 'calendar', t('nav_activities'), t('tile_activities_desc')],
    ['#/recruit', 'recruit', t('nav_recruit'), t('tile_recruit_desc')],
    ['#/ai', 'sparkle', t('nav_ai'), t('tile_ai_desc')],
    ['#/settings', 'gear', t('nav_settings'), t('tile_settings_desc')],
    [null, 'mic', t('nav_quick_record'), t('tile_quick_record_desc')],
  ];
  const systemEntries = [ENTRY_KEYS.legacy_account, ENTRY_KEYS.legacy_test_scenario];
  const knowledgeEntries = [
    ['file', 'knowledge_governance', '#/knowledge-governance'],
    ENTRY_KEYS.legacy_funnels, ENTRY_KEYS.legacy_ai_suggestions, ENTRY_KEYS.legacy_policy_review,
    ENTRY_KEYS.legacy_products, ENTRY_KEYS.legacy_gifts, ENTRY_KEYS.legacy_photos,
  ];
  const recycleEntries = [
    ['refresh', 'person_trash_entry', '#/people-trash'],
    ENTRY_KEYS.legacy_customers_trash, ENTRY_KEYS.legacy_recruit_trash,
  ];
  ctx.main.replaceChildren(
    pageHead({ kicker: t('kicker_more'), title: t('title_more'), sub: t('sub_more') }),
    h('div', { class: 'tile-grid' }, tiles.map(([hash, icon, name, desc]) =>
      hash
        ? h('a', { class: 'tile', href: hash }, [ic(icon), h('b', {}, name), h('span', {}, desc)])
        : h('button', { class: 'tile', type: 'button', onclick: () => openQuickCapture(ctx) }, [ic(icon), h('b', {}, name), h('span', {}, desc)]))),
    h('div', { style: 'height:16px' }),
    moreGroup('more_system_title', 'more_system_desc', systemEntries,
      h('div', { class: 'more-actions' }, h('button', {
        class: 'btn btn-ghost', type: 'button', onclick: () => ctx.signOut(),
      }, [ic('logout'), t('setting_signout')]))),
    h('section', { class: 'more-section' }, [
      sectionTitle(t('more_knowledge_title')),
      h('p', { class: 'foot-note', style: 'margin:0 0 12px' }, t('more_knowledge_desc')),
      h('div', { class: 'tile-grid' }, knowledgeEntries.map(entry => moreEntry(entry,
        entry[1] === 'knowledge_governance' ? 'status_live' : 'status_legacy'))),
    ]),
    h('section', { class: 'more-section' }, [
      sectionTitle(t('more_recycle_title')),
      h('p', { class: 'foot-note', style: 'margin:0 0 12px' }, t('more_recycle_desc')),
      h('div', { class: 'tile-grid' }, [
        moreEntry(recycleEntries[0], 'status_live'),
        ...recycleEntries.slice(1).map(entry => moreEntry(entry, 'status_legacy')),
      ]),
    ]),
    h('section', { class: 'more-section' }, [
      sectionTitle(t('more_legacy_title')),
      h('p', { class: 'foot-note', style: 'margin:0 0 12px' }, t('more_legacy_desc')),
      ...LEGACY_BUSINESS_GROUPS.map(([titleKey, keys]) => h('div', { class: 'more-business-group' }, [
        h('h3', { class: 'more-business-title' }, t(titleKey)),
        h('div', { class: 'tile-grid' }, keys.map(key => moreEntry(ENTRY_KEYS[key], 'status_legacy'))),
      ])),
    ]),
  );
}
