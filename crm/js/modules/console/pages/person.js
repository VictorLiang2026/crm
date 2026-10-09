// Person 360（WP2）：八页签；总览/时间线/事实/家庭/保险/活动只读，
// 「机会与行动」页签接入写入闭环（完成行动/承诺、推进/关闭机会）。
// 「活动」页签按 G5 证据口径：activities.listByPerson 仅支持 legacy 数字 ID，
// 故 canonical 人物的活动参与记录取 getTimelinePage 已合并的 activity_participants 数据。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import { openWorkItemDone, openOpportunityAdvance, openQuickCapture, openPersonEdit } from '../write.js';
import {
  wpTag, pageHead, emptyNote, loadInto, bdg, kvGrid, sectionTitle,
  fmtDate, weekdayCN, dueLabel, toneByDue, textOf,
} from '../ui.js';
import { t, translateEnum } from '../i18n.js';

const TABS = () => [t('tab_overview'), t('tab_timeline'), t('tab_facts'), t('tab_family'), t('tab_insurance'), t('tab_opportunities'), t('tab_recruit'), t('tab_activities')];
const TYPE_LABEL = () => ({
  followup: t('type_followup'), recruit_followup: t('type_recruit_followup'), activity_participant: t('type_activity_participant'),
  meeting: t('type_meeting'), call: t('type_call'), message: t('type_message'), note: t('type_note'),
});

// 枚举翻译统一走 i18n.js 集中注册表
const oppStatusLabel = (s) => translateEnum('opportunity_status', s);
const oppTypeLabel = (type) => translateEnum('opportunity_type', type);
const stageLabel = (stage) => translateEnum('recruit_stage', stage);

function rowsBlock(rows, renderRow, emptyTitle, emptyNoteText) {
  if (!rows || !rows.length) return emptyNote(emptyTitle, emptyNoteText || '');
  return h('div', {}, rows.map(renderRow));
}

// ---------- 各页签内容构造（返回 Node） ----------
function overviewNode(ctx, id, setName) {
  return Promise.all([
    data.personHome(ctx, id),
    data.customerProfile(ctx, id),
    data.personWorkItems(ctx, id),
    data.personInteractions(ctx, id, 5),
  ]).then(([home, profile, works, interactions]) => {
    const name = profile.fields?.customer_name || home.person?.display_name || `Person #${id}`;
    setName(name);
    const f = profile.fields || {};
    const infoPairs = [
      [t('field_phone'), f.phone], [t('field_gender'), translateEnum('gender', f.gender)], [t('field_birthday'), f.birthday],
      [t('field_occupation'), f.occupation], [t('field_organization'), f.organization], [t('field_education'), f.education],
      [t('field_wechat'), f.wx_account], [t('field_source'), translateEnum('person_source', f.source)],
      [t('field_customer_stage'), translateEnum('customer_stage', f.customer_stage)], [t('field_sales_priority'), translateEnum('sales_priority', f.sales_priority)],
      [t('field_marital'), translateEnum('marital_status', f.marital_status)], [t('field_income'), f.annual_income], [t('field_updated'), fmtDate(f.updated_at)],
    ];
    const activeWorks = (works.rows || []).filter((r) =>
      (r.kind === 'action' && (r.status === 'open' || r.status === 'in_progress')) ||
      (r.kind === 'commitment' && r.status === 'open'));
    return h('div', { class: 'tab-stack' }, [
      h('div', { class: 'stack-head' }, [
        sectionTitle(t('sec_person_info')),
        profile.status === 'person_only' ? bdg(t('badge_person_only'), 'gray')
          : profile.status === 'customer_unavailable' ? bdg(t('badge_customer_unavailable'), 'red')
          : bdg(t('badge_customer_linked'), 'jade'),
      ]),
      kvGrid(infoPairs),
      sectionTitle(t('sec_todos')),
      rowsBlock(activeWorks.slice(0, 8), (r) => h('div', { class: 'list-row' }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, r.kind === 'action' ? (r.title || t('unnamed_action')) : (r.content || t('unnamed_commitment'))),
          h('div', { class: 'row-sub' }, `${r.kind === 'action' ? t('label_action') : t('label_commitment')} · ${dueLabel(String(r.due_at || '').slice(0, 10))}`),
        ]),
        bdg(r.kind === 'action' ? t('label_action') : t('label_commitment'), r.kind === 'action' ? 'ink' : 'gold'),
      ]), t('empty_no_open_actions')),
      sectionTitle(t('sec_recent_interactions')),
      rowsBlock((interactions.rows || []).slice(0, 5), (r) => h('div', { class: 'list-row' }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, textOf(r.summary) || t('no_summary')),
          h('div', { class: 'row-sub' }, `${fmtDate(r.interaction_at)} ${weekdayCN(r.interaction_at)} · ${translateEnum('channel', r.interaction_type) || r.interaction_type || t('interaction_default')}`),
        ]),
      ]), t('empty_no_interactions')),
    ]);
  });
}

