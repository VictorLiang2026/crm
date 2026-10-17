/** Service-role access for PC29 AI feedback, Outcomes, and Learning candidates. */
'use strict';

const ID = /^[1-9][0-9]{0,18}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createAiExperienceData({ env, key, fetchImpl = fetch } = {}) {
  if (!/^crm-[a-z0-9]+$/.test(env || '') || typeof key !== 'string' || !key)
    throw new Error('AI Experience database is not configured');

  async function request(path, method = 'GET', filters = {}, body) {
    const url = new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/${path}`);
    for (const [name, value] of Object.entries(filters)) url.searchParams.set(name, String(value));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          'Accept-Profile': 'public',
          'Content-Profile': 'public',
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(method === 'POST' ? { Prefer: 'return=representation' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await response.text();
      let data = null;
      if (raw) {
        try { data = JSON.parse(raw); } catch (_) { throw new Error('AI Experience database returned invalid JSON'); }
      }
      if (!response.ok) {
        const error = new Error('AI Experience database request failed');
        error.code = data?.code === '40001' ? 'STALE' : 'PERSISTENCE_ERROR';
        throw error;
      }
      return data;
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeout = new Error('AI Experience database request timed out');
        timeout.code = 'TIMEOUT';
        throw timeout;
      }
      throw error;
    } finally { clearTimeout(timer); }
  }

  function rpc(name, body) {
    return request(`rpc/${name}`, 'POST', {}, body);
  }

  async function list() {
    const [tasks, metricResponse] = await Promise.all([request('ai_tasks', 'GET', {
      select: 'id,task_type,skill_name,subject_type,subject_id,status,created_at,completed_at',
      status: 'eq.completed', order: 'created_at.desc,id.desc', limit: '100',
    }), rpc('crm_ai_experience_metrics_v1', { p_window_days: 30 })]);
    const metrics = Array.isArray(metricResponse) ? metricResponse[0] : metricResponse;
    if (!metrics || typeof metrics !== 'object') throw new Error('Invalid AI decision metrics');
    if (!Array.isArray(tasks) || tasks.length > 100) throw new Error('Invalid AI result history');
    const taskIds = tasks.map(row => String(row.id)).filter(value => ID.test(value));
    if (!taskIds.length) return { tasks: [], results: [], decisions: [], outcomes: [], learnings: [], metrics };
    const results = await request('ai_results', 'GET', {
      select: 'id,task_id,result_json,rank,is_recommended,user_selected,user_edited,final_result_json,feedback,created_at',
      task_id: `in.(${taskIds.join(',')})`, order: 'created_at.desc,id.desc', limit: '200',
    });
    if (!Array.isArray(results) || results.length > 200) throw new Error('Invalid AI result history');
    const resultIds = results.map(row => String(row.id)).filter(value => ID.test(value));
    if (!resultIds.length) return { tasks, results, decisions: [], outcomes: [], learnings: [], metrics };
    const filter = `in.(${resultIds.join(',')})`;
    const [decisions, outcomes, learnings] = await Promise.all([
      request('ai_result_feedback_events', 'GET', {
        select: 'id,ai_result_id,actor_uid,decision,reason,edit_delta,created_at',
        ai_result_id: filter, order: 'created_at.desc,id.desc', limit: '1000',
      }),
      request('outcomes', 'GET', {
        select: 'id,ai_result_id,action_id,opportunity_id,activity_id,recruit_candidate_id,recruit_followup_id,outcome_type,result,occurred_at,evidence,recorded_by_uid',
        ai_result_id: filter, order: 'occurred_at.desc,id.desc', limit: '500',
      }),
      request('learnings', 'GET', {
        select: 'id,source_id,situation,learning,scope,confirmed,confirmed_by_uid,confirmed_at,sample_size,counterexamples,provenance,candidate_key,created_at',
        source_table: 'eq.ai_results', source_id: filter,
        order: 'created_at.desc,id.desc', limit: '200',
      }),
    ]);
    if (![decisions, outcomes, learnings].every(Array.isArray)) throw new Error('Invalid AI Experience history');
    return { tasks, results, decisions, outcomes, learnings, metrics };
  }

  async function targets() {
    const [actions, opportunities, activities, followups] = await Promise.all([
      request('actions', 'GET', { select: 'id,person_id,title,completed_at,status', status: 'eq.completed', order: 'completed_at.desc,id.desc', limit: '100' }),
      request('opportunities', 'GET', { select: 'id,person_id,opportunity_type,status,last_progress,next_action,updated_at', status: 'in.(成交,关闭)', deleted_at: 'is.null', order: 'updated_at.desc,id.desc', limit: '100' }),
      request('activities', 'GET', { select: 'id,name,status,activity_date', status: 'in.(ended,reviewed)', deleted_at: 'is.null', order: 'activity_date.desc,id.desc', limit: '100' }),
      request('recruit_followups', 'GET', { select: 'id,candidate_id,followup_date,deleted_at', deleted_at: 'is.null', order: 'followup_date.desc,id.desc', limit: '100' }),
    ]);
    if (![actions, opportunities, activities, followups].every(Array.isArray)) throw new Error('Invalid completed work item list');
    return { actions, opportunities, activities, recruitFollowups: followups };
  }

  return {
    list,
    targets,
    decide: input => rpc('crm_ai_experience_decide_v1', {
      p_actor_uid: input.actorUid, p_event_id: input.eventId, p_ai_result_id: input.aiResultId,
      p_decision: input.decision, p_reason: input.reason, p_edit_delta: input.editDelta,
    }),
    outcome: input => rpc('crm_ai_experience_outcome_v1', {
      p_actor_uid: input.actorUid, p_idempotency_key: input.idempotencyKey,
      p_target_type: input.targetType, p_target_id: input.targetId, p_ai_result_id: input.aiResultId,
      p_result: input.result, p_occurred_at: input.occurredAt, p_evidence: input.evidence,
    }),
    learning: input => rpc('crm_ai_experience_learning_v1', {
      p_actor_uid: input.actorUid, p_candidate_key: input.candidateKey, p_payload: input.payload,
    }),
    confirmLearning: input => rpc('crm_ai_experience_confirm_learning_v1', {
      p_actor_uid: input.actorUid, p_learning_id: input.learningId, p_decision: input.decision,
    }),
  };
}

module.exports = { createAiExperienceData, ID, UUID };
