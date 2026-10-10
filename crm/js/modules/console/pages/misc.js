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
  function doSearch() {
    const q = queryInput.value.trim();
    if (!q) { ctx.toast(t('toast_enter_search')); return; }
    loadInto(out, async () => {
      const res = await data.aiSearch(ctx, q);
      if (!res.ok) throw new Error(res.error?.code || 'SEARCH_FAILED');
      if (res.status === 'unsupported') {
        return h('div', { class: 'muted' }, res.notice || t('search_unsupported'));
      }
      if (res.status !== 'complete' || !Array.isArray(res.rows)) throw new Error('INVALID_RESULT');
      const tpl = res.criteria?.template || '';
      const months = res.criteria?.months || 0;
      const rows = (res.rows || []).filter((r) => /^[1-9][0-9]*$/.test(String(r.person_id)));
      const body = [];
      body.push(h('div', { class: 'search-summary' }, [
        bdg(searchLabels()[tpl] || t('search_restricted'), 'ink'),
        h('span', { class: 'muted' }, t('search_recent_months_prefix') + months + t('search_recent_months_suffix') + res.total + t('search_people_suffix')),
      ]));
      for (const notice of res.notices || []) {
        body.push(h('p', { class: 'foot-note' }, notice));
      }
      if (!rows.length) {
        body.push(h('p', { class: 'muted' }, t('search_no_matches')));
      } else {
        body.push(h('div', { class: 'search-results' }, rows.map((r) =>
          h('a', { class: 'list-row data-row', href: `#/person/${r.person_id}` }, [
            h('div', { style: 'flex:1;min-width:0' }, [
              h('div', { class: 'row-title' }, r.display_name || `Person #${r.person_id}`),
              h('div', { class: 'row-sub' }, evidenceFor(r, tpl)),
            ]),
            ic('chevron'),
          ]))));
      }
      if (res.total > rows.length) {
        body.push(h('p', { class: 'muted' }, t('search_show_first_prefix') + rows.length + t('search_show_first_suffix')));
      }
      body.push(h('p', { class: 'foot-note' }, t('search_source_note')));
      return h('div', {}, body);
    }, h('div', { class: 'muted' }, [sk('100%'), h('div', { style: 'height:8px' }), sk('70%')]));
  }
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
  ctx.main.replaceChildren(
    pageHead({ kicker: t('kicker_more'), title: t('title_more'), sub: t('sub_more') }),
    h('div', { class: 'tile-grid' }, tiles.map(([hash, icon, name, desc]) =>
      hash
        ? h('a', { class: 'tile', href: hash }, [ic(icon), h('b', {}, name), h('span', {}, desc)])
        : h('button', { class: 'tile', type: 'button', onclick: () => openQuickCapture(ctx) }, [ic(icon), h('b', {}, name), h('span', {}, desc)]))),
    h('div', { style: 'height:16px' }),
    card({
      title: t('console_schedule_title'), icon: 'grid', tag: wpTag(t('ai_status_live')),
      body: [
        h('p', { class: 'foot-note', style: 'margin:0 0 10px' }, t('console_schedule_desc')),
        h('ul', { class: 'plan-list' }, [
          h('li', {}, [h('b', {}, t('wp2_title')), t('wp2_desc')]),
          h('li', {}, [h('b', {}, t('wp3_title')), t('wp3_desc')]),
        ]),
      ],
      foot: [
        h('span', { class: 'foot-note' }, t('legacy_note')),
        h('button', { class: 'btn btn-ghost', type: 'button', style: 'margin-left:auto', onclick: () => ctx.signOut() }, [ic('logout'), t('setting_signout')]),
      ],
    }),
    h('div', { style: 'height:16px' }),
    sectionTitle(t('legacy_section_title')),
    h('p', { class: 'foot-note', style: 'margin:0 0 12px' }, t('legacy_section_desc')),
    h('div', { class: 'tile-grid' }, LEGACY_ENTRIES.map(([icon, key, hash]) =>
      h('a', { class: 'tile', href: LEGACY_ADMIN + hash }, [
        ic(icon), h('b', {}, t(key)), h('span', {}, t(key + '_desc')),
      ]))),
  );
}
