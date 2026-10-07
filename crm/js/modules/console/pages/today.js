// 今日页（WP2）：统计、Today 5（纯事实规则排序）、今日节奏、双向承诺、机会速览。
// WP2 写入闭环：行动/承诺「完成」、候选「审核」经 write.js 服务端 preview→人工确认→execute。
// 晨间简报（WP3 AI）、关系风险（G1 无批量接口）保留骨架。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import { t, getLang, translateEnum } from '../i18n.js';
import { openWorkItemDone, openCandidate } from '../write.js';
import {
  wpTag, sk, pageHead, card, emptyNote, loadInto, bdg, avatar,
  dueLabel, dayDiffFromToday, textOf,
} from '../ui.js';

const settled = (p) => Promise.resolve(p).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));

// 枚举翻译统一走 i18n.js 集中注册表
const oppStatusLabel = (s) => translateEnum('opportunity_status', s);
const oppTypeLabel = (type) => translateEnum('opportunity_type', type);

const WEEKDAY_KEYS = ['weekday_0', 'weekday_1', 'weekday_2', 'weekday_3', 'weekday_4', 'weekday_5', 'weekday_6'];

function fmtBriefDate(d) {
  const locale = getLang() === 'en' ? 'en-US' : 'zh-CN';
  const datePart = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(d);
  return `${datePart} · ${t(WEEKDAY_KEYS[d.getDay()])}`;
}

function briefLoadingCard() {
  const d = new Date();
  return h('section', { class: 'brief' }, [
    h('div', { class: 'brief-head' }, [
      ic('bell'), h('b', {}, t('morning_brief')), wpTag(t('ai_generated')),
      h('span', { style: 'margin-left:auto;font-size:12px;opacity:.7' },
        fmtBriefDate(d)),
    ]),
    h('div', { class: 'brief-body' }, [1, 2, 3].map((i) =>
      h('div', { class: 'brief-row' }, [
        h('span', { class: 'brief-num' }, String(i)),
        h('div', { style: 'flex:1;display:flex;flex-direction:column;gap:8px;padding-top:4px' }, [sk('86%', 't'), sk('58%')]),
      ]))),
  ]);
}

