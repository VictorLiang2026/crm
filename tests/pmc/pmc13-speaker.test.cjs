/**
 * PMC-13 隔离测试：活动嘉宾资源池身份归一（Person 优先）+ create 解耦客户自动建档。
 *
 * 性质：纯离线 fixture 测试（不触线上、不调真实模型、不读写数据库）。
 * 做法：拦截 cloudfunctions/activity_speakers/db.js 本地副本，注入内存 RDB，
 *       直接运行真实 index.js main()，断言：
 *   1) enrichIdentity（裁决①）：name/phone/wechat/organization 从 Person 优先读，
 *      person 有值时覆盖原值，person_id 缺失时回退原值；
 *      新增 linked_person={id,name} 字段；linked_customer/linked_recruit 保持不变；
 *   2) create（裁决②）：去掉自动建 Person+customers 分支，只写 activity_speakers 行；
 *      未传 customer_id 返回 customer_id:null；不调用 customers/persons 表 insert；
 *   3) ai_activity 静态检查（裁决③）：嘉宾参与者 name 与 recommendTopics 嘉宾池 name
 *      均从 Person 优先读（persons.select + display_name + person_id 覆盖逻辑）。
 *
 * 运行：node --test tests/pmc/pmc13-speaker.test.cjs
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('module');

const REPO_ROOT = path.resolve(__dirname, '../..');
const FN_DIR = 'activity_speakers';
const dbTarget = path.join(REPO_ROOT, 'cloudfunctions', FN_DIR, 'db.js');
const dbTargets = new Set([dbTarget]);
const AI_ACTIVITY = path.join(REPO_ROOT, 'cloudfunctions', 'ai_activity', 'index.js');

// ---------- 内存 RDB ----------
const harness = { db: {}, calls: [], queue: [], rpcs: [], inserts: [] };

class FakeQuery {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.orders = [];
    this.limitN = null;
    this.op = 'select';
    this.payload = null;
    this._takeOne = false;
  }
  select() { return this; }
  eq(c, v) { this.filters.push(r => r[c] === v); return this; }
  neq(c, v) { this.filters.push(r => r[c] !== v); return this; }
  is(c, v) { if (v === null) this.filters.push(r => r[c] == null); return this; }
  in(c, vals) {
    const arr = Array.isArray(vals) ? vals : [vals];
    this.filters.push(r => arr.indexOf(r[c]) >= 0);
    return this;
  }
  or() { return this; } // 本轮不验证关键词模糊搜索，保留链式兼容
  order(c) { this.orders.push(c); return this; }
  limit(n) { this.limitN = n; return this; }
  maybeSingle() { this._takeOne = true; return this._exec(); }
  single() { this._takeOne = true; return this._exec(); }
  insert(row) { this.op = 'insert'; this.payload = row; return this; }
  update(row) { this.op = 'update'; this.payload = row; return this; }
  then(resolve, reject) { return this._exec().then(resolve, reject); }
  async _exec() {
    const rows = harness.db[this.table] || (harness.db[this.table] = []);
    if (this.op === 'insert') {
      harness.inserts.push({ table: this.table, payload: this.payload });
      const id = Math.max(1000, ...rows.map(r => Number(r.id) || 0)) + 1;
      const stored = Object.assign({ id }, this.payload);
      rows.push(stored);
      const ret = { id };
      return { data: this._takeOne ? ret : [ret] };
    }
    if (this.op === 'update') {
      const updated = [];
      for (const r of rows) {
        if (this.filters.every(f => f(r))) { Object.assign(r, this.payload); updated.push(r); }
      }
      return { data: updated.map(r => ({ id: r.id })) };
    }
    let out = rows.filter(r => this.filters.every(f => f(r)));
    if (this.orders.length) out = out.slice();
    if (this.limitN != null) out = out.slice(0, this.limitN);
    return { data: this._takeOne ? (out[0] || null) : out };
  }
}

const stubRdb = {
  from: t => new FakeQuery(t),
  rpc(name, args) {
    harness.rpcs.push({ name, args });
    return Promise.resolve({ data: [{ ok: true }] });
  },
};

function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  try { return JSON.parse(s); } catch (e) { return null; }
}
function assertOk(res) {
  if (res && res.error) throw new Error(res.error.message || String(res.error));
  return res;
}
function normFields(data, allowed) {
  const out = {};
  for (const f of allowed) if (Object.prototype.hasOwnProperty.call(data, f)) {
    let v = data[f];
    if (v === '') v = null;
    out[f] = v;
  }
  return out;
}
function nowIso() { return '2026-10-09T00:00:00.000Z'; }

const stubDb = {
  app: { __stub: 'pmc13' }, rdb: stubRdb,
  extractJson, assertOk, normFields, nowIso,
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent); } catch (e) { resolved = null; }
  if (resolved && dbTargets.has(path.resolve(resolved))) return stubDb;
  return origLoad.call(this, request, parent, isMain);
};

const speakerFn = require(path.join(REPO_ROOT, 'cloudfunctions', FN_DIR, 'index.js'));

// ---------- Fixture ----------
// 101：有 person_id（Person 字段≠原值，验证 Person 优先覆盖）
// 102：无 person_id（验证原值回退 + linked_person=null）
function baseDb() {
  return {
    activity_speakers: [
      {
        id: 101, person_id: 783, customer_id: null, recruit_candidate_id: null,
        name: '旧名', phone: 'oldphone', wechat: 'oldwx', organization: '旧机构',
        status: 'active', relationship_stage: 'new', deleted_at: null,
        updated_at: '2026-10-08T00:00:00Z',
      },
      {
        id: 102, person_id: null, customer_id: null, recruit_candidate_id: null,
        name: '独立嘉宾', phone: '13900001234', wechat: 'wx_indep', organization: '独立机构',
        status: 'active', relationship_stage: 'contacted', deleted_at: null,
        updated_at: '2026-10-09T00:00:00Z',
      },
    ],
    persons: [
      {
        id: 783, display_name: 'PersonName', phone: '13800000000', wechat: 'person_wx',
        organization: 'Person机构', occupation: '顾问', deleted_at: null,
      },
    ],
    customers: [],
    v_recruit_candidates: [],
  };
}

// ---------- 1. enrichIdentity：Person 优先读基础信息 ----------
test('T1 enrichIdentity: name 从 Person 优先读（person.display_name 覆盖 speaker.name）', async () => {
  harness.db = baseDb();
  const res = await speakerFn.main({ action: 'list' });
  const s101 = res.rows.find(r => r.id === 101);
  assert.ok(s101, 'list 返回 speaker 101');
  assert.equal(s101.name, 'PersonName', 'name 取 person.display_name 而非旧名');
});

test('T2 enrichIdentity: phone/wechat/organization 从 Person 优先读（覆盖原值）', async () => {
  harness.db = baseDb();
  const res = await speakerFn.main({ action: 'list' });
  const s101 = res.rows.find(r => r.id === 101);
  assert.equal(s101.phone, '13800000000', 'phone 取 person.phone');
  assert.equal(s101.wechat, 'person_wx', 'wechat 取 person.wechat');
  assert.equal(s101.organization, 'Person机构', 'organization 取 person.organization');
});

test('T3 enrichIdentity: person_id 为空时回退原值（name/phone/wechat/organization 用原值）', async () => {
  harness.db = baseDb();
  const res = await speakerFn.main({ action: 'list' });
  const s102 = res.rows.find(r => r.id === 102);
  assert.ok(s102, 'list 返回 speaker 102');
  assert.equal(s102.name, '独立嘉宾', 'name 回退原值');
  assert.equal(s102.phone, '13900001234', 'phone 回退原值');
  assert.equal(s102.wechat, 'wx_indep', 'wechat 回退原值');
  assert.equal(s102.organization, '独立机构', 'organization 回退原值');
});

test('T4 enrichIdentity: 返回 linked_person 字段（有 person_id 非空，无则 null）', async () => {
  harness.db = baseDb();
  const res = await speakerFn.main({ action: 'list' });
  const s101 = res.rows.find(r => r.id === 101);
  const s102 = res.rows.find(r => r.id === 102);
  assert.ok(s101.linked_person, '有 person_id 时 linked_person 非空');
  assert.equal(s101.linked_person.id, 783, 'linked_person.id = person_id');
  assert.equal(s101.linked_person.name, 'PersonName', 'linked_person.name = display_name');
  assert.equal(s101.linked_customer, null, '无 customer_id 时 linked_customer=null（保留原语义）');
  assert.equal(s101.linked_recruit, null, '无 recruit_candidate_id 时 linked_recruit=null');
  assert.equal(s102.linked_person, null, '无 person_id 时 linked_person=null');
});

// ---------- 2. create：解耦客户自动建档 ----------
test('T5 create: 不自动建客户（无 customers/persons 表 insert 调用，只写 activity_speakers）', async () => {
  harness.db = baseDb();
  harness.inserts = [];
  const res = await speakerFn.main({ action: 'create', data: { name: '新嘉宾', phone: '13800001235' } });
  assert.ok(res.id, 'create 返回 id');
  const tables = harness.inserts.map(i => i.table);
  assert.ok(tables.includes('activity_speakers'), '写入 activity_speakers 表');
  assert.ok(!tables.includes('customers'), '不写 customers 表（无自动建客户）');
  assert.ok(!tables.includes('persons'), '不写 persons 表（无自动建 Person）');
});

test('T6 create: 未传 customer_id 时返回 customer_id 为 null', async () => {
  harness.db = baseDb();
  const res = await speakerFn.main({ action: 'create', data: { name: '新嘉宾' } });
  assert.ok(res.id, 'create 返回 id');
  assert.ok(res.customer_id == null, '未传 customer_id 时返回 customer_id 为 null');
});

test('T7 create: 传入 customer_id 时正常创建且不自动建客户', async () => {
  harness.db = baseDb();
  harness.inserts = [];
  const res = await speakerFn.main({ action: 'create', data: { name: '新嘉宾', customer_id: 500 } });
  assert.ok(res.id, 'create 返回 id');
  assert.equal(res.customer_id, 500, 'customer_id 透传传入值');
  const tables = harness.inserts.map(i => i.table);
  assert.ok(tables.includes('activity_speakers'), '写入 activity_speakers 表');
  assert.ok(!tables.includes('customers'), '传入 customer_id 也不自动建客户');
  assert.ok(!tables.includes('persons'), '传入 customer_id 也不自动建 Person');
});

// ---------- 3. ai_activity 静态检查：嘉宾 name 从 Person 优先读 ----------
test('T8 ai_activity 静态检查: 嘉宾参与者 name 从 Person 优先读（persons.select + display_name + person_id 覆盖）', () => {
  const src = fs.readFileSync(AI_ACTIVITY, 'utf8');
  assert.match(src, /rdb\.from\('persons'\)\.select\('id, display_name'\)/, 'select persons 取 display_name');
  assert.match(src, /spPmap\[p\.id\] = p\.display_name/, '用 display_name 建 spPmap');
  assert.match(src, /s\.person_id && spPmap\[s\.person_id\]/, '按 person_id 查 person 名');
  assert.match(src, /s\.name = spPmap\[s\.person_id\]/, 'person 有值时覆盖 speaker.name');
});

test('T9 ai_activity 静态检查: recommendTopics 嘉宾池 name 从 Person 优先读（spPoolPmap 覆盖）', () => {
  const src = fs.readFileSync(AI_ACTIVITY, 'utf8');
  assert.match(src, /rdb\.from\('activity_speakers'\)\.select\('id, name, person_id'\)/, '嘉宾池 select 含 person_id');
  assert.match(src, /spPoolPersons\.forEach/, '遍历嘉宾池 persons');
  assert.match(src, /spPoolPmap\[p\.id\] = p\.display_name/, '用 display_name 建 spPoolPmap');
  assert.match(src, /spPoolPmap\[s\.person_id\]/, 'recommendTopics 按 person_id 覆盖 name');
});
