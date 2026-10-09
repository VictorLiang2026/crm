/**
 * PMC-12 隔离测试：招募模块 Person 与招募资料分离。
 *
 * 性质：纯离线 fixture 测试（不触线上、不调真实模型、不读写数据库）。
 * 做法：拦截 3 个招募云函数各自的 ./db 副本，注入内存 RDB 与确定性 generateText 桩，
 *       直接运行各函数真实的 index.js main()，断言：
 *   1) migration/rollback 契约：主视图 7 列 + 回收站 3 列切为 Person 优先 COALESCE，
 *      列名/列序不变（基线 39 列清单）、person_only 视图不动、security_invoker/GRANT 保留；
 *   2) bigint ID 字符串精确处理（R-ID2）：get/update/remove/restore 与
 *      recruit_score/recruit_recommend 的 candidate_id 均以字符串透传（fixture 以字符串 ID 匹配验证）；
 *   3) 非法/缺失 ID：缺失保留 legacy 错误 'candidate_id required'，非法返回 'Invalid candidate ID'；
 *   4) recruit_score 回写字段仍仅 potential_score/potential_reason/updated_at；
 *   5) create 仍强制 customer_id（客户转增员既有路径）；remove/restore 走 crm_delete_batch RPC 字符串数组；
 *   6) admin.html：B 类客户采纳先 confirmRecruitConversion 预览确认、后 create；existing_id 幂等分支存在。
 *
 * 运行：node --test tests/pmc/pmc12-recruit.test.cjs
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('module');

const REPO_ROOT = path.resolve(__dirname, '../..');
const FN_DIRS = ['recruit_candidates', 'recruit_score', 'recruit_recommend'];
const dbTargets = new Set(FN_DIRS.map(d => path.join(REPO_ROOT, 'cloudfunctions', d, 'db.js')));

// ---------- 内存 RDB ----------
const harness = { db: {}, calls: [], queue: [], rpcs: [] };

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
  is(c, v) { if (v === null) this.filters.push(r => r[c] == null); return this; }
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
      const id = Math.max(1000, ...rows.map(r => Number(r.id) || 0)) + 1;
      const stored = Object.assign({ id, person_id: this.payload.person_id ?? null }, this.payload);
      rows.push(stored);
      const ret = { id, person_id: stored.person_id };
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
    return Promise.resolve({ data: [{ ok: true, restored: 1, cascaded: {} }] });
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
  for (const f of allowed) if (Object.prototype.hasOwnProperty.call(data, f)) out[f] = data[f];
  return out;
}
async function generateText(messages, opts) {
  harness.calls.push({ messages, opts: opts || {} });
  const text = harness.queue.length ? harness.queue.shift() : '{}';
  return { text, raw: text };
}

const stubDb = {
  app: { __stub: 'pmc12' }, rdb: stubRdb, generateText,
  extractJson, assertOk, normFields, nowIso: () => '2026-10-09T00:00:00.000Z',
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent); } catch (e) { resolved = null; }
  if (resolved && dbTargets.has(path.resolve(resolved))) return stubDb;
  return origLoad.call(this, request, parent, isMain);
};

const fn = Object.fromEntries(FN_DIRS.map(d =>
  [d, require(path.join(REPO_ROOT, 'cloudfunctions', d, 'index.js'))]));

// ---------- Fixture：ID 一律以字符串存储，仅字符串透传可命中（验证 R-ID2 字符串精确传递） ----------
function baseDb() {
  return {
    v_recruit_candidates: [
      {
        candidate_id: '19', customer_id: 788, person_id: 783,
        customer_name: '【系统测试·勿联系】增员甲', gender: '男', birthday: '1990-01-01',
        phone: '13900000019', wx_account: 'wx_c19', occupation: '工程师',
        annual_income: '30万', education: '本科', mbti: 'INTJ', source: '活动',
        stage: '新增人才', stage_changed_at: '2026-10-01T00:00:00Z',
        potential_score: null, potential_reason: null,
      },
      {
        candidate_id: '20', customer_id: null, person_id: 786,
        customer_name: '独立候选人Person', gender: null, birthday: null, phone: null,
        wx_account: null, occupation: null, annual_income: null, education: null,
        mbti: null, source: null, stage: '互动暖客', stage_changed_at: '2026-10-02T00:00:00Z',
        potential_score: null, potential_reason: null,
      },
    ],
    recruit_candidates: [
      { id: '19', customer_id: 788, person_id: 783, stage: '新增人才', deleted_at: null },
      { id: '20', customer_id: null, person_id: 786, stage: '互动暖客', deleted_at: null },
    ],
    recruit_milestones: [],
    persons: [
      { id: 783, display_name: '【系统测试·勿联系】增员甲Person', phone: '13900000019', wechat: 'wx_c19', gender: '男', birthday: '1990-01-01', occupation: '工程师', organization: '某公司', education: '本科', deleted_at: null },
      { id: 786, display_name: '独立候选人Person', phone: null, wechat: null, gender: null, birthday: null, occupation: null, organization: null, education: null, deleted_at: null },
    ],
  };
}

const MIGRATION = path.join(REPO_ROOT, 'cloudbase', 'migrations', '20261009091200_pmc12_recruit_view_person_read.sql');
const ROLLBACK = path.join(REPO_ROOT, 'cloudbase', 'rollbacks', '20261009091200_pmc12_recruit_view_person_read.sql');
const ADMIN = path.join(REPO_ROOT, 'admin.html');

// ---------- 1. migration / rollback 契约 ----------
test('T1 migration: 主视图 7 个身份列切为 Person 优先 COALESCE（列别名与列序不变）', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  assert.match(sql, /COALESCE\(p\.display_name, c\.customer_name\) AS customer_name/);
  assert.match(sql, /COALESCE\(p\.gender, c\.gender\) AS gender/);
  assert.match(sql, /COALESCE\(p\.birthday, c\.birthday\) AS birthday/);
  assert.match(sql, /COALESCE\(p\.phone, c\.phone\) AS phone/);
  assert.match(sql, /COALESCE\(p\.wechat, c\.wx_account\) AS wx_account/);
  assert.match(sql, /COALESCE\(p\.occupation, c\.occupation\) AS occupation/);
  assert.match(sql, /COALESCE\(p\.education, c\.education\) AS education/);
  // 客户域权威字段保持 customers，不迁
  assert.match(sql, /c\.annual_income,/);
  assert.match(sql, /c\.mbti,/);
  assert.match(sql, /c\.source,/);
  assert.match(sql, /c\.marital_status,/);
  assert.match(sql, /c\.hobbies,/);
  assert.match(sql, /c\.additional_info,/);
  // 列序契约：基线 39 列清单，逐列按序出现。
  // 兼容两种写法：显式别名（AS x）与裸列引用（qualifier.x 后跟逗号/换行，如 rc.customer_id,、c.annual_income,）。
  const aliases = [
    'candidate_id', 'customer_id', 'customer_name', 'gender', 'birthday', 'phone',
    'wx_account', 'occupation', 'annual_income', 'education', 'mbti', 'source',
    'marital_status', 'hobbies', 'additional_info', 'recommender_id', 'stage',
    'stage_changed_at', 'potential_score', 'potential_reason', 'motivation', 'concerns',
    'work_experience', 'family_situation', 'personality_tags', 'career_plan',
    'next_action_date', 'next_action', 'activity_history', 'radar_image_file_id',
    'radar_image_name', 'winner_report_file_id', 'winner_report_name', 'operator',
    'created_at', 'updated_at', 'idle_days', 'profile', 'person_id',
  ];
  const m = sql.match(/CREATE OR REPLACE VIEW public\.v_recruit_candidates WITH \(security_invoker=true\) AS([\s\S]*?)FROM recruit_candidates/);
  assert.ok(m, '主视图定义块存在');
  let pos = -1;
  for (const a of aliases) {
    const idx = m[1].search(new RegExp('(?:AS ' + a + '\\b)|(?:\\.' + a + '\\s*[,\\n])'));
    assert.ok(idx > pos, '列 ' + a + ' 顺序正确');
    pos = idx;
  }
  // JOIN 形态保持 G-PMC11-2 的 LEFT JOIN
  assert.match(sql, /LEFT JOIN customers c ON c\."Id" = rc\.customer_id AND c\.deleted_at IS NULL/);
  assert.match(sql, /LEFT JOIN persons p ON p\.id = rc\.person_id AND p\.deleted_at IS NULL/);
  // security_invoker + GRANT 保留；person_only 视图不动
  assert.match(sql, /WITH \(security_invoker=true\)/);
  assert.match(sql, /GRANT SELECT ON public\.v_recruit_candidates TO anon, authenticated, service_role/);
  assert.doesNotMatch(sql, /v_recruit_candidates_person_only/);
});

test('T2 migration: 回收站视图 3 列切换且 12 列契约不变', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const m = sql.match(/CREATE OR REPLACE VIEW public\.v_recruit_candidates_trash WITH \(security_invoker=true\) AS([\s\S]*?)FROM recruit_candidates/);
  assert.ok(m, '回收站视图定义块存在');
  assert.match(m[1], /COALESCE\(p\.display_name, c\.customer_name\) AS customer_name/);
  assert.match(m[1], /COALESCE\(p\.phone, c\.phone\) AS phone/);
  assert.match(m[1], /COALESCE\(p\.occupation, c\.occupation\) AS occupation/);
  const aliases = ['candidate_id', 'customer_id', 'customer_name', 'phone', 'occupation', 'stage',
    'operator', 'created_at', 'updated_at', 'candidate_deleted_at', 'customer_deleted_at', 'person_id'];
  let pos = -1;
  for (const a of aliases) {
    const idx = m[1].search(new RegExp('(?:AS ' + a + '\\b)|(?:\\.' + a + '\\s*[,\\n])'));
    assert.ok(idx > pos, '回收站列 ' + a + ' 顺序正确');
    pos = idx;
  }
});

test('T3 rollback: 恢复 customers 优先定义（c 原始列 / c 优先 COALESCE）', () => {
  const rb = fs.readFileSync(ROLLBACK, 'utf8');
  assert.match(rb, /COALESCE\(c\.customer_name, p\.display_name\) AS customer_name/);
  assert.match(rb, /\n    c\.gender,/);
  assert.match(rb, /\n    c\.phone,/);
  assert.match(rb, /WITH \(security_invoker=true\)/);
  assert.match(rb, /GRANT SELECT ON public\.v_recruit_candidates TO anon, authenticated, service_role/);
});

// ---------- 2. bigint ID 字符串精确处理（R-ID2） ----------
test('T4 recruit_candidates get/update/remove/restore 以字符串 ID 精确命中（字符串 fixture 仅字符串可匹配）', async () => {
  harness.db = baseDb();
  harness.rpcs = [];
  const rc = fn.recruit_candidates;

  const g = await rc.main({ action: 'get', id: '20' });
  assert.ok(g.candidate, 'get 字符串 ID 命中');
  assert.equal(g.candidate.candidate_id, '20');

  const u = await rc.main({ action: 'update', id: '19', data: { stage: '初次面谈', operator: 'tester' } });
  assert.equal(u.ok, true, 'update 字符串 ID 命中');

  const r = await rc.main({ action: 'remove', id: '19' });
  assert.equal(r.ok, true);
  assert.equal(harness.rpcs.length, 1);
  assert.equal(harness.rpcs[0].name, 'crm_delete_batch');
  assert.deepEqual(harness.rpcs[0].args, { p_kind: 'recruit', p_action: 'remove', p_ids: ['19'] });

  const rs = await rc.main({ action: 'restore', ids: ['19', '20'] });
  assert.equal(rs.ok, true);
  assert.deepEqual(harness.rpcs[1].args.p_ids, ['19', '20']);
});

test('T5 recruit_candidates get/update/remove 对非法 ID 拒绝（Invalid candidate ID，含超安全整数大 ID）', async () => {
  harness.db = baseDb();
  const rc = fn.recruit_candidates;
  for (const bad of ['abc', '0', '-1', '2.5', '', ' 19', '9007199254740993']) {
    const g = await rc.main({ action: 'get', id: bad });
    assert.equal(g.error, 'Invalid candidate ID', 'get 拒绝 ' + JSON.stringify(bad));
  }
});

test('T6 recruit_candidates create 仍强制 customer_id + 返回字符串化 ID（R-ID1）', async () => {
  harness.db = baseDb();
  const rc = fn.recruit_candidates;
  const noCust = await rc.main({ action: 'create', data: { stage: '新增人才' } });
  assert.match(noCust.error, /customer_id required/);
  const ok = await rc.main({ action: 'create', data: { customer_id: 791, stage: '新增人才', operator: 'tester' } });
  assert.ok(ok.id, 'create 成功返回 id');
  assert.equal(typeof ok.id, 'string', 'create 返回 id 为字符串（R-ID1）');
  assert.ok('personId' in ok, 'create 返回新增字段 personId');
  // 触发器在真实库自动建 Person；离线只断言写入 recruit_candidates + 首个里程碑
  const inserted = harness.db.recruit_candidates.find(r => r.customer_id === 791);
  assert.ok(inserted, '候选人行已写入');
  assert.ok(harness.db.recruit_milestones.some(m => m.candidate_id === inserted.id && m.to_stage === '新增人才'), '首个里程碑已写入');
});

test('T7 recruit_score/recruit_recommend candidate_id 字符串透传 + 缺失保留 legacy 错误', async () => {
  harness.db = baseDb();
  harness.calls = [];
  harness.queue = [JSON.stringify({ score: 88, reason: '理由', risks: '风险' })];
  const s = await fn.recruit_score.main({ candidate_id: '19' });
  assert.equal(s.score, 88, 'recruit_score 字符串 ID 命中并返回评分');
  const upd = harness.db.recruit_candidates.find(r => r.id === '19');
  assert.equal(upd.potential_score, 88);
  assert.deepEqual(Object.keys(harness.db.recruit_candidates[0]).filter(k => ['potential_score', 'potential_reason', 'updated_at'].includes(k)).sort(),
    ['potential_reason', 'potential_score', 'updated_at'].sort());

  const miss = await fn.recruit_score.main({});
  assert.equal(miss.error, 'candidate_id required', '缺失保留 legacy 错误');
  const bad = await fn.recruit_score.main({ candidate_id: 'abc' });
  assert.equal(bad.error, 'Invalid candidate ID');

  harness.calls = [];
  const rec = await fn.recruit_recommend.main({ candidate_id: '20' });
  assert.ok(!rec.error, 'recruit_recommend 字符串 ID 命中: ' + (rec.error || 'ok'));
  assert.ok(rec.recommendation && typeof rec.recommendation === 'object', '返回 recommendation 对象');
  assert.ok(rec.identity && rec.identity.source === 'persons' && rec.identity.person_id === '786',
    'Person 身份解析正确（独立候选人 customer_id=null 亦支持）');
  const missRec = await fn.recruit_recommend.main({});
  assert.equal(missRec.error, 'candidate_id required');
});

test('T8 recruit_score 回写仅 potential_score/potential_reason/updated_at（评分语义不变）', async () => {
  harness.db = baseDb();
  harness.queue = [JSON.stringify({ score: 55, reason: 'r', risks: 'k' })];
  await fn.recruit_score.main({ candidate_id: '19' });
  const row = harness.db.recruit_candidates.find(r => r.id === '19');
  const bizKeys = Object.keys(row).filter(k => !['potential_score', 'potential_reason', 'updated_at', 'stage', 'stage_changed_at', 'customer_id', 'person_id', 'deleted_at'].includes(k));
  // 除评分三字段外无其他业务字段被改写
  assert.deepEqual(bizKeys.filter(k => row[k] !== baseDb().recruit_candidates.find(r => r.id === '19')[k]), []);
});

// ---------- 3. admin.html 预览确认契约 ----------
test('T9 admin.html: B 类客户采纳先 confirmRecruitConversion 预览确认、后 create；existing_id 幂等分支存在', () => {
  const html = fs.readFileSync(ADMIN, 'utf8');
  assert.match(html, /function confirmRecruitConversion\(item\)/, '预览确认函数已定义');
  const bBranch = html.match(/else if\(item\.classification === 'B'\)\{([\s\S]*?)\n    \} else \{/);
  assert.ok(bBranch, 'B 分支定位成功');
  const confirmPos = bBranch[1].indexOf('confirmRecruitConversion(item)');
  const createPos = bBranch[1].indexOf("callFn('recruit_candidates', {action:'create'");
  assert.ok(confirmPos >= 0, 'B 分支调用预览确认');
  assert.ok(createPos > confirmPos, '确认先于 create');
  assert.match(bBranch[1], /rc\.existing_id/, 'existing_id 幂等分支存在');
  // 用户取消：不发生任何写入调用
  assert.match(bBranch[1], /已取消：未创建增员对象/);
});
