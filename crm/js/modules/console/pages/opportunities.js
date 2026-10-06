// 经营机会（WP1 只读）：四列看板 + 待确认候选只读列表。
// 「已关闭/结果」视图 G3 本轮保留骨架（目录接口无 status 过滤参数）；新建/推进/关闭在 WP2。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import { wpTag, pageHead, card, emptyNote, loadInto, bdg, fmtDate, textOf } from '../ui.js';

const COLS = [
  ['发现', 'v0'], ['沟通', 'v1'], ['方案', 'v2'], ['成交', 'v3'],
];

function describeDraft(d) {
  if (!d) return '机会候选（详情待预览）';
  if (typeof d === 'string') return d.slice(0, 140);
  const t = d.opportunity_type || d.title || d.type || '';
  const p = d.last_progress || d.reason || d.summary || '';
  return [t, p].filter(Boolean).join(' · ').slice(0, 140) || '机会候选（详情待预览）';
}

function oppCard(row) {
  const name = row.person ? row.person.display_name : '未关联人物';
  return h('a', {
    class: 'kcard',
    href: row.person ? `#/person/${row.person.id}` : '#/opportunities',
    onclick: row.person ? null : (e) => e.preventDefault(),
  }, [
    h('div', { class: 'kcard-title' }, row.opportunity_type || '机会'),
    h('div', { class: 'kcard-name' }, name),
    h('div', { class: 'kcard-note' }, textOf(row.next_action) || '暂无下一步'),
    row.next_action_date ? h('div', { class: 'kcard-date' }, fmtDate(row.next_action_date)) : null,
  ]);
}

export function renderOpportunities(ctx) {
  const pendingEl = h('div', {});
  const boardEl = h('div', {});

  loadInto(pendingEl, async () => {
    const res = await data.pendingOpportunities(ctx);
    const rows = res.rows || [];
    return card({
      title: '待确认候选', icon: 'sparkle', tag: wpTag('WP2 操作'),
      body: rows.length ? rows.slice(0, 6).map((row) => h('div', { class: 'list-row' }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, row.personName || '未命名'),
          h('div', { class: 'row-sub' }, describeCandidateSafe(row)),
        ]),
        bdg(row.status === 'confirmed' ? '已确认' : '待确认', 'gold'),
      ])) : [emptyNote('暂无待确认候选', 'AI 候选生成后进入这里；拒绝 / 编辑 / 接受三键在 WP2 接入。')],
    });
  });

  function describeCandidateSafe(row) { return describeDraft(row.draft); }

  loadInto(boardEl, async () => {
    const res = await data.opportunityDirectory(ctx, { page: 1, pageSize: 50 });
    const rows = res.rows || [];
    const buckets = { 发现: [], 沟通: [], 方案: [], 成交: [] };
    rows.forEach((r) => { if (buckets[r.status]) buckets[r.status].push(r); });
    const closed = rows.filter((r) => r.status === '关闭').length;
    return h('div', {}, [
      h('div', { class: 'kanban' }, COLS.map(([name, dot]) =>
        h('div', { class: 'kcol' }, [
          h('div', { class: 'kcol-head' }, [
            h('span', { style: 'display:flex;align-items:center;gap:7px' }, [h('i', { class: 'kdot ' + dot }), name]),
            h('span', { class: 'kcount' }, String(buckets[name].length)),
          ]),
          buckets[name].length
            ? h('div', { class: 'kbody' }, buckets[name].map(oppCard))
            : h('div', { class: 'kempty' }, '暂无'),
        ]))),
      h('p', { class: 'foot-note', style: 'margin-top:12px' },
        (res.hasMore ? '显示最近 50 条开放机会；' : '') +
        (closed ? `另有 ${closed} 条已关闭（结果视图待后续开放）；` : '') +
        '阶段不由 AI 自动推进，关闭时记录 Outcome（WP2）。'),
    ]);
  });

  ctx.main.replaceChildren(
    pageHead({
      kicker: 'OPPORTUNITIES', title: '经营机会', tag: wpTag('WP1 只读'),
      sub: '候选审核后才进入业务；阶段推进与关闭都先预览确认，关闭时记录 Outcome。',
      actions: [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => ctx.toast('已关闭/结果视图待目录接口支持状态过滤后开放') }, [ic('grid'), '已关闭/结果']),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.toast('新建机会在 WP2 接入') }, [ic('plus'), '新建机会']),
      ],
    }),
    pendingEl,
    h('div', { style: 'height:16px' }),
    boardEl,
  );
}
