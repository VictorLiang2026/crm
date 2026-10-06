// Person 360（WP2）：八页签；总览/时间线/事实/家庭/保险/活动只读，
// 「机会与行动」页签接入写入闭环（完成行动/承诺、推进/关闭机会）。
// 「活动」页签按 G5 证据口径：activities.listByPerson 仅支持 legacy 数字 ID，
// 故 canonical 人物的活动参与记录取 getTimelinePage 已合并的 activity_participants 数据。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import { openWorkItemDone, openOpportunityAdvance, openQuickCapture } from '../write.js';
import {
  wpTag, pageHead, emptyNote, loadInto, bdg, kvGrid, sectionTitle,
  fmtDate, weekdayCN, dueLabel, toneByDue, textOf,
} from '../ui.js';

const TABS = ['总览', '互动时间线', '事实与洞察', '家庭与关系', '保险概览', '机会与行动', '招募', '活动'];
const TYPE_LABEL = {
  followup: '跟进', recruit_followup: '增员跟进', activity_participant: '活动参与',
  meeting: '面谈', call: '电话', message: '消息', note: '笔记',
};

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
      ['手机', f.phone], ['性别', f.gender], ['生日', f.birthday],
      ['职业', f.occupation], ['机构', f.organization], ['教育', f.education],
      ['来源', f.source], ['客户阶段', f.customer_stage], ['销售优先级', f.sales_priority],
      ['婚姻', f.marital_status], ['年收入', f.annual_income], ['更新', fmtDate(f.updated_at)],
    ];
    const activeWorks = (works.rows || []).filter((r) =>
      (r.kind === 'action' && (r.status === 'open' || r.status === 'in_progress')) ||
      (r.kind === 'commitment' && r.status === 'open'));
    return h('div', { class: 'tab-stack' }, [
      h('div', { class: 'stack-head' }, [
        sectionTitle('人物信息'),
        profile.status === 'person_only' ? bdg('仅 Person', 'gray')
          : profile.status === 'customer_unavailable' ? bdg('关联客户不可用', 'red')
          : bdg('已关联客户', 'jade'),
      ]),
      kvGrid(infoPairs),
      sectionTitle('待办与承诺'),
      rowsBlock(activeWorks.slice(0, 8), (r) => h('div', { class: 'list-row' }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, r.kind === 'action' ? (r.title || '未命名行动') : (r.content || '未填写承诺')),
          h('div', { class: 'row-sub' }, `${r.kind === 'action' ? '行动' : '承诺'} · ${dueLabel(String(r.due_at || '').slice(0, 10))}`),
        ]),
        bdg(r.kind === 'action' ? '行动' : '承诺', r.kind === 'action' ? 'ink' : 'gold'),
      ]), '暂无开放行动或承诺'),
      sectionTitle('最近互动'),
      rowsBlock((interactions.rows || []).slice(0, 5), (r) => h('div', { class: 'list-row' }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, textOf(r.summary) || '（无摘要）'),
          h('div', { class: 'row-sub' }, `${fmtDate(r.interaction_at)} ${weekdayCN(r.interaction_at)} · ${r.interaction_type || '互动'}`),
        ]),
      ]), '暂无互动记录'),
    ]);
  });
}

