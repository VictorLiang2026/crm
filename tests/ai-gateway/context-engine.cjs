'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createContextEngine } = require('../../cloudfunctions/_shared/context-engine');
const { defaultRegistry } = require('../../cloudfunctions/_shared/skill-registry');

function fixture(data = {}) {
  const calls = [];
  const rdb = { from(table) {
    const call = { table, filters: {}, order: null, limit: null };
    calls.push(call);
    const chain = {
      select(fields) { call.fields = fields.split(','); return this; },
      eq(field, value) { call.filters[field] = value; return this; },
      is(field, value) { call.filters[field] = value; return this; },
      order(field) { call.order = field; return this; },
      limit(value) { call.limit = value; return this; },
      then(resolve, reject) {
        const rows = (data[table] || []).filter(row =>
          Object.entries(call.filters).every(([field, value]) => row[field] === value)).slice(0, call.limit);
        const selected = rows.map(row => Object.fromEntries(
          call.fields.filter(field => Object.hasOwn(row, field)).map(field => [field, row[field]])));
        return Promise.resolve({ data: selected }).then(resolve, reject);
      },
    };
    return chain;
  } };
  return { engine: createContextEngine({ rdb, now: () => new Date('2026-09-25T12:00:00Z') }), calls };
}

const sample = {
  customers: [{ Id: 7, customer_name: '测试客户', occupation: 'teacher', deleted_at: null,
    phone: 'never-forward-this' }],
  followups: Array.from({ length: 30 }, (_, index) => ({ Id: index + 1, customer_id: 7,
    followup_date: '2026-09-25', followup_notes: 'x'.repeat(1000), next_followup_date: '2026-09-25', deleted_at: null })),
  opportunities: [{ id: 8, customer_id: 7, status: 'open', next_action_date: '2026-09-25', deleted_at: null }],
  products: [{ id: 9, customer_id: 7, items: 'product', deleted_at: null }],
  policy_review_reports: [{ id: 10, customer_id: 7, summary: 'review', deleted_at: null }],
  activities: [{ id: 11, name: 'meeting', deleted_at: null }],
  activity_participants: [{ id: 12, activity_id: 11, person_name: 'participant', deleted_at: null }],
  activity_tasks: [{ id: 13, activity_id: 11, task_title: 'review' }],
  recruit_candidates: [{ id: 14, customer_id: 7, stage: 'new', deleted_at: null }],
  recruit_followups: [{ id: 15, candidate_id: 14, followup_notes: 'hello', deleted_at: null }],
};

test('six recipes produce registry-compatible, sourced, bounded read-only context', async () => {
  const { engine, calls } = fixture(sample);
  const requests = [
    ['person_basic', 'customer', 7, 'person_summary'],
    ['meeting_prep', 'customer', 7, 'meeting_prep'],
    ['quick_capture', 'none', null, 'quick_capture'],
    ['today_coach', 'day', '2026-09-25', 'today_coach'],
    ['activity_review', 'activity', 11, 'activity_review'],
    ['recruit_coach', 'candidate', 14, 'recruit_coach'],
  ];
  for (const [recipe, subjectType, subjectId, skill] of requests) {
    const built = await engine.buildContext({ recipe, subjectType, subjectId });
    assert.equal(defaultRegistry.validateContext(skill, built.context), true);
    assert.equal(built.context_snapshot._context.recipe, recipe);
    assert.deepEqual(Object.fromEntries(Object.entries(built.context_snapshot).filter(([key]) => key !== '_context')), built.context);
  }
  const person = await engine.buildContext({ recipe: 'person_basic', subjectType: 'customer', subjectId: 7 });
  assert.equal(person.context.recent_interactions.length, 5);
  assert.equal(person.context.recent_interactions[0].data.followup_notes.length, 600);
  assert.deepEqual(person.context.person.source, { schema: 'public', table: 'customers', id: '7' });
  assert.equal(person.context.person.data.phone, undefined);
  assert.ok(calls.every(call => !call.table.startsWith('pr_') && call.limit <= 20 &&
    !call.fields.includes('*') && !['insert', 'update', 'delete'].some(word => call.fields.includes(word))));
  assert.ok(calls.filter(call => ['followups', 'recruit_followups'].includes(call.table))
    .every(call => call.limit <= 10 && call.filters.deleted_at === null));
});

test('rejects invalid scope, unbounded options, missing or failed root reads', async () => {
  const { engine, calls } = fixture(sample);
  await assert.rejects(engine.buildContext({ recipe: 'person_basic', subjectType: 'customer', subjectId: 7,
    options: { interactionLimit: 100 } }), error => error.code === 'INVALID_OPTIONS');
  await assert.rejects(engine.buildContext({ recipe: 'today_coach', subjectType: 'day', subjectId: '2026-02-30' }),
    error => error.code === 'INVALID_SUBJECT');
  await assert.rejects(engine.buildContext({ recipe: 'person_basic', subjectType: 'candidate', subjectId: 7 }),
    error => error.code === 'INVALID_SUBJECT');
  await assert.rejects(engine.buildContext({ recipe: 'recruit_coach', subjectType: 'candidate', subjectId: 99 }),
    error => error.code === 'NOT_FOUND');
  assert.equal(calls.length, 1);
  const broken = createContextEngine({ rdb: { from: () => ({ select: () => { throw new Error('boom'); } }) } });
  await assert.rejects(broken.buildContext({ recipe: 'person_basic', subjectType: 'customer', subjectId: 7 }),
    /boom/);
});
