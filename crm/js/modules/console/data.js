// Console 数据层（WP1）：调用经 ctx.api（core/createApi：校验函数名、拒绝 pr_*）。
// 仅封装当前页面所需的 CRM 云函数 action；业务写入仍由服务端作用域与预览执行边界控制。
async function call(ctx, name, params) {
  const res = await ctx.api.call(name, params || {});
  if (res == null || typeof res !== 'object') throw new Error('服务无响应');
  if (res.error) {
    const e = res.error;
    const msg = typeof e === 'string' ? e :
      [e.code, e.message].filter(Boolean).join(': ') || '请求失败';
    throw new Error(msg);
  }
  return res;
}

const p360 = (ctx, action, extra) => call(ctx, 'person_360', { action, ...(extra || {}) });

export const data = {
  // ---------- 今日 ----------
  todayWorkItems: (ctx) => p360(ctx, 'listTodayWorkItems'),
  dueCommitments: (ctx) => p360(ctx, 'listDueCommitments'),
  pendingOpportunities: (ctx) => p360(ctx, 'listPendingOpportunityCandidates'),
  opportunityDirectory: (ctx, params) => p360(ctx, 'listOpportunityDirectory', params || {}),
  opportunityDetails: (ctx, id) => p360(ctx, 'getOpportunityDirectoryDetails', { id }),
  searchPeopleForOpportunities: (ctx, name) => p360(ctx, 'search', { name }),
  legacyOpportunityFunnel: (ctx) => call(ctx, 'funnel_insight', { action: 'stats' }),
  cockpit: (ctx) => call(ctx, 'today_coach', { action: 'cockpit' }),
  morningBrief: (ctx) => call(ctx, 'today_coach', { action: 'daily_review', view: 'morning' }),
  aiSearch: (ctx, query) => call(ctx, 'assistant', { action: 'search', query }),
  summarizePerson: (ctx, personId) => call(ctx, 'assistant', { action: 'summarize', personId }),
  meetingPrep: (ctx, personId) => call(ctx, 'assistant', { action: 'meetingPrep', personId }),
  conversationPlaybook: (ctx, personId, objection) => call(ctx, 'assistant', { action: 'conversationPlaybook', personId, objection }),
  conversationPlaybookHistory: (ctx, personId) => call(ctx, 'assistant', { action: 'conversationPlaybookHistory', personId }),
  activities: (ctx) => call(ctx, 'activities', { action: 'list' }),

  // ---------- 人物目录 ----------
  listPeople: (ctx, params) => p360(ctx, 'listPeople', params || {}),
  listPersonTrash: (ctx, params) => p360(ctx, 'listPersonTrash', params || {}),
  restorePerson: (ctx, personId) => p360(ctx, 'restorePerson', { data: { personId: String(personId) } }),

  // ---------- Person 360 ----------
  personHome: (ctx, personId) => p360(ctx, 'get', { personId }),
  resolveHouseholdMember: (ctx, name) => p360(ctx, 'resolveHouseholdMember', { name }),
  previewHousehold: (ctx, personId, operation, data) => p360(ctx, 'previewHousehold', { personId, operation, data }),
  executeHousehold: (ctx, previewId) => p360(ctx, 'executeHousehold', { previewId }),
  relationships: (ctx, personId, includeDeleted = false) => p360(ctx, 'listRelationships', { personId, includeDeleted }),
  relationshipNetwork: (ctx, personId, page = 1) => p360(ctx, 'listRelationshipNetwork', { personId, page }),
  expandRelationshipNetwork: (ctx, personId, neighborPersonId, page = 1) =>
    p360(ctx, 'expandRelationshipNetwork', { personId, neighborPersonId, page }),
  relationshipIntroductionPaths: (ctx, personId) => p360(ctx, 'listRelationshipIntroductionPaths', { personId }),
  suggestRelationshipIntroduction: (ctx, personId, targetPersonId, edgeIds) =>
    p360(ctx, 'suggestRelationshipIntroduction', { personId, targetPersonId, edgeIds }),
  resolveRelationshipName: (ctx, name) => p360(ctx, 'resolveRelationshipName', { name }),
  previewRelationship: (ctx, personId, operation, payload) => p360(ctx, 'previewRelationship', { personId, operation, data: payload }),
  executeRelationship: (ctx, previewId) => p360(ctx, 'executeRelationship', { previewId }),
  customerProfile: (ctx, personId) => p360(ctx, 'getCustomerProfile', { personId }),
  resolvePersonName: (ctx, name) => p360(ctx, 'resolveIdentity', { name }),
  ocrRecords: (ctx, customerId) => call(ctx, 'ocr_records', {
    action: 'list', customer_id: Number(customerId),
  }),
  parseOcr: (ctx, input) => call(ctx, 'ai_parse', { action: 'parse', ...(input || {}) }),
  ocrParseCommands: (ctx, personId) => p360(ctx, 'listOcrParseCommands', { personId }),
  previewOcrParse: (ctx, data) => p360(ctx, 'previewOcrParse', { data }),
  executeOcrParse: (ctx, previewId) => p360(ctx, 'executeOcrParse', { previewId }),
  previewOcrUndo: (ctx, data) => p360(ctx, 'previewOcrUndo', { data }),
  // ---------- 客户关怀与资料（仅 Person 关联的 customer_id） ----------
  gifts: (ctx, customerId, paging = {}) => call(ctx, 'gifts', {
    action: 'list', customer_id: Number(customerId), ...(paging || {}),
  }),
  createGift: (ctx, payload) => call(ctx, 'gifts', { action: 'create', data: payload }),
  updateGift: (ctx, id, customerId, payload) => call(ctx, 'gifts', {
    action: 'update', id: Number(id), customer_id: Number(customerId), data: payload,
  }),
  removeGift: (ctx, id, customerId) => call(ctx, 'gifts', {
    action: 'remove', id: Number(id), customer_id: Number(customerId),
  }),
  photos: (ctx, customerId, paging = {}) => call(ctx, 'photos', {
    action: 'list', customer_id: Number(customerId), ...(paging || {}),
  }),
  createPhoto: (ctx, payload) => call(ctx, 'photos', { action: 'create', data: payload }),
  getPhoto: (ctx, id, customerId) => call(ctx, 'photos', {
    action: 'get', id: Number(id), customer_id: Number(customerId),
  }),
  updatePhoto: (ctx, id, customerId, payload) => call(ctx, 'photos', {
    action: 'update', id: Number(id), customer_id: Number(customerId), data: payload,
  }),
  removePhoto: (ctx, id, customerId) => call(ctx, 'photos', {
    action: 'remove', id: Number(id), customer_id: Number(customerId),
  }),
  personWorkItems: (ctx, personId) => p360(ctx, 'listPersonWorkItems', { personId }),
  personInteractions: (ctx, personId, limit) =>
    p360(ctx, 'listInteractions', { personId, ...(limit ? { limit } : {}) }),
  createInteraction: (ctx, personId, payload) =>
    p360(ctx, 'createInteraction', { personId, data: payload }),
  timeline: (ctx, personId, page, pageSize) =>
    p360(ctx, 'getTimelinePage', { personId, page, pageSize }),
  customerFollowups: (ctx, customerId) => call(ctx, 'followups', { action: 'list', customer_id: Number(customerId) }),
  customerRecommendations: (ctx, customerId) => call(ctx, 'ai_recommendations', { action: 'list', customer_id: Number(customerId) }),
  createCustomerFollowup: (ctx, payload) => call(ctx, 'followups', { action: 'create', data: payload }),
  updateCustomerFollowup: (ctx, id, payload) => call(ctx, 'followups', { action: 'update', id: Number(id), data: payload }),
  removeCustomerFollowup: (ctx, id) => call(ctx, 'followups', { action: 'remove', id: Number(id) }),
  contextGroups: (ctx, personId) => p360(ctx, 'getContextGroups', { personId }),
  insurance: (ctx, personId) => p360(ctx, 'getInsuranceContext', { personId }),
  personProducts: (ctx, personId) => call(ctx, 'products', { action: 'list', personId: String(personId) }),
  savePersonProducts: (ctx, personId, expectedVersion, payload) => call(ctx, 'products', {
    action: 'upsert', personId: String(personId), expectedVersion: String(expectedVersion), data: payload,
  }),
  policyReports: (ctx, customerId) => call(ctx, 'policy_review_reports', {
    action: 'list', customer_id: Number(customerId),
  }),
  policyReport: (ctx, reportId) => call(ctx, 'policy_review_reports', {
    action: 'get', id: Number(reportId),
  }),
  generatePolicyReport: (ctx, customerId) => call(ctx, 'policy_review_reports', {
    action: 'generate', customer_id: Number(customerId),
  }),
  updatePolicyReport: (ctx, reportId, payload) => call(ctx, 'policy_review_reports', {
    action: 'update', id: Number(reportId), data: payload,
  }),
  personOpportunities: (ctx, personId) => p360(ctx, 'listOpportunities', { personId }),
  recruitContext: (ctx, personId) => p360(ctx, 'listRecruitContext', { personId }),
  lookupCustomer: (ctx, customerId) => p360(ctx, 'lookupCustomer', { customerId }),

  // ---------- 活动 ----------
  activityDetail: (ctx, id) => call(ctx, 'activities', { action: 'get', id: Number(id) }),
  createActivity: (ctx, payload) => call(ctx, 'activities', { action: 'create', data: payload }),
  updateActivity: (ctx, id, expectedUpdatedAt, payload) => call(ctx, 'activities', {
    action: 'updateConsole', id: Number(id), expectedUpdatedAt, data: payload,
  }),
  previewRemoveActivity: (ctx, id) => call(ctx, 'activities', { action: 'previewRemove', id: Number(id) }),
  removeActivity: (ctx, id, expectedUpdatedAt, expectedParticipantCount) => call(ctx, 'activities', {
    action: 'removeConsole', id: Number(id), expectedUpdatedAt, expectedParticipantCount,
  }),
  activityTasks: (ctx, activityId) =>
    call(ctx, 'activity_tasks', { action: 'list', activity_id: Number(activityId) }),
  createActivityTask: (ctx, payload) => call(ctx, 'activity_tasks', { action: 'create', data: payload }),
  updateActivityTask: (ctx, id, activityId, expectedUpdatedAt, payload) => call(ctx, 'activity_tasks', {
    action: 'updateConsole', id: Number(id), activity_id: Number(activityId), expectedUpdatedAt, data: payload,
  }),
  transitionActivityTask: (ctx, id, activityId, expectedUpdatedAt, status) => call(ctx, 'activity_tasks', {
    action: 'transitionConsole', id: Number(id), activity_id: Number(activityId), expectedUpdatedAt, status,
  }),
  removeActivityTask: (ctx, id, activityId, expectedUpdatedAt) => call(ctx, 'activity_tasks', {
    action: 'removeConsole', id: Number(id), activity_id: Number(activityId), expectedUpdatedAt,
  }),
  activityPostReviewV2: (ctx, activityId) =>
    call(ctx, 'ai_activity', { action: 'postReviewV2', activity_id: Number(activityId) }),
  activityData: (ctx, activityId) =>
    call(ctx, 'activities', { action: 'getActivityData', id: Number(activityId) }),

  // ---------- 招募 ----------
  recruitList: (ctx, params) => call(ctx, 'recruit_candidates', { action: 'list', ...(params || {}) }),
  recruitPersonOnly: (ctx) => p360(ctx, 'listPersonOnlyRecruits'),
  recruitFunnel: (ctx) => call(ctx, 'recruit_candidates', { action: 'funnel' }),
  recruitProgress: (ctx, startMonth, endMonth) =>
    call(ctx, 'recruit_goals', { action: 'getProgress', startMonth, endMonth }),
};
