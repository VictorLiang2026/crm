/** PC25: classify one bounded request and execute only an existing read-only capability. */
'use strict';

const { createAIGateway } = require('./ai-gateway');

const INTENTS = new Set(['search','summarize','prepare','analyze','plan']);
const GUIDANCE = Object.freeze({
  allowed: ['search','summarize','prepare','plan'],
  unsupported: ['analyze'],
  rules: 'Classify only an explicit CRM read request. Search means find matching people. Summarize and prepare require one explicitly named Person; return only the short name phrase in personMention, never an ID. Plan means today morning brief. Analyze is currently unsupported. If intent is unclear, use needs_clarification and offer up to four distinct allowed options. Never infer CRM facts, output identifiers, propose writes, or claim an unsupported request ran.',
});

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function validId(value) { return /^[1-9][0-9]{0,18}$/.test(String(value || '')); }

function validateIntentResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key=>!['status','intent','interpretation','personMention','options'].includes(key)) ||
      !['supported','needs_clarification','unsupported'].includes(value.status) ||
      !['search','summarize','prepare','analyze','plan','unsupported'].includes(value.intent) ||
      typeof value.interpretation !== 'string' || !value.interpretation.trim() || value.interpretation.length > 300 ||
      !(value.personMention === null || (typeof value.personMention === 'string' && value.personMention.trim() && value.personMention.length <= 120 && !/^\d+$/.test(value.personMention.trim()))) ||
      !Array.isArray(value.options) || value.options.length > 4 || new Set(value.options).size !== value.options.length ||
      value.options.some(intent => !INTENTS.has(intent))) fail('INVALID_RESULT','Invalid assistant intent result');
  if (value.status === 'needs_clarification' && value.options.length < 2) fail('INVALID_RESULT','Clarification options are incomplete');
  if (value.status !== 'needs_clarification' && value.options.length) fail('INVALID_RESULT','Unexpected intent options');
  if (value.status === 'supported' && !INTENTS.has(value.intent)) fail('INVALID_RESULT','Unsupported intent was marked supported');
  return value;
}

function unwrapCall(result) {
  const value = result && Object.hasOwn(result,'result') ? result.result : result;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.error) fail('UPSTREAM_UNAVAILABLE','Read service returned an invalid response');
  return value;
}
function withTimeout(promise,ms) {
  let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error('Read task timed out');error.code='TIMEOUT';reject(error);},ms);});
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}

