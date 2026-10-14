// 人物目录：表格形式，表头与 admin.html 客户列表一致，可点击排序。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import { openPersonNew, openPersonRoleConversion } from '../write.js';
import { wpTag, pageHead, emptyNote, loadInto, bdg, textOf } from '../ui.js';
import { t, translateEnum } from '../i18n.js';

const PAGE_SIZE = 20;
const ROLE_BADGE = () => ({
  customer: [t('customer'), 'ink'],
  recruit: [t('recruit'), 'gold'],
  speaker: [t('speaker'), 'jade'],
  participant: [t('participant'), 'blue'],
  partner: [t('role_partner'), 'purple'],
  referrer: [t('role_referrer'), 'teal'],
  alumni: [t('role_alumni'), 'gray'],
  other: [t('role_other'), 'gray'],
});

const SORT_COLUMNS = () => ([
  { field: 'display_name', label: t('col_name') },
  { field: 'sales_priority', label: t('col_customer_priority') },
  { field: 'recruitment_priority', label: t('col_recruit_priority') },
  { field: 'referral_priority', label: t('col_referral_priority') },
  { field: 'latest_followup_date', label: t('col_latest_followup'), full: t('col_latest_followup_full') },
  { field: 'next_followup_date', label: t('col_next_followup'), full: t('col_next_followup_full') },
  { field: 'convert_customer', label: t('col_convert_customer'), sortable: false },
  { field: 'convert_recruit', label: t('col_convert_recruit'), sortable: false },
  { field: 'id', label: t('col_id') },
]);

