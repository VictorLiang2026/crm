'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

test('Person 360 exposes only the fixed OCR undo conflict receipt', async () => {
  const indexPath = path.resolve(__dirname, '../../cloudfunctions/person_360/index.js');
  const originalLoad = Module._load;
  const originalFetch = global.fetch;
  const originalEnv = process.env.TCB_ENV;
  const originalKey = process.env.CRM_PERSON360_DB_API_KEY;
  process.env.TCB_ENV = 'crm-test';
  process.env.CRM_PERSON360_DB_API_KEY = 'isolated-test-key';
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === indexPath && request === '@cloudbase/node-sdk') {
      return { init: () => ({ auth: () => ({ getUserInfo: () => ({ uid: 'actor-test' }) }) }) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[indexPath];
    const { main } = require(indexPath);
    const event = { action: 'previewOcrUndo', data: {
      confirmed: true, commandId: '11111111-1111-4111-8111-111111111111',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
    } };
    global.fetch = async (url, options) => {
      assert.match(url, /\/v1\/rdb\/rest\/rpc\/crm_ocr_parse_undo_preview_v1$/);
      assert.equal(options.method, 'POST');
      return { ok: true, json: async () => ({ errorCode: 'OCR_UNDO_CONFLICT', businessDataWritten: false }) };
    };
    assert.deepEqual(await main(event), { error: 'OCR_UNDO_CONFLICT' });
    global.fetch = async () => ({ ok: true, json: async () => ({ previewId: '33333333-3333-4333-8333-333333333333', preview: { before: {}, after: {} } }) });
    assert.equal((await main(event)).previewId, '33333333-3333-4333-8333-333333333333');
    global.fetch = async () => ({ ok: false, status: 409, json: async () => ({ code: '40001', message: 'unrelated database conflict' }) });
    assert.deepEqual(await main(event), { error: 'Person 360 request failed' });
  } finally {
    Module._load = originalLoad;
    global.fetch = originalFetch;
    if (originalEnv === undefined) delete process.env.TCB_ENV;
    else process.env.TCB_ENV = originalEnv;
    if (originalKey === undefined) delete process.env.CRM_PERSON360_DB_API_KEY;
    else process.env.CRM_PERSON360_DB_API_KEY = originalKey;
    delete require.cache[indexPath];
  }
});