function timelineNode(ctx, id) {
  let page = 1;
  const list = h('div', {});
  const moreBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: 'margin-top:10px' }, '加载更多');
  function renderRow(r) {
    return h('div', { class: 'tl-item' }, [
      h('div', { class: 'tl-dot' }),
      h('div', { style: 'flex:1;min-width:0' }, [
        h('div', { class: 'row-title' }, textOf(r.summary) || '（无摘要）'),
        h('div', { class: 'row-sub' },
          `${fmtDate(r.at)} ${weekdayCN(r.at)} · ${TYPE_LABEL[r.type] || r.type || '互动'}${r.channel ? ' · ' + r.channel : ''}`),
        h('div', { class: 'row-source' }, r.source || ''),
      ]),
      r.activityId ? h('a', { class: 'btn btn-ghost btn-sm', href: `#/activity/${r.activityId}` }, '活动') : null,
    ]);
  }
  async function loadPage() {
    const res = await data.timeline(ctx, id, page, 20);
    const rows = res.rows || [];
    if (page === 1) {
      list.replaceChildren(rows.length
        ? rows.map(renderRow)
        : emptyNote('暂无互动时间线', '沟通、活动参与与跟进会在这里按时间合并展示。'));
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
      ['fact', '已记录事实', 'jade'], ['signal', '信号', 'gold'], ['inference', '推断', 'gray'],
    ];
    const blocks = [];
    groups.forEach(([key, label, tone]) => {
      const rows = (res.groups && res.groups[key]) || [];
      if (!rows.length) return;
      blocks.push(sectionTitle(label, bdg(String(rows.length), tone)));
      blocks.push(h('div', {}, rows.slice(0, 15).map((r) => h('div', { class: 'list-row' }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, [
            r.category ? bdg(r.category, 'ink') : null,
            h('span', { style: 'margin-left:8px' }, r.content),
          ]),
          h('div', { class: 'row-sub' }, r.origin ? `来源 ${r.origin} · 更新 ${fmtDate(r.updatedAt)}` : `更新 ${fmtDate(r.updatedAt)}`),
        ]),
        r.confirmed ? bdg('已确认', 'jade') : bdg('待核实', 'gray'),
      ]))));
    });
    return h('div', { class: 'tab-stack' }, blocks.length ? blocks : [emptyNote('暂无事实与洞察', '事实需要人工确认；AI 推断不会被当作已核实信息。')]);
  });
}

