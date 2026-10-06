// 活动工作台（WP1 只读）：活动列表（日期条筛选）+ 详情「流程」「签到与到场」两页签。
// 互动名单/机会候选/复盘（WP2 写、WP3 AI）、伴手礼与照片（G4 无数据源）保留骨架。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import {
  wpTag, pageHead, emptyNote, loadInto, bdg, kvGrid, sectionTitle,
  fmtDate, weekdayCN, dayDiffFromToday, textOf,
} from '../ui.js';

const ACT_TABS = ['流程', '签到与到场', '互动与名单', '机会候选', '伴手礼', '照片', '复盘'];
const TASK_STATUS = {
  pending: ['待处理', 'gray'], in_progress: ['进行中', 'gold'],
  completed: ['已完成', 'jade'], skipped: ['已跳过', 'gray'],
};
const PART_STATUS = {
  invited: ['已邀约', 'ink'], attended: ['已到场', 'jade'], absent: ['缺席', 'red'],
};
const PART_TYPE = { customer: '客户', recruit: '增员', speaker: '嘉宾' };

// ---------- 列表 ----------
export function renderActivities(ctx) {
  const listEl = h('div', {});
  let selectedDate = '';

  const d = new Date();
  const strip = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const node = h('button', { class: 'day' + (i === 0 ? ' today' : ''), type: 'button' }, [
      h('b', {}, String(day.getDate())),
      h('span', {}, i === 0 ? '今天' : '周' + '日一二三四五六'[day.getDay()]),
    ]);
    node.onclick = () => {
      selectedDate = (selectedDate === key) ? '' : key;
      strip.forEach((x) => x.classList.remove('sel'));
      if (selectedDate) node.classList.add('sel');
      runList();
    };
    strip.push(node);
  }

  function runList() {
    loadInto(listEl, async () => {
      const res = await data.activities(ctx);
      let rows = res.rows || [];
      if (selectedDate) rows = rows.filter((r) => String(r.activity_date || '').slice(0, 10) === selectedDate);
      if (!rows.length) {
        return h('div', { class: 'card-body' }, [emptyNote(
          selectedDate ? '当天没有活动' : '近期没有活动',
          selectedDate ? '再选其他日期看看。' : '新建活动在 WP2 接入。')]);
      }
      return h('div', { class: 'card-body' }, rows.map((a) => {
        const diff = dayDiffFromToday(a.activity_date);
        const dateText = a.activity_date
          ? `${fmtDate(a.activity_date)} ${weekdayCN(a.activity_date)}${diff != null && diff >= 0 ? '' : ''}`
          : '日期待定';
        return h('a', { class: 'list-row data-row', href: `#/activity/${a.id}` }, [
          h('span', { class: 'pavatar sm gold' }, (a.name || '活').charAt(0)),
          h('div', { style: 'flex:1;min-width:0' }, [
            h('div', { class: 'row-title' }, a.name),
            h('div', { class: 'row-sub' },
              [dateText, a.activity_type, a.location].map(textOf).filter(Boolean).join(' · ')),
          ]),
          a.status ? bdg(a.status, diff != null && diff < 0 ? 'gray' : 'gold') : null,
          ic('chevron', 'mut'),
        ]);
      }));
    });
  }

  ctx.main.replaceChildren(
    pageHead({
      kicker: 'ACTIVITIES', title: '活动工作台', tag: wpTag('WP1 只读'),
      sub: '先有人，才有数字：报名与实际到场分开记录，复盘逐人审核。',
      actions: [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => ctx.toast('活动量日报在 WP1 后续批次接入') }, [ic('calendar'), '活动量日报']),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.toast('新建活动在 WP2 接入') }, [ic('plus'), '新建活动']),
      ],
    }),
    h('div', { class: 'date-strip' }, strip),
    h('div', { style: 'height:16px' }),
    h('section', { class: 'card' }, [listEl]),
  );
  runList();
}

