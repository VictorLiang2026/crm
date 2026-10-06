// 人物目录（WP1）：服务端姓名搜索 + 分页（person_directory_page_v1），行内角色徽标。
// 按本轮决策：chips 多维筛选暂缓（RPC 仅支持姓名 keyword）。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import { wpTag, pageHead, emptyNote, loadInto, bdg, avatar, textOf } from '../ui.js';

const PAGE_SIZE = 20;
const ROLE_BADGE = {
  customer: ['客户', 'ink'],
  recruit: ['增员', 'gold'],
  speaker: ['嘉宾', 'jade'],
};

export function renderPeople(ctx) {
  const state = { page: 1, keyword: '' };
  const listEl = h('div', {});
  const metaEl = h('span', { class: 'foot-note' }, '');
  const input = h('input', { placeholder: '按姓名搜索（服务端分页，每页 20 人）' });
  const prevBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, '上一页');
  const nextBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, '下一页');
  const pageInfo = h('span', { class: 'pager-info' }, '');

  function runQuery() {
    loadInto(listEl, async () => {
      const res = await data.listPeople(ctx, {
        page: state.page, pageSize: PAGE_SIZE, keyword: state.keyword, sortField: 'id', sortDir: 'desc',
      });
      const rows = res.rows || [];
      metaEl.textContent = state.keyword ? `「${state.keyword}」共 ${res.total} 人` : `共 ${res.total} 人`;
      pageInfo.textContent = `${res.page} / ${res.totalPages || 1}`;
      prevBtn.disabled = res.page <= 1;
      nextBtn.disabled = !res.hasMore;
      if (!rows.length) {
        return h('div', { class: 'card-body' }, [emptyNote('没有匹配的人物', state.keyword ? '换个姓名关键词试试。' : '尚无人物记录。')]);
      }
      return h('div', { class: 'card-body' }, rows.map((p) => {
        const badges = (p.roles || []).map((role) => {
          const [label, tone] = ROLE_BADGE[role] || [role, 'gray'];
          return bdg(label, tone);
        });
        if (p.recruit_id) badges.push(bdg('在增员', 'gold'));
        const subParts = [p.occupation, p.organization].map(textOf).filter(Boolean);
        return h('a', { class: 'list-row data-row', href: `#/person/${p.id}` }, [
          avatar(p.display_name, !!p.recruit_id),
          h('div', { style: 'flex:1;min-width:0' }, [
            h('div', { class: 'row-title' }, [p.display_name, h('span', { class: 'badge-stack' }, badges)]),
            h('div', { class: 'row-sub' }, subParts.join(' · ') || (p.customer_id ? `Legacy 客户 #${p.customer_id}` : 'Person 身份')),
          ]),
          ic('chevron', 'mut'),
        ]);
      }));
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
      sub: '客户、增员、嘉宾统一为 Person 身份；按精确 ID 关联，不按姓名自动合并。',
      actions: [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => ctx.toast('身份候选审核在 WP2 接入（AI 仅提名，人工确认）') }, [ic('users'), '身份候选']),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.toast('新建人物在 WP2 接入') }, [ic('plus'), '新建人物']),
      ],
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
        h('span', { style: 'display:flex;align-items:center;gap:10px' }, [
          metaEl,
          h('span', { class: 'foot-note' }, '多维筛选（A 级 / 本周有互动）待服务端过滤能力后启用'),
        ]),
        h('div', { class: 'pager', style: 'margin-left:auto' }, [prevBtn, pageInfo, nextBtn]),
      ]),
    ]),
  );
  runQuery();
}
