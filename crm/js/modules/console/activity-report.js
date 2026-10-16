import { h } from './dom.js';
import { data } from './data.js';
import { t, translateEnum } from './i18n.js';
import { card, emptyNote, errorBox, pageHead, wpTag } from './ui.js';

const CUSTOMER_GROUPS = [
  ['pc21_customer_growth', ['newCustomers', 'firstContacts']],
  ['pc21_customer_followup', ['followups', 'customersTouched', 'plannedDue', 'completedPlan', 'completionRate', 'overdueNow']],
  ['pc21_customer_care', ['gifts', 'giftItems', 'photos', 'ocrParses', 'aiSuggestions', 'policyReviews', 'productUpdates']],
];
const RECRUIT_GROUPS = [
  ['pc21_recruit_activity', ['newCandidates', 'rcFollowups', 'candidatesTouched', 'plannedDue', 'completedPlan', 'completionRate']],
  ['pc21_recruit_stages', ['warm', 'firstInterview', 'event', 'deepInterview', 'apply', 'hired']],
];
const METRIC_KEYS = {
  newCustomers: 'pc21_new_customers', firstContacts: 'pc21_first_contacts', followups: 'pc21_followups',
  customersTouched: 'pc21_customers_touched', plannedDue: 'pc21_planned_due', completedPlan: 'pc21_completed_plan',
  completionRate: 'pc21_completion_rate', overdueNow: 'pc21_overdue_now', gifts: 'pc21_gifts', giftItems: 'pc21_gift_items',
  photos: 'pc21_photos', ocrParses: 'pc21_ocr_parses', aiSuggestions: 'pc21_ai_suggestions',
  policyReviews: 'pc21_policy_reviews', productUpdates: 'pc21_product_updates', newCandidates: 'pc21_new_candidates',
  rcFollowups: 'pc21_recruit_followups', candidatesTouched: 'pc21_candidates_touched', warm: 'pc21_warm',
  firstInterview: 'pc21_first_interview', event: 'pc21_events', deepInterview: 'pc21_deep_interview',
  apply: 'pc21_applications', hired: 'pc21_hired',
};
const localDay = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const dateInput = value => h('input', { class: 'sheet-input', type: 'date', value });
const metricValue = value => value == null ? '—' : `${value}${typeof value === 'number' && value !== 0 ? '' : ''}`;

function testDataNotice(summary) {
  if (!summary || summary.status === 'unverified') return h('p', { class: 'status-error' }, t('pc21_test_unverified'));
  if (!summary.containsTestData) return null;
  return h('p', { class: 'status-error' }, t('pc21_test_notice').replace('{count}', String(summary.recordCount)));
}

function sourceLink(row) {
  const personId = row.sourceRef?.personId;
  const section = row.sourceRef?.section;
  const target = section ? `/${section}` : '';
  return personId ? h('a', { class: 'btn btn-ghost btn-sm', href: `#/person/${encodeURIComponent(String(personId))}${target}`,
    title: `${row.sourceRef.table} #${row.sourceRef.id}` }, t('pc21_open_person')) : null;
}

