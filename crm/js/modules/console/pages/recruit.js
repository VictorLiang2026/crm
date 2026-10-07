// 组织发展工作台（WP1 只读）：候选人列表（legacy 视图 + person-only 视图合并）、
// 八阶段漏斗（基表计数）、当月目标进度。新增人才/跟进写入在 WP2；六维 AI 评分在 WP3。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import { wpTag, pageHead, emptyNote, loadInto, bdg, fmtDate, dayDiffFromToday, textOf } from '../ui.js';
import { t } from '../i18n.js';

const FUNNEL_STAGES = () => [
  t('funnel_stage_new'),
  t('funnel_stage_icebreak'),
  t('funnel_stage_first_meeting'),
  t('funnel_stage_activity'),
  t('funnel_stage_precision_meeting'),
  t('funnel_stage_onboarding_apply'),
  t('funnel_stage_signed'),
  t('funnel_stage_lost'),
];

function stageTone(stage) {
  if (stage === t('funnel_stage_lost')) return 'gray';
  if (stage === t('funnel_stage_signed')) return 'jade';
  if (stage === t('funnel_stage_onboarding_apply') || stage === t('funnel_stage_precision_meeting')) return 'red';
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
    if (!rows.length) return emptyNote(t('empty_no_recruit_candidates'), t('empty_no_recruit_candidates_note'));

    function openPerson(row, ev) {
      ev.preventDefault();
      if (row.personId) { location.hash = `#/person/${row.personId}`; return; }
      data.lookupCustomer(ctx, row.customerId).then((res) => {
        location.hash = `#/person/${res.personId}`;
      }).catch(() => ctx.toast(t('toast_no_person_identity')));
    }
    return h('div', { class: 'card-body' }, rows.map((row) => {
      const diff = dayDiffFromToday(row.nextDate);
      const subParts = [
        row.occupation,
        textOf(row.nextAction) ? t('next_step') + row.nextAction : '',
        row.nextDate ? `${fmtDate(row.nextDate)}${diff != null && diff < 0 ? t('overdue_days_prefix') + (-diff) + t('day_unit') + t('overdue_days_suffix') : ''}` : '',
        row.idleDays ? t('idle_days_prefix') + row.idleDays + t('day_unit') : '',
      ].filter(Boolean);
      return h('a', { class: 'list-row data-row', href: '#', onclick: (ev) => openPerson(row, ev) }, [
        h('span', { class: 'pavatar sm gold' }, (row.name || t('person_fallback')).charAt(0)),
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, [
            bdg(row.stage || t('stage_unknown'), stageTone(row.stage)),
            row.score != null ? bdg(t('potential_score') + row.score, 'ink') : null,
            row.source === 'person' ? bdg('Person', 'jade') : null,
            h('span', { style: 'margin-left:6px' }, row.name || t('unnamed')),
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
    const allStages = [...FUNNEL_STAGES()];
    Object.keys(counts).forEach((s) => { if (!allStages.includes(s)) allStages.push(s); });
    const max = Math.max(1, ...allStages.map((s) => counts[s] || 0));
    const funnelCard = {
      title: t('funnel_title'), icon: 'recruit', tag: wpTag(t('fact')),
      body: [h('div', {}, allStages.map((s) => {
        const n = counts[s] || 0;
        return h('div', { class: 'funnel-row' }, [
          h('span', { class: s === t('funnel_stage_lost') ? 'funnel-lost' : '' }, s),
          h('span', { class: 'funnel-bar-track' },
            h('span', { class: 'funnel-bar' + (s === t('funnel_stage_lost') ? ' lost' : ''), style: `width:${Math.round((n / max) * 100)}%` })),
          h('span', { class: 'funnel-n' }, String(n)),
        ]);
      }))],
      foot: [h('span', { class: 'foot-note' }, t('funnel_total_prefix') + (funnel.total ?? allStages.reduce((a, s) => a + (counts[s] || 0), 0)) + t('funnel_total_suffix'))],
    };
    const goalRows = (progress.rows || []).filter((r) => (r.target || 0) > 0 || (r.actual || 0) > 0);
    const goalCard = {
      title: month + ' ' + t('goals_title'), icon: 'calendar', tag: wpTag(t('fact')),
      body: goalRows.length ? [h('div', {}, goalRows.map((r) => h('div', { class: 'goal-row' }, [
        h('span', {}, r.stage),
        h('span', { class: 'goal-bar-track' }, h('span', {
          class: 'goal-bar',
          style: `width:${Math.min(100, r.target ? Math.round((r.actual / r.target) * 100) : 0)}%`,
        })),
        h('span', { class: 'goal-n' }, `${r.actual}/${r.target}`),
      ])))] : [emptyNote(t('empty_no_goals'), t('empty_no_goals_note'))],
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
      kicker: t('kicker_recruit'), title: t('title_recruit'), tag: wpTag(t('wp1_readonly')),
      sub: t('sub_recruit'),
      actions: [
        h('button', { class: 'btn btn-ghost', type: 'button', title: t('goals_title'), onclick: () => ctx.toast(t('toast_goals_wp2')) }, [ic('calendar'), t('goals_short')]),
        h('button', { class: 'btn btn-primary', type: 'button', title: t('new_recruit'), onclick: () => ctx.toast(t('toast_new_recruit_wp2')) }, [ic('plus'), t('new_recruit_short')]),
      ],
    }),
    h('div', { class: 'today-grid' }, [
      h('section', { class: 'card' }, [listEl]),
      sideEl,
    ]),
  );
}
