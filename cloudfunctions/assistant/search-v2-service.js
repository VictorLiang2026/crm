/** PC24: bounded combination search. The model proposes filters; public SQL decides matches. */
'use strict';

const { createAIGateway } = require('./ai-gateway');
const { createSearchData } = require('./search-data');

const GUIDANCE = Object.freeze({
  limits: 'Use only the declared filters. Unsupported or ambiguous requests must be unsupported. Return null for unused filters. A person name belongs only in personMention; never infer an identity or return an ID. Months are integers 1..24. For followupState recent or none, set followupMonths to the requested window or 3 by default. Do not output SQL or results.',
  roles: ['customer','recruit','speaker','participant'],
  relationshipTypes: ['family','friend','colleague','business','referral','other'],
  opportunityStatuses: ['发现','沟通','方案','潜在线索','已介绍','已联系','已建立关系','成交','关闭'],
  opportunityTypes: ['insurance','recruit','referral','activity','speaker','partnership','service','relationship','医疗保障','重疾保障','养老规划','教育规划','财富规划','家庭保障','转介绍'],
  recruitStages: ['新增人才','互动暖客','初次面谈','增员活动','精准面谈','入职申请','签约入司','流失','名单','接触','面谈1','面谈2','创说会','报考','入司','转正'],
});

const ENUMS = {
  roles: GUIDANCE.roles, relationshipTypes: GUIDANCE.relationshipTypes,
  opportunityStatuses: GUIDANCE.opportunityStatuses, opportunityTypes: GUIDANCE.opportunityTypes,
  recruitStages: GUIDANCE.recruitStages,
};
const FILTER_KEYS = Object.keys(ENUMS).concat(['fact','attendanceMonths','followupState','followupMonths']);
const EVIDENCE_BY_FILTER = Object.freeze({roles:['customers','recruit_candidates','activity_participants','activity_speakers'],relationshipTypes:['relationships'],
  fact:['context_items'],attendanceMonths:['activity_participants','activities'],followupState:['followups','recruit_followups'],
  opportunityStatuses:['opportunities'],opportunityTypes:['opportunities'],recruitStages:['recruit_candidates']});
const DETAILS_BY_FILTER = Object.freeze({roles:['recruits','speakers'],relationshipTypes:['relationships'],fact:['facts'],
  attendanceMonths:['attendance'],followupState:['customer_followups','recruit_followups'],
  opportunityStatuses:['opportunities'],opportunityTypes:['opportunities'],recruitStages:['recruits']});
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
function fail(code, message) { const e = new Error(message); e.code = code; throw e; }

function validateFilters(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !FILTER_KEYS.includes(k))) {
    fail('INVALID_RESULT', 'Search filters are invalid');
  }
  const filters = {};
  let count = 0;
  for (const key of ENUMS ? Object.keys(ENUMS) : []) {
    const v = value[key] ?? null;
    if (v === null) { filters[key] = null; continue; }
    const maximum = key === 'roles' ? 4 : 6;
    if (!Array.isArray(v) || v.length < 1 || v.length > maximum || new Set(v).size !== v.length || v.some(x => typeof x !== 'string' || !ENUMS[key].includes(x))) fail('INVALID_RESULT', `Invalid ${key}`);
    filters[key] = v;
    if (!['opportunityStatuses','opportunityTypes'].includes(key)) count++;
  }
  if (filters.opportunityStatuses || filters.opportunityTypes) count++;
  if (own(value,'fact') && value.fact != null) {
    const f = value.fact;
    if (!f || typeof f !== 'object' || Array.isArray(f) || Object.keys(f).some(k => !['category','contains'].includes(k))) fail('INVALID_RESULT','Invalid fact filter');
    const category = f.category == null ? null : String(f.category).trim();
    const contains = f.contains == null ? null : String(f.contains).trim();
    if ((!category && !contains) || (category && (category.length > 64 || /[%_\\]/.test(category))) || (contains && (contains.length > 80 || /[%_\\]/.test(contains)))) fail('INVALID_RESULT','Invalid fact filter');
    filters.fact = { category, contains }; count++;
  } else filters.fact = null;
  for (const key of ['attendanceMonths','followupMonths']) {
    const v = value[key] ?? null;
    if (v !== null && (!Number.isInteger(v) || v < 1 || v > 24)) fail('INVALID_RESULT',`Invalid ${key}`);
    filters[key] = v;
    if (v !== null && key === 'attendanceMonths') count++;
  }
  const state = value.followupState ?? null;
  if (state !== null && !['recent','none'].includes(state)) fail('INVALID_RESULT','Invalid followupState');
  if (state !== null && filters.followupMonths === null) filters.followupMonths = 3;
  if (state === null && filters.followupMonths !== null) fail('INVALID_RESULT','Inconsistent follow-up filters');
  filters.followupState = state;
  if (state !== null) count++;
  if (count < 1 || count > 7) fail('INVALID_RESULT','Search must contain 1 to 7 condition groups');
  return filters;
}