function fmtDate(v) {
  if (!v) return '-';
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

export function renderPeople(ctx) {
  const emptyFilters = () => ({ roles: [], customerPriorities: [], recruitPriorities: [], referralPriorities: [] });
  const state = { page: 1, keyword: '', sortField: 'id', sortDir: 'desc', filters: emptyFilters(), pendingFilters: emptyFilters() };
  const listEl = h('div', {});
  const metaEl = h('span', { class: 'foot-note' }, '');
  const input = h('input', { placeholder: t('search_name_ph') });
  const prevBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, t('btn_prev'));
  const nextBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, t('btn_next'));
  const pageInfo = h('span', { class: 'pager-info' }, '');
  const filterButton = h('button', { class: 'btn btn-dark people-filter-trigger', type: 'button' });
  const filterPanel = h('div', { class: 'people-filter-panel', hidden: true });
  const priorityFilters = h('div', { class: 'people-filter-priorities' });

  function arrow(field) {
    if (state.sortField !== field) return '';
    return state.sortDir === 'asc' ? ' ▲' : ' ▼';
  }

  function runQuery() {
    loadInto(listEl, async () => {
      const res = await data.listPeople(ctx, {
        page: state.page, pageSize: PAGE_SIZE, keyword: state.keyword,
        sortField: state.sortField, sortDir: state.sortDir,
        ...state.filters,
      });
      const rows = res.rows || [];
      metaEl.textContent = state.keyword
        ? t('meta_total_kw').replace('{kw}', state.keyword).replace('{total}', res.total)
        : t('meta_total').replace('{total}', res.total);
      pageInfo.textContent = `${res.page} / ${res.totalPages || 1}`;
      prevBtn.disabled = res.page <= 1;
      nextBtn.disabled = !res.hasMore;
      if (!rows.length) {
        return h('div', { class: 'card-body' }, [emptyNote(t('empty_no_people'), state.keyword ? t('empty_people_hint') : t('empty_people_note'))]);
      }
      const thead = h('thead', {}, h('tr', {}, SORT_COLUMNS().map((col) => {
        const th = h('th', {
          class: col.sortable === false ? '' : 'sortable-th',
          title: col.full || undefined,
          onclick: col.sortable === false ? undefined : () => {
            if (state.sortField === col.field) {
              state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
              state.sortField = col.field;
              state.sortDir = 'asc';
            }
            state.page = 1;
            runQuery();
          },
        }, `${col.label}${arrow(col.field)}`);
        return th;
      })));
      const tbody = h('tbody', {}, rows.map((p) => {
        const badges = (p.roles || []).map((role) => {
          const [label, tone] = ROLE_BADGE()[role] || [role, 'gray'];
          return bdg(label, tone);
        });
        if (p.recruit_id) badges.push(bdg(t('badge_recruiting'), 'gold'));
        const cols = SORT_COLUMNS();
        const hasCustomer = (p.roles || []).includes('customer');
        const hasRecruit = (p.roles || []).includes('recruit') || !!p.recruit_id;
        const convertCell = (kind, active) => h('td', {}, active
          ? bdg(t('role_exists'), kind === 'customer' ? 'jade' : 'gold')
          : h('button', {
            class: 'btn btn-ghost btn-sm', type: 'button',
            onclick: (ev) => {
              ev.stopPropagation();
              openPersonRoleConversion(ctx, { person: p, kind, onDone: runQuery });
            },
          }, t(kind === 'customer' ? 'btn_convert_customer' : 'btn_convert_recruit')));
        const cells = [
          h('td', {}, h('a', {}, [p.display_name, h('span', { class: 'badge-stack' }, badges)])),
          h('td', {}, p.sales_priority ? translateEnum('sales_priority', p.sales_priority) : '-'),
          h('td', {}, p.recruitment_priority ? translateEnum('sales_priority', p.recruitment_priority) : '-'),
          h('td', {}, p.referral_priority ? translateEnum('sales_priority', p.referral_priority) : '-'),
          h('td', {}, fmtDate(p.latest_followup_date)),
          h('td', {}, fmtDate(p.next_followup_date)),
          convertCell('customer', hasCustomer),
          convertCell('recruit', hasRecruit),
          h('td', {}, String(p.id)),
        ];
        // Keep existing responsive labels aligned with the localized table headers.
        cells.forEach((td, i) => { if (i > 0) td.setAttribute('data-label', cols[i].label); });
        return h('tr', { onclick: () => { location.hash = `#/person/${p.id}`; } }, cells);
      }));
      return h('div', { class: 'table-scroll' }, h('table', { class: 'people-table' }, [thead, tbody]));
    });
  }

  prevBtn.onclick = () => { if (state.page > 1) { state.page--; runQuery(); } };
  nextBtn.onclick = () => { state.page++; runQuery(); };
  const doSearch = () => {
    state.keyword = input.value.trim().slice(0, 40);
    state.filters = Object.fromEntries(Object.entries(state.pendingFilters).map(([key, values]) => [key, [...values]]));
    state.page = 1;
    filterPanel.hidden = true;
    updateFilterButton();
    runQuery();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  const roles = ['customer', 'recruit', 'referrer', 'speaker', 'participant', 'partner', 'alumni', 'other'];
  const roleLabels = {
    customer: t('customer'), recruit: t('recruit'), referrer: t('role_referrer'),
    speaker: t('speaker'), participant: t('participant'), partner: t('role_partner'),
    alumni: t('role_alumni'), other: t('role_other'),
  };
  function checkboxGroup(values, options, onChange) {
    return h('div', { class: 'people-filter-checks' }, options.map(([value, label]) => {
      const input = h('input', { type: 'checkbox', checked: values.includes(value) });
      input.addEventListener('change', () => onChange(value, input.checked));
      return h('label', { class: 'people-filter-check', 'data-filter-value': value }, [input, h('span', {}, label)]);
    }));
  }
  function renderPriorityFilters() {
    const selectedRoles = state.pendingFilters.roles;
    const groups = [];
    for (const [role, key, labelKey] of [
      ['customer', 'customerPriorities', 'customer'],
      ['recruit', 'recruitPriorities', 'recruit'],
      ['referrer', 'referralPriorities', 'role_referrer'],
    ]) {
      if (!selectedRoles.includes(role)) continue;
      groups.push(h('section', { class: 'people-filter-group' }, [
        h('div', { class: 'people-filter-title' }, t('filter_priority_for').replace('{role}', t(labelKey))),
        checkboxGroup(state.pendingFilters[key], ['A', 'B', 'C', 'D', 'E'].map(value => [value, value]), (value, checked) => {
          const set = new Set(state.pendingFilters[key]);
          checked ? set.add(value) : set.delete(value);
          state.pendingFilters[key] = [...set];
        }),
      ]));
    }
    priorityFilters.replaceChildren(...groups);
  }
  function updateFilterButton() {
    const count = Object.values(state.filters).reduce((sum, values) => sum + values.length, 0);
    filterButton.replaceChildren(
      count ? t('people_filter') : `${t('people_filter')} ${t('filter_none')}`,
      ...(count ? [h('span', { class: 'people-filter-count' }, String(count))] : []),
    );
    filterButton.setAttribute('aria-expanded', String(!filterPanel.hidden));
  }
  function renderFilterPanel() {
    const roleFilters = checkboxGroup(state.pendingFilters.roles, roles.map(role => [role, roleLabels[role]]), (value, checked) => {
      const set = new Set(state.pendingFilters.roles);
      checked ? set.add(value) : set.delete(value);
      state.pendingFilters.roles = [...set];
      if (!checked) {
        const key = { customer: 'customerPriorities', recruit: 'recruitPriorities', referrer: 'referralPriorities' }[value];
        if (key) state.pendingFilters[key] = [];
      }
      renderPriorityFilters();
    });
    const apply = h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: doSearch }, t('btn_search'));
    const reset = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
      state.pendingFilters = emptyFilters();
      renderFilterPanel();
    } }, t('btn_reset'));
    filterPanel.replaceChildren(
      h('div', { class: 'people-filter-title' }, t('filter_role')),
      roleFilters,
      priorityFilters,
      h('div', { class: 'people-filter-actions' }, [reset, apply]),
    );
    renderPriorityFilters();
  }
  filterButton.onclick = () => {
    if (filterPanel.hidden) {
      state.pendingFilters = Object.fromEntries(Object.entries(state.filters).map(([key, values]) => [key, [...values]]));
      renderFilterPanel();
    }
    filterPanel.hidden = !filterPanel.hidden;
    updateFilterButton();
  };
  updateFilterButton();

  ctx.main.replaceChildren(
    pageHead({
      kicker: t('kicker_people'), title: t('title_people'), tag: wpTag(t('wp1_readonly')),
      sub: t('sub_people'),
    }),
    h('div', { class: 'toolbar' }, [
      h('div', { class: 'searchbox' }, [
        ic('search'), input,
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: doSearch }, t('btn_search')),
      ]),
      h('div', { class: 'people-filter-anchor' }, [filterButton, filterPanel]),
      h('a', {
        class: 'btn btn-ghost', href: '#/people-trash',
      }, [ic('trash'), t('btn_trash')]),
      h('button', {
        class: 'btn btn-primary', type: 'button',
        onclick: () => openPersonNew(ctx, { onDone: (newId) => { if (newId) location.hash = `#/person/${newId}`; else runQuery(); } }),
      }, [ic('plus'), t('btn_new_person')]),
    ]),
    h('section', { class: 'card' }, [
      listEl,
      h('div', { class: 'card-foot' }, [
        metaEl,
        h('div', { class: 'pager', style: 'margin-left:auto' }, [prevBtn, pageInfo, nextBtn]),
      ]),
    ]),
  );
  runQuery();
}