function timelineNode(ctx, id) {
  let page = 1;
  const list = h('div', {});
  const moreBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: 'margin-top:10px' }, t('btn_load_more'));
  function renderRow(r) {
    const typeLabel = TYPE_LABEL()[r.type] || r.type || t('interaction_default');
    const fullLabel = r.type === 'recruit_followup' ? t('type_recruit_followup_full')
      : r.type === 'activity_participant' ? t('type_activity_participant_full')
      : undefined;
    return h('div', { class: 'tl-item' }, [
      h('div', { class: 'tl-dot' }),
      h('div', { style: 'flex:1;min-width:0' }, [
        h('div', { class: 'row-title' }, textOf(r.summary) || t('no_summary')),
        h('div', { class: 'row-sub', title: fullLabel || undefined },
          `${fmtDate(r.at)} ${weekdayCN(r.at)} · ${typeLabel}${r.channel ? ' · ' + translateEnum('channel', r.channel) : ''}`),
        h('div', { class: 'row-source' }, r.source || ''),
      ]),
      r.activityId ? h('a', { class: 'btn btn-ghost btn-sm', href: `#/activity/${r.activityId}` }, t('btn_activity')) : null,
    ]);
  }
  async function loadPage() {
    const res = await data.timeline(ctx, id, page, 20);
    const rows = res.rows || [];
    if (page === 1) {
      list.replaceChildren(rows.length
        ? rows.map(renderRow)
        : emptyNote(t('empty_no_timeline'), t('empty_timeline_note')));
    } else {
      rows.forEach((r) => list.appendChild(renderRow(r)));
    }
    moreBtn.style.display = res.hasMore ? '' : 'none';
  }
  moreBtn.onclick = async () => {
    moreBtn.disabled = true;
    const next = page + 1;
    try {
      page = next;
      await loadPage();
    } catch (e) {
      page = next - 1;
      throw e;
    } finally {
      moreBtn.disabled = false;
    }
  };
  return loadPage().then(() => h('div', { class: 'tab-stack' }, [list, moreBtn]));
}

function factsNode(ctx, id) {
  return data.contextGroups(ctx, id).then((res) => {
    const groups = [
      ['fact', t('sec_fact_recorded'), 'jade'], ['signal', t('sec_signal'), 'gold'], ['inference', t('sec_inference'), 'gray'],
    ];
    const blocks = [];
    groups.forEach(([key, label, tone]) => {
      const rows = (res.groups && res.groups[key]) || [];
      if (!rows.length) return;
      blocks.push(sectionTitle(label, bdg(String(rows.length), tone)));
      blocks.push(h('div', {}, rows.slice(0, 15).map((r) => h('div', { class: 'list-row' }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, [
            r.category ? bdg(translateEnum('fact_category', r.category), 'ink') : null,
            h('span', { style: 'margin-left:8px' }, r.content),
          ]),
          h('div', { class: 'row-sub' }, r.origin
            ? `${t('label_origin')} ${r.origin} · ${t('label_updated_short')} ${fmtDate(r.updatedAt)}`
            : `${t('label_updated_short')} ${fmtDate(r.updatedAt)}`),
        ]),
        r.confirmed ? bdg(t('badge_confirmed'), 'jade') : bdg(t('badge_pending'), 'gray'),
      ]))));
    });
    return h('div', { class: 'tab-stack' }, blocks.length ? blocks : [emptyNote(t('empty_no_facts'), t('empty_facts_note'))]);
  });
}

