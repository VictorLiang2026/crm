/**
 * PMC-14 隔离测试：活动参与者身份归一（canonical 权威 + 业务表引用保持）。
 *
 * 性质：纯离线 fixture 测试（不触线上、不调真实模型、不读写数据库）。
 * 做法：拦截 cloudfunctions/activities/db.js 本地副本，注入内存 RDB，
 *       直接运行真实 index.js main()，断言：
 *   1) enrichParticipants（get）：有 canonical 的行返回 canonicalPersonId（字符串），
 *      展示名 Person 优先；Person 已软删时回退业务表回填名/快照名；
 *      暂存行（无 person_id）保持快照名，无 canonicalPersonId；
 *      快照列覆盖仅发生在返回值（无 update 调用，D6）。
 *   2) addParticipant / linkParticipant 契约回归：person_id 仍为业务表主键
 *      （customer→customers."Id"），不写 canonical_person_id。
 *   3) migration/rollback 静态契约：断言块、幂等条件、rollback 精确可逆。
 *   4) 读取方语义静态锁定：ai_referral / ai_activity / today_coach 按
 *      person_type+业务表 ID 消费（防后续误改为 persons.id）。
 *
 * 运行：node --test tests/pmc/pmc14-participants.test.cjs
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('module');

const REPO_ROOT = path.resolve(__dirname, '../..');
const FN_DIR = 'activities';
const dbTarget = path.join(REPO_ROOT, 'cloudfunctions', FN_DIR, 'db.js');
const dbTargets = new Set([dbTarget]);

// ---------- 内存 RDB ----------
const harness = { db: {}, calls: [], updates: [], inserts: [] };

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
  or() { return this; } // 本包不验证模糊搜索，保留链式兼容
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
      harness.updates.push({ table: this.table, payload: this.payload, updated: updated.length });
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
  rpc() { return Promise.resolve({ data: [] }); },
};

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

const stubDb = { app: { __stub: 'pmc14' }, rdb: stubRdb, assertOk, normFields, nowIso };

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent); } catch (e) { resolved = null; }
  if (resolved && dbTargets.has(path.resolve(resolved))) return stubDb;
  return origLoad.call(this, request, parent, isMain);
};

const activitiesFn = require(path.join(REPO_ROOT, 'cloudfunctions', FN_DIR, 'index.js'));

// ---------- Fixture ----------
// 201：canonical=783（Person 活跃，display_name≠快照名）→ Person 优先 + canonicalPersonId
// 202：暂存（无 person_id、无 canonical）→ 快照名保持
// 203：canonical=999（Person 已软删）+ person_id=77（speaker）→ 回退业务表回填名
// 204：无 canonical、person_id=55（customer）、person_name 空 → 业务表回填名（老逻辑回归）
function baseDb() {
  return {
    activities: [{ id: 1, name: '测试活动', deleted_at: null }],
    activity_participants: [
      {
        id: 201, activity_id: 1, person_type: 'customer', person_id: 55,
        person_name: '快照名', status: 'attended', participant_role: 'attendee',
        followup_status: 'none', canonical_person_id: 783, deleted_at: null,
      },
      {
        id: 202, activity_id: 1, person_type: 'speaker', person_id: null,
        person_name: '暂存嘉宾', status: 'invited', participant_role: 'attendee',
        followup_status: 'none', canonical_person_id: null, deleted_at: null,
      },
      {
        id: 203, activity_id: 1, person_type: 'speaker', person_id: 77,
        person_name: null, status: 'attended', participant_role: 'speaker',
        followup_status: 'none', canonical_person_id: 999, deleted_at: null,
      },
      {
        id: 204, activity_id: 1, person_type: 'customer', person_id: 55,
        person_name: null, status: 'invited', participant_role: 'attendee',
        followup_status: 'none', canonical_person_id: null, deleted_at: null,
      },
    ],
    persons: [
      { id: 783, display_name: 'Person当前名', deleted_at: null },
      { id: 999, display_name: '软删Person名', deleted_at: '2026-10-01T00:00:00Z' },
    ],
    customers: [
      { Id: 55, customer_name: '客户55名', deleted_at: null },
      { Id: 56, customer_name: '客户56名', deleted_at: null },
    ],
    v_recruit_candidates: [],
    activity_speakers: [
      { id: 77, name: '嘉宾77名', deleted_at: null },
      { id: 88, name: '嘉宾88名', deleted_at: null },
    ],
  };
}

async function getParticipants() {
  harness.updates = [];
  const res = await activitiesFn.main({ action: 'get', id: 1 });
  assert.ok(!res.error, 'get 无错误: ' + (res.error || ''));
  return res.participants || [];
}

// ---------- 1. enrichParticipants：canonical 权威 + Person 优先展示 ----------
test('T1 get: canonical 行返回字符串 canonicalPersonId 且展示名 Person 优先', async () => {
  harness.db = baseDb();
  const parts = await getParticipants();
  const p201 = parts.find(r => r.id === 201);
  assert.ok(p201, '返回参与者 201');
  assert.equal(p201.canonicalPersonId, '783', 'canonicalPersonId 为字符串（R-ID1）');
  assert.equal(p201.person_name, 'Person当前名', '展示名取 persons.display_name（Person 优先）');
});

test('T2 get: Person 已软删时回退业务表回填名，canonicalPersonId 仍返回', async () => {
  harness.db = baseDb();
  const parts = await getParticipants();
  const p203 = parts.find(r => r.id === 203);
  assert.equal(p203.canonicalPersonId, '999', '软删 Person 的 canonical 字段仍返回');
  assert.equal(p203.person_name, '嘉宾77名', 'Person 软删查不到 → 回退 speaker 表回填名');
});

test('T3 get: 暂存行保持快照名且无 canonicalPersonId 字段', async () => {
  harness.db = baseDb();
  const parts = await getParticipants();
  const p202 = parts.find(r => r.id === 202);
  assert.equal(p202.canonicalPersonId, undefined, '暂存行无 canonicalPersonId');
  assert.equal(p202.person_name, '暂存嘉宾', '暂存行快照名不变（身份待确认）');
});

test('T4 get: 老记录 person_name 空但 person_id 有 → 业务表回填名（原逻辑回归）', async () => {
  harness.db = baseDb();
  const parts = await getParticipants();
  const p204 = parts.find(r => r.id === 204);
  assert.equal(p204.person_name, '客户55名', '从 customers 回填姓名');
  assert.equal(p204.canonicalPersonId, undefined, '无 canonical 时不出新字段');
});

test('T5 D6 快照不可变：enrichParticipants 只改返回值，不产生任何 update 调用', async () => {
  harness.db = baseDb();
  await getParticipants();
  const partUpdates = harness.updates.filter(u => u.table === 'activity_participants');
  assert.equal(partUpdates.length, 0, 'get 路径不写 activity_participants');
});

// ---------- 2. addParticipant / linkParticipant 契约回归 ----------
test('T6 addParticipant 契约回归：person_id 仍为业务表主键，不写 canonical', async () => {
  harness.db = baseDb();
  harness.inserts = [];
  const res = await activitiesFn.main({ action: 'addParticipant', data: {
    activity_id: 1, person_type: 'customer', person_id: 56, status: 'invited',
  }});
  assert.ok(!res.error, 'addParticipant 无错误: ' + (res.error || ''));
  assert.equal(res.linked, true);
  const ins = harness.inserts.find(i => i.table === 'activity_participants');
  assert.ok(ins, '写入 activity_participants');
  assert.equal(ins.payload.person_id, 56, 'person_id=customers."Id"（业务表语义不变）');
  assert.equal(ins.payload.canonical_person_id, undefined, '不写 canonical（guard 服务端独占）');
  assert.equal(ins.payload.person_name, '客户56名', '回填业务表名');
});

test('T7 addParticipant 姓名暂存回归：person_id=null + 快照名落库', async () => {
  harness.db = baseDb();
  harness.inserts = [];
  const res = await activitiesFn.main({ action: 'addParticipant', data: {
    activity_id: 1, person_type: 'customer', person_name: '新暂存', status: 'invited',
  }});
  assert.ok(!res.error, 'addParticipant 无错误: ' + (res.error || ''));
  assert.equal(res.linked, false);
  const ins = harness.inserts.find(i => i.table === 'activity_participants');
  assert.equal(ins.payload.person_id, null, '暂存行 person_id 为空（身份待确认）');
  assert.equal(ins.payload.person_name, '新暂存');
});

test('T8 linkParticipant 契约回归：只更新 person_id/person_name，不动 canonical', async () => {
  harness.db = baseDb();
  harness.updates = [];
  const res = await activitiesFn.main({ action: 'linkParticipant', id: 202, person_id: 88 });
  assert.ok(!res.error, 'linkParticipant 无错误: ' + (res.error || ''));
  const upd = harness.updates.find(u => u.table === 'activity_participants');
  assert.ok(upd, '更新参与者行');
  assert.equal(upd.payload.person_id, 88, 'person_id=业务表主键（speaker→activity_speakers.id）');
  assert.equal(upd.payload.canonical_person_id, undefined, '不动 canonical');
  assert.equal(upd.payload.person_name, '嘉宾88名', '回填业务表名');
});

// ---------- 3. migration / rollback 静态契约 ----------
const MIG = path.join(REPO_ROOT, 'cloudbase', 'migrations', '20261009180000_pmc14_participant_canonical_backfill.sql');
const ROLLBACK = path.join(REPO_ROOT, 'cloudbase', 'rollbacks', '20261009180000_pmc14_participant_canonical_backfill.sql');

test('T9 migration 静态契约：断言块+幂等条件+软删范围', () => {
  const sql = fs.readFileSync(MIG, 'utf8');
  assert.match(sql, /canonical_person_id IS NULL/, '幂等：只处理缺 canonical 的行');
  assert.match(sql, /deleted_at IS NOT NULL/, '范围限定软删行');
  assert.match(sql, /person_type = 'customer'/, '范围限定 customer 类型');
  assert.match(sql, /legacy_customer_id/, '经 legacy 桥解析');
  assert.match(sql, /deleted_at IS NULL\) = 1|count\(\*\)[\s\S]*= 1/, '唯一命中条件');
  assert.match(sql, /RAISE EXCEPTION/, '断言失败即中止（多义/同活动重复）');
  assert.match(sql, /lock_timeout|statement_timeout/, '锁与超时保护');
  assert.doesNotMatch(sql, /DROP\s+(TABLE|VIEW|COLUMN|TRIGGER|FUNCTION)/i, '无删除操作');
  assert.doesNotMatch(sql, /CASCADE/i, '无 CASCADE');
});

test('T10 rollback 静态契约：按精确 id+预期值可逆清理', () => {
  const sql = fs.readFileSync(ROLLBACK, 'utf8');
  assert.match(sql, /id IN \(1, 2\)[\s\S]*canonical_person_id = 1/, 'ap 1,2 → person 1');
  assert.match(sql, /id IN \(3, 5, 7, 9, 11\)[\s\S]*canonical_person_id = 89/, 'ap 3,5,7,9,11 → person 89');
  assert.match(sql, /deleted_at IS NOT NULL/, '仅软删行');
  assert.match(sql, /person_type = 'customer'/, '仅 customer 行');
  assert.doesNotMatch(sql, /DELETE FROM/i, '不删除历史记录');
});

// ---------- 4. 读取方语义静态锁定（防后续误改） ----------
test('T11 读取方语义锁定：ai_referral/today_coach 按业务表 ID 消费参与者', () => {
  const referral = fs.readFileSync(path.join(REPO_ROOT, 'cloudfunctions', 'ai_referral', 'index.js'), 'utf8');
  assert.match(referral, /eq\('person_type', 'customer'\)[\s\S]{0,80}eq\('person_id', customerId\)/,
    'ai_referral：person_type=customer + person_id=customerId');
  const coach = fs.readFileSync(path.join(REPO_ROOT, 'cloudfunctions', 'today_coach', 'index.js'), 'utf8');
  assert.match(coach, /p\.person_type !== 'customer' && p\.person_type !== 'recruit'/,
    'today_coach R3：customer/recruit 分流');
  assert.match(coach, /folIdx\[p\.person_id\]/, 'today_coach：customer 行 person_id 作 followups 索引键（customer_id 语义）');
  const aiAct = fs.readFileSync(path.join(REPO_ROOT, 'cloudfunctions', 'ai_activity', 'index.js'), 'utf8');
  assert.match(aiAct, /person_type === 'speaker' && p\.person_id\)[\s\S]{0,60}existingIds\[p\.person_id\] = true/,
    'ai_activity：speaker 行 person_id=activity_speakers.id 语义');
});
