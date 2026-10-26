/** Provider-neutral AI Runtime for future server-side callers. No legacy function imports this file. */
'use strict';
const testData = require('./test-data');

const { isDeepStrictEqual } = require('node:util');
const { createHash } = require('node:crypto');
const { defaultRegistry, TIMEOUT_CLASS_MS, SkillValidationError } = require('./skill-registry');

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_ATTEMPTS = 2;
const TABLES = Object.freeze({ tasks: 'ai_tasks', runs: 'ai_runs', results: 'ai_results' });

class AIGatewayError extends Error {
  constructor(code, message, retryable = false, cause) {
    super(message);
    this.name = 'AIGatewayError';
    this.code = code;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AIGatewayError('INVALID_INPUT', `${label} is required`);
  }
  return value.trim();
}

function jsonSnapshot(value, label) {
  if (value === undefined) throw new AIGatewayError('INVALID_INPUT', `${label} is required`);
  let serialized;
  try { serialized = JSON.stringify(value); } catch (_) { /* handled below */ }
  if (!serialized || serialized.length > 262144) {
    throw new AIGatewayError('INVALID_INPUT', `${label} must be JSON and at most 256 KiB`);
  }
  return JSON.parse(serialized);
}

function parseStructured(text) {
  if (typeof text !== 'string' || !text.trim()) throw new AIGatewayError('INVALID_RESULT', 'Empty model result');
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  let parsed;
  try { parsed = JSON.parse(fenced ? fenced[1] : trimmed); }
  catch (_) { throw new AIGatewayError('INVALID_RESULT', 'Model result is not valid JSON'); }
  return parsed;
}

