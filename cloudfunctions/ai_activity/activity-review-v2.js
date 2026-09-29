/** Activity relationship review preview. AI audit is written; CRM facts are never changed. */
'use strict';

const { createAIGateway } = require('./ai-gateway');
const { createContextEngine } = require('./context-engine');
const { createPublicRdb } = require('./public-rdb');

const SECTIONS = ['whoMattered', 'whatChanged', 'relationshipsImproved',
  'signalsAppeared', 'opportunitiesAppeared', 'followUpPeople'];

function activityIdOf(value) {
  if (!/^[1-9][0-9]*$/.test(String(value ?? '')) || !Number.isSafeInteger(Number(value))) {
    throw new Error('Valid activity_id required');
  }
  return Number(value);
}

function sourceRefs(context) {
  const refs = new Set();
  for (const value of Object.values(context)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item?.source?.schema === 'public' && item.source.table && item.source.id) {
        refs.add(`public.${item.source.table}#${item.source.id}`);
      }
    }
  }
  return refs;
}

function reviewForDisplay(result, context) {
  const refs = sourceRefs(context);
  const persons = new Map(context.persons.map(row => [String(row.data.id), row.data.display_name]));
  let discarded = 0;
  const knownRefs = item => Array.isArray(item?.sourceRefs) && item.sourceRefs.length > 0 &&
    item.sourceRefs.every(ref => refs.has(ref));
  const review = { summary: result.summary };
  for (const section of SECTIONS) {
    review[section] = result[section].filter(item => {
      const valid = knownRefs(item);
      if (!valid) discarded++;
      return valid;
    });
  }
  review.actionCandidates = result.actionCandidates.filter(item => {
    const valid = persons.has(String(item.personId)) && knownRefs(item) && item.sourceRefs.length > 0;
    if (!valid) discarded++;
    return valid;
  }).map(item => ({ ...item, personId: String(item.personId), personName: persons.get(String(item.personId)) }));
  return { review, discarded };
}

async function run(event, { app, rdb, gateway, engine } = {}) {
  const identity = app?.auth()?.getUserInfo();
  if (typeof identity?.uid !== 'string' || !identity.uid.trim() || identity.isAnonymous !== false) {
    return { error: 'UNAUTHORIZED' };
  }
  const activityId = activityIdOf(event?.activity_id);
  const database = rdb || createPublicRdb({ env: process.env.TCB_ENV,
    key: process.env.CRM_ACTIVITY_REVIEW_DB_API_KEY });
  const contextEngine = engine || createContextEngine({ rdb: database });
  const built = await contextEngine.buildContext({ recipe: 'activity_review',
    subjectType: 'activity', subjectId: activityId });
  const activity = built.context.activity.data;
  if (!['ended', 'reviewed'].includes(activity.status)) return { error: 'ACTIVITY_NOT_ENDED' };
  if (!built.context.persons.length) return { error: 'NO_CANONICAL_PERSON',
    message: '本场活动暂无已确认的 Person 关联，无法生成关系复盘。' };
  const aiGateway = gateway || createAIGateway({ app, rdb: database, timeoutMs: 80000, maxAttempts: 1 });
  const task = await aiGateway.runAITask({
    taskType: 'activity_review', skill: 'activity_review', capability: 'analysis',
    subjectType: 'activity', subjectId: activityId,
    input: { activityId: String(activityId), focus: '只依据给定来源回答六项问题。关系改善与新机会属于待核实研判；没有前后证据时明确说证据不足。引用 source 的 public.表#ID，不猜测身份或截止日期。Action Candidate 只关联已确认的 Person，需人工审核，不写业务事实。' },
    context: built.context, contextSnapshot: built.context_snapshot,
  });
  const display = reviewForDisplay(task.result, built.context);
  return { activity_id: activityId, activity_name: activity.name,
    task_id: task.taskId, result_id: task.resultId, review: display.review,
    discarded_unsupported_items: display.discarded,
    requires_confirmation: true, business_data_written: false };
}

module.exports = { run, activityIdOf, reviewForDisplay };
