'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '../../cloudfunctions/today_coach');
const dbPath = require.resolve(path.join(root, 'db.js'));
let caller = null;
let modelCalls = 0;
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  app: { auth: () => ({ getUserInfo: () => caller }) },
  rdb: { from: () => {
    const query = { select: () => query, is: () => query, order: () => query,
      then: resolve => Promise.resolve({ data: [], error: null }).then(resolve) };
    return query;
  } },
  generateText: async () => { modelCalls++; throw new Error('No model call for empty facts'); },
  extractJson: JSON.parse, assertOk: value => value, nowIso: () => '2026-10-01T00:00:00Z',
} };
const coach = require(path.join(root, 'index.js'));

test('morning view rejects anonymous before reading and returns seven empty sections for a logged-in user', async () => {
  const previousEnv = process.env.TCB_ENV;
  const previousKey = process.env.CRM_TODAY_DB_API_KEY;
  const previousFetch = global.fetch;
  let reads = 0;
  try {
    process.env.TCB_ENV = 'crm-test123';
    process.env.CRM_TODAY_DB_API_KEY = 'fixture-only';
    global.fetch = async (_url, options) => {
      reads++;
      assert.equal(options.method, 'GET');
      assert.equal(options.headers['Accept-Profile'], 'public');
      return { ok: true, json: async () => [] };
    };
    assert.deepEqual(await coach.main({ action: 'daily_review', view: 'morning' }), { error: 'UNAUTHORIZED' });
    assert.equal(reads, 0);
    caller = { uid: '[CRM_TEST_ONLY]user', isAnonymous: false };
    const result = await coach.main({ action: 'daily_review', view: 'morning' });
    assert.equal(result.view, 'morning');
    assert.deepEqual(Object.keys(result.sections).slice(0, 7), ['morningBrief', 'topActions',
      'commitments', 'upcoming', 'risk', 'opportunities', 'needConfirmation']);
    assert.equal(reads, 5); // open actions + four Morning Brief tables; no Person IDs
    assert.equal(modelCalls, 0);
  } finally {
    caller = null;
    global.fetch = previousFetch;
    if (previousEnv === undefined) delete process.env.TCB_ENV; else process.env.TCB_ENV = previousEnv;
    if (previousKey === undefined) delete process.env.CRM_TODAY_DB_API_KEY;
    else process.env.CRM_TODAY_DB_API_KEY = previousKey;
  }
});
