// 组织发展工作台（WP1 只读）：候选人列表（legacy 视图 + person-only 视图合并）、
// 八阶段漏斗（基表计数）、当月目标进度。新增人才/跟进写入在 WP2；六维 AI 评分在 WP3。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import { openRecruitCandidateCreate } from '../recruit-write.js';
import { openRecruitDeleteCommand } from '../recruit-delete.js';
import { wpTag, pageHead, emptyNote, loadInto, bdg, fmtDate, dayDiffFromToday, textOf } from '../ui.js';
import { t, translateEnum } from '../i18n.js';

// 服务端固定返回中文 key 数组，用于保证列顺序一致
const FUNNEL_STAGES_CN = ['新增人才','互动暖客','初次面谈','增员活动','精准面谈','入职申请','签约入司','流失'];

// 枚举翻译统一走 i18n.js 集中注册表
const stageLabel = (stage) => translateEnum('recruit_stage', stage);

function stageTone(stage) {
  if (stage === '流失') return 'gray';
  if (stage === '签约入司') return 'jade';
  if (stage === '入职申请' || stage === '精准面谈') return 'red';
  return 'gold';
}

const RECRUIT_PAGE_SIZE = 30;
const RECRUIT_COLUMNS = [
  { key: 'name', field: 'name', label: () => t('col_name') },
  { key: 'stage', field: 'stage', label: () => t('recruit_stage_column') },
  { key: 'recruitment_priority', field: 'recruitment_priority', label: () => t('recruit_priority') },
  { key: 'potential_score', field: 'potential_score', label: () => t('potential_score_column') },
  { key: 'next_action_date', field: 'next_action_date', label: () => t('col_next_followup') },
  { key: 'idle_days', field: 'idle_days', label: () => t('recruit_idle_days') },
  { key: 'updated_at', field: 'updated_at', label: () => t('col_recent_update') },
  { key: 'candidate_id', field: 'candidate_id', label: () => t('col_id') },
];

