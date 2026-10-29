// 活动工作台：活动、筹备任务、签到与资源使用原生管理；旧日报及未覆盖入口继续保留。
import { h } from '../dom.js';
import { ic } from '../icons.js';
import { data } from '../data.js';
import {
  changeActivityTaskStatus, confirmActivityRemoval, confirmActivityTaskRemoval,
  openActivityEditor, openActivityTaskEditor,
} from '../activities-write.js';
import { renderActivityParticipants, renderActivityResources } from '../activity-people.js';
import { renderActivityReview } from '../activity-review.js';
import { renderActivityPreparation } from '../activity-preparation.js';
import { t, translateEnum } from '../i18n.js';
import {
  wpTag, pageHead, emptyNote, loadInto, bdg, kvGrid, sectionTitle,
  fmtDate, weekdayCN, dayDiffFromToday, textOf,
} from '../ui.js';

const ACT_TABS = ['act_tab_flow', 'act_tab_attend', 'act_tab_acts', 'act_tab_candidates', 'act_tab_gifts', 'act_tab_photos', 'act_tab_review', 'act_tab_resources'];

// 枚举翻译统一走 i18n.js 集中注册表
const actStatusLabel = (s) => translateEnum('activity_status', s);

const TASK_STATUS = {
  pending: ['status_pending', 'gray'], in_progress: ['status_in_progress', 'gold'],
  completed: ['status_completed', 'jade'], skipped: ['status_skipped', 'gray'],
};
// ---------- 列表 ----------
export function renderActivities(ctx) {
  const listEl = h('div', {});
  const state = { page: 1, pageSize: 30, keyword: '', activityDate: '', sortField: 'activity_date', sortDir: 'desc' };
  const search = h('input', { type: 'search', maxlength: '120', placeholder: t('act_directory_search'),
    'aria-label': t('act_directory_search') });
  const prev = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
    if (state.page > 1) { state.page--; runList(); }
  } }, t('btn_prev'));
  const next = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
    state.page++; runList();
  } }, t('btn_next'));
  const pageInfo = h('span', { class: 'pager-info' });
  let cancelQuery = () => {};

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
      state.activityDate = (state.activityDate === key) ? '' : key;
      strip.forEach((x) => x.classList.remove('sel'));
      if (state.activityDate) node.classList.add('sel');
      state.page = 1;
      runList();
    };
    strip.push(node);
  }

  function runList() {
    cancelQuery();
    cancelQuery = loadInto(listEl, async () => {
      const res = await data.activityDirectory(ctx, { ...state });
      const rows = res.rows || [];
      prev.disabled = state.page <= 1;
      next.disabled = !res.hasMore;
      pageInfo.textContent = t('resource_directory_page').replace('{page}', String(state.page));
      if (!rows.length) {
        return h('div', { class: 'card-body' }, [emptyNote(
          state.activityDate ? t('act_empty_today') : t('act_directory_empty'),
          state.activityDate ? t('act_empty_select_other') : t('act_empty_new'))]);
      }
      const columns = [
        ['id', 'col_id'], ['name', 'act_directory_name'], ['activity_date', 'act_date'],
        ['activity_type', 'act_type'], [null, 'act_location'], [null, 'act_status'],
        [null, 'act_directory_target'], [null, 'act_directory_actual'],
      ];
      const header = h('thead', {}, h('tr', {}, columns.map(([field, label]) => h('th', {
        class: field ? 'sortable-th' : '',
        'aria-sort': field && state.sortField === field ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : undefined,
        onclick: field ? () => {
          if (state.sortField === field) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
          else { state.sortField = field; state.sortDir = 'asc'; }
          state.page = 1; runList();
        } : undefined,
      }, `${t(label)}${field && state.sortField === field ? (state.sortDir === 'asc' ? ' ▲' : ' ▼') : ''}`))));
      const body = h('tbody', {}, rows.map(a => h('tr', { onclick: () => { location.hash = `#/activity/${a.id}`; } }, [
        h('td', {}, String(a.id)),
        h('td', {}, h('a', { href: `#/activity/${a.id}` }, a.name || '')),
        h('td', {}, a.activity_date ? fmtDate(a.activity_date) : t('act_date_tbd')),
        h('td', {}, translateEnum('activity_type', a.activity_type)),
        h('td', {}, a.location || '—'),
        h('td', {}, a.status ? bdg(actStatusLabel(a.status), 'gold') : '—'),
        h('td', {}, a.target_participants == null ? '—' : String(a.target_participants)),
        h('td', {}, a.actual_participants == null ? '—' : String(a.actual_participants)),
      ])));
      return h('div', { class: 'table-scroll' }, h('table', { class: 'people-table activity-directory-table' }, [header, body]));
    });
  }

  ctx.main.replaceChildren(
    pageHead({
      kicker: 'ACTIVITIES', title: t('title_activities'), tag: wpTag(t('act_manage_tag')),
      sub: t('sub_activities'),
      actions: [
        h('a', { class: 'btn btn-ghost', href: '#/activity-speakers' }, t('resource_directory_speakers_tab')),
        h('a', { class: 'btn btn-ghost', href: '#/activity-topics' }, t('resource_directory_topics_tab')),
        h('button', { class: 'btn btn-ghost', type: 'button', title: t('act_daily_report'), onclick: () => {
          const range = state.activityDate ? `?startDate=${state.activityDate}&endDate=${state.activityDate}` : '';
          location.hash = `#/activity-report/customer${range}`;
        } }, [ic('calendar'), t('act_daily_report')]),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openActivityEditor(ctx, { onDone: runList }) }, [ic('plus'), t('act_new')]),
      ],
    }),
    h('div', { class: 'date-strip' }, strip),
    h('form', { class: 'more-actions activity-directory-filters', onsubmit: event => {
      event.preventDefault(); state.keyword = search.value.trim(); state.page = 1; runList();
    } }, [search, h('button', { class: 'btn btn-primary', type: 'submit' }, t('btn_search'))]),
    h('section', { class: 'card' }, [listEl]),
    h('div', { class: 'pager' }, [prev, pageInfo, next]),
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
      sectionTitle(`${t('act_prep_tasks')}（${tasks.length}）`, h('button', {
        class: 'btn btn-primary btn-sm', type: 'button',
        onclick: () => openActivityTaskEditor(ctx, { activityId: id, onDone: () => renderActivity(ctx, id) }),
      }, [ic('plus'), t('act_task_add')])),
      renderActivityPreparation(ctx, id, a.status),
      tasks.length ? h('div', {}, tasks.map((task) => h('div', { class: 'list-row act-task-row' }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'row-title' }, [
            task.task_type ? bdg(task.task_type, 'ink') : null,
            h('span', { style: 'margin-left:8px' }, task.task_title),
          ]),
          task.note ? h('div', { class: 'row-sub' }, task.note) : null,
          task.due_date ? h('div', { class: 'row-sub' }, `${t('act_due')} ${fmtDate(task.due_date)}`) : null,
        ]),
        bdg(t((TASK_STATUS[task.status] || [task.status, 'gray'])[0]), (TASK_STATUS[task.status] || ['', 'gray'])[1]),
        h('div', { class: 'act-task-actions' }, [
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openActivityTaskEditor(ctx, {
            activityId: id, task, onDone: () => renderActivity(ctx, id),
          }) }, t('act_task_edit')),
          ['completed', 'skipped'].includes(task.status) ? null : h('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => changeActivityTaskStatus(ctx, {
              activityId: id, task, status: 'completed', onDone: () => renderActivity(ctx, id),
            }),
          }, t('act_task_mark_done')),
          ['completed', 'skipped'].includes(task.status) ? null : h('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => changeActivityTaskStatus(ctx, {
              activityId: id, task, status: 'skipped', onDone: () => renderActivity(ctx, id),
            }),
          }, t('act_task_skip')),
          h('button', { class: 'btn btn-ghost btn-sm act-task-delete', type: 'button', onclick: () => confirmActivityTaskRemoval(ctx, {
            activityId: id, task, onDone: () => renderActivity(ctx, id),
          }) }, t('act_task_delete')),
        ]),
      ]))) : emptyNote(t('act_no_prep_tasks'), ''),
    ]);
  });
}

