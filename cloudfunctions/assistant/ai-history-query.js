/** Source-separated, bounded public AI history. No model calls or business writes. */
'use strict';

const GOALS = ['建立联系','约见面','邀请活动','获取家庭信息','推进签单','推进招募','推进转介绍'];
function invalid() { const e = new Error('Invalid AI history filters'); e.code = 'INVALID_INPUT'; throw e; }
function id(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) invalid();
  const text = String(value ?? '');
  if (!/^[1-9][0-9]{0,18}$/.test(text) || BigInt(text) > 9223372036854775807n) invalid();
  return text;
}
function day(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      value > '9998-12-31' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) invalid();
  return value;
}
function validateHistory(filters) {
  const allowed = ['source','page','limit','personId','type','startDate','endDate','dateField','sortDir'];
  if (!filters || typeof filters !== 'object' || Array.isArray(filters) || Object.keys(filters).some(k => !allowed.includes(k))) invalid();
  const source = filters.source ?? 'runtime', page = filters.page ?? 1, limit = filters.limit ?? 20;
  if (!['runtime','legacy'].includes(source) || !Number.isInteger(page) || page < 1 || page > 10000 ||
      !Number.isInteger(limit) || limit < 1 || limit > 50) invalid();
  const type = filters.type == null || filters.type === '' ? null : filters.type;
  if (type != null && (typeof type !== 'string' || (source === 'runtime'
    ? !/^[a-z][a-z0-9_]{0,79}$/.test(type) : !GOALS.includes(type)))) invalid();
  const startDate = day(filters.startDate), endDate = day(filters.endDate);
  if (startDate && endDate && startDate > endDate) invalid();
  if (filters.dateField !== undefined && !(source === 'runtime' ? ['created_at']
    : ['recommendation_date','suggested_followup_date']).includes(filters.dateField)) invalid();
  if (filters.sortDir !== undefined && !['asc','desc'].includes(filters.sortDir)) invalid();
  return { source, page, limit, type, startDate, endDate,
    ...(filters.dateField !== undefined ? {dateField:filters.dateField} : {}),
    ...(filters.sortDir !== undefined ? {sortDir:filters.sortDir} : {}),
    personId: filters.personId == null || filters.personId === '' ? null : id(filters.personId) };
}
function rows(value, max) {
  if (!Array.isArray(value) || value.length > max) {
    const e = new Error('Invalid AI history response'); e.code = 'PERSISTENCE_ERROR'; throw e;
  }
  return value;
}
function dateFilters(q) {
  const field = q.dateField || (q.source === 'runtime' ? 'created_at' : 'recommendation_date');
  const conditions = [];
  if (q.startDate) conditions.push(`${field}.gte.${q.startDate}${q.source === 'runtime' ? 'T00:00:00+08:00' : ''}`);
  if (q.endDate) {
    const next = new Date(q.endDate); next.setUTCDate(next.getUTCDate() + 1);
    conditions.push(q.source === 'runtime' ? `${field}.lt.${next.toISOString().slice(0,10)}T00:00:00+08:00`
      : `${field}.lte.${q.endDate}`);
  }
  return conditions.length ? { and: `(${conditions.join(',')})` } : {};
}