function familyNode(ctx, id) {
  return data.personHome(ctx, id).then((home) => {
    const household = home.household;
    const members = home.members || [];
    return h('div', { class: 'tab-stack' }, [
      sectionTitle('家庭重要事实'),
      household?.important_facts
        ? h('p', { class: 'fact-text' }, household.important_facts)
        : emptyNote('暂无家庭重要事实', ''),
      sectionTitle('家庭成员'),
      rowsBlock(members, (m) => h('a', {
        class: 'list-row data-row',
        href: m.person ? `#/person/${m.person.id}` : '#',
        onclick: m.person ? null : (e) => e.preventDefault(),
      }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, m.person ? m.person.display_name : '成员'),
          h('div', { class: 'row-sub' }, m.relationship_to_anchor || '未标注关系'),
        ]),
        m.confirmed_at ? bdg('已确认', 'jade') : bdg('待确认', 'gold'),
      ]), '暂无家庭成员'),
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
      sectionTitle('保险概览'),
      bdg(d.evidenceStatus === 'recorded' ? '有凭证' : '暂无凭证', d.evidenceStatus === 'recorded' ? 'jade' : 'gray'),
    ]));
    const cov = d.existingCoverage || [];
    if (cov.length) {
      blocks.push(sectionTitle('已有保障'));
      blocks.push(h('div', {}, cov.slice(0, 10).map((r) => provenanceRow(
        `${r.label || '保障'}：${r.amount ?? ''}${r.premium != null && r.premium !== '' ? ' / 保费 ' + r.premium : ''}`,
        `${r.provenance || ''}${r.observedAt ? ' · ' + fmtDate(r.observedAt) : ''}`))));
    }
    const review = d.review || {};
    if (review.latest) {
      const r = review.latest;
      blocks.push(sectionTitle('最近保单体检'));
      blocks.push(kvGrid([['日期', fmtDate(r.report_date)], ['类型', r.report_type],
        ['摘要', r.summary || r.edited_summary], ['下一步', r.next_action || r.edited_next_action]]));
    }
    const needs = d.knownNeeds || [];
    if (needs.length) {
      blocks.push(sectionTitle('已知需求'));
      blocks.push(h('div', {}, needs.slice(0, 8).map((r) => provenanceRow(r.content, `${r.provenance || ''}${r.observedAt ? ' · ' + fmtDate(r.observedAt) : ''}`))));
    }
    const gaps = d.potentialGaps || [];
    if (gaps.length) {
      blocks.push(sectionTitle('潜在缺口'));
      blocks.push(h('div', {}, gaps.slice(0, 8).map((r) => provenanceRow(r.content || r.text || '', r.provenance || ''))));
    }
    const opps = d.openOpportunities || [];
    if (opps.length) {
      blocks.push(sectionTitle('进行中的保障机会'));
      blocks.push(h('div', {}, opps.slice(0, 8).map((r) => provenanceRow(
        `${r.type || '机会'} · ${r.progress || ''}`,
        `${r.status || ''} · 更新 ${fmtDate(r.observedAt)}`, bdg(r.status || '', 'gold')))));
    }
    const acts = d.nextActions || [];
    if (acts.length) {
      blocks.push(sectionTitle('下一步'));
      blocks.push(h('div', {}, acts.slice(0, 8).map((r) => provenanceRow(r.title,
        `${r.provenance || ''}${r.dueAt ? ' · ' + dueLabel(String(r.dueAt).slice(0, 10)) : ''}`,
        bdg(dueLabel(String(r.dueAt || '').slice(0, 10)), toneByDue(String(r.dueAt || '').slice(0, 10)))))));
    }
    const ocr = review.ocr || [];
    if (ocr.length) {
      blocks.push(sectionTitle('保单 OCR'));
      blocks.push(h('div', {}, ocr.slice(0, 5).map((r) => provenanceRow(textOf(r.summary) || textOf(r.file_names) || '保单图片识别', `OCR 摘要，待人工核实 · ${fmtDate(r.created_at)}`))));
    }
    return h('div', { class: 'tab-stack' },
      blocks.length > 1 ? blocks : [emptyNote('暂无保险上下文', '保障明细、保单体检、需求与机会将在此汇总，每条标注凭证与来源。')]);
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
        sectionTitle(`机会（${rows.length}）`),
        rowsBlock(rows, (r) => h('div', { class: 'list-row' }, [
          h('div', { style: 'flex:1;min-width:0' }, [
            h('div', { class: 'row-title' }, `${r.opportunity_type || '机会'} · ${textOf(r.last_progress) || '无进展记录'}`),
            h('div', { class: 'row-sub' }, `下一步：${textOf(r.next_action) || '无'}${r.next_action_date ? ' · ' + dueLabel(r.next_action_date) : ''} · 发现 ${fmtDate(r.discovered_at)}`),
          ]),
          bdg(r.status || '发现', r.status === '成交' ? 'jade' : r.status === '关闭' ? 'gray' : 'gold'),
          r.status !== '成交' && r.status !== '关闭' ? h('button', {
            class: 'btn btn-ghost btn-sm', type: 'button',
            onclick: () => openOpportunityAdvance(ctx, { opportunity: r, onDone }),
          }, '推进 / 关闭') : null,
        ]), '暂无机会记录'),
        sectionTitle('行动与承诺'),
        rowsBlock(activeWorks, (r) => h('div', { class: 'list-row' }, [
          h('div', { style: 'flex:1;min-width:0' }, [
            h('div', { class: 'row-title' }, r.kind === 'action' ? (r.title || '未命名行动') : (r.content || '未填写承诺')),
            h('div', { class: 'row-sub' }, `${r.status} · ${dueLabel(String(r.due_at || '').slice(0, 10))}`),
          ]),
          bdg(r.kind === 'action' ? '行动' : '承诺', r.kind === 'action' ? 'ink' : 'gold'),
          h('button', {
            class: 'btn btn-ghost btn-sm', type: 'button',
            onclick: () => openWorkItemDone(ctx, { row: r, onDone }),
          }, [ic('check'), '完成']),
        ]), '暂无开放行动'),
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
            h('div', { class: 'row-title' }, [bdg(r.stage || '阶段未知', 'gold'), r.potentialScore != null ? bdg('评分 ' + r.potentialScore, 'ink') : null]),
            h('div', { class: 'row-sub' }, `动机：${textOf(r.motivation) || '—'}；顾虑：${textOf(r.concerns) || '—'}`),
            h('div', { class: 'row-sub' }, `事业规划：${textOf(r.careerPlan) || '—'}`),
          ]),
        ]),
        r.recentFollowups && r.recentFollowups.length
          ? h('div', { class: 'sub-followups' }, r.recentFollowups.slice(0, 3).map((f) =>
            h('div', { class: 'row-sub' }, `· ${fmtDate(f.date)} ${f.summary}`)))
          : null,
      ]), '暂无增员档案', '该人物没有增员候选人记录。'),
    ]);
  });
}