function normalizeError(error) {
  if (error instanceof AIGatewayError) return error;
  const status = Number(error && (error.status || error.statusCode || error.httpStatus));
  const sourceCode = String((error && error.code) || '').toUpperCase();
  if (status === 429 || sourceCode.includes('RATE_LIMIT')) {
    return new AIGatewayError('RATE_LIMIT', 'AI request was rate limited', true, error);
  }
  if (status >= 500 || ['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH'].includes(sourceCode)) {
    return new AIGatewayError('UPSTREAM_UNAVAILABLE', 'AI service is temporarily unavailable', true, error);
  }
  if (sourceCode.includes('TIMEOUT') || sourceCode === 'ETIMEDOUT') {
    // An expired SDK call can still finish remotely. Do not retry and double-charge it.
    return new AIGatewayError('TIMEOUT', 'AI request timed out', false, error);
  }
  return new AIGatewayError('AI_REQUEST_FAILED', 'AI request failed', false, error);
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new AIGatewayError('TIMEOUT', 'AI request timed out')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function elapsedMs(started) {
  return Number((process.hrtime.bigint() - started) / 1000000n);
}

function safeNonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function usageOf(response) {
  const usage = response && response.usage || {};
  const raw = response && Array.isArray(response.rawResponses) && response.rawResponses[0] || {};
  const rawUsage = raw.usage || {};
  const input = usage.input_tokens ?? usage.prompt_tokens ?? rawUsage.prompt_tokens;
  const output = usage.output_tokens ?? usage.completion_tokens ?? rawUsage.completion_tokens;
  const cached = usage.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ??
    rawUsage.prompt_tokens_details?.cached_tokens;
  const cost = response?.cost ?? raw.cost;
  return {
    provider: typeof (response?.provider ?? raw.provider) === 'string' ? (response?.provider ?? raw.provider) : null,
    model: typeof (response?.model ?? raw.model) === 'string' ? (response?.model ?? raw.model) : null,
    input_tokens: safeNonnegativeInteger(input),
    output_tokens: safeNonnegativeInteger(output),
    cached_tokens: safeNonnegativeInteger(cached),
    cost: typeof cost === 'string' && /^\d+(?:\.\d{1,8})?$/.test(cost) ? cost :
      Number.isFinite(cost) && cost >= 0 ? cost : null,
  };
}

function assertRdbResult(response, operation) {
  if (!response || response.error) {
    throw new AIGatewayError('PERSISTENCE_ERROR', `AI audit ${operation} failed`, false, response?.error);
  }
  const rows = Array.isArray(response.data) ? response.data : response.data ? [response.data] : [];
  if (rows.length !== 1 || !rows[0].id) {
    throw new AIGatewayError('PERSISTENCE_ERROR', `AI audit ${operation} did not return one id`);
  }
  return rows[0].id;
}

function createRdbAuditStore(rdb) {
  if (!rdb || typeof rdb.from !== 'function') throw new AIGatewayError('INVALID_CONFIG', 'Privileged CloudBase RDB is required');
  async function audit(operation, query) {
    try { return assertRdbResult(await query(), operation); }
    catch (error) {
      if (error instanceof AIGatewayError) throw error;
      throw new AIGatewayError('PERSISTENCE_ERROR', `AI audit ${operation} failed`, false, error);
    }
  }
  const store = {
    async createTask(row) {
      return audit('task insert', () => rdb.from(TABLES.tasks).insert(row).select('id'));
    },
    async updateTask(id, row) {
      await audit('task update', () => rdb.from(TABLES.tasks).update(row).eq('id', id).select('id'));
    },
    async createRun(row) {
      return audit('run insert', () => rdb.from(TABLES.runs).insert(row).select('id'));
    },
    async updateRun(id, row) {
      await audit('run update', () => rdb.from(TABLES.runs).update(row).eq('id', id).select('id'));
    },
    async createResult(row) {
      return audit('result insert', () => rdb.from(TABLES.results).insert(row).select('id'));
    },
  };
  if (typeof rdb.rpc === 'function') {
    const rpc = async (name, args) => {
      try {
        const response = await rdb.rpc(name, args);
        const value = response?.data;
        if (response?.error || !value || typeof value !== 'object' || Array.isArray(value) ||
            !/^[1-9][0-9]*$/.test(String(value.taskId || ''))) {
          throw new AIGatewayError('PERSISTENCE_ERROR', `AI audit ${name} failed`, false, response?.error);
        }
        return value;
      } catch (error) {
        if (error instanceof AIGatewayError) throw error;
        throw new AIGatewayError('PERSISTENCE_ERROR', `AI audit ${name} failed`, false, error);
      }
    };
    store.claimTask = row => rpc('crm_ai_claim_v2', {
      p_actor_uid: row.actorUid, p_request_key: row.requestKey,
      p_task_type: row.task.task_type, p_skill_name: row.task.skill_name,
      p_subject_type: row.task.subject_type, p_subject_id: row.task.subject_id,
      p_capability: row.task.capability, p_input_snapshot: row.task.input_snapshot,
      p_context_snapshot: row.task.context_snapshot,
    });
    store.finishAttempt = row => rpc('crm_ai_finish_v1', {
      p_task_id: row.taskId, p_run_id: row.runId, p_success: row.success,
      p_error: row.error, p_usage: row.usage, p_result: row.result,
      p_final: row.final,
    });
    store.finishDualAttempt = row => rpc('crm_ai_finish_dual_v1', {
      p_task_id: row.taskId, p_run_id: row.runId, p_success: row.success,
      p_error: row.error, p_usage: row.usage, p_candidates: row.candidates,
      p_final: row.final,
    });
  }
  return store;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function requestKey(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function createAIGateway(options) {
  options = options || {};
  const app = options.app;
  if (!app || typeof app.ai !== 'function') throw new AIGatewayError('INVALID_CONFIG', 'CloudBase app is required');
  const store = options.store || createRdbAuditStore(options.rdb);
  const skillRegistry = options.skillRegistry || defaultRegistry;
  for (const method of ['createTask', 'updateTask', 'createRun', 'updateRun', 'createResult']) {
    if (typeof store[method] !== 'function') throw new AIGatewayError('INVALID_CONFIG', `Missing audit method: ${method}`);
  }
  if (typeof skillRegistry.get !== 'function' || typeof skillRegistry.validateInput !== 'function' ||
      typeof skillRegistry.validateContext !== 'function' || typeof skillRegistry.validateOutput !== 'function') {
    throw new AIGatewayError('INVALID_CONFIG', 'Skill Registry is required');
  }
  const configuredTimeoutMs = options.timeoutMs;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if ((configuredTimeoutMs !== undefined && (!Number.isSafeInteger(configuredTimeoutMs) ||
      configuredTimeoutMs < 1000 || configuredTimeoutMs > 300000)) ||
      !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new AIGatewayError('INVALID_CONFIG', 'Invalid timeout or retry limit');
  }
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const modelResolver = options.modelResolver || (() => process.env.AI_GATEWAY_MODEL || process.env.AI_MODEL);
  const groupResolver = options.groupResolver || (() => process.env.AI_GATEWAY_GROUP || 'cloudbase');

  function auditError(error) {
    return error instanceof AIGatewayError ? error :
      new AIGatewayError('PERSISTENCE_ERROR', 'AI audit write failed', false, error);
  }

  async function markFailed(taskId) {
    try { await store.updateTask(taskId, { status: 'failed', completed_at: new Date().toISOString() }); }
    catch (_) { /* Preserve the original failure; caller must investigate incomplete audit. */ }
  }

  async function runAITask(request) {
    request = request || {};
    const taskType = requiredString(request.taskType, 'taskType');
    const skill = requiredString(request.skill, 'skill');
    const capability = requiredString(request.capability, 'capability');
    const definition = skillRegistry.get(skill);
    if (!definition) throw new AIGatewayError('INVALID_INPUT', `Unknown skill: ${skill}`);
    if (capability !== definition.capability) throw new AIGatewayError('INVALID_INPUT', 'Skill capability mismatch');
    const timeoutMs = configuredTimeoutMs ?? TIMEOUT_CLASS_MS[definition.timeoutClass] ?? DEFAULT_TIMEOUT_MS;
    const input = jsonSnapshot(request.input, 'input');
    const context = jsonSnapshot(request.context, 'context');
    const contextSnapshot = request.contextSnapshot === undefined ? context :
      jsonSnapshot(request.contextSnapshot, 'contextSnapshot');
    if (request.contextSnapshot !== undefined) {
      const { _context, ...snapshotData } = contextSnapshot;
      if (!_context || typeof _context !== 'object' || Array.isArray(_context) ||
          !isDeepStrictEqual(snapshotData, context)) {
        throw new AIGatewayError('INVALID_INPUT', 'contextSnapshot must match context and include provenance');
      }
    }
    const schema = definition.outputSchema;
    if (request.outputSchema !== undefined &&
      !isDeepStrictEqual(jsonSnapshot(request.outputSchema, 'outputSchema'), schema)) {
      throw new AIGatewayError('INVALID_INPUT', 'outputSchema differs from registered skill');
    }
    try {
      skillRegistry.validateInput(skill, input);
      skillRegistry.validateContext(skill, context);
    } catch (error) {
      if (!(error instanceof SkillValidationError)) throw error;
      const invalid = new AIGatewayError('INVALID_INPUT', 'Skill input or context failed JSON Schema validation');
      invalid.details = error.details;
      throw invalid;
    }
    const hasSubject = request.subjectType != null || request.subjectId != null;
    if (hasSubject && (request.subjectType == null || request.subjectId == null)) {
      throw new AIGatewayError('INVALID_INPUT', 'subjectType and subjectId must be supplied together');
    }
    const subjectType = hasSubject ? requiredString(request.subjectType, 'subjectType') : null;
    const subjectId = hasSubject ? String(request.subjectId).trim() : null;
    if (hasSubject && (!['string', 'number', 'bigint'].includes(typeof request.subjectId) || !subjectId ||
      (typeof request.subjectId === 'number' && !Number.isSafeInteger(request.subjectId)))) {
      throw new AIGatewayError('INVALID_INPUT', 'subjectId must be a nonempty scalar');
    }
    const model = requiredString(await modelResolver({ taskType, skill, capability }), 'configured model');
    const group = requiredString(await groupResolver({ taskType, skill, capability }), 'configured CloudBase group');
    if (group !== 'cloudbase' && group !== 'hunyuan-exp' && !/^custom-[A-Za-z0-9_-]+$/.test(group)) {
      throw new AIGatewayError('INVALID_CONFIG', 'Unsupported CloudBase model group');
    }
    const disclosure = await (options.testDataReader || testData.disclose)(testData.collectRefs(context));
    const skillInstruction = skill === 'dual_followup'
      ? 'Produce exactly two candidates: one strategy_based and one library_based. strategy_based should give general international insurance practice, agent communication experience and customer progression logic; use only strategySources as citations. If recruitContext contains a recruit candidate, adapt the strategy to that candidate’s stated career stage and concerns; otherwise do not assume recruitment intent. library_based must rely on librarySources for company-specific products, services, campaigns, seminars, recruitment, legal or tax facts; use only librarySources as citations. sourceRefs must contain only exact supplied knowledge item IDs. Do not present general model knowledge as a company fact, local law, product term, return or guarantee. If no suitable source exists, say so and ask what must be verified. Tailor both to the supplied customer snapshot without inventing facts. Keep the two perspectives distinct.'
      : skill === 'knowledge_extract'
        ? 'Summarize the supplied source faithfully. Separate source facts from suggested marketing or agent applications. Preserve limitations, dates and jurisdiction. Do not add product, legal, tax, performance or return claims that are not present in the document.'
        : '';
    const messages = testData.withMessages([
      { role: 'system', content: `Return only JSON matching the supplied output schema. Do not change business records.${skillInstruction ? ` ${skillInstruction}` : ''}` },
      { role: 'user', content: JSON.stringify({ taskType, skill, capability, context, input, outputSchema: schema }) },
    ], disclosure);
    const taskRow = {
      task_type: taskType,
      skill_name: skill,
      subject_type: subjectType,
      subject_id: subjectId,
      status: 'running',
      capability,
      input_snapshot: input,
      context_snapshot: { ...contextSnapshot, _testData: disclosure, _skill: { name: skill, version: definition.version } },
      requires_confirmation: true,
    };
    const atomicAudit = typeof store.claimTask === 'function' && typeof store.finishAttempt === 'function';
    let taskId;
    if (atomicAudit) {
      let identity;
      try { identity = await (options.actorResolver ? options.actorResolver() : app.auth().getUserInfo()); }
      catch (_) { throw new AIGatewayError('UNAUTHORIZED', 'Authenticated AI request required'); }
      if (typeof identity?.uid !== 'string' || !identity.uid.trim() || identity.isAnonymous !== false) {
        throw new AIGatewayError('UNAUTHORIZED', 'Authenticated AI request required');
      }
      const claim = await store.claimTask({ actorUid: identity.uid.trim(),
        requestKey: requestKey({ taskType, skill, capability, subjectType, subjectId,
          model, group, input, contextSnapshot: taskRow.context_snapshot }), task: taskRow });
      taskId = claim.taskId;
      if (claim.status === 'reused') {
        return { taskId, runId: claim.runId, resultId: claim.resultId,
          result: claim.result, usage: claim.usage, testData: claim.testData,
          skillVersion: claim.skillVersion || definition.version,
          confirmationLevel: definition.confirmationLevel, requiresConfirmation: true,
          reused: true };
      }
      if (claim.status !== 'claimed') {
        const code = claim.status === 'in_progress' ? 'AI_IN_PROGRESS' :
          claim.status === 'recent_failure' ? 'AI_RETRY_LATER' : 'AI_AUDIT_UNKNOWN';
        const error = new AIGatewayError(code, code);
        error.taskId = taskId;
        error.retryAfter = claim.retryAfter || null;
        throw error;
      }
    } else {
      try { taskId = await store.createTask(taskRow); }
      catch (error) { throw auditError(error); }
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let runId;
      try { runId = await store.createRun({ task_id: taskId, success: null }); }
      catch (error) {
        if (atomicAudit) {
          try {
            if (skill === 'dual_followup') await store.finishDualAttempt({ taskId, runId:null, success:false,
              error:'PERSISTENCE_ERROR',usage:{},candidates:null,final:true });
            else await store.finishAttempt({ taskId, runId: null, success: false,
              error: 'PERSISTENCE_ERROR', usage: {}, result: null, final: true });
          }
          catch (auditFailure) { const failure = auditError(auditFailure); failure.taskId = taskId; throw failure; }
        } else await markFailed(taskId);
        const failure = auditError(error); failure.taskId = taskId; throw failure;
      }
      const started = process.hrtime.bigint();
      let response;
      let result;
      try {
        const client = app.ai().createModel(group);
        response = await withTimeout(client.generateText({ model, messages, timeout: timeoutMs }), timeoutMs);
        if (response?.error) throw response.error;
        result = parseStructured(response?.text);
        try { skillRegistry.validateOutput(skill, result); }
        catch (error) {
          if (!(error instanceof SkillValidationError)) throw error;
          const invalid = new AIGatewayError('INVALID_RESULT', 'Model result failed JSON Schema validation');
          invalid.details = error.details;
          throw invalid;
        }
          if (skill === 'dual_followup') {
            result.candidates = [...result.candidates].sort((a,b) =>
              (a.candidateType === 'strategy_based' ? 0 : 1) - (b.candidateType === 'strategy_based' ? 0 : 1));
          }
      } catch (error) {
        const normalized = normalizeError(error);
        const canRetry = normalized.retryable && attempt < maxAttempts;
        try {
          if (atomicAudit && skill === 'dual_followup') await store.finishDualAttempt({ taskId, runId, success:false,
            error:normalized.code,usage:{...usageOf(response),latency_ms:elapsedMs(started)},candidates:null,final:!canRetry });
          else if (atomicAudit) await store.finishAttempt({ taskId, runId, success: false,
            error: normalized.code, usage: { ...usageOf(response), latency_ms: elapsedMs(started) },
            result: null, final: !canRetry });
          else await store.updateRun(runId, {
            ...usageOf(response), latency_ms: elapsedMs(started),
            success: false, error: normalized.code,
          });
        } catch (auditFailure) {
          if (!atomicAudit) await markFailed(taskId);
          const failure = auditError(auditFailure); failure.taskId = taskId; throw failure;
        }
        if (canRetry) {
          await sleep(Math.min(250 * (2 ** (attempt - 1)), 1000));
          continue;
        }
        if (!atomicAudit) {
          try { await store.updateTask(taskId, { status: 'failed', completed_at: new Date().toISOString() }); }
          catch (auditFailure) { throw auditError(auditFailure); }
        }
        normalized.taskId = taskId;
        throw normalized;
      }

      const usage = usageOf(response);
      let resultId;
      let resultIds = null;
      try {
        if (atomicAudit) {
          const usageWithLatency = { ...usage, latency_ms: elapsedMs(started) };
          if (skill === 'dual_followup') {
            if (typeof store.finishDualAttempt !== 'function') throw new AIGatewayError('PERSISTENCE_ERROR', 'Dual AI audit is unavailable');
            const finished = await store.finishDualAttempt({ taskId, runId, success:true,
              error:null, usage:usageWithLatency, candidates:result.candidates, final:true });
            if (finished.status !== 'completed' || !Array.isArray(finished.resultIds) || finished.resultIds.length !== 2) {
              throw new AIGatewayError('PERSISTENCE_ERROR', 'Dual AI audit completion did not return two results');
            }
            resultIds = finished.resultIds.map(String);
            resultId = resultIds[0];
          } else {
            const finished = await store.finishAttempt({ taskId, runId, success: true,
              error: null, usage: usageWithLatency, result, final: true });
            if (finished.status !== 'completed' || !finished.resultId) {
              throw new AIGatewayError('PERSISTENCE_ERROR', 'AI audit completion did not return a result');
            }
            resultId = finished.resultId;
          }
        } else {
          await store.updateRun(runId, { ...usage, latency_ms: elapsedMs(started), success: true, error: null });
          resultId = await store.createResult({
            task_id: taskId, run_id: runId, result_json: result,
            rank: 1, is_recommended: true, user_selected: false, user_edited: false,
          });
          await store.updateTask(taskId, { status: 'completed', completed_at: new Date().toISOString() });
        }
      } catch (error) {
        if (!atomicAudit) await markFailed(taskId);
        const failure = auditError(error); failure.taskId = taskId; throw failure;
      }
      return { taskId, runId, resultId, ...(resultIds ? { resultIds } : {}), result, usage, testData: disclosure, skillVersion: definition.version,
        confirmationLevel: definition.confirmationLevel, requiresConfirmation: true };
    }
    throw new AIGatewayError('AI_REQUEST_FAILED', 'AI request failed');
  }

  return { runAITask };
}

module.exports = { createAIGateway, createRdbAuditStore, AIGatewayError };