function familyNode(ctx, id) {
  return data.personHome(ctx, id).then((home) => {
    const household = home.household;
    const members = home.members || [];
    return h('div', { class: 'tab-stack' }, [
      sectionTitle(t('sec_family_facts')),
      household?.important_facts
        ? h('p', { class: 'fact-text' }, household.important_facts)
        : emptyNote(t('empty_no_family_facts'), ''),
      sectionTitle(t('sec_family_members')),
      rowsBlock(members, (m) => h('a', {
        class: 'list-row data-row',
        href: m.person ? `#/person/${m.person.id}` : '#',
        onclick: m.person ? null : (e) => e.preventDefault(),
      }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, m.person ? m.person.display_name : t('label_member')),
          h('div', { class: 'row-sub' }, m.relationship_to_anchor || t('label_no_relation')),
        ]),
        m.confirmed_at ? bdg(t('badge_confirmed'), 'jade') : bdg(t('badge_to_confirm'), 'gold'),
      ]), t('empty_no_family')),
    ]);
  });
}

function provenanceRow(title, sub, badge) {
  return h('div', { class: 'list-row' }, [
    h('div', { style: 'flex:1;min-width:0' }, [
      h('div', { class: 'row-title' }, title),
      sub ? h('div', { class: 'row-sub' }, sub) : null,
    ]),
    badge || null,
  ]);
}

function insuranceNode(ctx, id) {
  return data.insurance(ctx, id).then((d) => {
    const blocks = [];
    blocks.push(h('div', { class: 'stack-head' }, [
      sectionTitle(t('sec_insurance_overview')),
      bdg(d.evidenceStatus === 'recorded' ? t('badge_has_evidence') : t('badge_no_evidence'), d.evidenceStatus === 'recorded' ? 'jade' : 'gray'),
    ]));
    const cov = d.existingCoverage || [];
    if (cov.length) {
      blocks.push(sectionTitle(t('sec_coverage')));
      blocks.push(h('div', {}, cov.slice(0, 10).map((r) => provenanceRow(
        `${r.label || t('label_coverage_default')}：${r.amount ?? ''}${r.premium != null && r.premium !== '' ? ' / ' + t('label_premium') + ' ' + r.premium : ''}`,
        `${r.provenance || ''}${r.observedAt ? ' · ' + fmtDate(r.observedAt) : ''}`))));
    }
    const review = d.review || {};
    if (review.latest) {
      const r = review.latest;
      blocks.push(sectionTitle(t('sec_latest_review')));
      blocks.push(kvGrid([[t('label_date'), fmtDate(r.report_date)], [t('label_type'), r.report_type],
        [t('label_summary'), r.summary || r.edited_summary], [t('label_next_step'), r.next_action || r.edited_next_action]]));
    }
    const needs = d.knownNeeds || [];
    if (needs.length) {
      blocks.push(sectionTitle(t('sec_known_needs')));
      blocks.push(h('div', {}, needs.slice(0, 8).map((r) => provenanceRow(r.content, `${r.provenance || ''}${r.observedAt ? ' · ' + fmtDate(r.observedAt) : ''}`))));
    }
    const gaps = d.potentialGaps || [];
    if (gaps.length) {
      blocks.push(sectionTitle(t('sec_potential_gaps')));
      blocks.push(h('div', {}, gaps.slice(0, 8).map((r) => provenanceRow(r.content || r.text || '', r.provenance || ''))));
    }
    const opps = d.openOpportunities || [];
    if (opps.length) {
      blocks.push(sectionTitle(t('sec_open_opps_insurance')));
      blocks.push(h('div', {}, opps.slice(0, 8).map((r) => provenanceRow(
        `${r.type || t('opp_default')} · ${r.progress || ''}`,
        `${oppStatusLabel(r.status) || r.status || ''} · ${t('label_updated_short')} ${fmtDate(r.observedAt)}`, bdg(oppStatusLabel(r.status) || r.status || '', 'gold')))));
    }
    const acts = d.nextActions || [];
    if (acts.length) {
      blocks.push(sectionTitle(t('sec_next_steps')));
      blocks.push(h('div', {}, acts.slice(0, 8).map((r) => provenanceRow(r.title,
        `${r.provenance || ''}${r.dueAt ? ' · ' + dueLabel(String(r.dueAt).slice(0, 10)) : ''}`,
        bdg(dueLabel(String(r.dueAt || '').slice(0, 10)), toneByDue(String(r.dueAt || '').slice(0, 10)))))));
    }
    const ocr = review.ocr || [];
    if (ocr.length) {
      blocks.push(sectionTitle(t('sec_ocr')));
      blocks.push(h('div', {}, ocr.slice(0, 5).map((r) => provenanceRow(textOf(r.summary) || textOf(r.file_names) || t('ocr_summary_default'), `${t('ocr_note')} · ${fmtDate(r.created_at)}`))));
    }
    return h('div', { class: 'tab-stack' },
      blocks.length > 1 ? blocks : [emptyNote(t('empty_no_insurance'), t('empty_insurance_note'))]);
  });
}

