import assert from 'node:assert/strict';
import { createApi, createFeatureFlags, createRouterExtension, createState } from '../../crm/js/core/index.js';

const calls = [];
const api = createApi((name, data) => { calls.push({ name, data }); return Promise.resolve({ ok: true }); });
assert.deepEqual(await api.call('customers', { action: 'list' }), { ok: true });
assert.deepEqual(calls, [{ name: 'customers', data: { action: 'list' } }]);
assert.throws(() => api.call('pr_example', {}), /Invalid CRM function name/);

const disabled = createFeatureFlags();
const dormant = createRouterExtension({ flags: disabled });
let renders = 0;
dormant.register('#/ai/insight', { flag: 'insight', render: () => { renders++; } });
assert.equal(dormant.resolve('#/ai/insight'), null);
assert.equal(await dormant.dispatch('#/ai/insight'), false);
assert.equal(renders, 0);
assert.equal(dormant.resolve('#/customers'), null);
assert.throws(() => dormant.register('#/customers', { flag: 'insight', render() {} }), /under #\/ai\//);

const flags = createFeatureFlags({ insight: true });
const router = createRouterExtension({ flags });
router.register('#/ai/insight', { flag: 'insight', render: ({ name }) => { assert.equal(name, 'test'); renders++; } });
assert.equal(await router.dispatch('#/customers', { name: 'test' }), false);
assert.equal(await router.dispatch('#/ai/insight', { name: 'test' }), true);
assert.equal(renders, 1);
assert.throws(() => router.register('#/ai/insight', { flag: 'insight', render() {} }), /unique/);

const state = createState({ count: 0 });
let observed = 0;
const unsubscribe = state.subscribe(snapshot => { observed = snapshot.count; });
state.update({ count: 1 });
assert.equal(observed, 1);
assert.equal(state.get().count, 1);
assert.throws(() => { state.get().count = 9; }, TypeError);
unsubscribe();
state.update({ count: 2 });
assert.equal(observed, 1);
console.log('[PASS] modular API bridge, disabled routing, scoped routes, flags and state');
