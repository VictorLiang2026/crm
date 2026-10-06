// 人物目录：表格形式，表头与 admin.html 客户列表一致，可点击排序。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import { wpTag, pageHead, emptyNote, loadInto, bdg, textOf } from '../ui.js';

const PAGE_SIZE = 20;
const ROLE_BADGE = {
  customer: ['客户', 'ink'],
  recruit: ['增员', 'gold'],
  speaker: ['嘉宾', 'jade'],
};

const SORT_COLUMNS = [
  { field: 'display_name', label: '姓名' },
  { field: 'sales_priority', label: '优先级' },
  { field: 'customer_stage', label: '客户经营阶段' },
  { field: 'latest_followup_date', label: '本次跟进日期' },
  { field: 'next_followup_date', label: '下次跟进日期' },
  { field: 'id', label: '编号' },
];

function fmtDate(v) {
  if (!v) return '-';
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

export function renderPeople(ctx) {
  const state = { page: 1, keyword: '', sortField: 'id', sortDir: 'desc' };
  const listEl = h('div', {});
  const metaEl = h('span', { class: 'foot-note' }, '');
  const input = h('input', { placeholder: '搜索姓名' });
  const prevBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, '上一页');
  const nextBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, '下一页');
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
      metaEl.textContent = state.keyword ? `「${state.keyword}」共 ${res.total} 人` : `共 ${res.total} 人`;
      pageInfo.textContent = `${res.page} / ${res.totalPages || 1}`;
      prevBtn.disabled = res.page <= 1;
      nextBtn.disabled = !res.hasMore;
      if (!rows.length) {
        return h('div', { class: 'card-body' }, [emptyNote('没有匹配的人物', state.keyword ? '换个姓名关键词试试。' : '尚无人物记录。')]);
      }
      const thead = h('thead', {}, h('tr', {}, SORT_COLUMNS.map((col) => {
        const th = h('th', { class: 'sortable-th', onclick: () => {
          if (state.sortField === col.field) {
            state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            state.sortField = col.field;
            state.sortDir = 'asc';
          }
          state.page = 1;
          runQuery();
        } }, `${col.label}${arrow(col.field)}`);
        return th;
      })));
      const tbody = h('tbody', {}, rows.map((p) => {
        const badges = (p.roles || []).map((role) => {
          const [label, tone] = ROLE_BADGE[role] || [role, 'gray'];
          return bdg(label, tone);
        });
        if (p.recruit_id) badges.push(bdg('在增员', 'gold'));
        return h('tr', { onclick: () => { location.hash = `#/person/${p.id}`; } }, [
          h('td', {}, h('a', {}, [p.display_name, h('span', { class: 'badge-stack' }, badges)])),
          h('td', {}, p.sales_priority || '-'),
          h('td', {}, p.customer_stage ? h('span', { class: 'badge stage' }, p.customer_stage) : '-'),
          h('td', {}, fmtDate(p.latest_followup_date)),
          h('td', {}, fmtDate(p.next_followup_date)),
          h('td', {}, String(p.id)),
        ]);
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
      kicker: 'PEOPLE', title: '人物目录', tag: wpTag('WP1 只读'),
      sub: '客户、增员、嘉宾统一为 Person 身份；表头可点击排序。',
    }),
    h('div', { class: 'toolbar' }, [
      h('div', { class: 'searchbox' }, [
        ic('search'), input,
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: doSearch }, '搜索'),
      ]),
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
