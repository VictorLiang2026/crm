// Console 页面 barrel（WP1）：路由层只依赖本文件；实现拆分到 pages/。
export { renderToday } from './pages/today.js';
export { renderPeople } from './pages/people.js';
export { renderPersonFileImport } from './person-files.js';
export { renderPeopleTrash } from './pages/people-trash.js';
export { renderCustomerTrash, renderRecruitTrash, renderRecycleHub } from './pages/recycle.js';
export { renderPerson } from './pages/person.js';
export { renderOpportunities } from './pages/opportunities.js';
export { renderActivities, renderActivity } from './pages/activities.js';
export { renderResourceDirectory } from './activity-people.js';
export { renderRecruit } from './pages/recruit.js';
export { renderRecruitGoals } from './recruit-goals.js';
export { renderActivityReport } from './activity-report.js';
export { renderAnalytics } from './analytics.js';
export { renderAI, renderMore } from './pages/misc.js';
export { renderAiExperience } from './ai-experience.js';
export { renderSettings } from './pages/settings.js';
export { renderTestScenario, renderTestAction } from './test-tools.js';
export { renderKnowledgeGovernance } from './knowledge-governance.js';
