/** Authenticated AI suggestion and human-confirmed Opportunity promotion. */
'use strict';

const { createAIGateway } = require('./ai-gateway');
const { createSearchData } = require('./search-data');
const { createOpportunityCandidateData } = require('./opportunity-candidate-data');
const { buildCandidateContext,verifyCandidate,idOf } = require('./opportunity-candidate-context');

const ID=/^[1-9][0-9]*$/;
const HASH=/^[0-9a-f]{32}$/;
const TYPES=new Set(['insurance','recruit','referral','activity','speaker',
  'partnership','service','relationship']);
function invalid() { const error=new Error('Invalid candidate request');error.code='INVALID_INPUT';throw error; }
function draftOf(value) {
  if (!value || typeof value!=='object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',')!=='next_action,opportunity_type,reason' ||
      !TYPES.has(value.opportunity_type) || typeof value.reason!=='string' ||
      !value.reason.trim() || value.reason.trim().length>1000 ||
      typeof value.next_action!=='string' || !value.next_action.trim() ||
      value.next_action.trim().length>500) invalid();
  return { opportunity_type:value.opportunity_type,reason:value.reason.trim(),
    next_action:value.next_action.trim() };
}

async function runOpportunityCandidate(event, uid, {data,gateway,app,auditRdb}={}) {
  if (typeof uid!=='string' || !uid.trim() || !event ||
      event.action!=='opportunityCandidate') invalid();
  const operation=event.operation;
  if (!['list','context','generate','edit','reject','preview','confirm','execute'].includes(operation)) invalid();
  const database=data || createOpportunityCandidateData({env:process.env.TCB_ENV,
    key:process.env.CRM_ASSISTANT_DB_API_KEY});
  if (operation==='list') {
    const personId=idOf(event.personId);
    return {ok:true,status:'listed',rows:await database.list(personId),
      execution:{modelCalled:false,businessDataWritten:false}};
  }
  if (operation==='context') {
    const context=await buildCandidateContext(database,idOf(event.personId));
    return {ok:true,status:'context',evidence:context.evidence,
      execution:{modelCalled:false,businessDataWritten:false}};
  }
  if (operation==='generate') {
    const personId=idOf(event.personId);
    const context=await buildCandidateContext(database,personId);
    if (!context.evidence.some(item=>item.primary)) {
      return {ok:true,status:'insufficient_evidence',notice:'现有资料缺少可支持机会判断的具体证据；不会创建候选。',
        execution:{modelCalled:false,businessDataWritten:false}};
    }
    const client=app || require('@cloudbase/node-sdk').init({env:process.env.TCB_ENV});
    const audit=auditRdb || createSearchData({env:process.env.TCB_ENV,
      key:process.env.CRM_ASSISTANT_DB_API_KEY}).auditRdb;
    const ai=gateway || createAIGateway({app:client,rdb:audit,timeoutMs:60000,maxAttempts:1});
    const task=await ai.runAITask({taskType:'opportunity_candidate',skill:'opportunity_candidate',
      capability:'analysis',subjectType:'person',subjectId:personId,
      input:{personId},context,
      contextSnapshot:{...context,_context:{recipe:'opportunity_candidate',version:'1.0.0',
        source:'bounded public CRM rows; source refs verified before storing'}}});
    const checked=verifyCandidate(task.result,context);
    if (checked.status!=='candidate') return {ok:true,status:'insufficient_evidence',
      taskId:task.taskId,resultId:task.resultId,
      notice:'模型未给出可核对的正面来源，未保存机会候选。',
      execution:{modelCalled:true,businessDataWritten:false}};
    const saved=await database.run('create',uid,{personId,aiResultId:task.resultId,
      draft:checked.draft,evidence:checked.evidence});
    return {...saved,taskId:task.taskId,resultId:task.resultId,
      confidence:checked.confidence,
      execution:{modelCalled:true,businessDataWritten:false}};
  }
  const candidateId=idOf(event.candidateId);
  const args={candidateId};
  if (operation==='preview' || operation==='execute') {
    const candidate=await database.get(candidateId);
    if (!candidate) invalid();
    const context=await buildCandidateContext(database,candidate.person_id);
    const byRef=new Map(context.evidence.map(item=>[item.ref,item]));
    if (!Array.isArray(candidate.evidence) || !candidate.evidence.length ||
        !candidate.evidence.every(ref=>byRef.has(ref)) ||
        !candidate.evidence.some(ref=>byRef.get(ref).primary)) {
      const error=new Error('Candidate evidence changed');error.code='PREVIEW_STALE';throw error;
    }
  }
  if (operation==='edit') args.draft=draftOf(event.draft);
  if (operation==='confirm') {
    if (typeof event.previewHash!=='string' || !HASH.test(event.previewHash)) invalid();
    args.previewHash=event.previewHash;
  } else if (event.previewHash!==undefined) invalid();
  const result=await database.run(operation,uid,args);
  return {...result,execution:{modelCalled:false,
    businessDataWritten:operation==='execute' && result.replayed!==true}};
}

module.exports={runOpportunityCandidate,draftOf};
