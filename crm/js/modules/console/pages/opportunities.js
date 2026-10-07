// 经营机会（WP2 写入闭环）：四列看板 + 待确认候选三键审核 + 推进/关闭/新建。
// 「已关闭/结果」视图 G3 保留骨架（目录接口无 status 过滤参数）。
// 全部写操作经 write.js：服务端 preview → 人工确认 → execute。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import { openCandidate, openOpportunityAdvance, openOpportunityCreate } from '../write.js';
import { wpTag, pageHead, card, emptyNote, loadInto, bdg, fmtDate, textOf } from '../ui.js';
import { t, tFull } from '../i18n.js';

const COL_KEYS = [
  ['opp_col_discovered', 'v0', '发现'],
  ['opp_col_contacted', 'v1', '沟通'],
  ['opp_col_proposal', 'v2', '方案'],
  ['opp_col_won', 'v3', '成交'],
];

// 机会状态 i18n 映射（数据库值为中文）
const OPP_STATUS_I18N = {
  '发现': 'stage_discovered',
  '沟通': 'stage_contacted',
  '方案': 'stage_proposal',
  '成交': 'stage_won',
  '关闭': 'stage_closed',
};
function oppStatusLabel(status) { return t(OPP_STATUS_I18N[status] || status); }

// 机会类型 i18n 映射（数据库值为中文或英文 key）
const OPP_TYPE_I18N = {
  '医疗保障': 'opp_type_insurance',
  '重疾保障': 'opp_type_insurance',
  '养老规划': 'opp_type_insurance',
  '教育规划': 'opp_type_insurance',
  '财富规划': 'opp_type_insurance',
  '家庭保障': 'opp_type_insurance',
  '转介绍': 'opp_type_referral',
  'insurance': 'opp_type_insurance',
  'recruit': 'opp_type_recruit',
  'referral': 'opp_type_referral',
  'activity': 'opp_type_activity',
  'speaker': 'opp_type_speaker',
  'partnership': 'opp_type_partnership',
  'service': 'opp_type_service',
  'relationship': 'opp_type_relationship',
};
function oppTypeLabel(type) { return t(OPP_TYPE_I18N[type] || type); }

function describeDraft(d) {
  if (!d) return t('candidate_preview');
  if (typeof d === 'string') return d.slice(0, 140);
  const tt = d.opportunity_type || d.title || d.type || '';
  const p = d.last_progress || d.reason || d.summary || '';
  return [tt, p].filter(Boolean).join(' · ').slice(0, 140) || t('candidate_preview');
}

function oppCard(ctx, row, reload) {
  const name = row.person ? row.person.display_name : t('opp_no_link_person');
  const nav = row.person ? `#/person/${row.person.id}` : '#/opportunities';
  const canWrite = Boolean(row.person && row.id);
  return h('div', {
    class: 'kcard',
    onclick: () => { location.hash = nav; },
  }, [
    h('div', { class: 'kcard-title' }, oppTypeLabel(row.opportunity_type) || t('opp_default_title')),
    h('div', { class: 'kcard-name' }, name),
    h('div', { class: 'kcard-note' }, textOf(row.next_action) || t('opp_no_next_action')),
    row.next_action_date ? h('div', { class: 'kcard-date' }, fmtDate(row.next_action_date)) : null,
    row.status !== '成交' && row.status !== '关闭' ? h('div', { style: 'margin-top:8px;display:flex;gap:6px' }, [
      h('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        title: tFull('opp_btn_advance_close'),
        onclick: (e) => {
          e.stopPropagation();
          if (!canWrite) { ctx.toast(t('opp_toast_no_person')); return; }
          openOpportunityAdvance(ctx, { opportunity: row, personName: name, onDone: reload });
        },
      }, t('opp_btn_advance_close')),
    ]) : bdg(oppStatusLabel(row.status) || '', row.status === '成交' ? 'jade' : 'gray'),
  ]);
}

export function renderOpportunities(ctx) {
  const pendingEl = h('div', {});
  const boardEl = h('div', {});

  // 写入成功后的刷新：整页重渲染（只读数据幂等）。
  function reload() { renderOpportunities(ctx); }

  loadInto(pendingEl, async () => {
    const res = await data.pendingOpportunities(ctx);
    const rows = res.rows || [];
    return card({
      title: t('opp_pending_review'), icon: 'sparkle', tag: wpTag(t('opp_pending_tag')),
      body: rows.length ? rows.slice(0, 6).map((row) => h('div', { class: 'list-row' }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, row.personName || t('unnamed')),
          h('div', { class: 'row-sub' }, describeDraft(row.draft)),
        ]),
        bdg(row.status === 'confirmed' ? t('opp_confirmed') : t('opp_pending'), 'gold'),
        h('button', {
          class: 'btn btn-soft btn-sm', type: 'button',
          onclick: () => openCandidate(ctx, { row, onDone: reload }),
        }, t('opp_review')),
      ])) : [emptyNote(t('opp_empty_pending'), t('opp_empty_pending_note'))],
      foot: [h('span', { class: 'foot-note' }, t('opp_foot_note'))],
    });
  });

  loadInto(boardEl, async () => {
    const res = await data.opportunityDirectory(ctx, { page: 1, pageSize: 50 });
    const rows = res.rows || [];
    const buckets = { 发现: [], 沟通: [], 方案: [], 成交: [] };
    rows.forEach((r) => { if (buckets[r.status]) buckets[r.status].push(r); });
    const closed = rows.filter((r) => r.status === '关闭').length;
    return h('div', {}, [
      h('div', { class: 'kanban' }, COL_KEYS.map(([key, dot, zhName]) =>
        h('div', { class: 'kcol' }, [
          h('div', { class: 'kcol-head' }, [
            h('span', { style: 'display:flex;align-items:center;gap:7px' }, [h('i', { class: 'kdot ' + dot }), t(key)]),
            h('span', { class: 'kcount' }, String(buckets[zhName].length)),
          ]),
          buckets[zhName].length
            ? h('div', { class: 'kbody' }, buckets[zhName].map((r) => oppCard(ctx, r, reload)))
            : h('div', { class: 'kempty' }, t('opp_empty_col')),
        ]))),
      h('p', { class: 'foot-note', style: 'margin-top:12px' },
        (res.hasMore ? t('opp_has_more') : '') +
        (closed ? t('opp_closed_count').replace('${count}', String(closed)) : '') +
        t('opp_close_note')),
    ]);
  });

  ctx.main.replaceChildren(
    pageHead({
      kicker: t('opp_kicker'), title: t('opp_title'), tag: wpTag(t('opp_wp_tag')),
      sub: t('opp_sub'),
      actions: [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => ctx.toast(t('opp_closed_toast')) }, [ic('grid'), t('opp_btn_closed_view')]),
        h('button', {
          class: 'btn btn-primary', type: 'button',
          title: tFull('opp_btn_new'),
          onclick: () => openOpportunityCreate(ctx, { onDone: reload }),
        }, [ic('plus'), t('opp_btn_new')]),
      ],
    }),
    pendingEl,
    h('div', { style: 'height:16px' }),
    boardEl,
  );
}
