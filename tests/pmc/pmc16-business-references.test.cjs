/**
 * PMC-16 隔离测试：业务引用收口——OCR 快照恢复安全 + 互动时间线删除不复活。
 *
 * 性质：纯离线 fixture 测试（不触线上、不调真实模型、不读写生产数据库）。
 * 覆盖：
 *  A. customers.update 服务端 OCR 恢复保护（真实函数 + 内存 RDB）：
 *     ≥3 桥接字段与当前值漂移 → 拒绝 + OCR_SNAPSHOT_RESTORE_CONFLICT + 不写库；
 *     显式 forceRestore → 覆盖；冲突清单精确；<3 字段 → 普通编辑直写。
 *  B. InteractionService.listForPerson 防复活（PMC-16 对齐 timeline 规则）：
 *     物化账本副本的 legacy 源行已被删除 → 不出现；活跃 legacy 物化行仍优先单条呈现。
 *  C. 静态契约：admin.html OCR 删除分支消费 personSnapshot、检查响应、
 *     forceRestore 人工确认路径；ocr_records.remove 返回双快照且不改写历史。
 *
 * 运行：node --test tests/pmc/pmc16-business-references.test.cjs
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('module');

const REPO_ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ---------- 内存 RDB harness（拦截 customers/db.js 本地副本） ----------
const dbTarget = path.join(REPO_ROOT, 'cloudfunctions', 'customers', 'db.js');
const harness = { db: {}, updates: [] };

class FakeQuery {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.op = 'select';
    this.payload = null;
    this._takeOne = false;
  }
  select() { return this; }
  eq(c, v) { this.filters.push(r => String(r[c]) === String(v)); return this; }
  is(c, v) { if (v === null) this.filters.push(r => r[c] == null); return this; }
  update(row) { this.op = 'update'; this.payload = row; return this; }
  maybeSingle() { this._takeOne = true; return this._exec(); }
  then(resolve, reject) { return this._exec().then(resolve, reject); }
  async _exec() {
    const rows = harness.db[this.table] || (harness.db[this.table] = []);
    if (this.op === 'update') {
      const updated = [];
      for (const r of rows) {
        if (this.filters.every(f => f(r))) { Object.assign(r, this.payload); updated.push(r); }
      }
      harness.updates.push({ table: this.table, payload: this.payload, updated: updated.length });
      return { data: updated.map(r => ({ Id: r.Id })) };
    }
    const out = rows.filter(r => this.filters.every(f => f(r)));
    return { data: this._takeOne ? (out[0] || null) : out };
  }
}

const stubRdb = { from: t => new FakeQuery(t), rpc: () => Promise.resolve({ data: [] }) };
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

// ---------- A. customers.update OCR 恢复保护 ----------
function customerFixture() {
  harness.updates = [];
  harness.db.customers = [{
    Id: 101, customer_name: '张三', phone: '13800000000', wx_account: 'zs-wx',
    gender: '男', birthday: '1990-01-01', occupation: '工程师', education: '本科',
    deleted_at: null,
  }];
}
// 快照：phone/occupation 自解析后被其他模块改新（漂移），gender/customer_name 未变
const SNAP = { customer_name: '张三', phone: '13811111111', occupation: '经理', gender: '男' };

test('A1 快照整包覆盖与当前值漂移 → 拒绝并返回冲突清单，不写库', async () => {
  customerFixture();
  const res = await customersFn.main({ action: 'update', id: 101, data: { ...SNAP } });
  assert.equal(res.error, 'OCR_SNAPSHOT_RESTORE_CONFLICT');
  assert.deepEqual(res.conflicts.sort(), ['occupation', 'phone']);
  assert.equal(harness.updates.length, 0, '冲突时不得写库');
  assert.equal(harness.db.customers[0].phone, '13800000000', '当前值保持不变');
});

test('A2 快照与当前值一致 → 直接恢复（幂等，无冲突）', async () => {
  customerFixture();
  const res = await customersFn.main({
    action: 'update', id: 101,
    data: { customer_name: '张三', phone: '13800000000', occupation: '工程师', gender: '男' },
  });
  assert.equal(res.ok, true);
  assert.equal(harness.updates.length, 1);
});

test('A3 人工确认 forceRestore → 覆盖当前值', async () => {
  customerFixture();
  const res = await customersFn.main({ action: 'update', id: 101, data: { ...SNAP }, forceRestore: true });
  assert.equal(res.ok, true);
  assert.equal(harness.db.customers[0].phone, '13811111111', '快照值已覆盖');
  assert.equal(harness.db.customers[0].occupation, '经理');
});

test('A4 不足 3 个桥接字段 → 视为普通编辑，直写不拦截', async () => {
  customerFixture();
  const res = await customersFn.main({
    action: 'update', id: 101, data: { customer_name: '张三', phone: '13811111111' },
  });
  assert.equal(res.ok, true);
  assert.equal(harness.db.customers[0].phone, '13811111111');
});

// ---------- B. InteractionService 防复活 ----------
const { InteractionService } = require(path.join(REPO_ROOT, 'cloudfunctions', '_shared', 'interaction-service.js'));

function timelineFixture() {
  const tables = {
    persons: [{ id: 11, legacy_customer_id: 101 }],
    interactions: [
      { id: 1, person_id: 11, interaction_type: 'meeting', interaction_at: '2026-09-15T10:00:00Z',
        summary: '人工记录', source_type: 'manual', source_id: null },
      // 已物化的 legacy 副本（历史导入产物）
      { id: 2, person_id: 11, interaction_type: 'followup', interaction_at: '2026-09-10T00:00:00Z',
        summary: '已导入的跟进副本', source_type: 'followups', source_id: 5 },
      { id: 3, person_id: 11, interaction_type: 'recruit_followup', interaction_at: '2026-09-11T00:00:00Z',
        summary: '已导入的增员跟进副本', source_type: 'recruit_followups', source_id: 8 },
    ],
    followups: [], // followups:5 已被删除
    recruit_candidates: [{ id: 7, customer_id: 101, person_id: 11 }],
    recruit_followups: [{ id: 8, candidate_id: 7, followup_date: '2026-09-11',
      interaction_summary: '增员沟通（活跃）', followup_notes: null, contact_method: 'phone' }],
    activity_speakers: [],
    activity_participants: [],
    activities: [],
  };
  async function request(table, method, filters = {}) {
    if (method !== 'GET' || !tables[table]) throw new Error('Unexpected database operation');
    let rows = tables[table];
    for (const [key, value] of Object.entries(filters)) {
      if (value.startsWith?.('eq.')) rows = rows.filter(row => String(row[key]) === value.slice(3));
      if (value.startsWith?.('in.')) rows = rows.filter(row => value.slice(4, -1).split(',').includes(String(row[key])));
    }
    return rows;
  }
  return { service: new InteractionService({ request }), tables };
}

test('B1 物化副本的 legacy 源已删除 → 不复活；活跃物化行仍单条呈现（账本优先）', async () => {
  const { service } = timelineFixture();
  const rows = (await service.listForPerson(11)).rows;
  assert.equal(rows.some(r => String(r.source_id) === '5' && r.source_type === 'followups'), false,
    '已删 followups#5 的物化副本不得复活');
  const recruit = rows.filter(r => r.source_type === 'recruit_followups' && String(r.source_id) === '8');
  assert.equal(recruit.length, 1, '活跃 legacy 源只出现一次');
  assert.equal(recruit[0].summary, '已导入的增员跟进副本', '账本行优先于虚拟投影');
  assert.equal(recruit[0].virtual, false);
});

// ---------- C. 静态契约：admin.html OCR 恢复闭环 + ocr_records 双快照 ----------
test('C1 admin.html OCR 删除分支：消费 personSnapshot、检查响应、forceRestore 人工确认', () => {
  const html = read('admin.html');
  const seg = html.slice(html.indexOf("callFn('ocr_records', {action:'remove'"),
    html.indexOf("showDetail(cid)", html.indexOf("callFn('ocr_records', {action:'remove'")));
  assert.ok(seg.includes('r.personSnapshot'), '必须消费 personSnapshot 供冲突对比');
  assert.ok(seg.includes('upd.error'), '必须检查 customers.update 响应');
  assert.ok(seg.includes("OCR_SNAPSHOT_RESTORE_CONFLICT"), '必须识别冲突错误码');
  assert.ok(seg.includes('forceRestore:true'), '覆盖必须经人工确认后显式 forceRestore');
  assert.ok(!/callFn\('customers', \{action:'update', id:cid, data:restoreData\}\);\s*\n\s*toast\('客户信息已恢复到解析前版本'\)/
    .test(seg), '不得恢复旧版假成功路径（不检查响应即报成功）');
});

test('C2 ocr_records.remove 返回 customer_snapshot + personSnapshot，历史快照不改写', () => {
  const src = read('cloudfunctions/ocr_records/index.js');
  assert.ok(src.includes('customer_snapshot: snapshot'), 'remove 必须返回原始 customer_snapshot');
  assert.ok(src.includes('personSnapshot'), 'remove 必须返回 personSnapshot（PMC-07）');
  assert.ok(!/update.*customer_snapshot|customer_snapshot.*=/.test(src.replace(/customer_snapshot: data\.customer_snapshot \|\| null/, '')),
    'update action 不得改写 customer_snapshot');
});