function attendanceNode(ctx, id, onDone) {
  return data.activityDetail(ctx, id).then((detail) => {
    const parts = detail.participants || [];
    if (!detail.activity) throw new Error(t('act_activity_not_found'));
    return renderActivityParticipants(ctx, detail.activity, parts, onDone);
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
  return renderActivityReview(ctx, id);
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
    else if (i === 1) loadInto(bodies[i], async () => h('div', { class: 'card-body' }, [await attendanceNode(ctx, id, () => {
      loaded.delete(1); select(1);
    })]));
    else if (i === 6) loadInto(bodies[i], async () => h('div', { class: 'card-body' }, [await reviewNode(ctx, id)]));
    else if (i === 2) loadInto(bodies[i], async () => h('div', { class: 'card-body' }, [await interactionNode(ctx, id)]));
    else if (i === 3) loadInto(bodies[i], async () => h('div', { class: 'card-body' }, [await candidateNode(ctx, id)]));
    else if (i === 7) loadInto(bodies[i], async () => h('div', { class: 'card-body' }, [await renderActivityResources(ctx, id)]));
    else bodies[i].replaceChildren(h('div', { class: 'card-body' }, placeholder(i)));
  }

  ctx.main.replaceChildren(
    pageHead({
      kicker: 'ACTIVITY', title: `${t('title_activity')} #${id}`, tag: wpTag(t('act_manage_tag')),
      sub: t('sub_activity'),
      actions: [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
          try {
            const result = await data.activityDetail(ctx, id);
            if (!result.activity) throw new Error(t('act_activity_not_found'));
            openActivityEditor(ctx, { activity: result.activity, onDone: () => renderActivity(ctx, id) });
          } catch (error) { ctx.toast(error.message || t('act_load_failed'), 'err'); }
        } }, [ic('edit'), t('act_edit')]),
        h('button', { class: 'btn btn-ghost act-delete-button', type: 'button', onclick: () => confirmActivityRemoval(ctx, {
          activity: { id }, onDone: () => { location.hash = '#/activities'; },
        }) }, [ic('trash'), t('act_delete')]),
      ],
    }),
    h('div', { class: 'tabs' }, btns),
    h('section', { class: 'card tabs-body' }, bodies),
  );
  select(0);
}