function listNode(ctx) {
  const state = { page: 1, keyword: '', sortField: 'next_action_date', sortDir: 'desc',
    stages: [], priorities: [], pendingStages: [], pendingPriorities: [] };
  let currentRequest = 0;
  let cancelCurrentQuery = () => {};
  const root = h('div', { class: 'recruit-directory' });
  const toolbar = h('div', { class: 'toolbar recruit-directory-toolbar' });
  const searchInput = h('input', { placeholder: t('recruit_search_name'), maxlength: 40 });
  const searchButton = h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: search }, t('btn_search'));
  const filterButton = h('button', { class: 'btn btn-dark people-filter-trigger', type: 'button' });
  const filterPanel = h('div', { class: 'people-filter-panel', hidden: true });
  const filterAnchor = h('div', { class: 'people-filter-anchor' }, [filterButton, filterPanel]);
  const tableHost = h('div', { class: 'card-body recruit-directory-table-host' });
  const totalLabel = h('span', { class: 'foot-note' });
  const statusLabel = h('span', { class: 'foot-note recruit-directory-limit' });
  const previousButton = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: previous }, t('btn_prev'));
  const nextButton = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: next }, t('btn_next'));
  const pageLabel = h('span', { class: 'pager-info' });
  const cardFoot = h('div', { class: 'card-foot' }, [totalLabel, statusLabel,
    h('div', { class: 'pager', style: 'margin-left:auto' }, [previousButton, pageLabel, nextButton])]);
  toolbar.append(h('div', { class: 'searchbox' }, [ic('search'), searchInput, searchButton]), filterAnchor);
  root.append(toolbar, tableHost, cardFoot);

  function updateFilterButton() {
    const count = state.stages.length + state.priorities.length;
    filterButton.replaceChildren(count ? t('people_filter') : `${t('people_filter')} ${t('filter_none')}`,
      ...(count ? [h('span', { class: 'people-filter-count' }, String(count))] : []));
    filterButton.setAttribute('aria-expanded', String(!filterPanel.hidden));
  }

  function checkboxGroup(values, options, onChange) {
    return h('div', { class: 'people-filter-checks' }, options.map(([value, label]) => {
      const input = h('input', { type: 'checkbox', checked: values.includes(value) });
      input.addEventListener('change', () => onChange(value, input.checked));
      return h('label', { class: 'people-filter-check', 'data-filter-value': value }, [input, h('span', {}, label)]);
    }));
  }

  function renderFilterPanel() {
    const stageChecks = checkboxGroup(state.pendingStages,
      FUNNEL_STAGES_CN.map(value => [value, stageLabel(value)]), (value, checked) => {
        const selected = new Set(state.pendingStages);
        checked ? selected.add(value) : selected.delete(value);
        state.pendingStages = [...selected];
      });
    const priorityChecks = checkboxGroup(state.pendingPriorities,
      ['A', 'B', 'C', 'D', 'E'].map(value => [value, value]), (value, checked) => {
        const selected = new Set(state.pendingPriorities);
        checked ? selected.add(value) : selected.delete(value);
        state.pendingPriorities = [...selected];
      });
    const reset = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
      state.pendingStages = [];
      state.pendingPriorities = [];
      renderFilterPanel();
    } }, t('btn_reset'));
    const apply = h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => {
      state.stages = [...state.pendingStages];
      state.priorities = [...state.pendingPriorities];
      state.page = 1;
      filterPanel.hidden = true;
      updateFilterButton();
      search();
    } }, t('btn_search'));
    filterPanel.replaceChildren(
      h('div', { class: 'people-filter-title' }, t('recruit_filter_stage')), stageChecks,
      h('section', { class: 'people-filter-group' }, [
        h('div', { class: 'people-filter-title' }, t('recruit_priority')), priorityChecks,
      ]),
      h('div', { class: 'people-filter-actions' }, [reset, apply]),
    );
  }

  filterButton.onclick = () => {
    if (filterPanel.hidden) {
      state.pendingStages = [...state.stages];
      state.pendingPriorities = [...state.priorities];
      renderFilterPanel();
    }
    filterPanel.hidden = !filterPanel.hidden;
    updateFilterButton();
  };

  function openPerson(row) {
    if (row.person_id) { location.hash = `#/person/${row.person_id}`; return; }
    data.lookupCustomer(ctx, row.customer_id).then(res => { location.hash = `#/person/${res.personId}`; })
      .catch(() => ctx.toast(t('toast_no_person_identity')));
  }

  function renderTable(rows) {
    const head = h('thead', {}, h('tr', {}, RECRUIT_COLUMNS.map(column => h('th', {
      class: `recruit-col-${column.key} sortable-th`,
      onclick: () => {
        if (state.sortField === column.field) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else { state.sortField = column.field; state.sortDir = 'asc'; }
        state.page = 1;
        runQuery();
      },
    }, [column.label(), h('span', { class: 'people-sort-arrow' }, state.sortField === column.field ? (state.sortDir === 'asc' ? ' ▲' : ' ▼') : '')]))));
    const body = h('tbody', {}, rows.map(row => {
      const cells = [
        h('td', { class: 'recruit-col-name' }, [
          h('a', { href: '#', onclick: ev => { ev.preventDefault(); ev.stopPropagation(); openPerson(row); } }, row.customer_name || t('unnamed')),
          h('div', { class: 'recruit-row-sub' }, [row.occupation || '', textOf(row.next_action) ? `${t('next_step')}${row.next_action}` : ''].filter(Boolean).join(' · ')),
        ]),
        h('td', { class: 'recruit-col-stage' }, bdg(stageLabel(row.stage) || t('stage_unknown'), stageTone(row.stage))),
        h('td', { class: 'recruit-col-recruitment_priority' }, row.recruitment_priority ? bdg(row.recruitment_priority, 'gold') : '-'),
        h('td', { class: 'recruit-col-potential_score' }, row.potential_score == null ? '-' : String(row.potential_score)),
        h('td', { class: 'recruit-col-next_action_date' }, row.next_action_date ? (() => {
          const diff = dayDiffFromToday(row.next_action_date);
          return `${fmtDate(row.next_action_date)}${diff != null && diff < 0 ? ` · ${t('overdue_days_prefix')}${-diff}${t('day_unit')}` : ''}`;
        })() : '-'),
        h('td', { class: 'recruit-col-idle_days' }, row.idle_days == null ? '-' : `${row.idle_days}${t('day_unit')}`),
        h('td', { class: 'recruit-col-updated_at' }, fmtDate(row.updated_at)),
        h('td', { class: 'recruit-col-candidate_id' }, String(row.candidate_id)),
      ];
      cells.forEach((cell, index) => cell.setAttribute('data-label', RECRUIT_COLUMNS[index].label()));
      return h('tr', { onclick: () => openPerson(row) }, cells);
    }));
    return h('div', { class: 'table-scroll recruit-directory-scroll' },
      h('table', { class: 'people-table recruit-directory-table' }, [head, body]));
  }

  function runQuery() {
    const requestId = ++currentRequest;
    cancelCurrentQuery();
    cancelCurrentQuery = loadInto(tableHost, async () => {
      const result = await data.recruitDirectory(ctx, {
        page: state.page, pageSize: RECRUIT_PAGE_SIZE, search: state.keyword,
        stages: state.stages, priorities: state.priorities, sortField: state.sortField, sortDir: state.sortDir,
      });
      if (requestId !== currentRequest) return h('div', {});
      const rows = result.rows || [];
      totalLabel.textContent = t('recruit_directory_total').replace('{total}', String(result.total ?? rows.length));
      statusLabel.textContent = result.truncated ? t('recruit_directory_limit') : '';
      pageLabel.textContent = `${result.page} / ${result.totalPages || 1}`;
      previousButton.disabled = result.page <= 1;
      nextButton.disabled = !result.hasMore;
      if (!rows.length) return emptyNote(t('empty_no_recruit_candidates'), t('empty_no_recruit_candidates_note'));
      return renderTable(rows);
    });
  }

  function search() {
    state.keyword = searchInput.value.trim().slice(0, 40);
    state.stages = [...state.pendingStages];
    state.priorities = [...state.pendingPriorities];
    state.page = 1;
    filterPanel.hidden = true;
    updateFilterButton();
    runQuery();
  }
  function previous() { if (state.page > 1) { state.page -= 1; runQuery(); } }
  function next() { state.page += 1; runQuery(); }
  searchInput.addEventListener('keydown', ev => { if (ev.key === 'Enter') search(); });
  updateFilterButton();
  runQuery();
  return root;
}
function sideNode(ctx) {
  const month = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  return Promise.all([
    data.recruitFunnel(ctx).catch((e) => ({ _error: e })),
    data.recruitProgress(ctx, month, month).catch((e) => ({ _error: e })),
  ]).then(([funnel, progress]) => {
    if (funnel._error) throw funnel._error;
    const counts = funnel.funnel || {};
    const allStages = [...FUNNEL_STAGES_CN];
    Object.keys(counts).forEach((s) => { if (!allStages.includes(s)) allStages.push(s); });
    const max = Math.max(1, ...allStages.map((s) => counts[s] || 0));
    const funnelCard = {
      title: t('funnel_title'), icon: 'recruit', tag: wpTag(t('fact')),
      body: [h('div', {}, allStages.map((s) => {
        const n = counts[s] || 0;
        return h('div', { class: 'funnel-row' }, [
          h('span', { class: s === '流失' ? 'funnel-lost' : '' }, stageLabel(s)),
          h('span', { class: 'funnel-bar-track' },
            h('span', { class: 'funnel-bar' + (s === '流失' ? ' lost' : ''), style: `width:${Math.round((n / max) * 100)}%` })),
          h('span', { class: 'funnel-n' }, String(n)),
        ]);
      }))],
      foot: [h('span', { class: 'foot-note' }, t('funnel_total_prefix') + (funnel.total ?? allStages.reduce((a, s) => a + (counts[s] || 0), 0)) + t('funnel_total_suffix'))],
    };
    const goalRows = (progress.rows || []).filter((r) => (r.target || 0) > 0 || (r.actual || 0) > 0);
    const goalCard = {
      title: month + ' ' + t('goals_title'), icon: 'calendar', tag: wpTag(t('fact')),
      body: goalRows.length ? [h('div', {}, goalRows.map((r) => h('div', { class: 'goal-row' }, [
        h('span', {}, stageLabel(r.stage)),
        h('span', { class: 'goal-bar-track' }, h('span', {
          class: 'goal-bar',
          style: `width:${Math.min(100, r.target ? Math.round((r.actual / r.target) * 100) : 0)}%`,
        })),
        h('span', { class: 'goal-n' }, `${r.actual}/${r.target}`),
      ])))] : [emptyNote(t('empty_no_goals'), t('empty_no_goals_note'))],
    };
    return h('div', { style: 'display:flex;flex-direction:column;gap:14px' }, [
      h('section', { class: 'card' }, [
        h('div', { class: 'card-head' }, [ic('recruit'), h('b', {}, funnelCard.title), funnelCard.tag]),
        h('div', { class: 'card-body' }, funnelCard.body),
        h('div', { class: 'card-foot' }, funnelCard.foot),
      ]),
      h('section', { class: 'card' }, [
        h('div', { class: 'card-head' }, [ic('calendar'), h('b', {}, goalCard.title), goalCard.tag]),
        h('div', { class: 'card-body' }, goalCard.body),
      ]),
    ]);
  });
}

