/** Versioned Recruit Coach results, explicit human decisions and candidate-scoped history. */
'use strict';

const { createAIGateway } = require('./ai-gateway');
const { createSearchData } = require('./search-data');

const ID = /^[1-9]\d*$/;
const DIMENSIONS = [
  ['industry_resources', 25], ['learning_ability', 15], ['resilience', 20],
  ['communication', 15], ['entrepreneurial_motivation', 15], ['cultural_fit', 10],
];
const DECISIONS = new Set(['accepted','modified','rejected','deferred']);
const DIMENSION_KEYS = new Set(DIMENSIONS.map(([key]) => key));

function invalid(code = 'INVALID_INPUT') { const error = new Error('Invalid Recruit Coach request'); error.code = code; throw error; }
function idOf(value) { const text = String(value ?? ''); if (!ID.test(text) || !Number.isSafeInteger(Number(text))) invalid(); return text; }

function createReader({ env = process.env.TCB_ENV, key = process.env.CRM_ASSISTANT_DB_API_KEY, fetchImpl = fetch } = {}) {
  if (!/^crm-[a-z0-9]+$/.test(env || '') || !key) { const error=new Error('Recruit Coach database is not configured');error.code='INVALID_CONFIG';throw error; }
  return async function request(table, method = 'GET', filters = {}, body) {
    if (!['ai_tasks','ai_results'].includes(table) || !['GET','PATCH'].includes(method)) invalid();
    const url = new URL(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/${table}`);
    for (const [name, value] of Object.entries(filters)) url.searchParams.set(name, String(value));
    const response = await fetchImpl(url, { method, headers: { Authorization: `Bearer ${key}`,
      'Accept-Profile':'public','Content-Profile':'public',Accept:'application/json',
      'Content-Type':'application/json',Prefer:'return=representation' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) { const error=new Error('Recruit Coach audit request failed');error.code='PERSISTENCE_ERROR';throw error; }
    const text = await response.text(); return text ? JSON.parse(text) : [];
  };
}

function coachOutput(raw, context) {
  const refs = new Set(context.sourceRefs.map(ref => `${ref.schema}.${ref.table}#${ref.id}`));
  const byKey = new Map((Array.isArray(raw.dimensions) ? raw.dimensions : []).map(item => [item.key, item]));
  const dimensions = DIMENSIONS.map(([key, weight]) => {
    const item = byKey.get(key);
    if (!item) return { key, weight, score: null, rationale: '', evidenceRefs: [] };
    const evidenceRefs = [...new Set((Array.isArray(item.evidenceRefs) ? item.evidenceRefs : [])
      .filter(ref => refs.has(ref)))].slice(0, 5);
    const score = Number.isInteger(item.score) && item.score >= 0 && item.score <= 100 && evidenceRefs.length
      ? item.score : null;
    return { key, weight, score,
      rationale: score == null ? '' : String(item.rationale || '').slice(0, 500),
      evidenceRefs: score == null ? [] : evidenceRefs };
  });
  const rated = dimensions.filter(item => item.score != null);
  const totalWeight = rated.reduce((sum, item) => sum + item.weight, 0);
  const totalScore = rated.length >= 4 && totalWeight
    ? Math.round(rated.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight) : null;
  const sourceLines = [
    ...(Array.isArray(context.recruit_followups) ? context.recruit_followups : []),
    context.candidate,
  ];
  const evidenceRefs = new Set(dimensions.flatMap(item => item.evidenceRefs));
  const evidenceSources = sourceLines.map(line => {
    const ref = `${line.source.schema}.${line.source.table}#${line.source.id}`;
    if (!evidenceRefs.has(ref)) return null;
    const data = line.data || {};
    const fields=Object.entries(data).filter(([,value])=>value!=null&&String(value).trim())
      .map(([key,value])=>({key,value:String(value).slice(0,240)})).slice(0,12);
    return { ref, sourceType:line.source.table === 'recruit_candidates'?'candidate':'followup',
      date:data.followup_date||null, fields };
  }).filter(Boolean);
  const suggestion = raw.contactSuggestion || {};
  const assumptionReasons = (suggestion.assumptionReasons || []).filter(Boolean).slice(0, 8).map(String).map(x=>x.slice(0,400));
  const clarifyingQuestions = (suggestion.clarifyingQuestions || []).filter(Boolean).slice(0, 8).map(String).map(x=>x.slice(0,400));
  const prohibitedPhrasing = (suggestion.prohibitedPhrasing || []).filter(Boolean).slice(0, 8).map(String).map(x=>x.slice(0,300));
  const partial = rated.length < DIMENSIONS.length;
  return {
    assessment: String(raw.assessment || '').slice(0,2000),
    dimensions, totalScore,
    totalScoreNoteCode: partial ? (rated.length < 4 ? 'pc20_score_insufficient' : 'pc20_score_partial') : null,
    contactSuggestion: { assumptionReasons, clarifyingQuestions, prohibitedPhrasing,
      nextStep: String(suggestion.nextStep || '').slice(0,500) },
    uncertainty: String(raw.uncertainty || '').slice(0,500),
    uncertaintyCode: partial ? 'pc20_uncertain' : null,
    confidence: partial ? 'low' : raw.confidence,
    sourceRefs: [...evidenceRefs], evidenceSources,
  };
}

async function p360(action, personId, candidateId, client) {
  const cloudApp = client || require('./db').app;
  const response = await cloudApp.callFunction({ name:'person_360', data:{ action, personId, candidateId } });
  const result = response?.result;
  if (!result || result.error || !result.candidate || !Array.isArray(result.recruit_followups) || !Array.isArray(result.sourceRefs)) {
    const error=new Error(result?.error || 'Candidate context is unavailable');error.code='INVALID_CANDIDATE';throw error;
  }
  return result;
}

async function generate(event, { gateway, contextLoader, request, app: appOverride } = {}) {
  const personId = idOf(event.personId), candidateId = idOf(event.candidateId);
  const context = await (contextLoader || p360)('getRecruitCoachContext', personId, candidateId);
  const candidate = context.candidate;
  const language = event.language === 'en' ? 'en' : 'zh-CN';
  const contextBody = { candidate, recruit_followups: context.recruit_followups,
    guidance: { weighting: Object.fromEntries(DIMENSIONS),
      language, instruction:'Score only with cited records. A missing or conflicting fact stays unknown. No score or suggestion may change candidate stage or compatibility fields. Contact assumptions are hypotheses; include questions and prohibited phrasing. Return all human-readable content in the requested language.' } };
  const database = gateway ? null : createSearchData({ env:process.env.TCB_ENV, key:process.env.CRM_ASSISTANT_DB_API_KEY });
  const ai = gateway || createAIGateway({ app:appOverride || require('./db').app, rdb:database.auditRdb, timeoutMs:60000, maxAttempts:1 });
  const task = await ai.runAITask({ taskType:'recruit_coach', skill:'recruit_coach', capability:'coaching',
    subjectType:'candidate', subjectId:candidateId, input:{candidateId,personId,language,
      ...(typeof event.question === 'string' && event.question.trim() ? {question:event.question.trim().slice(0,500)} : {})},
    context:contextBody, contextSnapshot:{...contextBody,_context:{recipe:'recruit_coach',version:'2.0.0',
      source:'Person-scoped candidate and latest 20 active recruit followups; allowlisted fields only'}} });
  return { ok:true, status:'generated', personId, candidateId, taskId:task.taskId, resultId:task.resultId,
    createdAt:task.createdAt || new Date().toISOString(), result:coachOutput(task.result,context),
    execution:{modelCalled:true,businessDataWritten:false} };
}

async function history(event, { request = createReader(), contextLoader = p360 } = {}) {
  const personId=idOf(event.personId), candidateId=idOf(event.candidateId);
  const context=await contextLoader('getRecruitCoachContext',personId,candidateId);
  const tasks=await request('ai_tasks','GET',{select:'id,created_at,context_snapshot',task_type:'eq.recruit_coach',
    skill_name:'eq.recruit_coach',subject_type:'eq.candidate',subject_id:`eq.${candidateId}`,
    status:'eq.completed',order:'created_at.desc,id.desc',limit:10});
  const ids=tasks.map(row=>idOf(row.id));
  const results=ids.length?await request('ai_results','GET',{select:'id,task_id,result_json,final_result_json,user_selected,user_edited,feedback,created_at',
    task_id:`in.(${ids.join(',')})`,order:'created_at.desc,id.desc',limit:10}):[];
  const byTask=new Map(results.map(row=>[String(row.task_id),row]));
  return {ok:true,personId,candidateId,history:tasks.map(task=>{
    const result=byTask.get(String(task.id)); if(!result)return null;
    let decision=null; if(typeof result.feedback==='string'&&result.feedback.startsWith('PC20:')) decision=result.feedback.slice(5);
    return {taskId:String(task.id),resultId:String(result.id),createdAt:result.created_at||task.created_at,
      result:coachOutput(result.final_result_json||result.result_json,context),decision,userEdited:result.user_edited===true};
  }).filter(Boolean),execution:{modelCalled:false,businessDataWritten:false}};
}

function editedContactSuggestion(value, original) {
  if (!value || typeof value!=='object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',')!=='assumptionReasons,clarifyingQuestions,nextStep,prohibitedPhrasing') invalid();
  const list=(name,maxItems,maxLength)=>{
    if(!Array.isArray(value[name])||value[name].length>maxItems||value[name].some(x=>typeof x!=='string'||x.length>maxLength))invalid();
    return value[name].map(x=>x.trim()).filter(Boolean);
  };
  if(typeof value.nextStep!=='string'||value.nextStep.length>500)invalid();
  return {...original,contactSuggestion:{assumptionReasons:list('assumptionReasons',8,400),
    clarifyingQuestions:list('clarifyingQuestions',8,400),prohibitedPhrasing:list('prohibitedPhrasing',8,300),
    nextStep:value.nextStep.trim()}};
}

async function decide(event,{request=createReader(),contextLoader=p360}={}) {
  const personId=idOf(event.personId), candidateId=idOf(event.candidateId), resultId=idOf(event.resultId);
  if(!DECISIONS.has(event.decision))invalid();
  await contextLoader('getRecruitCoachContext',personId,candidateId);
  const results=await request('ai_results','GET',{select:'id,task_id,result_json,user_selected,user_edited,final_result_json',id:`eq.${resultId}`,limit:1});
  const row=results[0]; if(!row)invalid('INVALID_RESULT');
  const tasks=await request('ai_tasks','GET',{select:'id,task_type,skill_name,subject_type,subject_id',id:`eq.${row.task_id}`,limit:1});
  const task=tasks[0]; if(!task||task.task_type!=='recruit_coach'||task.skill_name!=='recruit_coach'||
      task.subject_type!=='candidate'||String(task.subject_id)!==candidateId)invalid('INVALID_RESULT');
  let selected=false, edited=false, finalResult=null;
  if(event.decision==='accepted'){selected=true;finalResult=row.result_json;}
  else if(event.decision==='modified'){
    selected=true;edited=true;finalResult=editedContactSuggestion(event.contactSuggestion,row.result_json);
  }
  const updated=await request('ai_results','PATCH',{id:`eq.${resultId}`,select:'id'},
    {user_selected:selected,user_edited:edited,feedback:`PC20:${event.decision}`,
      final_result_json:finalResult});
  if(!Array.isArray(updated)||updated.length!==1)invalid('PERSISTENCE_ERROR');
  return {ok:true,status:'decided',resultId,decision:event.decision,
    execution:{modelCalled:false,businessDataWritten:false}};
}

async function runRecruitCoach(event, options = {}) {
  if(!event||event.action!=='recruitCoach'||!['generate','history','decision'].includes(event.operation))invalid();
  if(event.operation==='generate')return generate(event,options);
  if(event.operation==='history')return history(event,options);
  return decide(event,options);
}

module.exports={runRecruitCoach,coachOutput,editedContactSuggestion,createReader,history,decide,generate};