function activitiesNode(ctx, id) {
  return data.timeline(ctx, id, 1, 50).then((res) => {
    const rows = (res.rows || []).filter((r) => r.activityId != null);
    return h('div', { class: 'tab-stack' }, [
      h('p', { class: 'foot-note', style: 'margin:0 0 6px' },
        '按 canonical Person 参与记录展示（来自互动时间线）；旧版 customer/recruit 维度查询不适用统一身份。'),
      rowsBlock(rows, (r) => h('a', { class: 'list-row data-row', href: `#/activity/${r.activityId}` }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, textOf(r.summary) || '活动参与'),
          h('div', { class: 'row-sub' }, `${fmtDate(r.at)} ${weekdayCN(r.at)}${r.channel ? ' · ' + r.channel : ''}`),
        ]),
        ic('chevron', 'mut'),
      ]), '暂无活动参与记录'),
    ]);
  });
}

const BUILDERS = [overviewNode, timelineNode, factsNode, familyNode, insuranceNode, opportunitiesNode, recruitNode, activitiesNode];

// ---------- 页面 ----------
export function renderPerson(ctx, id) {
  const titleNode = h('span', {}, `Person #${id}`);
  const bodies = TABS.map(() => h('div', {}));
  const loaded = new Set();
  let cur = 0;
  const btns = TABS.map((name, i) => h('button', {
    class: 'tab' + (i === 0 ? ' active' : ''), type: 'button',
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
        h('b', { class: 'summary-label' }, '摘要'),
        h('p', { class: 'summary-text' }, res.summary),
      ]));
      if (Array.isArray(res.signals) && res.signals.length) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, '关键信号'),
        h('ul', { class: 'summary-list' }, res.signals.map((s) => h('li', {}, s))),
      ]));
      if (Array.isArray(res.gaps) && res.gaps.length) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, '信息缺口'),
        h('ul', { class: 'summary-list' }, res.gaps.map((s) => h('li', {}, s))),
      ]));
      if (Array.isArray(res.nextActions) && res.nextActions.length) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, '建议下一步'),
        h('ul', { class: 'summary-list' }, res.nextActions.map((s) => h('li', {}, s))),
      ]));
      if (Array.isArray(res.evidence) && res.evidence.length) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, '证据来源'),
        h('ul', { class: 'summary-list evidence' }, res.evidence.map((s) => h('li', {}, s))),
      ]));
      blocks.push(h('p', { class: 'foot-note' }, `AI 摘要基于 public 记录生成，仅供参考；task #${res.taskId}`));
      return h('div', { class: 'card-body' }, blocks);
    }, h('div', { class: 'card-body muted' }, '生成中…'));
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
        h('b', { class: 'summary-label' }, '30 秒简报'),
        h('p', { class: 'summary-text' }, res.brief30Seconds),
      ]));
      if (Array.isArray(res.recentChanges) && res.recentChanges.length) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, '近期变化'),
        h('ul', { class: 'summary-list' }, res.recentChanges.map((s) => h('li', {}, s))),
      ]));
      if (res.suggestedObjective) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, '建议目标'),
        h('p', { class: 'summary-text' }, res.suggestedObjective),
      ]));
      if (Array.isArray(res.openingAngles) && res.openingAngles.length) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, '开场角度'),
        h('ul', { class: 'summary-list' }, res.openingAngles.map((s) => h('li', {}, s))),
      ]));
      if (Array.isArray(res.possibleObjections) && res.possibleObjections.length) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, '可能异议'),
        h('ul', { class: 'summary-list' }, res.possibleObjections.map((s) => h('li', {}, s))),
      ]));
      if (Array.isArray(res.questionsToConfirm) && res.questionsToConfirm.length) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, '需确认的问题'),
        h('ul', { class: 'summary-list' }, res.questionsToConfirm.map((s) => h('li', {}, s))),
      ]));
      if (Array.isArray(res.avoid) && res.avoid.length) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, '避免事项'),
        h('ul', { class: 'summary-list evidence' }, res.avoid.map((s) => h('li', {}, s))),
      ]));
      blocks.push(h('p', { class: 'foot-note' }, `会前准备基于 public 记录生成，仅供参考；task #${res.taskId}`));
      return h('div', { class: 'card-body' }, blocks);
    }, h('div', { class: 'card-body muted' }, '生成中…'));
  }

  // AI 对话策略（WP3.3b）
  const playbookPanel = h('div', { class: 'card summary-card', style: 'display:none;margin-bottom:12px' });
  function openPlaybook() {
    playbookPanel.style.display = '';
    playbookPanel.replaceChildren(h('div', { class: 'card-body' }, [
      h('p', { class: 'summary-label' }, '输入客户异议或场景，生成应对策略：'),
      h('textarea', {
        id: 'playbook-objection', rows: 3, placeholder: '例如：客户说「保险都是骗人的」「我再考虑考虑」「保费太贵了」…',
        style: 'width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;box-sizing:border-box;resize:vertical;',
      }),
      h('div', { style: 'margin-top:8px' }, [
        h('button', {
          class: 'btn btn-primary btn-sm', type: 'button',
          onclick: () => runPlaybook(document.getElementById('playbook-objection').value.trim()),
        }, '生成策略'),
      ]),
    ]));
  }
  function runPlaybook(objection) {
    if (!objection) { ctx.toast('请输入客户异议'); return; }
    playbookPanel.replaceChildren(h('div', { class: 'card-body muted' }, '生成中…'));
    (async () => {
      let res;
      try { res = await data.conversationPlaybook(ctx, id, objection); }
      catch (e) {
        playbookPanel.replaceChildren(h('div', { class: 'card-body' }, h('div', { class: 'empty' }, `生成失败：${e.message || 'PLAYBOOK_FAILED'}`)));
        return;
      }
      if (!res.ok) {
        const code = res.error?.code || 'PLAYBOOK_FAILED';
        const msg = res.error?.message || '';
        playbookPanel.replaceChildren(h('div', { class: 'card-body' }, h('div', { class: 'empty' }, `${code}${msg ? ': ' + msg : ''}`)));
        return;
      }
      const blocks = [];
      blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, '客户异议'),
        h('p', { class: 'summary-text' }, res.objection),
      ]));
      if (Array.isArray(res.possibleUnderlyingReasons) && res.possibleUnderlyingReasons.length) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, '可能的深层原因'),
        h('ul', { class: 'summary-list' }, res.possibleUnderlyingReasons.map((s) => h('li', {}, s))),
      ]));
      if (Array.isArray(res.clarifyingQuestions) && res.clarifyingQuestions.length) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, '可追问的问题'),
        h('ul', { class: 'summary-list' }, res.clarifyingQuestions.map((s) => h('li', {}, s))),
      ]));
      if (res.responseLogic) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, '回应思路'),
        h('p', { class: 'summary-text' }, res.responseLogic),
      ]));
      if (res.nextObjective) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, '下一步目标'),
        h('p', { class: 'summary-text' }, res.nextObjective),
      ]));
      if (Array.isArray(res.doNotSay) && res.doNotSay.length) blocks.push(h('div', { class: 'summary-section' }, [
        h('b', { class: 'summary-label' }, '避免说的话'),
        h('ul', { class: 'summary-list evidence' }, res.doNotSay.map((s) => h('li', {}, s))),
      ]));
      blocks.push(h('p', { class: 'foot-note' }, `对话策略基于 public 记录生成，仅供参考；task #${res.taskId}`));
      playbookPanel.replaceChildren(h('div', { class: 'card-body' }, blocks));
    })();
  }

  ctx.main.replaceChildren(
    pageHead({
      kicker: 'PERSON 360', title: titleNode, tag: wpTag('WP3 AI'),
      sub: '人物详情：汇总互动、事实、家庭、保险、机会与招募数据；机会与行动支持经服务端预览的写入操作。',
      actions: [
        h('button', {
          class: 'btn btn-soft', type: 'button', onclick: openSummary,
        }, [ic('sparkle'), 'AI 摘要']),
        h('button', {
          class: 'btn btn-soft', type: 'button', onclick: openPrep,
        }, [ic('calendar'), '会前准备']),
        h('button', {
          class: 'btn btn-soft', type: 'button', onclick: openPlaybook,
        }, [ic('chat'), '对话策略']),
        h('button', {
          class: 'btn btn-soft', type: 'button',
          onclick: () => openQuickCapture(wctx, { personId: String(id), onDone: wctx.onWriteDone }),
        }, [ic('mic'), '记录沟通']),
        h('a', {
          class: 'btn btn-ghost', href: `/crm/admin.html#/person/${id}`,
          target: '_blank', rel: 'noopener',
        }, [ic('file'), '完整客户档案']),
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
