// 人物回收站：已软删人物列表 + 恢复（restorePerson 服务端直接执行，同批级联数据一并还原）。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import { openSheet } from '../write.js';
import { pageHead, emptyNote, loadInto } from '../ui.js';
import { t } from '../i18n.js';

const PAGE_SIZE = 20;

function fmtTs(v) {
  if (!v) return '-';
  return String(v).slice(0, 16).replace('T', ' ');
}

export function renderPeopleTrash(ctx) {
  const roles = ['customer', 'recruit', 'referrer', 'speaker', 'participant', 'partner', 'alumni', 'other'];
  const priorityRoles = ['customer', 'recruit', 'referrer'];
  const state = {
    page: 1,
    pending: { roles: [], customerPriorities: [], recruitPriorities: [], referralPriorities: [] },
    applied: { roles: [], customerPriorities: [], recruitPriorities: [], referralPriorities: [] },
  };
  const listEl = h('div', {});
  const priorityFilters = h('div', { class: 'trash-priority-filters' });
  const metaEl = h('span', { class: 'foot-note' }, '');
  const prevBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, t('btn_prev'));
  const nextBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, t('btn_next'));
  const pageInfo = h('span', { class: 'pager-info' }, '');

  const roleLabels = {
    customer: t('customer'), recruit: t('recruit'), referrer: t('role_referrer'),
    speaker: t('speaker'), participant: t('participant'), partner: t('role_partner'),
    alumni: t('role_alumni'), other: t('role_other'),
  };
  function checkboxGroup(values, key, options, onChange) {
    return h('div', { class: 'trash-filter-checks' }, options.map(([value, label]) => {
      const input = h('input', { type: 'checkbox', checked: values.includes(value) });
      input.addEventListener('change', () => onChange(value, input.checked));
      return h('label', { class: 'trash-filter-check' }, [input, h('span', {}, label)]);
    }));
  }
  function renderPriorityFilters() {
    const selectedRoles = state.pending.roles;
    const groups = [];
    const defs = [
      ['customer', 'customerPriorities', t('customer'), 'trash_customer_priority'],
      ['recruit', 'recruitPriorities', t('recruit'), 'trash_recruit_priority'],
      ['referrer', 'referralPriorities', t('role_referrer'), 'trash_referral_priority'],
    ];
    for (const [role, key, label, titleKey] of defs) {
      if (!selectedRoles.includes(role)) continue;
      groups.push(h('section', { class: 'trash-filter-group' }, [
        h('div', { class: 'trash-filter-title' }, t(titleKey).replace('{role}', label)),
        checkboxGroup(state.pending[key], key, ['A', 'B', 'C', 'D', 'E'].map(v => [v, v]), (value, checked) => {
          const set = new Set(state.pending[key]);
          checked ? set.add(value) : set.delete(value);
          state.pending[key] = [...set];
        }),
      ]));
    }
    priorityFilters.replaceChildren(...groups);
  }
  const roleFilters = checkboxGroup(state.pending.roles, 'roles', roles.map(role => [role, roleLabels[role]]), (value, checked) => {
    const set = new Set(state.pending.roles);
    checked ? set.add(value) : set.delete(value);
    state.pending.roles = [...set];
    renderPriorityFilters();
  });
  const applyFilters = h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => {
    state.applied = Object.fromEntries(Object.entries(state.pending).map(([key, values]) => [key, [...values]]));
    state.page = 1;
    runQuery();
  } }, t('btn_search'));
  renderPriorityFilters();

  function openRestore(row) {
    const name = row.display_name || `#${row.id}`;
    const confirmBtn = h('button', { class: 'btn btn-primary', type: 'button' }, t('btn_restore'));
    const sheet = openSheet({
      title: t('restore_person_title'), sub: name,
      body: h('div', {}, [
        h('p', { class: 'sheet-note', style: 'margin:0 0 10px' }, t('restore_person_note')),
        row.batch_scoped ? null : h('p', { class: 'sheet-note', style: 'margin:0 0 10px' }, t('restore_legacy_note')),
        h('div', { class: 'sheet-actions' }, [
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
          confirmBtn,
        ]),
      ]),
    });
    document.body.appendChild(sheet.overlay);
    confirmBtn.onclick = async () => {
      confirmBtn.disabled = true; confirmBtn.textContent = t('restoring');
      try {
        const res = await data.restorePerson(ctx, row.id);
        if (!res || res.ok === false) throw new Error(t('restore_failed'));
        sheet.overlay.remove();
        ctx.toast(t('person_restored'), 'ok');
        runQuery();
      } catch (err) {
        confirmBtn.disabled = false; confirmBtn.textContent = t('btn_restore');
        sheet.showErr(err.message);
      }
    };
  }

  function runQuery() {
    loadInto(listEl, async () => {
      const res = await data.listPersonTrash(ctx, { page: state.page, pageSize: PAGE_SIZE, ...state.applied });
      const rows = res.rows || [];
      pageInfo.textContent = `${res.page}`;
      prevBtn.disabled = res.page <= 1;
      nextBtn.disabled = !res.hasMore;
      metaEl.textContent = '';
      if (!rows.length) {
        return h('div', { class: 'card-body' }, [emptyNote(t('trash_empty'), t('trash_empty_note'))]);
      }
      const thead = h('thead', {}, h('tr', {}, [
        h('th', {}, t('col_name')),
        h('th', {}, t('trash_col_roles')),
        h('th', {}, t('trash_col_deleted_at')),
        h('th', {}, t('trash_col_customer')),
        h('th', {}, t('trash_col_action')),
      ]));
      const tbody = h('tbody', {}, rows.map((r) => {
        const name = r.display_name || `#${r.id}`;
        const customerCell = r.customer_id
          ? (r.customer_deleted ? `#${r.customer_id}` : t('trash_customer_active').replace('{id}', r.customer_id))
          : '-';
        return h('tr', {}, [
          h('td', {}, h('span', { title: t('deleted_person_open_hint') }, name)),
          h('td', { 'data-label': t('trash_col_roles') }, (r.roles || []).map(role => roleLabels[role] || role).join(' · ') || '-'),
          h('td', { 'data-label': t('trash_col_deleted_at') }, fmtTs(r.deleted_at)),
          h('td', { 'data-label': t('trash_col_customer') }, customerCell),
          h('td', { 'data-label': t('trash_col_action') }, h('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openRestore(r),
          }, [ic('refresh'), t('btn_restore')])),
        ]);
      }));
      return h('div', { class: 'table-scroll' }, h('table', { class: 'people-table' }, [thead, tbody]));
    });
  }

  prevBtn.onclick = () => { if (state.page > 1) { state.page--; runQuery(); } };
  nextBtn.onclick = () => { state.page++; runQuery(); };

  ctx.main.replaceChildren(
    pageHead({
      kicker: t('kicker_people_trash'), title: t('title_people_trash'),
      sub: t('sub_people_trash'),
      actions: [h('a', { class: 'btn btn-ghost', href: '#/people' }, [ic('users'), t('title_people')])],
    }),
    h('div', { class: 'people-trash-layout', style: 'display:grid;grid-template-columns:280px minmax(0,1fr);gap:14px;align-items:start' }, [
      h('section', { class: 'card', style: 'padding:14px' }, [
        h('div', { class: 'trash-filter-title' }, t('trash_filter_role')),
        roleFilters,
        priorityFilters,
        h('div', { class: 'sheet-actions', style: 'justify-content:flex-start;margin-top:12px' }, [applyFilters]),
      ]),
      h('section', { class: 'card' }, [
        listEl,
        h('div', { class: 'card-foot' }, [
          metaEl,
          h('div', { class: 'pager', style: 'margin-left:auto' }, [prevBtn, pageInfo, nextBtn]),
        ]),
      ]),
    ]),
  );
  runQuery();
}