function opportunitiesNode(ctx, id) {
  return Promise.all([data.personOpportunities(ctx, id), data.personWorkItems(ctx, id)])
    .then(([opps, works]) => {
      const rows = opps.rows || [];
      const activeWorks = (works.rows || []).filter((r) =>
        (r.kind === 'action' && (r.status === 'open' || r.status === 'in_progress')) ||
        (r.kind === 'commitment' && r.status === 'open'));
      const onDone = ctx.onWriteDone || null;
      return h('div', { class: 'tab-stack' }, [
        sectionTitle(`${t('sec_opportunities')}（${rows.length}）`),
        rowsBlock(rows, (r) => h('div', { class: 'list-row' }, [
          h('div', { style: 'flex:1;min-width:0' }, [
            h('div', { class: 'row-title' }, `${oppTypeLabel(r.opportunity_type) || t('opp_default')} · ${textOf(r.last_progress) || t('opp_no_progress')}`),
            h('div', { class: 'row-sub' }, `${t('label_next_action')}：${textOf(r.next_action) || t('label_none')}${r.next_action_date ? ' · ' + dueLabel(r.next_action_date) : ''} · ${t('label_discovered')} ${fmtDate(r.discovered_at)}`),
          ]),
          bdg(oppStatusLabel(r.status) || t('opp_status_default'), r.status === '成交' ? 'jade' : r.status === '关闭' ? 'gray' : 'gold'),
          r.status !== '成交' && r.status !== '关闭' ? h('button', {
            class: 'btn btn-ghost btn-sm', type: 'button',
            onclick: () => openOpportunityAdvance(ctx, { opportunity: r, onDone }),
          }, t('btn_advance_close')) : null,
        ]), t('empty_no_opps')),
        sectionTitle(t('sec_actions_commitments')),
        rowsBlock(activeWorks, (r) => h('div', { class: 'list-row' }, [
          h('div', { style: 'flex:1;min-width:0' }, [
            h('div', { class: 'row-title' }, r.kind === 'action' ? (r.title || t('unnamed_action')) : (r.content || t('unnamed_commitment'))),
            h('div', { class: 'row-sub' }, `${translateEnum('work_status', r.status)} · ${dueLabel(String(r.due_at || '').slice(0, 10))}`),
          ]),
          bdg(r.kind === 'action' ? t('label_action') : t('label_commitment'), r.kind === 'action' ? 'ink' : 'gold'),
          h('button', {
            class: 'btn btn-ghost btn-sm', type: 'button',
            onclick: () => openWorkItemDone(ctx, { row: r, onDone }),
          }, [ic('check'), t('btn_done')]),
        ]), t('empty_no_open_actions_only')),
      ]);
    });
}

function recruitNode(ctx, id) {
  return data.recruitContext(ctx, id).then((res) => {
    const rows = res.rows || [];
    return h('div', { class: 'tab-stack' }, [
      rowsBlock(rows, (r) => h('div', { class: 'recruit-block' }, [
        h('div', { class: 'list-row' }, [
          h('div', { style: 'flex:1;min-width:0' }, [
            h('div', { class: 'row-title' }, [bdg(stageLabel(r.stage) || t('stage_unknown'), 'gold'), r.potentialScore != null ? bdg(t('label_score') + ' ' + r.potentialScore, 'ink') : null]),
            h('div', { class: 'row-sub' }, `${t('label_motivation')}：${textOf(r.motivation) || '—'}；${t('label_concerns')}：${textOf(r.concerns) || '—'}`),
            h('div', { class: 'row-sub' }, `${t('label_career_plan')}：${textOf(r.careerPlan) || '—'}`),
          ]),
        ]),
        r.recentFollowups && r.recentFollowups.length
          ? h('div', { class: 'sub-followups' }, r.recentFollowups.slice(0, 3).map((f) =>
            h('div', { class: 'row-sub' }, `· ${fmtDate(f.date)} ${f.summary}`)))
          : null,
      ]), t('empty_no_recruit'), t('empty_recruit_note')),
    ]);
  });
}

