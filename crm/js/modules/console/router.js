// Console 路由：hash 精确表 + 详情正则；未知路由回落到今日。
import {
  renderToday, renderPeople, renderPeopleTrash, renderPerson, renderOpportunities,
  renderActivities, renderActivity, renderRecruit, renderAI, renderMore,
  renderSettings, renderRecruitGoals, renderActivityReport, renderAiExperience,
  renderKnowledgeGovernance,
} from './views.js';

const EXACT = new Map([
  ['#/today', renderToday],
  ['#/people', renderPeople],
  ['#/people-trash', renderPeopleTrash],
  ['#/opportunities', renderOpportunities],
  ['#/activities', renderActivities],
  ['#/recruit', renderRecruit],
  ['#/recruit/goals', renderRecruitGoals],
  ['#/ai', renderAI],
  ['#/ai/experience', ctx => renderAiExperience({ root:ctx.main, callFn:ctx.callFn })],
  ['#/more', renderMore],
  ['#/settings', renderSettings],
  ['#/knowledge-governance', renderKnowledgeGovernance],
]);

const PATTERNS = [
  { re: /^#\/person\/(\d+)(?:\/(timeline|insurance|opportunities|relationships|recruit|care|ocr))?$/, nav: '#/people', render: (ctx, id, section) => renderPerson(ctx, id, section) },
  { re: /^#\/activity\/(\d+)$/, nav: '#/activities', render: renderActivity },
  { re: /^#\/activity-report\/(customer|recruit)(?:\?(.*))?$/, nav: '#/today', render: (ctx, type, query) => {
    const params = new URLSearchParams(query || '');
    return renderActivityReport(ctx, type, { startDate: params.get('startDate'), endDate: params.get('endDate') });
  } },
  { re: /^#\/knowledge-governance(?:\?(.*))?$/, nav: '#/more', render: (ctx, query) => {
    const params = new URLSearchParams(query || '');
    return renderKnowledgeGovernance(ctx, { focusItemId: params.get('item') });
  } },
];

const NAV_OF = {
  '#/': '#/today',
  '#/today': '#/today',
  '#/people': '#/people',
  '#/people-trash': '#/people',
  '#/opportunities': '#/opportunities',
  '#/activities': '#/activities',
  '#/recruit': '#/recruit',
  '#/recruit/goals': '#/recruit',
  '#/ai': '#/ai',
  '#/ai/experience': '#/ai',
  '#/more': '#/more',
  '#/settings': '#/more',
  '#/knowledge-governance': '#/more',
  '#/activity-report/customer': '#/today',
  '#/activity-report/recruit': '#/today',
};

export function navHashFor(raw) {
  const hash = raw || '#/today';
  for (const p of PATTERNS) if (p.re.test(hash)) return p.nav;
  return NAV_OF[hash] || '#/today';
}

export function dispatch(raw, ctx) {
  const hash = raw || '#/today';
  for (const p of PATTERNS) {
    const m = hash.match(p.re);
    if (m) return p.render(ctx, m[1]);
  }
  (EXACT.get(hash) || renderToday)(ctx);
}
