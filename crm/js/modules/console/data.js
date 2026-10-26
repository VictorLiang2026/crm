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
  proactiveCoachCandidates: (ctx) => p360(ctx, 'listProactiveCoachCandidates'),
  decideProactiveCoachCandidate: (ctx, payload) => p360(ctx, 'recordProactiveCoachDecision', { data: payload }),
  previewWorkItem: (ctx, payload) => p360(ctx, 'previewWorkItem', { data: payload }),
  executeWorkItem: (ctx, previewId) => p360(ctx, 'executeWorkItem', { previewId }),
  dueCommitments: (ctx) => p360(ctx, 'listDueCommitments'),
  pendingOpportunities: (ctx) => p360(ctx, 'listPendingOpportunityCandidates'),
  opportunityDirectory: (ctx, params) => p360(ctx, 'listOpportunityDirectory', params || {}),
  opportunityDetails: (ctx, id) => p360(ctx, 'getOpportunityDirectoryDetails', { id }),
  previewLegacyOpportunity: (ctx, payload) => p360(ctx, 'previewLegacyOpportunity', { data: payload }),
  executeLegacyOpportunity: (ctx, previewId) => p360(ctx, 'executeLegacyOpportunity', { previewId }),
  searchPeopleForOpportunities: (ctx, name) => p360(ctx, 'search', { name }),
  legacyOpportunityFunnel: (ctx) => call(ctx, 'funnel_insight', { action: 'stats' }),
  funnelStats: (ctx) => call(ctx, 'funnel_insight', { action: 'stats', presentation: 'stage_facts' }),
  explainFunnels: (ctx, language = 'zh-CN') => call(ctx, 'funnel_insight', { action: 'explain', presentation: 'stage_facts', language }),
  cockpit: (ctx) => call(ctx, 'today_coach', { action: 'cockpit' }),
  morningBrief: (ctx) => call(ctx, 'today_coach', { action: 'daily_review', view: 'morning' }),
  aiSearch: (ctx, query) => call(ctx, 'assistant', { action: 'search', query }),
  aiSearchV2: (ctx, payload) => call(ctx, 'assistant', { action: 'searchV2', ...payload }),
  assistantReadTask: (ctx, payload) => call(ctx, 'assistant', { action: 'assistantReadTask', ...payload }),
  summarizePerson: (ctx, personId) => call(ctx, 'assistant', { action: 'summarize', personId }),
  meetingPrep: (ctx, personId) => call(ctx, 'assistant', { action: 'meetingPrep', personId }),
  conversationPlaybook: (ctx, personId, objection) => call(ctx, 'assistant', { action: 'conversationPlaybook', personId, objection }),
  conversationPlaybookHistory: (ctx, personId) => call(ctx, 'assistant', { action: 'conversationPlaybookHistory', personId }),
  personAIHistory: (ctx, personId) => call(ctx, 'assistant', { action: 'personAIHistory', personId }),
  knowledgeGovernance: (ctx) => p360(ctx, 'listKnowledgeGovernance'),
  saveKnowledgeGovernance: (ctx, payload) => p360(ctx, 'saveKnowledgeGovernance', { data: payload }),
  reviewKnowledgeGovernance: (ctx, payload) => p360(ctx, 'reviewKnowledgeGovernance', { data: payload }),
  createKnowledgeFixtures: (ctx) => p360(ctx, 'createKnowledgeGovernanceFixtures'),
  activities: (ctx) => call(ctx, 'activities', { action: 'list' }),

  // ---------- 人物目录 ----------
  listPeople: (ctx, params) => p360(ctx, 'listPeople', params || {}),
  listPersonTrash: (ctx, params) => p360(ctx, 'listPersonTrash', params || {}),
  restorePerson: (ctx, personId) => p360(ctx, 'restorePerson', { data: { personId: String(personId) } }),
  customerTrash: (ctx, params) => call(ctx, 'customers', { action: 'trashList', ...(params || {}) }),
  restoreCustomer: (ctx, id) => call(ctx, 'customers', { action: 'restore', ids: [Number(id)] }),
  previewRecycleBatch: (ctx, draft) => p360(ctx, 'previewRecycleBatch', { data: draft }),
  getRecycleBatch: (ctx, previewId) => p360(ctx, 'getRecycleBatch', { previewId }),
  executeRecycleBatch: (ctx, previewId) => p360(ctx, 'executeRecycleBatch', { previewId }),
  recruitTrash: (ctx, params) => call(ctx, 'recruit_candidates', { action: 'trashList', ...(params || {}) }),
  personOnlyRecruitTrash: (ctx) => p360(ctx, 'listPersonOnlyRecruitTrash'),
  restoreRecruit: (ctx, id, personOnly) => personOnly
    ? p360(ctx, 'restorePersonOnlyRecruit', { ids: [Number(id)] })
    : call(ctx, 'recruit_candidates', { action: 'restore', ids: [Number(id)] }),

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
  saveFileOriginal: (ctx, payload) => p360(ctx, 'saveFileOriginal', { data: payload }),
  fileImports: (ctx, personId, page = 1) => p360(ctx, 'listFileImports', { personId, page }),
  parseFileDraft: (ctx, jobId) => p360(ctx, 'parseFileDraft', { jobId }),
  savePersonFileOriginal: (ctx, payload) => p360(ctx, 'savePersonFileOriginal', { data: payload }),
  personFiles: (ctx, personId, page = 1) => p360(ctx, 'listPersonFiles', { personId, page }),
  personFile: (ctx, jobId) => p360(ctx, 'getPersonFile', { jobId }),
  parsePersonFileDraft: (ctx, jobId) => p360(ctx, 'parsePersonFileDraft', { jobId }),
  previewPersonFile: (ctx, payload) => p360(ctx, 'previewPersonFile', { data: payload }),
  previewPersonFileUndo: (ctx, payload) => p360(ctx, 'previewPersonFileUndo', { data: payload }),
  executePersonFile: (ctx, previewId) => p360(ctx, 'executePersonFile', { previewId }),
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
  updateActivityParticipant: (ctx, id, activityId, expectedUpdatedAt, expectedStatus, status) => call(ctx, 'activities', {
    action: 'updateParticipantConsole', id: Number(id), activity_id: Number(activityId),
    expectedUpdatedAt, expectedStatus, status,
  }),
  resolveActivityPerson: (ctx, name) => p360(ctx, 'resolveIdentity', { name }),
  addCanonicalParticipant: (ctx, payload) => p360(ctx, 'addCanonicalParticipant', { data: payload }),
  linkCanonicalParticipant: (ctx, payload) => p360(ctx, 'linkCanonicalParticipant', { data: payload }),
  addTemporaryParticipant: (ctx, payload) => call(ctx, 'activities', { action: 'addParticipant', data: payload }),
  activitySpeakers: (ctx, params = {}) => call(ctx, 'activity_speakers', { action: 'list', ...params }),
  updateActivitySpeaker: (ctx, id, payload) => call(ctx, 'activity_speakers', { action: 'update', id: Number(id), data: payload }),
  createPersonSpeaker: (ctx, payload) => p360(ctx, 'createSpeakerProfile', { data: payload }),
  linkSpeakerPerson: (ctx, payload) => p360(ctx, 'linkSpeakerPerson', { data: payload }),
  previewRemoveSpeaker: (ctx, id) => call(ctx, 'activity_speakers', { action: 'previewRemoveConsole', id: Number(id) }),
  removeSpeaker: (ctx, id, expectedUpdatedAt, expectedParticipantRows) => call(ctx, 'activity_speakers', {
    action: 'removeConsole', id: Number(id), expectedUpdatedAt, expectedParticipantRows,
  }),
  activityTopics: (ctx) => call(ctx, 'activity_topics', { action: 'list' }),
  resourceDirectory: (ctx, kind, { keyword = '', status = '', page = 1, pageSize = 20 } = {}) => {
    if (!['speaker', 'topic'].includes(kind)) throw new Error('Invalid resource kind');
    return call(ctx, kind === 'speaker' ? 'activity_speakers' : 'activity_topics',
      { action: 'directory', keyword, status, page, pageSize });
  },
  createActivityTopic: (ctx, payload) => call(ctx, 'activity_topics', { action: 'create', data: payload }),
  updateActivityTopic: (ctx, id, payload) => call(ctx, 'activity_topics', { action: 'update', id: Number(id), data: payload }),
  previewRemoveTopic: (ctx, id) => call(ctx, 'activity_topics', { action: 'previewRemoveConsole', id: Number(id) }),
  removeActivityTopic: (ctx, id, expectedUpdatedAt, expectedActivityReferences) => call(ctx, 'activity_topics', {
    action: 'removeConsole', id: Number(id), expectedUpdatedAt, expectedActivityReferences,
  }),
  applyActivityTopics: (ctx, activityId, topicIds, expectedUpdatedAt, expectedTopicIds) => call(ctx, 'activities', {
    action: 'applyTopicsConsole', id: Number(activityId), topic_ids: topicIds,
    expectedUpdatedAt, expectedTopicIds,
  }),
  activityPostReviewV2: (ctx, activityId) =>
    call(ctx, 'ai_activity', { action: 'postReviewV2', activity_id: Number(activityId) }),
  activityReviewHistory: (ctx, activityId) =>
    p360(ctx, 'listActivityReviewHistory', { activityId: Number(activityId) }),
  previewActivityReview: (ctx, payload) =>
    p360(ctx, 'previewActivityReview', { data: payload }),
  executeActivityReview: (ctx, previewId) =>
    p360(ctx, 'executeActivityReview', { previewId }),
  activityData: (ctx, activityId) =>
    call(ctx, 'activities', { action: 'getActivityData', id: Number(activityId) }),

  // ---------- 招募 ----------
  recruitList: (ctx, params) => call(ctx, 'recruit_candidates', { action: 'list', ...(params || {}) }),
  recruitPersonOnly: (ctx) => p360(ctx, 'listPersonOnlyRecruits'),
  recruitDirectory: (ctx, params) => p360(ctx, 'listRecruitDirectory', params || {}),
  resolveRecruitCandidateName: (ctx, name) => p360(ctx, 'resolveRecruitCandidateName', { name }),
  createRecruitCandidate: (ctx, payload) => p360(ctx, 'createRecruitCandidate', { data: payload }),
  recruitCandidateDetails: (ctx, candidateId, personId) => p360(ctx, 'getRecruitCandidate', { candidateId, personId }),
  recruitDeleteInterpret: (ctx, query, language) => call(ctx, 'assistant', {
    action: 'recruitDeleteInterpret', query, language,
  }),
  recruitDeleteTargets: (ctx, personMention, selectedPersonId) => call(ctx, 'assistant', {
    action: 'recruitDeleteTargets', personMention, selectedPersonId,
  }),
  recruitDeleteCommand: (ctx, payload) => call(ctx, 'assistant', {
    action: 'recruitDeleteCommand', ...payload,
  }),
  recruitCoach: async (ctx, operation, payload) => {
    const result = await call(ctx, 'assistant', { action: 'recruitCoach', operation, ...(payload || {}) });
    if (result.ok === false) throw new Error(result.error?.message || 'Recruit Coach request failed');
    return result;
  },
  previewRecruitCoachOutcome: (ctx, payload) => p360(ctx, 'previewRecruitCoachOutcome', payload),
  confirmRecruitCoachOutcome: (ctx, payload) => p360(ctx, 'confirmRecruitCoachOutcome', payload),
  executeRecruitCoachOutcome: (ctx, payload) => p360(ctx, 'executeRecruitCoachOutcome', payload),
  transitionRecruitStage: (ctx, payload) => p360(ctx, 'transitionRecruitStage', { data: payload }),
  updateRecruitCandidate: (ctx, id, expectedUpdatedAt, payload) => call(ctx, 'recruit_candidates', {
    action: 'update', id: String(id), expectedUpdatedAt, data: payload,
  }),
  recruitFollowups: (ctx, candidateId) => call(ctx, 'recruit_followups', { action: 'list', candidate_id: String(candidateId) }),
  createRecruitFollowup: (ctx, payload) => call(ctx, 'recruit_followups', { action: 'create', data: payload }),
  updateRecruitFollowup: (ctx, id, payload) => call(ctx, 'recruit_followups', { action: 'update', id: String(id), data: payload }),
  recruitFunnel: (ctx) => call(ctx, 'recruit_candidates', { action: 'funnel' }),
  recruitProgress: (ctx, startMonth, endMonth) =>
    call(ctx, 'recruit_goals', { action: 'getProgress', startMonth, endMonth }),
  recruitGoals: (ctx, startMonth, endMonth) =>
    call(ctx, 'recruit_goals', { action: 'listGoals', startMonth, endMonth }),
  saveRecruitGoals: (ctx, goalMonth, goals) => call(ctx, 'recruit_goals', {
    action: 'saveGoals', goalMonth, goals, operator: ctx.operator?.name || '',
  }),
  recruitBenchmarks: ctx => call(ctx, 'recruit_goals', { action: 'listBenchmarks' }),
  saveRecruitBenchmarks: (ctx, benchmarks) => call(ctx, 'recruit_goals', { action: 'saveBenchmarks', atomic: true, benchmarks }),
  activityReport: (ctx, action, params = {}) => call(ctx, 'activity_reports', { action, ...params }),
};
