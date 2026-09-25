'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAIGateway, createRdbAuditStore } = require('../../cloudfunctions/_shared/ai-gateway');
const { SkillValidationError } = require('../../cloudfunctions/_shared/skill-registry');

const schema = {
  type: 'object',
  required: ['recommendation'],
  properties: { recommendation: { type: 'string' } },
  additionalProperties: false,
};
const request = {
  taskType: 'test_advice', skill: 'test_skill', capability: 'text',
  context: { subject: 'isolated-test' }, input: { question: 'example' }, outputSchema: schema,
};
const testRegistry = {
  get: name => name === 'test_skill' ? { name, version: '1.0.0', capability: 'text',
    timeoutClass: 'standard', outputSchema: schema } : null,
  validateInput: () => true,
  validateContext: () => true,
  validateOutput: (_, value) => {
    if (!value || typeof value.recommendation !== 'string' || Object.keys(value).length !== 1) {
      throw new SkillValidationError('INVALID_SKILL_OUTPUT', 'test_skill', []);
    }
    return true;
  },
};

function fixture(responses, overrides = {}) {
  const calls = [];
  const rows = { tasks: [], runs: [], results: [] };
  const store = {
    async createTask(row) { rows.tasks.push({ id: 1, ...row }); return 1; },
    async updateTask(id, row) { Object.assign(rows.tasks.find(item => item.id === id), row); },
    async createRun(row) { const id = rows.runs.length + 1; rows.runs.push({ id, ...row }); return id; },
    async updateRun(id, row) { Object.assign(rows.runs.find(item => item.id === id), row); },
    async createResult(row) { rows.results.push({ id: 1, ...row }); return 1; },
  };
  const app = { ai: () => ({ createModel(group) {
    calls.push({ group });
    return { generateText(args) {
      calls[calls.length - 1].args = args;
      const next = responses.shift();
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    } };
  } }) };
  const gateway = createAIGateway({
    app, store, skillRegistry: testRegistry, modelResolver: () => 'configured-model', sleep: async () => {}, ...overrides,
  });
  return { gateway, rows, calls, store, app };
}

test('default registry validates a real skill before audit and records its version', async () => {
  const f = fixture([{ text: JSON.stringify({ people: [], events: [], facts: [], needs: [], nextActions: [] }) }]);
  const gateway = createAIGateway({ app: f.app, store: f.store, modelResolver: () => 'configured-model' });
  const skillRequest = { taskType: 'capture', skill: 'quick_capture', capability: 'structured_extraction',
    context: {}, input: { text: 'Follow up tomorrow' } };
  await assert.rejects(gateway.runAITask({ ...skillRequest, input: { text: '' } }),
    error => error.code === 'INVALID_INPUT');
  assert.equal(f.rows.tasks.length, 0);
  const result = await gateway.runAITask(skillRequest);
  assert.equal(result.skillVersion, '1.0.0');
  assert.equal(result.confirmationLevel, 'confirm_before_write');
  assert.deepEqual(f.rows.tasks[0].context_snapshot._skill, { name: 'quick_capture', version: '1.0.0' });
  assert.equal(f.calls[0].args.timeout, 60000);
});

test('records verified Context Engine provenance in task snapshot', async () => {
  const f = fixture([{ text: '{"recommendation":"review first"}' }]);
  const contextSnapshot = { subject: 'isolated-test', _context: { recipe: 'person_basic', version: '1.0.0' } };
  await f.gateway.runAITask({ ...request, contextSnapshot });
  assert.deepEqual(f.rows.tasks[0].context_snapshot._context, contextSnapshot._context);
  await assert.rejects(f.gateway.runAITask({ ...request, contextSnapshot: { subject: 'different',
    _context: contextSnapshot._context } }), error => error.code === 'INVALID_INPUT');
  assert.equal(f.rows.tasks.length, 1);
});

test('structured result is audited with actual response metadata and remains unselected', async () => {
  const f = fixture([{
    text: '```json\n{"recommendation":"review first"}\n```',
    usage: { prompt_tokens: 12, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 3 } },
    rawResponses: [{ provider: 'returned-provider', model: 'returned-model', cost: '0.00001234' }],
  }]);
  const result = await f.gateway.runAITask(request);
  assert.deepEqual(result.result, { recommendation: 'review first' });
  assert.equal(result.requiresConfirmation, true);
  assert.equal(f.rows.tasks[0].requires_confirmation, true);
  assert.equal(f.rows.tasks[0].status, 'completed');
  assert.equal(f.rows.runs[0].provider, 'returned-provider');
  assert.equal(f.rows.runs[0].model, 'returned-model');
  assert.equal(f.rows.runs[0].input_tokens, 12);
  assert.equal(f.rows.runs[0].output_tokens, 5);
  assert.equal(f.rows.runs[0].cached_tokens, 3);
  assert.equal(f.rows.runs[0].cost, '0.00001234');
  assert.equal(f.rows.results[0].user_selected, false);
  assert.equal(f.rows.results[0].user_edited, false);
  assert.equal(f.calls[0].group, 'cloudbase');
  assert.equal(f.calls[0].args.model, 'configured-model');
});

