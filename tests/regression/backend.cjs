'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const marker = '[CRM_TEST_ONLY]';
function database() {
  const c = { Id: 910001, customer_name: marker + '客户甲', deleted_at: null };
  const f = { Id: 920001, customer_id: c.Id, followup_notes: marker + '最近跟进', followup_date: '2026-09-20', deleted_at: null };
  const rc = { candidate_id: 930001, customer_id: c.Id, customer_name: marker + '候选人甲', stage: '新增人才' };
  return {
    customers: [c, { ...c, Id: 910002, customer_name: marker + '客户乙' }, { ...c, Id: 910099, deleted_at: '2026-09-20T00:00:00Z' }],
    followups: [f, { ...f, Id: 920002, followup_date: '2026-09-19' }, { ...f, Id: 920099, deleted_at: '2026-09-20T00:00:00Z' }, { ...f, Id: 920098, customer_id: 910002 }],
    opportunities: [{ id: 960001, customer_id: c.Id, status: '沟通', opportunity_type: '家庭保障', deleted_at: null }, { id: 960099, customer_id: c.Id, deleted_at: '2026-09-20T00:00:00Z' }],
    activities: [{ id: 940001, name: marker + '活动甲', deleted_at: null }, { id: 940099, name: marker + '已删除活动', deleted_at: '2026-09-20T00:00:00Z' }],
    activity_participants: [{ id: 970001, activity_id: 940001, person_type: 'customer', person_id: c.Id, person_name: c.customer_name, deleted_at: null }],
    recruit_candidates: [{ id: rc.candidate_id, customer_id: c.Id, deleted_at: null }],
    v_recruit_candidates: [rc], v_recruit_candidates_trash: [{ ...rc, candidate_id: 930099, candidate_deleted_at: '2026-09-20T00:00:00Z', customer_deleted_at: null }],
    recruit_milestones: [{ id: 980001, candidate_id: rc.candidate_id, stage: '新增人才' }],
    recruit_followups: [{ id: 950001, candidate_id: rc.candidate_id, followup_notes: marker + '增员跟进', deleted_at: null }],
    products: [], gifts: [], photos: [], ai_recommendations: [], policy_review_reports: [], ocr_records: []
  };
}

// Minimal in-memory query adapter, not a PostgreSQL emulator. Unsupported APIs fail closed.
function createReadOnlyDb(data) {
  const reads = [], writes = [];
  function from(table) {
    const name = table.startsWith('public.') ? table.slice(7) : table;
    if (name.includes('.') || name.startsWith('pr_') || !Object.hasOwn(data, name)) throw new Error('TABLE_NOT_ALLOWED: ' + table);
    reads.push('public.' + name);
    let filters = [], sorts = [], start = 0, end = Infinity, single = false, columns, count;
    const query = {
      select(value, options) { columns = value; count = options?.count; return query; },
      eq(key, value) { filters.push(row => row[key] === value); return query; },
      is(key, value) { filters.push(row => value === null ? row[key] == null : row[key] === value); return query; },
      not(key, op, value) { if (op !== 'is' || value !== null) throw new Error('Unsupported not'); filters.push(row => row[key] != null); return query; },
      in(key, values) { filters.push(row => values.includes(row[key])); return query; },
      order(key, options = {}) { sorts.push([key, options]); return query; },
      limit(value) { end = value; return query; },
      range(a, b) { start = a; end = b + 1; return query; },
      maybeSingle() { single = true; return query; },
      single() { single = true; return query; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          let rows = structuredClone(data[name]).filter(row => filters.every(f => f(row)));
          rows.sort((a, b) => {
            for (const [key, options] of sorts) {
              const av = a[key], bv = b[key];
              if (av == null && bv == null) continue;
              if (av == null) return options.nullsFirst === true ? -1 : 1;
              if (bv == null) return options.nullsFirst === true ? 1 : -1;
              if (av !== bv) return (av < bv ? -1 : 1) * (options.ascending === false ? -1 : 1);
            }
            return 0;
          });
          const total = rows.length;
          rows = rows.slice(start, end);
          if (columns && columns !== '*') rows = rows.map(row => Object.fromEntries(columns.split(',').map(k => [k.trim(), row[k.trim()]])));
          return { data: single ? rows[0] || null : rows, error: null, ...(count ? { count: total } : {}) };
        }).then(resolve, reject);
      }
    };
    for (const method of ['insert', 'update', 'upsert', 'delete', 'rpc']) query[method] = () => {
      writes.push({ table: 'public.' + name, method });
      throw new Error('WRITE_BLOCKED: public.' + name + '.' + method);
    };
    return query;
  }
  return { from, reads, writes };
}

