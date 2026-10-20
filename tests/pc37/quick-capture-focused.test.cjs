'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, quickCaptureFocused, readContext } = require('../../cloudfunctions/ai_parse/quick-capture-focused');
const raw = '张先生只愿周末联系。我答应发资料。他答应回复。';
const base = () => ({ person_name: '张先生', interaction_type: '微信', interaction_date: null,
  summary: raw, memories: [{ content: '只愿周末联系', evidence: '只愿周末联系', change: false }],
  suggestions: [], commitments: [] });
const context = { memories: [], workItems: [], checked: false };
test('summary-only notes can contain zero memories and zero tasks', () => {
  const draft = base(); draft.memories = [];
  const result = normalize(draft, raw, context);
  assert.equal(result.summary, raw);
  assert.deepEqual([result.facts, result.suggestions, result.commitments], [[], [], []]);
});
test('known memories are suppressed and related open work is resolved only from supplied history', () => {
  const draft = base();
  draft.suggestions = [{ title: '发资料', reason: '', method: '', date: null, existingId: '7', existingKind: 'action' }];
  const result = normalize(draft, raw, { checked: true,
    memories: [{ content: '只愿周末联系。' }],
    workItems: [{ id: 7, kind: 'action', title: '发资料', person_id: 1 }] });
  assert.equal(result.facts.length, 0);
  assert.equal(result.suggestions[0].existing.id, 7);
  assert.throws(() => normalize(draft, raw, context), /work reference/);
});
test('all explicit commitments survive the two-suggestion budget', () => {
  const draft = base();
  draft.commitments = Array.from({ length: 5 }, (_, i) => ({
    title: `约定 ${i}`, evidence: '答应', date: null, commitmentType: 'I_PROMISED',
  }));
  assert.equal(normalize(draft, raw, context).commitments.length, 5);
  draft.commitments = Array(41).fill(draft.commitments[0]);
  assert.throws(() => normalize(draft, raw, context), /list/);
});
test('fabricated evidence, excessive fragments, invalid dates and task references fail closed', () => {
  const draft = base();
  draft.memories[0].evidence = '年收入一百万';
  assert.throws(() => normalize(draft, raw, context), /evidence/);
  draft.memories = Array(4).fill(base().memories[0]);
  assert.throws(() => normalize(draft, raw, context), /list/);
  draft.memories = []; draft.interaction_date = '2026-02-30';
  assert.throws(() => normalize(draft, raw, context), /date/);
});
test('an explicit promise is not also offered as a suggested new action', () => {
  const draft = base();
  draft.commitments = [{ title: '发资料', evidence: '发资料', date: null, commitmentType: 'I_PROMISED' }];
  draft.suggestions = [{ title: '发资料。', reason: '', method: '', date: null }];
  assert.equal(normalize(draft, raw, context).suggestions.length, 0);
});
test('unselected notes never read contact history and use configured model routing', async () => {
  let requests = 0;
  const result = await quickCaptureFocused({ text: raw, language: 'en' }, {
    rdb: { from() { throw Error('Unexpected DB read'); } }, today: '2026-10-20',
    extractJson: JSON.parse, generateText: async (messages, opts) => {
      requests++; assert.equal(opts.model, undefined);
      assert.match(messages[0].content, /English/);
      assert.equal(JSON.parse(messages[1].content).note, raw);
      return { text: JSON.stringify(base()) };
    },
  });
  assert.equal(requests, 1); assert.equal(result.parsed.contextChecked, false);
});
test('a changed or deleted selected identity stops before the AI call', async () => {
  const query = { select() { return this; }, eq() { return this; }, is() { return this; },
    limit() { return { data: [{ id: 1, display_name: '另一个人' }] }; } };
  await assert.rejects(quickCaptureFocused({ text: raw, personId: 1, selectedName: '张先生' }, {
    rdb: { from: () => query }, assertOk: x => x, today: '2026-10-20',
    generateText() { throw Error('Must not call AI'); },
  }), /Selected Person changed/);
});
test('history reads are bounded, person-scoped and exclude expired/future memories', async () => {
  const calls = [];
  const rows = { persons: [{ id: 1, display_name: '张先生' }],
    context_items: [
      { id: 1, content: '已过期', valid_to: '2026-10-19' },
      { id: 2, content: '未来', valid_from: '2026-10-21' },
      { id: 3, content: '当天生效', valid_from: '2026-10-20T00:00:00+08:00' },
    ], actions: [{ id: 4, person_id: 1, title: '发资料' }], commitments: [] };
  const rdb = { from(table) {
    const call = { table, filters: [] }; calls.push(call);
    return {
      select() { return this; }, order() { return this; },
      eq(...args) { call.filters.push(args); return this; },
      is(...args) { call.filters.push(args); return this; },
      in(...args) { call.filters.push(args); return this; },
      limit(n) { call.limit = n; return { data: rows[table] }; },
    };
  } };
  const result = await readContext({ personId: 1, selectedName: '张先生' },
    { rdb, assertOk: x => x }, '2026-10-20');
  assert.deepEqual(result.memories.map(x => x.id), ['3']);
  assert.equal(result.workItems[0].kind, 'action');
  for (const call of calls.slice(1)) {
    assert.ok(call.filters.some(([field, value]) => field === 'person_id' && value === '1'));
    assert.ok(call.limit <= 50);
  }
});