async function readAIHistory(filters, { read }) {
  const q = validateHistory(filters);
  const result = { source:q.source, filters:q, tasks:[], results:[], decisions:[], outcomes:[], learnings:[], legacy:[], metrics:null,
    pagination:{ page:q.page, limit:q.limit, hasMore:false, total:null,
      unit:q.source === 'runtime' ? 'task' : 'recommendation',
      dateField:q.dateField || (q.source === 'runtime' ? 'created_at' : 'recommendation_date'), timezone:'Asia/Shanghai',
      personScope:q.source === 'runtime' ? 'direct-person-subject' : 'active-customer-link',
      relatedTruncated:{results:false,decisions:false,outcomes:false,learnings:false} } };
  if (q.personId) {
    const people = rows(await read('persons', {select:'id',id:`eq.${q.personId}`,deleted_at:'is.null',limit:1}),1);
    if (!people.length) { const e = new Error('Active Person not found'); e.code = 'NOT_FOUND'; throw e; }
  }
  const paging = {offset:(q.page-1)*q.limit,limit:q.limit+1,...dateFilters(q)};
  if (q.source === 'legacy') {
    let customerFilter = {};
    if (q.personId) {
      const customers = rows(await read('customers',{select:'Id',person_id:`eq.${q.personId}`,deleted_at:'is.null',limit:201}),201);
      if (customers.length > 200) { const e = new Error('Too many linked customer records'); e.code = 'PERSISTENCE_ERROR'; throw e; }
      if (!customers.length) return result;
      customerFilter = {customer_id:`in.(${customers.map(c=>id(c.Id)).join(',')})`};
    }
    const page = rows(await read('ai_recommendations', {
      select:'id,customer_id,customer_name,recommendation_date,suggested_followup_date,suggested_message,suggested_strategy,suggested_customer_stage,suggested_followup_goal,nba,created_at',
      order:`${q.dateField || 'recommendation_date'}.${q.sortDir || 'desc'}.nullslast,id.${q.sortDir || 'desc'}`,...paging,...customerFilter,
      ...(q.type ? {suggested_followup_goal:`eq.${q.type}`} : {}),
    }),q.limit+1);
    result.pagination.hasMore = page.length > q.limit;
    result.legacy = page.slice(0,q.limit).map(row=>({...row,source:{schema:'public',table:'ai_recommendations',id:id(row.id)},readOnly:true}));
    return result;
  }
  const page = rows(await read('ai_tasks', {
    select:'id,task_type,skill_name,subject_type,subject_id,status,created_at,completed_at',
    status:'eq.completed',order:`created_at.${q.sortDir || 'desc'},id.${q.sortDir || 'desc'}`,...paging,
    ...(q.personId ? {subject_type:'eq.person',subject_id:`eq.${q.personId}`} : {}),
    ...(q.type ? {task_type:`eq.${q.type}`} : {}),
  }),q.limit+1);
  result.pagination.hasMore = page.length > q.limit;
  result.tasks = page.slice(0,q.limit);
  if (!result.tasks.length) return result;
  async function related(key, table, fields, conditions, order, cap) {
    const items = rows(await read(table,{select:fields,...conditions,order,limit:cap+1}),cap+1);
    result.pagination.relatedTruncated[key] = items.length > cap;
    result[key] = items.slice(0,cap);
  }
  await related('results','ai_results','id,task_id,result_json,rank,is_recommended,user_selected,user_edited,final_result_json,feedback,created_at',
    {task_id:`in.(${result.tasks.map(t=>id(t.id)).join(',')})`},'created_at.desc,id.desc',200);
  if (!result.results.length) return result;
  const matching = `in.(${result.results.map(r=>id(r.id)).join(',')})`;
  await Promise.all([
    related('decisions','ai_result_feedback_events','id,ai_result_id,actor_uid,decision,reason,edit_delta,created_at',
      {ai_result_id:matching},'created_at.desc,id.desc',500),
    related('outcomes','outcomes','id,ai_result_id,action_id,opportunity_id,activity_id,recruit_candidate_id,recruit_followup_id,outcome_type,result,occurred_at,evidence,recorded_by_uid',
      {ai_result_id:matching},'occurred_at.desc,id.desc',200),
    related('learnings','learnings','id,source_id,situation,learning,scope,confirmed,confirmed_by_uid,confirmed_at,sample_size,counterexamples,provenance,candidate_key,created_at',
      {source_table:'eq.ai_results',source_id:matching},'created_at.desc,id.desc',200),
  ]);
  return result;
}

module.exports = { validateHistory, readAIHistory };
