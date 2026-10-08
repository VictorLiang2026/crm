/**
 * PMC-11 隔离模型测试：AI 上下文/搜索/结果保存适配 Person。
 *
 * 性质：纯离线 fixture 测试（不触线上、不调真实模型、不读写数据库）。
 * 做法：拦截 8 个受影响云函数各自的 ./db 副本（@cloudbase/node-sdk 在加载期初始化，
 *       无法在本地直接 require），注入内存 RDB 与确定性 generateText 桩，
 *       直接运行各函数真实的 index.js main()，断言：
 *   1) 进入模型的人物基础资料（姓名/性别/出生/电话/微信/职业/学历）取 Person；
 *   2) stage/priority/收入/爱好/婚况等业务域字段仍取所属领域表；
 *   3) 未映射 → unmapped 提示；双源冲突 → conflicts + 冲突提示，以 Person 为准；
 *   4) 派生落库快照名（ai_recommendations/policy_review_reports）取 Person 当前名，历史行不被改写；
 *   5) AI 返回的编造 ID 仍被白名单过滤；
 *   6) Context Engine person()/activity_review 身份解析经 person_id / canonical_person_id。
 *
 * 运行：node --test tests/pmc/pmc11-identity.test.cjs
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const FN_DIRS = [
  'ai_recommend', 'ai_referral', 'policy_review_reports', 'recruit_score',
  'recruit_recommend', 'ai_followup', 'ai_recommendations', 'ai_activity',
];
const dbTargets = new Set(FN_DIRS.map(d => path.join(REPO_ROOT, 'cloudfunctions', d, 'db.js')));

// ---------- 内存 RDB（Supabase 风格最小子集；thenable 以支持 Promise.all） ----------
const harness = { db: {}, calls: [], queue: [] };

class FakeQuery {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.orders = [];
    this.limitN = null;
    this.op = 'select';
    this.payload = null;
    this.single = false;
  }
  select() { return this; }
  eq(c, v) { this.filters.push(r => r[c] === v); return this; }
  neq(c, v) { this.filters.push(r => r[c] !== v); return this; }
  is(c, v) { if (v === null) this.filters.push(r => r[c] == null); return this; }
  in(c, arr) { const s = new Set(arr); this.filters.push(r => r[c] != null && s.has(r[c])); return this; }
  not(c, op, v) { if (op === 'is' && v === null) this.filters.push(r => r[c] != null); return this; }
  order(c) { this.orders.push(c); return this; }
  limit(n) { this.limitN = n; return this; }
  maybeSingle() { this.single = true; return this._exec(); }
  insert(row) { this.op = 'insert'; this.payload = row; return this; }
  update(row) { this.op = 'update'; this.payload = row; return this; }
  delete() { this.op = 'delete'; return this; }
  then(resolve, reject) { return this._exec().then(resolve, reject); }
  async _exec() {
    const rows = harness.db[this.table] || (harness.db[this.table] = []);
    if (this.op === 'insert') {
      const id = Math.max(1000, ...rows.map(r => Number(r.id) || 0)) + 1;
      rows.push(Object.assign({ id }, this.payload));
      return { data: [{ id }] };
    }
    if (this.op === 'update') {
      const updated = [];
      for (const r of rows) {
        if (this.filters.every(f => f(r))) { Object.assign(r, this.payload); updated.push(r); }
      }
      return { data: updated.map(r => ({ id: r.id })) };
    }
    if (this.op === 'delete') {
      const kept = rows.filter(r => !this.filters.every(f => f(r)));
      const removed = rows.length - kept.length;
      harness.db[this.table] = kept;
      return { data: Array.from({ length: removed }, () => ({})) };
    }
    let out = rows.filter(r => this.filters.every(f => f(r)));
    if (this.orders.length) {
      out = out.slice().sort((a, b) => {
        for (const c of this.orders) {
          const va = a[c], vb = b[c];
          if (va == null && vb == null) continue;
          if (va == null) return 1;
          if (vb == null) return -1;
          if (va < vb) return -1;
          if (va > vb) return 1;
        }
        return 0;
      });
    }
    if (this.limitN != null) out = out.slice(0, this.limitN);
    return { data: this.single ? (out[0] || null) : out };
  }
}

const stubRdb = { from: t => new FakeQuery(t) };

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
  app: { __stub: 'pmc11' }, rdb: stubRdb, generateText,
  extractJson, assertOk, normFields, nowIso: () => '2026-10-08T00:00:00.000Z',
};

// 拦截 8 个函数目录下的 db.js 副本（ai.js 为纯工具模块，正常加载）。
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  let resolved = null;
  try { resolved = Module._resolveFilename(request, parent); } catch (e) { resolved = null; }
  if (resolved && dbTargets.has(path.resolve(resolved))) return stubDb;
  return origLoad.call(this, request, parent, isMain);
};

const fn = Object.fromEntries(FN_DIRS.map(d =>
  [d, require(path.join(REPO_ROOT, 'cloudfunctions', d, 'index.js'))]));
const { createContextEngine } = require(path.join(REPO_ROOT, 'cloudfunctions', '_shared', 'context-engine.js'));

// ---------- Fixture ----------
function baseDb() {
  return {
    persons: [
      { id: 801, legacy_customer_id: 701, display_name: '张伟Person', gender: '男', birthday: '1980-03-05', phone: '13900000001', wechat: 'wx_person_a', occupation: '医生', organization: '市一医院', education: '本科', deleted_at: null },
      { id: 786, display_name: '独立候选人Person', gender: '男', birthday: '1995-09-09', phone: '13900000002', wechat: 'wx_person_c', occupation: '产品经理', organization: '某科技公司', education: '硕士', deleted_at: null },
      { id: 803, legacy_customer_id: 703, display_name: '李娜', gender: '女', birthday: '1990-06-06', phone: '13900000003', wechat: 'wx_li', occupation: '教师', organization: '实验中学', education: '本科', deleted_at: null },
      { id: 805, display_name: '王五Person', gender: '男', birthday: '1988-08-08', phone: '13900000005', wechat: 'wx_wang', occupation: '律师', organization: '某律所', education: '硕士', deleted_at: null },
    ],
    customers: [
      { Id: 701, customer_name: '张伟旧名', gender: '女', birthday: '1985-01-01', phone: '13800000000', wx_account: 'wx_old_a', occupation: '工程师', customer_stage: '需求挖掘', sales_priority: '高', recruitment_priority: '中', referral_priority: '高', annual_income: '30万', household_income: '40万', hobbies: '钓鱼', marital_status: '已婚', children_info: '一个儿子', properties_info: '自住房一套', additional_info: '爱喝铁观音', person_id: 801, profile: null, deleted_at: null },
      { Id: 702, customer_name: '王未映射', gender: '男', birthday: '1977-07-07', phone: '13800000006', wx_account: 'wx_wm', occupation: '会计', customer_stage: '新认识', sales_priority: '中', additional_info: '', person_id: null, profile: null, deleted_at: null },
      { Id: 703, customer_name: '李娜', gender: '女', birthday: '1990-06-06', phone: '13900000003', wx_account: 'wx_li', occupation: '教师', customer_stage: '关系维护', sales_priority: '', additional_info: '', person_id: 803, profile: null, deleted_at: null },
      { Id: 799, customer_name: '暂存关联老客户', gender: '女', birthday: '1982-02-02', phone: '13800000009', wx_account: '', occupation: '会计', customer_stage: '关系维护', sales_priority: '中', additional_info: '', person_id: null, profile: null, deleted_at: null },
    ],
    v_recruit_candidates: [
      { candidate_id: 20, customer_name: '独立候选旧名', gender: '女', birthday: '1990-01-01', phone: '13700000000', wx_account: 'wx_rc_old', occupation: '销售代表', education: '大专', person_id: 786, stage: '名单', annual_income: '15万', mbti: 'ENTJ', motivation: '想创业', concerns: '担心收入不稳', source: '缘故', work_experience: '零售5年', family_situation: '未婚', personality_tags: '外向', career_plan: '带团队', marital_status: '未婚', hobbies: '跑步', additional_info: '', profile: null },
      { candidate_id: 21, customer_name: '路演来的候选人', gender: '男', birthday: '1992-02-02', phone: '', wx_account: '', occupation: '讲师', education: '本科', person_id: null, stage: '接触', annual_income: '20万', mbti: '', motivation: '', concerns: '', source: '活动', work_experience: '', family_situation: '', personality_tags: '', career_plan: '', profile: null },
    ],
    recruit_candidates: [
      { id: 20, customer_id: null, person_id: 786, stage: '名单', potential_score: null, motivation: '想创业', stage_changed_at: null, deleted_at: null },
      { id: 21, customer_id: null, person_id: null, stage: '接触', potential_score: null, motivation: '', stage_changed_at: null, deleted_at: null },
    ],
    ai_recommendations: [
      { id: 1, customer_id: 701, customer_name: '张伟旧名', recommendation_date: '2026-09-01', suggested_followup_date: null, suggested_message: '历史快照建议', suggested_strategy: null, suggested_customer_stage: null, suggested_followup_goal: null, nba: null, created_at: '2026-09-01T00:00:00.000Z' },
    ],
    activities: [
      { id: 1, name: '秋茶会', activity_date: '2026-10-01', activity_type: '客户答谢', status: 'ended', goal_types: ['referral'], target_participants: 10, actual_participants: 8, location: '茶室', topic_ids: null, review_summary: '', review_score: null, description: '', created_at: '2026-10-01T00:00:00.000Z' },
      { id: 2, name: '增员茶叙', activity_date: '2026-09-20', activity_type: '增员', status: 'ended', goal_types: ['recruit'], target_participants: 6, actual_participants: 5, location: null, topic_ids: null, review_summary: null, review_score: null, created_at: '2026-09-20T00:00:00.000Z' },
      { id: 3, name: '老客户答谢', activity_date: '2026-09-10', activity_type: '客户答谢', status: 'reviewed', goal_types: [], target_participants: 20, actual_participants: 18, location: null, topic_ids: null, review_summary: null, review_score: null, created_at: '2026-09-10T00:00:00.000Z' },
    ],
    activity_participants: [
      { id: 1, activity_id: 1, person_type: 'customer', person_id: 701, canonical_person_id: null, person_name: null, status: 'attended', participant_role: 'attendee', followup_status: 'pending', relationship_note: '', created_at: '2026-10-01T00:00:00Z', deleted_at: null },
      { id: 2, activity_id: 1, person_type: 'recruit', person_id: 20, canonical_person_id: null, person_name: null, status: 'attended', participant_role: 'attendee', followup_status: 'none', relationship_note: '', created_at: '2026-10-01T00:00:01Z', deleted_at: null },
      { id: 3, activity_id: 1, person_type: 'customer', person_id: 799, canonical_person_id: null, person_name: null, status: 'attended', participant_role: 'attendee', followup_status: 'none', relationship_note: '', created_at: '2026-10-01T00:00:02Z', deleted_at: null },
      { id: 4, activity_id: 1, person_type: 'recruit', person_id: 21, canonical_person_id: 805, person_name: null, status: 'attended', participant_role: 'attendee', followup_status: 'none', relationship_note: '', created_at: '2026-10-01T00:00:03Z', deleted_at: null },
      { id: 5, activity_id: 1, person_type: 'customer', person_id: null, canonical_person_id: null, person_name: '现场暂存路人', status: 'invited', participant_role: 'guest', followup_status: 'none', relationship_note: '', created_at: '2026-10-01T00:00:04Z', deleted_at: null },
      { id: 6, activity_id: 2, person_type: 'recruit', person_id: 20, canonical_person_id: null, person_name: null, status: 'attended', participant_role: 'attendee', followup_status: 'done', relationship_note: '', created_at: '2026-09-20T00:00:00Z', deleted_at: null },
      { id: 7, activity_id: 3, person_type: 'customer', person_id: 701, canonical_person_id: null, person_name: null, status: 'attended', participant_role: 'attendee', followup_status: 'done', relationship_note: '', created_at: '2026-09-10T00:00:00Z', deleted_at: null },
    ],
    followups: [], products: [], gifts: [], photos: [], policy_review_reports: [],
    opportunities: [], recruit_followups: [], activity_speakers: [], activity_topics: [], activity_tasks: [],
  };
}

function reset(canned) {
  harness.db = baseDb();
  harness.calls = [];
  harness.queue = (canned || []).map(o => (typeof o === 'string' ? o : JSON.stringify(o)));
}
const OP = { name: 'Victor', gender: '男', birthday: '1976-10' };
function lastUser() { return harness.calls[harness.calls.length - 1].messages.map(m => m.content).join('\n'); }
const IDENT_PERSONS = { source: 'persons', unmapped: false };

// ---------- recruit_recommend / recruit_score ----------
test('recruit_recommend：已映射+冲突候选人，prompt 取 Person 名/学历，业务字段仍取视图，返回 identity', async () => {
  reset([{ suggested_message: '您好', suggested_followup_date: '2026-10-20', nba: { action: 'a', goal: '约面谈' } }]);
  const res = await fn.recruit_recommend.main({ candidate_id: 20, operator: OP });
  assert.ok(!res.error, res.error);
  assert.deepEqual({ source: res.identity.source, unmapped: res.identity.unmapped, person_id: res.identity.person_id },
    { source: 'persons', unmapped: false, person_id: '786' });
  assert.ok(res.identity.conflicts.some(c => c.field === 'name' && c.person === '独立候选人Person' && c.legacy === '独立候选旧名'));
  const user = lastUser();
  assert.match(user, /独立候选人Person/);
  assert.match(user, /Person=独立候选人Person/); // 冲突标注中显式给出 Person 权威值
  // 注意：冲突标注本身会引用旧值作为证据；正文事实区不得再用旧名
  assert.doesNotMatch(user.split('\n\n').slice(1).join('\n\n'), /独立候选旧名/);
  assert.match(user, /学历：硕士/);            // Person 学历覆盖视图旧值
  assert.match(user, /年收入：15万/);          // 增员业务域字段
  assert.match(user, /MBTI：ENTJ/);
});

test('recruit_recommend：未映射候选人走回退 + unmapped 提示，AI 不被引导猜测', async () => {
  reset([{ suggested_message: '您好' }]);
  const res = await fn.recruit_recommend.main({ candidate_id: 21, operator: OP });
  assert.ok(!res.error, res.error);
  assert.equal(res.identity.unmapped, true);
  assert.equal(res.identity.source, 'customers_legacy');
  const user = lastUser();
  assert.match(user, /尚未关联 Person 档案/);
  assert.match(user, /路演来的候选人/);
});

test('recruit_score：评分 prompt Person 化，分数照常回写 recruit_candidates（业务写路径不变）', async () => {
  reset([{ score: 88, reason: '三大理由', risks: '三大风险' }]);
  const res = await fn.recruit_score.main({ candidate_id: 20 });
  assert.ok(!res.error, res.error);
  assert.equal(res.score, 88);
  assert.equal(res.identity.person_id, '786');
  assert.match(lastUser(), /姓名：独立候选人Person/);
  assert.match(lastUser(), /年收入：15万/);
  assert.match(lastUser(), /Person=独立候选人Person/);
  assert.equal(harness.db.recruit_candidates.find(r => r.id === 20).potential_score, 88);
});

// ---------- ai_followup 三入口 ----------
test('ai_followup parse：客户名/职业取 Person，经营阶段取 customers，冲突前置标注；只返回不写库', async () => {
  reset([{ followup_notes: '客户本次明确想了解重疾险', next_followup_date: '2026-10-20', next_followup_goal: '约见面', next_step: '发资料', needs: '重疾', relationship: '升温', new_info: '', stage_change: null, opportunity: null, profile_updates: null }]);
  const before = harness.db.followups.length;
  const res = await fn.ai_followup.main({ action: 'parse', customer_id: 701, text: '今天和张伟喝了茶，他说想给儿子配重疾，约了下周二面谈。' });
  assert.ok(!res.error, res.error);
  assert.equal(res.identity.person_id, '801');
  const user = lastUser();
  assert.match(user, /客户：张伟Person/);
  assert.match(user, /当前经营阶段：需求挖掘/);   // 业务域
  assert.match(user, /职业：医生/);
  assert.match(user, /资料冲突/);
  assert.doesNotMatch(user.split('\n\n').slice(1).join('\n\n'), /张伟旧名/); // 冲突标注之外不用旧名
  assert.equal(harness.db.followups.length, before); // 不写库
});

test('ai_followup parse：未映射客户回退旧名 + unmapped 提示', async () => {
  reset([{ followup_notes: '电话沟通，客户在考虑养老', next_followup_goal: null }]);
  const res = await fn.ai_followup.main({ action: 'parse', customer_id: 702, text: '今天给王会计打了电话，聊了下养老社区的事。' });
  assert.ok(!res.error, res.error);
  assert.equal(res.identity.unmapped, true);
  const user = lastUser();
  assert.match(user, /客户：王未映射/);
  assert.match(user, /尚未关联 Person 档案/);
});

test('ai_followup analyze_profile：姓名/职业 Person 化，爱好/婚况仍取 customers', async () => {
  reset([{ profile_updates: { family: '已婚有一子', events: [] } }]);
  const res = await fn.ai_followup.main({ action: 'analyze_profile', customer_id: 701 });
  assert.ok(!res.error, res.error);
  assert.equal(res.identity.person_id, '801');
  const user = lastUser();
  assert.match(user, /客户：张伟Person/);
  assert.match(user, /职业：医生/);
  assert.match(user, /兴趣爱好：钓鱼/);
  assert.match(user, /婚姻状况：已婚/);
  assert.doesNotMatch(user.split('\n\n').slice(1).join('\n\n'), /张伟旧名/);
});

test('ai_followup analyze_recruit_profile：候选人名/学历取 Person，年收入/婚况取候选人域', async () => {
  reset([{ profile_updates: { career_background: '零售转保险意向', events: [] } }]);
  const res = await fn.ai_followup.main({ action: 'analyze_recruit_profile', candidate_id: 20 });
  assert.ok(!res.error, res.error);
  assert.equal(res.identity.person_id, '786');
  const user = lastUser();
  assert.match(user, /候选人：独立候选人Person/);
  assert.match(user, /学历：硕士/);
  assert.match(user, /年收入：15万/);
  assert.match(user, /婚况：未婚/);
  assert.doesNotMatch(user.split('\n\n').slice(1).join('\n\n'), /独立候选旧名/);
});

// ---------- ai_recommend（AI 生成 + 落库） ----------
test('ai_recommend：ctx 人物字段 Person 化、业务域不动；落库快照名取 Person；历史不被改写', async () => {
  reset([{
    suggested_message: '张医生您好，下周给您带份家庭保障检视资料',
    suggested_strategy: '先安排家庭保单检视',
    suggested_followup_date: '2026-10-20',
    suggested_customer_stage: '需求挖掘',
    suggested_followup_goal: '约见面',
    nba: { action: '约面谈', goal: '约见面', suggested_date: '2026-10-20' },
  }]);
  const res = await fn.ai_recommend.main({ customer_id: 701, operator: OP });
  assert.ok(!res.error, res.error);
  assert.equal(res.identity.person_id, '801');
  const user = lastUser();
  assert.match(user, /"name": "张伟Person"/);
  assert.match(user, /"stage": "需求挖掘"/);
  assert.match(user, /钓鱼/);
  assert.match(user, /30万/);
  assert.doesNotMatch(user, /"name": "张伟旧名"/); // 旧名仅可作为冲突证据，不能再是字段值
  const inserted = harness.db.ai_recommendations.find(r => r.id === res.id);
  assert.equal(inserted.customer_name, '张伟Person');       // 新快照取 Person 当前名
  assert.equal(harness.db.ai_recommendations.find(r => r.id === 1).customer_name, '张伟旧名'); // 历史行不改写
});

// ---------- ai_referral（只建议不写库） ----------
test('ai_referral：ctx Person 化 + identity 回传；不产生任何写入', async () => {
  reset([{ suitable: true, confidence: '高', reason: '服务后关系升温', timing: '本周', approach: '服务后自然提起', message: '张哥，最近有个朋友也在看重疾…', nba: { action: 'a', goal: '推进转介绍' } }]);
  const before = harness.db.ai_recommendations.length;
  const res = await fn.ai_referral.main({ customer_id: 701, operator: OP });
  assert.ok(!res.error, res.error);
  assert.equal(res.identity.person_id, '801');
  assert.equal(res.suggestion.suitable, true);
  assert.match(lastUser(), /张伟Person/);
  assert.doesNotMatch(lastUser(), /"name": "张伟旧名"/);
  assert.equal(harness.db.ai_recommendations.length, before);
});

// ---------- policy_review_reports（AI 生成 + 落库） ----------
test('policy_review_reports generate：ctx 基础资料 Person 化/家庭字段仍取 customers，报告快照名取 Person', async () => {
  reset([{ summary: '综合摘要', gaps_found: '缺口1', recommendations: '建议1', asset_allocation: '配置1', next_action: '下一步1' }]);
  const res = await fn.policy_review_reports.main({ action: 'generate', customer_id: 701, operator: OP });
  assert.ok(!res.error, res.error);
  assert.equal(res.identity.person_id, '801');
  const user = lastUser();
  assert.match(user, /"name": "张伟Person"/);
  assert.match(user, /"marital": "已婚"/);
  assert.match(user, /"stage": "需求挖掘"/);
  assert.doesNotMatch(user, /"name": "张伟旧名"/);
  assert.equal(res.report.customer_name, '张伟Person');
});

// ---------- ai_recommendations 非模型入口 ----------
test('ai_recommendations create（人工保存入口）：不调模型；快照名取 Person；未映射回退客户名', async () => {
  reset([]);
  const r1 = await fn.ai_recommendations.main({ action: 'create', data: { customer_id: 701, suggested_message: '手工建议', nba: { action: 'x', goal: '约见面' } } });
  assert.ok(!r1.error, r1.error);
  assert.equal(harness.db.ai_recommendations.find(r => r.id === r1.id).customer_name, '张伟Person');
  const r2 = await fn.ai_recommendations.main({ action: 'create', data: { customer_id: 702, suggested_message: '手工建议2' } });
  assert.ok(!r2.error, r2.error);
  assert.equal(harness.db.ai_recommendations.find(r => r.id === r2.id).customer_name, '王未映射');
  assert.equal(harness.calls.length, 0); // 非模型入口
});

test('ai_recommendations listAll：Person 当前名与历史快照名都能搜到，历史行不被改写', async () => {
  reset([]);
  const byCurrent = await fn.ai_recommendations.main({ action: 'listAll', page: 1, pageSize: 20, keyword: '张伟Person' });
  assert.equal(byCurrent.total, 1);
  assert.equal(byCurrent.rows[0].id, 1);
  assert.equal(byCurrent.rows[0].customer_name, '张伟旧名'); // 返回的仍是历史快照行原值
  const byLegacy = await fn.ai_recommendations.main({ action: 'listAll', page: 1, pageSize: 20, keyword: '张伟旧名' });
  assert.equal(byLegacy.total, 1);
  const none = await fn.ai_recommendations.main({ action: 'listAll', page: 1, pageSize: 20, keyword: '不存在的人' });
  assert.equal(none.total, 0);
  assert.equal(harness.calls.length, 0);
});

// ---------- ai_activity ----------
test('ai_activity analyze：参与者取名全部 Person 化（含独立候选人/canonical/未映射/暂存回退）；top3 沿用既有透传（G-PMC11-1）', async () => {
  reset([{
    top3: [
      { person_type: 'customer', person_id: 701, name: '张伟Person', reason: 'r', suggested_action: 'a', suggested_message: 'm', suggested_date: '2026-10-15', opportunity_type: '' },
      { person_type: 'recruit', person_id: 20, name: '独立候选人Person', reason: 'r', suggested_action: 'a', suggested_message: 'm', suggested_date: '2026-10-16', opportunity_type: '' },
      { person_type: 'customer', person_id: 999, name: '编造的人', reason: 'x', suggested_action: '', suggested_message: '', suggested_date: '', opportunity_type: '' },
    ],
    no_followup: [{ person_type: 'customer', person_id: 0, name: '现场暂存路人', reason: '库中暂无资料' }],
  }]);
  const res = await fn.ai_activity.main({ action: 'analyze', activity_id: 1 });
  assert.ok(!res.error, res.error);
  // 已知缺口 G-PMC11-1（既有行为，非本包引入，见 evidence/PMC-11.md）：analyze 的 top3/no_followup
  // 仅做 parseInt 透传，不像 participantReview/postReview 那样按参与者 ID 白名单清洗；999 会透传。
  // 本包不扩大范围修改，此处锁定当前行为并在交接中登记。
  assert.deepEqual(res.analysis.top3.map(p => p.person_id), [701, 20, 999]);
  assert.equal(res.analysis.no_followup.length, 1);
  const user = lastUser();
  for (const nm of ['张伟Person', '独立候选人Person', '王五Person', '暂存关联老客户', '现场暂存路人']) assert.match(user, new RegExp(nm));
  assert.doesNotMatch(user, /张伟旧名/);
  assert.doesNotMatch(user, /独立候选旧名/);
  assert.match(user, /阶段：需求挖掘/);  // 客户业务域
  assert.match(user, /阶段：名单/);      // 独立候选人 stage（loadRecruitPeople 修复点）
});

test('ai_activity decompose：筹备上下文参与者取名 Person 化', async () => {
  reset([{ summary: 's', current_stage: 'c', risks: [], priorities: [], suggested_tasks: [] }]);
  const res = await fn.ai_activity.main({ action: 'decompose', activity_id: 1 });
  assert.ok(!res.error, res.error);
  const user = lastUser();
  assert.match(user, /张伟Person/);
  assert.match(user, /独立候选人Person/);
  assert.doesNotMatch(user, /张伟旧名/);
});

test('ai_activity participantReview：事实单与输出分类均取 Person 名；编造 ID 丢弃；遗漏者保守兜底', async () => {
  reset([{
    classifications: [
      { person_type: 'customer', person_id: 701, classification: 'A', reason: '需求明确', next_action: '约面谈', suggested_date: '2026-10-12', channel: '微信', script: '张医生您好', confidence: 'high', evidence: ['阶段：需求挖掘'] },
      { person_type: 'recruit', person_id: 20, classification: 'B', reason: '创业动机强', next_action: '邀创说会', suggested_date: '2026-10-15', channel: '电话', script: '您好', confidence: 'medium', evidence: ['动机：想创业'] },
      { person_type: 'customer', person_id: 999, classification: 'A', reason: '编造', next_action: 'x', suggested_date: '', channel: '微信', script: '', confidence: 'low', evidence: [] },
    ],
  }]);
  const res = await fn.ai_activity.main({ action: 'participantReview', activity_id: 1 });
  assert.ok(!res.error, res.error);
  // 4 个已关联目标：701/20 来自 AI，799/21 由兜底补齐（999 被丢弃）
  assert.equal(res.total, 4);
  const byId = Object.fromEntries(res.classifications.map(c => [c.person_type + ':' + c.person_id, c]));
  assert.equal(byId['customer:701'].name, '张伟Person');
  assert.equal(byId['recruit:20'].name, '独立候选人Person');
  assert.equal(byId['customer:799'].name, '暂存关联老客户');
  assert.equal(byId['recruit:21'].classification, 'E');
  assert.match(lastUser(), /张伟Person/);
  assert.match(lastUser(), /独立候选人Person/);
  assert.doesNotMatch(lastUser(), /张伟旧名/);
});

test('ai_activity postReview：客户/增员行动与机会建议的人名取 Person，编造 ID/重复机会被清洗', async () => {
  reset([{
    summary: '复盘摘要',
    customer_actions: [
      { person_id: 701, priority: 'high', reason: 'r', suggested_action: 'a', suggested_message: 'm', suggested_followup_date: '2026-10-15', suggested_followup_goal: '约见面' },
      { person_id: 999, priority: 'high', reason: '编造', suggested_action: 'x', suggested_message: '', suggested_followup_date: '', suggested_followup_goal: '' },
    ],
    recruit_actions: [{ person_id: 20, priority: 'medium', reason: 'r', suggested_action: 'a', suggested_followup_date: '2026-10-16' }],
    speaker_actions: [], topic_actions: [],
    opportunity_suggestions: [
      { customer_id: 701, opportunity_type: '转介绍', reason: '愿意介绍' },
      { customer_id: 999, opportunity_type: '转介绍', reason: '编造' },
    ],
    next_activity_suggestions: [],
  }]);
  const res = await fn.ai_activity.main({ action: 'postReview', activity_id: 1 });
  assert.ok(!res.error, res.error);
  assert.equal(res.customer_actions.length, 1);
  assert.equal(res.customer_actions[0].person_name, '张伟Person');
  assert.equal(res.recruit_actions[0].person_name, '独立候选人Person');
  assert.equal(res.opportunity_suggestions.length, 1);
  assert.equal(res.opportunity_suggestions[0].customer_name, '张伟Person');
  assert.match(lastUser(), /张伟Person/);
  assert.match(lastUser(), /独立候选人Person/);
  assert.doesNotMatch(lastUser(), /张伟旧名/);
});

test('ai_activity learning：阶段变化候选人姓名取 Person（recruitName 重写）', async () => {
  reset([{ worth_continuing: [{ title: 't', reason: 'r', evidence: 'e', suggestion: 's' }], worth_optimizing: [], worth_reusing: [], worth_trying: [] }]);
  harness.db.recruit_candidates.find(r => r.id === 20).stage = '面谈';
  harness.db.recruit_candidates.find(r => r.id === 20).stage_changed_at = '2026-10-05';
  const res = await fn.ai_activity.main({ action: 'learning', range: '90d' });
  assert.ok(!res.error, res.error);
  assert.equal(res.insufficient, false);
  assert.match(lastUser(), /独立候选人Person→面谈/);
  assert.doesNotMatch(lastUser(), /独立候选旧名→/);
});

// ---------- Context Engine（_shared/context-engine.js，注入同一内存 RDB） ----------
test('context-engine person()：人物档案经 person_id 取 Person，冲突显式标注，业务域保留', async () => {
  reset([]);
  const engine = createContextEngine({ rdb: stubRdb });
  const p = await engine.buildContext({ recipe: 'person_basic', subjectType: 'customer', subjectId: 701 });
  assert.equal(p.context.person.data.person_profile.display_name, '张伟Person');
  assert.equal(p.context.person.data.identity.person_id, '801');
  assert.ok(p.context.person.data.identity.conflicts.some(c => c.field === 'name'));
  assert.equal(p.context.person.data.customer_stage, '需求挖掘');

  const u = await engine.buildContext({ recipe: 'person_basic', subjectType: 'customer', subjectId: 702 });
  assert.equal(u.context.person.data.person_profile, null);
  assert.equal(u.context.person.data.identity.unmapped, true);
});

test('context-engine activity_review：canonical/精确外键解析 person_id，姓名绝不作为身份证据', async () => {
  reset([]);
  const engine = createContextEngine({ rdb: stubRdb });
  const built = await engine.buildContext({ recipe: 'activity_review', subjectType: 'activity', subjectId: 1 });
  const parts = built.context.participants;
  const resolved = Object.fromEntries(parts.map(r => [`${r.data.person_type || 'none'}:${r.data.person_id}`, r.data.resolved_person_id || null]));
  assert.equal(resolved['customer:701'], 801);  // legacy_customer_id 精确回退
  assert.equal(resolved['recruit:20'], 786);   // recruit_candidates.person_id
  assert.equal(resolved['recruit:21'], 805);   // canonical_person_id 优先
  assert.equal(resolved['customer:799'], null); // 未映射不猜测
  const personIds = built.context.persons.map(r => Number(r.data.id)).sort((a, b) => a - b);
  assert.deepEqual(personIds, [786, 801, 805]);
});
