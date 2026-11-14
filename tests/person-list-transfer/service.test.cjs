'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PersonListTransferService, validateField, chooseValue } = require('../../cloudfunctions/person_360/person-list-transfer-service');
const { parsePersonName } = require('../../cloudfunctions/person_360/person-service');

const ACTOR = 'unit-test-user';
const ID = '17d38986-b1d1-4ee1-9ca5-14bb4263cf7e';
const KEY = '0f7345b1-8110-4fa0-a2be-6a9b0c0e9c0b';
const stamp = '2026-11-09T00:00:00.000Z';

test('field validation rejects impossible dates and invalid enumerations', () => {
  assert.throws(() => validateField('birthday','2024-02-31'), /INVALID_DATE/);
  assert.throws(() => validateField('customer_stage','不是有效阶段'), /INVALID_CUSTOMER_STAGE/);
  assert.throws(() => validateField('notes','x'.repeat(8001)), /FIELD_VALUE_TOO_LONG/);
});

test('a field override takes precedence over the batch conflict policy', () => {
  assert.equal(chooseValue('system','incoming',{mode:'import',mergeText:true,fieldOverrides:{notes:'keep'}},'notes').value,'system');
  assert.equal(chooseValue('system','incoming',{mode:'keep',mergeText:false,fieldOverrides:{notes:'merge'}},'notes').value,'system；incoming');
  assert.equal(chooseValue('system','incoming',{mode:'keep',mergeText:false,fieldOverrides:{notes:'import'}},'notes').value,'incoming');
});

function fixture(seed = [], rosterProfiles = []) {
  const persons = seed.map(person => ({ deleted_at: null, updated_at: stamp, ...person }));
  const commands = [];
  const rpcCalls = [];
  const filter = (row, params = {}) => Object.entries(params).every(([key, value]) => {
    if (key === 'select' || key === 'order' || key === 'limit' || key === 'offset') return true;
    if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
    if (value.startsWith('in.(')) return value.slice(4, -1).split(',').includes(String(row[key]));
    if (value.startsWith('gt.')) return Number(row[key]) > Number(value.slice(3));
    if (value === 'is.null') return row[key] == null;
    if (value.startsWith('lt.')) return Date.parse(row[key]) < Date.parse(value.slice(3));
    return true;
  });
  const request = async (table, method, params = {}, body = {}) => {
    if (table === 'persons') {
    if (method === 'GET') return persons.filter(row => filter(row, params))
      .sort((a,b) => Number(a.id)-Number(b.id)).slice(Number(params.offset || 0), Number(params.offset || 0) + Number(params.limit || 10000))
      .map(row => ({ ...row }));
      throw new Error(`Unexpected persons ${method}`);
    }
    if (table !== 'crm_person_list_transfer_commands') throw new Error(`Unexpected table ${table}`);
    if (method === 'GET') return commands.filter(row => filter(row, params)).map(row => ({ ...row }));
    if (method === 'POST') {
      const row = { id: ID, ...body };
      commands.push(row);
      return [{ id: row.id }];
    }
    if (method === 'PATCH') {
      const matches = commands.filter(row => filter(row, params));
      for (const row of matches) Object.assign(row, body);
      return matches;
    }
    throw new Error(`Unexpected command method ${method}`);
  };
  const resolveName = async name => {
    const key = parsePersonName(name).nameKey;
    const found = persons.filter(row => row.deleted_at == null && row.name_key === key);
    return { hasMore: found.length > 10, candidates: found.slice(0, 10)
      .map(row => ({ id: String(row.id), display_name: row.display_name, name_key: row.name_key,
        organization: row.organization, occupation: row.occupation })) };
  };
  const personService = {
    resolveName,
    async createPerson(fields) {
      if (persons.some(row => row.deleted_at == null && row.display_name === fields.display_name)) throw new Error('duplicate');
      const row = { id: String(Math.max(0, ...persons.map(value => Number(value.id))) + 1), ...fields, updated_at: stamp,
        deleted_at: null };
      persons.push(row);
      return { id: row.id };
    },
  };
  const rpc = async (name, args) => {
    rpcCalls.push({ name, args });
    if (name === 'crm_activity_roster_v1') return { profiles: rosterProfiles.filter(profile =>
      (args.p_input.keys || []).includes(profile.name_key)) };
    if (name === 'crm_person_list_transfer_create_v1') {
      for (const rename of args.p_existing) {
        const row = persons.find(value => String(value.id) === String(rename.personId));
        if (!row || row.updated_at !== rename.expectedUpdatedAt) return { ok:false, conflict:true, code:'PREVIEW_STALE' };
      }
      const names = new Set([...args.p_existing.map(row => row.displayName), args.p_new_person.display_name]);
      if (names.size !== args.p_existing.length + 1 || persons.some(row => row.deleted_at == null && names.has(row.display_name) &&
          !args.p_existing.some(rename => String(rename.personId) === String(row.id)))) throw new Error('name conflict');
      for (const rename of args.p_existing) {
        const row = persons.find(value => String(value.id) === String(rename.personId));
        Object.assign(row, { display_name:rename.displayName, updated_at:new Date(Date.parse(row.updated_at)+1000).toISOString() });
      }
      const created = await personService.createPerson(args.p_new_person);
      return { ok:true, personId:created.id };
    }
    assert.equal(name, 'crm_person_profile_save_v1');
    const row = persons.find(value => String(value.id) === String(args.p_person_id));
    if (!row || row.updated_at !== args.p_person_expected_updated_at) return { ok: false };
    Object.assign(row, args.p_person_fields, { updated_at: new Date(Date.parse(row.updated_at) + 1000).toISOString() });
    return { ok: true };
  };
  let time = Date.parse(stamp);
  const service = new PersonListTransferService({ request, rpc, personService, now: () => new Date(time++).toISOString() });
  return { service, persons, commands, rpcCalls, rosterProfiles };
}

