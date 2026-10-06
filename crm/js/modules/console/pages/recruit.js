// 组织发展工作台（WP1 只读）：候选人列表（legacy 视图 + person-only 视图合并）、
// 八阶段漏斗（基表计数）、当月目标进度。新增人才/跟进写入在 WP2；六维 AI 评分在 WP3。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import { wpTag, pageHead, emptyNote, loadInto, bdg, fmtDate, dayDiffFromToday, textOf } from '../ui.js';

const FUNNEL_STAGES = ['新增人才', '互动破冰', '初次面谈', '增员活动', '精准面谈', '入职申请', '签约入职', '流失'];

function stageTone(stage) {
  if (stage === '流失') return 'gray';
  if (stage === '签约入职') return 'jade';
  if (stage === '入职申请' || stage === '精准面谈') return 'red';
  return 'gold';
}

function listNode(ctx) {
  return Promise.all([
    data.recruitList(ctx, { page: 1, pageSize: 1000 }).catch((e) => ({ _error: e })),
    data.recruitPersonOnly(ctx).catch((e) => ({ _error: e })),
  ]).then(([legacy, personOnly]) => {
    if (legacy._error && personOnly._error) throw legacy._error;
    const norm = (r, source) => ({
      id: r.candidate_id ?? r.id,
      name: r.customer_name,
      stage: r.stage,
      occupation: r.occupation,
      score: r.potential_score,
      nextAction: r.next_action,
      nextDate: r.next_action_date,
      idleDays: r.idle_days,
      personId: r.person_id,
      customerId: r.customer_id,
      source,
    });
    const rows = [
      ...(legacy.rows || []).map((r) => norm(r, 'legacy')),
      ...(personOnly.rows || []).map((r) => norm(r, 'person')),
    ].sort((a, b) => String(b.nextDate || '').localeCompare(String(a.nextDate || '')));
    if (!rows.length) return emptyNote('暂无增员候选人', '新增人才在 WP2 接入。');

    function openPerson(row, ev) {
      ev.preventDefault();
      if (row.personId) { location.hash = `#/person/${row.personId}`; return; }
      data.lookupCustomer(ctx, row.customerId).then((res) => {
        location.hash = `#/person/${res.personId}`;
      }).catch(() => ctx.toast('该旧客户尚未建立 Person 身份，WP2 接入身份处理'));
    }
    return h('div', { class: 'card-body' }, rows.map((row) => {
      const diff = dayDiffFromToday(row.nextDate);
      const subParts = [
        row.occupation,
        textOf(row.nextAction) ? '下一步：' + row.nextAction : '',
        row.nextDate ? `${fmtDate(row.nextDate)}${diff != null && diff < 0 ? '（已过 ' + -diff + ' 天）' : ''}` : '',
        row.idleDays ? `停留 ${row.idleDays} 天` : '',
      ].filter(Boolean);
      return h('a', { class: 'list-row data-row', href: '#', onclick: (ev) => openPerson(row, ev) }, [
        h('span', { class: 'pavatar sm gold' }, (row.name || '人').charAt(0)),
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, [
            bdg(row.stage || '阶段未知', stageTone(row.stage)),
            row.score != null ? bdg('潜力 ' + row.score, 'ink') : null,
            row.source === 'person' ? bdg('Person', 'jade') : null,
            h('span', { style: 'margin-left:6px' }, row.name || '未命名'),
          ]),
          h('div', { class: 'row-sub' }, subParts.join(' · ')),
        ]),
        ic('chevron', 'mut'),
      ]);
    }));
  });
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
    const allStages = [...FUNNEL_STAGES];
    Object.keys(counts).forEach((s) => { if (!allStages.includes(s)) allStages.push(s); });
    const max = Math.max(1, ...allStages.map((s) => counts[s] || 0));
    const funnelCard = {
      title: '八阶段漏斗', icon: 'recruit', tag: wpTag('事实'),
      body: [h('div', {}, allStages.map((s) => {
        const n = counts[s] || 0;
        return h('div', { class: 'funnel-row' }, [
          h('span', { class: s === '流失' ? 'funnel-lost' : '' }, s),
          h('span', { class: 'funnel-bar-track' },
            h('span', { class: 'funnel-bar' + (s === '流失' ? ' lost' : ''), style: `width:${Math.round((n / max) * 100)}%` })),
          h('span', { class: 'funnel-n' }, String(n)),
        ]);
      }))],
      foot: [h('span', { class: 'foot-note' }, `总数 ${funnel.total ?? allStages.reduce((a, s) => a + (counts[s] || 0), 0)} · 小样本（<3）只显示数字，不做趋势判断`)],
    };
    const goalRows = (progress.rows || []).filter((r) => (r.target || 0) > 0 || (r.actual || 0) > 0);
    const goalCard = {
      title: `${month} 月度目标`, icon: 'calendar', tag: wpTag('事实'),
      body: goalRows.length ? [h('div', {}, goalRows.map((r) => h('div', { class: 'goal-row' }, [
        h('span', {}, r.stage),
        h('span', { class: 'goal-bar-track' }, h('span', {
          class: 'goal-bar',
          style: `width:${Math.min(100, r.target ? Math.round((r.actual / r.target) * 100) : 0)}%`,
        })),
        h('span', { class: 'goal-n' }, `${r.actual}/${r.target}`),
      ])))] : [emptyNote('本月未设定目标', '目标维护在旧版 admin.html。')],
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
      kicker: 'RECRUIT', title: '组织发展工作台', tag: wpTag('WP1 只读'),
      sub: '八阶段漏斗 · 候选人统一以 Person 身份归档；点候选人进入 Person 360。',
      actions: [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => ctx.toast('目标维护当前在 admin.html，console 编辑在 WP2 接入') }, [ic('calendar'), '月度目标']),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.toast('新增人才在 WP2 接入') }, [ic('plus'), '新增人才']),
      ],
    }),
    h('div', { class: 'today-grid' }, [
      h('section', { class: 'card' }, [listEl]),
      sideEl,
    ]),
  );
}
