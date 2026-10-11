'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PersonService, parsePersonName } = require('../../cloudfunctions/_shared/person-service');

process.env.TCB_ENV = process.env.TCB_ENV || 'crm-testenv';
process.env.CRM_PERSON360_DB_API_KEY = process.env.CRM_PERSON360_DB_API_KEY || 'offline-person-write-key';

function fixture(personRows = [], customerRows = [], error = null) {
  const calls = [];
  const db = { persons: personRows, customers: customerRows };
  const rdb = { from(table) {
    const call = { table: table.replace(/^public\./, ''), filters: {}, limit: null, inList: null };
    calls.push(call);
    return {
      select(fields) { call.fields = fields; return this; },
      eq(field, value) { call.filters[field] = value; return this; },
      in(field, values) { call.inList = { field, values: values.map(String) }; return this; },
      is(field, value) { call.filters[field] = value; return this; },
      order(field, options) { call.order = { field, options }; return this; },
      limit(value) { call.limit = value; return this; },
      then(resolve, reject) {
        let rows = db[call.table] || [];
        if (call.inList) {
          const set = new Set(call.inList.values);
          rows = rows.filter(row => set.has(String(row[call.inList.field])));
        }
        const data = rows.filter(row => {
          if (call.filters.name_key !== undefined && row.name_key !== call.filters.name_key) return false;
          if (call.filters.deleted_at === null && row.deleted_at != null) return false;
          if (call.filters.id !== undefined && String(row.id) !== String(call.filters.id)) return false;
          return true;
        }).slice(0, call.limit ?? rows.length).map(row => Object.fromEntries(
          call.fields.split(',').map(s => s.trim())
            .filter(field => Object.hasOwn(row, field)).map(field => [field, row[field]])));
        return Promise.resolve(error ? { data: [], error } : { data, error: null }).then(resolve, reject);
      },
    };
  } };
  return { service: new PersonService({ rdb }), calls, db, rdb };
}

// service_role REST 通道内存模拟
function installRestFetch(store) {
  const original = globalThis.fetch;
  const received = [];
  globalThis.fetch = async (url, options) => {
    const u = new URL(url);
    assert.ok(u.pathname.endsWith('/v1/rdb/rest/persons'));
    assert.equal(options.headers.Authorization, `Bearer ${process.env.CRM_PERSON360_DB_API_KEY}`);
    const body = JSON.parse(options.body || '{}');
    received.push({ method: options.method, params: [...u.searchParams.entries()], body });
    if (options.method === 'POST') {
      const id = store.rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
      const row = { id, deleted_at: null, updated_at: '2026-10-11T00:00:00.000Z', ...body };
      store.rows.push(row);
      return new Response(JSON.stringify([row]), { status: 201 });
    }
    const out = [];
    for (const row of store.rows) {
      const hit = [...u.searchParams.entries()].every(([k, cond]) => {
        const [op, value] = String(cond).split('.');
        if (k === 'id' && op === 'eq') return String(row.id) === value;
        if (k === 'updated_at' && op === 'eq') return String(row.updated_at) === value;
        if (k === 'deleted_at' && op === 'is' && value === 'null') return row.deleted_at == null;
        throw new Error('unexpected filter ' + k);
      });
      if (hit) { Object.assign(row, body); out.push({ ...row }); }
    }
    return new Response(JSON.stringify(out), { status: 200 });
  };
  return { received, restore() { globalThis.fetch = original; } };
}

const person = (id, displayName, nameKey = '张玮') => ({
  id, display_name: displayName, name_key: nameKey, organization: null,
  occupation: null, deleted_at: null,
});

test('name_key strips only trailing qualifiers and normalizes spaces', () => {
  assert.deepEqual(parsePersonName(' 张玮（电信） '), {
    displayName: '张玮（电信）', nameKey: '张玮', qualifierKey: '电信', hasQualifier: true,
  });
  assert.equal(parsePersonName('张玮(电信)').nameKey, '张玮');
  assert.equal(parsePersonName('张　玮（电信）（朋友）').nameKey, '张 玮');
  assert.equal(parsePersonName('王（小）明').nameKey, '王（小）明');
  assert.throws(() => parsePersonName('（电信）'), error => error.code === 'INVALID_NAME');
  assert.throws(() => parsePersonName('张玮（电信'), error => error.code === 'INVALID_NAME');
  assert.throws(() => parsePersonName('张玮（）'), error => error.code === 'INVALID_NAME');
});

test('zero results allow a new person without selecting an identity', async () => {
  const { service, calls } = fixture();
  const result = await service.resolveName('张玮（电信）');
  assert.equal(result.status, 'available');
  assert.equal(result.canCreate, true);
  assert.equal(result.selectedPersonId, null);
  assert.equal(calls[0].table, 'persons');
  assert.equal(calls[0].filters.name_key, '张玮');
  assert.equal(calls[0].fields, 'id,display_name,name_key,organization,occupation');
});

test('one result always needs human confirmation, even with a different qualifier', async () => {
  const { service } = fixture([person(1, '张玮（电信）')]);
  for (const input of ['张玮', '张玮（银行）']) {
    const result = await service.resolveName(input);
    assert.equal(result.status, 'confirm_existing');
    assert.equal(result.requiresHumanDecision, true);
    assert.equal(result.canCreate, false);
    assert.equal(result.selectedPersonId, null);
    assert.deepEqual(result.candidates.map(candidate => candidate.id), ['1']);
    assert.equal(result.canCreateAfterConfirmation, input === '张玮（银行）');
  }
});