async function invoke(root, name, event, data = database()) {
  if (!['customers', 'followups', 'opportunities', 'activities', 'recruit_candidates', 'recruit_followups'].includes(name)) throw new Error('FUNCTION_NOT_ALLOWED');
  if (!['list', 'get', 'trashList', 'funnel', 'rcMap'].includes(event.action)) throw new Error('ACTION_NOT_READ_ONLY');
  const rdb = createReadOnlyDb(data);
  const exports = {};
  const db = { rdb, assertOk: r => { if (r.error) throw new Error(r.error.message); return r; },
    nowIso: () => '2026-09-21T00:00:00Z', normFields: (value, fields) => Object.fromEntries(Object.entries(value).filter(([key]) => fields.includes(key))) };
  const context = vm.createContext({ exports, console: { log() {}, warn() {}, error() {} },
    require: dependency => { if (dependency !== './db') throw new Error('DEPENDENCY_NOT_ALLOWED: ' + dependency); return db; } });
  new vm.Script(fs.readFileSync(path.join(root, 'cloudfunctions', name, 'index.js'), 'utf8'), { filename: name + '/index.js' }).runInContext(context, { timeout: 2000 });
  const result = await exports.main(event, {});
  return { result, reads: rdb.reads, writes: rdb.writes };
}

module.exports = async function backend(root, test) {
  const run = async (name, event, data) => {
    const r = await invoke(root, name, event, data);
    assert.equal(r.writes.length, 0, 'Read action attempted writes: ' + JSON.stringify(r.writes));
    assert.ok(!r.result.error, r.result.error);
    return r.result;
  };
  const check = (id, title, fn) => test(id, title, 'actual cloud function / in-memory read-only adapter', fn);
  await check('backend.customers', '客户列表排除软删除、搜索及分页', async () => {
    const r = await run('customers', { action: 'list', pageSize: 1, sortField: 'Id', sortDir: 'asc' });
    assert.equal(r.total, 2); assert.equal(r.rows.length, 1); assert.equal(r.rows[0].Id, 910001);
    const search = await run('customers', { action: 'list', keyword: '客户乙' });
    assert.equal(search.rows.length, 1); assert.equal(search.rows[0].Id, 910002);
  });
  await check('backend.customer-detail', '客户详情关联正确跟进且排除软删除', async () => {
    const r = await run('customers', { action: 'get', id: 910001 });
    assert.equal(r.customer.Id, 910001);
    assert.deepEqual(Array.from(r.followups, x => x.Id), [920001, 920002]);
  });
  await check('backend.followups', '跟进查询按客户隔离、日期倒序', async () => {
    const r = await run('followups', { action: 'list', customer_id: 910001 });
    assert.deepEqual(Array.from(r.rows, x => x.Id), [920001, 920002]);
  });
  await check('backend.opportunities', '机会列表按客户隔离且排除软删除', async () => {
    const r = await run('opportunities', { action: 'list', customer_id: 910001 });
    assert.deepEqual(Array.from(r.rows, x => x.id), [960001]);
  });
  await check('backend.activities', '活动列表排除软删除', async () => {
    const r = await run('activities', { action: 'list' });
    assert.deepEqual(Array.from(r.rows, x => x.id), [940001]);
  });
  await check('backend.activity-detail', '活动详情与已具名参与人读取', async () => {
    const r = await run('activities', { action: 'get', id: 940001 });
    assert.equal(r.activity.id, 940001); assert.equal(r.participants[0].person_id, 910001);
  });
  await check('backend.activity-readonly', '活动详情缺姓名旧记录：读取不应尝试写入', async () => {
    const data = database(); data.activity_participants[0].person_name = null;
    const result = await run('activities', { action: 'get', id: 940001 }, data);
    assert.equal(result.participants[0].person_name, data.customers[0].customer_name);
    assert.equal(data.activity_participants[0].person_name, null);
  });
  await check('backend.recruit', '增员列表和详情使用候选人ID关联里程碑', async () => {
    const list = await run('recruit_candidates', { action: 'list', keyword: '候选人甲' });
    assert.equal(list.total, 1);
    const r = await run('recruit_candidates', { action: 'get', id: 930001 });
    assert.equal(r.candidate.customer_id, 910001); assert.equal(r.milestones[0].candidate_id, 930001);
  });
  await check('backend.recruit-followups', '增员跟进绑定候选人', async () => {
    const r = await run('recruit_followups', { action: 'list', candidate_id: 930001 });
    assert.equal(r.rows[0].candidate_id, 930001);
  });
  await check('backend.recycle', '客户与增员回收站只读列表', async () => {
    const c = await run('customers', { action: 'trashList' });
    assert.deepEqual(Array.from(c.rows, x => x.Id), [910099]);
    const r = await run('recruit_candidates', { action: 'trashList' });
    assert.equal(r.rows[0].candidate_id, 930099);
  });
  await check('backend.not-found', '客户、活动、增员缺失ID返回错误', async () => {
    for (const name of ['customers', 'activities', 'recruit_candidates']) {
      const r = await invoke(root, name, { action: 'get', id: 999999 });
      assert.ok(r.result.error); assert.equal(r.writes.length, 0);
    }
  });
  await check('guard.boundaries', '测试适配器拒绝非public、写操作和未知函数', async () => {
    const db = createReadOnlyDb(database());
    assert.throws(() => db.from('pr.customers'), /TABLE_NOT_ALLOWED/);
    assert.throws(() => db.from('pr_customers'), /TABLE_NOT_ALLOWED/);
    assert.throws(() => db.from('public.customers').delete(), /WRITE_BLOCKED/);
    await assert.rejects(invoke(root, 'pr_customers', { action: 'list' }), /FUNCTION_NOT_ALLOWED/);
    await assert.rejects(invoke(root, 'customers', { action: 'remove', id: 910001 }), /ACTION_NOT_READ_ONLY/);
  });
};
