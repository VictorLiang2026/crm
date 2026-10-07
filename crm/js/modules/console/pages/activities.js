// 活动工作台（WP1 只读）：活动列表（日期条筛选）+ 详情「流程」「签到与到场」两页签。
// 互动名单/机会候选/复盘（WP2 写、WP3 AI）、伴手礼与照片（G4 无数据源）保留骨架。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import { t, translateEnum } from '../i18n.js';
import {
  wpTag, pageHead, emptyNote, loadInto, bdg, kvGrid, sectionTitle,
  fmtDate, weekdayCN, dayDiffFromToday, textOf,
} from '../ui.js';

const ACT_TABS = ['act_tab_flow', 'act_tab_attend', 'act_tab_acts', 'act_tab_candidates', 'act_tab_gifts', 'act_tab_photos', 'act_tab_review'];

// 枚举翻译统一走 i18n.js 集中注册表
const actStatusLabel = (s) => translateEnum('activity_status', s);

const TASK_STATUS = {
  pending: ['status_pending', 'gray'], in_progress: ['status_in_progress', 'gold'],
  completed: ['status_completed', 'jade'], skipped: ['status_skipped', 'gray'],
};
const PART_STATUS = {
  invited: ['part_invited', 'ink'], attended: ['part_attended', 'jade'], absent: ['part_absent', 'red'],
};
const PART_TYPE = { customer: 'customer', recruit: 'recruit', speaker: 'speaker' };

// ---------- 列表 ----------
export function renderActivities(ctx) {
  const listEl = h('div', {});
  let selectedDate = '';

  const d = new Date();
  const strip = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const weekdayText = i === 0 ? t('act_today') : (t('act_weekday_prefix') || '') + t('act_weekday_' + day.getDay());
    const node = h('button', { class: 'day' + (i === 0 ? ' today' : ''), type: 'button' }, [
      h('b', {}, String(day.getDate())),
      h('span', {}, weekdayText),
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
          selectedDate ? t('act_empty_today') : t('act_empty_recent'),
          selectedDate ? t('act_empty_select_other') : t('act_empty_new_wp2'))]);
      }
      return h('div', { class: 'card-body' }, rows.map((a) => {
        const diff = dayDiffFromToday(a.activity_date);
        const dateText = a.activity_date
          ? `${fmtDate(a.activity_date)} ${weekdayCN(a.activity_date)}${diff != null && diff >= 0 ? '' : ''}`
          : t('act_date_tbd');
        return h('a', { class: 'list-row data-row', href: `#/activity/${a.id}` }, [
          h('span', { class: 'pavatar sm gold' }, (a.name || t('act_person')).charAt(0)),
          h('div', { style: 'flex:1;min-width:0' }, [
            h('div', { class: 'row-title' }, a.name),
            h('div', { class: 'row-sub' },
              [dateText, translateEnum('activity_type', a.activity_type), a.location].map(textOf).filter(Boolean).join(' · ')),
          ]),
          a.status ? bdg(actStatusLabel(a.status), diff != null && diff < 0 ? 'gray' : 'gold') : null,
          ic('chevron', 'mut'),
        ]);
      }));
    });
  }

  ctx.main.replaceChildren(
    pageHead({
      kicker: 'ACTIVITIES', title: t('title_activities'), tag: wpTag(t('act_wp1_readonly')),
      sub: t('sub_activities'),
      actions: [
        h('button', { class: 'btn btn-ghost', type: 'button', title: t('act_daily_report'), onclick: () => ctx.toast(t('act_daily_report') + ' WP1') }, [ic('calendar'), t('act_daily_report')]),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.toast(t('act_new') + ' WP2') }, [ic('plus'), t('act_new')]),
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
    if (!detail.activity) throw new Error(t('act_activity_not_found'));
    const a = detail.activity;
    const tasks = tasksRes.rows || [];
    return h('div', { class: 'tab-stack' }, [
      sectionTitle(t('act_info')),
      kvGrid([
        [t('act_name'), a.name], [t('act_date'), a.activity_date ? `${fmtDate(a.activity_date)} ${weekdayCN(a.activity_date)}` : ''],
        [t('act_type'), translateEnum('activity_type', a.activity_type)], [t('act_location'), a.location], [t('act_status'), actStatusLabel(a.status)], [t('act_desc'), a.description],
      ]),
      sectionTitle(`${t('act_prep_tasks')}（${tasks.length}）`),
      tasks.length ? h('div', {}, tasks.map((task) => h('div', { class: 'list-row' }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, [
            task.task_type ? bdg(task.task_type, 'ink') : null,
            h('span', { style: 'margin-left:8px' }, task.task_title),
          ]),
          task.note ? h('div', { class: 'row-sub' }, task.note) : null,
          task.due_date ? h('div', { class: 'row-sub' }, `${t('act_due')} ${fmtDate(task.due_date)}`) : null,
        ]),
        bdg(t((TASK_STATUS[task.status] || [task.status, 'gray'])[0]), (TASK_STATUS[task.status] || ['', 'gray'])[1]),
      ]))) : emptyNote(t('act_no_prep_tasks'), ''),
    ]);
  });
}