function renderDaily(report, type) {
  const groups = type === 'customer' ? CUSTOMER_GROUPS : RECRUIT_GROUPS;
  const summary = [
    report.mode === 'today' ? t('pc21_today_live').replace('{date}', report.range?.start || '')
      : t('pc21_range_summary').replace('{start}', report.range?.start || '').replace('{end}', report.range?.end || '').replace('{days}', String(report.range?.days || 0)),
    t('pc21_date_basis'),
  ].join(' · ');
  const metricCards = groups.map(([groupKey, keys]) => card({ title: t(groupKey), icon: 'calendar', body: [
    h('div', { class: 'stat-row', style: 'flex-wrap:wrap' }, keys.map(key => {
      let value = report.totals?.[key];
      if (key === 'overdueNow') value = report.overdueNow;
      if (key === 'completionRate') value = value == null ? '—' : `${value}%`;
      const average = report.mode === 'range' && report.avg?.[key] != null ? `${t('pc21_daily_average')} ${report.avg[key]}` : '';
      return h('div', { class: 'stat' }, [
        h('b', {}, metricValue(value)), h('span', {}, t(METRIC_KEYS[key] || key)),
        average ? h('small', { class: 'row-sub' }, average) : null,
      ]);
    })),
  ] }));
  const dateLabels = report.daily || [];
  const dailyKeys = type === 'customer'
    ? ['newCustomers', 'followups', 'customersTouched', 'gifts', 'photos', 'ocrParses', 'aiSuggestions', 'policyReviews']
    : ['newCandidates', 'rcFollowups', 'candidatesTouched', 'warm', 'firstInterview', 'event', 'deepInterview', 'apply', 'hired'];
  const dailyTable = report.mode === 'range' ? card({ title: t('pc21_daily_trend'), icon: 'chart', body: [
    h('div', { style: 'overflow-x:auto' }, h('table', { class: 'data-table' }, [
      h('thead', {}, h('tr', {}, [h('th', {}, t('pc21_date')), ...dailyKeys.map(key => h('th', {}, t(METRIC_KEYS[key])))])),
      h('tbody', {}, dateLabels.map(day => h('tr', {}, [h('th', { scope: 'row' }, day.date), ...dailyKeys.map(key => h('td', {}, String(day[key] || 0)))]))),
    ])),
  ] }) : null;
  const feed = report.feed || [];
  const sourceRows = feed.map(row => h('tr', {}, [
    h('td', {}, row.day || ''), h('td', {}, row.type || ''),
    h('td', {}, row.name || '—'), h('td', {}, row.detail || '—'),
    h('td', {}, [
      sourceLink(row) || h('span', { class: 'row-sub' }, t('pc21_source_unavailable')),
      row.sourceRef ? h('small', { class: 'row-sub', title: `${row.sourceRef.table} #${row.sourceRef.id}` }, `${row.sourceRef.table} #${row.sourceRef.id}`) : null,
    ]),
  ]));
  const feedCard = card({ title: `${t('pc21_sources')} (${report.feedTotal ?? feed.length})`, icon: 'history', body: [
    report.feedTotal > feed.length ? h('p', { class: 'row-sub' }, t('pc21_recent_limit').replace('{shown}', String(feed.length)).replace('{total}', String(report.feedTotal))) : null,
    feed.length ? h('div', { style: 'overflow-x:auto' }, h('table', { class: 'data-table' }, [
      h('thead', {}, h('tr', {}, [t('pc21_date'), t('pc21_type'), t('pc21_subject'), t('pc21_detail'), t('pc21_source')].map(label => h('th', {}, label)))),
      h('tbody', {}, sourceRows),
    ])) : emptyNote(t('pc21_no_sources'), ''),
  ] });
  return h('div', { class: 'tab-stack' }, [
    testDataNotice(report.testData),
    h('p', { class: 'row-sub' }, summary),
    h('p', { class: 'row-sub' }, t('pc21_no_interaction_double_count')),
    ...metricCards, dailyTable, feedCard,
    type === 'recruit' && report.goalProgress && !report.goalProgress.error
      ? card({ title: t('pc21_goal_progress'), icon: 'target', body: [
        h('p', { class: 'row-sub' }, `${t('pc21_period_summary')}: ${report.goalProgress.overall?.new_count ?? 0} → ${report.goalProgress.overall?.sign_count ?? 0} · ${report.goalProgress.overall?.rate ?? 0}%`),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { location.hash = '#/recruit/goals'; } }, t('pc21_open_goals')),
      ] }) : null,
  ]);
}

export function renderActivityReport(ctx, type = 'customer', initialRange = {}) {
  const currentType = type === 'recruit' ? 'recruit' : 'customer';
  const todayDate = localDay();
  const start = dateInput(initialRange.startDate || todayDate);
  const end = dateInput(initialRange.endDate || todayDate);
  const status = h('div', { class: 'tab-stack' }, h('p', { class: 'row-sub' }, t('loading')));
  let mode = initialRange.startDate && initialRange.endDate ? 'range' : 'today';
  async function load(nextMode = mode) {
    mode = nextMode;
    status.replaceChildren(h('p', { class: 'row-sub' }, t('loading')));
    const params = mode === 'range' ? { mode, startDate: start.value, endDate: end.value } : { mode: 'today' };
    try {
      const result = await data.activityReport(ctx, currentType, params);
      if (result.error) throw new Error(result.error);
      status.replaceChildren(renderDaily(result, currentType));
    } catch (error) { status.replaceChildren(errorBox(error, () => load(mode))); }
  }
  const switchTo = target => {
    const range = mode === 'range' ? `?startDate=${encodeURIComponent(start.value)}&endDate=${encodeURIComponent(end.value)}` : '';
    location.hash = `#/activity-report/${target}${range}`;
  };
  ctx.main.replaceChildren(
    pageHead({ kicker: t('pc21_report_kicker'), title: t(currentType === 'customer' ? 'pc21_customer_report' : 'pc21_recruit_report'), tag: wpTag(t('fact')),
      actions: [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { location.hash = '#/today'; } }, t('pc21_back_today'))] }),
    h('section', { class: 'card card-body tab-stack' }, [
      h('div', { class: 'form-row', style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:end' }, [
        h('button', { class: `btn ${currentType === 'customer' ? 'btn-primary' : 'btn-ghost'}`, type: 'button', onclick: () => switchTo('customer') }, t('pc21_customer_tab')),
        h('button', { class: `btn ${currentType === 'recruit' ? 'btn-primary' : 'btn-ghost'}`, type: 'button', onclick: () => switchTo('recruit') }, t('pc21_recruit_tab')),
      ]),
      h('div', { class: 'form-row', style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:end' }, [
        h('label', { class: 'sheet-field' }, [h('span', {}, t('pc21_start_date')), start]),
        h('label', { class: 'sheet-field' }, [h('span', {}, t('pc21_end_date')), end]),
        h('button', { class: `btn ${mode === 'today' ? 'btn-primary' : 'btn-ghost'}`, type: 'button', onclick: () => load('today') }, t('pc21_today_button')),
        h('button', { class: `btn ${mode === 'range' ? 'btn-primary' : 'btn-ghost'}`, type: 'button', onclick: () => load('range') }, t('pc21_query_range')),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => load(mode) }, t('btn_refresh')),
      ]),
    ]),
    status,
  );
  load(mode);
}
