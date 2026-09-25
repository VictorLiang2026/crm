/** Provider-neutral AI Runtime for future server-side callers. No legacy function imports this file. */
'use strict';

const { isDeepStrictEqual } = require('node:util');

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

function validateSchemaDefinition(schema, path = '$') {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new AIGatewayError('INVALID_INPUT', 'outputSchema must be a JSON schema object');
  }
  const supported = new Set(['type', 'required', 'properties', 'items', 'enum', 'additionalProperties']);
  for (const key of Object.keys(schema)) {
    if (!supported.has(key)) throw new AIGatewayError('INVALID_INPUT', `Unsupported outputSchema keyword: ${key}`);
  }
  const type = schema.type;
  if (!['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(type)) {
    throw new AIGatewayError('INVALID_INPUT', `Unsupported outputSchema type at ${path}`);
  }
  if (schema.enum !== undefined && !Array.isArray(schema.enum)) {
    throw new AIGatewayError('INVALID_INPUT', `Invalid enum at ${path}`);
  }
  if (type === 'object') {
    if (schema.required !== undefined && (!Array.isArray(schema.required) ||
      schema.required.some(key => typeof key !== 'string'))) {
      throw new AIGatewayError('INVALID_INPUT', `Invalid required list at ${path}`);
    }
    const properties = schema.properties || {};
    if (typeof properties !== 'object' || Array.isArray(properties)) {
      throw new AIGatewayError('INVALID_INPUT', `Invalid properties at ${path}`);
    }
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
      throw new AIGatewayError('INVALID_INPUT', `Invalid additionalProperties at ${path}`);
    }
    for (const [key, child] of Object.entries(properties)) validateSchemaDefinition(child, `${path}.${key}`);
  }
  if (type === 'array' && schema.items) validateSchemaDefinition(schema.items, `${path}[]`);
}

function checkSchema(schema, value, path = '$') {
  const type = schema.type;
  const validType = type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : type === 'array' ? Array.isArray(value)
      : type === 'null' ? value === null
        : type === 'integer' ? Number.isInteger(value)
          : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
            : typeof value === type;
  if (!validType) throw new AIGatewayError('INVALID_RESULT', `Result type mismatch at ${path}`);
  if (schema.enum !== undefined) {
    if (!schema.enum.some(item => isDeepStrictEqual(item, value))) {
      throw new AIGatewayError('INVALID_RESULT', `Result enum mismatch at ${path}`);
    }
  }
  if (type === 'object') {
    const properties = schema.properties || {};
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        throw new AIGatewayError('INVALID_RESULT', `Missing result field at ${path}.${key}`);
      }
    }
    for (const [key, item] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(properties, key)) checkSchema(properties[key], item, `${path}.${key}`);
      else if (schema.additionalProperties === false) {
        throw new AIGatewayError('INVALID_RESULT', `Unexpected result field at ${path}.${key}`);
      }
    }
  }
  if (type === 'array' && schema.items) {
    value.forEach((item, index) => checkSchema(schema.items, item, `${path}[${index}]`));
  }
}

function parseStructured(text, schema) {
  if (typeof text !== 'string' || !text.trim()) throw new AIGatewayError('INVALID_RESULT', 'Empty model result');
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  let parsed;
  try { parsed = JSON.parse(fenced ? fenced[1] : trimmed); }
  catch (_) { throw new AIGatewayError('INVALID_RESULT', 'Model result is not valid JSON'); }
  checkSchema(schema, parsed);
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
  return {
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
}

function createAIGateway(options) {
  options = options || {};
  const app = options.app;
  if (!app || typeof app.ai !== 'function') throw new AIGatewayError('INVALID_CONFIG', 'CloudBase app is required');
  const store = options.store || createRdbAuditStore(options.rdb);
  for (const method of ['createTask', 'updateTask', 'createRun', 'updateRun', 'createResult']) {
    if (typeof store[method] !== 'function') throw new AIGatewayError('INVALID_CONFIG', `Missing audit method: ${method}`);
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000 ||
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
    const skill = request.skill == null ? null : requiredString(request.skill, 'skill');
    const capability = requiredString(request.capability, 'capability');
    const input = jsonSnapshot(request.input, 'input');
    const context = jsonSnapshot(request.context, 'context');
    const schema = jsonSnapshot(request.outputSchema, 'outputSchema');
    validateSchemaDefinition(schema);
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
    const messages = [
      { role: 'system', content: 'Return only JSON matching the supplied output schema. Do not change business records.' },
      { role: 'user', content: JSON.stringify({ taskType, skill, capability, context, input, outputSchema: schema }) },
    ];
    let taskId;
    try { taskId = await store.createTask({
      task_type: taskType,
      skill_name: skill,
      subject_type: subjectType,
      subject_id: subjectId,
      status: 'running',
      capability,
      input_snapshot: input,
      context_snapshot: context,
      requires_confirmation: true,
    }); } catch (error) { throw auditError(error); }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let runId;
      try { runId = await store.createRun({ task_id: taskId, success: null }); }
      catch (error) { await markFailed(taskId); throw auditError(error); }
      const started = process.hrtime.bigint();
      let response;
      let result;
      try {
        const client = app.ai().createModel(group);
        response = await withTimeout(client.generateText({ model, messages, timeout: timeoutMs }), timeoutMs);
        if (response?.error) throw response.error;
        result = parseStructured(response?.text, schema);
      } catch (error) {
        const normalized = normalizeError(error);
        try { await store.updateRun(runId, {
          ...usageOf(response), latency_ms: elapsedMs(started),
          success: false, error: normalized.code,
        }); } catch (auditFailure) { await markFailed(taskId); throw auditError(auditFailure); }
        if (normalized.retryable && attempt < maxAttempts) {
          await sleep(Math.min(250 * (2 ** (attempt - 1)), 1000));
          continue;
        }
        try { await store.updateTask(taskId, { status: 'failed', completed_at: new Date().toISOString() }); }
        catch (auditFailure) { throw auditError(auditFailure); }
        normalized.taskId = taskId;
        throw normalized;
      }

      const usage = usageOf(response);
      let resultId;
      try {
        await store.updateRun(runId, { ...usage, latency_ms: elapsedMs(started), success: true, error: null });
        resultId = await store.createResult({
        task_id: taskId, run_id: runId, result_json: result,
        rank: 1, is_recommended: true, user_selected: false, user_edited: false,
        });
        await store.updateTask(taskId, { status: 'completed', completed_at: new Date().toISOString() });
      } catch (error) { await markFailed(taskId); throw auditError(error); }
      return { taskId, runId, resultId, result, usage, requiresConfirmation: true };
    }
    throw new AIGatewayError('AI_REQUEST_FAILED', 'AI request failed');
  }

  return { runAITask };
}

module.exports = { createAIGateway, createRdbAuditStore, AIGatewayError };
