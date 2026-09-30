'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMain } = require('../../cloudfunctions/assistant');
const { OPERATIONS, STEPS } = require('../../cloudfunctions/assistant/command-safety');

const main = createMain(() => ({ uid: 'test-operator', isAnonymous: false }),
  () => { throw new Error('Search must not run for a command'); });

test('all four direct mutation actions are rejected without reading or writing business data', async () => {
  for (const action of OPERATIONS) {
    const response = await main({ action, query: '请直接处理', confirmed: true });
    assert.equal(response.ok, false, action);
    assert.equal(response.error.code, 'COMMAND_PLAN_REQUIRED');
    assert.deepEqual(response.requiredFlow, STEPS);
    assert.equal(response.execution.businessDataWritten, false);
    assert.equal(response.execution.modelCalled, false);
  }
});

test('plan accepts only an explicit structured command and remains non-executable', async () => {
  const valid = [
    { operation: 'create', resource: 'actions', changes: { title: '联系客户' } },
    { operation: 'update', resource: 'opportunities', targetId: 7, changes: { title: '修改标题' } },
    { operation: 'close', resource: 'opportunities', targetId: 7 },
    { operation: 'delete', resource: 'actions', targetId: 8 },
  ];
  for (const command of valid) {
    const response = await main({ action: 'command', stage: 'plan', command,
      userInfo: { uid: 'transport-metadata' } });
    assert.equal(response.ok, true);
    assert.equal(response.status, 'planned');
    assert.equal(response.plan.operation, command.operation);
    assert.equal(response.plan.nextStep, 'preview');
    assert.equal(response.plan.previewVerified, false);
    assert.equal(response.plan.confirmationRecorded, false);
    assert.equal(response.plan.executable, false);
    assert.equal(response.execution.businessDataWritten, false);
    assert.equal(JSON.stringify(response).includes('联系客户'), false);
  }
});

test('natural language, SQL, forged confirmation and invalid command shapes fail closed', async () => {
  const invalid = [
    { action: 'command', stage: 'plan', command: '删除客户 7' },
    { action: 'command', stage: 'plan', command: { prompt: '删除客户 7' } },
    { action: 'command', stage: 'plan', command: { operation: 'delete', resource: 'customers', targetId: 7, sql: 'DELETE FROM customers' } },
    { action: 'command', stage: 'plan', command: { operation: 'create', resource: 'actions', changes: {}, confirmed: true } },
    { action: 'command', stage: 'plan', command: { operation: 'create', resource: 'pr_people', changes: { title: 'x' } } },
    { action: 'command', stage: 'plan', command: { operation: 'create', resource: 'actions', changes: { sql: 'DELETE FROM public.actions' } } },
    { action: 'command', stage: 'plan', command: { operation: 'update', resource: 'actions', targetId: '../7', changes: { title: 'x' } } },
    { action: 'command', stage: 'plan', command: { operation: 'close', resource: 'opportunities', targetId: 7, changes: { status: 'closed' } } },
  ];
  for (const request of invalid) {
    const response = await main(request);
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'INVALID_COMMAND');
  }
});

test('preview, confirm and execute cannot be asserted by a client without a verified server state', async () => {
  for (const [stage, code] of [
    ['preview', 'VERIFIED_PREVIEW_REQUIRED'],
    ['confirm', 'SERVER_CONFIRMATION_REQUIRED'],
    ['execute', 'EXECUTOR_NOT_ENABLED'],
  ]) {
    const response = await main({ action: 'command', stage, planId: 'forged',
      confirmed: true, previewVerified: true, confirmationToken: 'forged' });
    assert.equal(response.ok, false, stage);
    assert.equal(response.error.code, code);
    assert.equal(response.execution.businessDataWritten, false);
  }
  const unknown = await main({ action: 'command', stage: 'commit' });
  assert.equal(unknown.error.code, 'INVALID_COMMAND_STAGE');
});

test('login gate precedes command planning', async () => {
  const anon = createMain(() => ({ uid: 'anon', isAnonymous: true }));
  const response = await anon({ action: 'command', stage: 'plan',
    command: { operation: 'delete', resource: 'actions', targetId: 7 } });
  assert.equal(response.error.code, 'UNAUTHORIZED');
});