test('a transient upstream failure creates a separate failed run before retry', async () => {
  const transient = Object.assign(new Error('temporary'), { status: 503 });
  const f = fixture([transient, { text: '{"recommendation":"try again"}' }]);
  await f.gateway.runAITask(request);
  assert.equal(f.calls.length, 2);
  assert.equal(f.rows.runs.length, 2);
  assert.equal(f.rows.runs[0].success, false);
  assert.equal(f.rows.runs[0].error, 'UPSTREAM_UNAVAILABLE');
  assert.equal(f.rows.runs[1].success, true);
  assert.equal(f.rows.results.length, 1);
});

test('timeout is recorded but never retried because the remote call may still finish', async () => {
  const f = fixture([], { timeoutMs: 1000 });
  f.gateway = createAIGateway({
    app: { ai: () => ({ createModel: () => ({ generateText: () => new Promise(() => {}) }) }) },
    store: f.store, skillRegistry: testRegistry, modelResolver: () => 'configured-model', timeoutMs: 1000, maxAttempts: 3,
    sleep: async () => { throw new Error('unexpected retry'); },
  });
  await assert.rejects(f.gateway.runAITask(request), error => error.code === 'TIMEOUT' && error.taskId === 1);
  assert.equal(f.rows.runs.length, 1);
  assert.equal(f.rows.runs[0].error, 'TIMEOUT');
  assert.equal(f.rows.tasks[0].status, 'failed');
});

test('invalid structured output fails closed and retains returned token usage', async () => {
  const f = fixture([{ text: '{"wrong":1}', usage: { prompt_tokens: 4, completion_tokens: 2 } }]);
  await assert.rejects(f.gateway.runAITask(request), error => error.code === 'INVALID_RESULT');
  assert.equal(f.rows.results.length, 0);
  assert.equal(f.rows.runs[0].input_tokens, 4);
  assert.equal(f.rows.runs[0].success, false);
  assert.equal(f.rows.tasks[0].status, 'failed');
  assert.equal(f.calls.length, 1);
});

test('a result audit failure is normalized and never repeats a completed model call', async () => {
  const f = fixture([{ text: '{"recommendation":"saved only after audit"}' }]);
  f.store.createResult = async () => { throw new Error('audit unavailable'); };
  await assert.rejects(f.gateway.runAITask(request), error => error.code === 'PERSISTENCE_ERROR');
  assert.equal(f.calls.length, 1);
  assert.equal(f.rows.runs[0].success, true);
  assert.equal(f.rows.tasks[0].status, 'failed');
});

test('legacy AI_MODEL is used only as configured fallback, without fabricating response identity', async () => {
  const previousGatewayModel = process.env.AI_GATEWAY_MODEL;
  const previousLegacyModel = process.env.AI_MODEL;
  try {
    delete process.env.AI_GATEWAY_MODEL;
    process.env.AI_MODEL = 'legacy-configured-model';
    const f = fixture([{ text: '{"recommendation":"review"}' }], { modelResolver: undefined });
    await f.gateway.runAITask(request);
    assert.equal(f.calls[0].args.model, 'legacy-configured-model');
    assert.equal(f.rows.runs[0].model, null);
    assert.equal(f.rows.runs[0].provider, null);
    assert.equal(f.rows.runs[0].cost, null);
  } finally {
    if (previousGatewayModel === undefined) delete process.env.AI_GATEWAY_MODEL;
    else process.env.AI_GATEWAY_MODEL = previousGatewayModel;
    if (previousLegacyModel === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = previousLegacyModel;
  }
});

test('audit insert denial prevents any billable model call', async () => {
  let calls = 0;
  const rdb = { from: () => ({ insert: () => ({ select: async () => ({ data: null, error: { message: 'denied' } }) }) }) };
  const gateway = createAIGateway({
    app: { ai: () => { calls++; throw new Error('must not call model'); } },
    rdb, skillRegistry: testRegistry, modelResolver: () => 'configured-model',
  });
  await assert.rejects(gateway.runAITask(request), error => error.code === 'PERSISTENCE_ERROR');
  assert.equal(calls, 0);
});

test('an unsupported schema is rejected before any audit write', async () => {
  const f = fixture([]);
  await assert.rejects(f.gateway.runAITask({ ...request, outputSchema: { type: 'object', pattern: 'x' } }),
    error => error.code === 'INVALID_INPUT');
  assert.equal(f.rows.tasks.length, 0);
});

test('RDB audit store touches only the three intended public table names', async () => {
  const touched = [];
  const rdb = { from(table) {
    touched.push(table);
    return {
      insert: () => ({ select: async () => ({ data: [{ id: 1 }], error: null }) }),
      update: () => ({ eq: () => ({ select: async () => ({ data: [{ id: 1 }], error: null }) }) }),
    };
  } };
  const store = createRdbAuditStore(rdb);
  await store.createTask({});
  await store.updateTask(1, {});
  await store.createRun({});
  await store.updateRun(1, {});
  await store.createResult({});
  assert.deepEqual(touched, ['ai_tasks', 'ai_tasks', 'ai_runs', 'ai_runs', 'ai_results']);
});
