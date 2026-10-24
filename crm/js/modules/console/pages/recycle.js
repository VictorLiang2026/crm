// PC35：客户与招募原生回收站，写入仍由各对象现有服务端恢复入口处理。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import { openSheet } from '../write.js';
import { pageHead, emptyNote, loadInto } from '../ui.js';
import { t } from '../i18n.js';

const PAGE_SIZE = 20;
export function renderRecycleHub(ctx) {
  const entries = [
    ['#/people-trash', 'person_trash_entry'],
    ['#/recycle/customers', 'customer_trash_entry'],
    ['#/recycle/recruit', 'recruit_trash_entry'],
  ];
  ctx.main.replaceChildren(
    pageHead({ kicker: t('trash_kicker'), title: t('more_recycle_title'), sub: t('trash_hub_note'),
      actions: [h('a', { class: 'btn btn-ghost', href: '#/more' }, t('title_more'))] }),
    h('div', { class: 'tile-grid recycle-hub' }, entries.map(([href, key]) =>
      h('a', { class: 'tile', href }, [ic('refresh'), h('b', {}, t(key)), h('span', {}, t(key + '_desc'))]))),
    h('details', { class: 'card card-body recycle-legacy' }, [
      h('summary', {}, t('trash_legacy_batch')),
      h('p', { class: 'foot-note' }, t('trash_legacy_batch_note')),
      h('div', { class: 'more-actions' }, [
        h('a', { class: 'btn btn-ghost', href: '/crm/admin.html#/customers/trash' }, t('legacy_customers_trash')),
        h('a', { class: 'btn btn-ghost', href: '/crm/admin.html#/recruit/trash' }, t('legacy_recruit_trash')),
      ]),
    ]),
  );
}

const COUNT_KEYS = [
  ['followups', 'trash_count_followups'], ['gifts', 'trash_count_gifts'],
  ['photos', 'trash_count_photos'], ['policy_review_reports', 'trash_count_reports'],
  ['ocr_records', 'trash_count_ocr'], ['products', 'trash_count_products'],
  ['recruit_candidates', 'trash_count_recruits'],
];

function timestamp(value) {
  return value ? String(value).slice(0, 16).replace('T', ' ') : '-';
}

function scope(row) {
  return t(row.legacy_delete ? 'trash_scope_legacy' : 'trash_scope_batch');
}

function linkedCounts(counts, recruit) {
  const parts = COUNT_KEYS.filter(([key]) => !recruit || key === 'followups')
    .filter(([key]) => Number(counts?.[key]) > 0)
    .map(([key, label]) => `${t(label)} ${counts[key]}`);
  return parts.length ? parts.join(' · ') : t('trash_no_linked');
}

async function fetchRecruit(ctx, state) {
  const legacyRows = [];
  const counts = {};
  let page = 1;
  let total = 0;
  do {
    const result = await data.recruitTrash(ctx, {
      page, pageSize: 100, keyword: state.keyword, sortDir: state.sortDir,
    });
    if (!Array.isArray(result.rows) || !Number.isSafeInteger(Number(result.total))) {
      throw new Error(t('trash_invalid_result'));
    }
    legacyRows.push(...result.rows);
    Object.assign(counts, result.counts || {});
    total = Number(result.total);
    if (!result.rows.length && legacyRows.length < total) throw new Error(t('trash_invalid_result'));
    page++;
  } while (legacyRows.length < total);
  const personOnly = await data.personOnlyRecruitTrash(ctx);
  if (!Array.isArray(personOnly.rows)) throw new Error(t('trash_invalid_result'));
  Object.assign(counts, personOnly.counts || {});
  const needle = state.keyword.toLowerCase();
  const ownRows = personOnly.rows.filter(row => !needle ||
    [row.customer_name, row.occupation].some(value => String(value || '').toLowerCase().includes(needle)));
  const all = [...legacyRows, ...ownRows].sort((a, b) => {
    const order = String(a.candidate_deleted_at || '').localeCompare(String(b.candidate_deleted_at || ''));
    return (state.sortDir === 'asc' ? order : -order) || Number(b.candidate_id) - Number(a.candidate_id);
  });
  const start = (state.page - 1) * PAGE_SIZE;
  return { rows: all.slice(start, start + PAGE_SIZE), total: all.length, counts };
}

