/** CRM assistant V1: authenticated intent router, not a chat or execution endpoint. */
'use strict';

const { routeIntent, IntentError } = require('./intent-router');
const { handleCommand, OPERATIONS } = require('./command-safety');
const AI_AUDIT_CODES = new Set(['AI_IN_PROGRESS', 'AI_RETRY_LATER', 'AI_AUDIT_UNKNOWN']);
// Project only the PC28 contract from a runtime event envelope. Other metadata is never forwarded.
const RECRUIT_DELETE_BUSINESS_KEYS = new Set(['action','query','language','personMention',
  'selectedPersonId','stage','command','idempotencyKey','commandId','previewHash',
  'confirmed','actorUid','personId','candidateId','customerId','resource','operation',
  'preview','result','followupIds','batchId','requestText']);
function recruitDeleteInput(event, allowed) {
  if (!event || typeof event !== 'object' || Array.isArray(event) ||
      Object.keys(event).some(key=>RECRUIT_DELETE_BUSINESS_KEYS.has(key)&&!allowed.includes(key))) return null;
  return Object.fromEntries(allowed.filter(key=>Object.hasOwn(event,key)).map(key=>[key,event[key]]));
}
// CloudBase adds transport fields to event; never forward them into a command.
// Reject known business fields for the wrong stage instead of silently ignoring forged input.
const COMMAND_BUSINESS_KEYS = new Set([...RECRUIT_DELETE_BUSINESS_KEYS,
  'targetActionId','actionId','opportunityId','targetOpportunityId','changes','outcomeResult',
  'selectedOpportunityId','selectedActionId']);
function commandInput(event, allowed) {
  if (!event || typeof event !== 'object' || Array.isArray(event) ||
      Object.keys(event).some(key=>COMMAND_BUSINESS_KEYS.has(key)&&!allowed.includes(key))) return null;
  return Object.fromEntries(allowed.filter(key=>Object.hasOwn(event,key)).map(key=>[key,event[key]]));
}

