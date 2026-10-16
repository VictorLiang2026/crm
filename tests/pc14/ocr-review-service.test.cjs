'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { OcrReviewService, selectedFields } = require('../../cloudfunctions/person_360/ocr-review-service');

const commandId = '11111111-1111-4111-8111-111111111111';
const idempotencyKey = '22222222-2222-4222-8222-222222222222';

test('preview resolves identity on the server and forwards only explicitly selected fields', async () => {
  const calls = [];
  const service = new OcrReviewService({
    request: async () => [],
    resolveName: async name => { calls.push(['resolve', name]); return { candidates: [{ id: 71, displayName: '虚构客户甲' }] }; },
    rpc: async (name, body) => { calls.push(['rpc', name, body]); return { previewId: commandId, preview: { before: {}, after: {} } }; },
  });
  const result = await service.previewApply({ personId: '71', customerId: '788', ocrRecordId: '95',
    identityName: '虚构客户甲', selectedPersonId: '71', confirmed: true, idempotencyKey,
    fields: { phone: '13800000000', additional_info: 'unused' }, selectedFields: ['phone'] }, 'actor-test');
  assert.equal(result.identity.personId, '71');
  assert.deepEqual(calls[0], ['resolve', '虚构客户甲']);
  assert.equal(calls[1][1], 'crm_ocr_parse_preview_v1');
  assert.deepEqual(calls[1][2].p_selected, { phone: '13800000000' });
  assert.equal(calls[1][2].p_actor_uid, 'actor-test');
  assert.equal(calls[1][2].p_person_id, 71);
});

test('mismatched, unconfirmed, empty, and out-of-scope identity or field selections never call a write RPC', async () => {
  let rpcCalls = 0;
  const service = new OcrReviewService({ request: async () => [],
    resolveName: async () => ({ candidates: [{ id: 72, displayName: '另一个虚构人物' }] }),
    rpc: async () => { rpcCalls++; return {}; },
  });
  const base = { personId: '71', customerId: 788, ocrRecordId: '95', identityName: '虚构名字',
    selectedPersonId: '71', confirmed: true, idempotencyKey, fields: { phone: '13800000000' }, selectedFields: ['phone'] };
  await assert.rejects(service.previewApply(base, 'actor-test'), /did not resolve/);
  await assert.rejects(service.previewApply({ ...base, confirmed: false }, 'actor-test'), /confirmation/);
  assert.throws(() => selectedFields({ recruitment_priority: 'A' }, ['recruitment_priority']), /outside/);
  assert.throws(() => selectedFields({ phone: ' ' }, ['phone']), /empty/);
  assert.equal(rpcCalls, 0);
});

test('execute and undo previews are actor-bound and require an explicit human confirmation', async () => {
  const calls = [];
  const service = new OcrReviewService({ request: async () => [], resolveName: async () => ({ candidates: [] }),
    rpc: async (name, body) => { calls.push([name, body]); return { ok: true }; },
  });
  await assert.rejects(service.previewUndo({ commandId, idempotencyKey, confirmed: false }, 'actor-test'), /confirmation/);
  await service.previewUndo({ commandId, idempotencyKey, confirmed: true }, 'actor-test');
  await service.execute(commandId, 'actor-test');
  assert.deepEqual(calls.map(([name]) => name), ['crm_ocr_parse_undo_preview_v1', 'crm_ocr_parse_execute_v1']);
  assert.equal(calls[0][1].p_actor_uid, 'actor-test');
  assert.equal(calls[1][1].p_actor_uid, 'actor-test');
});