async function preview(service, rows) {
  return service.preview({ idempotencyKey: KEY, rows }, ACTOR);
}

test('parenthetical name resolution exposes one normalized-base candidate', async () => {
  const { service } = fixture([{ id: '1', display_name: '张三', name_key: '张三' }]);
  const result = await preview(service, [{ rowNumber: 2, values: { display_name: '张三（老师）', phone: '13800000000' } }]);
  assert.equal(result.preview.rows[0].status, 'needs_identity');
  assert.equal(result.preview.rows[0].baseName, '张三');
  assert.equal(result.preview.rows[0].candidates[0].display_name, '张三');
});

test('Person list import reviews activity profiles and passes an explicit versioned link to the server transaction', async () => {
  const profile = { id: '91', version: '3', person_id: null, display_name: '王五', name_key: '王五',
    phone: '00123', wechat: 'wx-wang', organization: '活动公司', school: '活动学校' };
  const { service, rpcCalls } = fixture([], [profile]);
  const result = await preview(service, [{ rowNumber: 2, values: { display_name: '王五', phone: '00123' } }]);
  assert.equal(result.preview.rows[0].status, 'needs_activity_roster_review');
  assert.equal(result.preview.rows[0].activityRosterCandidates[0].id, '91');
  await service.saveDecisions({ previewId: result.previewId, decisions: [{ rowNumber: 2,
    decision: { kind:'activity_roster', profileId:'91', version:'3' } }], fieldPolicy:{mode:'keep'} }, ACTOR);
  const executed = await service.execute({ previewId: result.previewId }, ACTOR);
  assert.equal(executed.rows[0].activityRosterLinked, true);
  const create = rpcCalls.find(call => call.name === 'crm_person_list_transfer_create_v1');
  assert.deepEqual(create.args.p_new_person.activityRosterLink, { id:'91', version:'3', displayName:'王五' });
});

