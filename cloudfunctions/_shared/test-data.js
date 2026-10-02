/** WP02: bounded read-only provenance. Never filters or mutates business rows. */
'use strict';
const TABLES = new Set(["actions","activities","activity_participants","activity_speakers","activity_tasks","activity_topics","ai_recommendations","ai_results","ai_runs","ai_tasks","assistant_action_commands","commitments","context_items","customers","followups","gifts","household_members","households","interactions","knowledge_items","learnings","ocr_records","opportunities","opportunity_candidates","outcomes","person_roles","persons","photos","playbooks","policy_review_reports","products","recruit_candidates","recruit_followups","recruit_goal_benchmarks","recruit_goals","recruit_milestones","relationships"]);
const MARKER = '【系统测试·勿联系】';
const BATCH = /^crm_test_[a-z0-9][a-z0-9_]{0,47}$/;
const EMPTY = () => ({ status:'verified', containsTestData:false, recordCount:0, sources:[] });
function refsForRows(table, rows) {
  if (!TABLES.has(table)) throw new Error('Invalid test source');
  return (rows || []).map(row => ({ table, id:String(row.Id ?? row.id ?? '') }))
    .filter(ref => /^[a-zA-Z0-9_-]{1,128}$/.test(ref.id));
}
function collectRefs(value) {
  const refs = new Map();
  const add = (table, id) => {
    if (TABLES.has(table) && /^[a-zA-Z0-9_-]{1,128}$/.test(String(id ?? ''))) {
      refs.set(table + ':' + id, { table, id:String(id) });
    }
  };
  function visit(item, depth) {
    if (depth > 15 || item == null) return;
    if (typeof item === 'string') {
      const match = /^public\.([a-z_]+)#([a-zA-Z0-9_-]{1,128})$/.exec(item);
      if (match) add(match[1], match[2]);
      return;
    }
    if (typeof item !== 'object') return;
    if (item.schema === 'public' && item.table) add(item.table, item.id);
    for (const entry of Object.values(item)) visit(entry, depth + 1);
  }
  visit(value, 0);
  return [...refs.values()];
}
function normalize(value) {
  const v = Array.isArray(value) && value.length === 1 ? value[0] : value;
  if (v?.status !== 'verified' || typeof v.containsTestData !== 'boolean' ||
      !Number.isSafeInteger(v.recordCount) || v.recordCount < 0 || !Array.isArray(v.sources) ||
      v.sources.length > 2000 || v.sources.some(s => !BATCH.test(s.batchKey) ||
      !TABLES.has(s.table) || !Number.isSafeInteger(s.count) || s.count < 1) ||
      v.containsTestData !== (v.recordCount > 0) || v.containsTestData !== (v.sources.length > 0)) {
    throw new Error('Invalid test disclosure');
  }
  return { status:'verified', containsTestData:v.containsTestData, recordCount:v.recordCount,
    sources:v.sources.map(s => ({batchKey:s.batchKey,table:s.table,count:s.count})) };
}
async function disclose(refs = [], { rdb, scope = 'refs' } = {}) {
  try {
    if (!['refs','funnel'].includes(scope) || !Array.isArray(refs)) throw new Error('Invalid scope');
    const unique = new Map();
    for (const ref of refs) {
      if (!TABLES.has(ref.table) || !/^[a-zA-Z0-9_-]{1,128}$/.test(String(ref.id))) throw new Error('Invalid reference');
      unique.set(ref.table + ':' + ref.id, {table:ref.table,id:String(ref.id)});
    }
    const list = [...unique.values()];
    if (list.length > 20000) throw new Error('Test disclosure limit');
    if (!list.length && scope === 'refs') return EMPTY();
    const db = rdb || require('./db').rdb;
    const total = EMPTY(), groups = new Map();
    for (let i = 0; i < Math.max(list.length, 1); i += 2000) {
      const response = await db.rpc('crm_test_disclosure_v1', {p_refs:list.slice(i,i+2000),p_scope:scope});
      if (response?.error) throw new Error('Test disclosure unavailable');
      const summary = normalize(response?.data);
      total.recordCount += summary.recordCount;
      for (const s of summary.sources) {
        const key = s.batchKey + ':' + s.table;
        const prior = groups.get(key);
        groups.set(key, {...s, count:s.count + (prior?.count || 0)});
      }
    }
    total.sources = [...groups.values()];
    total.containsTestData = total.recordCount > 0;
    return total;
  } catch (_) {
    return { status:'unverified', containsTestData:null, recordCount:null, sources:[] };
  }
}
function message(summary) {
  if (!summary || summary.status !== 'verified') return '测试数据标记暂未核验，请勿将结果直接作为真实经营结论。';
  if (!summary.containsTestData) return '';
  return '含测试数据 · ' + summary.recordCount + ' 条来源记录 · ' +
    summary.sources.map(s => s.batchKey + ' / public.' + s.table + ' (' + s.count + ')').join('；') +
    '。' + MARKER + ' 样本参与普通计算，禁止真实外发；数量为来源记录数，不等于业务指标。';
}
function withMessages(messages, summary) {
  const note = message(summary);
  return note ? [{role:'system',content:note + ' 必须说明虚构来源，不得把测试结果当作真实客户事实或执行联系。'},...messages] : messages;
}
module.exports = { TABLES, MARKER, BATCH, EMPTY, refsForRows, collectRefs, normalize, disclose, message, withMessages };