export function renderRecruit(ctx) {
  const listEl = h('div', {});
  const sideEl = h('div', {});
  loadInto(listEl, () => listNode(ctx));
  loadInto(sideEl, () => sideNode(ctx));

  ctx.main.replaceChildren(
    pageHead({
      kicker: t('kicker_recruit'), title: t('title_recruit'), tag: wpTag(t('wp1_readonly')),
      sub: t('sub_recruit'),
      actions: [
        h('button', { class: 'btn btn-ghost', type: 'button', title: t('pc28_title'),
          onclick: () => openRecruitDeleteCommand(ctx) }, [ic('trash'), t('pc28_short')]),
        h('button', { class: 'btn btn-ghost', type: 'button', title: t('goals_title'), onclick: () => { location.hash = '#/recruit/goals'; } }, [ic('calendar'), t('goals_short')]),
        h('button', { class: 'btn btn-primary', type: 'button', title: t('new_recruit'), onclick: () => openRecruitCandidateCreate(ctx, {
          onDone: personId => { location.hash = `#/person/${personId}`; },
        }) }, [ic('plus'), t('new_recruit_short')]),
      ],
    }),
    h('div', { class: 'today-grid recruit-layout' }, [
      h('section', { class: 'card' }, [listEl]),
      sideEl,
    ]),
  );
}
