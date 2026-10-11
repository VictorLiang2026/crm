// 人物目录：表格形式，表头与 admin.html 客户列表一致，可点击排序。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import { openPersonNew } from '../write.js';
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
  { field: 'sales_priority', label: t('col_priority') },
  { field: 'customer_stage', label: t('col_customer_stage'), full: t('col_customer_stage_full') },
  { field: 'latest_followup_date', label: t('col_latest_followup'), full: t('col_latest_followup_full') },
  { field: 'next_followup_date', label: t('col_next_followup'), full: t('col_next_followup_full') },
  { field: 'id', label: t('col_id') },
]);

function fmtDate(v) {
  if (!v) return '-';
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

export function renderPeople(ctx) {
  const state = { page: 1, keyword: '', sortField: 'id', sortDir: 'desc' };
  const listEl = h('div', {});
  const metaEl = h('span', { class: 'foot-note' }, '');
  const input = h('input', { placeholder: t('search_name_ph') });
  const prevBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, t('btn_prev'));
  const nextBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, t('btn_next'));
  const pageInfo = h('span', { class: 'pager-info' }, '');

  function arrow(field) {
    if (state.sortField !== field) return '';
    return state.sortDir === 'asc' ? ' ▲' : ' ▼';
  }

  function runQuery() {
    loadInto(listEl, async () => {
      const res = await data.listPeople(ctx, {
        page: state.page, pageSize: PAGE_SIZE, keyword: state.keyword,
        sortField: state.sortField, sortDir: state.sortDir,
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
          class: 'sortable-th',
          title: col.full || undefined,
          onclick: () => {
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
        const cells = [
          h('td', {}, h('a', {}, [p.display_name, h('span', { class: 'badge-stack' }, badges)])),
          h('td', {}, p.sales_priority ? translateEnum('sales_priority', p.sales_priority) : '-'),
          h('td', {}, p.customer_stage ? h('span', { class: 'badge stage' }, translateEnum('customer_stage', p.customer_stage)) : '-'),
          h('td', {}, fmtDate(p.latest_followup_date)),
          h('td', {}, fmtDate(p.next_followup_date)),
          h('td', {}, String(p.id)),
        ];
        // 手机卡片式布局用：td 携带字段名（与表头同源，i18n 一致）
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
    state.page = 1;
    runQuery();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

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
      h('a', {
        class: 'btn btn-ghost', href: '#/people-trash', style: 'margin-left:auto',
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