// ---------- 详情 ----------
function flowNode(ctx, id) {
  return Promise.all([data.activityDetail(ctx, id), data.activityTasks(ctx, id)]).then(([detail, tasksRes]) => {
    if (!detail.activity) throw new Error('活动不存在');
    const a = detail.activity;
    const tasks = tasksRes.rows || [];
    return h('div', { class: 'tab-stack' }, [
      sectionTitle('活动信息'),
      kvGrid([
        ['名称', a.name], ['日期', a.activity_date ? `${fmtDate(a.activity_date)} ${weekdayCN(a.activity_date)}` : ''],
        ['类型', a.activity_type], ['地点', a.location], ['状态', a.status], ['说明', a.description],
      ]),
      sectionTitle(`筹备任务（${tasks.length}）`),
      tasks.length ? h('div', {}, tasks.map((t) => h('div', { class: 'list-row' }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, [
            t.task_type ? bdg(t.task_type, 'ink') : null,
            h('span', { style: 'margin-left:8px' }, t.task_title),
          ]),
          t.note ? h('div', { class: 'row-sub' }, t.note) : null,
          t.due_date ? h('div', { class: 'row-sub' }, `截止 ${fmtDate(t.due_date)}`) : null,
        ]),
        bdg((TASK_STATUS[t.status] || [t.status, 'gray'])[0], (TASK_STATUS[t.status] || ['', 'gray'])[1]),
      ]))) : emptyNote('暂无筹备任务', ''),
    ]);
  });
}

function attendanceNode(ctx, id) {
  return data.activityDetail(ctx, id).then((detail) => {
    const parts = detail.participants || [];
    const groups = [
      ['attended', '已到场', 'jade'], ['invited', '已邀约', 'ink'], ['absent', '缺席', 'red'],
    ];
    const blocks = [];
    groups.forEach(([key, label]) => {
      const rows = parts.filter((p) => (p.status || 'invited') === key);
      if (!rows.length) return;
      blocks.push(sectionTitle(label, bdg(String(rows.length), key === 'absent' ? 'red' : key === 'attended' ? 'jade' : 'ink')));
      blocks.push(h('div', {}, rows.map((p) => {
        const label = p.person_name || (p.person_id ? `${PART_TYPE[p.person_type] || ''} #${p.person_id}` : '暂存姓名');
        const nameNode = p.canonical_person_id
          ? h('a', { href: `#/person/${p.canonical_person_id}`, style: 'margin-left:8px;color:var(--ink);font-weight:600' }, label)
          : h('span', { style: 'margin-left:8px' }, label);
        return h('div', { class: 'list-row' }, [
          h('div', { style: 'flex:1;min-width:0' }, [
            h('div', { class: 'row-title' }, [
              bdg(PART_TYPE[p.person_type] || p.person_type || '人员', p.person_type === 'recruit' ? 'gold' : 'ink'),
              nameNode,
            ]),
            p.relationship_note ? h('div', { class: 'row-sub' }, p.relationship_note) : null,
          ]),
          p.canonical_person_id ? ic('chevron', 'mut') : null,
        ]);
      })));
    });
    return h('div', { class: 'tab-stack' },
      blocks.length ? blocks : [emptyNote('暂无参与者', '报名与签到在 WP2 写入闭环中接入。')]);
  });
}

const PLACEHOLDER = {
  4: ['伴手礼', '当前没有活动级礼品数据源；如需要请在后续工作包提出并单独设计。'],
  5: ['照片', '照片目前仅按客户归档（无 activity_id 字段）；活动照片需先做数据设计。'],
};