function createMain(getIdentity, searchRunner = event => require('./search-service').runSearch(event),
  actionRunner = (event, uid) => require('./action-command-service').runActionCommand(event, uid),
  candidateRunner = (event, uid) => require('./opportunity-candidate-service').runOpportunityCandidate(event, uid),
  readTaskRunner = event => require('./read-intent-service').runReadIntent(event),
  actionIntentRunner = event => require('./action-command-intent-service').interpretActionCommand(event),
  actionTargetsRunner = event => require('./action-command-intent-service').listActionTargets(event),
  opportunityIntentRunner = event => require('./opportunity-command-intent-service').interpretOpportunityCommand(event),
  opportunityTargetsRunner = (event, uid) => require('./opportunity-command-intent-service').listOpportunityTargets(event,uid),
  opportunityCommandRunner = (event, uid) => require('./opportunity-command-service').runOpportunityCommand(event,uid),
  recruitDeleteIntentRunner = event => require('./recruit-delete-intent-service').interpretRecruitDelete(event),
  recruitDeleteTargetsRunner = (event,uid) => require('./recruit-delete-intent-service').listRecruitDeleteTargets(event,uid),
  recruitDeleteCommandRunner = (event,uid) => require('./recruit-delete-command-service').runRecruitDeleteCommand(event,uid)) {
  return async event => {
    let identity;
    try { identity = await getIdentity(); }
    catch (_) { return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Login required' } }; }
    if (typeof identity?.uid !== 'string' || !identity.uid.trim() || identity.isAnonymous !== false) {
      return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Login required' } };
    }
    if (event?.action === 'testSamples') {
      try { return await require('./test-scenario-service').runScenario({action:event.action,stage:event.stage,
        ...(event.previewId === undefined ? {} : {previewId:event.previewId}),
        ...(event.previewHash === undefined ? {} : {previewHash:event.previewHash}),
        ...(event.confirmed === undefined ? {} : {confirmed:event.confirmed}),
        ...(event.plan === undefined ? {} : {plan:event.plan}),
        ...Object.fromEntries(['count','counts','personId','customerId','batchKey','rows']
          .filter(key => event[key] !== undefined).map(key => [key,event[key]]))}, identity, {
        allowedUids: String(process.env.CRM_TEST_SEED_UIDS || '').split(',').map(s => s.trim()).filter(Boolean),
      }); } catch (error) { return {ok:false,error:{code:error.code || 'SEED_DENIED',message:'测试场景操作未完成，请核对预览或权限'}}; }
    }
    if (event?.action === 'quickCaptureV2') {
      try { return await require('./quick-capture-v2-service').runQuickCaptureV2(event,identity); }
      catch (error) { return {ok:false,error:{code:error.code || 'QUICK_CAPTURE_FAILED',
        message:'快速记录 V2 操作未完成，请核对身份、预览或权限',
        ...(Number.isSafeInteger(Number(error.auditTaskId)) && Number(error.auditTaskId)>0 ?
          {auditTaskId:Number(error.auditTaskId)} : {})}}; }
    }
    if (event?.action === 'opportunityCandidate') {
      try { return await candidateRunner(event, identity.uid); }
      catch (error) {
        const code = ['INVALID_INPUT','INVALID_CONFIG','INVALID_RESULT','RATE_LIMIT','TIMEOUT',
          'UPSTREAM_UNAVAILABLE','PERSISTENCE_ERROR','AI_REQUEST_FAILED','INVALID_CANDIDATE',
          'DUPLICATE_OPPORTUNITY','PREVIEW_STALE','CONFIRMATION_REQUIRED',
          'TEST_PERSON_REQUIRED',
          'CANDIDATE_DATABASE_ERROR'].includes(error?.code) || AI_AUDIT_CODES.has(error?.code) ? error.code : 'CANDIDATE_FAILED';
        return { ok:false,error:{code,message:'机会候选操作未完成'} };
      }
    }
    if (event?.action === 'recruitCoach') {
      try { return await require('./recruit-coach-service').runRecruitCoach(event); }
      catch (error) {
        const code = ['INVALID_INPUT','INVALID_CONFIG','INVALID_RESULT','RATE_LIMIT','TIMEOUT',
          'UPSTREAM_UNAVAILABLE','PERSISTENCE_ERROR','AI_REQUEST_FAILED','INVALID_CANDIDATE']
          .includes(error?.code) || AI_AUDIT_CODES.has(error?.code) ? error.code : 'RECRUIT_COACH_FAILED';
        return {ok:false,error:{code,message:'Recruit Coach request could not be completed'}};
      }
    }
    if (event?.action === 'actionCommandInterpret') {
      try {
        const input=commandInput(event,['action','query','language']);
        if (!input) {
          return {ok:false,error:{code:'INVALID_INPUT',message:'Action request could not be interpreted'}};
        }
        return await actionIntentRunner({query:input.query,language:input.language});
      } catch (error) {
        const code=['INVALID_INPUT','INVALID_RESULT','INVALID_CONFIG','TIMEOUT','UPSTREAM_UNAVAILABLE',
          'PERSISTENCE_ERROR','AI_REQUEST_FAILED'].includes(error?.code) || AI_AUDIT_CODES.has(error?.code)?error.code:'ACTION_COMMAND_FAILED';
        return {ok:false,error:{code,message:'Action request could not be interpreted'}};
      }
    }
    if (event?.action === 'actionCommandTargets') {
      try {
        const input=commandInput(event,['action','personMention','selectedPersonId']);
        if (!input) {
          return {ok:false,error:{code:'INVALID_INPUT',message:'Action target selection could not be verified'}};
        }
        return await actionTargetsRunner({personMention:input.personMention,
          selectedPersonId:input.selectedPersonId});
      } catch (error) {
        const code=['INVALID_INPUT','INVALID_CONFIG','UPSTREAM_UNAVAILABLE'].includes(error?.code)?error.code:'ACTION_COMMAND_FAILED';
        return {ok:false,error:{code,message:'Action target selection could not be verified'}};
      }
    }
    if (event?.action === 'opportunityCommandInterpret') {
      try {
        const input=commandInput(event,['action','query','language']);
        if (!input) {
          return {ok:false,error:{code:'INVALID_INPUT',message:'Opportunity request could not be interpreted'}};
        }
        return await opportunityIntentRunner({query:input.query,language:input.language});
      } catch (error) {
        const code=['INVALID_INPUT','INVALID_RESULT','INVALID_CONFIG','TIMEOUT','UPSTREAM_UNAVAILABLE',
          'PERSISTENCE_ERROR','AI_REQUEST_FAILED'].includes(error?.code) || AI_AUDIT_CODES.has(error?.code)?error.code:'OPPORTUNITY_COMMAND_FAILED';
        return {ok:false,error:{code,message:'Opportunity request could not be interpreted'}};
      }
    }
    if (event?.action === 'opportunityCommandTargets') {
      try {
        const input=commandInput(event,['action','personMention','selectedPersonId']);
        if (!input) {
          return {ok:false,error:{code:'INVALID_INPUT',message:'Opportunity target selection could not be verified'}};
        }
        return await opportunityTargetsRunner({personMention:input.personMention,
          selectedPersonId:input.selectedPersonId},identity.uid);
      } catch (error) {
        const code=['INVALID_INPUT','INVALID_CONFIG','UPSTREAM_UNAVAILABLE'].includes(error?.code)?error.code:'OPPORTUNITY_COMMAND_FAILED';
        return {ok:false,error:{code,message:'Opportunity target selection could not be verified'}};
      }
    }
    if (event?.action === 'opportunityCommand') {
      try {
        const fields=event.stage==='plan'?['action','stage','command','idempotencyKey']:
          event.stage==='confirm'?['action','stage','commandId','previewHash']:
          ['action','stage','commandId'];
        const input=commandInput(event,fields);
        if (!input) return {ok:false,error:{code:'INVALID_COMMAND',message:'Opportunity command could not be completed'}};
        return await opportunityCommandRunner(input,identity.uid);
      }
      catch (error) {
        const code=['INVALID_COMMAND','PREVIEW_STALE','CONFIRMATION_REQUIRED','OPPORTUNITY_COMMAND_FAILED'].includes(error?.code)?
          error.code:'OPPORTUNITY_COMMAND_FAILED';
        return {ok:false,error:{code,message:'Opportunity command could not be completed'}};
      }
    }
    if (event?.action === 'recruitDeleteInterpret') {
      try {
        const input=recruitDeleteInput(event,['action','query','language']);
        if (!input) {
          return {ok:false,error:{code:'INVALID_INPUT',message:'Recruit delete request is invalid'}};
        }
        return await recruitDeleteIntentRunner({query:input.query,language:input.language});
      } catch (error) {
        const code=['INVALID_INPUT','INVALID_RESULT','INVALID_CONFIG','TIMEOUT','UPSTREAM_UNAVAILABLE',
          'PERSISTENCE_ERROR','AI_REQUEST_FAILED'].includes(error?.code)||AI_AUDIT_CODES.has(error?.code)?
          error.code:'RECRUIT_DELETE_FAILED';
        return {ok:false,error:{code,message:'Recruit delete request could not be interpreted'}};
      }
    }
    if (event?.action === 'recruitDeleteTargets') {
      try {
        const input=recruitDeleteInput(event,['action','personMention','selectedPersonId']);
        if (!input) {
          return {ok:false,error:{code:'INVALID_INPUT',message:'Recruit delete target is invalid'}};
        }
        return await recruitDeleteTargetsRunner({personMention:input.personMention,
          selectedPersonId:input.selectedPersonId},identity.uid);
      } catch (error) {
        const code=['INVALID_INPUT','INVALID_CONFIG','UPSTREAM_UNAVAILABLE'].includes(error?.code)?
          error.code:'RECRUIT_DELETE_FAILED';
        return {ok:false,error:{code,message:'Recruit delete target could not be verified'}};
      }
    }
    if (event?.action === 'recruitDeleteCommand') {
      try {
        const fields=event.stage==='plan'?['action','stage','command','idempotencyKey']:
          event.stage==='confirm'?['action','stage','commandId','previewHash']:
          ['action','stage','commandId'];
        const input=recruitDeleteInput(event,fields);
        if (!input) return {ok:false,error:{code:'INVALID_COMMAND',message:'Recruit delete command could not be completed'}};
        return await recruitDeleteCommandRunner(input,identity.uid);
      }
      catch (error) {
        const code=['INVALID_COMMAND','PREVIEW_STALE','COMMAND_DENIED','RECRUIT_DELETE_FAILED'].includes(error?.code)?
          error.code:'RECRUIT_DELETE_FAILED';
        return {ok:false,error:{code,message:'Recruit delete command could not be completed'}};
      }
    }
    const isActionPlan = event?.action === 'command' && event.stage === 'plan' &&
      ['create','update','close'].includes(event.command?.operation) && event.command?.resource === 'actions' &&
      event.command?.personId != null;
    const isActionNext = event?.action === 'command' && event.resource === 'actions' &&
      ['preview', 'confirm', 'execute'].includes(event.stage);
    if (isActionPlan || isActionNext) {
      try {
        const fields=isActionPlan?['action','stage','command']:
          event.stage==='confirm'?['action','stage','resource','commandId','previewHash']:
          ['action','stage','resource','commandId'];
        const input=commandInput(event,fields);
        if (!input) return {ok:false,error:{code:'INVALID_COMMAND',message:'Action command could not be completed'}};
        return await actionRunner(input, identity.uid);
      }
      catch (error) {
        const code = ['INVALID_COMMAND','DUPLICATE_ACTION','PREVIEW_STALE',
          'CONFIRMATION_REQUIRED','ACTION_COMMAND_FAILED'].includes(error?.code) ?
          error.code : 'ACTION_COMMAND_FAILED';
        return { ok: false, error: { code, message: 'Action command could not be completed' } };
      }
    }
    if (event?.action === 'command' || OPERATIONS.includes(event?.action)) {
      return handleCommand({ action: event.action, stage: event.stage, command: event.command });
    }
    if (event?.action === 'search') {
      try { return await searchRunner({ query: event.query }); }
      catch (error) {
        const code = ['INVALID_INPUT', 'INVALID_CONFIG', 'RATE_LIMIT', 'TIMEOUT',
          'UPSTREAM_UNAVAILABLE', 'PERSISTENCE_ERROR', 'AI_REQUEST_FAILED',
          'INVALID_RESULT'].includes(error?.code) || AI_AUDIT_CODES.has(error?.code) ? error.code : 'SEARCH_FAILED';
        return { ok: false, error: { code, message: 'CRM search could not be completed' } };
      }
    }
    if (event?.action === 'searchV2') {
      try { return await require('./search-v2-service').runSearchV2({query:event.query,language:event.language,
        selectedPersonId:event.selectedPersonId,page:event.page}); }
      catch (error) {
        const code = ['INVALID_INPUT','INVALID_RESULT','INVALID_CONFIG','RATE_LIMIT','TIMEOUT',
          'UPSTREAM_UNAVAILABLE','PERSISTENCE_ERROR','AI_REQUEST_FAILED'].includes(error?.code) || AI_AUDIT_CODES.has(error?.code) ? error.code : 'SEARCH_FAILED';
        return {ok:false,error:{code,message:'CRM combination search could not be completed'}};
      }
    }
    if (event?.action === 'assistantReadTask') {
      try { return await readTaskRunner({query:event.query,language:event.language,
        selectedIntent:event.selectedIntent,selectedPersonId:event.selectedPersonId}); }
      catch (error) {
        const code = ['INVALID_INPUT','INVALID_RESULT','INVALID_CONFIG','RATE_LIMIT','TIMEOUT',
          'UPSTREAM_UNAVAILABLE','PERSISTENCE_ERROR','AI_REQUEST_FAILED','NOT_FOUND'].includes(error?.code) || AI_AUDIT_CODES.has(error?.code) ? error.code : 'READ_TASK_FAILED';
        return {ok:false,error:{code,message:'Assistant read task could not be completed'}};
      }
    }
    if (event?.action === 'summarize') {
      try { return await require('./summarize-service').runSummarize(event); }
      catch (error) {
        const code = ['INVALID_INPUT', 'NOT_FOUND', 'INVALID_CONFIG', 'INVALID_RESULT',
          'RATE_LIMIT', 'TIMEOUT', 'UPSTREAM_UNAVAILABLE', 'PERSISTENCE_ERROR',
          'AI_IN_PROGRESS', 'AI_RETRY_LATER', 'AI_AUDIT_UNKNOWN',
          'AI_REQUEST_FAILED'].includes(error?.code) ? error.code : 'SUMMARY_FAILED';
        const detail = error?.message ? String(error.message) : '';
        return { ok: false, error: { code, message: detail || 'Person summary could not be generated' } };
      }
    }
    if (event?.action === 'meetingPrep') {
      try { return await require('./meeting-prep-service').runMeetingPrep(event); }
      catch (error) {
        const code = ['INVALID_INPUT', 'NOT_FOUND', 'INVALID_CONFIG', 'INVALID_RESULT',
          'RATE_LIMIT', 'TIMEOUT', 'UPSTREAM_UNAVAILABLE', 'PERSISTENCE_ERROR',
          'AI_IN_PROGRESS', 'AI_RETRY_LATER', 'AI_AUDIT_UNKNOWN',
          'AI_REQUEST_FAILED'].includes(error?.code) ? error.code : 'MEETING_PREP_FAILED';
        const detail = error?.message ? String(error.message) : '';
        return { ok: false, error: { code, message: detail || 'Meeting prep could not be generated' } };
      }
    }
    if (event?.action === 'conversationPlaybook') {
      try { return await require('./conversation-playbook-service').runConversationPlaybook(event); }
      catch (error) {
        const code = ['INVALID_INPUT', 'NOT_FOUND', 'INVALID_CONFIG', 'INVALID_RESULT',
          'RATE_LIMIT', 'TIMEOUT', 'UPSTREAM_UNAVAILABLE', 'PERSISTENCE_ERROR',
          'AI_IN_PROGRESS', 'AI_RETRY_LATER', 'AI_AUDIT_UNKNOWN',
          'AI_REQUEST_FAILED'].includes(error?.code) ? error.code : 'PLAYBOOK_FAILED';
        const detail = error?.message ? String(error.message) : '';
        return { ok: false, error: { code, message: detail || 'Conversation playbook could not be generated' } };
      }
    }
    if (event?.action === 'conversationPlaybookHistory') {
      try { return await require('./conversation-playbook-history-service').getConversationPlaybookHistory(event); }
      catch (error) {
        const code = ['INVALID_INPUT', 'PERSISTENCE_ERROR'].includes(error?.code) ? error.code : 'PLAYBOOK_HISTORY_FAILED';
        const detail = error?.message ? String(error.message) : '';
        return { ok: false, error: { code, message: detail || 'Could not load conversation playbook history' } };
      }
    }
    if (event?.action === 'personAIHistory') {
      try { return await require('./person-ai-history-service').getPersonAIHistory(event); }
      catch (error) {
        const code = ['INVALID_INPUT', 'NOT_FOUND'].includes(error?.code) ? error.code : 'AI_HISTORY_FAILED';
        return { ok: false, error: { code, message: 'Could not load AI history' } };
      }
    }
    if (event?.action === 'aiExperience') {
      try { return await require('./ai-experience-service').runAiExperience(event, identity.uid); }
      catch (error) {
        const code = ['INVALID_INPUT','PERSISTENCE_ERROR','STALE','TIMEOUT'].includes(error?.code)
          ? error.code : 'AI_EXPERIENCE_FAILED';
        return { ok:false,error:{code,message:'AI Experience request could not be completed'} };
      }
    }
    // CloudBase may add transport metadata to the event. Only route the declared request fields.
    try { return routeIntent({ intent: event?.intent, subject: event?.subject, input: event?.input }); }
    catch (error) {
      if (error instanceof IntentError) {
        return { ok: false, error: { code: error.code, message: error.message } };
      }
      return { ok: false, error: { code: 'ROUTING_ERROR', message: 'Routing failed' } };
    }
  };
}

function getIdentity() {
  const cloudbase = require('@cloudbase/node-sdk');
  return cloudbase.init({ env: process.env.TCB_ENV }).auth().getUserInfo();
}

exports.main = createMain(getIdentity);
exports.createMain = createMain;
