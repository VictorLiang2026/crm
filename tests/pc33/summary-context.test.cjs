'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

test('Person summary keeps source provenance inside Gateway metadata and preserves its response', async () => {
  const file = path.resolve(__dirname, '../../cloudfunctions/assistant/summarize-service.js');
  const loaded = new Module(file);
  loaded.filename = file;
  let request;
  const stubs = {
    './db': { app: {} },
    './ai-gateway': { createAIGateway: () => ({ runAITask: async value => {
      request = value;
      return { taskId: 91, resultId: 92, skillVersion: '1.0.0',
        result: { summary: '【系统测试·勿联系】虚构摘要', signals: [], gaps: [], nextActions: [], evidence: [] } };
    } }) },
    './search-data': { createSearchData: () => ({ auditRdb: {} }) },
  };
  loaded.require = id => {
    if (!(id in stubs)) throw Error(`Unexpected import: ${id}`);
    return stubs[id];
  };
  loaded._compile(fs.readFileSync(file, 'utf8'), file);
  const previousFetch = global.fetch;
  const previousEnv = { env: process.env.TCB_ENV, key: process.env.CRM_ASSISTANT_DB_API_KEY };
  process.env.TCB_ENV = 'crm-test123';
  process.env.CRM_ASSISTANT_DB_API_KEY = 'fictional-test-key';
  global.fetch = async url => {
    const table = new URL(url).pathname.split('/').pop();
    const rows = table === 'persons' ? [{ id: 783, display_name: '【系统测试·勿联系】虚构体验甲' }] : [];
    return { ok: true, text: async () => JSON.stringify(rows) };
  };
  try {
    const result = await loaded.exports.runSummarize({ personId: '783' });
    const { _context, ...snapshotData } = request.contextSnapshot;
    assert.deepEqual(snapshotData, request.context);
    assert.deepEqual(_context.sources, result.sources);
    assert.equal(_context.sources[0].table, 'persons');
    assert.equal(result.taskId, 91);
    assert.equal(result.resultId, 92);
    assert.equal(result.execution.businessDataWritten, false);
  } finally {
    global.fetch = previousFetch;
    if (previousEnv.env === undefined) delete process.env.TCB_ENV;
    else process.env.TCB_ENV = previousEnv.env;
    if (previousEnv.key === undefined) delete process.env.CRM_ASSISTANT_DB_API_KEY;
    else process.env.CRM_ASSISTANT_DB_API_KEY = previousEnv.key;
  }
});