function interactionNode(ctx, id) {
  return data.activityData(ctx, id).then((res) => {
    if (res.error) return h('div', { class: 'tab-stack' }, [emptyNote('加载失败', res.error)]);
    const rows = res.interactions || [];
    if (!rows.length) return h('div', { class: 'tab-stack' }, [emptyNote('暂无互动记录', '互动由 WP12 写入闭环产生，仅在活动后逐人确认时记录。')]);
    return h('div', { class: 'tab-stack' }, [
      sectionTitle(`互动记录（${rows.length}）`),
      h('div', {}, rows.map((r) => h('div', { class: 'list-row' }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, [
            bdg(r.type, 'ink'),
            r.personName ? h('a', { href: `#/person/${r.personId}`, style: 'margin-left:8px;color:var(--ink);font-weight:600' }, r.personName)
              : h('span', { style: 'margin-left:8px' }, r.personName),
          ]),
          r.summary ? h('div', { class: 'row-sub' }, r.summary) : null,
          h('div', { class: 'row-sub' }, [
            r.channel ? `渠道: ${r.channel}` : null,
            r.interactionAt ? ` · ${fmtDate(r.interactionAt)}` : null,
            r.importance ? ` · 重要性 ${r.importance}` : null,
          ].filter(Boolean)),
        ]),
      ]))),
    ]);
  });
}

function candidateNode(ctx, id) {
  return data.activityData(ctx, id).then((res) => {
    if (res.error) return h('div', { class: 'tab-stack' }, [emptyNote('加载失败', res.error)]);
    const rows = res.opportunityCandidates || [];
    if (!rows.length) return h('div', { class: 'tab-stack' }, [emptyNote('暂无机会候选', '机会候选由 AI 复盘生成，需有实质沟通等互动证据支撑。')]);
    return h('div', { class: 'tab-stack' }, [
      sectionTitle(`机会候选（${rows.length}）`),
      h('p', { class: 'muted' }, '以下候选由 AI 复盘生成，需经人工审核确认后才建正式机会。'),
      h('div', {}, rows.map((o) => h('div', { class: 'list-row' }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, [
            o.personName ? h('a', { href: `#/person/${o.personId}` }, o.personName) : `Person #${o.personId}`,
            bdg(o.opportunityType, 'gold'),
          ]),
          o.reason ? h('div', { class: 'row-sub' }, o.reason) : null,
          o.nextAction ? h('div', { class: 'row-sub' }, `下一步: ${o.nextAction}`) : null,
          o.sourceRefs?.length ? h('div', { class: 'foot-note' }, `来源: ${o.sourceRefs.join(', ')}`) : null,
        ]),
      ]))),
    ]);
  });
}

function claimList(items) {
  if (!Array.isArray(items) || !items.length) return h('p', { class: 'muted' }, '无');
  return h('ul', { class: 'summary-list' }, items.map((c) => h('li', {}, [
    h('span', {}, c.text),
    c.sourceRefs?.length ? h('span', { class: 'foot-note', style: 'display:block;margin-top:2px' },
      `来源: ${c.sourceRefs.join(', ')}`) : null,
  ])));
}

