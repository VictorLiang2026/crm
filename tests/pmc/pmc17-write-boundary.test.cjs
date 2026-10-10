/**
 * PMC-17 隔离测试：Legacy customers 写路径改道 Person 受控边界。
 *
 * 性质：纯离线 fixture 测试（不触线上、不调真实模型、不读写生产数据库）。
 * 覆盖：
 *  A. customers.update 基础字段改道：
 *     - 基础字段经 PersonService 写 persons + 投影回写 customers（业务字段直写）；
 *     - 无 person_id 且 legacy 无 Person → 拒绝 PERSON_NOT_LINKED（不静默旧值兜底）；
 *     - OCR 快照 ≥3 字段漂移仍拦截（forceRestore 才放行，且经边界写入）；
 *     - 仅业务字段（profile/stage）→ 不触碰 persons。
 *  B. customers.create：
 *     - 无同名 → resolveName 可用 → 建 Person + 客户 + 双向关联；
 *     - 多同名 → PERSON_AMBIGUOUS 不自动选择；
 *     - 唯一同名未关联 → 复用该 Person 并仅写非空基础字段。
 *  C. 静态契约：customers/index.js 含 PersonService 边界引用与 PERSON_BASIC_FIELDS 映射；
 *     _shared/person-service.js 导出 updateBasicsWithProjection；三份副本一致（见 shared-copy-drift）。
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

// ---------- 内存 RDB harness ----------
const dbTarget = path.join(REPO_ROOT, 'cloudfunctions', 'customers', 'db.js');
const harness = { db: {}, writes: [] };

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
  harness.db.persons = [{
    id: 11, display_name: '张三', name_key: '张三', phone: '13800000000', wechat: 'zs-wx',
    gender: '男', birthday: '1990-01-01', occupation: '工程师', education: '本科',
    legacy_customer_id: 101, deleted_at: null, updated_at: '2026-10-01T00:00:00Z',
  }];
  harness.db.customers = [{
    Id: 101, person_id: 11, customer_name: '张三', phone: '13800000000', wx_account: 'zs-wx',
    gender: '男', birthday: '1990-01-01', occupation: '工程师', education: '本科',
    customer_stage: 'A', deleted_at: null,
  }];
}

// ---------- A. update 改道 ----------
test('A1 基础字段经边界写 persons+投影回写；业务字段直写', async () => {
  linkedFixture();
  const res = await customersFn.main({
    action: 'update', id: 101,
    data: { phone: '13822222222', customer_stage: 'B' },
  });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.personUpdated, true);
  assert.equal(harness.db.persons[0].phone, '13822222222', 'persons 权威已更新');
  assert.equal(harness.db.customers[0].phone, '13822222222', 'customers 投影一致');
  assert.equal(harness.db.customers[0].customer_stage, 'B', '业务字段直写');
});

test('A2 无关联 Person → 拒绝 PERSON_NOT_LINKED，不写任何表', async () => {
  harness.writes = [];
  harness.db.persons = [];
  harness.db.customers = [{ Id: 102, customer_name: '无Person', deleted_at: null }];
  const res = await customersFn.main({ action: 'update', id: 102, data: { phone: '138' } });
  assert.equal(res.code, 'PERSON_NOT_LINKED');
  assert.equal(harness.writes.length, 0, '不得静默写 customers 兜底');
});

test('A3 OCR 快照 ≥3 字段漂移仍拦截；forceRestore 经边界写入', async () => {
  linkedFixture();
  const snap = { customer_name: '张三', phone: '13811111111', occupation: '经理', gender: '男' };
  const res1 = await customersFn.main({ action: 'update', id: 101, data: { ...snap } });
  assert.equal(res1.error, 'OCR_SNAPSHOT_RESTORE_CONFLICT');
  assert.deepEqual(res1.conflicts.sort(), ['occupation', 'phone']);
  assert.equal(harness.db.persons[0].phone, '13800000000', 'persons 未被改写');
  const res2 = await customersFn.main({ action: 'update', id: 101, data: { ...snap }, forceRestore: true });
  assert.equal(res2.ok, true, JSON.stringify(res2));
  assert.equal(harness.db.persons[0].phone, '13811111111', '快照值经边界入 persons');
  assert.equal(harness.db.customers[0].phone, '13811111111', '投影一致');
});

test('A4 仅业务字段（profile）→ 不触碰 persons', async () => {
  linkedFixture();
  const res = await customersFn.main({
    action: 'update', id: 101, data: { profile: { family: { spouse: true } } },
  });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.personUpdated, undefined);
  assert.deepEqual(harness.db.persons[0].occupation, '工程师', 'persons 未动');
  assert.ok(harness.db.customers[0].profile, 'profile 已写');
});

// ---------- B. create 改道 ----------
test('B1 无同名 → resolveName available → 建 Person+客户+双向关联', async () => {
  harness.writes = [];
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
  assert.equal(harness.db.persons[0].legacy_customer_id, res.id, 'persons.legacy 回写');
  assert.equal(String(harness.db.customers[0].person_id), String(res.personId));
  assert.equal(harness.db.customers[0].customer_stage, 'C');
});

test('B2 多同名 → PERSON_AMBIGUOUS，不自动选择', async () => {
  harness.writes = [];
  harness.db.persons = [
    { id: 21, display_name: '韩梅梅', name_key: '韩梅梅', legacy_customer_id: null, deleted_at: null },
    { id: 22, display_name: '韩梅梅（城南）', name_key: '韩梅梅', legacy_customer_id: null, deleted_at: null },
  ];
  harness.db.customers = [];
  const res = await customersFn.main({ action: 'create', data: { customer_name: '韩梅梅' } });
  assert.equal(res.code, 'PERSON_AMBIGUOUS');
  assert.equal(harness.db.customers.length, 0, '不得建客户');
});

test('B3 唯一同名未关联 → 复用 Person，仅写非空基础字段', async () => {
  harness.writes = [];
  harness.db.persons = [{
    id: 31, display_name: '赵六', name_key: '赵六', phone: '13700000000',
    occupation: '医生', legacy_customer_id: null, deleted_at: null, updated_at: '2026-10-01T00:00:00Z',
  }];
  harness.db.customers = [];
  const res = await customersFn.main({
    action: 'create',
    data: { customer_name: '赵六', occupation: '' }, // 空值不覆盖既有 occupation
  });
  assert.equal(res.error, undefined, JSON.stringify(res));
  assert.equal(String(res.personId), '31');
  assert.equal(harness.db.persons[0].occupation, '医生', '空值不覆盖既有值');
  assert.equal(harness.db.persons[0].legacy_customer_id, res.id);
});

// ---------- C. 静态契约 ----------
test('C1 customers/index.js 边界引用与映射存在', () => {
  const src = read('cloudfunctions/customers/index.js');
  assert.match(src, /require\('\.\/person-service'\)/);
  assert.match(src, /PERSON_BASIC_FIELDS/);
  assert.match(src, /updateBasicsWithProjection/);
  assert.match(src, /PERSON_NOT_LINKED/);
});

test('C2 _shared/person-service.js 导出受控写入方法', () => {
  const src = read('cloudfunctions/_shared/person-service.js');
  assert.match(src, /updateBasicsWithProjection/);
  assert.match(src, /BASIC_WRITABLE_FIELDS/);
  assert.match(src, /PROJECTION_FAILED/);
});
