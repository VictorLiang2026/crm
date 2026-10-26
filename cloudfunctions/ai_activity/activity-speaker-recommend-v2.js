/** Gateway advice over bounded, verified Person-linked activity speakers. */
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
  // The context engine caps participants at 20. At the cap we cannot prove that
  // a candidate is not already in this activity, so fail closed.
  if (built.context.participants.length >= 20) return { error: 'PARTICIPANTS_LIMIT' };

  const speakerResponse = await database.from('activity_speakers')
    .select('id,person_id,position,expertise,topic_summary,status')
    .eq('status', 'active').is('deleted_at', null)
    .order('updated_at', { ascending: false }).limit(20);
  if (speakerResponse?.error || !Array.isArray(speakerResponse?.data)) throw new Error('SPEAKER_POOL_READ_FAILED');
  const speakers = speakerResponse.data.filter(row => idOf(row.id) && idOf(row.person_id));
  const personIds = [...new Set(speakers.map(row => idOf(row.person_id)))];
  const personResponse = personIds.length ? await database.from('persons')
    .select('id,display_name,organization').in('id', personIds)
    .is('deleted_at', null).limit(20) : { data: [] };
  if (personResponse?.error || !Array.isArray(personResponse?.data)) throw new Error('PERSON_POOL_READ_FAILED');
  const people = new Map(personResponse.data.map(row => [idOf(row.id), row]));
  const existingPersonIds = new Set(built.context.participants.map(row => idOf(row.data.canonical_person_id)).filter(Boolean));
  const existingSpeakerIds = new Set(built.context.participants.filter(row => row.data.person_type === 'speaker')
    .map(row => idOf(row.data.person_id)).filter(Boolean));
  const candidates = speakers.filter(row => people.has(idOf(row.person_id)) &&
    !existingPersonIds.has(idOf(row.person_id)) && !existingSpeakerIds.has(idOf(row.id)))
    .map(row => {
      const person = people.get(idOf(row.person_id));
      return { speakerId: idOf(row.id), personId: idOf(row.person_id),
        displayName: String(person.display_name || '').slice(0, 160),
        organization: String(person.organization || '').slice(0, 200),
        position: String(row.position || '').slice(0, 200),
        expertise: String(row.expertise || '').slice(0, 600),
        topicSummary: String(row.topic_summary || '').slice(0, 600),
        source: { schema: 'public', table: 'activity_speakers', id: String(row.id) },
        personSource: { schema: 'public', table: 'persons', id: String(person.id) } };
    }).filter(row => row.displayName);
  const note = language === 'en' ? 'No eligible Person-linked speakers are available.' : '暂无可推荐且已关联 Person 的嘉宾。';
  if (!candidates.length) return { activity_id: activityId, recommendations: [], note,
    business_data_written: false, requires_confirmation: true };

  const context = { activity: built.context.activity, participants: built.context.participants,
    tasks: built.context.tasks, speaker_candidates: candidates };
  const contextSnapshot = { ...context, _context: { ...built.context_snapshot._context,
    recipe: 'activity_speaker_recommend', candidateLimit: 20,
    poolLimited: speakerResponse.data.length === 20 } };
  const aiGateway = gateway || createAIGateway({ app, rdb: database, timeoutMs: 80000, maxAttempts: 1 });
  const task = await aiGateway.runAITask({
    taskType: 'activity_speaker_recommend', skill: 'activity_speaker_recommend', capability: 'planning',
    subjectType: 'activity', subjectId: activityId,
    input: { activityId: String(activityId), objective: language === 'en'
      ? 'Respond in English. Recommend at most five speakerIds from speaker_candidates. Give evidence-based reasons, topic and outreach advice. Do not write business records.'
      : '请用简体中文，从 speaker_candidates 中推荐至多五位 speakerId，并说明依据、主题和邀约建议；不要修改业务记录。' },
    context, contextSnapshot,
  });
  const allowed = new Map(candidates.map(row => [row.speakerId, row]));
  const seen = new Set();
  const recommendations = (Array.isArray(task.result?.recommendations) ? task.result.recommendations : [])
    .filter(row => {
      const speakerId = idOf(row.speakerId);
      if (!allowed.has(speakerId) || seen.has(speakerId)) return false;
      seen.add(speakerId);
      return true;
    })
    .map(row => {
      const speakerId = idOf(row.speakerId), candidate = allowed.get(speakerId);
      return { speaker_id: speakerId, person_id: candidate.personId, speaker_name: candidate.displayName,
        score: row.score, reason: row.reason, suggested_topic: row.suggestedTopic,
        contact_suggestion: row.contactSuggestion };
    }).slice(0, 5);
  return { activity_id: activityId, task_id: task.taskId, result_id: task.resultId,
    recommendations, note: String(task.result?.note || '').slice(0, 500),
    pool_limited: speakerResponse.data.length === 20,
    business_data_written: false, requires_confirmation: true };
}

module.exports = { run };
