'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createMain } = require('../../cloudfunctions/assistant/index');
const file = path.resolve(__dirname, '../../cloudfunctions/assistant/meeting-prep-service.js');
const loaded = new Module(file);
loaded.filename = file;
const stubs = {
  '@cloudbase/node-sdk': {}, './db': { app: {} },
  './ai-gateway': { createAIGateway: () => { throw Error('Unexpected live gateway'); } },
  './search-data': { createSearchData: () => { throw Error('Unexpected live database'); } },
};
loaded.require = id => id in stubs ? stubs[id] : require(id);
loaded._compile(fs.readFileSync(file, 'utf8'), file);
const { runMeetingPrep, getMeetingPrepTaskStatus } = loaded.exports;

test('meeting prep uses a 100-second model ceiling and publishes the task before model completion', async () => {
  let optionsSeen, requestSeen, started;
  const result = await runMeetingPrep({ personId: '783' }, {
    callFunction: async payload => {
      assert.deepEqual(payload, { name: 'person_360', data: { action: 'getMeetingPrepContext', personId: '783' } });
      return { result: { person: { id: 783 }, facts: [], recent_interactions: [] } };
    }, database: { auditRdb: {} },
    gatewayFactory: options => { optionsSeen = options; return { runAITask: async request => {
      requestSeen = request;
      await request.onStarted({ taskId: '71' });
      return { taskId: '71', resultId: '72', skillVersion: '2.0.0', result: {
        brief30Seconds: 'Ready', recentChanges: [], suggestedObjective: 'Confirm details',
        openingAngles: [], possibleObjections: [], questionsToConfirm: [], avoid: [],
      } };
    } }; }, onStarted: value => { started = value.taskId; },
  });
  assert.equal(optionsSeen.timeoutMs, 100000);
  assert.equal(optionsSeen.maxAttempts, 1);
  assert.equal(requestSeen.taskType, 'meeting_prep');
  assert.equal(started, '71');
  assert.equal(result.brief30Seconds, 'Ready');
});

test('meeting prep status is scoped to the Person and distinguishes timeout from pending and completed', async () => {
  const calls = [];
  const read = async (table, filters) => {
    calls.push({ table, filters });
    if (table === 'persons') return [{ id: 783 }];
    if (table === 'ai_tasks') return [{ id: 71, status: 'failed', created_at: '2026-11-06T13:53:09Z' }];
    if (table === 'ai_runs') return [{ error: 'TIMEOUT' }];
    throw Error(`Unexpected table: ${table}`);
  };
  const failed = await getMeetingPrepTaskStatus({ personId: '783', taskId: '71' }, { read });
  assert.deepEqual(failed, { ok: false, status: 'failed', taskId: '71', personId: '783',
    createdAt: '2026-11-06T13:53:09Z', error: { code: 'TIMEOUT' } });
  assert.equal(calls[0].filters.id, 'eq.783');
  assert.equal(calls[1].filters.subject_id, 'eq.783');
  assert.equal(calls[1].filters.task_type, 'eq.meeting_prep');
  assert.equal(calls[1].filters.id, 'eq.71');
  const pending = await getMeetingPrepTaskStatus({ personId: '783' }, { read: async table =>
    table === 'persons' ? [{ id: 783 }] : [{ id: 72, status: 'running', created_at: '2026-11-06T13:54:00Z' }] });
  assert.equal(pending.status, 'pending');
  const completed = await getMeetingPrepTaskStatus({ personId: '783', taskId: '73' }, {
    read: async table => table === 'persons' ? [{ id: 783 }] : table === 'ai_tasks' ? [{ id: 73, status: 'completed',
      context_snapshot: { facts: [], recent_interactions: [], reliable_evidence: [] } }] :
      [{ id: 74, result_json: { brief30Seconds: 'Existing result', recentChanges: [] } }],
  });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.brief30Seconds, 'Existing result');
  assert.equal(completed.execution.businessDataWritten, false);
  await assert.rejects(getMeetingPrepTaskStatus({ personId: '783', taskId: '73' },
    { read: async table => table === 'persons' ? [] : [{ id: 73, status: 'completed' }] }),
  error => error.code === 'NOT_FOUND');
});

test('meeting prep responds with a pending task before background generation finishes', async () => {
  let finish, reachedModel = false;
  const runner = async (event, { onStarted }) => {
    if (!event.asyncWait) return { ok: true, taskId: 81, brief30Seconds: 'Ready' };
    await onStarted({ taskId: 81 });
    reachedModel = true;
    await new Promise(resolve => { finish = resolve; });
    return { ok: true, taskId: 81, brief30Seconds: 'Ready' };
  };
  const main = createMain(() => ({ uid: 'test-operator', isAnonymous: false }),
    ...Array(12).fill(undefined), undefined, undefined, undefined, runner);
  const callbacks = [], context = {};
  assert.equal(main({ action: 'meetingPrep', personId: '783', asyncWait: true }, context,
    (error, result) => callbacks.push({ error, result,
      callbackWaitsForEmptyEventLoop: context.callbackWaitsForEmptyEventLoop })), undefined);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reachedModel, true);
  assert.deepEqual(callbacks, [{ error: null, result: { ok: true, status: 'pending', taskId: '81', personId: '783' },
    callbackWaitsForEmptyEventLoop: false }]);
  finish();
  assert.deepEqual(await main({ action: 'meetingPrep', personId: '783' }),
    { ok: true, taskId: 81, brief30Seconds: 'Ready' });
});
