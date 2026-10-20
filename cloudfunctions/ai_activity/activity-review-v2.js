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

function candidateEvidenceHint(context) {
  const substantive = context.activity_interactions.filter(row =>
    Number(row?.data?.importance) >= 3 && row?.data?.person_id &&
    row?.source?.schema === 'public' && row.source.table === 'interactions')
    .slice(0, 3).map(row => `${row.data.person_id}:public.interactions#${row.source.id}`);
  const attended = context.participants.filter(row =>
    row?.data?.status === 'attended' && row.data.resolved_person_id &&
    row?.source?.schema === 'public' && row.source.table === 'activity_participants')
    .slice(0, 3).map(row => `${row.data.resolved_person_id}:public.activity_participants#${row.source.id}`);
  return `本场合格来源（Person ID:来源）：重要互动 ${substantive.join('、') || '无'}；已到场 ${attended.join('、') || '无'}。`;
}

function reviewFocus(context) {
  const rule = '只依据给定来源回答六项问题；缺证据时说明不足。引用 public.表#ID，不猜身份或期限。Action 候选仅关联已确认 Person，sourceRefs 至少包含同一 Person 的本场重要互动或已到场记录；Opportunity 候选至少包含同一 Person 的本场重要互动。缺少合格来源则返回空候选，不以旧互动或既有行动替代。本场到场本身不能推出机会。候选待人工审核，不写业务事实。';
  const hint = candidateEvidenceHint(context);
  return rule.length + hint.length <= 500 ? rule + hint : rule;
}

function reviewForDisplay(result, context) {
  const refs = sourceRefs(context);
  const persons = new Map(context.persons.map(row => [String(row.data.id), row.data.display_name]));
  const positive = new Map(context.activity_interactions.filter(row =>
    Number(row.data.importance) >= 3).map(row =>
    [`public.interactions#${row.data.id}`, String(row.data.person_id)]));
  const attendance = new Map(context.participants.filter(row => row.data.status === 'attended' &&
    row.data.resolved_person_id).map(row =>
    [`public.activity_participants#${row.data.id}`, String(row.data.resolved_person_id)]));
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
  review.actionCandidates = result.actionCandidates.map((item, sourceIndex) => ({...item,sourceIndex})).filter(item => {
    const valid = persons.has(String(item.personId)) && knownRefs(item) &&
      item.sourceRefs.some(ref => positive.get(ref) === String(item.personId) ||
        attendance.get(ref) === String(item.personId));
    if (!valid) discarded++;
    return valid;
  }).map(item => ({ ...item, personId: String(item.personId), personName: persons.get(String(item.personId)) }));
  review.opportunityCandidates = (result.opportunityCandidates || [])
    .map((item, sourceIndex) => ({...item,sourceIndex})).filter(item => {
    const valid = persons.has(String(item.personId)) && knownRefs(item) &&
      item.sourceRefs.some(ref => positive.get(ref) === String(item.personId));
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
    input: { activityId: String(activityId), focus: reviewFocus(built.context) },
    context: built.context, contextSnapshot: built.context_snapshot,
  });
  const display = reviewForDisplay(task.result, built.context);
  return { activity_id: activityId, activity_name: activity.name,
    testData: task.testData, task_id: task.taskId, result_id: task.resultId, review: display.review,
    discarded_unsupported_items: display.discarded,
    requires_confirmation: true, business_data_written: false };
}

module.exports = { run, activityIdOf, reviewForDisplay };