async function runReadIntent(event, dependencies = {}) {
  const query = typeof event?.query === 'string' ? event.query.trim() : '';
  if (!query || query.length > 1000) fail('INVALID_INPUT','Invalid assistant request');
  const language = event.language === 'en' ? 'en' : 'zh-CN';
  const selectedIntent = event.selectedIntent == null ? null : event.selectedIntent;
  if (selectedIntent !== null && !INTENTS.has(selectedIntent)) fail('INVALID_INPUT','Invalid selected intent');
  const selectedPersonId = event.selectedPersonId == null ? null : String(event.selectedPersonId);
  if (selectedPersonId !== null && !validId(selectedPersonId)) fail('INVALID_INPUT','Invalid selected Person');

  const app = dependencies.app || require('./db').app;
  const database = dependencies.database || require('./search-data').createSearchData({
    env: process.env.TCB_ENV, key: process.env.CRM_ASSISTANT_DB_API_KEY,
  });
  const gateway = dependencies.gateway || createAIGateway({ app, rdb: database.auditRdb, timeoutMs: 30000, maxAttempts: 1 });
  const task = await gateway.runAITask({
    taskType:'assistant_read_intent_v1', skill:'assistant_read_intent_v1', capability:'intent_classification',
    input:{query,language,selectedIntent}, context:{guidance:GUIDANCE},
    contextSnapshot:{guidance:GUIDANCE,_context:{recipe:'assistant_read_intent_v1',version:'1.0.0',source:'fixed read-only capability matrix'}},
  });
  const parsed = validateIntentResult(task.result);
  if (selectedIntent && parsed.intent !== selectedIntent) fail('INVALID_RESULT','Selected intent did not match the request');
  const base = {ok:true,taskId:task.taskId,resultId:task.resultId,plan:{intent:parsed.intent,interpretation:parsed.interpretation,
    dataScope:parsed.intent==='search'?'allowlisted public Person and CRM records':
      parsed.intent==='summarize'||parsed.intent==='prepare'?'one human-selected active Person and bounded existing context':
        parsed.intent==='plan'?'today read-only CRM overview':'none'},
    execution:{performed:false,modelCalled:true,businessDataRead:false,businessDataWritten:false}};

  if (parsed.status === 'needs_clarification') return {...base,status:'needs_intent_choice',options:parsed.options,
    requiresHumanDecision:true,notice:'Choose a supported read-only task before it runs.'};
  if (parsed.status === 'unsupported' || parsed.intent === 'unsupported' || parsed.intent === 'analyze') {
    return {...base,status:'unsupported',options:[],notice:parsed.intent==='analyze'?
      'Analysis is not connected to an approved read-only executor yet.':'This request is outside the supported read-only tasks.'};
  }
  if (parsed.status !== 'supported') fail('INVALID_RESULT','Invalid intent status');
  if (selectedPersonId && !['search','summarize','prepare'].includes(parsed.intent)) fail('INVALID_INPUT','Unexpected selected Person');

  let personMention = parsed.personMention && parsed.personMention.trim();
  let selectedPersonName = null;
  if (['summarize','prepare'].includes(parsed.intent) && !personMention) {
    return {...base,status:'needs_person_name',requiresHumanDecision:true,
      notice:'Name the Person to use before this read task can run.'};
  }
  if (personMention) {
    const resolution = await (dependencies.resolveName || database.resolveName)(personMention);
    const candidates = resolution?.candidates;
    if (!Array.isArray(candidates) || candidates.length > 10 || candidates.some(person=>
      !validId(person?.id) || typeof person.displayName!=='string' || !person.displayName.trim() || person.displayName.length>160)) {
      fail('UPSTREAM_UNAVAILABLE','Person resolution unavailable');
    }
    base.execution.businessDataRead = true;
    if (!candidates.length) return {...base,status:'person_not_found',candidates:[],requiresHumanDecision:true};
    if (!selectedPersonId) return {...base,status:'needs_person_selection',
      candidates:candidates.map(({id,displayName,organization,occupation})=>({id:String(id),displayName,organization,occupation})),
      requiresHumanDecision:true,notice:'Select the Person; no person-specific task has run.'};
    const selectedPerson = candidates.find(person=>String(person.id)===selectedPersonId);
    if (!selectedPerson) fail('INVALID_INPUT','Selected Person is not a current name-resolution candidate');
    selectedPersonName = selectedPerson.displayName;
  } else if (selectedPersonId && parsed.intent !== 'search') fail('INVALID_INPUT','Selected Person is not linked to this request');

  let result;
  if (parsed.intent === 'search') {
    result = await (dependencies.search || (input=>require('./search-v2-service').runSearchV2(input)))(
      {query,language,selectedPersonId:personMention?selectedPersonId:undefined});
  } else if (parsed.intent === 'summarize') {
    result = await (dependencies.summarize || (input=>require('./summarize-service').runSummarize(input)))({personId:selectedPersonId});
  } else if (parsed.intent === 'prepare') {
    result = await (dependencies.prepare || (input=>require('./meeting-prep-service').runMeetingPrep(input)))({personId:selectedPersonId});
  } else if (parsed.intent === 'plan') {
    const call = dependencies.plan || (async()=>app.callFunction({name:'today_coach',data:{action:'daily_review',view:'morning'}}));
    result = unwrapCall(await withTimeout(call(),35000));
    if (result.view !== 'morning' || !result.sections || !Array.isArray(result.sections.topActions)) fail('INVALID_RESULT','Today brief result is incomplete');
  }
  if (!result || result.ok === false) fail(result?.error?.code || 'UPSTREAM_UNAVAILABLE','Read task did not complete');
  if (parsed.intent === 'search' && !(
    (result.status==='complete' && Array.isArray(result.rows) && Number.isInteger(result.total)) ||
    (result.status==='needs_person_selection' && Array.isArray(result.candidates)) ||
    result.status==='person_not_found' || result.status==='unsupported')) fail('INVALID_RESULT','Search result is incomplete');
  if (parsed.intent === 'summarize' && (!validId(result.personId) || typeof result.summary!=='string' || !Array.isArray(result.sources))) fail('INVALID_RESULT','Summary result is incomplete');
  if (parsed.intent === 'prepare' && (!validId(result.personId) || typeof result.brief30Seconds!=='string' || !Array.isArray(result.sources))) fail('INVALID_RESULT','Meeting prep result is incomplete');
  if (parsed.intent === 'search' && result.status === 'unsupported') return {...base,status:'unsupported',intent:'search',result,
    plan:{...base.plan,completed:false},notice:'Search conditions are outside the supported query set.',
    execution:{performed:false,modelCalled:true,businessDataRead:false,businessDataWritten:false}};
  if (parsed.intent === 'search' && ['needs_person_selection','person_not_found'].includes(result.status)) return {...base,
    status:result.status,intent:'search',candidates:result.candidates||[],result,
    plan:{...base.plan,completed:false},requiresHumanDecision:result.status==='needs_person_selection',
    execution:{performed:false,modelCalled:true,businessDataRead:true,businessDataWritten:false}};
  return {...base,status:'complete',intent:parsed.intent,result:selectedPersonName?{...result,personName:selectedPersonName}:result,
    plan:{...base.plan,completed:true},execution:{performed:true,modelCalled:true,businessDataRead:true,businessDataWritten:false}};
}

module.exports = {GUIDANCE,runReadIntent,validateIntentResult};
