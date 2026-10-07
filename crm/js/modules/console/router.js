// Console 路由：hash 精确表 + 详情正则；未知路由回落到今日。
import {
  renderToday, renderPeople, renderPerson, renderOpportunities,
  renderActivities, renderActivity, renderRecruit, renderAI, renderMore,
  renderSettings,
} from './views.js';

const EXACT = new Map([
  ['#/today', renderToday],
  ['#/people', renderPeople],
  ['#/opportunities', renderOpportunities],
  ['#/activities', renderActivities],
  ['#/recruit', renderRecruit],
  ['#/ai', renderAI],
  ['#/more', renderMore],
  ['#/settings', renderSettings],
]);

const PATTERNS = [
  { re: /^#\/person\/(\d+)$/, nav: '#/people', render: renderPerson },
  { re: /^#\/activity\/(\d+)$/, nav: '#/activities', render: renderActivity },
];

const NAV_OF = {
  '#/': '#/today',
  '#/today': '#/today',
  '#/people': '#/people',
  '#/opportunities': '#/opportunities',
  '#/activities': '#/activities',
  '#/recruit': '#/recruit',
  '#/ai': '#/ai',
  '#/more': '#/more',
  '#/settings': '#/more',
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
