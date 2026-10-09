/**
 * PMC-15 隔离测试：角色派生 + 人与人关系/家庭治理。
 *
 * 性质：纯离线（不触线上、不调模型、不读写数据库）。
 * 覆盖：
 *  A. migration/rollback 静态契约（派生函数证据规则、5 触发器、精确对账、
 *     relationships 治理列/词表/确认一致性、crm_search 只认 confirmed、可逆回滚）。
 *  B. 真实模块行为：context-engine（两副本）activity_review 只取 confirmed 边，
 *     pending 候选不外泄；meeting-prep 双向读取均带 confirmed 过滤。
 *  C. 边界：cloudfunctions 内不存在 relationships 写入路径；
 *     person_360 关系表仅 GET；前端角色可解释（8 角色 + derived 来源，中英字典）。
 *
 * 运行：node --test tests/pmc/pmc15-roles-relationships.test.cjs
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const MIGRATION = read('cloudbase/migrations/20261009220000_pmc15_role_derivation_relationship_governance.sql');
const ROLLBACK = read('cloudbase/rollbacks/20261009220000_pmc15_role_derivation_relationship_governance.rollback.sql');
const between = (text, openTag, closeTag = openTag) => {
  const start = text.indexOf(openTag);
  assert.ok(start >= 0, `missing ${openTag}`);
  const end = text.indexOf(closeTag, start + openTag.length);
  assert.ok(end >= 0, `missing closing ${closeTag}`);
  return text.slice(start, end);
};
const DERIVE_BODY = between(MIGRATION, '$derive$');
const SYNC_BODY = between(MIGRATION, '$sync$');

// ---------- A. migration 静态契约 ----------
test('A1 派生函数：四类业务角色的证据规则与 legacy 桥，人工标签永不触碰', () => {
  for (const role of ['customer', 'recruit', 'speaker', 'participant']) {
    assert.ok(DERIVE_BODY.includes(`'${role}'`), `derive must handle ${role}`);
  }
  // customer 证据包含直接 person_id 与 legacy_customer_id 桥双路径
  assert.match(DERIVE_BODY, /c\.person_id\s*=\s*p_person_id/);
  assert.match(DERIVE_BODY, /pp\.legacy_customer_id\s*=\s*c\."Id"/);
  // recruit/speaker/participant 分别锚定有效业务记录
  assert.match(DERIVE_BODY, /FROM public\.recruit_candidates rc[\s\S]*rc\.person_id\s*=\s*p_person_id/);
  assert.match(DERIVE_BODY, /FROM public\.activity_speakers s[\s\S]*s\.person_id\s*=\s*p_person_id/);
  assert.match(DERIVE_BODY, /FROM public\.activity_participants ap[\s\S]*ap\.canonical_person_id\s*=\s*p_person_id/);
  // 所有证据都要求 deleted_at IS NULL
  const evidenceChecks = DERIVE_BODY.match(/deleted_at IS NULL/g) || [];
  assert.ok(evidenceChecks.length >= 4, 'all evidence must require active records');
  // 缺失即删除（重算语义），补入统一 origin='derived'
  assert.match(DERIVE_BODY, /DELETE FROM public\.person_roles[\s\S]{0,120}'customer'/);
  assert.ok((DERIVE_BODY.match(/'derived'/g) || []).length >= 4);
  // 人工标记角色绝不出现在派生函数体内
  for (const human of ['partner', 'referrer', 'alumni', "'other'"]) {
    assert.ok(!DERIVE_BODY.includes(human), `derive must never touch human tag ${human}`);
  }
  // 软删 Person 不持派生角色
  assert.match(DERIVE_BODY, /deleted_at IS NOT NULL[\s\S]{0,200}role IN \('customer', 'recruit', 'speaker', 'participant'\)/);
});

test('A2 同步触发器：5 个 AFTER 触发器挂在正确的表与列上', () => {
  const expect = [
    ['crm_person_role_customers_sync', 'customers', /AFTER INSERT OR UPDATE OF person_id, deleted_at OR DELETE/],
    ['crm_person_role_recruits_sync', 'recruit_candidates', /AFTER INSERT OR UPDATE OF person_id, deleted_at OR DELETE/],
    ['crm_person_role_speakers_sync', 'activity_speakers', /AFTER INSERT OR UPDATE OF person_id, deleted_at OR DELETE/],
    ['crm_person_role_participants_sync', 'activity_participants', /AFTER INSERT OR UPDATE OF canonical_person_id, deleted_at OR DELETE/],
    ['crm_person_role_persons_sync', 'persons', /AFTER UPDATE OF legacy_customer_id, deleted_at/],
  ];
  for (const [name, table, timing] of expect) {
    const re = new RegExp(`CREATE TRIGGER ${name}[\\s\\S]{0,160}?ON public\\.${table}[\\s\\S]{0,160}?FOR EACH ROW`);
    const block = MIGRATION.match(re);
    assert.ok(block, `trigger ${name} on ${table} missing`);
    assert.ok(timing.test(block[0]), `${name} timing/columns mismatch: ${block[0]}`);
    assert.ok(SYNC_BODY.includes('crm_person_roles_derive_v1'));
  }
  // 触发器函数是 SECURITY DEFINER 且不向 public 放权
  assert.match(MIGRATION, /CREATE OR REPLACE FUNCTION public\.crm_person_role_sync_v1\(\)[\s\S]{0,120}SECURITY DEFINER/);
  assert.match(MIGRATION, /REVOKE ALL ON FUNCTION public\.crm_person_role_sync_v1\(\)/);
});

test('A3 一次性对账：精确漂移断言（703/792 失效，777 补 customer+recruit），含业务证据', () => {
  assert.match(MIGRATION, /v_stale <> ARRAY\[703::bigint, 792::bigint\]/);
  assert.match(MIGRATION, /v_missing_count <> 2/);
  assert.match(MIGRATION, /v_total <> 799/);
  assert.match(MIGRATION, /"Id" = 785 AND person_id = 777/);
  assert.match(MIGRATION, /id = 17 AND person_id = 777/);
  assert.match(MIGRATION, /DELETE FROM public\.person_roles WHERE id IN \(703, 792\)/);
  assert.match(MIGRATION, /\(777, 'customer', 'derived'\), \(777, 'recruit', 'derived'\)/);
});

test('A4 relationships 治理列：来源/状态/确认元数据 + 词表 + 一致性 CHECK，默认 pending', () => {
  assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'[\s\S]{0,120}'manual', 'ai_suggested', 'legacy_note'/);
  assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'[\s\S]{0,120}'pending', 'confirmed'/);
  assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS confirmed_at timestamptz/);
  assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS confirmed_by_uid text/);
  assert.match(MIGRATION, /relationships_type_vocab_check[\s\S]{0,200}'family', 'friend', 'colleague', 'business', 'referral', 'other'/);
  assert.match(MIGRATION, /relationships_confirmation_check[\s\S]{0,120}'pending'[\s\S]{0,120}confirmed_at IS NULL[\s\S]{0,200}'confirmed'[\s\S]{0,120}confirmed_at IS NOT NULL/);
  // 边界注释：家庭角色与投保角色不混入关系类型
  assert.match(MIGRATION, /household_members[\s\S]{0,200}policyholder/i);
});

test('A5 crm_search_people_v1：走弱关系模板的两处查询都只计 confirmed 边', () => {
  const searchBody = between(MIGRATION, '$function$');
  const confirmedHits = searchBody.match(/rel\.status = 'confirmed'|r\.status = 'confirmed'/g) || [];
  assert.equal(confirmedHits.length, 2);
  // 家庭模板仍然只认 confirmed_at（成员确认机制未变）
  assert.ok(searchBody.includes('hm.confirmed_at IS NOT NULL'));
});

test('A6 迁移不触碰禁线：无 DROP TABLE/VIEW、无 CASCADE、无 pr schema', () => {
  assert.ok(!/DROP\s+(TABLE|VIEW)/i.test(MIGRATION));
  assert.ok(!/CASCADE/i.test(MIGRATION));
  assert.ok(!/\bpr\./.test(MIGRATION.replace(/policy_review_reports/g, '')));
  assert.ok(MIGRATION.includes('public.person_roles'));
});

// ---------- rollback 静态契约 ----------
test('A7 rollback 精确可逆：撤对账、卸触发器/函数、恢复 origin 词表、删治理列前有守卫', () => {
  for (const name of ['crm_person_role_persons_sync', 'crm_person_role_participants_sync',
    'crm_person_role_speakers_sync', 'crm_person_role_recruits_sync', 'crm_person_role_customers_sync']) {
    assert.match(ROLLBACK, new RegExp(`DROP TRIGGER IF EXISTS ${name}`));
  }
  assert.match(ROLLBACK, /DROP FUNCTION IF EXISTS public\.crm_person_role_sync_v1\(\)/);
  assert.match(ROLLBACK, /DROP FUNCTION IF EXISTS public\.crm_person_roles_derive_v1\(bigint\)/);
  // 先守卫：已有 confirmed/非 manual 数据则拒绝回滚
  assert.match(ROLLBACK, /source <> 'manual' OR status <> 'pending'/);
  assert.match(ROLLBACK, /DROP COLUMN IF EXISTS confirmed_by_uid[\s\S]{0,160}DROP COLUMN IF EXISTS source/);
  // origin 词表恢复为两项
  assert.match(ROLLBACK, /CHECK \(origin IN \('manual', 'legacy_backfill'\)\)/);
  // 反向对账：删 777 派生两行、按原 id 重建 703/792、校正序列
  assert.match(ROLLBACK, /person_id = 777 AND role IN \('customer', 'recruit'\) AND origin = 'derived'/);
  assert.match(ROLLBACK, /SELECT 703, 768, 'customer', 'legacy_backfill'/);
  assert.match(ROLLBACK, /SELECT 792, 773, 'participant', 'legacy_backfill'/);
  assert.match(ROLLBACK, /pg_get_serial_sequence\('public\.person_roles', 'id'\)/);
  // 回滚后的搜索函数恢复为无 status 过滤
  const rbSearch = between(ROLLBACK, '$function$');
  assert.ok(!rbSearch.includes("status = 'confirmed'"));
});

// ---------- B. 真实模块行为 ----------
function fakeRdb(data) {
  const calls = [];
  const rdb = { from(table) {
    const call = { table, filters: {}, limit: null };
    calls.push(call);
    const chain = {
      select(fields) { call.fields = fields.split(','); return this; },
      eq(field, value) { call.filters[field] = value; return this; },
      is(field, value) { call.filters[field] = value; return this; },
      in(field, values) { call.filters[field] = values; return this; },
      order() { return this; },
      limit(value) { call.limit = value; return this; },
      then(resolve, reject) {
        const rows = (data[table] || []).filter(row =>
          Object.entries(call.filters).every(([field, value]) => Array.isArray(value)
            ? value.includes(row[field]) : row[field] === value)).slice(0, call.limit || undefined);
        const selected = rows.map(row => Object.fromEntries(
          (call.fields || Object.keys(row)).filter(f => Object.hasOwn(row, f)).map(f => [f, row[f]])));
        return Promise.resolve({ data: selected }).then(resolve, reject);
      },
    };
    return chain;
  } };
  return { rdb, calls };
}

test('B1 context-engine：activity_review 只下发 status=confirmed，pending 候选不进上下文', async () => {
  const { createContextEngine } = require(path.join(ROOT, 'cloudfunctions/_shared/context-engine.js'));
  const data = {
    activities: [{ id: 11, name: '活动', deleted_at: null }],
    activity_tasks: [],
    activity_participants: [{ id: 12, activity_id: 11, canonical_person_id: 7, deleted_at: null }],
    persons: [{ id: 7, display_name: '甲', deleted_at: null }],
    interactions: [], actions: [], opportunities: [],
    relationships: [
      { id: 18, from_person_id: 7, to_person_id: 8, trend: 'improving', status: 'confirmed', source: 'manual', deleted_at: null },
      { id: 19, from_person_id: 7, to_person_id: 9, trend: 'improving', status: 'pending', source: 'ai_suggested', deleted_at: null },
    ],
  };
  const { rdb, calls } = fakeRdb(data);
  const engine = createContextEngine({ rdb, now: () => new Date('2026-10-09T12:00:00Z') });
  const built = await engine.buildContext({ recipe: 'activity_review', subjectType: 'activity', subjectId: 11 });
  const relCalls = calls.filter(c => c.table === 'relationships');
  assert.equal(relCalls.length, 1);
  assert.equal(relCalls[0].filters.status, 'confirmed');
  assert.ok(relCalls[0].fields.includes('status') && relCalls[0].fields.includes('source'));
  assert.deepEqual(built.context.relationships.map(r => r.data.id), [18]);
  assert.equal(built.context.relationships[0].data.status, 'confirmed');
});

test('B2 ai_activity 副本与 _shared/context-engine.js 完全一致（手动同步无漂移）', () => {
  const a = fs.readFileSync(path.join(ROOT, 'cloudfunctions/_shared/context-engine.js'));
  const b = fs.readFileSync(path.join(ROOT, 'cloudfunctions/ai_activity/context-engine.js'));
  assert.equal(crypto.createHash('sha256').update(b).digest('hex'),
    crypto.createHash('sha256').update(a).digest('hex'));
});

test('B3 meeting-prep：双向 relationships 请求均带 eq.confirmed，pending 行不进入 relationship 输出', async () => {
  const { MeetingPrepContextBuilder } =
    require(path.join(ROOT, 'cloudfunctions/person_360/meeting-prep-context.js'));
  const calls = [];
  async function request(table, method, filters) {
    calls.push({ table, method, filters });
    if (table === 'persons') {
      return filters.id === 'eq.1'
        ? [{ id: 1, display_name: '甲', occupation: null, organization: null, legacy_customer_id: null }]
        : [{ id: 2, display_name: '乙' }, { id: 3, display_name: '丙' }];
    }
    if (table === 'relationships') {
      // 模拟 PostgREST 严格过滤：无 confirmed 条件时本可返回两行
      if (filters.status !== 'eq.confirmed') throw new Error('relationships must filter confirmed');
      if (filters.from_person_id) {
        return [{ id: 5, from_person_id: 1, to_person_id: 2, relationship_type: 'colleague', status: 'confirmed', source: 'manual' }];
      }
      // 入边：只有一条 pending 候选 -> confirmed 过滤后为空
      return [];
    }
    if (table === 'households' || table === 'household_members') return [];
    if (table === 'context_items') return [];
    if (table === 'opportunities') return [];
    if (table === 'actions' || table === 'commitments') return [];
    throw new Error(`Unexpected source: ${table}`);
  }
  const builder = new MeetingPrepContextBuilder({
    request,
    listInteractions: async () => ({ rows: [] }),
    insuranceContext: async () => ({ existingCoverage: [], openOpportunities: [], nextActions: [] }),
  });
  const context = await builder.build(1);
  const relCalls = calls.filter(c => c.table === 'relationships');
  assert.equal(relCalls.length, 2);
  assert.ok(relCalls.every(c => c.filters.status === 'eq.confirmed'));
  assert.ok(relCalls.some(c => c.filters.from_person_id === 'eq.1'));
  assert.ok(relCalls.some(c => c.filters.to_person_id === 'eq.1'));
  assert.deepEqual(context.relationship.map(r => r.other_person_id), [2]);
  assert.equal(context.relationship[0].direction, 'outgoing');
});

// ---------- C. 边界 ----------
test('C1 cloudfunctions 全树不存在 relationships 的应用层写入路径', () => {
  const dir = path.join(ROOT, 'cloudfunctions');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.js') ? [p] : []);
  });
  for (const file of walk(dir)) {
    const text = fs.readFileSync(file, 'utf8');
    const re = /\.from\(\s*['"]relationships['"]\s*\)([\s\S]{0,300}?)/g;
    let m;
    while ((m = re.exec(text))) {
      assert.ok(!/\.(insert|update|delete)\(/.test(m[1]),
        `${path.relative(ROOT, file)} appears to write relationships`);
    }
  }
  // person_360 的通用表入口：relationships 仅 GET 白名单
  const p360 = read('cloudfunctions/person_360/index.js');
  assert.match(p360, /RELATIONSHIP_READ_TABLES[\s\S]{0,200}relationships/);
});

test('C2 前端角色可解释：8 类角色标签 + derived 来源 + 中英 i18n 齐全', () => {
  const profile = read('crm/js/modules/person-profile.js');
  for (const role of ['partner', 'referrer', 'alumni', 'other']) {
    assert.ok(profile.includes(role), `person-profile missing role label ${role}`);
  }
  assert.match(profile, /derived:'业务派生'/);
  assert.match(profile, /自动派生/);

  const people = read('crm/js/modules/console/pages/people.js');
  for (const role of ['customer', 'recruit', 'speaker', 'participant', 'partner', 'referrer', 'alumni', 'other']) {
    assert.match(people, new RegExp(`\\b${role}\\s*:\\s*\\[t\\(`));
  }
  const i18n = read('crm/js/modules/console/i18n.js');
  for (const key of ['participant', 'role_partner', 'role_referrer', 'role_alumni', 'role_other']) {
    const re = new RegExp(`'${key}':\\s*\\{\\s*'zh-CN':\\s*'[^']+',\\s*'en':\\s*'[^']+'\\s*\\}`);
    assert.ok(re.test(i18n), `i18n key ${key} must have zh-CN and en`);
  }
});