function briefCard(sections) {
  const d = new Date();
  const mb = sections.morningBrief || {};
  const actions = sections.topActions || [];
  const counts = mb.counts || {};
  const sourceTag = mb.guidanceSource === 'ai' ? t('ai_advice') : t('rule_advice');
  const sourceTone = mb.guidanceSource === 'ai' ? 'ink' : 'gray';
  return h('section', { class: 'brief' }, [
    h('div', { class: 'brief-head' }, [
      ic('bell'), h('b', {}, t('morning_brief')), bdg(sourceTag, sourceTone),
      h('span', { style: 'margin-left:auto;font-size:12px;opacity:.7' },
        fmtBriefDate(d)),
    ]),
    h('div', { class: 'brief-body' }, [
      mb.headline ? h('div', { class: 'brief-headline' }, mb.headline) : null,
      mb.guidance ? h('div', { class: 'brief-guidance' }, [
        ic('sparkle'), h('span', {}, mb.guidance),
      ]) : null,
      ...(actions.length ? actions.map((a, i) =>
        h('a', { class: 'brief-row data-row', href: a.target || '#/today' }, [
          h('span', { class: 'brief-num' }, String(i + 1)),
          h('div', { style: 'flex:1;min-width:0' }, [
            h('div', { class: 'row-title' }, a.title || t('unnamed_action')),
            h('div', { class: 'row-sub' }, [
              a.personName ? `${a.personName} · ` : '',
              a.whyNow || '',
              a.source ? h('span', { class: 'src-tag', title: a.source }, a.source.split('#')[0]) : null,
            ].filter(Boolean)),
          ]),
        ])) : [h('div', { class: 'brief-empty' }, t('no_actions'))]),
    ]),
    counts && Object.values(counts).some(Boolean) ? h('div', { class: 'brief-foot' }, [
      counts.overdueCommitments ? bdg(`${t('overdue')} ${counts.overdueCommitments}`, 'red') : null,
      counts.needConfirmation ? bdg(`${t('pending')} ${counts.needConfirmation}`, 'gold') : null,
      counts.opportunities ? bdg(`${t('opportunities')} ${counts.opportunities}`, 'ink') : null,
    ].filter(Boolean)) : null,
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

function actionRow(ctx, item, onDone) {
  const name = item.person_name || t('unnamed');
  const labelMap = { M: [t('must_do'), 'red'], R: [t('should_do'), 'ink'], O: [t('can_do'), 'gray'] };
  const [text, tone] = labelMap[item.level];
  return h('div', { class: 'list-row' }, [
    avatar(name),
    h('div', { style: 'flex:1;min-width:0' }, [
      h('div', { class: 'row-title' }, item.title || t('unnamed_action')),
      h('div', { class: 'row-sub' }, `${name} · ${dueLabel(item._due)}`),
    ]),
    bdg(text, tone),
    h('button', {
      class: 'btn btn-ghost btn-sm', type: 'button',
      onclick: () => openWorkItemDone(ctx, { row: item, onDone }),
    }, [ic('check'), t('done')]),
  ]);
}

function describeCandidate(row) {
  const d = row.draft;
  if (!d) return t('candidate_preview');
  if (typeof d === 'string') return d.slice(0, 140);
  const t = d.opportunity_type || d.title || d.type || '';
  const p = d.last_progress || d.reason || d.summary || '';
  return [t, p].filter(Boolean).join(' · ').slice(0, 140) || t('candidate_preview');
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
  const briefEl = h('div', {});

  // 写入成功后的刷新：整页重渲染（只读数据幂等，代价可接受）。
  function reload() { renderToday(ctx); }

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
      stat(t('todo_actions'), activeCount, 'var(--red)'),
      stat(t('due_commitments'), dueCount, 'var(--gold)'),
      stat(t('pending_candidates'), pendingCount, 'var(--ink-2)'),
      stat(t('upcoming_activities'), upcomingCount, 'var(--jade)'),
    ]);
  }, h('div', { class: 'stat-row' },
    [1, 2, 3, 4].map(() => h('div', { class: 'stat' }, [
      h('b', {}, h('span', { class: 'sk', style: 'width:26px;height:22px;display:inline-block' })),
      h('span', {}, t('loading')),
    ]))));

  loadInto(today5El, async () => {
    const work = await pools.work;
    if (!work.ok) throw work.e;
    const picks = rankActions(work.v.rows);
    return card({
      title: t('priority_actions'), icon: 'chevron', tag: wpTag(t('fact')),
      body: picks.length ? picks.map((r) => actionRow(ctx, r, reload)) : [emptyNote(t('no_actions_today'), t('no_actions_note'))],
      foot: [
        h('span', { class: 'foot-note' }, t('today_foot')),
      ],
    });
  });

  loadInto(candidateEl, async () => {
    const pending = await pools.pending;
    if (!pending.ok) throw pending.e;
    const rows = pending.v.rows || [];
    return card({
      title: t('need_confirmation'), icon: 'shield', tag: wpTag(t('write')),
      body: rows.length
        ? rows.slice(0, 5).map((row) => h('div', { class: 'list-row' }, [
          avatar(row.personName, true),
          h('div', { style: 'flex:1;min-width:0' }, [
            h('div', { class: 'row-title' }, row.personName || t('unnamed')),
            h('div', { class: 'row-sub' }, describeCandidate(row)),
          ]),
          bdg(t('candidate'), 'gold'),
          h('button', {
            class: 'btn btn-soft btn-sm', type: 'button',
            onclick: () => openCandidate(ctx, { row, onDone: reload }),
          }, t('review')),
        ]))
        : [emptyNote(t('no_pending_candidates'), t('no_pending_note'))],
      foot: [h('span', { class: 'foot-note' }, t('candidate_foot'))],
    });
  });

  loadInto(rhythmEl, async () => {
    const cp = await settled(data.cockpit(ctx));
    if (!cp.ok) throw cp.e;
    const trends = cp.v.trends || [];
    const reminders = (cp.v.reminders || []).slice(0, 2);
    const trendTone = { up: 'jade', down: 'red', flat: 'gray' };
    return card({
      title: t('today_rhythm'), icon: 'bell', tag: wpTag(t('rule')),
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
    const typeMap = { THEY_PROMISED: [t('commit_they_promised'), 'gold'], I_PROMISED: [t('commit_i_promised'), 'ink'], MUTUAL: [t('commit_mutual'), 'red'] };
    return card({
      title: t('mutual_commitments'), icon: 'shield', tag: wpTag(t('fact')),
      body: rows.length ? rows.map((r) => {
        const [label, tone] = typeMap[r.commitment_type] || [t('commitment'), 'gray'];
        return h('div', { class: 'list-row' }, [
          h('div', { style: 'flex:1;min-width:0' }, [
            h('div', { class: 'row-title' }, r.content || t('no_content')),
            h('div', { class: 'row-sub' }, `${r.person_name || t('unnamed')} · ${dueLabel(String(r.due_at || '').slice(0, 10))}`),
          ]),
          bdg(label, tone),
          h('button', {
            class: 'btn btn-ghost btn-sm', type: 'button',
            onclick: () => openWorkItemDone(ctx, {
              row: { kind: 'commitment', id: r.id, person_id: r.person_id,
                content: r.content, due_at: r.due_at },
              onDone: reload,
            }),
          }, [ic('check'), t('done')]),
        ]);
      }) : [emptyNote(t('no_due_commitments'), '')],
    });
  });

  const riskCard = card({
    title: t('relation_risk'), icon: 'sparkle', tag: wpTag(t('later')),
    body: [emptyNote(t('risk_placeholder'), t('risk_note'))],
  });

  loadInto(oppEl, async () => {
    const opps = await pools.opps;
    if (!opps.ok) throw opps.e;
    const rows = (opps.v.rows || []).filter((r) => !['成交', '关闭'].includes(r.status));
    return card({
      title: t('opportunity_overview'), icon: 'target', tag: wpTag(t('fact')),
      body: rows.length ? rows.slice(0, 5).map((r) =>
        h('a', { class: 'list-row data-row', href: r.person ? `#/person/${r.person.id}` : '#/opportunities' }, [
          h('div', { style: 'flex:1;min-width:0' }, [
            h('div', { class: 'row-title' }, `${oppTypeLabel(r.opportunity_type) || t('opportunity')} · ${r.person ? r.person.display_name : t('unnamed')}`),
            h('div', { class: 'row-sub' }, textOf(r.next_action) || t('no_next_action')),
          ]),
          bdg(oppStatusLabel(r.status) || t('discovered'), 'gold'),
        ])) : [emptyNote(t('no_opportunities'), '')],
    });
  });

  loadInto(briefEl, async () => {
    const res = await settled(data.morningBrief(ctx));
    if (!res.ok) throw res.e;
    return briefCard(res.v.sections || {});
  }, briefLoadingCard());

  ctx.main.replaceChildren(
    pageHead({
      kicker: t('kicker_today'), title: `${t('good_morning')}，${ctx.operator.name || 'Victor'} · ${t('today_first')}`,
      sub: t('today_sub'),
    }),
    h('div', { class: 'today-grid' }, [
      h('div', {}, [
        briefEl,
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
