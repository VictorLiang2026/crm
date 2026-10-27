// 人物目录：表格形式，表头与 admin.html 客户列表一致，可点击排序。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import { openPersonNew, openPersonRoleConversion } from '../write.js';
import { wpTag, pageHead, emptyNote, loadInto, bdg, textOf, dueLabel } from '../ui.js';
import { t, translateEnum } from '../i18n.js';

const DESKTOP_PAGE_SIZE = 20;
const COMPACT_PAGE_SIZE = 30;

function peoplePageSize() {
  const compactViewport = typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 1180px), (any-pointer: coarse)').matches
    : window.innerWidth <= 1180;
  return compactViewport ? COMPACT_PAGE_SIZE : DESKTOP_PAGE_SIZE;
}
function compactColumnLabel(label, key) {
  if (/[\u3400-\u9fff]/.test(label)) {
    if (key.endsWith('_priority')) return label.replace(/优先级$/, '').slice(-1);
    if (key.endsWith('_followup')) return label.replace(/跟进日期$/, '');
    return label;
  }
  const word = label.match(/[A-Za-z]+/)?.[0];
  if (!word) return label;
  if (key.endsWith('_priority')) return `${word.slice(0, word.startsWith('Ref') ? 3 : 4)}.`;
  return word;
}

const SORT_COLUMNS = (customerView = false, showConversions = true) => ([
  { key: 'name', field: 'display_name', label: t('col_name') },
  ...(customerView ? [
    { key: 'customer_stage', field: 'customer_stage', label: t('customer_view_stage'), sortable: false },
    { key: 'wb_status', field: 'wb_status', label: t('l01_status') },
  ] : []),
  { key: 'customer_priority', field: 'sales_priority', label: t('col_customer_priority'), mobileLabel: compactColumnLabel(t('col_customer_priority'), 'customer_priority') },
  { key: 'recruit_priority', field: 'recruitment_priority', label: t('col_recruit_priority'), mobileLabel: compactColumnLabel(t('col_recruit_priority'), 'recruit_priority') },
  { key: 'referral_priority', field: 'referral_priority', label: t('col_referral_priority'), mobileLabel: compactColumnLabel(t('col_referral_priority'), 'referral_priority') },
  { key: 'latest_followup', field: 'latest_followup_date', label: t('col_latest_followup'), mobileLabel: compactColumnLabel(t('col_latest_followup'), 'latest_followup'), full: t('col_latest_followup_full') },
  { key: 'next_followup', field: 'next_followup_date', label: t('col_next_followup'), mobileLabel: compactColumnLabel(t('col_next_followup'), 'next_followup'), full: t('col_next_followup_full') },
  { key: 'updated_at', field: 'updated_at', label: t('col_recent_update'), mobileLabel: t('col_recent_update_mobile') },
  ...(showConversions ? [
    { key: 'convert_customer', field: 'convert_customer', label: t('col_convert_customer'), sortable: false },
    { key: 'convert_recruit', field: 'convert_recruit', label: t('col_convert_recruit'), sortable: false },
  ] : []),
  customerView
    ? { key: 'customer_id', field: 'customer_id', label: t('col_customer_id') }
    : { key: 'id', field: 'id', label: t('col_id') },
]);

