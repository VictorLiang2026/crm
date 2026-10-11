// Console 页面 barrel（WP1）：路由层只依赖本文件；实现拆分到 pages/。
export { renderToday } from './pages/today.js';
export { renderPeople } from './pages/people.js';
export { renderPeopleTrash } from './pages/people-trash.js';
export { renderPerson } from './pages/person.js';
export { renderOpportunities } from './pages/opportunities.js';
export { renderActivities, renderActivity } from './pages/activities.js';
export { renderRecruit } from './pages/recruit.js';
export { renderAI, renderMore } from './pages/misc.js';
export { renderSettings } from './pages/settings.js';