function attendanceNode(ctx, id) {
  return data.activityDetail(ctx, id).then((detail) => {
    const parts = detail.participants || [];
    const groups = [
      ['attended', t('act_attended'), 'jade'], ['invited', t('act_invited'), 'ink'], ['absent', t('act_absent'), 'red'],
    ];
    const blocks = [];
    groups.forEach(([key, label]) => {
      const rows = parts.filter((p) => (p.status || 'invited') === key);
      if (!rows.length) return;
      blocks.push(sectionTitle(label, bdg(String(rows.length), key === 'absent' ? 'red' : key === 'attended' ? 'jade' : 'ink')));
      blocks.push(h('div', {}, rows.map((p) => {
        const label = p.person_name || (p.person_id ? `${t(PART_TYPE[p.person_type] || 'act_person')} #${p.person_id}` : t('act_temp_name'));
        const nameNode = p.canonical_person_id
          ? h('a', { href: `#/person/${p.canonical_person_id}`, style: 'margin-left:8px;color:var(--ink);font-weight:600' }, label)
          : h('span', { style: 'margin-left:8px' }, label);
        return h('div', { class: 'list-row' }, [
          h('div', { style: 'flex:1;min-width:0' }, [
            h('div', { class: 'row-title' }, [
              bdg(t(PART_TYPE[p.person_type] || 'act_person'), p.person_type === 'recruit' ? 'gold' : 'ink'),
              nameNode,
            ]),
            p.relationship_note ? h('div', { class: 'row-sub' }, p.relationship_note) : null,
          ]),
          p.canonical_person_id ? ic('chevron', 'mut') : null,
        ]);
      })));
    });
    return h('div', { class: 'tab-stack' },
      blocks.length ? blocks : [emptyNote(t('act_no_participants'), t('act_participants_note'))]);
  });
}

const PLACEHOLDER = {
  4: ['act_gifts_title', 'act_gifts_note'],
  5: ['act_photos_title', 'act_photos_note'],
};

function interactionNode(ctx, id) {
  return data.activityData(ctx, id).then((res) => {
    if (res.error) return h('div', { class: 'tab-stack' }, [emptyNote(t('act_load_failed'), res.error)]);
    const rows = res.interactions || [];
    if (!rows.length) return h('div', { class: 'tab-stack' }, [emptyNote(t('act_no_interactions'), t('act_interactions_note'))]);
    return h('div', { class: 'tab-stack' }, [
      sectionTitle(`${t('act_interactions')}（${rows.length}）`),
      h('div', {}, rows.map((r) => h('div', { class: 'list-row' }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, [
            bdg(r.type, 'ink'),
            r.personName ? h('a', { href: `#/person/${r.personId}`, style: 'margin-left:8px;color:var(--ink);font-weight:600' }, r.personName)
              : h('span', { style: 'margin-left:8px' }, r.personName),
          ]),
          r.summary ? h('div', { class: 'row-sub' }, r.summary) : null,
          h('div', { class: 'row-sub' }, [
            r.channel ? `${t('act_channel')}: ${translateEnum('channel', r.channel)}` : null,
            r.interactionAt ? ` · ${fmtDate(r.interactionAt)}` : null,
            r.importance ? ` · ${t('act_importance')} ${r.importance}` : null,
          ].filter(Boolean)),
        ]),
      ]))),
    ]);
  });
}

function candidateNode(ctx, id) {
  return data.activityData(ctx, id).then((res) => {
    if (res.error) return h('div', { class: 'tab-stack' }, [emptyNote(t('act_load_failed'), res.error)]);
    const rows = res.opportunityCandidates || [];
    if (!rows.length) return h('div', { class: 'tab-stack' }, [emptyNote(t('act_no_candidates'), t('act_candidates_note'))]);
    return h('div', { class: 'tab-stack' }, [
      sectionTitle(`${t('act_candidates_title')}（${rows.length}）`),
      h('p', { class: 'muted' }, t('act_candidates_desc')),
      h('div', {}, rows.map((o) => h('div', { class: 'list-row' }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, [
            o.personName ? h('a', { href: `#/person/${o.personId}` }, o.personName) : `Person #${o.personId}`,
            bdg(o.opportunityType, 'gold'),
          ]),
          o.reason ? h('div', { class: 'row-sub' }, o.reason) : null,
          o.nextAction ? h('div', { class: 'row-sub' }, `${t('act_next_step')}: ${o.nextAction}`) : null,
          o.sourceRefs?.length ? h('div', { class: 'foot-note' }, `${t('act_source')}: ${o.sourceRefs.join(', ')}`) : null,
        ]),
      ]))),
    ]);
  });
}