function fmtDate(v) {
  if (!v) return '-';
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function fmtDateShort(v) {
  if (!v) return '-';
  const match = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}` : fmtDate(v);
}

export function renderPeople(ctx) {
  const emptyFilters = () => ({ roles: [], customerPriorities: [], recruitPriorities: [], referralPriorities: [] });
  const state = { page: 1, keyword: '', sortField: 'id', sortDir: 'desc', worklistStatus: 'all', filters: emptyFilters(), pendingFilters: emptyFilters() };
  const listEl = h('div', {});
  const metaEl = h('span', { class: 'foot-note' }, '');
  const input = h('input', { placeholder: t('search_name_ph') });
  const prevBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, t('btn_prev'));
  const nextBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, t('btn_next'));
  const pageInfo = h('span', { class: 'pager-info' }, '');
  const filterButton = h('button', { class: 'btn btn-dark people-filter-trigger', type: 'button' });
  const customerViewButton = h('button', { class: 'btn btn-soft', type: 'button' });
  const filterPanel = h('div', { class: 'people-filter-panel', hidden: true });
  const priorityFilters = h('div', { class: 'people-filter-priorities' });
  const worklistFilter = h('select', { 'aria-label': t('l01_status'), onchange: () => {
    state.worklistStatus = worklistFilter.value;
    state.page = 1; state.sortField = 'wb_status'; state.sortDir = 'asc'; runQuery();
  } }, ['all', 'overdue', 'today', 'month', 'stale', 'normal', 'unknown', 'unlinked'].map(value =>
    h('option', { value }, t('l01_' + value))));
  const worklistTools = h('div', { class: 'toolbar', hidden: true, style: 'display:none' }, [
    h('label', {}, [t('l01_status'), ' ', worklistFilter]),
    h('span', { class: 'foot-note', title: t('l01_basis') }, t('l01_basis')),
  ]);
  let cancelQuery = () => {}, queryVersion = 0;

  function arrow(field) {
    if (state.sortField !== field) return '';
    return state.sortDir === 'asc' ? ' ▲' : ' ▼';
  }

  function runQuery() {
    cancelQuery();
    const version = ++queryVersion;
    cancelQuery = loadInto(listEl, async () => {
      const customerView = state.filters.roles.length === 1 && state.filters.roles[0] === 'customer';
      const recruitView = state.filters.roles.length === 1 && state.filters.roles[0] === 'recruit';
      const showConversions = !customerView && !recruitView;
      worklistTools.hidden = !customerView;
      worklistTools.style.display = customerView ? '' : 'none';
      if (!customerView) {
        state.worklistStatus = 'all'; worklistFilter.value = 'all';
        if (state.sortField === 'wb_status' || state.sortField === 'customer_id') { state.sortField = 'id'; state.sortDir = 'desc'; }
      }
      const res = await data.listPeople(ctx, {
        page: state.page, pageSize: peoplePageSize(), keyword: state.keyword,
        sortField: state.sortField, sortDir: state.sortDir,
        ...state.filters, includeCustomerStage: customerView,
        customerWorklist: customerView, worklistStatus: state.worklistStatus,
      });
      if (version !== queryVersion) return h('span', {});
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
      const columns = SORT_COLUMNS(customerView, showConversions);
      const thead = h('thead', {}, h('tr', {}, columns.map((col) => {
        const th = h('th', {
          class: `people-col-${col.key}${col.sortable === false ? '' : ' sortable-th'}`,
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
        }, [
          h('span', { class: 'people-header-full', 'data-mobile-label': col.mobileLabel || undefined }, col.label),
          h('span', { class: 'people-sort-arrow' }, arrow(col.field)),
        ]);
        return th;
      })));
      const tbody = h('tbody', {}, rows.map((p) => {
        const cols = columns;
        const hasCustomer = (p.roles || []).includes('customer');
        const hasRecruit = (p.roles || []).includes('recruit') || !!p.recruit_id;
        const convertCell = (kind, active) => active
          ? bdg(t('role_exists'), kind === 'customer' ? 'jade' : 'gold')
          : h('button', {
            class: 'btn btn-ghost btn-sm', type: 'button',
            onclick: (ev) => {
              ev.stopPropagation();
              openPersonRoleConversion(ctx, { person: p, kind, onDone: runQuery });
            },
          }, t(kind === 'customer' ? 'btn_convert_customer' : 'btn_convert_recruit'));
        const cell = (key, content) => h('td', { class: `people-col-${key}` }, content);
        const dateCell = (key, value) => {
          const labels = [
            h('span', { class: 'people-date-full' }, fmtDate(value)),
            h('span', { class: 'people-date-mobile', title: fmtDate(value) }, fmtDateShort(value)),
          ];
          return cell(key, value && ['latest_followup', 'next_followup'].includes(key)
            ? h('a', { href: `#/person/${p.id}/timeline`, title: t('people_open_followups'),
              onclick: event => event.stopPropagation() }, labels)
            : labels);
        };
        const cells = [
          cell('name', h('a', { href: `#/person/${p.id}` }, p.display_name)),
          ...(customerView ? [
            cell('customer_stage', p.customer_stage ? translateEnum('customer_stage', p.customer_stage) : '-'),
            cell('wb_status', bdg(p.wb_status === 'overdue' && p.next_followup_date
              ? dueLabel(p.next_followup_date)
              : t('l01_' + (['overdue', 'today', 'month', 'stale', 'normal', 'unlinked'].includes(p.wb_status) ? p.wb_status : 'unknown')),
              p.wb_status === 'overdue' ? 'red' : p.wb_status === 'today' ? 'gold' : 'gray')),
          ] : []),
          cell('customer_priority', p.sales_priority ? translateEnum('sales_priority', p.sales_priority) : '-'),
          cell('recruit_priority', p.recruitment_priority ? translateEnum('sales_priority', p.recruitment_priority) : '-'),
          cell('referral_priority', p.referral_priority ? translateEnum('sales_priority', p.referral_priority) : '-'),
          dateCell('latest_followup', p.latest_followup_date),
          dateCell('next_followup', p.next_followup_date),
          dateCell('updated_at', p.updated_at),
          ...(showConversions ? [
            h('td', { class: 'people-col-convert_customer' }, convertCell('customer', hasCustomer)),
            h('td', { class: 'people-col-convert_recruit' }, convertCell('recruit', hasRecruit)),
          ] : []),
          customerView ? cell('customer_id', p.customer_id == null ? '-' : String(p.customer_id))
            : cell('id', String(p.id)),
        ];
        // Keep existing responsive labels aligned with the localized table headers.
        cells.forEach((td, i) => { if (i > 0) td.setAttribute('data-label', cols[i].label); });
        return h('tr', { onclick: () => { location.hash = `#/person/${p.id}`; } }, cells);
      }));
      return h('div', { class: 'table-scroll people-directory-scroll' }, h('table', { class: 'people-table people-directory-table' }, [thead, tbody]));
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
    updateCustomerViewButton();
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
  function updateCustomerViewButton() {
    const active = state.filters.roles.length === 1 && state.filters.roles[0] === 'customer';
    customerViewButton.textContent = active ? t('people_all_view') : t('people_customer_view');
    customerViewButton.className = active ? 'btn btn-dark' : 'btn btn-soft';
    customerViewButton.setAttribute('aria-pressed', String(active));
  }
  customerViewButton.onclick = () => {
    const active = state.filters.roles.length === 1 && state.filters.roles[0] === 'customer';
    const next = active ? emptyFilters() : { ...emptyFilters(), roles: ['customer'] };
    state.filters = next;
    if (!active) { state.sortField = 'wb_status'; state.sortDir = 'asc'; }
    state.pendingFilters = Object.fromEntries(Object.entries(next).map(([key, values]) => [key, [...values]]));
    state.page = 1;
    filterPanel.hidden = true;
    updateFilterButton();
    updateCustomerViewButton();
    runQuery();
  };
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
      customerViewButton,
      h('a',{class:'btn btn-soft people-toolbar-link',href:'#/people/import'},t('l04_import_title')),
      h('a', {
        class: 'btn btn-soft people-toolbar-link', href: '#/people-trash',
      }, [ic('trash'), t('btn_trash')]),
      h('button', {
        class: 'btn btn-primary', type: 'button',
        onclick: () => openPersonNew(ctx, { onDone: (newId) => { if (newId) location.hash = `#/person/${newId}`; else runQuery(); } }),
      }, [ic('plus'), t('btn_new_person')]),
    ]),
    worklistTools,
    h('section', { class: 'card' }, [
      listEl,
      h('div', { class: 'card-foot' }, [
        metaEl,
        h('div', { class: 'pager', style: 'margin-left:auto' }, [prevBtn, pageInfo, nextBtn]),
      ]),
    ]),
  );
  updateCustomerViewButton();
  runQuery();
}