function reviewNode(ctx, id) {
  return (async () => {
    const blocks = [h('p', { class: 'muted' }, 'AI 复盘基于活动 public 记录生成，候选需人工审核后才产生业务影响。')];
    let res;
    try { res = await data.activityPostReviewV2(ctx, id); }
    catch (e) {
      return h('div', { class: 'tab-stack' }, [emptyNote('生成失败', e.message || 'ACTIVITY_REVIEW_FAILED')]);
    }
    if (res.error) {
      const map = { ACTIVITY_NOT_ENDED: '活动尚未结束，无法复盘', NO_CANONICAL_PERSON: res.message || '暂无已确认 Person 关联' };
      return h('div', { class: 'tab-stack' }, [emptyNote(map[res.error] || res.error, '')]);
    }
    const r = res.review || {};
    blocks.push(sectionTitle('复盘摘要'));
    blocks.push(h('p', { class: 'summary-text' }, r.summary || ''));
    const sections = [
      ['谁最重要', r.whoMattered],
      ['发生了什么变化', r.whatChanged],
      ['关系改善', r.relationshipsImproved],
      ['出现的信号', r.signalsAppeared],
      ['出现的机会', r.opportunitiesAppeared],
      ['需要跟进的人', r.followUpPeople],
    ];
    sections.forEach(([title, items]) => {
      blocks.push(sectionTitle(title));
      blocks.push(claimList(items));
    });
    if (Array.isArray(r.actionCandidates) && r.actionCandidates.length) {
      blocks.push(sectionTitle('行动候选（待人工确认）'));
      blocks.push(h('div', {}, r.actionCandidates.map((a) => h('div', { class: 'list-row' }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, [
            a.personName ? h('a', { href: `#/person/${a.personId}` }, a.personName) : `Person #${a.personId}`,
          ]),
          h('div', { class: 'row-sub' }, a.title),
          a.reason ? h('div', { class: 'row-sub' }, a.reason) : null,
        ]),
      ]))));
    }
    if (Array.isArray(r.opportunityCandidates) && r.opportunityCandidates.length) {
      blocks.push(sectionTitle('机会候选（待人工确认）'));
      blocks.push(h('div', {}, r.opportunityCandidates.map((o) => h('div', { class: 'list-row' }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, [
            o.personName ? h('a', { href: `#/person/${o.personId}` }, o.personName) : `Person #${o.personId}`,
            bdg(o.opportunityType, 'gold'),
          ]),
          o.reason ? h('div', { class: 'row-sub' }, o.reason) : null,
          o.nextAction ? h('div', { class: 'row-sub' }, `下一步: ${o.nextAction}`) : null,
        ]),
      ]))));
    }
    if (res.discarded_unsupported_items) {
      blocks.push(h('p', { class: 'foot-note' }, `已过滤 ${res.discarded_unsupported_items} 条无有效来源引用的候选项。`));
    }
    blocks.push(h('p', { class: 'foot-note' }, `task #${res.task_id}；仅生成候选，不写入业务数据。`));
    return h('div', { class: 'tab-stack' }, blocks);
  })();
}

export function renderActivity(ctx, id) {
  const bodies = ACT_TABS.map(() => h('div', {}));
  const loaded = new Set();
  const btns = ACT_TABS.map((name, i) => h('button', {
    class: 'tab' + (i === 0 ? ' active' : ''), type: 'button',
    onclick: () => select(i),
  }, name));

  function placeholder(i) {
    const [title, note] = PLACEHOLDER[i];
    return h('div', { class: 'tab-stack' }, [emptyNote(title, note)]);
  }
  function select(i) {
    btns.forEach((b, j) => b.classList.toggle('active', i === j));
    bodies.forEach((b, j) => { b.style.display = i === j ? '' : 'none'; });
    if (loaded.has(i)) return;
    loaded.add(i);
    if (i === 0) loadInto(bodies[i], async () => h('div', { class: 'card-body' }, [await flowNode(ctx, id)]));
    else if (i === 1) loadInto(bodies[i], async () => h('div', { class: 'card-body' }, [await attendanceNode(ctx, id)]));
    else if (i === 6) loadInto(bodies[i], async () => h('div', { class: 'card-body' }, [await reviewNode(ctx, id)]));
    else if (i === 2) loadInto(bodies[i], async () => h('div', { class: 'card-body' }, [await interactionNode(ctx, id)]));
    else if (i === 3) loadInto(bodies[i], async () => h('div', { class: 'card-body' }, [await candidateNode(ctx, id)]));
    else bodies[i].replaceChildren(h('div', { class: 'card-body' }, placeholder(i)));
  }

  ctx.main.replaceChildren(
    pageHead({
      kicker: 'ACTIVITY', title: `活动 #${id}`, tag: wpTag('WP1 只读'),
      sub: '报名与到场分开记录；复盘候选逐人人工审核。',
    }),
    h('div', { class: 'tabs' }, btns),
    h('section', { class: 'card tabs-body' }, bodies),
  );
  select(0);
}
