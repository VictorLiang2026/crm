'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../cloudfunctions/recruit_goals/index.js'), 'utf8');

function invoke(event, response) {
  const calls = [];
  const rdb = {
    from() { throw new Error('Monthly goals must use one transactional RPC'); },
    rpc(name, params) {
      calls.push({ name, params });
      return Promise.resolve(response);
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require(name) {
      if (name === './test-data') return require('../../cloudfunctions/_shared/test-data');
      if (name !== './db') throw new Error('Unexpected module: ' + name);
      return {
        rdb,
        nowIso: () => '2026-10-02T00:00:00Z',
        normFields: () => ({}),
        assertOk(result) {
          if (result.error) throw new Error(result.error.message || String(result.error));
          return result;
        },
      };
    },
  }, { filename: 'recruit_goals/index.js' });
  return module.exports.main(event, {}).then(result => ({ result, calls }));
}

test('saveGoals uses one RPC and preserves the existing response', async () => {
  const { result, calls } = await invoke({
    action: 'saveGoals', goalMonth: '2026-10',
    goals: { '新增人才': '5', '互动暖客': '2.9', '初次面谈': -1 },
  }, { data: { ok: true, inserted: 2 }, error: null });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: true, inserted: 2 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'crm_recruit_goals_save_v1');
  assert.equal(calls[0].params.p_goal_month, '2026-10');
  assert.equal(calls[0].params.p_goals['新增人才'], 5);
  assert.equal(calls[0].params.p_goals['互动暖客'], 2);
  assert.equal(calls[0].params.p_goals['初次面谈'], 0);
  assert.equal(Object.keys(calls[0].params.p_goals).length, 7);
});

test('all-zero save remains a valid clear and accepts singleton-array RPC shape', async () => {
  const { result, calls } = await invoke({
    action: 'saveGoals', goalMonth: '2026-11', goals: {},
  }, { data: [{ ok: true, inserted: 0 }], error: null });
  assert.equal(result.ok, true);
  assert.equal(result.inserted, 0);
  assert.ok(Object.values(calls[0].params.p_goals).every(value => value === 0));
});

test('RPC failure is reported without a fallback direct write', async () => {
  const { result, calls } = await invoke({
    action: 'saveGoals', goalMonth: '2026-10', goals: { '新增人才': 3 },
  }, { data: null, error: { message: 'transaction aborted' } });
  assert.match(result.error, /transaction aborted/);
  assert.equal(calls.length, 1);
});