function renderTrash(ctx, kind) {
  const recruit = kind === 'recruit';
  const state = { page: 1, keyword: '', sortDir: 'desc' };
  const list = h('div', {});
  const input = h('input', { class: 'sheet-input', type: 'search',
    placeholder: t('trash_search_placeholder'), 'aria-label': t('trash_search_placeholder') });
  const prev = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, t('btn_prev'));
  const next = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, t('btn_next'));
  const pageInfo = h('span', { class: 'pager-info' }, '');
  const totalInfo = h('span', { class: 'foot-note' }, '');

  async function fetchRows() {
    if (recruit) return fetchRecruit(ctx, state);
    const result = await data.customerTrash(ctx, { page: state.page, pageSize: PAGE_SIZE,
      keyword: state.keyword, sortDir: state.sortDir });
    if (!Array.isArray(result.rows) || !Number.isSafeInteger(Number(result.total))) {
      throw new Error(t('trash_invalid_result'));
    }
    return result;
  }

  function openRestore(row, counts) {
    const id = recruit ? row.candidate_id : row.Id;
    const name = row.customer_name || `#${id}`;
    const personOnly = recruit && row.customer_id == null;
    const confirm = h('button', { class: 'btn btn-primary', type: 'button' }, t('btn_restore'));
    const sheet = openSheet({
      title: t(recruit ? 'trash_restore_recruit' : 'trash_restore_customer'), sub: name,
      body: h('div', {}, [
        h('p', { class: 'sheet-note' }, scope(row)),
        h('p', { class: 'sheet-note' }, row.legacy_delete
          ? t('trash_legacy_confirm') : t('trash_batch_confirm')),
        h('p', { class: 'sheet-note' }, row.legacy_delete ? '' : linkedCounts(counts, recruit)),
        personOnly ? h('p', { class: 'sheet-note' }, t('trash_person_only_restore_note')) : null,
        h('div', { class: 'sheet-actions' }, [
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => sheet.overlay.remove() }, t('cancel')),
          confirm,
        ]),
      ]),
    });
    document.body.appendChild(sheet.overlay);
    confirm.onclick = async () => {
      confirm.disabled = true;
      confirm.textContent = t('restoring');
      try {
        const result = recruit
          ? await data.restoreRecruit(ctx, id, personOnly)
          : await data.restoreCustomer(ctx, id);
        if (result?.ok === false || result?.skipped?.length) {
          throw new Error(result?.skipped?.[0]?.reason || t('restore_failed'));
        }
        sheet.overlay.remove();
        ctx.toast(result?.legacy_restored?.length ? t('trash_legacy_restored') : t('person_restored'), 'ok');
        runQuery();
      } catch (error) {
        confirm.disabled = false;
        confirm.textContent = t('btn_restore');
        sheet.showErr(error.message);
      }
    };
  }

  function runQuery() {
    loadInto(list, async () => {
      const result = await fetchRows();
      const rows = result.rows;
      const total = Number(result.total) || 0;
      prev.disabled = state.page <= 1;
      next.disabled = state.page * PAGE_SIZE >= total;
      pageInfo.textContent = `${state.page}`;
      totalInfo.textContent = t('trash_total').replace('{count}', String(total));
      if (!rows.length) return h('div', { class: 'card-body' }, [
        emptyNote(t('trash_empty'), t('trash_empty_note')),
      ]);
      const headers = recruit
        ? ['col_name', 'trash_col_source', 'trash_col_deleted_at', 'trash_col_scope', 'trash_col_linked', 'trash_col_action']
        : ['col_name', 'trash_col_deleted_at', 'trash_col_scope', 'trash_col_linked', 'trash_col_action'];
      const head = h('thead', {}, h('tr', {}, headers.map(key => h('th', {}, t(key)))));
      const body = h('tbody', {}, rows.map(row => {
        const id = recruit ? row.candidate_id : row.Id;
        const counts = recruit ? result.counts?.[id] : result.recoverable_counts?.[id];
        const cells = [h('td', { 'data-label': t('col_name') }, row.customer_name || `#${id}`)];
        if (recruit) cells.push(h('td', { 'data-label': t('trash_col_source') },
          t(row.customer_id == null ? 'trash_person_only' : 'trash_customer_linked')));
        cells.push(
          h('td', { 'data-label': t('trash_col_deleted_at') }, timestamp(recruit ? row.candidate_deleted_at : row.deleted_at)),
          h('td', { 'data-label': t('trash_col_scope') }, scope(row)),
          h('td', { 'data-label': t('trash_col_linked') }, row.legacy_delete
            ? t('trash_legacy_linked') : linkedCounts(counts, recruit)),
          h('td', { 'data-label': t('trash_col_action') }, h('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openRestore(row, counts),
          }, [ic('refresh'), t('btn_restore')])),
        );
        return h('tr', {}, cells);
      }));
      return h('div', { class: 'table-scroll' }, h('table', { class: 'people-table' }, [head, body]));
    });
  }

  const form = h('form', { class: 'search-form', onsubmit: event => {
    event.preventDefault(); state.keyword = input.value.trim(); state.page = 1; runQuery();
  } }, [input, h('button', { class: 'btn btn-soft', type: 'submit' }, t('btn_search'))]);
  const sort = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
    state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
    sort.textContent = t(state.sortDir === 'desc' ? 'trash_sort_newest' : 'trash_sort_oldest');
    state.page = 1; runQuery();
  } }, t('trash_sort_newest'));
  prev.onclick = () => { if (state.page > 1) { state.page--; runQuery(); } };
  next.onclick = () => { state.page++; runQuery(); };
  ctx.main.replaceChildren(
    pageHead({ kicker: t('trash_kicker'), title: t(recruit ? 'recruit_trash_entry' : 'customer_trash_entry'),
      sub: t(recruit ? 'trash_recruit_sub' : 'trash_customer_sub'),
      actions: [h('a', { class: 'btn btn-ghost', href: '#/recycle' }, [ic('refresh'), t('trash_hub_back')]),
        h('a', { class: 'btn btn-ghost', href: '#/more' }, [ic('grid'), t('title_more')])] }),
    h('section', { class: 'card' }, [
      h('div', { class: 'card-body' }, [form, sort]), list,
      h('div', { class: 'card-foot' }, [totalInfo,
        h('div', { class: 'pager', style: 'margin-left:auto' }, [prev, pageInfo, next])]),
    ]),
  );
  runQuery();
}

export const renderCustomerTrash = ctx => renderTrash(ctx, 'customer');
export const renderRecruitTrash = ctx => renderTrash(ctx, 'recruit');
