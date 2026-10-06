// 今日页（WP1）：统计、Today 5（纯事实规则排序）、今日节奏、双向承诺、机会速览。
// 晨间简报（WP3 AI）、关系风险（G1 无批量接口）、候选确认操作（WP2）保留骨架。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import {
  wpTag, sk, pageHead, card, emptyNote, loadInto, bdg, avatar,
  dueLabel, dayDiffFromToday, textOf,
} from '../ui.js';

const settled = (p) => Promise.resolve(p).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));

function briefCard() {
  const d = new Date();
  const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()];
  return h('section', { class: 'brief' }, [
    h('div', { class: 'brief-head' }, [
      ic('bell'), h('b', {}, '晨间简报'), wpTag('AI 生成 · WP3'),
      h('span', { style: 'margin-left:auto;font-size:12px;opacity:.7' },
        `${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${week}`),
    ]),
    h('div', { class: 'brief-body' }, [1, 2, 3].map((i) =>
      h('div', { class: 'brief-row' }, [
        h('span', { class: 'brief-num' }, String(i)),
        h('div', { style: 'flex:1;display:flex;flex-direction:column;gap:8px;padding-top:4px' }, [sk('86%', 't'), sk('58%')]),
      ]))),
    h('div', { class: 'brief-foot' }, [
      h('span', {}, '每条要点将带来源与依据，由你确认后才影响今日安排'),
      h('span', { class: 'wp-tag' }, 'WP3 接入'),
    ]),
  ]);
}

function rankActions(rows) {
  const active = rows.filter((r) => r.kind === 'action' && (r.status === 'open' || r.status === 'in_progress'));
  const dueOf = (r) => r.due_at ? String(r.due_at).slice(0, 10) : '';
  const level = (r) => {
    const diff = dayDiffFromToday(dueOf(r));
    if (diff !== null && diff < 0) return 'M';
    if (r.priority === 'urgent') return 'M';
    if (r.priority === 'high' || (diff !== null && diff <= 2)) return 'R';
    return 'O';
  };
  const order = { M: 0, R: 1, O: 2 };
  return active.map((r) => ({ ...r, level: level(r), _due: dueOf(r) }))
    .sort((a, b) => order[a.level] - order[b.level] ||
      (a._due || '9999').localeCompare(b._due || '9999') ||
      String(a.person_name || '').localeCompare(String(b.person_name || '')))
    .slice(0, 5);
}

function actionRow(item) {
  const name = item.person_name || '未命名';
  const labelMap = { M: ['必做', 'red'], R: ['应做', 'ink'], O: ['可做', 'gray'] };
  const [text, tone] = labelMap[item.level];
  return h('div', { class: 'list-row' }, [
    avatar(name),
    h('div', { style: 'flex:1;min-width:0' }, [
      h('div', { class: 'row-title' }, item.title || '未命名行动'),
      h('div', { class: 'row-sub' }, `${name} · ${dueLabel(item._due)}`),
    ]),
    bdg(text, tone),
  ]);
}

function describeCandidate(row) {
  const d = row.draft;
  if (!d) return '机会候选（详情待预览）';
  if (typeof d === 'string') return d.slice(0, 140);
  const t = d.opportunity_type || d.title || d.type || '';
  const p = d.last_progress || d.reason || d.summary || '';
  return [t, p].filter(Boolean).join(' · ').slice(0, 140) || '机会候选（详情待预览）';
}

