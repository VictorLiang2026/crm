'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createKnowledgeContentService } = require('../../cloudfunctions/assistant/knowledge-content-service');

function serviceWithRpc(rpc) {
  return createKnowledgeContentService({ rpc, request: async () => [], sourceBytes: async () => Buffer.alloc(0),
    extractText: async () => '', extractPdfText: async () => '', generateSummary: async () => ({}),
    callFunction: async () => ({}), renderPdfPages: async () => ({}) });
}

test('GPT queue is restricted to a stable knowledge item id and timestamp', async () => {
  const calls = [];
  const service = serviceWithRpc(async (...args) => { calls.push(args); return { data: { ok: true, commandId: 'cmd-1', status: 'queued' } }; });
  const result = await service.run('queueGpt', 'crm-user-1', {
    table: 'knowledge_items', id: '12', expectedUpdatedAt: '2026-10-31T12:00:00.000Z',
  });

  assert.equal(result.commandId, 'cmd-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'crm_knowledge_gpt_queue_v1');
  assert.deepEqual(calls[0][1], {
    p_actor_uid: 'crm-user-1', p_table: 'knowledge_items', p_id: 12,
    p_expected_updated_at: '2026-10-31T12:00:00.000Z',
  });
});

test('GPT queue rejects unsupported record types and stale or malformed IDs before database access', async () => {
  let calls = 0;
  const service = serviceWithRpc(async () => { calls++; return { data: { ok: true } }; });

  await assert.rejects(service.run('queueGpt', 'crm-user-1', {
    table: 'playbooks', id: '12', expectedUpdatedAt: '2026-10-31T12:00:00.000Z',
  }), { code: 'INVALID_INPUT' });
  await assert.rejects(service.run('queueGpt', 'crm-user-1', {
    table: 'knowledge_items', id: '0', expectedUpdatedAt: '2026-10-31T12:00:00.000Z',
  }), { code: 'INVALID_INPUT' });
  assert.equal(calls, 0);
});
