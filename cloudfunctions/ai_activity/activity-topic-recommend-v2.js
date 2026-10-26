/** Read-only Gateway suggestions from the verified public activity topic pool. */
'use strict';

const { createAIGateway } = require('./ai-gateway');
const { createContextEngine } = require('./context-engine');
const { createPublicRdb } = require('./public-rdb');
const { activityIdOf } = require('./activity-review-v2');

const PREPARING = new Set(['idea', 'preparing', 'confirmed', 'in_progress']);
const idOf = value => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

async function run(event, { app, rdb, gateway, engine } = {}) {
  const identity = app?.auth()?.getUserInfo();
  if (typeof identity?.uid !== 'string' || !identity.uid.trim() || identity.isAnonymous !== false) {
    return { error: 'UNAUTHORIZED' };
  }
  const activityId = activityIdOf(event?.activity_id);
  const language = event?.language === 'en' ? 'en' : event?.language === 'zh-CN' ? 'zh-CN' : null;
  if (!language) return { error: 'INVALID_LANGUAGE' };
  const database = rdb || createPublicRdb({ env: process.env.TCB_ENV,
    key: process.env.CRM_ACTIVITY_REVIEW_DB_API_KEY });
  const contextEngine = engine || createContextEngine({ rdb: database });
  const built = await contextEngine.buildContext({ recipe: 'activity_prepare',
    subjectType: 'activity', subjectId: activityId });
  if (!PREPARING.has(built.context.activity.data.status)) return { error: 'ACTIVITY_NOT_PREPARING' };

  const activityResponse = await database.from('activities').select('id,topic_ids')
    .eq('id', activityId).is('deleted_at', null).limit(1);
  if (activityResponse?.error || !Array.isArray(activityResponse?.data) ||
      activityResponse.data.length !== 1) throw new Error('ACTIVITY_TOPICS_READ_FAILED');
  const selectedIds = new Set((Array.isArray(activityResponse.data[0].topic_ids)
    ? activityResponse.data[0].topic_ids : []).map(idOf).filter(Boolean));
  const poolResponse = await database.from('activity_topics')
    .select('id,topic_name,category,target_audience,keywords,description,use_count,status')
    .eq('status', 'active').is('deleted_at', null)
    .order('use_count', { ascending: false }).limit(20);
  if (poolResponse?.error || !Array.isArray(poolResponse?.data)) throw new Error('TOPIC_POOL_READ_FAILED');
  const candidates = poolResponse.data.filter(row => idOf(row.id) && !selectedIds.has(idOf(row.id)))
    .map(row => ({ topicId: idOf(row.id), name: String(row.topic_name || '').slice(0, 160),
      category: String(row.category || '').slice(0, 120),
      targetAudience: String(row.target_audience || '').slice(0, 300),
      keywords: Array.isArray(row.keywords) ? row.keywords.slice(0, 8).map(value => String(value).slice(0, 80)) : [],
      description: String(row.description || '').slice(0, 600), useCount: Number(row.use_count) || 0,
      source: { schema: 'public', table: 'activity_topics', id: String(row.id) } }))
    .filter(row => row.name);
  if (!candidates.length) return { activity_id: activityId, recommendations: [],
    note: language === 'en' ? 'No eligible topics are available.' : '暂无可推荐的新主题。',
    business_data_written: false, requires_confirmation: true };

  const context = { activity: built.context.activity, participants: built.context.participants,
    tasks: built.context.tasks, topic_candidates: candidates };
  const contextSnapshot = { ...context, _context: { ...built.context_snapshot._context,
    recipe: 'activity_topic_recommend', candidateLimit: 20, poolLimited: poolResponse.data.length === 20 } };
  const aiGateway = gateway || createAIGateway({ app, rdb: database, timeoutMs: 80000, maxAttempts: 1 });
  const task = await aiGateway.runAITask({
    taskType: 'activity_topic_recommend', skill: 'activity_topic_recommend', capability: 'planning',
    subjectType: 'activity', subjectId: activityId,
    input: { activityId: String(activityId), objective: language === 'en'
      ? 'Respond in English. Recommend at most five topicIds from topic_candidates. Explain the fit. Do not write business records.'
      : '请用简体中文，从 topic_candidates 中推荐至多五个 topicId，说明依据；不要修改业务记录。' },
    context, contextSnapshot,
  });
  const allowed = new Map(candidates.map(row => [row.topicId, row]));
  const seen = new Set();
  const recommendations = (Array.isArray(task.result?.recommendations) ? task.result.recommendations : [])
    .filter(row => {
      const topicId = idOf(row.topicId);
      if (!allowed.has(topicId) || seen.has(topicId)) return false;
      seen.add(topicId);
      return true;
    }).map(row => {
      const topicId = idOf(row.topicId);
      return { topic_id: topicId, topic_name: allowed.get(topicId).name,
        score: row.score, reason: row.reason };
    }).slice(0, 5);
  return { activity_id: activityId, task_id: task.taskId, result_id: task.resultId,
    recommendations, note: String(task.result?.note || '').slice(0, 500),
    pool_limited: poolResponse.data.length === 20,
    business_data_written: false, requires_confirmation: true };
}

module.exports = { run };
