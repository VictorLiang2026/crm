/** Audited activity preparation advice. Business records stay untouched. */
'use strict';

const { createAIGateway } = require('./ai-gateway');
const { createContextEngine } = require('./context-engine');
const { createPublicRdb } = require('./public-rdb');
const { activityIdOf } = require('./activity-review-v2');

async function run(event, { app, rdb, gateway, engine } = {}) {
  const identity = app?.auth()?.getUserInfo();
  if (typeof identity?.uid !== 'string' || !identity.uid.trim() || identity.isAnonymous !== false) {
    return { error: 'UNAUTHORIZED' };
  }
  const activityId = activityIdOf(event?.activity_id);
  const mode = event?.mode === 'decompose' ? 'decompose' : event?.mode === 'prepare' ? 'prepare' : null;
  if (!mode) return { error: 'INVALID_MODE' };
  const language = event?.language === 'en' ? 'en' : event?.language === 'zh-CN' ? 'zh-CN' : null;
  if (!language) return { error: 'INVALID_LANGUAGE' };
  const database = rdb || createPublicRdb({ env: process.env.TCB_ENV,
    key: process.env.CRM_ACTIVITY_REVIEW_DB_API_KEY });
  const contextEngine = engine || createContextEngine({ rdb: database });
  const built = await contextEngine.buildContext({ recipe: 'activity_prepare',
    subjectType: 'activity', subjectId: activityId });
  const status = built.context.activity.data.status;
  if (!['idea', 'preparing', 'confirmed', 'in_progress'].includes(status)) return { error: 'ACTIVITY_NOT_PREPARING' };
  const aiGateway = gateway || createAIGateway({ app, rdb: database, timeoutMs: 80000, maxAttempts: 1 });
  const task = await aiGateway.runAITask({
    taskType: 'activity_prepare', skill: 'activity_prepare', capability: 'planning',
    subjectType: 'activity', subjectId: activityId,
    input: { activityId: String(activityId), objective: language === 'en'
      ? (mode === 'decompose'
        ? 'Respond in English. Break preparation into suggested tasks. Do not write business records.'
        : 'Respond in English. Assess preparation, risks, outreach and checklist. Do not write business records.')
      : (mode === 'decompose'
        ? '请用简体中文回答，拆解筹备任务；不要修改业务记录。'
        : '请用简体中文回答，评估筹备、风险、邀约与清单；不要修改业务记录。') },
    context: built.context, contextSnapshot: built.context_snapshot,
  });
  return { activity_id: activityId, task_id: task.taskId, result_id: task.resultId,
    plan: task.result, testData: task.testData, requires_confirmation: true,
    business_data_written: false };
}

module.exports = { run };
