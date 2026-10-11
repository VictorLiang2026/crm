/**
 * PMC-17 隔离测试：Legacy customers 写路径改道 Person 受控边界。
 *
 * 性质：纯离线 fixture 测试（不触线上、不调真实模型、不读写生产数据库）。
 * 覆盖：
 *  A. customers.update 基础字段改道：
 *     - 基础字段经 PersonService 走 service_role 受控 REST 写 persons（rdb/anon 无写权限）；
 *     - 业务字段仍直写 customers（anon 有 customers DML 权限）；
 *     - 无 person_id 且 legacy 无 Person → 拒绝 PERSON_NOT_LINKED（不静默旧值兜底）；
 *     - OCR 快照 ≥3 字段漂移仍拦截（forceRestore 才放行，且经边界写入）；
 *     - 仅业务字段（profile/stage）→ 不触碰 persons。
 *  B. customers.create：
 *     - 无同名 → resolveName 可用 → 受控 REST 建 Person + customers 关联；
 *     - 多同名 → PERSON_AMBIGUOUS 不自动选择；
 *     - 唯一同名未关联 → 复用该 Person 并仅写非空基础字段。
 *  C. 静态契约：customers/index.js 含 PersonService 边界引用与 PERSON_BASIC_FIELDS 映射；
 *     _shared/person-service.js 导出 updateBasicsWithProjection/createPerson 且写入走
 *     /v1/rdb/rest/persons 受控通道；四份副本一致（见 shared-copy-drift）。
 *
 * 运行：node --test tests/pmc/pmc17-write-boundary.test.cjs
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('module');

const REPO_ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// persons 写入通道（service_role REST）所需环境变量；仅用于离线进程
process.env.TCB_ENV = process.env.TCB_ENV || 'crm-testenv';
process.env.CRM_PERSON360_DB_API_KEY = process.env.CRM_PERSON360_DB_API_KEY || 'offline-person-write-key';

// ---------- 内存 RDB harness（anon 网关：customers DML / persons 仅 SELECT） ----------
const dbTarget = path.join(REPO_ROOT, 'cloudfunctions', 'customers', 'db.js');
const harness = { db: {}, writes: [], restWrites: [] };

class FakeQuery {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.op = 'select';
    this.payload = null;
    this._takeOne = false;
    this._select = null;
  }
  select(cols) { this._select = cols; return this; }
  eq(c, v) { this.filters.push(r => String(r[c]) === String(v)); return this; }
  in(c, values) {
    const set = new Set(values.map(v => String(v)));
    this.filters.push(r => set.has(String(r[c])));
    return this;
  }
  is(c, v) { if (v === null) this.filters.push(r => r[c] == null); return this; }
  limit() { return this; }
  order() { return this; }
  insert(row) { this.op = 'insert'; this.payload = row; return this; }
  update(row) { this.op = 'update'; this.payload = row; return this; }
  maybeSingle() { this._takeOne = true; return this._exec(); }
  then(resolve, reject) { return this._exec().then(resolve, reject); }
  _project(r) {
    if (!this._select) return { ...r };
    const cols = String(this._select).split(',').map(s => s.trim());
    const out = {};
    for (const c of cols) if (c in r) out[c] = r[c];
    return out;
  }
  async _exec() {
    const rows = harness.db[this.table] || (harness.db[this.table] = []);
    if (this.op === 'insert') {
      const row = { id: rows.length + 1, ...this.payload };
      if (this.table === 'customers') { row.Id = rows.length + 100; delete row.id; }
      rows.push(row);
      harness.writes.push({ table: this.table, op: 'insert', payload: this.payload });
      return { data: [this.table === 'customers' ? { Id: row.Id } : { id: row.id }] };
    }
    if (this.op === 'update') {
      const updated = [];
      for (const r of rows) {
        if (this.filters.every(f => f(r))) { Object.assign(r, this.payload); updated.push(r); }
      }
      harness.writes.push({ table: this.table, op: 'update', payload: this.payload, n: updated.length });
      return { data: updated.map(r => this._project(r)) };
    }
    const out = rows.filter(r => this.filters.every(f => f(r)));
    if (this._takeOne) return { data: out[0] ? this._project(out[0]) : null };
    return { data: out.map(r => this._project(r)) };
  }
}

const stubRdb = { from: t => new FakeQuery(t.replace(/^public\./, '')), rpc: () => Promise.resolve({ data: [] }) };
function assertOk(res) { if (res && res.error) throw new Error(res.error.message || String(res.error)); return res; }
function normFields(data, allowed) {
  const out = {};
  for (const f of allowed) if (Object.prototype.hasOwnProperty.call(data, f)) {
    let v = data[f];
    if (v === '') v = null;
    out[f] = v;
  }
  return out;
}
const stubDb = { rdb: stubRdb, assertOk, normFields, nowIso: () => '2026-10-10T00:00:00.000Z' };

// ---------- service_role PostgREST 通道的内存模拟（仅 persons） ----------
function matchRestFilter(key, cond, row) {
  const [op, value] = String(cond).split('.');
  if (key === 'id' && op === 'eq') return String(row.id) === value;
  if (key === 'updated_at' && op === 'eq') return String(row.updated_at) === value;
  if (key === 'deleted_at' && op === 'is' && value === 'null') return row.deleted_at == null;
  throw new Error('unsupported offline rest filter: ' + key + '=' + cond);
}
const origFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const u = new URL(url);
  if (!u.pathname.endsWith('/v1/rdb/rest/persons')) {
    throw new Error('offline fetch only emulates persons REST, got: ' + u.pathname);
  }
  if (options.headers.Authorization !== `Bearer ${process.env.CRM_PERSON360_DB_API_KEY}`) {
    throw new Error('offline fetch requires the service_role bearer key');
  }
  const rows = harness.db.persons || (harness.db.persons = []);
  const body = JSON.parse(options.body || '{}');
  if (options.method === 'POST') {
    const id = rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
    const row = {
      id, created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), deleted_at: null, ...body,
    };
    rows.push(row);
    harness.restWrites.push({ op: 'POST', payload: body });
    return new Response(JSON.stringify([row]), { status: 201, headers: { 'Content-Type': 'application/json' } });
  }
  if (options.method === 'PATCH') {
    const out = [];
    for (const r of rows) {
      if ([...u.searchParams.entries()].every(([k, c]) => matchRestFilter(k, c, r))) {
        Object.assign(r, body);
        out.push({ ...r });
      }
    }
    harness.restWrites.push({
      op: 'PATCH', filters: [...u.searchParams.entries()], payload: body, n: out.length,
    });
    return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  throw new Error('offline fetch unsupported method: ' + options.method);
};
test.after(() => { globalThis.fetch = origFetch; });

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent); } catch (e) { resolved = null; }
  if (resolved && path.resolve(resolved) === dbTarget) return stubDb;
  return origLoad.call(this, request, parent, isMain);
};
const customersFn = require(path.join(REPO_ROOT, 'cloudfunctions', 'customers', 'index.js'));

function linkedFixture() {
  harness.writes = [];
  harness.restWrites = [];
  harness.db.persons = [{
    id: 11, display_name: '张三', name_key: '张三', phone: '13800000000', wechat: 'zs-wx',
    gender: '男', birthday: '1990-01-01', occupation: '工程师', education: '本科',
    deleted_at: null, updated_at: '2026-10-01T00:00:00Z',
  }];
  harness.db.customers = [{
    Id: 101, person_id: 11, customer_stage: 'A', deleted_at: null,
  }];
}

// ---------- A. update 改道 ----------
test('A1 基础字段经受控 REST 写 persons；业务字段直写 customers', async () => {
  linkedFixture();
  const res = await customersFn.main({
    action: 'update', id: 101,
    data: { phone: '13822222222', customer_stage: 'B' },
  });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.personUpdated, true);
  assert.equal(harness.db.persons[0].phone, '13822222222', 'persons 权威已更新');
  assert.equal(harness.db.customers[0].customer_stage, 'B', '业务字段直写');
  assert.equal(harness.restWrites.length, 1);
  assert.equal(harness.restWrites[0].op, 'PATCH');
  assert.equal(harness.writes.some(w => w.table === 'persons'), false, 'persons 不得再走 anon rdb 写');
});

test('A2 无关联 Person → 拒绝 PERSON_NOT_LINKED，不写任何表', async () => {
  harness.writes = [];
  harness.restWrites = [];
  harness.db.persons = [];
  harness.db.customers = [{ Id: 102, customer_name: '无Person', person_id: null, deleted_at: null }];
  const res = await customersFn.main({ action: 'update', id: 102, data: { phone: '138' } });
  assert.equal(res.code, 'PERSON_NOT_LINKED');
  assert.equal(harness.writes.length, 0, '不得静默写 customers 兜底');
  assert.equal(harness.restWrites.length, 0, '不得写 persons');
});

test('A3 OCR 快照 ≥3 字段漂移仍拦截；forceRestore 经边界写入', async () => {
  linkedFixture();
  const snap = { customer_name: '张三', phone: '13811111111', occupation: '经理', gender: '男' };
  const res1 = await customersFn.main({ action: 'update', id: 101, data: { ...snap } });
  assert.equal(res1.error, 'OCR_SNAPSHOT_RESTORE_CONFLICT');
  assert.deepEqual(res1.conflicts.sort(), ['occupation', 'phone']);
  assert.equal(harness.db.persons[0].phone, '13800000000', 'persons 未被改写');
  assert.equal(harness.restWrites.length, 0, '冲突时不得写 persons');
  const res2 = await customersFn.main({ action: 'update', id: 101, data: { ...snap }, forceRestore: true });
  assert.equal(res2.ok, true, JSON.stringify(res2));
  assert.equal(harness.db.persons[0].phone, '13811111111', '快照值经受控通道入 persons');
  assert.equal(harness.db.persons[0].occupation, '经理');
});

test('A3b 人工表单编辑 editSource:"form" 跳过 OCR 守卫；无标志仍拦截', async () => {
  linkedFixture();
  // admin 编辑表单载荷：5 个基础字段全量提交（与 persons 当前值一致，仅 occupation 漂移）
  const formPayload = {
    customer_name: '张三', phone: '13800000000', gender: '男', birthday: '1990-01-01',
    occupation: '新职业', customer_stage: 'B',
  };
  const blocked = await customersFn.main({ action: 'update', id: 101, data: { ...formPayload } });
  assert.equal(blocked.error, 'OCR_SNAPSHOT_RESTORE_CONFLICT', JSON.stringify(blocked));
  assert.deepEqual(blocked.conflicts, ['occupation']);
  assert.equal(harness.restWrites.length, 0, '未放行时不得写 persons');
  const res = await customersFn.main({ action: 'update', id: 101, data: { ...formPayload }, editSource: 'form' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.personUpdated, true);
  assert.equal(harness.db.persons[0].occupation, '新职业', '表单编辑经边界写入');
  assert.equal(harness.db.customers[0].customer_stage, 'B', '业务字段直写');
  assert.equal(harness.restWrites.length, 1);
});

test('A4 仅业务字段（profile）→ 不触碰 persons', async () => {
  linkedFixture();
  const res = await customersFn.main({
    action: 'update', id: 101, data: { profile: { family: { spouse: true } } },
  });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.personUpdated, undefined);
  assert.deepEqual(harness.db.persons[0].occupation, '工程师', 'persons 未动');
  assert.equal(harness.restWrites.length, 0);
  assert.ok(harness.db.customers[0].profile, 'profile 已写');
});

// ---------- B. create 改道 ----------
test('B1 无同名 → resolveName available → 受控 REST 建 Person + customers 关联', async () => {
  harness.writes = [];
  harness.restWrites = [];
  harness.db.persons = [];
  harness.db.customers = [];
  const res = await customersFn.main({
    action: 'create',
    data: { customer_name: '李雷', phone: '13900000000', customer_stage: 'C' },
  });
  assert.equal(res.error, undefined, JSON.stringify(res));
  assert.ok(res.id, 'customerId');
  assert.ok(res.personId, 'personId');
  assert.equal(harness.db.persons.length, 1);
  assert.equal(harness.db.persons[0].display_name, '李雷');
  assert.equal(harness.db.persons[0].source, '客户建档');
  assert.equal(harness.restWrites[0].op, 'POST');
  assert.equal(String(harness.db.customers[0].person_id), String(res.personId));
  assert.equal(harness.db.customers[0].customer_stage, 'C');
});

test('B2 多同名 → PERSON_AMBIGUOUS，不自动选择', async () => {
  harness.writes = [];
  harness.restWrites = [];
  harness.db.persons = [
    { id: 21, display_name: '韩梅梅', name_key: '韩梅梅', organization: null, occupation: null, deleted_at: null },
    { id: 22, display_name: '韩梅梅（城南）', name_key: '韩梅梅', organization: null, occupation: null, deleted_at: null },
  ];
  harness.db.customers = [];
  const res = await customersFn.main({ action: 'create', data: { customer_name: '韩梅梅' } });
  assert.equal(res.code, 'PERSON_AMBIGUOUS');
  assert.equal(harness.db.customers.length, 0, '不得建客户');
  assert.equal(harness.restWrites.length, 0, '不得写 persons');
});

test('B3 唯一同名未关联 → 复用 Person，仅写非空基础字段', async () => {
  harness.writes = [];
  harness.restWrites = [];
  harness.db.persons = [{
    id: 31, display_name: '赵六', name_key: '赵六', phone: '13700000000',
    occupation: '医生', deleted_at: null, updated_at: '2026-10-01T00:00:00Z',
  }];
  harness.db.customers = [];
  const res = await customersFn.main({
    action: 'create',
    data: { customer_name: '赵六', occupation: '' }, // 空值不覆盖既有 occupation
  });
  assert.equal(res.error, undefined, JSON.stringify(res));
  assert.equal(String(res.personId), '31');
  assert.equal(harness.db.persons[0].occupation, '医生', '空 occupation 不覆盖既有值');
  assert.equal(harness.restWrites.length, 1, '姓名作为非空基础字段仍写回');
  assert.equal(harness.restWrites[0].op, 'PATCH');
  assert.equal(harness.restWrites[0].payload.display_name, '赵六');
  assert.equal(Object.prototype.hasOwnProperty.call(harness.restWrites[0].payload, 'occupation'), false);
  assert.equal(String(harness.db.customers[0].person_id), '31');
});

// ---------- C. 静态契约 ----------
test('C1 customers/index.js 边界引用与映射存在', () => {
  const src = read('cloudfunctions/customers/index.js');
  assert.match(src, /require\('\.\/person-service'\)/);
  assert.match(src, /PERSON_BASIC_FIELDS/);
  assert.match(src, /updateBasicsWithProjection/);
  assert.match(src, /PERSON_NOT_LINKED/);
  assert.match(src, /createPerson/);
});

test('C2 _shared/person-service.js 导出受控写入方法且写 persons 走 service_role REST', () => {
  const src = read('cloudfunctions/_shared/person-service.js');
  assert.match(src, /updateBasicsWithProjection/);
  assert.match(src, /createPerson/);
  assert.match(src, /BASIC_WRITABLE_FIELDS/);
  assert.match(src, /CRM_PERSON360_DB_API_KEY/);
  assert.match(src, /v1\/rdb\/rest\/persons/);
  assert.doesNotMatch(src, /rdb\.from\('persons'\)\.(update|insert)/);
});