test('multiple results require choice or qualifier; a qualifier never auto-selects', async () => {
  const { service } = fixture([person(1, '张玮（电信）'), person(2, '张玮(银行)')]);
  const plain = await service.resolveName('张玮');
  assert.equal(plain.status, 'choose_or_qualify');
  assert.equal(plain.selectedPersonId, null);
  const matched = await service.resolveName('张玮（银行）');
  assert.equal(matched.status, 'confirm_qualified_match');
  assert.deepEqual(matched.qualifierMatches, ['2']);
  assert.equal(matched.selectedPersonId, null);
  const newQualified = await service.resolveName('张玮（学校）');
  assert.equal(newQualified.status, 'confirm_new_qualified');
  assert.equal(newQualified.canCreate, false);
  assert.equal(newQualified.canCreateAfterConfirmation, true);
  assert.equal(newQualified.selectedPersonId, null);
});

test('truncated or duplicate-qualifier results remain ambiguous', async () => {
  const many = Array.from({ length: 12 }, (_, i) => person(i + 1, `张玮（${i + 1}）`));
  const { service } = fixture(many);
  const result = await service.resolveName('张玮（12）');
  assert.equal(result.status, 'choose_or_qualify');
  assert.equal(result.hasMore, true);
  assert.equal(result.candidates.length, 10);
  const duplicate = fixture([person(1, '张玮（电信）'), person(2, '张玮(电信)')]);
  assert.equal((await duplicate.service.resolveName('张玮（电信）')).status, 'choose_or_qualify');
});

test('deleted records are excluded and read failures fail closed', async () => {
  const deleted = person(1, '张玮（电信）');
  deleted.deleted_at = '2026-09-25';
  assert.equal((await fixture([deleted]).service.resolveName('张玮')).status, 'available');
  await assert.rejects(fixture([], [], { message: 'denied' }).service.resolveName('张玮'),
    error => error.code === 'READ_FAILED');
  assert.throws(() => new PersonService(), error => error.code === 'INVALID_CONFIG');
  const inconsistent = fixture([person(1, '另一人', '张玮')]);
  await assert.rejects(inconsistent.service.resolveName('张玮'), error => error.code === 'READ_FAILED');
});

// ---------- service_role 受控写通道（WP072） ----------
test('createPerson POSTs whitelisted fields and returns id', async () => {
  const rows = [];
  const rest = installRestFetch({ rows });
  try {
    const svc = new PersonService({ rdb: fixture().rdb });
    const out = await svc.createPerson({
      display_name: '李雷', name_key: '李雷', phone: '139', occupation: '', source: '客户建档',
    });
    assert.equal(out.id, '1');
    assert.equal(rest.received[0].method, 'POST');
    assert.equal(rest.received[0].body.phone, '139');
    assert.equal(rest.received[0].body.occupation, null, '空串转 null');
    assert.equal(rest.received[0].body.source, '客户建档');
    await assert.rejects(svc.createPerson({ display_name: 'x', name_key: 'x', id: 9 }),
      e => e.code === 'FIELD_NOT_ALLOWED');
    await assert.rejects(svc.createPerson({ name_key: 'x' }),
      e => e.code === 'INVALID_PAYLOAD');
  } finally { rest.restore(); }
});

test('updateBasicsWithProjection writes via REST and reports lock conflicts', async () => {
  const rows = [{
    id: 11, display_name: '张三', name_key: '张三', occupation: '工程师',
    deleted_at: null, updated_at: '2026-10-01T00:00:00Z',
  }];
  const rest = installRestFetch({ rows });
  try {
    const { service } = fixture(rows);
    const ok = await service.updateBasicsWithProjection(11, { occupation: '经理' }, {});
    assert.equal(ok.ok, true);
    assert.equal(rest.received[0].method, 'PATCH');
    assert.deepEqual(rest.received[0].params.filter(p => p[0] !== 'deleted_at'),
      [['id', 'eq.11']]);
    assert.equal(rows[0].occupation, '经理');
    // 乐观锁版本号不匹配 → 0 行 conflict，不抛异常
    const stale = await service.updateBasicsWithProjection(11,
      { occupation: '总监' }, { expectedUpdatedAt: '2000-01-01T00:00:00Z' });
    assert.equal(stale.ok, false);
    assert.equal(stale.conflict, true);
    // 白名单外字段拒绝
    await assert.rejects(
      service.updateBasicsWithProjection(11, { id: 11 }, {}),
      e => e.code === 'FIELD_NOT_ALLOWED');
  } finally { rest.restore(); }
});

test('write channel refuses without service key', async () => {
  const saved = process.env.CRM_PERSON360_DB_API_KEY;
  delete process.env.CRM_PERSON360_DB_API_KEY;
  try {
    const { service } = fixture([{ id: 11, display_name: '张三', name_key: '张三', deleted_at: null }]);
    await assert.rejects(service.createPerson({ display_name: 'a', name_key: 'a' }),
      e => e.code === 'INVALID_CONFIG');
  } finally { process.env.CRM_PERSON360_DB_API_KEY = saved; }
});