test('different-person import can explicitly link the newly qualified Person to an activity profile', async () => {
  const profile = { id:'92', version:'6', person_id:null, display_name:'张三', name_key:'张三',
    phone:'', wechat:'', organization:'活动单位', school:'活动学校' };
  const { service, rpcCalls } = fixture([{ id:'1', display_name:'张三', name_key:'张三', phone:'111' }], [profile]);
  const result = await preview(service, [{ rowNumber:2, values:{ display_name:'张三（老师）', phone:'222' } }]);
  await service.saveDecisions({ previewId:result.previewId, decisions:[{rowNumber:2,decision:{
    kind:'different',displayName:'张三（老师）',renameExisting:[{personId:'1',displayName:'张三（客户）'}],
    activityRosterProfileId:'92',activityRosterVersion:'6',
  }}],fieldPolicy:{mode:'keep'} },ACTOR);
  await service.execute({previewId:result.previewId},ACTOR);
  const create=rpcCalls.find(call=>call.name==='crm_person_list_transfer_create_v1');
  assert.deepEqual(create.args.p_new_person.activityRosterLink,{id:'92',version:'6',displayName:'张三'});
});

test('different person decision qualifies a plain existing name and creates a distinct person', async () => {
  const { service, persons } = fixture([{ id: '1', display_name: '张三', name_key: '张三', phone: '111' }]);
  const result = await preview(service, [{ rowNumber: 2, values: { display_name: '张三（老师）', phone: '222' } }]);
  await service.saveDecisions({ previewId: result.previewId, decisions: [{ rowNumber: 2, decision: {
    kind: 'different', displayName: '张三（老师）', renameExisting: [{ personId: '1', displayName: '张三（客户）' }],
  } }], fieldPolicy: { mode: 'keep' } }, ACTOR);
  const executed = await service.execute({ previewId: result.previewId }, ACTOR);
  assert.equal(executed.ok, true);
  assert.deepEqual(persons.map(row => row.display_name), ['张三（客户）', '张三（老师）']);
  assert.equal(executed.counts.succeeded, 1);
});

test('same-person import fills blanks, merges opted-in text, and keeps conflicts by default', async () => {
  const { service, persons } = fixture([{ id: '1', display_name: '张三（讲师）', name_key: '张三',
    phone: '', notes: '已有备注', organization: '系统机构' }]);
  const result = await preview(service, [{ rowNumber: 2, values: { display_name: '张三', phone: '13800000000',
    notes: '导入备注', organization: '导入机构' } }]);
  await service.saveDecisions({ previewId: result.previewId, decisions: [{ rowNumber: 2, decision: { kind: 'same', personId: '1' } }],
    fieldPolicy: { mode: 'keep', mergeText: true } }, ACTOR);
  const executed = await service.execute({ previewId: result.previewId }, ACTOR);
  assert.equal(executed.rows[0].status, 'updated');
  assert.equal(persons[0].phone, '13800000000');
  assert.equal(persons[0].notes, '已有备注；导入备注');
  assert.equal(persons[0].organization, '系统机构');
});

test('PersonID/name mismatch is blocked and completed as a row-level result', async () => {
  const { service, persons } = fixture([{ id: '1', display_name: '张三', name_key: '张三' },
    { id: '2', display_name: '李四', name_key: '李四' }]);
  const result = await preview(service, [{ rowNumber: 2, values: { display_name: '张三', PersonID: '2', phone: '13800000000' } }]);
  assert.equal(result.preview.rows[0].status, 'blocked');
  await assert.rejects(() => service.execute({ previewId: result.previewId }, ACTOR), /CONFIRMATION_REQUIRED/);
  await assert.rejects(() => service.saveDecisions({ previewId: result.previewId, decisions: [], fieldPolicy: { mode: 'keep' } }, ACTOR), /IMPORT_HAS_BLOCKED_ROWS/);
  assert.equal(persons[1].phone, undefined);
});

test('more than ten same-base candidates fail closed instead of hiding identities', async () => {
  const people = Array.from({ length: 11 }, (_, index) => ({ id: String(index + 1),
    display_name: `张三（${index + 1}）`, name_key: '张三' }));
  const { service } = fixture(people);
  const result = await preview(service, [{ rowNumber: 2, values: { display_name: '张三（老师）' } }]);
  assert.equal(result.preview.rows[0].status, 'blocked');
  assert.equal(result.preview.rows[0].reason, 'TOO_MANY_NAME_MATCHES');
});