function activitiesNode(ctx, id) {
  return data.timeline(ctx, id, 1, 50).then((res) => {
    const rows = (res.rows || []).filter((r) => r.activityId != null);
    return h('div', { class: 'tab-stack' }, [
      h('p', { class: 'foot-note', style: 'margin:0 0 6px' },
        t('activities_note')),
      rowsBlock(rows, (r) => h('a', { class: 'list-row data-row', href: `#/activity/${r.activityId}` }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, textOf(r.summary) || t('activity_participation_default')),
          h('div', { class: 'row-sub' }, `${fmtDate(r.at)} ${weekdayCN(r.at)}${r.channel ? ' · ' + translateEnum('channel', r.channel) : ''}`),
        ]),
        ic('chevron', 'mut'),
      ]), t('empty_no_activities_person')),
    ]);
  });
}

const BUILDERS = [overviewNode, timelineNode, factsNode, familyNode, insuranceNode, opportunitiesNode, recruitNode, activitiesNode];

// ---------- 页面 ----------
export function renderPerson(ctx, id) {
  const titleNode = h('span', {}, `Person #${id}`);
  const tabs = TABS();
  const bodies = tabs.map(() => h('div', {}));
  const loaded = new Set();
  let cur = 0;
  const btns = tabs.map((name, i) => h('button', {
    class: 'tab' + (i === 0 ? ' active' : ''), type: 'button',
    title: name === t('tab_opportunities') ? t('tab_opportunities_full') : undefined,
    onclick: () => select(i),
  }, name));

  function select(i) {
    cur = i;
    btns.forEach((b, j) => b.classList.toggle('active', i === j));
    bodies.forEach((b, j) => { b.style.display = i === j ? '' : 'none'; });
    if (!loaded.has(i)) {
      loaded.add(i);
      const setName = i === 0 ? (n) => { titleNode.textContent = n; } : () => {};
      loadInto(bodies[i], async () => h('div', { class: 'card-body' }, [await BUILDERS[i](wctx, id, setName)]));
    }
  }

  // 写入闭环：写入成功后重载当前页签；写操作经 wctx 拿到 onWriteDone。
  const wctx = Object.assign({}, ctx, {
    onWriteDone: () => { loaded.delete(cur); select(cur); },
  });

  // AI 人物摘要（WP3.2b）
  const summaryPanel = h('div', { class: 'card summary-card', style: 'display:none;margin-bottom:12px' });
  function openSummary() {
    summaryPanel.style.display = '';
    loadInto(summaryPanel, async () => {
      let res;
      try { res = await data.summarizePerson(ctx, id); }
      catch (e) { throw new Error(e.message || 'SUMMARY_FAILED'); }
      if (!res.ok) {
        const code = res.error?.code || 'SUMMARY_FAILED';
        const msg = res.error?.message || '';
        throw new Error(`${code}${msg ? ': ' + msg : ''}`);
      }
      const blocks = [];
      if (res.summary) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, t('sec_summary')),
        h('p', { class: 'summary-text' }, res.summary),
      ]));
      if (Array.isArray(res.signals) && res.signals.length) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, t('sec_key_signals')),
        h('ul', { class: 'summary-list' }, res.signals.map((s) => h('li', {}, s))),
      ]));
      if (Array.isArray(res.gaps) && res.gaps.length) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, t('sec_info_gaps')),
        h('ul', { class: 'summary-list' }, res.gaps.map((s) => h('li', {}, s))),
      ]));
      if (Array.isArray(res.nextActions) && res.nextActions.length) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, t('sec_suggested_next')),
        h('ul', { class: 'summary-list' }, res.nextActions.map((s) => h('li', {}, s))),
      ]));
      if (Array.isArray(res.evidence) && res.evidence.length) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, t('sec_evidence')),
        h('ul', { class: 'summary-list evidence' }, res.evidence.map((s) => h('li', {}, s))),
      ]));
      blocks.push(h('p', { class: 'foot-note' }, t('summary_foot').replace('{taskId}', res.taskId)));
      return h('div', { class: 'card-body' }, blocks);
    }, h('div', { class: 'card-body muted' }, t('generating')));
  }

  // AI 会前准备（WP3.3a）
  const prepPanel = h('div', { class: 'card summary-card', style: 'display:none;margin-bottom:12px' });
  function openPrep() {
    prepPanel.style.display = '';
    loadInto(prepPanel, async () => {
      let res;
      try { res = await data.meetingPrep(ctx, id); }
      catch (e) { throw new Error(e.message || 'MEETING_PREP_FAILED'); }
      if (!res.ok) {
        const code = res.error?.code || 'MEETING_PREP_FAILED';
        const msg = res.error?.message || '';
        throw new Error(`${code}${msg ? ': ' + msg : ''}`);
      }
      const blocks = [];
      if (res.brief30Seconds) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label', title: t('sec_brief30_full') }, t('sec_brief30')),
        h('p', { class: 'summary-text' }, res.brief30Seconds),
      ]));
      if (Array.isArray(res.recentChanges) && res.recentChanges.length) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, t('sec_recent_changes')),
        h('ul', { class: 'summary-list' }, res.recentChanges.map((s) => h('li', {}, s))),
      ]));
      if (res.suggestedObjective) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, t('sec_suggested_objective')),
        h('p', { class: 'summary-text' }, res.suggestedObjective),
      ]));
      if (Array.isArray(res.openingAngles) && res.openingAngles.length) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, t('sec_opening_angles')),
        h('ul', { class: 'summary-list' }, res.openingAngles.map((s) => h('li', {}, s))),
      ]));
      if (Array.isArray(res.possibleObjections) && res.possibleObjections.length) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, t('sec_possible_objections')),
        h('ul', { class: 'summary-list' }, res.possibleObjections.map((s) => h('li', {}, s))),
      ]));
      if (Array.isArray(res.questionsToConfirm) && res.questionsToConfirm.length) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, t('sec_questions_to_confirm')),
        h('ul', { class: 'summary-list' }, res.questionsToConfirm.map((s) => h('li', {}, s))),
      ]));
      if (Array.isArray(res.avoid) && res.avoid.length) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, t('sec_avoid')),
        h('ul', { class: 'summary-list evidence' }, res.avoid.map((s) => h('li', {}, s))),
      ]));
      blocks.push(h('p', { class: 'foot-note' }, t('prep_foot').replace('{taskId}', res.taskId)));
      return h('div', { class: 'card-body' }, blocks);
    }, h('div', { class: 'card-body muted' }, t('generating')));
  }

  // AI 对话策略（WP3.3b）
  const playbookPanel = h('div', { class: 'card summary-card', style: 'display:none;margin-bottom:12px' });
  function renderPlaybookResult(res) {
    const blocks = [];
    blocks.push(h('div', { class: 'summary-section' }, [
      h('b', { class: 'summary-label' }, t('sec_objection')),
      h('p', { class: 'summary-text' }, res.objection),
    ]));
    if (Array.isArray(res.possibleUnderlyingReasons) && res.possibleUnderlyingReasons.length) blocks.push(h('div', { class: 'summary-section' }, [
      h('b', { class: 'summary-label' }, t('sec_underlying_reasons')),
      h('ul', { class: 'summary-list' }, res.possibleUnderlyingReasons.map((s) => h('li', {}, s))),
    ]));
    if (Array.isArray(res.clarifyingQuestions) && res.clarifyingQuestions.length) blocks.push(h('div', { class: 'summary-section' }, [
      h('b', { class: 'summary-label' }, t('sec_clarifying_questions')),
      h('ul', { class: 'summary-list' }, res.clarifyingQuestions.map((s) => h('li', {}, s))),
    ]));
    if (res.responseLogic) blocks.push(h('div', { class: 'summary-section' }, [
      h('b', { class: 'summary-label' }, t('sec_response_logic')),
      h('p', { class: 'summary-text' }, res.responseLogic),
    ]));
    if (res.nextObjective) blocks.push(h('div', { class: 'summary-section' }, [
      h('b', { class: 'summary-label' }, t('sec_next_objective')),
      h('p', { class: 'summary-text' }, res.nextObjective),
    ]));
    if (Array.isArray(res.doNotSay) && res.doNotSay.length) blocks.push(h('div', { class: 'summary-section' }, [
      h('b', { class: 'summary-label' }, t('sec_do_not_say')),
      h('ul', { class: 'summary-list evidence' }, res.doNotSay.map((s) => h('li', {}, s))),
    ]));
    if (res.createdAt) blocks.push(h('p', { class: 'foot-note' }, t('generated_at').replace('{time}', res.createdAt)));
    else if (res.taskId) blocks.push(h('p', { class: 'foot-note' }, t('playbook_foot').replace('{taskId}', res.taskId)));
    blocks.push(h('div', { style: 'margin-top:10px' }, [
      h('button', {
        class: 'btn btn-soft btn-sm', type: 'button', onclick: showPlaybookInput,
      }, t('btn_regenerate')),
    ]));
    playbookPanel.replaceChildren(h('div', { class: 'card-body' }, blocks));
  }
  function showPlaybookInput() {
    playbookPanel.style.display = '';
    playbookPanel.replaceChildren(h('div', { class: 'card-body' }, [
      h('p', { class: 'summary-label' }, t('playbook_input_label')),
      h('textarea', {
        id: 'playbook-objection', rows: 3, placeholder: t('playbook_input_ph'),
        style: 'width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;box-sizing:border-box;resize:vertical;',
      }),
      h('div', { style: 'margin-top:8px' }, [
        h('button', {
          class: 'btn btn-primary btn-sm', type: 'button',
          onclick: () => runPlaybook(document.getElementById('playbook-objection').value.trim()),
        }, t('btn_generate_playbook')),
      ]),
    ]));
  }
  function openPlaybook() {
    if (playbookPanel.style.display === 'none' || !playbookPanel.children.length) {
      showPlaybookInput();
    } else {
      playbookPanel.style.display = 'none';
    }
  }
  function runPlaybook(objection) {
    if (!objection) { ctx.toast(t('toast_input_objection')); return; }
    playbookPanel.replaceChildren(h('div', { class: 'card-body muted' }, t('generating')));
    (async () => {
      let res;
      try { res = await data.conversationPlaybook(ctx, id, objection); }
      catch (e) {
        playbookPanel.replaceChildren(h('div', { class: 'card-body' }, h('div', { class: 'empty' }, `${t('playbook_failed_prefix')}${e.message || 'PLAYBOOK_FAILED'}`)));
        return;
      }
      if (!res.ok) {
        const code = res.error?.code || 'PLAYBOOK_FAILED';
        const msg = res.error?.message || '';
        playbookPanel.replaceChildren(h('div', { class: 'card-body' }, h('div', { class: 'empty' }, `${code}${msg ? ': ' + msg : ''}`)));
        return;
      }
      renderPlaybookResult(res);
    })();
  }
  // 页面加载时自动拉取最近一次对话策略结果
  (async () => {
    try {
      const hist = await data.conversationPlaybookHistory(ctx, id);
      if (hist.ok && hist.hasResult) {
        playbookPanel.style.display = '';
        renderPlaybookResult(hist);
      }
    } catch (_) { /* ignore history load failure */ }
  })();

  ctx.main.replaceChildren(
    pageHead({
      kicker: t('kicker_person'), title: titleNode, tag: wpTag(t('wp3_ai')),
      sub: t('person_sub'),
      actions: [
        h('button', {
          class: 'btn btn-soft', type: 'button', onclick: openSummary,
        }, [ic('sparkle'), t('btn_ai_summary')]),
        h('button', {
          class: 'btn btn-soft', type: 'button', onclick: openPrep,
          title: t('btn_meeting_prep_full'),
        }, [ic('calendar'), t('btn_meeting_prep')]),
        h('button', {
          class: 'btn btn-soft', type: 'button', onclick: openPlaybook,
        }, [ic('chat'), t('btn_playbook')]),
        h('button', {
          class: 'btn btn-soft', type: 'button',
          onclick: () => openPersonEdit(wctx, { personId: String(id), onDone: wctx.onWriteDone }),
        }, [ic('gear'), t('btn_edit_profile')]),
        h('button', {
          class: 'btn btn-soft', type: 'button',
          onclick: () => openQuickCapture(wctx, { personId: String(id), onDone: wctx.onWriteDone }),
          title: t('btn_record_comm_full'),
        }, [ic('mic'), t('btn_record_comm')]),
        h('a', {
          class: 'btn btn-ghost', href: `/crm/admin.html#/person/${id}`,
          target: '_blank', rel: 'noopener',
        }, [ic('file'), t('btn_full_profile')]),
      ],
    }),
    summaryPanel,
    prepPanel,
    playbookPanel,
    h('div', { class: 'tabs' }, btns),
    h('section', { class: 'card tabs-body' }, bodies),
  );
  select(0);
}