function normalizePage(value) {
  const page = value === undefined ? 1 : Number(value);
  if (!Number.isSafeInteger(page) || page < 1 || page > 11) fail('INVALID_INPUT','Page is outside the supported range');
  return page;
}

async function runSearchV2(event, { app, data, gateway } = {}) {
  if (typeof event?.query !== 'string' || !event.query.trim() || event.query.length > 1000) fail('INVALID_INPUT','Invalid search query');
  const query = event.query.trim();
  const page = normalizePage(event.page);
  const database = data || createSearchData({ env: process.env.TCB_ENV, key: process.env.CRM_ASSISTANT_DB_API_KEY });
  const client = app || (gateway ? null : require('./db').app);
  const ai = gateway || createAIGateway({ app: client, rdb: database.auditRdb, timeoutMs: 30000, maxAttempts: 1 });
  const task = await ai.runAITask({ taskType:'crm_search_query_v2', skill:'crm_search_query_v2', capability:'structured_extraction',
    input:{query,language:event.language === 'en' ? 'en' : 'zh-CN'}, context:{guidance:GUIDANCE},
    contextSnapshot:{guidance:GUIDANCE,_context:{recipe:'crm_search_query_v2',version:'2.0.0',source:'fixed public schema query contract'}} });
  const result = task.result;
  if (result.status === 'unsupported') return {ok:true,status:'unsupported',taskId:task.taskId,resultId:task.resultId,
    interpretation:result.interpretation,rows:[],total:0,notice:'此查询超出当前固定条件范围，请改写为已支持的筛选条件。',execution:{modelCalled:true,businessDataRead:false,businessDataWritten:false}};
  const filters = validateFilters(result.filters);
  let selectedPersonId = null;
  if (result.personMention) {
    const resolution = await database.resolveName(result.personMention);
    if (!resolution?.candidates || resolution.candidates.length > 10) fail('UPSTREAM_UNAVAILABLE','Person resolution unavailable');
    if (resolution.status === 'available' || resolution.candidates.length === 0) return {ok:true,status:'person_not_found',taskId:task.taskId,
      resultId:task.resultId,interpretation:result.interpretation,personMention:result.personMention,candidates:[],rows:[],total:0,
      requiresHumanDecision:true,execution:{modelCalled:true,businessDataRead:false,businessDataWritten:false}};
    if (!event.selectedPersonId) return {ok:true,status:'needs_person_selection',taskId:task.taskId,resultId:task.resultId,
      interpretation:result.interpretation,personMention:result.personMention,candidates:resolution.candidates.map(({id,displayName,organization,occupation})=>({id,displayName,organization,occupation})),
      rows:[],total:0,requiresHumanDecision:true,execution:{modelCalled:true,businessDataRead:false,businessDataWritten:false}};
    selectedPersonId=String(event.selectedPersonId);
    if (!/^[1-9][0-9]*$/.test(selectedPersonId) || !resolution.candidates.some(person=>person.id===selectedPersonId)) fail('INVALID_INPUT','Selected Person is not a current name-resolution candidate');
  } else if (event.selectedPersonId) fail('INVALID_INPUT','Unexpected selected Person');
  const pageSize=50;
  const found = await database.searchV2({...filters, ...(selectedPersonId ? {personId:selectedPersonId}: {})},pageSize,(page-1)*pageSize);
  const rows = found.rows.map(row => ({...row, matchReasons:(found.filterLabels||[]).map(condition => ({condition,
    records:(EVIDENCE_BY_FILTER[condition]||[]).flatMap(table=>(row.sources?.[table]||[]).map(id=>({table,id:String(id)}))),
    evidence:(DETAILS_BY_FILTER[condition]||[]).flatMap(key=>Array.isArray(row[key])?row[key]:[]),
    ...(condition==='followupState'&&filters.followupState==='none'?{verifiedAbsence:true,windowMonths:filters.followupMonths}:{}),
    ...(condition==='attendanceMonths'?{windowMonths:filters.attendanceMonths,timeZone:'Asia/Shanghai'}:{}),
    ...(condition==='followupState'?{windowMonths:filters.followupMonths,timeZone:'Asia/Shanghai'}:{}) }))}));
  const refs = [];
  for (const row of rows) for (const [table,id] of Object.entries(row.sources || {})) {
    if (Array.isArray(id)) for (const value of id) refs.push({table,id:String(value)});
    else if (id != null) refs.push({table,id:String(id)});
  }
  const disclosure = await (database.testDataReader || require('./test-data').disclose)(refs);
  if (disclosure.containsTestData === true) await database.linkTestAudit(task.taskId,refs);
  return {ok:true,status:'complete',taskId:task.taskId,resultId:task.resultId,interpretation:result.interpretation,
    criteria:filters,total:found.total,page,pageSize,hasMore:page*pageSize<found.total,truncated:page===11&&page*pageSize<found.total,
    rows,filterLabels:found.filterLabels,timeZone:'Asia/Shanghai',testData:disclosure,
    resultSource:'public.crm_search_people_v2',execution:{modelCalled:true,businessDataRead:true,businessDataWritten:false}};
}

module.exports = {runSearchV2,validateFilters,normalizePage,GUIDANCE};
