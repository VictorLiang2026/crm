'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMain } = require('../../cloudfunctions/assistant');
const { runActionCommand } = require('../../cloudfunctions/assistant/action-command-service');
const { createActionCommandData } = require('../../cloudfunctions/assistant/action-command-data');

const draft = { operation: 'create', resource: 'actions', personId: 7,
  changes: { action_type: 'followup', title: '联系客户', priority: 'medium' } };
const commandId = '11111111-1111-4111-8111-111111111111';

test('real login is required before reaching the Action executor', async () => {
  let calls = 0;
  const main = createMain(() => ({ uid: 'x', isAnonymous: true }), null,
    () => { calls++; return { ok: true }; });
  assert.equal((await main({ action: 'command', stage: 'plan', command: draft })).error.code, 'UNAUTHORIZED');
  assert.equal(calls, 0);
});

test('only structured Person-scoped create is sent to the Action service', async () => {
  const calls = [];
  const main = createMain(() => ({ uid: 'real-uid', isAnonymous: false }), null,
    (event, uid) => { calls.push({ event, uid }); return { ok: true, status: 'planned' }; });
  assert.equal((await main({ action: 'command', stage: 'plan', command: draft })).status, 'planned');
  assert.equal(calls[0].uid, 'real-uid');
  for (const operation of ['update', 'close', 'delete']) {
    const result = await main({ action: 'command', stage: 'plan', command: { ...draft, operation } });
    assert.equal(result.execution.businessDataWritten, false);
  }
  assert.equal(calls.length, 1);
});

test('service rejects linked objects, unknown fields and forged confirmation', async () => {
  let calls = 0;
  const data = { run: async () => { calls++; return { ok: true, status: 'planned' }; } };
  for (const command of [
    { ...draft, personId: undefined },
    { ...draft, changes: { ...draft.changes, opportunity_id: 8 } },
    { ...draft, changes: { ...draft.changes, source: 'manual' } },
    { ...draft, changes: { ...draft.changes, due_at: 'tomorrow' } },
  ]) {
    await assert.rejects(runActionCommand({ action: 'command', stage: 'plan', command }, 'u', { data }),
      { code: 'INVALID_COMMAND' });
  }
  await assert.rejects(runActionCommand({ action: 'command', stage: 'confirm', resource: 'actions',
    commandId, previewHash: 'forged' }, 'u', { data }), { code: 'INVALID_COMMAND' });
  assert.equal(calls, 0);
});

test('stage and login identity are bound to RPC arguments', async () => {
  const calls = [];
  const data = { run: async (...args) => { calls.push(args); return { ok: true, status: args[0], replayed: false }; } };
  await runActionCommand({ action: 'command', stage: 'plan', command: draft }, 'real-uid', { data });
  await runActionCommand({ action: 'command', stage: 'confirm', resource: 'actions', commandId,
    previewHash: 'a'.repeat(32) }, 'real-uid', { data });
  await runActionCommand({ action: 'command', stage: 'execute', resource: 'actions', commandId },
    'real-uid', { data });
  assert.deepEqual(calls.map(call => call[0]), ['plan','confirm','execute']);
  assert.deepEqual(calls.map(call => call[1]), ['real-uid','real-uid','real-uid']);
  assert.equal(calls[0][2].personId, 7);
  assert.equal(calls[1][2].previewHash, 'a'.repeat(32));
  assert.equal(calls[2][2].previewHash, null);
});

test('database adapter sends only the public RPC and normalizes duplicate errors', async () => {
  const requests = [];
  const data = createActionCommandData({ env: 'crm-d1gkae8ddc930d151', key: 'fixture-only',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: false, json: async () => ({ code: 'DATABASE_23505', message: 'private database detail' }) };
    } });
  await assert.rejects(data.run('preview', 'u', { commandId }), { code: 'DUPLICATE_ACTION' });
  assert.match(requests[0].url, /\/v1\/rdb\/rest\/rpc\/assistant_action_command_v1$/);
  assert.equal(requests[0].options.headers['Content-Profile'], 'public');
  assert.equal(JSON.parse(requests[0].options.body).p_actor_uid, 'u');
});

test('CloudBase-prefixed privilege and foreign-key errors are mapped without leaking details', async () => {
  for (const [pgCode, expected] of [
    ['DATABASE_42501', 'CONFIRMATION_REQUIRED'],
    ['DATABASE_23503', 'INVALID_COMMAND'],
  ]) {
    const data = createActionCommandData({ env: 'crm-d1gkae8ddc930d151', key: 'fixture-only',
      fetchImpl: async () => ({ ok: false, json: async () => ({ code: pgCode, message: 'private' }) }) });
    await assert.rejects(data.run('execute', 'u', { commandId }), { code: expected,
      message: 'Action command could not be completed' });
  }
});
