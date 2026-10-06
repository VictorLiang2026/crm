// Console 只读数据层（WP1）：所有调用经 ctx.api（core/createApi：校验函数名、拒绝 pr_*）。
// 只封装 admin.html / person_360 已上线的只读 action，不新增任何云函数与数据库对象。
async function call(ctx, name, params) {
  const res = await ctx.api.call(name, params || {});
  if (res == null || typeof res !== 'object') throw new Error('服务无响应');
  if (res.error) {
    const msg = typeof res.error === 'string' ? res.error : '请求失败';
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
  cockpit: (ctx) => call(ctx, 'today_coach', { action: 'cockpit' }),
  morningBrief: (ctx) => call(ctx, 'today_coach', { action: 'daily_review', view: 'morning' }),
  activities: (ctx) => call(ctx, 'activities', { action: 'list' }),

  // ---------- 人物目录 ----------
  listPeople: (ctx, params) => p360(ctx, 'listPeople', params || {}),

  // ---------- Person 360 ----------
  personHome: (ctx, personId) => p360(ctx, 'get', { personId }),
  customerProfile: (ctx, personId) => p360(ctx, 'getCustomerProfile', { personId }),
  personWorkItems: (ctx, personId) => p360(ctx, 'listPersonWorkItems', { personId }),
  personInteractions: (ctx, personId, limit) =>
    p360(ctx, 'listInteractions', { personId, ...(limit ? { limit } : {}) }),
  timeline: (ctx, personId, page, pageSize) =>
    p360(ctx, 'getTimelinePage', { personId, page, pageSize }),
  contextGroups: (ctx, personId) => p360(ctx, 'getContextGroups', { personId }),
  insurance: (ctx, personId) => p360(ctx, 'getInsuranceContext', { personId }),
  personOpportunities: (ctx, personId) => p360(ctx, 'listOpportunities', { personId }),
  recruitContext: (ctx, personId) => p360(ctx, 'listRecruitContext', { personId }),
  lookupCustomer: (ctx, customerId) => p360(ctx, 'lookupCustomer', { customerId }),

  // ---------- 活动 ----------
  activityDetail: (ctx, id) => call(ctx, 'activities', { action: 'get', id: Number(id) }),
  activityTasks: (ctx, activityId) =>
    call(ctx, 'activity_tasks', { action: 'list', activity_id: Number(activityId) }),

  // ---------- 招募 ----------
  recruitList: (ctx, params) => call(ctx, 'recruit_candidates', { action: 'list', ...(params || {}) }),
  recruitPersonOnly: (ctx) => p360(ctx, 'listPersonOnlyRecruits'),
  recruitFunnel: (ctx) => call(ctx, 'recruit_candidates', { action: 'funnel' }),
  recruitProgress: (ctx, startMonth, endMonth) =>
    call(ctx, 'recruit_goals', { action: 'getProgress', startMonth, endMonth }),
};