export function renderToday(ctx) {
  // 一次并发拉取，多张卡片共享同一批 Promise；失败隔离到单卡，可单独重试。
  const pools = {
    work: settled(data.todayWorkItems(ctx)),
    due: settled(data.dueCommitments(ctx)),
    pending: settled(data.pendingOpportunities(ctx)),
    opps: settled(data.opportunityDirectory(ctx, { page: 1, pageSize: 5 })),
    acts: settled(data.activities(ctx)),
  };

  const statsEl = h('div', {});
  const today5El = h('div', {});
  const candidateEl = h('div', {});
  const rhythmEl = h('div', {});
  const commitEl = h('div', {});
  const oppEl = h('div', {});

  loadInto(statsEl, async () => {
    const [work, due, pending, acts] =
      await Promise.all([pools.work, pools.due, pools.pending, pools.acts]);
    const activeCount = work.ok
      ? work.v.rows.filter((r) => r.kind === 'action' && (r.status === 'open' || r.status === 'in_progress')).length
      : null;
    const dueCount = due.ok ? due.v.overdue.length + due.v.dueSoon.length : null;
    const pendingCount = pending.ok ? pending.v.rows.length : null;
    const upcomingCount = acts.ok
      ? acts.v.rows.filter((a) => { const d = dayDiffFromToday(a.activity_date); return d !== null && d >= 0 && d <= 7; }).length
      : null;
    const stat = (label, value, color) => h('div', { class: 'stat' }, [
      h('b', { style: 'color:' + color }, value === null ? '–' : (value > 50 ? '50+' : String(value))),
      h('span', {}, label),
    ]);
    return h('div', { class: 'stat-row' }, [
      stat('待办行动', activeCount, 'var(--red)'),
      stat('待履承诺', dueCount, 'var(--gold)'),
      stat('待确认候选', pendingCount, 'var(--ink-2)'),
      stat('近期活动', upcomingCount, 'var(--jade)'),
    ]);
  }, h('div', { class: 'stat-row' },
    [1, 2, 3, 4].map(() => h('div', { class: 'stat' }, [
      h('b', {}, h('span', { class: 'sk', style: 'width:26px;height:22px;display:inline-block' })),
      h('span', {}, '加载中'),
    ]))));

  loadInto(today5El, async () => {
    const work = await pools.work;
    if (!work.ok) throw work.e;
    const picks = rankActions(work.v.rows);
    return card({
      title: '优先行动 · Today 5', icon: 'chevron', tag: wpTag('事实版'),
      body: picks.length ? picks.map(actionRow) : [emptyNote('今天没有待办行动', '开放行动都已完成，或还没有记录行动。')],
      foot: [
        h('span', { class: 'foot-note' }, '按 必做 M（红）/ 应做 R（墨）/ 可做 O（灰）规则排序；AI 五选三在 WP3 接入'),
      ],
    });
  });

  loadInto(candidateEl, async () => {
    const pending = await pools.pending;
    if (!pending.ok) throw pending.e;
    const rows = pending.v.rows || [];
    return card({
      title: '需要你确认', icon: 'shield', tag: wpTag('WP2 操作'),
      body: rows.length
        ? rows.slice(0, 5).map((row) => h('div', { class: 'list-row' }, [
          avatar(row.personName, true),
          h('div', { style: 'flex:1;min-width:0' }, [
            h('div', { class: 'row-title' }, row.personName || '未命名'),
            h('div', { class: 'row-sub' }, describeCandidate(row)),
          ]),
          bdg('候选', 'gold'),
        ]))
        : [emptyNote('暂无待确认候选', '机会候选由服务端在互动中生成，三键确认在 WP2 接入。')],
      foot: [h('span', { class: 'foot-note' }, '拒绝 / 编辑 / 接受并建机会，三键等宽，全部由你确认')],
    });
  });

  loadInto(rhythmEl, async () => {
    const cp = await settled(data.cockpit(ctx));
    if (!cp.ok) throw cp.e;
    const trends = cp.v.trends || [];
    const reminders = (cp.v.reminders || []).slice(0, 2);
    const trendTone = { up: 'jade', down: 'red', flat: 'gray' };
    return card({
      title: '今日节奏', icon: 'bell', tag: wpTag('规则'),
      body: [
        h('div', { class: 'mini-grid' }, trends.map((t) =>
          h('div', { class: 'mini' }, [
            h('b', {}, t.label),
            bdg(t.text, trendTone[t.trend] || 'gray'),
          ]))),
        reminders.length ? h('div', { style: 'margin-top:10px;display:flex;flex-direction:column;gap:8px' },
          reminders.map((r) => {
            const inner = [h('span', { class: 'reminder-text' }, `${r.icon || ''} ${r.text}`)];
            return r.target && r.target.startsWith('#/')
              ? h('a', { class: 'reminder', href: r.target }, inner)
              : h('div', { class: 'reminder' }, inner);
          })) : null,
      ],
    });
  });

  loadInto(commitEl, async () => {
    const due = await pools.due;
    if (!due.ok) throw due.e;
    const rows = [...due.v.overdue.map((r) => ({ ...r, _grp: 'overdue' })),
      ...due.v.dueSoon.map((r) => ({ ...r, _grp: 'dueSoon' }))].slice(0, 4);
    const typeMap = { THEY_PROMISED: ['对方承诺', 'gold'], I_PROMISED: ['我承诺', 'ink'], MUTUAL: ['双向', 'red'] };
    return card({
      title: '双向承诺', icon: 'shield', tag: wpTag('事实'),
      body: rows.length ? rows.map((r) => {
        const [label, tone] = typeMap[r.commitment_type] || ['承诺', 'gray'];
        return h('div', { class: 'list-row' }, [
          h('div', { style: 'flex:1;min-width:0' }, [
            h('div', { class: 'row-title' }, r.content || '未填写内容'),
            h('div', { class: 'row-sub' }, `${r.person_name || '未命名'} · ${dueLabel(String(r.due_at || '').slice(0, 10))}`),
          ]),
          bdg(label, tone),
        ]);
      }) : [emptyNote('近期没有到期承诺', '')],
    });
  });

  const riskCard = card({
    title: '关系风险', icon: 'sparkle', tag: wpTag('后续'),
    body: [emptyNote('批量关系风险需新增只读接口', '按本轮范围（零云函数变更）保留骨架，待后续单独报批。')],
  });

  loadInto(oppEl, async () => {
    const opps = await pools.opps;
    if (!opps.ok) throw opps.e;
    const rows = (opps.v.rows || []).filter((r) => !['成交', '关闭'].includes(r.status));
    return card({
      title: '机会速览', icon: 'target', tag: wpTag('事实'),
      body: rows.length ? rows.slice(0, 5).map((r) =>
        h('a', { class: 'list-row data-row', href: r.person ? `#/person/${r.person.id}` : '#/opportunities' }, [
          h('div', { style: 'flex:1;min-width:0' }, [
            h('div', { class: 'row-title' }, `${r.opportunity_type || '机会'} · ${r.person ? r.person.display_name : '未关联人物'}`),
            h('div', { class: 'row-sub' }, textOf(r.next_action) || '暂无下一步'),
          ]),
          bdg(r.status || '发现', 'gold'),
        ])) : [emptyNote('暂无进行中的机会', '')],
    });
  });

  ctx.main.replaceChildren(
    pageHead({
      kicker: 'TODAY', title: `早安，${ctx.operator.name || 'Victor'} · 今天先做什么`,
      sub: '先定要事，再看数字。Today 5 为规则排序的开放行动；AI 简报在 WP3 接入。',
    }),
    h('div', { class: 'today-grid' }, [
      h('div', {}, [
        briefCard(),
        h('div', { style: 'height:16px' }),
        statsEl,
        h('div', { style: 'height:16px' }),
        today5El,
        h('div', { style: 'height:16px' }),
        candidateEl,
      ]),
      h('div', { class: 'today-aside' }, [rhythmEl, commitEl, riskCard, oppEl]),
    ]),
  );
}