test('stale candidate versions prevent profile writes', async () => {
  const { service, persons } = fixture([{ id: '1', display_name: '张三', name_key: '张三', phone: 'old' }]);
  const result = await preview(service, [{ rowNumber: 2, values: { display_name: '张三', phone: 'new' } }]);
  await service.saveDecisions({ previewId: result.previewId, decisions: [{ rowNumber: 2, decision: { kind: 'same', personId: '1' } }],
    fieldPolicy: { mode: 'import' } }, ACTOR);
  persons[0].updated_at = '2026-11-09T00:00:02.000Z';
  const executed = await service.execute({ previewId: result.previewId }, ACTOR);
  assert.equal(executed.ok, false);
  assert.equal(executed.rows[0].code, 'PREVIEW_STALE');
  assert.equal(persons[0].phone, 'old');
});

test('execution claims a preview once and requires an explicit final confirmation', async () => {
  const { service, persons } = fixture([]);
  const result = await preview(service, [{ rowNumber: 2, values: { display_name: '未确认' } }]);
  await assert.rejects(() => service.execute({ previewId: result.previewId }, ACTOR), /CONFIRMATION_REQUIRED/);
  await service.saveDecisions({ previewId: result.previewId, decisions: [], fieldPolicy: { mode: 'keep' } }, ACTOR);
  const executions = await Promise.allSettled([
    service.execute({ previewId: result.previewId }, ACTOR), service.execute({ previewId: result.previewId }, ACTOR),
  ]);
  assert.equal(executions.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(persons.filter(row => row.display_name === '未确认').length, 1);
});

test('partial execution retries failed rows without replaying successful rows', async () => {
  const { service, persons } = fixture([{ id:'1', display_name:'张三', name_key:'张三', phone:'old' }]);
  const result = await preview(service, [{ rowNumber:2, values:{ display_name:'张三', phone:'new' } }]);
  await service.saveDecisions({ previewId:result.previewId,
    decisions:[{ rowNumber:2, decision:{ kind:'same', personId:'1' } }], fieldPolicy:{ mode:'import' } }, ACTOR);
  const rpc = service.rpc;
  let fail = true;
  service.rpc = async (...args) => {
    if (fail) { fail = false; return { ok:false }; }
    return rpc(...args);
  };
  const first = await service.execute({ previewId:result.previewId }, ACTOR);
  assert.equal(first.ok, false);
  assert.equal(first.rows[0].code, 'PERSON_CONFLICT');
  const retry = await service.execute({ previewId:result.previewId }, ACTOR);
  assert.equal(retry.ok, true);
  assert.equal(retry.rows.length, 1);
  assert.equal(retry.rows[0].status, 'updated');
  assert.equal(persons[0].phone, 'new');
});

test('duplicate client row numbers are rejected before preview storage', async () => {
  const { service, commands } = fixture([]);
  await assert.rejects(() => preview(service, [
    { rowNumber:2, values:{ display_name:'张三' } }, { rowNumber:2, values:{ display_name:'李四' } },
  ]), /INVALID_IMPORT_ROW_NUMBER/);
  assert.equal(commands.length, 0);
});

test('export exposes only whitelisted active-person columns and advances by ID', async () => {
  const people = Array.from({ length: 501 }, (_, index) => ({ id: String(index + 1), display_name: `人物${index + 1}`,
    name_key: `人物${index + 1}`, notes: `备注${index + 1}` }));
  people.push({ id: '502', display_name: '已删除', name_key: '已删除', deleted_at: '2026-01-01T00:00:00Z' });
  const { service } = fixture(people);
  const first = await service.exportPeople({ fields: ['notes','id','unexpected'] }, ACTOR);
  assert.deepEqual(first.columns, ['PersonID','display_name','notes']);
  assert.equal(first.rows.length, 500);
  assert.equal(first.rows[0].PersonID, '1');
  assert.equal(first.hasMore, true);
  const second = await service.exportPeople({ fields: ['notes'], afterId: first.nextAfterId }, ACTOR);
  assert.equal(second.rows.length, 1);
  assert.equal(second.rows[0].PersonID, '501');
  assert.equal(second.hasMore, false);
});

