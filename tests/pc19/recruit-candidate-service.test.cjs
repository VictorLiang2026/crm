'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { RecruitCandidateService } = require('../../cloudfunctions/person_360/recruit-candidate-service');

function fixture({ customer = false, candidate = true, selected = true } = {}) {
  const calls = [];
  const request = async (table, method, filters) => {
    calls.push({ table, method, filters });
    if (table === 'persons') return [];
    if (table === 'customers') return customer ? [{ Id: 71 }] : [];
    if (table === 'recruit_candidates') return candidate ? [{ id: 84, person_id: 92, updated_at: '2026-10-16T05:00:00.000Z' }] : [];
    if (table === 'recruit_milestones') return [{ id: 3, candidate_id: 84, to_stage: '互动暖客' }];
    if (table === 'recruit_followups') return [{ id: 4, candidate_id: 84, followup_notes: '【系统测试·勿联系】虚构跟进' }];
    throw new Error('Unexpected table: ' + table);
  };
  const resolveName = async name => ({
    displayName: name,
    deletedIdentity: false,
    candidates: selected ? [{ id: '92', displayName: name, occupation: '虚构职业', legacyCustomerId: customer ? '71' : null }] : [],
  });
  const rpc = async (name, params) => { calls.push({ rpc: name, params }); return { ok: true, id: '84', personId: '92' }; };
  return { service: new RecruitCandidateService({ request, rpc, resolveName }), calls };
}

test('PC19 resolve returns explicit customer link without creating a role', async () => {
  const f = fixture({ customer: true });
  const result = await f.service.resolveRecruitName('【系统测试·勿联系】陈宁');
  assert.equal(result.candidates[0].customerId, '71');
  assert.ok(f.calls.every(call => call.table === 'persons'));
});

test('PC19 create re-resolves selected identity on the server before the atomic RPC', async () => {
  const f = fixture({ selected: true });
  const result = await f.service.create({ personId: '92', selectedDisplayName: '【系统测试·勿联系】陈宁' }, 'test-user');
  assert.equal(result.personId, '92');
  assert.equal(f.calls.filter(call => call.rpc).length, 1);
  assert.deepEqual(f.calls.find(call => call.rpc), { rpc: 'crm_recruit_candidate_create_v1', params: {
    p_actor_uid: 'test-user', p_person_id: 92,
    p_selected_display_name: '【系统测试·勿联系】陈宁', p_operator: null,
  } });
});

test('PC19 create rejects an unselected or stale Person before any database write', async () => {
  const f = fixture({ selected: false });
  await assert.rejects(f.service.create({ personId: '92', selectedDisplayName: '同名甲' }, 'test-user'), /Selected Person changed/);
  assert.equal(f.calls.some(call => call.rpc), false);
});

test('PC19 details bind candidate, Person, milestones and follow-ups to the same identity', async () => {
  const f = fixture();
  const result = await f.service.details('84', '92');
  assert.equal(result.candidate.person_id, 92);
  assert.equal(result.milestones[0].candidate_id, 84);
  assert.equal(result.followups[0].candidate_id, 84);
  assert.deepEqual(f.calls[0].filters, {
    select: '*', id: 'eq.84', person_id: 'eq.92', deleted_at: 'is.null', limit: 1,
  });
});

test('PC19 transition delegates optimistic concurrency and candidate/Person binding to the SQL transaction', async () => {
  const f = fixture();
  await f.service.transition({ candidateId: '84', personId: '92', expectedUpdatedAt: '2026-10-16T05:00:00.000Z', stage: '精准面谈', note: '虚构说明' }, 'test-user');
  assert.deepEqual(f.calls[0], { rpc: 'crm_recruit_candidate_transition_v1', params: {
    p_actor_uid: 'test-user', p_candidate_id: 84, p_person_id: 92,
    p_expected_updated_at: '2026-10-16T05:00:00.000Z', p_to_stage: '精准面谈',
    p_note: '虚构说明', p_operator: null,
  } });
});

test('PC19 duplicate active candidates and stale stage updates return safe errors', async () => {
  const create = fixture();
  create.service.rpc = async () => { throw new Error('Person already has an active recruit candidate'); };
  await assert.rejects(create.service.create({ personId: '92', selectedDisplayName: '【系统测试·勿联系】陈宁' }, 'test-user'), /active recruit candidate/);
  const transition = fixture();
  transition.service.rpc = async () => ({ ok: false, conflict: true, code: 'RECRUIT_CONFLICT' });
  const result = await transition.service.transition({ candidateId: '84', personId: '92',
    expectedUpdatedAt: '2026-10-16T05:00:00.000Z', stage: '精准面谈' }, 'test-user');
  assert.deepEqual(result, { ok: false, conflict: true, code: 'RECRUIT_CONFLICT' });
});

test('PC19 migration is public-only, transactional, reversible, and creates no customer or Person role', () => {
  const root = path.resolve(__dirname, '../..');
  const migration = fs.readFileSync(path.join(root, 'cloudbase/migrations/20261016150000_recruit_candidate_commands.sql'), 'utf8');
  const rollback = fs.readFileSync(path.join(root, 'cloudbase/rollbacks/20261016150000_recruit_candidate_commands.rollback.sql'), 'utf8');
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(migration, /public\.crm_recruit_candidate_create_v1/);
  assert.match(migration, /public\.crm_recruit_candidate_transition_v1/);
  assert.match(migration, /public\.persons/);
  assert.match(migration, /public\.customers/);
  assert.match(migration, /public\.recruit_candidates/);
  assert.match(migration, /public\.recruit_milestones/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /IS DISTINCT FROM p_expected_updated_at/);
  assert.match(migration, /EXCEPTION WHEN unique_violation/);
  assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE)\s+INTO\s+public\.person_roles\b/i);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.customers\b/i);
  assert.doesNotMatch(migration, /\b(?:pr|pr_\w+)\b/i);
  assert.match(rollback, /DROP FUNCTION public\.crm_recruit_candidate_transition_v1/);
  assert.match(rollback, /DROP FUNCTION public\.crm_recruit_candidate_create_v1/);
});
