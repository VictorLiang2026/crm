'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RelationshipNetworkService, MAX_NODES, MAX_EDGES } = require('../../cloudfunctions/person_360/relationship-network-service');

const people = [
  { id: 1, display_name: '根人物', customer_stage: '关系维护', referral_priority: '高', deleted_at: null },
  { id: 2, display_name: '中间人', deleted_at: null },
  { id: 3, display_name: '目标人物', deleted_at: null },
  { id: 4, display_name: '另一目标', deleted_at: null },
  { id: 5, display_name: '已删除目标', deleted_at: '2026-10-01T00:00:00Z' },
];
const edges = [
  { id: 11, from_person_id: 1, to_person_id: 2, relationship_type: 'friend', source: 'manual', status: 'confirmed', confirmed_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-03T00:00:00Z', strength: 'strong', importance: 5, deleted_at: null },
  { id: 12, from_person_id: 2, to_person_id: 3, relationship_type: 'business', source: 'manual', status: 'confirmed', confirmed_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-04T00:00:00Z', importance: 4, deleted_at: null },
  { id: 13, from_person_id: 2, to_person_id: 4, relationship_type: 'referral', source: 'manual', status: 'confirmed', confirmed_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-05T00:00:00Z', importance: 3, deleted_at: null },
  { id: 14, from_person_id: 4, to_person_id: 1, relationship_type: 'friend', source: 'manual', status: 'confirmed', confirmed_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-05T00:00:00Z', deleted_at: null },
  { id: 15, from_person_id: 2, to_person_id: 5, relationship_type: 'friend', source: 'manual', status: 'confirmed', confirmed_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-05T00:00:00Z', deleted_at: null },
  { id: 16, from_person_id: 1, to_person_id: 3, relationship_type: 'friend', source: 'manual', status: 'pending', confirmed_at: null, updated_at: '2026-10-05T00:00:00Z', deleted_at: null },
  { id: 17, from_person_id: 1, to_person_id: 4, relationship_type: 'business', source: 'manual', status: 'confirmed', confirmed_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-05T00:00:00Z', deleted_at: '2026-10-01T00:00:00Z' },
];
const households = [{ id: 20, anchor_person_id: 1, updated_at: '2026-10-05T00:00:00Z', deleted_at: null }];
const members = [{ id: 21, household_id: 20, person_id: 4, relationship_to_anchor: 'sibling', confirmed_at: '2026-10-03T00:00:00Z', confirmed_by_uid: 'u1', updated_at: '2026-10-04T00:00:00Z', deleted_at: null }];

function includesId(filter, value) {
  const eq = /^eq\.(.+)$/.exec(String(filter || ''));
  if (eq) return String(value) === eq[1];
  const inside = /^in\.\((.*)\)$/.exec(String(filter || ''));
  return inside ? inside[1].split(',').includes(String(value)) : true;
}

function makeRequest(calls = []) {
  return async (table, method, filters = {}) => {
    calls.push({ table, method, filters });
    if (table === 'persons') return people.filter(person => includesId(filters.id, person.id) &&
      (filters.deleted_at !== 'is.null' || person.deleted_at == null));
    if (table === 'relationships') {
      let rows = edges.filter(edge => edge.status === 'confirmed' && edge.deleted_at == null &&
        includesId(filters.from_person_id, edge.from_person_id) && includesId(filters.to_person_id, edge.to_person_id));
      if (filters.or) {
        const personId = /from_person_id\.eq\.(\d+)/.exec(filters.or)?.[1];
        if (personId) rows = rows.filter(edge => String(edge.from_person_id) === personId || String(edge.to_person_id) === personId);
      }
      rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)) || Number(b.id) - Number(a.id));
      const offset = Number(filters.offset || 0), limit = Number(filters.limit || rows.length);
      return rows.slice(offset, offset + limit);
    }
    if (table === 'households') return households.filter(row => row.deleted_at == null &&
      includesId(filters.anchor_person_id, row.anchor_person_id) && includesId(filters.id, row.id));
    if (table === 'household_members') return members.filter(row => row.deleted_at == null && row.confirmed_at && row.confirmed_by_uid &&
      includesId(filters.person_id, row.person_id) && includesId(filters.household_id, row.household_id));
    throw new Error(`unexpected table ${table}`);
  };
}

test('adjacency is paged, confirmed-only, directed, and hides deleted Person endpoints', async () => {
  const calls = [];
  const service = new RelationshipNetworkService({ request: makeRequest(calls) });
  const result = await service.listAdjacency('1', 1);
  assert.equal(result.rows.some(row => row.id === '16'), false, 'pending edges are omitted');
  assert.equal(result.rows.some(row => row.id === '17'), false, 'unlinked edges are omitted');
  assert.equal(result.rows.some(row => row.toPersonId === '5'), false, 'soft-deleted endpoints are hidden');
  assert.equal(result.rows.find(row => row.id === '11').direction, 'outgoing');
  assert.equal(result.rows.find(row => row.id === '14').direction, 'incoming');
  const relationshipRead = calls.find(call => call.table === 'relationships');
  assert.equal(relationshipRead.filters.status, 'eq.confirmed');
  assert.equal(relationshipRead.filters.deleted_at, 'is.null');
  assert.equal(result.maxNodes, MAX_NODES);
  assert.equal(result.maxEdges, MAX_EDGES);
});

test('neighbor expansion requires an active confirmed direct edge and preserves edge direction', async () => {
  const service = new RelationshipNetworkService({ request: makeRequest() });
  const result = await service.expandNeighbor('1', '2');
  assert.equal(result.expandedPersonId, '2');
  assert.deepEqual(result.rows.map(row => row.id).sort(), ['11', '12', '13']);
  await assert.rejects(() => service.expandNeighbor('1', '3'), /confirmed direct neighbor/);
  await assert.rejects(() => service.expandNeighbor('1', '1'), /confirmed direct neighbor/);
});

test('introduction paths are one or two directed confirmed edges and exclude cycles and deleted targets', async () => {
  const service = new RelationshipNetworkService({ request: makeRequest() });
  const result = await service.listIntroductionPaths('1');
  const pairs = result.paths.map(path => path.hops.map(hop => hop.edgeId).join('>'));
  assert.deepEqual(pairs.sort(), ['11', '11>12', '11>13']);
  assert.ok(result.paths.every(path => path.hops.length <= 2));
  assert.ok(result.paths.every(path => path.hops.every((hop, i) => !i || path.hops[i - 1].toPersonId === hop.fromPersonId)));
  assert.ok(result.paths.every(path => !path.hops.some(hop => hop.toPersonId === '5')));
  assert.equal(result.paths.find(path => path.pathId === '11:12').hops[1].updatedAt, '2026-10-04T00:00:00Z');
});

test('household membership stays separate and does not connect people into referral paths', async () => {
  const service = new RelationshipNetworkService({ request: makeRequest() });
  const family = await service.listFamilyMemberships('1');
  const paths = await service.listIntroductionPaths('1');
  assert.equal(family.rows[0].personId, '4');
  assert.equal(family.rows[0].relationshipToAnchor, 'sibling');
  assert.equal(paths.paths.some(path => path.pathId === '11:13'), true);
  assert.equal(paths.paths.some(path => path.pathId === '21'), false);
});

test('AI advice reloads exact path server-side and cannot replace authoritative edge evidence', async () => {
  let calls = 0;
  const service = new RelationshipNetworkService({
    request: makeRequest(), guardrails: 'no invention',
    generateText: async messages => { calls++; assert.match(messages[1].content, /"edge"|"path"/); return { text: '{"suitable":true,"confidence":"高","reason":"基于已确认路径","message":"您好"}' }; },
    extractJson: text => JSON.parse(text),
  });
  const result = await service.suggestIntroduction('1', '3', ['11', '12']);
  assert.equal(calls, 1);
  assert.deepEqual(result.path.hops.map(hop => hop.edgeId), ['11', '12']);
  assert.equal(result.suggestion.message, '您好');
  await assert.rejects(() => service.suggestIntroduction('1', '5', ['11', '15']), /no longer active and confirmed/);
  assert.equal(calls, 1, 'invalid path must be rejected before AI invocation');
});

test('AI output is bounded and a rejected or malformed model response remains a non-writing suggestion', async () => {
  const service = new RelationshipNetworkService({
    request: makeRequest(), generateText: async () => ({ text: 'not JSON' }), extractJson: () => null,
  });
  const result = await service.suggestIntroduction('1', '3', ['11', '12']);
  assert.equal(result.suggestion.suitable, false);
  assert.equal(result.suggestion.confidence, '低');
  assert.match(result.suggestion.reason, /人工检查路径/);
  assert.equal(Object.hasOwn(result, 'raw'), false);
});