function claimList(items) {
  if (!Array.isArray(items) || !items.length) return h('p', { class: 'muted' }, t('act_none'));
  return h('ul', { class: 'summary-list' }, items.map((c) => h('li', {}, [
    h('span', {}, c.text),
    c.sourceRefs?.length ? h('span', { class: 'foot-note', style: 'display:block;margin-top:2px' },
      `${t('act_source')}: ${c.sourceRefs.join(', ')}`) : null,
  ])));
}

function reviewNode(ctx, id) {
  return (async () => {
    const blocks = [h('p', { class: 'muted' }, t('act_review_note'))];
    let res;
    try { res = await data.activityPostReviewV2(ctx, id); }
    catch (e) {
      return h('div', { class: 'tab-stack' }, [emptyNote(t('act_review_failed'), e.message || 'ACTIVITY_REVIEW_FAILED')]);
    }
    if (res.error) {
      const map = { ACTIVITY_NOT_ENDED: t('act_not_ended'), NO_CANONICAL_PERSON: res.message || t('act_no_canonical') };
      return h('div', { class: 'tab-stack' }, [emptyNote(map[res.error] || res.error, '')]);
    }
    const r = res.review || {};
    blocks.push(sectionTitle(t('act_review_summary')));
    blocks.push(h('p', { class: 'summary-text' }, r.summary || ''));
    const sections = [
      [t('act_who_mattered'), r.whoMattered],
      [t('act_what_changed'), r.whatChanged],
      [t('act_relationships_improved'), r.relationshipsImproved],
      [t('act_signals_appeared'), r.signalsAppeared],
      [t('act_opps_appeared'), r.opportunitiesAppeared],
      [t('act_followup_people'), r.followUpPeople],
    ];
    sections.forEach(([title, items]) => {
      blocks.push(sectionTitle(title));
      blocks.push(claimList(items));
    });
    if (Array.isArray(r.actionCandidates) && r.actionCandidates.length) {
      blocks.push(sectionTitle(t('act_action_candidates')));
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
      blocks.push(sectionTitle(t('act_opp_candidates')));
      blocks.push(h('div', {}, r.opportunityCandidates.map((o) => h('div', { class: 'list-row' }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, [
            o.personName ? h('a', { href: `#/person/${o.personId}` }, o.personName) : `Person #${o.personId}`,
            bdg(o.opportunityType, 'gold'),
          ]),
          o.reason ? h('div', { class: 'row-sub' }, o.reason) : null,
          o.nextAction ? h('div', { class: 'row-sub' }, `${t('act_next_step')}: ${o.nextAction}`) : null,
        ]),
      ]))));
    }
    if (res.discarded_unsupported_items) {
      blocks.push(h('p', { class: 'foot-note' }, `${t('act_filtered_unsupported')} ${res.discarded_unsupported_items} ${t('act_items_unsupported')}`));
    }
    blocks.push(h('p', { class: 'foot-note' }, `${t('act_task_id')}${res.task_id}${t('act_task_id_sep')}${t('act_review_only')}`));
    return h('div', { class: 'tab-stack' }, blocks);
  })();
}

export function renderActivity(ctx, id) {
  const bodies = ACT_TABS.map(() => h('div', {}));
  const loaded = new Set();
  const btns = ACT_TABS.map((key, i) => h('button', {
    class: 'tab' + (i === 0 ? ' active' : ''), type: 'button',
    onclick: () => select(i),
  }, t(key)));

  function placeholder(i) {
    const [titleKey, noteKey] = PLACEHOLDER[i];
    return h('div', { class: 'tab-stack' }, [emptyNote(t(titleKey), t(noteKey))]);
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
      kicker: 'ACTIVITY', title: `${t('title_activity')} #${id}`, tag: wpTag(t('act_wp1_readonly')),
      sub: t('sub_activity'),
    }),
    h('div', { class: 'tabs' }, btns),
    h('section', { class: 'card tabs-body' }, bodies),
  );
  select(0);
}
